'use strict';
const { fail } = require('./lib/search');
const { assertSearchAccess } = require('./access');
const { publicCandidate } = require('./catalogAdapter');
const { previewSource } = require('./repository');
const { featureAccess } = require('./lib/ai');
const { search } = require('./orchestrator');
const { PROTOCOL_VERSION, CAPABILITY_VERSION, BUILD_VERSION, CAPABILITIES } = require('./lib/search');
function runtime() {
  const cloud = require('wx-server-sdk'); cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const context = cloud.getWXContext(); const env = context.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (!env) fail('CONFIG_MISSING', '搜索云环境尚未配置');
  return { db: require('@cloudbase/node-sdk').init({ env }).database(), context, env: process.env };
}
function createSearchHandler({ db, context, env = process.env, now = Date.now, modelClient }) {
  return async (event = {}) => {
    const started = Date.now(); let accessMs = 0; let flagsMs = 0;
    try {
      const accessContext = await assertSearchAccess(db, context.OPENID, event.babyUid);
      accessMs = Date.now() - started; const flagsStarted = Date.now();
      const flags = await featureAccess(db, accessContext.openid);
      flagsMs = Date.now() - flagsStarted;
      if (event.action === 'capabilities') {
        return { ok: true, flags, allowedFeatureIds: ['food', 'powder', 'recipe', 'medication', 'meal', 'milk', 'water', 'records', 'nutrition', 'goals', 'baby'],
          protocolVersion: PROTOCOL_VERSION, capabilityVersion: CAPABILITY_VERSION, buildVersion: BUILD_VERSION, operations: Object.keys(CAPABILITIES) };
      }
      if (!flags.home_search_enabled) fail('FEATURE_DISABLED', '搜索功能暂未开放');
      if (event.action === 'search') {
        const response = await search({ db, accessContext, event, flags, env, now: now(), modelClient });
        return { ...response, performance: { ...response.performance, accessMs, flagsMs, totalMs: Date.now() - started } };
      }
      if (event.action === 'preview') return { ok: true, item: publicCandidate(await previewSource(db, accessContext, event)) };
      fail('INVALID_INPUT', '不支持该搜索操作');
    } catch (error) {
      const allowed = ['FORBIDDEN', 'INVALID_QUERY', 'INVALID_INPUT', 'NOT_FOUND', 'STALE_RESULT', 'INVALID_CURSOR', 'STALE_CURSOR', 'SEARCH_BUSY', 'FEATURE_DISABLED', 'AI_UNAVAILABLE', 'AI_RUNNING', 'AI_UNKNOWN', 'DAILY_LIMIT', 'REQUEST_CONFLICT', 'MODEL_TIMEOUT', 'MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'INVALID_MODEL_RESULT', 'FREE_QUOTA_EXHAUSTED', 'CONFIG_MISSING'];
      return { ok: false, code: allowed.includes(error.code) ? error.code : 'SEARCH_FAILED', message: allowed.includes(error.code) ? error.message : '搜索暂时失败，请稍后重试' };
    }
  };
}
exports.main = async event => { try { return await createSearchHandler(runtime())(event); } catch (_) { return { ok: false, code: 'CONFIG_MISSING', message: '搜索服务尚未就绪' }; } };
exports.createSearchHandler = createSearchHandler;
