'use strict';

const crypto = require('crypto');
const { fail, MODES } = require('./lib/core/contracts');
const { hash, getDocument, transaction, SESSION_COLLECTION } = require('./lib/core/server');
const { normalizeLegacyProfileSeed, sortProfiles } = require('./lib/core/profile');
const { validateFileId } = require('./imageReader');
const { normalizeCategoryCatalog } = require('./lib/core/classification');

async function prepareSession(db, openid, event, env, now, allocateFileIds, onStage = () => {}) {
  onStage('prepare_validate');
  const preview = event.purpose === 'preview';
  if (event.mode === 'auto' && !preview || event.purpose && !['preview', 'form'].includes(event.purpose) || preview && (event.targetId || event.sourceSystemFoodId || event.sourceSystemPowderId)) fail('INVALID_INPUT', '预览只能创建新的识别草稿');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(event.requestId || '') || !MODES.includes(event.mode) ||
      !Number.isInteger(event.imageCount) || event.imageCount < 1 || event.imageCount > 3) fail('INVALID_INPUT', '识别参数无效');
  const sessionId = hash(openid + ':' + event.babyUid + ':' + event.requestId);
  const response = session => ({ ok: true, requestId: event.requestId, sessionId,
    filePaths: session.filePaths, envId: session.env,
    targetFoodId: session.targetFoodId, targetFoodVersion: session.targetFoodVersion });
  onStage('prepare_read_session');
  const prior = await getDocument(db, SESSION_COLLECTION, sessionId);
  if (prior) {
    if (new Date(prior.expiresAt).getTime() <= now) fail('SESSION_EXPIRED', '识别请求已过期');
    if ((prior.requestedMode || prior.mode) !== event.mode || (prior.purpose || 'form') !== (preview ? 'preview' : 'form') || prior.filePaths.length !== event.imageCount ||
        prior.sourceSystemFoodId !== (event.sourceSystemFoodId || '') || prior.requestedTargetId !== (event.targetId || '')) {
      fail('INVALID_INPUT', '请求ID已用于其他识别操作');
    }
    return response(prior);
  }
  const prefix = 'nutrition_recognition/' + openid + '/' + event.babyUid + '/' + crypto.randomBytes(16).toString('hex');
  let targetFoodId = event.targetId || ''; let targetFoodVersion = event.expectedVersion || 0;
  const sourceSystemFoodId = event.sourceSystemFoodId || '';
  if ([targetFoodId, sourceSystemFoodId].some(x => x && !/^[A-Za-z0-9_-]{1,128}$/.test(x))) fail('INVALID_INPUT', '食物条目ID无效');
  if (!preview && event.mode !== 'powder_label') {
    onStage('prepare_target');
    if (sourceSystemFoodId) {
      const source = await getDocument(db, 'food_catalog', sourceSystemFoodId);
      if (!source || !source.isSystem) fail('INVALID_INPUT', '系统食物来源无效');
      const existing = await db.collection('food_catalog').where({ babyUid: event.babyUid, sourceSystemFoodId }).limit(2).get();
      if ((existing.data || []).length > 1) fail('VERSION_CONFLICT', '已有重复来源条目，请先核对我的食物库');
      if ((existing.data || []).length) {
        targetFoodId = existing.data[0]._id;
        targetFoodVersion = Number(existing.data[0].version || 0);
      }
    }
    if (targetFoodId) {
      const target = await getDocument(db, 'food_catalog', targetFoodId);
      if (!target || target.isSystem || target.babyUid !== event.babyUid) fail('FORBIDDEN', '不能编辑该食物');
      if (Number(target.version || 0) !== targetFoodVersion) fail('VERSION_CONFLICT', '食物已变化，请重新打开表单');
    }
  }
  let profile = null; let seedProfile = null; let seedLegacyDocumentId = ''; let seedLegacyHash = '';
  if (!preview && event.mode === 'powder_label') {
    onStage('prepare_profile');
    const profiles = await db.collection('milk_nutrition_profiles').where({ babyUid: event.babyUid }).get();
    profile = sortProfiles(profiles.data || [])[0] || null;
    if (profile && Number(profile.version || 0) !== event.expectedVersion) fail('VERSION_CONFLICT', '营养档案已变化，请重新加载');
    if (!profile) {
      const babies = await db.collection('baby_info').where({ babyUid: event.babyUid }).limit(1).get();
      const legacy = sortProfiles(babies.data || [])[0] || {};
      seedLegacyDocumentId = legacy._id || '';
      seedProfile = normalizeLegacyProfileSeed(legacy.nutritionSettings || {});
      seedLegacyHash = hash(JSON.stringify(seedProfile));
    }
  }
  const filePaths = Array.from({ length: event.imageCount }, (_, i) => prefix + '/' + i + '.jpg');
  onStage('prepare_allocate_images');
  if (typeof allocateFileIds !== 'function') fail('CONFIG_MISSING', '缺少识别图片分配服务');
  const fileIDs = await allocateFileIds(filePaths);
  if (!Array.isArray(fileIDs) || fileIDs.length !== filePaths.length) fail('SAVE_FAILED', '图片路径分配失败');
  fileIDs.forEach((id, index) => validateFileId(id, filePaths[index], env));
  onStage('prepare_create_session');
  const session = await transaction(db, async tx => {
    const old = await getDocument(tx, SESSION_COLLECTION, sessionId);
    if (old) {
      if ((old.requestedMode || old.mode) !== event.mode || (old.purpose || 'form') !== (preview ? 'preview' : 'form') || old.filePaths.length !== event.imageCount) fail('INVALID_INPUT', '请求ID已被其他识别操作使用');
      if (new Date(old.expiresAt).getTime() <= now) fail('SESSION_EXPIRED', '识别请求已过期');
      return old;
    }
    const created = { requestId: event.requestId, ownerOpenid: openid,
      babyUid: event.babyUid, mode: event.mode, requestedMode: event.mode, purpose: preview ? 'preview' : 'form', env, status: 'uploading',
      categoryCatalog: normalizeCategoryCatalog(Array.isArray(event.categoryCatalog) ? event.categoryCatalog.slice(0, 100) : []),
      filePaths, fileIDs, expectedFileIDs: fileIDs,
      createdAt: new Date(now), expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      targetProfileId: profile && profile._id || '', seedProfile, seedLegacyDocumentId, seedLegacyHash,
      targetFoodId, targetFoodVersion, sourceSystemFoodId, requestedTargetId: event.targetId || '',
      comparisonVersion: 0, version: 0 };
    await tx.collection(SESSION_COLLECTION).doc(sessionId).set(created);
    return created;
  });
  // 事务提交后返回实际采用的会话，并发复用时不能返回本次另行分配的上传路径。
  return response(session);
}

async function claimRecognition(db, sessionId, now = Date.now()) {
  return transaction(db, async tx => {
    const session = await getDocument(tx, SESSION_COLLECTION, sessionId);
    if (!session) fail('FORBIDDEN', '识别草稿不存在');
    if (session.status !== 'uploading') return false;
    await tx.collection(SESSION_COLLECTION).doc(sessionId).update({ status: 'recognizing', recognitionStartedAt: now, recognitionLeaseUntil: now + 60000, version: session.version + 1 });
    return true;
  });
}

module.exports = { prepareSession, claimRecognition };
