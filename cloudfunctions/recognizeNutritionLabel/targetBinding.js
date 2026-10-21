'use strict';
const { fail } = require('./lib/core/contracts');
const { hash, ownedSession, getDocument, transaction, readBabyFoodCatalog, SESSION_COLLECTION } = require('./lib/core/server');
const { normalizeLegacyProfileSeed, sortProfiles } = require('./lib/core/profile');
const { findDuplicates } = require('./lib/core/duplicates');
function bindingFingerprint(session) { return hash(JSON.stringify({ identity: session.confirmedIdentity, basis: session.comparisonBasis, comparisonVersion: session.comparisonVersion, mode: session.mode })); }
async function bindPreviewTarget({ db, openid, event, now }) {
  const session = await ownedSession(db, openid, event.babyUid, event.sessionId, now);
  if (session.purpose !== 'preview' || session.status === 'saved' || !['food', 'powder'].includes(event.targetType) || !/^[A-Za-z0-9_-]{8,100}$/.test(event.requestId || '') || event.targetId || event.sourceSystemFoodId || event.sourceSystemPowderId) fail('INVALID_INPUT', '只能将预览结果加入新的资料');
  if (!['food_label', 'food_object', 'powder_label'].includes(session.mode) || !session.confirmedIdentity || !session.comparisonBasis || event.comparisonVersion !== session.comparisonVersion || !session.comparisonVersion || (event.targetType === 'powder') !== (session.mode === 'powder_label')) fail('COMPARISON_STALE', '请先核对物品类型、名称和营养基准');
  const fingerprint = bindingFingerprint(session);
  if (session.binding && session.binding.requestId === event.requestId) {
    if (session.binding.fingerprint !== fingerprint) fail('COMPARISON_STALE', '核对依据已变化，请重新加入');
    return { ok: true, binding: session.binding, expectedVersion: session.targetProfileVersion || 0 };
  }
  let targetProfileId = ''; let targetProfileVersion = 0; let seedProfile = null; let seedLegacyDocumentId = ''; let seedLegacyHash = ''; let matches;
  if (event.targetType === 'powder') {
    const profiles = await db.collection('milk_nutrition_profiles').where({ babyUid: session.babyUid }).get();
    const profile = sortProfiles(profiles.data || [])[0];
    if (profile) { targetProfileId = profile._id; targetProfileVersion = Number(profile.version || 0); }
    else {
      const result = await db.collection('baby_info').where({ babyUid: session.babyUid }).limit(1).get(); const legacy = (result.data || [])[0] || {};
      seedProfile = normalizeLegacyProfileSeed(legacy.nutritionSettings || {}); seedLegacyDocumentId = legacy._id || ''; seedLegacyHash = hash(JSON.stringify(seedProfile));
    }
    const powders = profile ? profile.formulaPowders || [] : seedProfile.formulaPowders || [];
    matches = findDuplicates(powders, session.confirmedIdentity, 'powder');
  } else {
    matches = findDuplicates(await readBabyFoodCatalog(db, session.babyUid), session.confirmedIdentity, 'food');
  }
  if (matches.exact.length) return { ok: true, existing: matches.exact[0], expectedVersion: targetProfileVersion };
  const reviewToken = hash(JSON.stringify([event.sessionId, fingerprint, matches.possible.map(item => [item.itemId, item.revision, item.identityKey]).sort((a, b) => a[0].localeCompare(b[0]))]));
  const reviewed = matches.possible.length && matches.possible.length <= 12 && session.duplicateReview && session.duplicateReview.token === reviewToken && event.duplicateReviewToken === reviewToken;
  if (matches.possible.length && !reviewed) {
    await transaction(db, async tx => {
      const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
      if (!current || current.version !== session.version || current.status === 'saved' || current.confirmation && current.confirmation.state === 'processing') fail('COMPARISON_STALE', '草稿已变化，请重新核对');
      await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ duplicateReview: { token: reviewToken }, binding: null, version: current.version + 1 });
    });
    return { ok: true, duplicateReview: { token: reviewToken, total: matches.possible.length, canConfirm: matches.possible.length <= 12, candidates: matches.possible.slice(0, 12) } };
  }
  const binding = { targetType: event.targetType, requestId: event.requestId, fingerprint, comparisonVersion: session.comparisonVersion,
    reviewedCandidates: reviewed ? matches.possible : [] };
  await transaction(db, async tx => {
    const current = await getDocument(tx, SESSION_COLLECTION, event.sessionId);
    if (!current || current.version !== session.version || current.status === 'saved' || current.confirmation && current.confirmation.state === 'processing') fail('COMPARISON_STALE', '草稿已变化，请重新核对');
    await tx.collection(SESSION_COLLECTION).doc(event.sessionId).update({ binding: db.command.set(binding), targetProfileId, targetProfileVersion, targetFoodId: '', targetFoodVersion: 0, seedProfile: db.command.set(seedProfile), seedLegacyDocumentId, seedLegacyHash, version: current.version + 1 });
  });
  return { ok: true, binding, expectedVersion: targetProfileVersion };
}
module.exports = { bindPreviewTarget, bindingFingerprint };
