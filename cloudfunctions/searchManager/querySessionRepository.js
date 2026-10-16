'use strict';
const crypto = require('crypto');
const { fail } = require('./lib/search');
const { hash, getDocument, transaction } = require('./access');
const COLLECTION = 'search_query_sessions';
async function beginPage(db, cursor, initial, now) {
  const lease = crypto.randomBytes(16).toString('hex');
  return transaction(db, async tx => {
    let state = await getDocument(tx, COLLECTION, cursor.id);
    if (!state) {
      if (!initial) fail('STALE_CURSOR', '搜索已过期，请重新搜索');
      state = initial;
    }
    if (state.owner !== cursor.owner || state.queryHash !== cursor.queryHash || new Date(state.expiresAt).getTime() <= now) fail('STALE_CURSOR', '搜索已过期，请重新搜索');
    if (cursor.page < state.nextPage) {
      const receipt = await getDocument(tx, COLLECTION, hash([cursor.id, 'page', cursor.page]));
      if (!receipt) fail('STALE_CURSOR', '搜索页已过期，请重新搜索');
      return { cached: receipt.result };
    }
    if (cursor.page !== state.nextPage) fail('INVALID_CURSOR', '搜索页顺序无效');
    if (state.leaseUntil > now) fail('SEARCH_BUSY', '正在查找，请稍后继续');
    state.lease = lease; state.leaseUntil = now + 60000;
    const { _id, ...data } = state;
    await tx.collection(COLLECTION).doc(cursor.id).set(data);
    return { state: data, lease };
  });
}
async function saveCandidate(db, sessionId, candidate, rank, expiresAt) {
  const id = hash([sessionId, 'candidate', candidate.id]);
  // 确定性 ID 使崩溃后的重新扫描不会新增重复候选；不覆盖已提交的页。
  const existing = await getDocument(db, COLLECTION, id);
  if (existing && existing.emitted) return;
  await db.collection(COLLECTION).doc(id).set({ kind: 'candidate', sessionId, ref: candidate.ref,
    date: candidate.date, time: candidate.time, name: candidate.name, rank, stableId: candidate.id,
    emitted: false, expiresAt: new Date(expiresAt) });
}
async function pendingCandidates(db, state, history, limit, unavailable = new Set()) {
  const positions = Object.entries(state.positions).filter(([source]) => !unavailable.has(source)).map(([, position]) => position);
  const unfinished = positions.filter(x => !x.exhausted);
  if (history && unfinished.some(x => !x.frontier)) return [];
  const barrier = unfinished.map(x => x.frontier).sort().pop();
  const where = { kind: 'candidate', sessionId: state.sessionId, emitted: false };
  if (history && barrier) where.date = db.command.gt(barrier);
  let query = db.collection(COLLECTION).where(where);
  query = history ? query.orderBy('date', 'desc').orderBy('time', 'desc') : query.orderBy('rank', 'asc').orderBy('name', 'asc');
  return (await query.orderBy('stableId', 'asc').limit(limit).get()).data || [];
}
async function finishPage(db, cursor, state, rows, result, lease) {
  return transaction(db, async tx => {
    const current = await getDocument(tx, COLLECTION, cursor.id);
    if (!current || current.lease !== lease || current.nextPage !== cursor.page) fail('SEARCH_BUSY', '查询状态已更新，请重试当前页');
    for (const row of rows) await tx.collection(COLLECTION).doc(row._id).update({ emitted: true });
    await tx.collection(COLLECTION).doc(hash([cursor.id, 'page', cursor.page])).set({ kind: 'page', sessionId: cursor.id, expiresAt: new Date(state.expiresAt), result });
    await tx.collection(COLLECTION).doc(cursor.id).set({ ...state, lease: '', leaseUntil: 0, nextPage: cursor.page + 1 });
    return result;
  });
}
module.exports = { COLLECTION, beginPage, saveCandidate, pendingCandidates, finishPage };
