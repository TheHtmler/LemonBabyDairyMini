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
  ['babyUid', 'sessionId', 'operationId', 'comparisonVersion', 'expectedVersion', 'targetId', 'sourceSystemFoodId', 'sourceSystemPowderId', 'targetBasis', 'decisions', 'mixRatioDecision', 'form', 'useFormValues', 'identity'].forEach(key => { if (event[key] !== undefined) content[key] = event[key]; });
  return hash(JSON.stringify(canonical(content)));
}
async function beginConfirmation({ db, sessionId, operationId, payloadHash, now }) {
  const lease = crypto.randomBytes(16).toString('hex');
  return transaction(db, async tx => {
    const session = await getDocument(tx, SESSION_COLLECTION, sessionId);
    const previous = session && session.confirmation;
    if (!session || session.status === 'saved') fail('COMPARISON_STALE', '草稿已保存或不可用，请查询保存状态');
    if (previous && previous.operationId === operationId && previous.requestHash !== payloadHash) fail('REQUEST_CONFLICT', '同一保存请求不能更改内容');
    if (previous && previous.operationId === operationId && previous.state === 'failed') fail('REQUEST_CONFLICT', '该保存请求已终止，请重新核对后提交');
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
  const status = await transaction(db, async tx => {
    const session = await getDocument(tx, SESSION_COLLECTION, sessionId);
    if (!session) return null;
    if (session.ownerOpenid !== openid || session.babyUid !== babyUid) fail('FORBIDDEN', '无法访问该保存记录');
    const receipt = session.confirmation;
    if (session.status === 'saved' && session.operationId === operationId) return { ok: true, state: 'saved', savedResult: session.savedResult };
    if (!receipt) {
      // 请求可能还停在校验阶段；先封存此编号，防止恢复结束后旧请求才领取保存资格。
      await tx.collection(SESSION_COLLECTION).doc(sessionId).update({ confirmation: { operationId, requestHash: '', state: 'failed', code: 'SAVE_FAILED', lease: '', leaseUntil: 0 } });
      return { ok: true, state: 'not_submitted' };
    }
    if (receipt.operationId !== operationId) return { ok: true, state: 'failed', code: 'REQUEST_CONFLICT' };
    if (receipt.state === 'processing' && receipt.leaseUntil <= now) {
      // 终结与保存共用事务文档；迟到的保存必须重新检查 processing 状态，不能继续提交。
      await tx.collection(SESSION_COLLECTION).doc(sessionId).update({ confirmation: { ...receipt, state: 'failed', code: 'SAVE_FAILED', leaseUntil: 0 } });
      return { ok: true, state: 'failed', code: 'SAVE_FAILED' };
    }
    return { ok: true, state: receipt.state, code: receipt.code || '' };
  });
  if (status) return status;
  // 回执已清理时从最终业务记录找回结果；草稿不存在也阻止了旧事务继续写入。
  const foods = await db.collection('food_catalog').where({ babyUid, 'recognitionMeta.sessionId': sessionId,
    'recognitionMeta.confirmedBy': openid }).limit(1).get();
  const food = (foods.data || [])[0];
  if (food) return { ok: true, state: 'saved', savedResult: { targetType: 'food', itemId: food._id, version: food.version } };
  const profiles = await db.collection('milk_nutrition_profiles').where({ babyUid }).get();
  for (const profile of profiles.data || []) {
    const powder = (profile.formulaPowders || []).find(item => (item.recognitionMeta || {}).sessionId === sessionId && item.recognitionMeta.confirmedBy === openid);
    if (powder) return { ok: true, state: 'saved', savedResult: { targetType: 'powder', itemId: powder.id, profileId: profile._id, version: profile.version } };
  }
  return { ok: true, state: 'failed', code: 'SESSION_EXPIRED' };
}
module.exports = { requestHash, beginConfirmation, markConfirmationFailed, getConfirmationStatus };
