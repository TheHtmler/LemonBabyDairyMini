'use strict';
const { fail, number, text } = require('./lib/core/contracts');
const { buildConfirmedPatch } = require('./lib/core/selection');
const { assertFoodRecognition, identityRequirement } = require('./lib/core/identitySafety');
const { runtime, ownedSession, getDocument, transaction, readBabyFoodCatalog, publicFailure, SESSION_COLLECTION, hash } = require('./lib/core/server');
const { saveFood, savePowder } = require('./saveRepository');
const { sortProfiles } = require('./lib/core/profile');
const { searchText } = require('./lib/core/reference');
const { findDuplicates } = require('./lib/core/duplicates');
const { requestHash, beginConfirmation, markConfirmationFailed, getConfirmationStatus } = require('./confirmationRepository');

function createConfirmationHandler({ db, context, now = Date.now }) {
  return async (event = {}) => {
    let claimed;
    try {
      if (event.action === 'getStatus') return await getConfirmationStatus({ db, openid: context.OPENID, babyUid: event.babyUid, sessionId: event.sessionId, operationId: event.operationId, now: now() });
      if (event.action && event.action !== 'confirm') fail('INVALID_INPUT', '不支持的保存操作');
      const session = await ownedSession(db, context.OPENID, event.babyUid, event.sessionId, now());
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(event.operationId || '')) fail('INVALID_INPUT', '保存请求编号无效');
      const payloadHash = requestHash(event);
      if (session.status === 'saved') {
        if (session.operationId !== event.operationId || !session.confirmation || session.confirmation.requestHash !== payloadHash) fail('REQUEST_CONFLICT', '草稿已经保存，请查看原保存结果');
        return { ok: true, ...session.savedResult };
      }
      assertFoodRecognition({ mode: session.mode, observation: session.observation, identity: session.confirmedIdentity });
      if (!session.observation || !Number.isInteger(event.expectedVersion) || event.expectedVersion < 0 ||
          !Array.isArray(event.decisions) || !text(event.operationId, 100)) fail('INVALID_INPUT', '确认保存参数无效');
      if (event.comparisonVersion !== session.comparisonVersion) fail('COMPARISON_STALE', '比对结果已变化，请重新核对');
      if (session.purpose === 'preview') {
        const fingerprint = hash(JSON.stringify({ identity: session.confirmedIdentity, basis: session.comparisonBasis, comparisonVersion: session.comparisonVersion, mode: session.mode }));
        if (!session.binding || session.binding.fingerprint !== fingerprint || event.targetId || event.sourceSystemFoodId || event.sourceSystemPowderId || event.expectedVersion !== (session.mode === 'powder_label' ? session.targetProfileVersion : 0)) fail('COMPARISON_STALE', '请重新核对并绑定新增资料');
      }
      for (const key of ['targetId', 'sourceSystemFoodId', 'sourceSystemPowderId']) {
        if (event[key] && !/^[A-Za-z0-9_-]{1,128}$/.test(event[key])) fail('INVALID_INPUT', '业务条目ID无效');
      }
      if (session.mode === 'powder_label') {
        const profiles = await db.collection('milk_nutrition_profiles').where({ babyUid: session.babyUid }).get();
        const current = sortProfiles(profiles.data || [])[0];
        if ((current && current._id || '') !== session.targetProfileId) fail('VERSION_CONFLICT', '营养档案已变化，请重新加载');
      }
      // 共享修订记录使不同会话的查重与新增串行化，覆盖没有强身份键的成品食品。
      // shortcut: 仅覆盖识别保存，其他食物写入迁到云端后应共用此修订号。
      const catalogGuardId = session.mode !== 'powder_label' ? hash('food-catalog-guard:' + session.babyUid) : '';
      const catalogGuard = catalogGuardId ? await getDocument(db, SESSION_COLLECTION, catalogGuardId) : null;
      const catalogRevision = Number(catalogGuard && catalogGuard.version || 0);
      if (session.purpose === 'preview' && !session.binding.allowDuplicate) {
        const items = session.mode === 'powder_label' ? (session.targetProfileId ? (await getDocument(db, 'milk_nutrition_profiles', session.targetProfileId) || {}).formulaPowders || [] : (session.seedProfile || {}).formulaPowders || []) : await readBabyFoodCatalog(db, session.babyUid);
        const duplicates = findDuplicates(items, session.confirmedIdentity, session.mode === 'powder_label' ? 'powder' : 'food');
        if (duplicates.exact.length) fail('VALIDATION_FAILED', '资料库已有相同身份的物品，请重新核对并查看已有资料');
        const reviewed = session.binding.reviewedCandidates || [];
        if (duplicates.possible.some(item => !reviewed.some(previous => previous.itemId === item.itemId && previous.revision === item.revision && previous.identityKey === item.identityKey))) fail('COMPARISON_STALE', '相近资料已变化，请重新核对重复项');
      }
      let sourcePowderDocumentId = '';
      if (event.sourceSystemPowderId) {
        const sources = await db.collection('powder_catalog').where({ powderCode: event.sourceSystemPowderId }).limit(2).get();
        if ((sources.data || []).length !== 1) fail('VALIDATION_FAILED', '系统奶粉来源无效');
        sourcePowderDocumentId = sources.data[0]._id;
      }
      const inputBasis = event.targetBasis || {};
      const basis = session.mode === 'powder_label' ? { quantity: 100, unit: 'g', material: 'dry_powder' } :
        { quantity: number(inputBasis.quantity), unit: inputBasis.unit, material: 'food' };
      if (!(basis.quantity > 0) || !['g', 'ml', 'portion'].includes(basis.unit)) fail('VALIDATION_FAILED', '请确认营养计量基准');
      const confirmedIdentity = session.confirmedIdentity || session.observation.identityCandidates[0];
      if (!confirmedIdentity || !confirmedIdentity.name) fail('VALIDATION_FAILED', '请先补拍包装正面或确认商品名称');
      if (identityRequirement({ mode: session.mode, identity: confirmedIdentity, observation: session.observation,
        identityConfirmation: session.identityConfirmation }).required) fail('IDENTITY_INSUFFICIENT', '具体种类与制备状态尚未确认，营养待补充');
      if (searchText((event.form || {}).name) !== searchText(confirmedIdentity.name)) {
        fail('VALIDATION_FAILED', '表单名称与已核对身份不同，请重新确认名称并查找参考');
      }
      if (session.comparisonBasis && ['quantity', 'unit', 'material'].some(k => basis[k] !== session.comparisonBasis[k])) {
        fail('COMPARISON_STALE', '计量基准已变化，请重新查找参考');
      }
      const ratioSource = event.mixRatioDecision && event.mixRatioDecision.source || 'manual';
      if (!['label', 'manual'].includes(ratioSource)) fail('VALIDATION_FAILED', '冲配比来源无效');
      const mixRatio = ratioSource === 'label' ? {
        powder: session.observation.formula.powderGrams, water: session.observation.formula.addedWaterMl
      } : (event.form || {}).mixRatio;
      const confirmed = buildConfirmedPatch({ observation: session.observation, reference: session.selectedReference,
        estimate: session.estimateStatus === 'ready' ? session.estimate : null,
        confirmedIdentity, identityConfirmation: session.identityConfirmation, comparisonVersion: session.comparisonVersion,
        decisions: event.decisions, targetBasis: basis, mode: session.mode,
        name: (event.form || {}).name, mixRatio, proteinSource: (event.form || {}).proteinSource });
      const timestamp = new Date(now());
      const meta = { ...confirmed.recognitionMeta, sessionId: event.sessionId, requestId: session.requestId,
        modelInfo: session.result.modelInfo, confirmedIdentity, identityConfirmation: session.identityConfirmation || null,
        comparisonStatus: session.comparison && session.comparison.status || 'not_found',
        confirmedAt: timestamp, confirmedBy: context.OPENID };
      if (session.mode === 'powder_label') meta.mixRatioSource = ratioSource;
      claimed = await beginConfirmation({ db, sessionId: event.sessionId, operationId: event.operationId, payloadHash, now: now() });
      const result = await transaction(db, async tx => {
        const latest = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
        if (latest && latest.status === 'saved') {
          if (latest.operationId !== event.operationId || !latest.confirmation || latest.confirmation.requestHash !== payloadHash) fail('REQUEST_CONFLICT', '草稿已经被其他请求保存');
          return latest.savedResult;
        }
        if (!latest || latest.version !== session.version || latest.comparisonVersion !== event.comparisonVersion ||
            new Date(latest.expiresAt).getTime() <= now() || !latest.confirmation || latest.confirmation.state !== 'processing' ||
            latest.confirmation.leaseUntil <= now() || latest.confirmation.lease !== claimed.lease) fail('COMPARISON_STALE', '草稿状态已变化，请重新核对');
        if (catalogGuardId) {
          const currentGuard = await getDocument(tx, SESSION_COLLECTION, catalogGuardId);
          if (Number(currentGuard && currentGuard.version || 0) !== catalogRevision) fail('COMPARISON_STALE', '资料库已有新增或更新，请重新核对重复项');
          await tx.collection(SESSION_COLLECTION).doc(catalogGuardId).set({ recordType: 'food_catalog_guard', babyUid: session.babyUid, version: catalogRevision + 1 });
        }
        if (session.selectedReference) {
          const record = await getDocument(tx, 'nutrition_reference', session.selectedReference._id);
          if (!record || !record.source.verified || record.status !== 'active' ||
              record.source.version !== session.selectedReference.source.version) fail('REFERENCE_UNAVAILABLE', '选定的营养参考版本已不可用');
        }
        if (session.purpose === 'preview' && session.mode !== 'powder_label') {
          for (const candidate of session.binding.reviewedCandidates || []) {
            const current = await getDocument(tx, 'food_catalog', candidate.itemId);
            if (current && current.babyUid !== session.babyUid && !(current.sharedBabyUids || []).includes(session.babyUid)) fail('COMPARISON_STALE', '相近资料的可见范围已变化，请重新核对');
            const match = current && findDuplicates([current], session.confirmedIdentity, 'food');
            if (match && match.exact.length) fail('VALIDATION_FAILED', '已有资料的身份已更新，请查看已有资料');
            if (match && match.possible.length && (match.possible[0].revision !== candidate.revision || match.possible[0].identityKey !== candidate.identityKey)) fail('COMPARISON_STALE', '相近资料已变化，请重新核对');
          }
        }
        const saved = session.mode === 'powder_label' ?
          await savePowder(tx, { ...latest, sourcePowderDocumentId }, event, confirmed.patch, meta, timestamp) :
          await saveFood(tx, latest, event, confirmed.patch, meta, timestamp);
        await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({
          status: 'saved', savedResult: saved, operationId: text(event.operationId, 100), version: latest.version + 1, savedAt: timestamp,
          confirmation: { ...latest.confirmation, state: 'saved', leaseUntil: 0 }
        });
        return saved;
      });
      return { ok: true, ...result };
    } catch (error) {
      // 网络/数据库异常可能发生于提交响应丢失时，不把未知结果写成确定失败。
      if (claimed && ['INVALID_INPUT', 'VALIDATION_FAILED', 'IDENTITY_INSUFFICIENT', 'VERSION_CONFLICT', 'COMPARISON_STALE', 'FORBIDDEN', 'REFERENCE_UNAVAILABLE', 'REQUEST_CONFLICT'].includes(error.code)) {
        await markConfirmationFailed(db, event.sessionId, event.operationId, claimed.lease, error.code).catch(() => {});
      }
      return publicFailure(error, event.requestId);
    }
  };
}
exports.main = async event => {
  try { return await createConfirmationHandler(runtime())(event); }
  catch (error) { return publicFailure(error, event && event.requestId); }
};
exports.createConfirmationHandler = createConfirmationHandler;
