'use strict';

const { randomUUID } = require('crypto');
const { fetchAuthorizedModels } = require('./modelDiscovery');
const { COLLECTION, MODEL_CATALOG_KEY, readModelCatalog } = require('./modelRegistry');

function documentData(document) { const { _id, ...data } = document; return data; }

async function syncModelCatalog(db, env = process.env, { force = false } = {}) {
  const startedAt = Date.now(); const lease = randomUUID();
  const claim = await db.runTransaction(async transaction => {
    const current = await readModelCatalog(transaction);
    if (current.leaseUntil > startedAt) return 'syncing';
    if (startedAt - (current.lastAttemptAt || 0) < (force ? 15000 : 300000)) return 'cached';
    await transaction.collection(COLLECTION).doc(MODEL_CATALOG_KEY).set({
      ...documentData(current), key: MODEL_CATALOG_KEY, lease, leaseUntil: startedAt + 12000,
      lastAttemptAt: startedAt, syncStatus: 'syncing', syncError: '', syncCode: '', syncDiagnostic: null
    });
    return 'claimed';
  });
  if (claim !== 'claimed') return { status: claim, refreshed: false,
    message: claim === 'syncing' ? '模型名单正在同步，请稍后刷新' : '已读取最近的模型名单' };
  let patch;
  try { patch = { ...await fetchAuthorizedModels(env), checkedAt: Date.now(), syncStatus: 'success', syncError: '', syncCode: '', syncDiagnostic: null }; }
  catch (error) {
    // 诊断仅含自有类别、字段名与模型编号，不保存响应原文、请求地址或凭证。
    const code = /^MODEL_LIST_/.test(error.code || '') ? error.code : 'MODEL_LIST_FAILED';
    const diagnostic = { ...(error.diagnostic || { reason: 'UNEXPECTED_ERROR' }), nodeVersion: process.versions.node };
    patch = { syncStatus: 'failed', syncError: /^MODEL_LIST_/.test(error.code || '')
      ? error.message : '模型名单同步失败，已保留上次成功名单', syncCode: code, syncDiagnostic: diagnostic };
    console.warn('[bailian-model-catalog]', JSON.stringify({ code, ...diagnostic }));
  }
  const saved = await db.runTransaction(async transaction => {
    const current = await readModelCatalog(transaction);
    if (current.lease !== lease) return false;
    await transaction.collection(COLLECTION).doc(MODEL_CATALOG_KEY).set({
      ...documentData(current), ...patch, lease: '', leaseUntil: 0
    });
    return true;
  });
  return { status: !saved ? 'superseded' : patch.syncStatus, refreshed: saved && patch.syncStatus === 'success',
    message: !saved ? '已有更新的同步任务，请重新加载' : patch.syncError || '模型名单已同步' };
}

module.exports = { syncModelCatalog };
