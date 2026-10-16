function invoke(name, options) {
  return new Promise((resolve, reject) => wx[name]({ ...options, success: resolve, fail: reject }));
}
function createRequestId() { return 'nutrition_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12); }

async function callNutritionFunction(name, data) {
  let timer;
  try {
    const response = await Promise.race([
      wx.cloud.callFunction({ name, data }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('请求等待超时，请稍后手动重试')), 45000); })
    ]);
    const result = response.result;
    if (!result || !result.ok) {
      const error = new Error(result && result.message || '营养服务暂不可用');
      error.code = result && result.code || 'SERVICE_UNAVAILABLE';
      error.stage = result && result.stage || '';
      throw error;
    }
    return result;
  } catch (error) {
    const failure = normalizeCloudServiceError(error, 'scan');
    console.warn('[nutrition-service]', name, data.action, failure.code, failure.stage);
    throw failure;
  } finally { clearTimeout(timer); }
}

async function chooseRecognitionImages(options = {}) {
  const selected = await invoke('chooseImage', { count: Math.max(1, Math.min(3, options.count || 3)), sizeType: ['compressed'], sourceType: options.sourceType || ['album', 'camera'] });
  const paths = [];
  for (const original of selected.tempFilePaths) {
    let path = original;
    try { path = (await invoke('compressImage', { src: original, quality: 70 })).tempFilePath || original; }
    catch (_) { /* 部分图片格式或开发者工具不支持压缩时，校验原图大小后继续。 */ }
    const file = await invoke('getFileInfo', { filePath: path });
    if (file.size > 3 * 1024 * 1024) throw new Error('单张图片需小于3MB，请裁剪或重新拍摄');
    paths.push(path);
  }
  if (!paths.length) throw new Error('请选择清晰的图片');
  return paths;
}

async function uploadRecognitionImages(paths, prepared, isActive, onProgress = () => {}) {
  const fileIDs = [];
  for (let i = 0; i < paths.length; i += 1) {
    if (!isActive()) throw new Error('当前表单已关闭');
    const result = await wx.cloud.uploadFile({ cloudPath: prepared.filePaths[i], filePath: paths[i], config: { env: prepared.envId } });
    fileIDs.push(result.fileID);
    if (isActive()) onProgress(fileIDs.length, paths.length);
  }
  return fileIDs;
}
function pendingKey(babyUid) {
  const app = getApp(); const account = (app.globalData || {}).openid || wx.getStorageSync('openid') || '';
  return 'nutrition_pending_save:' + account + ':' + babyUid;
}
function pendingConfirmation(babyUid) { return wx.getStorageSync(pendingKey(babyUid)) || null; }
async function confirmWithRecovery(payload) {
  const key = pendingKey(payload.babyUid);
  const previous = wx.getStorageSync(key);
  if (previous && (previous.sessionId !== payload.sessionId || previous.operationId !== payload.operationId)) throw new Error('请先恢复上次保存状态，再提交新的资料');
  wx.setStorageSync(key, { babyUid: payload.babyUid, sessionId: payload.sessionId, operationId: payload.operationId, createdAt: Date.now() });
  try {
    const result = await callNutritionFunction('confirmNutritionRecognition', { ...payload, action: 'confirm' });
    wx.removeStorageSync(key); return result;
  } catch (error) {
    if (['INVALID_INPUT', 'VALIDATION_FAILED', 'VERSION_CONFLICT', 'COMPARISON_STALE', 'FORBIDDEN', 'REFERENCE_UNAVAILABLE'].includes(error.code)) wx.removeStorageSync(key);
    throw error;
  }
}
async function recoverConfirmation(pending) {
  const key = pendingKey(pending.babyUid);
  const result = await callNutritionFunction('confirmNutritionRecognition', { ...pending, action: 'getStatus' });
  if (['saved', 'failed', 'not_submitted'].includes(result.state)) wx.removeStorageSync(key);
  return result;
}
const recognitionCapabilities = params => callNutritionFunction('recognizeNutritionLabel', { ...params, action: 'capabilities' });
module.exports = { createRequestId, callNutritionFunction, recognitionCapabilities, chooseRecognitionImages, uploadRecognitionImages, pendingConfirmation, confirmWithRecovery, recoverConfirmation };
const { normalizeCloudServiceError } = require('./cloudServiceError');
