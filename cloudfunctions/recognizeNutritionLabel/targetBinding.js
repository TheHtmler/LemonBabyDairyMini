'use strict';
const { fail, identity, FIELDS, number, foodBasis } = require('./lib/core/contracts');
const { hash, ownedSession, getDocument, transaction, readBabyFoodCatalog, SESSION_COLLECTION } = require('./lib/core/server');
const { normalizeLegacyProfileSeed, sortProfiles } = require('./lib/core/profile');
const { findDuplicates } = require('./lib/core/duplicates');
const { assertFoodRecognition, identityRequirement, makeIdentityConfirmation } = require('./lib/core/identitySafety');
function bindingFingerprint(session) { return hash(JSON.stringify({ identity: session.confirmedIdentity, basis: session.comparisonBasis, comparisonVersion: session.comparisonVersion, mode: session.mode })); }
async function bindPreviewTarget({ db, openid, event, now }) {
  let session = await ownedSession(db, openid, event.babyUid, event.sessionId, now);
  const preview = event.action === 'checkDuplicates';
  if (session.purpose !== 'preview' || session.status === 'saved' || !['food', 'powder'].includes(event.targetType) || !/^[A-Za-z0-9_-]{8,100}$/.test(event.requestId || '') || event.targetId || event.sourceSystemFoodId || event.sourceSystemPowderId) fail('INVALID_INPUT', '只能将预览结果加入新的资料');
  if (!['food_label', 'food_object', 'powder_label'].includes(session.mode) || (event.targetType === 'powder') !== (session.mode === 'powder_label')) fail('COMPARISON_STALE', '请先核对物品类型、名称和营养基准');
  const useFormValues = !preview && event.useFormValues === true && event.targetType === 'food';
  let formContext = {};
  if (useFormValues) {
    if (!session.observation || !session.result) fail('VALIDATION_FAILED', '请先完成图片识别');
    const wanted = identity(event.identity || {});
    const basis = foodBasis(event.targetBasis || {}, true);
    const confirmation = makeIdentityConfirmation(wanted);
    if (!confirmation) fail('VALIDATION_FAILED', '请填写具体名称与有效的营养基准');
    formContext = { confirmedIdentity: wanted, identityConfirmation: confirmation,
      comparisonBasis: basis,
      comparisonVersion: session.comparisonVersion || 1, status: 'compared' };
    session = { ...session, ...formContext };
  }
  const formUpdate = useFormValues ? { ...formContext,
    confirmedIdentity: db.command.set(formContext.confirmedIdentity),
    identityConfirmation: db.command.set(formContext.identityConfirmation),
    comparisonBasis: db.command.set(formContext.comparisonBasis) } : {};
  const wanted = preview ? identity(event.identity || {}) : session.confirmedIdentity;
  assertFoodRecognition({ mode: session.mode, observation: session.observation, identity: wanted });
  if (preview && !wanted.name) fail('INVALID_INPUT', '请先填写名称');
  // 表单展示阶段只读资料库，不创建绑定或确认令牌。
  if (!preview) {
    if (!session.confirmedIdentity || !session.comparisonBasis || (!useFormValues && event.comparisonVersion !== session.comparisonVersion) || !session.comparisonVersion) fail('COMPARISON_STALE', '请先核对物品类型、名称和营养基准');
    if (identityRequirement({ mode: session.mode, identity: session.confirmedIdentity, observation: session.observation,
      identityConfirmation: session.identityConfirmation }).required) fail('IDENTITY_INSUFFICIENT', '具体种类与制备状态尚未确认，营养待补充');
  }
  const fingerprint = bindingFingerprint(session);
  if (!preview && session.binding && session.binding.requestId === event.requestId) {
    if (session.binding.fingerprint !== fingerprint) fail('COMPARISON_STALE', '核对依据已变化，请重新加入');
    return { ok: true, binding: session.binding, comparisonVersion: session.comparisonVersion, expectedVersion: session.targetProfileVersion || 0 };
  }
  let targetProfileId = ''; let targetProfileVersion = 0; let seedProfile = null; let seedLegacyDocumentId = ''; let seedLegacyHash = ''; let items;
  if (event.targetType === 'powder') {
    const profiles = await db.collection('milk_nutrition_profiles').where({ babyUid: session.babyUid }).get();
    const profile = sortProfiles(profiles.data || [])[0];
    if (profile) { targetProfileId = profile._id; targetProfileVersion = Number(profile.version || 0); }
    else {
      const result = await db.collection('baby_info').where({ babyUid: session.babyUid }).limit(1).get(); const legacy = (result.data || [])[0] || {};
      seedProfile = normalizeLegacyProfileSeed(legacy.nutritionSettings || {}); seedLegacyDocumentId = legacy._id || ''; seedLegacyHash = hash(JSON.stringify(seedProfile));
    }
    items = profile ? profile.formulaPowders || [] : seedProfile.formulaPowders || [];
  } else {
    items = await readBabyFoodCatalog(db, session.babyUid);
  }
  const powder = event.targetType === 'powder';
  const matches = findDuplicates(items, wanted, event.targetType);
  const byId = new Map(items.map(item => [powder ? item.id : item._id, item]));
  const withNutrition = candidate => {
    if (!candidate) return null;
    const item = byId.get(candidate.itemId);
    const basis = item.nutritionBasis || item.servingBasis || {};
    const values = powder ? item.nutritionPer100g || {} : item.nutritionPerBasis || item.nutritionPer100g || item.nutritionPerUnit || {};
    const fieldSources = (item.recognitionMeta || {}).fieldSources || {};
    const fields = FIELDS.filter(field => !powder || field !== 'sodium');
    return { ...candidate, nutrition: {
      basis: powder ? { quantity: 100, unit: 'g', material: 'dry_powder' } : {
        quantity: number(basis.quantity ?? item.baseQuantity ?? 100),
        unit: basis.unit || item.baseUnit || (item.isLiquid ? 'ml' : 'g'), material: 'food'
      },
      values: Object.fromEntries(fields.map(field => [field, number(values[field])])),
      fieldSources: Object.fromEntries(fields.map(field => [field, fieldSources[field] || '']))
    } };
  };
  if (preview) return { ok: true, existing: withNutrition(matches.exact[0]),
    duplicateReview: !matches.exact.length && matches.possible.length ? {
      total: matches.possible.length, canConfirm: true, candidates: matches.possible.slice(0, 12).map(withNutrition)
    } : null };
  const duplicates = matches.exact.concat(matches.possible);
  const reviewToken = hash(JSON.stringify([event.sessionId, fingerprint, duplicates.map(item => [item.itemId, item.revision, item.identityKey]).sort((a, b) => a[0].localeCompare(b[0]))]));
  const reviewed = duplicates.length && event.allowDuplicate === true && session.duplicateReview && session.duplicateReview.token === reviewToken && event.duplicateReviewToken === reviewToken;
  if (duplicates.length && !reviewed) {
    await transaction(db, async tx => {
      const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
      if (!current || current.version !== session.version || current.status === 'saved' || current.confirmation && current.confirmation.state === 'processing') fail('COMPARISON_STALE', '草稿已变化，请重新核对');
      await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ ...formUpdate, duplicateReview: { token: reviewToken }, binding: null, version: current.version + 1 });
    });
    return { ok: true, comparisonVersion: session.comparisonVersion, existing: withNutrition(matches.exact[0]), duplicateReview: { token: reviewToken, total: duplicates.length, canConfirm: true, candidates: duplicates.slice(0, 12).map(withNutrition) } };
  }
  const binding = { targetType: event.targetType, requestId: event.requestId, fingerprint, comparisonVersion: session.comparisonVersion,
    allowDuplicate: !!reviewed, reviewedCandidates: [] };
  await transaction(db, async tx => {
    const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
    if (!current || current.version !== session.version || current.status === 'saved' || current.confirmation && current.confirmation.state === 'processing') fail('COMPARISON_STALE', '草稿已变化，请重新核对');
    await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ ...formUpdate, binding: db.command.set(binding), targetProfileId, targetProfileVersion, targetFoodId: '', targetFoodVersion: 0, seedProfile: db.command.set(seedProfile), seedLegacyDocumentId, seedLegacyHash, version: current.version + 1 });
  });
  return { ok: true, binding, comparisonVersion: session.comparisonVersion, expectedVersion: targetProfileVersion };
}
module.exports = { bindPreviewTarget, bindingFingerprint };
