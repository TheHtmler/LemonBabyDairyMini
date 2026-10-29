const { normalizeCloudServiceError } = require('./cloudServiceError');

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
      error.restartRequired = result && result.restartRequired === true;
      throw error;
    }
    return result;
  } catch (error) {
    const failure = normalizeCloudServiceError(error, 'scan');
    console.warn('[nutrition-service]', name, data.action, failure.code, failure.stage);
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

async function chooseRecognitionImages(options = {}) {
  // 每个拍摄位置只选一张；包装双面在提交识别前收集齐全。
  const selected = await invoke('chooseImage',
    { count: options.count || 1, sizeType: ['compressed'], sourceType: options.sourceType || ['album', 'camera'] });
  return prepareRecognitionImages(selected.tempFilePaths);
}

// 原生取景拍照与相册选择共用图片压缩、张数和大小校验。
async function prepareRecognitionImages(originalPaths) {
  if (!Array.isArray(originalPaths) || !originalPaths.length || originalPaths.some(path => typeof path !== 'string' || !path)) throw new Error('请选择清晰的图片');
  if (originalPaths.length > 3) throw new Error('同一商品最多保留3张图片');
  const paths = [];
  for (const original of originalPaths) {
    let path = original;
    try { path = (await invoke('compressImage', { src: original, quality: 70 })).tempFilePath || original; }
    catch (_) { /* 部分图片格式或开发者工具不支持压缩时，校验原图大小后继续。 */ }
    const file = await invoke('getFileInfo', { filePath: path });
    if (file.size > 3 * 1024 * 1024) throw new Error('单张图片需小于3MB，请裁剪或重新拍摄');
    paths.push(path);
  }
  return paths;
}

async function uploadRecognitionImages(paths, prepared, isActive, onProgress = () => {}) {
  let completed = 0;
  // 最多三张图并发上传，返回顺序仍与营养表、正面的位置一致。
  return Promise.all(paths.map(async (path, i) => {
    if (!isActive()) throw new Error('当前表单已关闭');
    const result = await wx.cloud.uploadFile({
      cloudPath: prepared.filePaths[i], filePath: path, config: { env: prepared.envId } });
    completed += 1;
    if (isActive()) onProgress(completed, paths.length);
    return result.fileID;
  }));
}

// 食物照片长期保留，不能引用识别草稿到期后会清理的图片。
async function uploadFoodImages(paths, envId, uploaded = {}) {
  return Promise.all(paths.map(async path => {
    if (path.startsWith('cloud://')) return path;
    if (uploaded[path]) return uploaded[path];
    const extension = (path.match(/\.(jpg|jpeg|png|webp)$/i) || [null, 'jpg'])[1];
    const result = await wx.cloud.uploadFile({ cloudPath: 'food_images/' + createRequestId() + '.' + extension,
      filePath: path, config: { env: envId } });
    if (!result.fileID) throw new Error('食物图片保存失败，请重试');
    uploaded[path] = result.fileID;
    return result.fileID;
  }));
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
    if (['INVALID_INPUT', 'VALIDATION_FAILED', 'IDENTITY_INSUFFICIENT', 'VERSION_CONFLICT', 'COMPARISON_STALE', 'FORBIDDEN', 'REFERENCE_UNAVAILABLE', 'SESSION_EXPIRED'].includes(error.code)) wx.removeStorageSync(key);
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
module.exports = { createRequestId, callNutritionFunction, recognitionCapabilities, chooseRecognitionImages, prepareRecognitionImages, uploadRecognitionImages, uploadFoodImages, pendingConfirmation, confirmWithRecovery, recoverConfirmation };
