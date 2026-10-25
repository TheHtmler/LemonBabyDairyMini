const { normalizeCategoryCatalog } = require('./lib/core/index.js');
const { createRequestId, callNutritionFunction } = require('../../../utils/nutritionRecognition');

// 仅缓存当前拍摄批次，远短于服务端草稿的 24 小时有效期。
const PREPARATION_LIFETIME_MS = 5 * 60 * 1000;

function previewPreparationBinding(properties, context, imageCount) {
  try {
    const envId = (getApp().globalData || {}).cloudEnvId;
    if (properties.purpose !== 'preview' || properties.mode !== 'auto' || properties.targetId || properties.sourceSystemFoodId ||
        !context.accountKey || context.babyUid !== properties.babyUid || !envId || ![1, 2].includes(imageCount)) return null;
    const categoryCatalog = Object.freeze(normalizeCategoryCatalog(properties.categoryOptions).slice(0, 100)
      .map(item => Object.freeze({ ...item })));
    const payload = Object.freeze({ babyUid: context.babyUid, purpose: 'preview', mode: 'auto', imageCount, categoryCatalog });
    return { envId, payload, key: JSON.stringify([context.accountKey, context.babyUid, envId,
      payload.purpose, payload.mode, imageCount, categoryCatalog]) };
  } catch (_) { return null; }
}

function invalidatePreviewPreparation(candidate) { if (candidate) candidate.active = false; }
function isPreviewPreparationCurrent(candidate) {
  try {
    const age = Date.now() - candidate.createdAt;
    return !!candidate.active && age >= 0 && age < PREPARATION_LIFETIME_MS && candidate.isCurrent();
  } catch (_) { return false; }
}

function startPreviewPreparation(binding, batchToken, isCurrent) {
  const candidate = { binding, batchToken, isCurrent, requestId: createRequestId(), createdAt: Date.now(), active: true };
  // 立即发起请求，但将拒绝转换成结果；打开相册和后续采集均不等待网络。
  candidate.promise = callNutritionFunction('recognizeNutritionLabel', {
    ...binding.payload, action: 'prepare', requestId: candidate.requestId
  }).then(prepared => ({ prepared }), error => ({ error }));
  return candidate;
}

function validPreparedResponse(candidate, prepared) {
  return prepared && prepared.requestId === candidate.requestId && prepared.envId === candidate.binding.envId &&
    /^[a-f0-9]{64}$/.test(prepared.sessionId || '') && Array.isArray(prepared.filePaths) &&
    prepared.filePaths.length === candidate.binding.payload.imageCount &&
    prepared.filePaths.every(path => typeof path === 'string' && path.length > 0) &&
    new Set(prepared.filePaths).size === prepared.filePaths.length;
}

async function resolvePreviewPreparation(candidate) {
  if (!isPreviewPreparationCurrent(candidate)) return null;
  const outcome = await candidate.promise;
  if (!isPreviewPreparationCurrent(candidate)) return null;
  if (outcome.prepared) {
    if (!validPreparedResponse(candidate, outcome.prepared)) { invalidatePreviewPreparation(candidate); return null; }
    return { requestId: candidate.requestId, prepared: outcome.prepared };
  }
  if (outcome.error && outcome.error.code === 'SESSION_EXPIRED') { invalidatePreviewPreparation(candidate); return null; }
  // 请求可能已在云端成功；网络失败后仍用同一编号进入原准备分支，取回幂等会话。
  return { requestId: candidate.requestId, prepared: null };
}

module.exports = { previewPreparationBinding, invalidatePreviewPreparation, isPreviewPreparationCurrent,
  startPreviewPreparation, resolvePreviewPreparation };
