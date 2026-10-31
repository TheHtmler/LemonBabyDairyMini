'use strict';

const { randomUUID } = require('crypto');
const { MODEL_CATALOG, MODEL_QUOTA_KEY, COLLECTION, readModelQuota, expiresAt } = require('./modelRegistry');
const { queryDiagnostic, diagnosticMessage } = require('./quotaDiagnostics');
const { queryBailianQuota } = require('./bailianQuotaGateway');
const SYNC_MESSAGES = {
  QUERY_NOT_CONFIGURED: '云端缺少百炼查询授权，请配置 BAILIAN_QUOTA_ACCESS_TOKEN；本机 CLI 登录不能代替云端授权',
  QUERY_CREDENTIAL_INCOMPLETE: '云端续期凭证不完整，请成对配置 BAILIAN_QUOTA_ACCESS_KEY_ID 和 BAILIAN_QUOTA_ACCESS_KEY_SECRET',
  QUERY_TOKEN_FORMAT: '查询令牌格式不正确，请填写原始令牌，不加 Bearer 前缀、引号或换行',
  QUERY_AUTH_FAILED: '百炼额度查询授权已失效或权限不足，请更新云端授权',
  QUERY_NETWORK_FAILED: '云端无法连接百炼额度接口，请检查云函数外网访问、DNS 或证书配置',
  QUERY_GATEWAY_FAILED: '百炼额度网关拒绝了查询，请结合诊断码检查账号访问权限或网关状态',
  QUERY_OUTPUT_LIMIT: '百炼额度接口返回内容超过限制，已保留上次成功数据',
  QUERY_INVALID_RESULT: '百炼额度查询返回格式无效，已保留上次成功数据',
  QUERY_TIMEOUT: '百炼额度查询超时，已保留上次成功数据',
  QUERY_FAILED: '百炼额度查询失败，已保留上次成功数据'
};

function queryError(code, diagnostic) {
  return Object.assign(new Error(SYNC_MESSAGES[code]), { code, ...(diagnostic ? { diagnostic } : {}) });
}

function normalizeQuotaRows(rows) {
  if (!Array.isArray(rows) || rows.length > MODEL_CATALOG.length) throw queryError('QUERY_INVALID_RESULT');
  const models = {};
  for (const row of rows) {
    if (!row || !MODEL_CATALOG.some(model => model.code === row.model) || models[row.model] ||
        !Number.isSafeInteger(row.remaining) || row.remaining < 0 || !Number.isSafeInteger(row.total) ||
        row.total < row.remaining || !expiresAt(row.expires) || typeof row.autoStop !== 'boolean') {
      throw queryError('QUERY_INVALID_RESULT');
    }
    models[row.model] = { remaining: row.remaining, total: row.total, expires: row.expires, autoStop: row.autoStop };
  }
  return models;
}

async function queryFreeQuota(env) {
  try {
    const rows = await queryBailianQuota(env, MODEL_CATALOG.map(model => model.code));
    return normalizeQuotaRows(rows);
  } catch (error) {
    const stage = error.stage || 'response';
    if (Object.prototype.hasOwnProperty.call(SYNC_MESSAGES, error.code)) {
      error.diagnostic = { stage, nodeVersion: process.versions.node, adapter: 'https-v1', reason: error.reason || error.code,
        ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) };
      error.message = SYNC_MESSAGES[error.code];
      throw error;
    }
    const failure = queryDiagnostic(error, stage);
    throw queryError(failure.code, failure.diagnostic);
  }
}

function cleanDocument(document) { const { _id, ...data } = document; return data; }

async function finishSync(db, lease, patch) {
  return db.runTransaction(async transaction => {
    const current = await readModelQuota(transaction);
    if (current.lease !== lease) return false;
    await transaction.collection(COLLECTION).doc(MODEL_QUOTA_KEY).set({
      ...cleanDocument(current), ...patch, lease: '', leaseUntil: 0
    });
    return true;
  });
}

async function syncModelQuota(db, env = process.env, { force = false } = {}) {
  const startedAt = Date.now();
  const lease = randomUUID();
  const claim = await db.runTransaction(async transaction => {
    const current = await readModelQuota(transaction);
    if (current.leaseUntil > startedAt) return 'syncing';
    if (current.checkedAt > 0 && startedAt - current.checkedAt < (force ? 60000 : 300000)) return 'cached';
    await transaction.collection(COLLECTION).doc(MODEL_QUOTA_KEY).set({
      ...cleanDocument(current), key: MODEL_QUOTA_KEY, lease, leaseUntil: startedAt + 45000,
      lastAttemptAt: startedAt, syncStatus: 'syncing', syncError: '', syncCode: '', syncDiagnostic: null
    });
    return 'claimed';
  });
  if (claim !== 'claimed') return { refreshed: false, status: claim,
    message: claim === 'syncing' ? '额度正在同步，请稍后刷新状态' : '已使用最近同步结果，请稍后再刷新' };
  let models;
  try { models = await queryFreeQuota(env); }
  catch (error) {
    const code = Object.prototype.hasOwnProperty.call(SYNC_MESSAGES, error.code) ? error.code : 'QUERY_FAILED';
    const diagnostic = error.diagnostic || { stage: 'query', nodeVersion: process.versions.node, reason: code };
    const message = diagnosticMessage(SYNC_MESSAGES[code], diagnostic);
    console.warn('[bailian-quota]', JSON.stringify({ code, ...diagnostic }));
    await finishSync(db, lease, { syncStatus: code === 'QUERY_NOT_CONFIGURED' ? 'not_configured' : 'failed',
      syncError: message, syncCode: code, syncDiagnostic: diagnostic });
    return { refreshed: false, status: code, message };
  }
  const saved = await finishSync(db, lease, { models, checkedAt: Date.now(), syncStatus: 'success', syncError: '', syncCode: '', syncDiagnostic: null });
  return { refreshed: saved, status: saved ? 'success' : 'superseded',
    message: saved ? '额度已同步' : '已有更新的同步任务，请重新加载状态' };
}

module.exports = { queryFreeQuota, normalizeQuotaRows, syncModelQuota };
