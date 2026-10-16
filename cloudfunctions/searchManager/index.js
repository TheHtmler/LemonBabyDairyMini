'use strict';
const { fail } = require('./lib/search');
const { assertSearchAccess } = require('./access');
const { executeSearch, publicCandidate } = require('./queryService');
const { previewSource } = require('./repository');
const { interpretQuery } = require('./intentService');
const { recentIntakeDates } = require('./metricDates');
const { featureAccess, getAiPolicy, usageStatus } = require('./lib/ai');
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
    try {
      const accessContext = await assertSearchAccess(db, context.OPENID, event.babyUid);
      const flags = await featureAccess(db, accessContext.openid);
      if (event.action === 'capabilities') {
        const readAiCapability = async (scene, enabled) => {
          const policy = getAiPolicy({ scene, env });
          if (!enabled || !policy.available) return { available: false, remaining: 0,
            reasonCode: !enabled ? 'FEATURE_DISABLED' : 'CONFIG_MISSING' };
          try {
            const quota = await usageStatus(db, accessContext.openid, scene, policy.dailyLimit, now());
            return { ...quota, reasonCode: quota.available ? '' : 'DAILY_LIMIT' };
          } catch (_) {
            // 智能调用额度异常只影响对应智能能力，不阻断普通资料搜索。
            return { available: false, remaining: 0, reasonCode: 'SERVICE_UNAVAILABLE' };
          }
        };
        const [ai, scan] = await Promise.all([
          readAiCapability('search', flags.ai_search_enabled),
          readAiCapability('scan', flags.nutrition_scan_enabled)
        ]);
        return { ok: true, flags, allowedFeatureIds: ['food', 'powder', 'recipe', 'medication', 'meal', 'milk', 'water', 'records', 'nutrition', 'goals', 'baby'],
          ai, scan, protocolVersion: PROTOCOL_VERSION, capabilityVersion: CAPABILITY_VERSION, buildVersion: BUILD_VERSION, operations: Object.keys(CAPABILITIES) };
      }
      if (!flags.home_search_enabled) fail('FEATURE_DISABLED', '搜索功能暂未开放');
      if (event.action === 'search') return await search({ db, accessContext, event, flags, env, now: now(), modelClient });
      if (event.action === 'metricDates') return { ok: true, ...await recentIntakeDates({ db, accessContext, period: event.period, latest: event.latest !== false, now: now() }) };
      if (event.action === 'interpret') {
        if (!flags.ai_search_enabled) fail('AI_UNAVAILABLE', '智能搜索暂不可用，可使用普通查询或手动筛选');
        return await interpretQuery({ db, accessContext, query: event.query, requestId: event.requestId, now: now(), env, modelClient });
      }
      if (event.action === 'execute') return { ok: true, ...await executeSearch({ db, accessContext, queryPlan: event.queryPlan, cursor: event.cursor, pageSize: event.pageSize, now: now(), secret: env.SEARCH_CURSOR_SECRET }) };
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
