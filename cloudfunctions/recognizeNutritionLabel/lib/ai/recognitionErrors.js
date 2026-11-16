'use strict';

const MODEL_QUOTA_EXHAUSTED_MESSAGE = '识别失败，模型额度用完，请给管理员发送反馈申请';
const QUOTA_CODES = new Set(['free_quota_exhausted', 'model_quota_exhausted',
  'allocationquota.freetieronly', 'insufficient_quota']);

// 依据服务错误码判断额度，不能把所有403权限错误或个人每日次数上限当作模型耗尽。
function isModelQuotaExhausted(value) {
  const source = typeof value === 'string' ? { message: value } : value || {};
  return [source.code, source.nativeCode, source.reasonCode, source.policyReason, source.error?.code]
    .some(code => typeof code === 'string' && QUOTA_CODES.has(code.toLowerCase()))
    || source.message === MODEL_QUOTA_EXHAUSTED_MESSAGE;
}

module.exports = { MODEL_QUOTA_EXHAUSTED_MESSAGE, isModelQuotaExhausted };
