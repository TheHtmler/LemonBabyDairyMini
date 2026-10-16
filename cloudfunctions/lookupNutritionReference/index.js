'use strict';
const { fail, identity, number } = require('./lib/core/contracts');
const { matchReferenceCandidates, identityMatches, compareNutrition } = require('./lib/core/reference');
const { runtime, ownedSession, getDocument, transaction, publicFailure, SESSION_COLLECTION } = require('./lib/core/server');
const { findReferences } = require('./referenceRepository');

function createReferenceHandler({ db, context, now = Date.now, search = findReferences }) {
  return async (event = {}) => {
    try {
      const session = await ownedSession(db, context.OPENID, event.babyUid, event.sessionId, now());
      if (!session.observation || session.status === 'saved' || !['food_label', 'food_object', 'powder_label'].includes(session.mode) || session.confirmation && session.confirmation.state === 'processing') fail('INVALID_INPUT', '草稿尚未完成类型核对或正在保存');
      const wanted = identity(event.identity || (session.observation.identityCandidates || [])[0]);
      if (!wanted.name) fail('INVALID_INPUT', '请先确认食物名称');
      const inputBasis = event.targetBasis || session.observation.basis;
      const basis = session.mode === 'powder_label' ? { quantity: 100, unit: 'g', material: 'dry_powder' } :
        { quantity: number(inputBasis.quantity), unit: inputBasis.unit, material: 'food' };
      if (!(basis.quantity > 0) || !['g', 'ml', 'portion'].includes(basis.unit)) fail('VALIDATION_FAILED', '请先确认营养计量基准');
      let candidates; let reference = null; let status;
      if (event.action === 'search') {
        let records; let unavailable = false;
        try { records = await search(db, wanted); }
        catch (_) { records = []; unavailable = true; }
        const matched = matchReferenceCandidates(wanted, records);
        candidates = matched.candidates; status = unavailable ? 'unavailable' : matched.status;
        if (status === 'matched') reference = candidates.find(x => x.referenceId === matched.exactIds[0]);
      } else if (event.action === 'select') {
        candidates = session.referenceCandidates || [];
        reference = candidates.find(x => x.referenceId === event.referenceId);
        if (!reference || !identityMatches(wanted, reference.identity)) {
          fail('VALIDATION_FAILED', '请确认同一品种、制备状态或产品系列后再采用参考值');
        }
        status = 'matched';
      } else fail('INVALID_INPUT', '参考查询操作无效');
      const comparisonVersion = (session.comparisonVersion || 0) + 1;
      const comparison = { ...compareNutrition(session.observation, reference, comparisonVersion, basis), status };
      await transaction(db, async tx => {
        const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
        if (!current || current.status === 'saved' || current.confirmation && current.confirmation.state === 'processing' || current.version !== session.version) {
          fail('COMPARISON_STALE', '核对状态已变化，请重新查询');
        }
        await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({
          confirmedIdentity: wanted, referenceCandidates: candidates, selectedReference: db.command.set(reference),
          comparison, comparisonBasis: basis, comparisonVersion, status: 'compared', version: current.version + 1,
          estimate: null, estimateStatus: 'idle', estimateRequestId: '', estimateFailure: null, binding: null
        });
      });
      return { ok: true, sessionId: event.sessionId, referenceCandidates: candidates,
        selectedReference: reference, comparison, comparisonVersion };
    } catch (error) { return publicFailure(error, event.requestId); }
  };
}
exports.main = async event => {
  try { return await createReferenceHandler(runtime())(event); }
  catch (error) { return publicFailure(error, event && event.requestId); }
};
exports.createReferenceHandler = createReferenceHandler;
