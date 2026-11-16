'use strict';
const cloud = require('wx-server-sdk');
const { validateReportFileIDs, resolveReportImageBatch } = require('./imagePayload');
const { requestReportOcr, resolveReportDeadline } = require('./customOcrClient');
const { REPORT_OCR_TYPES, REPORT_OCR_TIMING, REPORT_RECOGNITION_VERSION } = require('./lib/config/reportTypes');
const { getAiPolicy, resolveModelPolicy, usageStatus, reserveInvocation, markDispatched, completeInvocation } = require('./lib/ai');
const { readReportQuota } = require('./lib/ai/nutritionQuota');
const { handleOriginalImages } = require('./originalImages');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const accessDb = cloud.database();
const ACCESS_MESSAGE = '报告拍照识别暂未对当前用户开放';

function modelDatabase() {
  const env = cloud.getWXContext().ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (!env) throw Object.assign(new Error('无法确定报告识别的云环境'), { code: 'CONFIG_MISSING' });
  return require('@cloudbase/node-sdk').init({ env }).database();
}

// 仅返回程序固定类别，不能把服务原文、图片或检验数据带入错误详情。
function reportFailureDetails(error = {}) {
  const source = error.diagnostic || {};
  const details = {};
  if (['transcription', 'mapping', 'source_merge'].includes(source.stage)) details.stage = source.stage;
  if (typeof source.validationReason === 'string' && /^[A-Z][A-Z_]{0,63}$/.test(source.validationReason)) {
    details.validationReason = source.validationReason;
  }
  if (['n', 'v', 'r', 'u', 'f', 'name', 'value', 'ref_range', 'unit', 'flag'].includes(source.field)) details.field = source.field;
  if (['null', 'string', 'number', 'boolean'].includes(source.rootType)) details.rootType = source.rootType;
  if (Number.isSafeInteger(source.batchIndex) && source.batchIndex >= 1 && source.batchIndex <= 6) details.batchIndex = source.batchIndex;
  if (typeof source.segmentPath === 'string' && /^\d{1,3}(?:\.[12]){0,3}$/.test(source.segmentPath)) details.segmentPath = source.segmentPath;
  if (typeof source.mappingPath === 'string' && /^\d{1,3}(?:\.[12]){0,5}$/.test(source.mappingPath)) details.mappingPath = source.mappingPath;
  return details;
}

async function reportAccess(openid, babyUid, checkQuota = false) {
  if (!openid || !/^[A-Za-z0-9_-]{1,128}$/.test(babyUid || '')) {
    throw Object.assign(new Error('请先登录并选择宝宝'), { code: 'FORBIDDEN' });
  }
  const response = await accessDb.collection('feature_flags').where({ key: 'report_ocr_access' }).limit(1).get();
  const config = response.data?.[0] || {};
  const scope = config.scope === 'all' ? 'all' : 'whitelist';
  const openids = Array.isArray(config.allowOpenids) ? config.allowOpenids
    : String(config.allowOpenids || '').split(/[\n,，\s]+/);
  const allowed = scope === 'all' || openids.some(value => String(value).trim() === openid);
  if (!allowed) return { allowed: false, scope, reasonCode: 'OCR_NOT_ALLOWED', message: config.message || ACCESS_MESSAGE };
  const db = modelDatabase();
  let authorized = false;
  for (const collection of ['baby_creators', 'baby_participants']) {
    const membership = await db.collection(collection).where({ _openid: openid, babyUid }).limit(1).get();
    if (membership.data?.length) { authorized = true; break; }
  }
  if (!authorized) throw Object.assign(new Error('无权访问该宝宝的检测报告'), { code: 'FORBIDDEN' });
  const policy = await resolveModelPolicy(db, 'report', process.env, false);
  if (!policy.available) return { allowed: false, scope, reasonCode: policy.unavailableReason,
    message: policy.unavailableMessage || '请管理员启用报告 OCR 模型' };
  const configuredQuota = await readReportQuota(db, policy.dailyLimit);
  policy.dailyLimit = configuredQuota.dailyLimit;
  if (checkQuota) {
    const quota = await usageStatus(db, openid, 'report', policy.dailyLimit);
    if (!quota.available) return { allowed: false, scope, reasonCode: 'DAILY_LIMIT',
      message: policy.dailyLimit === 0 ? '管理员已暂停报告识别' : '今日报告识别次数已用完（每天 ' + policy.dailyLimit + ' 次），请明天再试或手动录入' };
  }
  return { allowed: true, scope, message: '', policy, db };
}

exports.main = async (event = {}) => {
  const startedAt = Date.now();
  const action = event.action || 'recognize';
  const timings = {};
  let phase = 'start';
  const runStage = async (name, task) => {
    phase = name;
    const stageStartedAt = Date.now();
    if (action === 'recognize') console.info('[report-ocr-stage]', { phase, elapsedMs: stageStartedAt - startedAt });
    try { return await task(); }
    finally { timings[name + 'Ms'] = Math.max(0, Date.now() - stageStartedAt); }
  };
  const { OPENID } = cloud.getWXContext();
  let reservation; let db; let dispatched = false; let output; let temporaryFileIDs = [];
  try {
    if (['originalsCapabilities', 'prepareOriginals', 'getOriginals', 'deleteReportWithOriginals'].includes(action)) {
      const env = cloud.getWXContext().ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
      return await handleOriginalImages({ event, cloud, db: modelDatabase(), openid: OPENID, env });
    }
    if (action === 'getDailyLimit') {
      if (!OPENID) return { ok: false, code: 'FORBIDDEN', message: '请先登录' };
      // 仅返回公开额度及版本，服务暂停或未选择宝宝时仍可读取并配置。
      const policy = getAiPolicy({ scene: 'report', env: process.env });
      return { ok: true, config: await readReportQuota(modelDatabase(), policy.dailyLimit) };
    }
    if (!['checkAccess', 'recognize'].includes(action)) {
      return { ok: false, code: 'INVALID_INPUT', message: '不支持的报告识别操作' };
    }
    const access = await runStage('access', () => reportAccess(OPENID, event.babyUid, action === 'checkAccess'));
    if (action === 'checkAccess') return { ok: true, action, allowed: access.allowed,
      scope: access.scope, reasonCode: access.reasonCode || '', message: access.message };
    if (!access.allowed) return { ok: false, code: access.reasonCode || 'OCR_NOT_ALLOWED', message: access.message };
    if (!REPORT_OCR_TYPES.some(type => type.key === event.reportType)) {
      return { ok: false, code: 'INVALID_INPUT', message: '该报告类型暂不支持识别' };
    }
    const imageEnv = cloud.getWXContext().ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
    temporaryFileIDs = validateReportFileIDs(event.fileIDs, event.babyUid, imageEnv);
    if (event.protocolVersion !== REPORT_RECOGNITION_VERSION) {
      throw Object.assign(new Error('报告识别版本不一致，请更新小程序及识别云函数后重试'), { code: 'REPORT_VERSION_MISMATCH' });
    }
    const images = await runStage('download', () => resolveReportImageBatch(cloud, temporaryFileIDs, event.reportType));
    db = access.db;
    reservation = await runStage('reserve', () => reserveInvocation({ db, openid: OPENID, babyUid: event.babyUid, scene: 'report',
      requestId: event.ocrRequestId, requestHash: images.requestHash, dailyLimit: access.policy.dailyLimit,
      leaseMs: REPORT_OCR_TIMING.leaseMs }));
    if (reservation.state === 'cached') return reservation.result;
    const deadline = resolveReportDeadline(startedAt);
    if (deadline <= Date.now()) throw Object.assign(new Error('报告准备耗时过长，请稍后重试'), { code: 'REPORT_PREPARATION_TIMEOUT' });
    await runStage('dispatch', () => markDispatched(db, reservation));
    dispatched = true;
    const result = await runStage('model', () => requestReportOcr({ buffers: images.buffers,
      reportType: event.reportType, policy: access.policy, deadline }));
    output = { ok: true, mode: result.mode, protocolVersion: result.protocolVersion,
      structuredItems: result.structuredItems, warnings: result.warnings,
      reportType: result.reportType, parserVersion: result.parserVersion, lines: [], items: [], rawText: '',
      modelInfo: result.modelInfo, meta: { provider: 'bailian-ocr', actualModel: result.modelInfo.actualModel,
        structuredCount: result.structuredItems.length, imageCount: images.buffers.length,
        sourceValues: result.statistics.sourceValues, resultValues: result.statistics.resultValues } };
    await runStage('finalize', () => completeInvocation({ db, reservation, dispatched, result: output, usage: result.usage }));
    console.info('[report-ocr-result]', { model: result.modelInfo.actualModel, reportType: event.reportType,
      parserVersion: result.parserVersion, imageBytes: images.totalBytes, imageCount: images.buffers.length,
      itemCount: result.structuredItems.length, ...result.statistics, ...timings,
      functionElapsedMs: Date.now() - startedAt });
    return output;
  } catch (error) {
    const failedPhase = phase;
    if (reservation?.state === 'reserved' && db) {
      await runStage('failureFinalize', () => completeInvocation({ db, reservation, dispatched, error, usage: error.usage })).catch(() => {});
    }
    console.warn('[report-ocr-failed]', JSON.stringify({ code: error.code || 'RECOGNIZE_FAILED', httpStatus: error.httpStatus || null,
      phase: failedPhase, ...timings, functionElapsedMs: Date.now() - startedAt,
      ...(error.diagnostic || {}) }));
    if (event.action === 'checkAccess') return { ok: true, allowed: false,
      reasonCode: error.code || 'CONFIG_MISSING', message: error.message || '报告识别暂不可用，请稍后重试' };
    const details = reportFailureDetails(error);
    const stageLabel = details.stage === 'transcription'
      ? (details.batchIndex ? '第' + details.batchIndex + '张图片' : '图片') +
        (details.segmentPath ? '分块' + details.segmentPath : '') + '取字'
      : details.stage === 'mapping' ? '指标分类' + (details.mappingPath ? '分批' + details.mappingPath : '')
        : details.stage === 'source_merge' ? '原表汇总' : '';
    const failureMessage = error.code === 'DOWNLOAD_FAILED' ? '读取报告图片失败，请重新拍摄'
      : error.message || '报告识别失败，请稍后重试';
    return { ok: false, code: error.code || 'RECOGNIZE_FAILED', diagnostic: details,
      message: stageLabel && details.validationReason ? stageLabel + '：' + failureMessage : failureMessage };
  } finally {
    if (temporaryFileIDs.length) {
      try {
        const removed = await runStage('cleanup', () => cloud.deleteFile({ fileList: temporaryFileIDs }));
        if (removed.fileList?.length !== temporaryFileIDs.length || removed.fileList.some(file => file.status !== 0)) console.warn('[report-temp-cleanup]', { code: 'DELETE_INCOMPLETE' });
      } catch (_) { console.warn('[report-temp-cleanup]', { code: 'DELETE_FAILED' }); }
    }
    if (action === 'recognize') console.info('[report-ocr-finished]', { ...timings, functionElapsedMs: Date.now() - startedAt });
  }
};
