'use strict';
const { fail, identity, number } = require('./lib/core/contracts');
const { matchReferenceCandidates, identityMatches, compareNutrition } = require('./lib/core/reference');
const { estimateEligibility, normalizeModelEstimate, validateEstimateBinding } = require('./lib/core/estimate');
const { assertFoodRecognition, identityRequirement, makeIdentityConfirmation, hasIdentityConfirmation } = require('./lib/core/identitySafety');
const { runtime, ownedSession, getDocument, transaction, publicFailure, SESSION_COLLECTION, hash } = require('./lib/core/server');
const { findReferences } = require('./referenceRepository');

function bindRecognitionEstimate(session, wanted, reference, basis, comparisonVersion, status, timestamp) {
  const recognition = session.result || {};
  if (session.purpose !== 'preview' || session.mode !== 'food_object' || !session.recognitionEstimate ||
      status === 'ambiguous' || (recognition.classification || {}).proteinSource === 'special') return null;
  const context = { mode: session.mode, identity: wanted, observation: session.observation,
    reference, basis, comparisonVersion, identityConfirmation: session.identityConfirmation };
  const eligible = estimateEligibility(context);
  if (!eligible.eligible) return null;
  try {
    // 只补标签与参考均缺少的字段；身份或生熟状态变化后旧候选自动失效。
    const normalized = normalizeModelEstimate(session.recognitionEstimate, wanted, eligible.fields);
    const estimate = { ...normalized, comparisonVersion,
      estimateId: hash(session.requestId + ':' + comparisonVersion + ':recognition'),
      generatedAt: new Date(timestamp).toISOString(), classification: recognition.classification || null,
      modelInfo: recognition.modelInfo || null, usage: null };
    validateEstimateBinding(estimate, context);
    return estimate;
  } catch (_) { return null; }
}

function createReferenceHandler({ db, context, now = Date.now, search = findReferences }) {
  return async (event = {}) => {
    try {
      const session = await ownedSession(db, context.OPENID, event.babyUid, event.sessionId, now());
      const recoverable = session.mode === 'uncertain' && session.observation &&
        (session.observation.identityAssessment || {}).canConfirm === true;
      if (!session.observation || session.status === 'saved' ||
          !(['food_label', 'food_object', 'powder_label'].includes(session.mode) || recoverable) ||
          session.confirmation && session.confirmation.state === 'processing') fail('INVALID_INPUT', '草稿尚未完成类型核对或正在保存');
      const wanted = identity(event.identity || (session.observation.identityCandidates || [])[0]);
      assertFoodRecognition({ mode: session.mode, observation: session.observation, identity: wanted });
      if (!wanted.name) fail('INVALID_INPUT', '请先确认食物名称');
      const mode = recoverable ? 'food_object' : session.mode;
      let identityConfirmation = hasIdentityConfirmation(wanted, session.identityConfirmation) ? session.identityConfirmation : null;
      // 只认可独立的显式确认操作；自动查询结果与旧 confirmedIdentity 均不能赋予确认来源。
      if (event.identityConfirmation === 'user_confirmed') identityConfirmation = makeIdentityConfirmation(wanted);
      const requireIdentity = () => {
        if (identityRequirement({ mode, identity: wanted, observation: session.observation, identityConfirmation }).required) {
          fail('IDENTITY_INSUFFICIENT', '请明确确认具体种类与制备状态；不确定时可保留待补充');
        }
      };
      const inputBasis = event.targetBasis || session.observation.basis;
      const basis = session.mode === 'powder_label' ? { quantity: 100, unit: 'g', material: 'dry_powder' } :
        { quantity: number(inputBasis.quantity), unit: inputBasis.unit, material: 'food' };
      if (!(basis.quantity > 0) || !['g', 'ml', 'portion'].includes(basis.unit)) fail('VALIDATION_FAILED', '请先确认营养计量基准');
      let candidates; let reference = null; let status;
      if (event.action === 'search') {
        requireIdentity();
        let records; let unavailable = false;
        try { records = mode === 'food_label' ? [] : await search(db, wanted); }
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
        identityConfirmation = makeIdentityConfirmation(wanted, 'user_selected_reference', reference.referenceId);
        requireIdentity();
        status = 'matched';
      } else fail('INVALID_INPUT', '参考查询操作无效');
      const comparisonVersion = (session.comparisonVersion || 0) + 1;
      const comparison = { ...compareNutrition(session.observation, reference, comparisonVersion, basis), status };
      const estimate = bindRecognitionEstimate({ ...session, mode, identityConfirmation }, wanted, reference, basis, comparisonVersion, status, now());
      await transaction(db, async tx => {
        const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
        if (!current || current.status === 'saved' || current.confirmation && current.confirmation.state === 'processing' || current.version !== session.version) {
          fail('COMPARISON_STALE', '核对状态已变化，请重新查询');
        }
        await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({
          mode, confirmedIdentity: wanted, identityConfirmation: db.command.set(identityConfirmation),
          referenceCandidates: candidates, selectedReference: db.command.set(reference),
          comparison, comparisonBasis: basis, comparisonVersion, status: 'compared', version: current.version + 1,
          estimate: db.command.set(estimate), estimateStatus: estimate ? 'ready' : 'idle',
          estimateRequestId: '', estimateFailure: null, binding: null
        });
      });
      return { ok: true, sessionId: event.sessionId, referenceCandidates: candidates,
        mode, identityConfirmation, selectedReference: reference, comparison, comparisonVersion, estimate };
    } catch (error) { return publicFailure(error, event.requestId); }
  };
}
exports.main = async event => {
  try { return await createReferenceHandler(runtime())(event); }
  catch (error) { return publicFailure(error, event && event.requestId); }
};
exports.createReferenceHandler = createReferenceHandler;
