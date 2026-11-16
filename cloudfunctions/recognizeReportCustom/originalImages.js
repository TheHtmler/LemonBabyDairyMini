'use strict';
const crypto = require('crypto');
const COLLECTIONS = ['baby_reports_v2', 'baby_reports'];
const MAX_PHOTOS = 6;

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

async function assertBabyAccess(db, openid, babyUid) {
  if (!openid || !/^[A-Za-z0-9_-]{1,128}$/.test(babyUid || '')) fail('FORBIDDEN', '请先登录并选择宝宝');
  for (const name of ['baby_creators', 'baby_participants']) {
    const result = await db.collection(name).where({ _openid: openid, babyUid }).limit(1).get();
    if (result.data?.length) return;
  }
  fail('FORBIDDEN', '无权访问该宝宝的原报告');
}

function validOriginal(fileID, babyUid, env) {
  if (typeof fileID !== 'string') return false;
  try {
    const url = new URL(fileID);
    return url.protocol === 'cloud:' && (url.host === env || url.host.startsWith(env + '.'))
      && !url.search && !url.hash && !url.username && !url.password
      && new RegExp('^/report_originals/' + babyUid + '/[A-Za-z0-9_-]{1,128}/[a-f0-9]{32}\\.jpg$').test(url.pathname);
  } catch (_) { return false; }
}

async function storedReport(db, event) {
  if (!COLLECTIONS.includes(event.collection) || !/^[A-Za-z0-9_-]{1,128}$/.test(event.reportId || '')) {
    fail('INVALID_INPUT', '报告标识无效');
  }
  const result = await db.collection(event.collection).doc(event.reportId).get();
  const report = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!report || report.babyUid !== event.babyUid) fail('FORBIDDEN', '无法访问这份报告');
  return report;
}

// 原图操作只校验资料权限，不消耗识别次数，也不依赖 OCR 模型状态。
async function handleOriginalImages({ event, cloud, db, openid, env }) {
  await assertBabyAccess(db, openid, event.babyUid);
  const enabled = process.env.REPORT_ORIGINALS_ENABLED === 'true';
  if (event.action === 'originalsCapabilities') return { ok: true, enabled };
  if (event.action === 'prepareOriginals') {
    if (!enabled) fail('SERVICE_UNAVAILABLE', '原报告保存暂未开放');
    if (!Number.isInteger(event.count) || event.count < 1 || event.count > MAX_PHOTOS) fail('INVALID_INPUT', '原报告最多保存6张');
    return { ok: true, paths: Array.from({ length: event.count }, () =>
      `report_originals/${event.babyUid}/${openid}/${crypto.randomBytes(16).toString('hex')}.jpg`) };
  }
  const report = await storedReport(db, event);
  const files = report.originalImages || [];
  if (!Array.isArray(files) || files.length > MAX_PHOTOS || files.some(id => !validOriginal(id, event.babyUid, env))) {
    fail('INVALID_INPUT', '原报告附件信息异常，请联系管理员');
  }
  const fileList = [...new Set(files)];
  if (event.action === 'getOriginals') {
    if (!fileList.length) return { ok: true, urls: [] };
    const result = await cloud.getTempFileURL({ fileList: fileList.map(fileID => ({ fileID, maxAge: 600 })) });
    if (result.fileList?.length !== fileList.length || result.fileList.some(file => file.status !== 0 || !file.tempFileURL)) {
      fail('DOWNLOAD_FAILED', '部分原报告暂时无法读取，请稍后重试');
    }
    return { ok: true, urls: result.fileList.map(file => file.tempFileURL) };
  }
  if (event.action === 'deleteReportWithOriginals') {
    // 先检查全部删除结果，再移除记录；失败仍有报告引用可再次重试，避免留下无人管理的原图。
    if (fileList.length) {
      const result = await cloud.deleteFile({ fileList });
      if (result.fileList?.length !== fileList.length || result.fileList.some(file => file.status !== 0)) {
        fail('DELETE_FAILED', '部分原报告尚未删除，请重试');
      }
    }
    await db.collection(event.collection).doc(event.reportId).remove();
    return { ok: true };
  }
  fail('INVALID_INPUT', '不支持的原报告操作');
}

module.exports = { handleOriginalImages };
