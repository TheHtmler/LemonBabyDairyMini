'use strict';

const { fail, getAiPolicy } = require('./policy');
const COLLECTION = 'feature_flags';
const MODEL_CONFIG_KEY = 'ai_model_config';
const MODEL_QUOTA_KEY = 'ai_model_quota';
// 仅用于提示额度展示数据的新旧程度，不作为模型调用或配置保存的有效期。
const QUOTA_DISPLAY_MAX_AGE = 15 * 60 * 1000;
const SCENES = ['search', 'scan'];
const UNAVAILABLE_MESSAGES = {
  SERVICE_DISABLED: 'AI服务已关闭，请管理员启用后重试',
  ENDPOINT_INVALID: '模型接口地址未通过北京接入校验，请管理员核对配置',
  API_KEY_MISSING: '模型调用密钥尚未配置，请管理员检查配置',
  NO_ELIGIBLE_MODEL: '当前场景暂无可调用模型，请检查启用名单或切换未耗尽的模型',
  LEGACY_POLICY_UNAVAILABLE: '模型配置尚未就绪，请管理员检查配置或云函数部署'
};
const MODEL_CATALOG = [
  { code: 'qwen3.8-max-0902', scenes: SCENES },
  { code: 'qwen3.8-max', scenes: SCENES },
  { code: 'qwen3.7-max', scenes: ['search'] },
  { code: 'qwen3.7-max-2026-05-20', scenes: ['search'] },
  { code: 'qwen3.7-plus-2026-05-26', scenes: SCENES },
  { code: 'qwen3.5-122b-a10b', scenes: ['search'] },
  { code: 'qwen3.7-plus', scenes: SCENES }
];

async function readDocument(db, key) {
  try {
    const result = await db.collection(COLLECTION).doc(key).get();
    return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
  } catch (error) {
    if (/DOCUMENT_NOT_FOUND|DOCUMENT_NOT_EXIST/.test(String(error.code || error.errCode)) ||
        /document.*not.*exist|document.*not.*found/i.test(error.message || error.errMsg || '')) return null;
    throw error;
  }
}

async function readModelState(db, key) {
  const document = await readDocument(db, key);
  if (!document || document.key || !document.data || document.data.key !== key) return document;
  // 事务修复此前被多包一层 data 的固定模型状态，不丢失并发写入的耗尽标记。
  return db.runTransaction(async transaction => {
    const current = await readDocument(transaction, key);
    if (!current || current.key || !current.data || current.data.key !== key) return current;
    const { _id, ...state } = current.data;
    await transaction.collection(COLLECTION).doc(key).set(state);
    return state;
  });
}

function defaultModelConfig() {
  return { configured: false, version: 0, enabled: false, pools: Object.fromEntries(SCENES.map(scene => [scene,
    MODEL_CATALOG.filter(model => model.scenes.includes(scene)).map(model => {
      const baseline = model.code === (scene === 'search' ? 'qwen3.5-122b-a10b' : 'qwen3.7-plus');
      return { model: model.code, enabled: baseline, verified: baseline };
    })])) };
}

function normalizeModelConfig(input) {
  if (!input || typeof input.enabled !== 'boolean' || !input.pools || typeof input.pools !== 'object') {
    fail('INVALID_INPUT', '模型配置格式无效');
  }
  const pools = {};
  for (const scene of SCENES) {
    const eligible = MODEL_CATALOG.filter(model => model.scenes.includes(scene)).map(model => model.code);
    const entries = input.pools[scene];
    if (!Array.isArray(entries) || entries.length !== eligible.length) fail('INVALID_INPUT', '模型名单不完整，请重新加载');
    const seen = new Set();
    pools[scene] = entries.map(entry => {
      if (!entry || !eligible.includes(entry.model) || seen.has(entry.model) ||
          typeof entry.enabled !== 'boolean' || typeof entry.verified !== 'boolean') {
        fail('INVALID_INPUT', '模型名单包含重复、不支持的模型或无效状态');
      }
      seen.add(entry.model);
      if (entry.enabled && !entry.verified) fail('INVALID_INPUT', '请先确认参与轮换的模型已验证业务效果');
      return { model: entry.model, enabled: entry.enabled, verified: entry.verified };
    });
  }
  return { enabled: input.enabled, pools };
}

async function readModelConfig(db) {
  const document = await readDocument(db, MODEL_CONFIG_KEY);
  if (!document) return defaultModelConfig();
  if (!Number.isSafeInteger(document.version) || document.version < 1) fail('CONFIG_MISSING', '模型配置版本无效');
  let config;
  try { config = normalizeModelConfig(document); }
  catch (_) { fail('CONFIG_MISSING', '模型配置无效，请管理员重新保存'); }
  return { ...config, configured: true, version: document.version, updatedAt: document.updatedAt || null };
}

async function saveModelConfig(db, input, openid) {
  const config = normalizeModelConfig(input);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail('INVALID_INPUT', '配置版本无效');
  return db.runTransaction(async transaction => {
    const current = await readModelConfig(transaction);
    if (current.version !== input.expectedVersion) fail('CONFIG_CONFLICT', '配置已被其他管理员更新，请重新加载后再保存');
    if (config.enabled) {
      // 保存管理员选择即可；额度查询和实际调用状态不决定配置能否持久保存。
      const selected = SCENES.flatMap(scene => config.pools[scene]).filter(entry => entry.enabled);
      if (!selected.length) fail('AI_CONFIG_NOT_READY', '请至少启用一个模型后再保存');
    }
    const version = current.version + 1;
    await transaction.collection(COLLECTION).doc(MODEL_CONFIG_KEY).set({
      key: MODEL_CONFIG_KEY, ...config, version, updatedAt: Date.now(), updatedBy: openid
    });
    return { ...config, configured: true, version };
  });
}

async function readModelQuota(db) {
  const document = await readDocument(db, MODEL_QUOTA_KEY);
  return document || { models: {}, checkedAt: 0, lastAttemptAt: 0, syncStatus: 'never', syncError: '' };
}

function expiresAt(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const value = Date.parse(date + 'T00:00:00+08:00');
  return Number.isFinite(value) && new Date(value + 28800000).toISOString().slice(0, 10) === date ? value : 0;
}

function quotaFresh(quota, now) {
  return Number.isSafeInteger(quota.checkedAt) && quota.checkedAt > 0 && quota.checkedAt <= now && now - quota.checkedAt < QUOTA_DISPLAY_MAX_AGE;
}

function eligibility(entry, state) {
  if (!entry.enabled) return '未加入轮换';
  if (!entry.verified) return '业务效果待验证';
  if (state && state.blocked) return '调用已确认免费额度不可用';
  return '';
}

function beijingEndpoint(env) {
  try {
    const url = new URL(env.BAILIAN_BASE_URL);
    // 北京同时支持旧共享域名、业务空间专属域名和试用域名，不能仅放行旧域名。
    const trustedHost = url.hostname === 'dashscope.aliyuncs.com' ||
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname);
    return url.protocol === 'https:' && trustedHost && !url.port &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname.replace(/\/+$/, '') === '/compatible-mode/v1';
  } catch (_) { return false; }
}

async function modelStates(db, models) {
  return Object.fromEntries(await Promise.all(models.map(async model => [model,
    await readModelState(db, 'ai_model_state_' + model)])));
}

async function markModelUnavailable(db, model, reason) {
  if (!MODEL_CATALOG.some(entry => entry.code === model) || reason !== 'FREE_QUOTA_EXHAUSTED') return;
  try {
    await db.collection(COLLECTION).doc('ai_model_state_' + model).set({
      key: 'ai_model_state_' + model, blocked: true, reason, blockedAt: Date.now()
    });
  } catch (_) { fail('MODEL_STATE_FAILED', '模型额度状态保存失败，请稍后重试'); }
}

async function recordModelSuccess(db, scene, model, reason = '') {
  try {
    const current = await readModelState(db, 'ai_model_runtime_' + scene);
    const changed = current && current.model !== model;
    await db.collection(COLLECTION).doc('ai_model_runtime_' + scene).set({
      key: 'ai_model_runtime_' + scene, model, lastUsedAt: Date.now(),
      switchReason: reason || (changed ? 'CONFIG_OR_ELIGIBILITY_CHANGED' : current && current.switchReason || ''),
      switchedAt: reason || changed ? Date.now() : current && current.switchedAt || 0
    });
    // 成功结果只记录场景状态，绝不清除并发请求写下的免费额度阻断。
  } catch (_) { fail('MODEL_STATE_FAILED', '模型运行状态保存失败，请稍后重试'); }
}

async function resolveModelPolicy(db, scene, env, required = true) {
  const legacy = getAiPolicy({ scene, env });
  const config = await readModelConfig(db);
  if (!config.configured) {
    const unavailableReason = legacy.available ? '' : 'LEGACY_POLICY_UNAVAILABLE';
    if (!legacy.available) {
      console.warn('[ai-model-policy]', JSON.stringify({ scene, managed: false, reason: unavailableReason,
        apiKeyConfigured: !!env.DASHSCOPE_API_KEY, endpointValid: beijingEndpoint(env) }));
      if (required) fail('AI_UNAVAILABLE', UNAVAILABLE_MESSAGES[unavailableReason]);
    }
    return { ...legacy, unavailableReason, unavailableMessage: UNAVAILABLE_MESSAGES[unavailableReason] || '' };
  }
  if (!SCENES.includes(scene)) fail('CONFIG_MISSING', '不支持的模型使用场景');
  // 业务调用只读取配置与接口确认的耗尽状态，不依赖管理员额度查询是否成功。
  const states = await modelStates(db, config.pools[scene].map(entry => entry.model));
  const candidates = config.pools[scene].filter(entry => !eligibility(entry, states[entry.model])).map(entry => entry.model);
  const endpointValid = beijingEndpoint(env);
  const unavailableReason = !config.enabled ? 'SERVICE_DISABLED' : !endpointValid ? 'ENDPOINT_INVALID' :
    !env.DASHSCOPE_API_KEY ? 'API_KEY_MISSING' : !candidates.length ? 'NO_ELIGIBLE_MODEL' : '';
  const policy = { ...legacy, managed: true, configVersion: config.version,
    available: config.enabled && endpointValid && !!env.DASHSCOPE_API_KEY && candidates.length > 0,
    unavailableReason, unavailableMessage: UNAVAILABLE_MESSAGES[unavailableReason] || '',
    primaryModel: candidates[0] || '', fallbackModel: candidates[1] || null, candidates,
    onModelError: async (model, reason) => {
      await markModelUnavailable(db, model, reason);
      if (reason === 'FREE_QUOTA_EXHAUSTED') policy.candidates = policy.candidates.filter(value => value !== model);
    },
    onModelSuccess: (model, reason) => recordModelSuccess(db, scene, model, reason) };
  if (!policy.available) {
    // 只记录固定原因、配置版本和布尔状态，不记录密钥、地址、用户输入或图片。
    console.warn('[ai-model-policy]', JSON.stringify({ scene, managed: true, reason: unavailableReason, configVersion: config.version,
      apiKeyConfigured: !!env.DASHSCOPE_API_KEY, endpointValid, candidateCount: candidates.length }));
    if (required) fail('AI_UNAVAILABLE', policy.unavailableMessage);
  }
  return policy;
}

async function getModelAdminView(db, env = process.env, now = Date.now()) {
  const [config, quota, states, searchRuntime, scanRuntime] = await Promise.all([
    readModelConfig(db), readModelQuota(db), modelStates(db, MODEL_CATALOG.map(entry => entry.code)),
    readModelState(db, 'ai_model_runtime_search'), readModelState(db, 'ai_model_runtime_scan')
  ]);
  const pools = Object.fromEntries(SCENES.map(scene => [scene, config.pools[scene].map(entry => ({
    ...entry, ...(quota.models || {})[entry.model],
    blocked: !!(states[entry.model] && states[entry.model].blocked),
    unavailableReason: eligibility(entry, states[entry.model])
  }))]));
  return { serverNow: now, config, pools, quota: {
    checkedAt: quota.checkedAt || 0, lastAttemptAt: quota.lastAttemptAt || 0,
    syncStatus: quota.syncStatus || 'never', syncError: quota.syncError || '', syncCode: quota.syncCode || '',
    syncing: quota.leaseUntil > now, fresh: quotaFresh(quota, now)
  }, runtime: { search: searchRuntime, scan: scanRuntime },
  predicted: Object.fromEntries(SCENES.map(scene => [scene, config.configured && config.enabled ?
    (pools[scene].find(entry => !entry.unavailableReason) || {}).model || '' : ''])),
  queryConfigured: !!env.BAILIAN_QUOTA_ACCESS_TOKEN,
  renewalConfigured: !!(env.BAILIAN_QUOTA_ACCESS_KEY_ID && env.BAILIAN_QUOTA_ACCESS_KEY_SECRET),
  endpointReady: beijingEndpoint(env), quotaMaxAgeMinutes: QUOTA_DISPLAY_MAX_AGE / 60000 };
}

module.exports = { MODEL_CATALOG, MODEL_CONFIG_KEY, MODEL_QUOTA_KEY, COLLECTION,
  readDocument, defaultModelConfig, normalizeModelConfig, readModelConfig, saveModelConfig,
  readModelQuota, expiresAt, resolveModelPolicy, getModelAdminView, markModelUnavailable, recordModelSuccess };
