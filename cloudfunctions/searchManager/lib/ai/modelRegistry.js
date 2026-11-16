'use strict';

const { fail, getAiPolicy } = require('./policy');
const { validModelCode, beijingEndpoint } = require('./modelDiscovery');
const { MODEL_QUOTA_EXHAUSTED_MESSAGE } = require('./recognitionErrors');
const COLLECTION = 'feature_flags';
const MODEL_CONFIG_KEY = 'ai_model_config';
const MODEL_QUOTA_KEY = 'ai_model_quota';
const MODEL_CATALOG_KEY = 'ai_model_catalog';
// 仅用于提示额度展示数据的新旧程度，不作为模型调用或配置保存的有效期。
const QUOTA_DISPLAY_MAX_AGE = 15 * 60 * 1000;
const SCENES = ['search', 'scan', 'report'];
const UNAVAILABLE_MESSAGES = {
  SERVICE_DISABLED: 'AI服务已关闭，请管理员启用后重试',
  ENDPOINT_INVALID: '模型接口地址未通过北京接入校验，请管理员核对配置',
  API_KEY_MISSING: '模型调用密钥尚未配置，请管理员检查配置',
  NO_ELIGIBLE_MODEL: '当前场景暂无可调用模型，请检查启用名单或切换未耗尽的模型',
  FREE_QUOTA_EXHAUSTED: MODEL_QUOTA_EXHAUSTED_MESSAGE,
  LEGACY_POLICY_UNAVAILABLE: '模型配置尚未就绪，请管理员检查配置或云函数部署'
};

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

async function readModelCatalog(db) {
  const document = await readDocument(db, MODEL_CATALOG_KEY);
  if (!document) return { models: [], checkedAt: 0, syncStatus: 'never', syncError: '' };
  if (!Array.isArray(document.models) || document.models.length > 2000 || document.models.some(model =>
    !model || !validModelCode(model.code) || !Array.isArray(model.scenes) || model.scenes.some(scene => !SCENES.includes(scene)))) {
    fail('CONFIG_MISSING', '缓存模型名单格式无效，请重新同步');
  }
  return document;
}

function defaultModelConfig(catalog = { models: [] }) {
  return { configured: false, version: 0, enabled: false, pools: Object.fromEntries(SCENES.map(scene => [scene,
    catalog.models.filter(model => model.scenes.includes(scene)).map(model =>
      ({ model: model.code, enabled: false, verified: false }))])) };
}

function normalizeModelConfig(input, catalog = { models: [] }, previous = null) {
  if (!input || typeof input.enabled !== 'boolean' || !input.pools || typeof input.pools !== 'object') {
    fail('INVALID_INPUT', '模型配置格式无效');
  }
  const pools = {};
  for (const scene of SCENES) {
    const eligible = catalog.models.filter(model => model.scenes.includes(scene)).map(model => model.code);
    const previousEntries = new Map((previous?.pools[scene] || []).map(entry => [entry.model, entry]));
    const allowed = new Set([...eligible, ...previousEntries.keys()]);
    const entries = input.pools[scene];
    if (!Array.isArray(entries) || entries.length > 2000) fail('INVALID_INPUT', '模型名单格式无效，请重新加载');
    const seen = new Set();
    pools[scene] = entries.map(entry => {
      if (!entry || !validModelCode(entry.model) || !allowed.has(entry.model) || seen.has(entry.model) ||
          typeof entry.enabled !== 'boolean' || typeof entry.verified !== 'boolean') {
        fail('INVALID_INPUT', '模型名单包含重复、不支持的模型或无效状态');
      }
      seen.add(entry.model);
      if (entry.enabled && !entry.verified) fail('INVALID_INPUT', '请先确认参与轮换的模型已验证业务效果');
      const autoDisabled = !entry.enabled && previousEntries.get(entry.model)?.disabledReason === 'FREE_QUOTA_EXHAUSTED';
      return { model: entry.model, enabled: entry.enabled, verified: entry.verified,
        ...(autoDisabled ? { disabledReason: 'FREE_QUOTA_EXHAUSTED' } : {}) };
    });
    // 页面保存期间发现的新模型只补齐为停用，不能覆盖管理员已有选择和排序。
    for (const model of eligible) if (!seen.has(model)) pools[scene].push({ model, enabled: false, verified: false });
  }
  return { enabled: input.enabled, pools };
}

async function readModelConfig(db, catalog) {
  catalog = catalog || await readModelCatalog(db);
  const document = await readDocument(db, MODEL_CONFIG_KEY);
  if (!document) return decorateConfig(defaultModelConfig(catalog), catalog);
  if (!Number.isSafeInteger(document.version) || document.version < 1) fail('CONFIG_MISSING', '模型配置版本无效');
  let config;
  try {
    // 已保存的旧名单是迁移依据；新目录只补齐停用行，不自动改写数据库。
    config = normalizeModelConfig({ ...document,
      pools: { ...document.pools, report: document.pools?.report ?? [] } }, catalog, document);
  }
  catch (_) { fail('CONFIG_MISSING', '模型配置无效，请管理员重新保存'); }
  return decorateConfig({ ...config, configured: true, version: document.version, updatedAt: document.updatedAt || null }, catalog);
}

function decorateConfig(config, catalog) {
  const metadata = new Map(catalog.models.map(model => [model.code, model]));
  return { ...config, pools: Object.fromEntries(SCENES.map(scene => [scene, config.pools[scene].map(entry => {
    const model = metadata.get(entry.model);
    return { ...entry, name: model?.name || entry.model,
      authorized: !catalog.checkedAt || !!model?.scenes.includes(scene), maxOutputTokens: model?.maxOutputTokens || null };
  })])) };
}

async function saveModelConfig(db, input, openid) {
  if (!input) fail('INVALID_INPUT', '模型配置格式无效');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) fail('INVALID_INPUT', '配置版本无效');
  return db.runTransaction(async transaction => {
    const catalog = await readModelCatalog(transaction);
    const current = await readModelConfig(transaction, catalog);
    const config = normalizeModelConfig(input, catalog, current);
    if (current.version !== input.expectedVersion) fail('CONFIG_CONFLICT', '配置已被其他管理员更新，请重新加载后再保存');
    const selected = [...new Set(SCENES.flatMap(scene => config.pools[scene]).filter(entry => entry.enabled).map(entry => entry.model))];
    if ((await blockedModelCodes(transaction, selected)).length) {
      fail('AI_CONFIG_NOT_READY', '所选模型已确认免费额度不可用，请重新加载后启用其他模型');
    }
    if (config.enabled) {
      // 额度查询不影响保存；明确耗尽的模型不能通过旧草稿再次启用。
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
  if (entry.authorized === false) return '该模型已撤销授权或不支持当前场景';
  if (!entry.enabled) return '未加入轮换';
  if (!entry.verified) return '业务效果待验证';
  if (state && state.blocked) return '调用已确认免费额度不可用';
  return '';
}

async function modelStates(db, models) {
  return Object.fromEntries(await Promise.all(models.map(async model => [model,
    await readModelState(db, 'ai_model_state_' + model)])));
}

async function blockedModelCodes(db, models) {
  const states = await Promise.all(models.map(async model => {
    const key = 'ai_model_state_' + model;
    const document = await readDocument(db, key);
    const state = document && !document.key && document.data?.key === key ? document.data : document;
    return state?.blocked === true ? model : null;
  }));
  return states.filter(Boolean);
}

async function deactivateExhaustedModels(db, models, recordFailure = false) {
  if (!models.length) return;
  await db.runTransaction(async transaction => {
    const document = await readDocument(transaction, MODEL_CONFIG_KEY);
    const blocked = new Set(recordFailure ? models : await blockedModelCodes(transaction, models));
    const pools = { ...document?.pools }; let changed = false;
    for (const scene of SCENES) {
      if (!Array.isArray(pools[scene])) continue;
      pools[scene] = pools[scene].map(entry => {
        if (!entry.enabled || !blocked.has(entry.model)) return entry;
        changed = true; return { ...entry, enabled: false, disabledReason: 'FREE_QUOTA_EXHAUSTED' };
      });
    }
    if (recordFailure) {
      for (const model of blocked) await transaction.collection(COLLECTION).doc('ai_model_state_' + model).set({
        key: 'ai_model_state_' + model, blocked: true, reason: 'FREE_QUOTA_EXHAUSTED', blockedAt: Date.now()
      });
    }
    if (changed && Number.isSafeInteger(document.version) && document.version >= 1) {
      const { _id, ...data } = document;
      await transaction.collection(COLLECTION).doc(MODEL_CONFIG_KEY).set({ ...data, pools,
        version: document.version + 1, updatedAt: Date.now(), updatedBy: 'system', updateReason: 'FREE_QUOTA_EXHAUSTED' });
    }
  });
}

async function markModelUnavailable(db, model, reason) {
  if (!validModelCode(model) || reason !== 'FREE_QUOTA_EXHAUSTED') return;
  try {
    // 仅按调用明确确认的耗尽状态自动停用；查询失败或未知额度不能关闭模型。
    await deactivateExhaustedModels(db, [model], true);
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
  // 只查询参与轮换或因耗尽自动停用的模型，保留自动停用后的明确额度提示。
  const selected = config.pools[scene].filter(entry => entry.enabled && entry.verified && entry.authorized !== false);
  const checked = config.pools[scene].filter(entry => entry.verified && entry.authorized !== false &&
    (entry.enabled || entry.disabledReason === 'FREE_QUOTA_EXHAUSTED'));
  const states = await modelStates(db, checked.map(entry => entry.model));
  const candidates = selected.filter(entry => !eligibility(entry, states[entry.model])).map(entry => entry.model);
  const recognitionQuotaExhausted = scene !== 'search' && checked.length > 0
    && checked.every(entry => states[entry.model]?.blocked === true);
  const endpointValid = beijingEndpoint(env);
  const unavailableReason = !config.enabled ? 'SERVICE_DISABLED' : !endpointValid ? 'ENDPOINT_INVALID' :
    !env.DASHSCOPE_API_KEY ? 'API_KEY_MISSING' : !candidates.length
      ? recognitionQuotaExhausted ? 'FREE_QUOTA_EXHAUSTED' : 'NO_ELIGIBLE_MODEL' : '';
  const policy = { ...legacy, managed: true, configVersion: config.version,
    modelOptions: Object.fromEntries(config.pools[scene].map(entry => [entry.model, { maxOutputTokens: entry.maxOutputTokens }])),
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
    if (required) fail(unavailableReason === 'FREE_QUOTA_EXHAUSTED' ? unavailableReason : 'AI_UNAVAILABLE', policy.unavailableMessage);
  }
  return policy;
}

async function getModelAdminView(db, env = process.env, now = Date.now()) {
  const catalog = await readModelCatalog(db);
  let config = await readModelConfig(db, catalog);
  const codes = [...new Set(SCENES.flatMap(scene => config.pools[scene].map(entry => entry.model)))];
  const [quota, states, searchRuntime, scanRuntime, reportRuntime] = await Promise.all([
    readModelQuota(db), modelStates(db, codes),
    readModelState(db, 'ai_model_runtime_search'), readModelState(db, 'ai_model_runtime_scan'),
    readModelState(db, 'ai_model_runtime_report')
  ]);
  if (SCENES.some(scene => config.pools[scene].some(entry => entry.enabled && states[entry.model]?.blocked))) {
    // 补齐旧版本只记录 blocked、尚未关闭配置开关的耗尽模型，不等待它再次被调用。
    await deactivateExhaustedModels(db, codes.filter(model => states[model]?.blocked));
    config = await readModelConfig(db, catalog);
  }
  const pools = Object.fromEntries(SCENES.map(scene => [scene, config.pools[scene].map(entry => ({
    ...entry, ...(quota.models || {})[entry.model],
    blocked: !!(states[entry.model] && states[entry.model].blocked),
    unavailableReason: eligibility(entry, states[entry.model])
  }))]));
  return { serverNow: now, config, pools, catalog: {
    checkedAt: catalog.checkedAt || 0, syncStatus: catalog.syncStatus, syncError: catalog.syncError || '',
    syncing: catalog.leaseUntil > now, count: catalog.models.length
  }, quota: {
    checkedAt: quota.checkedAt || 0, lastAttemptAt: quota.lastAttemptAt || 0,
    syncStatus: quota.syncStatus || 'never', syncError: quota.syncError || '', syncCode: quota.syncCode || '',
    syncing: quota.leaseUntil > now, fresh: quotaFresh(quota, now)
  }, runtime: { search: searchRuntime, scan: scanRuntime, report: reportRuntime },
  predicted: Object.fromEntries(SCENES.map(scene => [scene, config.configured && config.enabled ?
    (pools[scene].find(entry => !entry.unavailableReason) || {}).model || '' : ''])),
  queryConfigured: !!env.BAILIAN_QUOTA_ACCESS_TOKEN,
  renewalConfigured: !!(env.BAILIAN_QUOTA_ACCESS_KEY_ID && env.BAILIAN_QUOTA_ACCESS_KEY_SECRET),
  endpointReady: beijingEndpoint(env), quotaMaxAgeMinutes: QUOTA_DISPLAY_MAX_AGE / 60000 };
}

module.exports = { MODEL_CATALOG_KEY, MODEL_CONFIG_KEY, MODEL_QUOTA_KEY, COLLECTION,
  readModelCatalog,
  readDocument, defaultModelConfig, normalizeModelConfig, readModelConfig, saveModelConfig,
  readModelQuota, expiresAt, resolveModelPolicy, getModelAdminView, markModelUnavailable, recordModelSuccess, beijingEndpoint };
