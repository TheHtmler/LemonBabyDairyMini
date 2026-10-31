'use strict';
const crypto = require('crypto');
const { fail } = require('./policy');
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function get(db, collection, id) {
  try { const r = await db.collection(collection).doc(id).get(); return Array.isArray(r.data) ? r.data[0] || null : r.data || null; }
  catch (e) { if (/DOCUMENT_NOT_FOUND|DOCUMENT_NOT_EXIST/.test(String(e.code)) || /document.*not.*exist|document.*not.*found/i.test(e.message || '')) return null; throw e; }
}
async function transact(db, action) { return db.runTransaction(action); }
function dayKey(now) { return new Date(now + 28800000).toISOString().slice(0, 10); }
async function reserveInvocation({ db, openid, babyUid, scene, requestId, requestHash, now = Date.now(), dailyLimit, reusedResult }) {
  if (!openid || !babyUid || !['search', 'scan'].includes(scene) || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) fail('INVALID_INPUT', '请求编号无效');
  const id = hash([openid, babyUid, scene, requestId]); const counterId = hash([openid, scene, dayKey(now)]);
  return transact(db, async tx => {
    const existing = await get(tx, 'ai_search_requests', id);
    if (existing) {
      if (existing.requestHash !== requestHash) fail('REQUEST_CONFLICT', '同一请求编号不能用于不同内容');
      if (existing.state === 'complete') return { state: 'cached', id, result: existing.result };
      if (existing.state === 'failed') fail(existing.failureCode || 'AI_UNAVAILABLE', '上次智能请求未完成，请修改条件或主动重试');
      fail(existing.leaseUntil > now ? 'AI_RUNNING' : 'AI_UNKNOWN', existing.leaseUntil > now ? '智能请求正在处理，请稍后查看' : '上次请求结果暂不可确认，请主动重试');
    }
    // 仅搜索服务可传入已校验的短期意图；仍先核对请求幂等，不重复扣模型调用次数。
    if (scene === 'search' && reusedResult) {
      await tx.collection('ai_search_requests').doc(id).set({ ownerOpenid: openid, babyUid, scene, requestHash, counterId,
        state: 'complete', result: reusedResult, dispatched: false, usage: [], leaseUntil: 0,
        createdAt: new Date(now), expiresAt: new Date(now + 86400000) });
      return { state: 'reused', id, result: reusedResult };
    }
    const counter = await get(tx, 'ai_usage_counters', counterId); const count = Number(counter && counter.count) || 0;
    if (count >= dailyLimit) fail('DAILY_LIMIT', '今日智能调用次数已用完，可使用普通查询或手动录入');
    await tx.collection('ai_usage_counters').doc(counterId).set({ ownerOpenid: openid, scene, date: dayKey(now), count: count + 1, expiresAt: new Date(now + 7 * 86400000) });
    await tx.collection('ai_search_requests').doc(id).set({ ownerOpenid: openid, babyUid, scene, requestHash, counterId,
      state: 'running', dispatched: false, leaseUntil: now + 60000, createdAt: new Date(now), expiresAt: new Date(now + 86400000) });
    return { state: 'reserved', id, counterId };
  });
}
async function markDispatched(db, reservation) { await db.collection('ai_search_requests').doc(reservation.id).update({ dispatched: true }); }
async function completeInvocation({ db, reservation, result, error, dispatched = true, usage = null }) {
  return transact(db, async tx => {
    const current = await get(tx, 'ai_search_requests', reservation.id);
    if (!current || current.state !== 'running') return;
    if (!dispatched && !current.dispatched) {
      const counter = await get(tx, 'ai_usage_counters', current.counterId);
      if (counter) await tx.collection('ai_usage_counters').doc(current.counterId).update({ count: Math.max(0, counter.count - 1) });
    }
    await tx.collection('ai_search_requests').doc(reservation.id).update({ state: error ? 'failed' : 'complete', result: error ? null : result,
      failureCode: error && error.code || '', usage, dispatched: dispatched || current.dispatched, leaseUntil: 0 });
  });
}
async function usageStatus(db, openid, scene, limit, now = Date.now()) {
  const counter = await get(db, 'ai_usage_counters', hash([openid, scene, dayKey(now)]));
  const used = Number(counter && counter.count) || 0; return { available: used < limit, remaining: Math.max(0, limit - used) };
}
module.exports = { reserveInvocation, markDispatched, completeInvocation, usageStatus };
