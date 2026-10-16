'use strict';
const crypto = require('crypto');
const { fail } = require('./lib/core/contracts');
const { hash, assertAccess, getDocument, transaction, SESSION_COLLECTION } = require('./lib/core/server');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function requestHash(event) {
  const content = {};
  ['babyUid', 'sessionId', 'operationId', 'comparisonVersion', 'expectedVersion', 'targetId', 'sourceSystemFoodId', 'sourceSystemPowderId', 'targetBasis', 'decisions', 'mixRatioDecision', 'form'].forEach(key => { if (event[key] !== undefined) content[key] = event[key]; });
  return hash(JSON.stringify(canonical(content)));
}
async function beginConfirmation({ db, sessionId, operationId, payloadHash, now }) {
  const lease = crypto.randomBytes(16).toString('hex');
  return transaction(db, async tx => {
    const session = await getDocument(tx, SESSION_COLLECTION, sessionId);
    const previous = session && session.confirmation;
    if (!session || session.status === 'saved') fail('COMPARISON_STALE', '草稿已保存或不可用，请查询保存状态');
    if (previous && previous.operationId === operationId && previous.requestHash !== payloadHash) fail('REQUEST_CONFLICT', '同一保存请求不能更改内容');
    if (previous && previous.state === 'processing' && (previous.leaseUntil > now || previous.operationId !== operationId)) fail('SAVE_PROCESSING', '上次保存结果尚未确定，请先恢复保存状态');
    await tx.collection(SESSION_COLLECTION).doc(sessionId).update({ confirmation: { operationId, requestHash: payloadHash, state: 'processing', lease, leaseUntil: now + 60000 }, receiptExpiresAt: new Date(now + 30 * 86400000) });
    return { lease };
  });
}
async function markConfirmationFailed(db, sessionId, operationId, lease, code) {
  return transaction(db, async tx => {
    const session = await getDocument(tx, SESSION_COLLECTION, sessionId); const receipt = session && session.confirmation;
    if (!receipt || receipt.lease !== lease || receipt.operationId !== operationId || session.status === 'saved') return;
    await tx.collection(SESSION_COLLECTION).doc(sessionId).update({ confirmation: { ...receipt, state: 'failed', code, leaseUntil: 0 } });
  });
}
async function getConfirmationStatus({ db, openid, babyUid, sessionId, operationId, now }) {
  await assertAccess(db, openid, babyUid);
  if (!/^[a-f0-9]{64}$/.test(sessionId || '') || !/^[A-Za-z0-9_-]{8,100}$/.test(operationId || '')) fail('INVALID_INPUT', '保存状态编号无效');
  const session = await getDocument(db, SESSION_COLLECTION, sessionId);
  if (!session) return { ok: true, state: 'unknown' };
  if (session.ownerOpenid !== openid || session.babyUid !== babyUid) fail('FORBIDDEN', '无法访问该保存记录');
  const receipt = session.confirmation;
  if (session.receiptExpiresAt && new Date(session.receiptExpiresAt).getTime() <= now) return { ok: true, state: 'unknown' };
  if (session.status === 'saved' && session.operationId === operationId) return { ok: true, state: 'saved', savedResult: session.savedResult };
  if (!receipt) return { ok: true, state: new Date(session.expiresAt).getTime() > now ? 'not_submitted' : 'unknown' };
  if (receipt.operationId !== operationId) return { ok: true, state: 'unknown' };
  return { ok: true, state: receipt.state === 'processing' && receipt.leaseUntil <= now ? 'unknown' : receipt.state, code: receipt.code || '' };
}
module.exports = { requestHash, beginConfirmation, markConfirmationFailed, getConfirmationStatus };
