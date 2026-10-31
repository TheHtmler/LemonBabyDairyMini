'use strict';
const FLAG_KEYS = ['home_search_enabled', 'ai_search_enabled', 'nutrition_scan_enabled'];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
async function featureAccess(db, openid) {
  const values = await Promise.all(FLAG_KEYS.map(async key => {
    const r = await db.collection('feature_flags').where({ key }).limit(1).get(); const doc = (r.data || [])[0];
    // 通用功能无需预建开关记录；已有关闭或范围配置仍优先生效。
    return [key, !doc || doc.enabled === true && (doc.scope === 'all' || Array.isArray(doc.allowOpenids) && doc.allowOpenids.includes(openid))];
  }));
  return Object.fromEntries(values);
}
function getAiPolicy({ scene, env = process.env }) {
  const primaryModel = scene === 'search' ? env.SEARCH_INTENT_MODEL || 'qwen3.5-122b-a10b' : env.BAILIAN_MODEL || 'qwen3.7-plus';
  const fallbackModel = scene === 'search' ? env.SEARCH_INTENT_FALLBACK_MODEL : env.NUTRITION_FALLBACK_MODEL;
  const allowed = String(env.AI_FREE_MODEL_ALLOWLIST || '').split(',').map(x => x.trim()).filter(Boolean);
  const verified = env.AI_FREE_ONLY_VERIFIED === 'true';
  const rawLimit = Number(scene === 'search' ? env.SEARCH_DAILY_LIMIT : env.NUTRITION_DAILY_LIMIT);
  const dailyLimit = Number.isInteger(rawLimit) && rawLimit >= 0 && rawLimit <= 10000 ? rawLimit : scene === 'search' ? 50 : 20;
  return { available: verified && allowed.includes(primaryModel) && !!env.DASHSCOPE_API_KEY && !!env.BAILIAN_BASE_URL,
    primaryModel, fallbackModel: verified && allowed.includes(fallbackModel) && fallbackModel !== primaryModel ? fallbackModel : null, dailyLimit };
}
function requireAiPolicy(options) { const policy = getAiPolicy(options); if (!policy.available) fail('AI_UNAVAILABLE', '智能功能暂不可用，可使用普通搜索或手动录入'); return policy; }
module.exports = { FLAG_KEYS, featureAccess, getAiPolicy, requireAiPolicy, fail };
