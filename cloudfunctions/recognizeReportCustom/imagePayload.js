'use strict';
const crypto = require('crypto');
const { REPORT_MAX_PHOTOS, REPORT_RECOGNITION_VERSION, REPORT_OCR_PIPELINE_VERSION } = require('./lib/config/reportTypes');
const { validateReportImage } = require('./imagePreprocess');

function validateReportFileIDs(fileIDs, babyUid, env) {
  if (!Array.isArray(fileIDs) || !fileIDs.length || fileIDs.length > REPORT_MAX_PHOTOS
    || new Set(fileIDs).size !== fileIDs.length) {
    throw Object.assign(new Error('请选择1至6张不同的报告图片'), { code: 'INVALID_INPUT' });
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(babyUid || '') || typeof env !== 'string' || !env) {
    throw Object.assign(new Error('报告图片访问环境无效'), { code: 'FORBIDDEN' });
  }
  const expected = new RegExp('^cloud://[^/]+/custom_ocr_temp/' + babyUid + '_[0-9]+_[a-z0-9]{8}\\.jpg$');
  for (const fileID of fileIDs) {
    if (typeof fileID !== 'string' || !expected.test(fileID)) {
      throw Object.assign(new Error('报告图片与当前宝宝不匹配，请重新拍摄'), { code: 'FORBIDDEN' });
    }
    const host = new URL(fileID).host;
    if (host !== env && !host.startsWith(env + '.')) {
      throw Object.assign(new Error('报告图片不属于当前云环境，请重新选择'), { code: 'FORBIDDEN' });
    }
  }
  return [...fileIDs];
}

// 只读取当前请求交接的云存储图片，图片内容不接受另一份内联参数覆盖。
async function resolveImageBuffer(cloud, event = {}) {
  const fileID = event.fileID;
  if (typeof fileID !== 'string' || !fileID) throw Object.assign(new Error('缺少报告图片'), { code: 'INVALID_INPUT' });
  const startedAt = Date.now();
  let response;
  try { response = await cloud.downloadFile({ fileID }); }
  catch (_) { throw Object.assign(new Error('读取报告图片失败，请重新拍摄'), { code: 'DOWNLOAD_FAILED' }); }
  const buffer = response.fileContent;
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('读取报告图片失败，请重新拍摄'), { code: 'DOWNLOAD_FAILED' });
  return { buffer, source: 'fileID', downloadMs: Date.now() - startedAt };
}

async function resolveReportImageBatch(cloud, fileIDs, reportType) {
  const startedAt = Date.now();
  // 组内最多六张；并行读图减少网络串行等待，Promise.all仍按原顺序交付。
  const buffers = await Promise.all(fileIDs.map(async fileID => {
    const { buffer } = await resolveImageBuffer(cloud, { fileID });
    validateReportImage(buffer);
    return buffer;
  }));
  const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  // 每张内容先独立摘要，避免直接拼接不同图片产生边界歧义；顺序也属于请求内容。
  const images = buffers.map(buffer => crypto.createHash('sha256').update(buffer).digest('hex'));
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ version: REPORT_RECOGNITION_VERSION,
    pipelineVersion: REPORT_OCR_PIPELINE_VERSION, reportType, images })).digest('hex');
  return { buffers, totalBytes, requestHash, downloadMs: Date.now() - startedAt };
}

module.exports = { resolveImageBuffer, validateReportFileIDs, resolveReportImageBatch };
