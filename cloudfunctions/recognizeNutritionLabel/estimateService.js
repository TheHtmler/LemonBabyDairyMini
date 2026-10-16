'use strict';

const { fail } = require('./lib/core/contracts');
const { estimateEligibility, validateEstimateBinding } = require('./lib/core/estimate');
const { ownedSession, getDocument, transaction, hash, publicFailure, SESSION_COLLECTION } = require('./lib/core/server');
const { resolveConfig } = require('./modelClient');

async function estimateNutrition({ db, openid, config, modelClient, now }, event, onStage) {
  let stage = 'estimate_validate';
  const advance = value => { stage = value; onStage(value); };
  advance(stage);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(event.requestId || '') || !Number.isInteger(event.comparisonVersion)) {
    fail('INVALID_INPUT', 'AI估算请求参数无效');
  }
  const session = await ownedSession(db, openid, event.babyUid, event.sessionId, now());
  if (session.status !== 'compared' || !session.observation || !session.confirmedIdentity || !session.comparisonBasis) {
    fail('VALIDATION_FAILED', '请先确认食材身份、营养基准并查询参考，再生成AI估算');
  }
  if (event.comparisonVersion !== session.comparisonVersion) fail('COMPARISON_STALE', '核对版本已变化，请重新查询参考');
  const context = { mode: session.mode, identity: session.confirmedIdentity, observation: session.observation,
    reference: session.selectedReference, basis: session.comparisonBasis, comparisonVersion: session.comparisonVersion };
  const eligible = estimateEligibility(context);
  if (!eligible.eligible) fail('VALIDATION_FAILED', eligible.reason);
  const response = (estimate, cached) => ({ ok: true, requestId: event.requestId, sessionId: event.sessionId,
    comparisonVersion: session.comparisonVersion, estimate, cached });
  if (session.estimateStatus === 'ready' && session.estimate) {
    validateEstimateBinding(session.estimate, context);
    return response(session.estimate, true);
  }
  if (session.estimateStatus === 'failed' && session.estimateRequestId === event.requestId) return session.estimateFailure;
  const modelConfig = resolveConfig(config);
  advance('estimate_claim');
  const claim = await transaction(db, async tx => {
    const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
    if (!current || current.status !== 'compared' || current.comparisonVersion !== session.comparisonVersion ||
        new Date(current.expiresAt).getTime() <= now()) fail('COMPARISON_STALE', '核对状态已变化，请重新查询参考');
    if (current.estimateStatus === 'ready' && current.estimate) {
      validateEstimateBinding(current.estimate, context);
      return { cached: current.estimate };
    }
    if (current.estimateStatus === 'running' && now() - new Date(current.estimateStartedAt).getTime() < 90000) {
      fail('RECOGNITION_IN_PROGRESS', 'AI估算正在处理，请稍后再查看');
    }
    if (current.version !== session.version) fail('COMPARISON_STALE', '识别草稿已变化，请重新核对');
    const version = current.version + 1;
    await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ estimate: null, estimateStatus: 'running',
      estimateRequestId: event.requestId, estimateFailure: null, estimateStartedAt: new Date(now()), version });
    return { version };
  });
  if (claim.cached) return response(claim.cached, true);
  try {
    advance('estimate_request');
    const model = await modelClient({ identity: session.confirmedIdentity, fields: eligible.fields,
      categoryCatalog: session.categoryCatalog,
      ...modelConfig, deadline: now() + 25000 });
    const estimate = { ...model.estimate, estimateId: hash(event.sessionId + ':' + session.comparisonVersion + ':' + event.requestId),
      comparisonVersion: session.comparisonVersion, generatedAt: new Date(now()).toISOString(),
      usage: model.usage, modelInfo: model.modelInfo };
    validateEstimateBinding(estimate, context);
    advance('estimate_save');
    await transaction(db, async tx => {
      const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
      if (!current || current.status !== 'compared' || current.comparisonVersion !== session.comparisonVersion ||
          current.version !== claim.version || current.estimateRequestId !== event.requestId ||
          new Date(current.expiresAt).getTime() <= now()) fail('COMPARISON_STALE', 'AI估算期间核对状态已变化，请重新生成');
      // 草稿中的estimate原为null，需整体替换，不能让SDK拆成estimate.*子字段更新。
      await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ estimate: db.command.set(estimate), estimateStatus: 'ready',
        estimateFailure: null, version: current.version + 1 });
    });
    return response(estimate, false);
  } catch (error) {
    const failure = publicFailure(error, event.requestId, { action: 'estimate', stage });
    await transaction(db, async tx => {
      const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
      if (current && current.status === 'compared' && current.comparisonVersion === session.comparisonVersion &&
          current.estimateRequestId === event.requestId && current.version === claim.version) {
        await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ estimateStatus: 'failed',
          estimateFailure: db.command.set(failure), version: current.version + 1 });
      }
    }).catch(cleanupError => {
      publicFailure(cleanupError, event.requestId, { action: 'estimate', stage: 'estimate_failure_save' });
    });
    return failure;
  }
}

module.exports = { estimateNutrition };
