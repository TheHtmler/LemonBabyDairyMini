'use strict';
const FLAG_KEYS = ['home_search_enabled', 'ai_search_enabled', 'nutrition_scan_enabled'];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function readFallbackLimit(value, fallback) {
  if (value == null || String(value).trim() === '') return fallback;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 0 && limit <= 10000 ? limit : fallback;
}
async function featureAccess(db, openid) {
  const values = await Promise.all(FLAG_KEYS.map(async key => {
    const r = await db.collection('feature_flags').where({ key }).limit(1).get(); const doc = (r.data || [])[0];
    // 通用功能无需预建开关记录；已有关闭或范围配置仍优先生效。
    return [key, !doc || doc.enabled === true && (doc.scope === 'all' || Array.isArray(doc.allowOpenids) && doc.allowOpenids.includes(openid))];
  }));
  return Object.fromEntries(values);
}
function getAiPolicy({ scene, env = process.env }) {
  if (scene === 'report') {
    // 报告仅允许通过管理员名单启用，不借用食物模型或旧环境变量名单。
    return { available: false, primaryModel: '', fallbackModel: null,
      dailyLimit: readFallbackLimit(env.REPORT_OCR_DAILY_LIMIT, 20) };
  }
  const primaryModel = scene === 'search' ? env.SEARCH_INTENT_MODEL || 'qwen3.5-122b-a10b' : env.BAILIAN_MODEL || 'qwen3.7-plus';
  const fallbackModel = scene === 'search' ? env.SEARCH_INTENT_FALLBACK_MODEL : env.NUTRITION_FALLBACK_MODEL;
  const allowed = String(env.AI_FREE_MODEL_ALLOWLIST || '').split(',').map(x => x.trim()).filter(Boolean);
  const verified = env.AI_FREE_ONLY_VERIFIED === 'true';
  // 搜索保留原有解析方式；识别环境变量为空时按未配置处理，避免误判为暂停。
  const dailyLimit = readFallbackLimit(scene === 'search' ? Number(env.SEARCH_DAILY_LIMIT) : env.NUTRITION_DAILY_LIMIT, scene === 'search' ? 50 : 20);
  return { available: verified && allowed.includes(primaryModel) && !!env.DASHSCOPE_API_KEY && !!env.BAILIAN_BASE_URL,
    primaryModel, fallbackModel: verified && allowed.includes(fallbackModel) && fallbackModel !== primaryModel ? fallbackModel : null, dailyLimit };
}
function requireAiPolicy(options) { const policy = getAiPolicy(options); if (!policy.available) fail('AI_UNAVAILABLE', '智能功能暂不可用，可使用普通搜索或手动录入'); return policy; }
module.exports = { FLAG_KEYS, featureAccess, getAiPolicy, requireAiPolicy, fail };
