'use strict';
const { fail, text, number } = require('./lib/core/contracts');
const { getDocument, hash } = require('./lib/core/server');
const { normalizeLegacyProfileSeed } = require('./lib/core/profile');
const { strongIdentityKey, candidateIdentity, duplicateLevel } = require('./lib/core/duplicates');

async function saveFood(tx, session, event, patch, meta, now) {
  const sourceId = session.sourceSystemFoodId || '';
  if ((event.sourceSystemFoodId || '') !== sourceId || (event.targetId || '') !== (session.targetFoodId || '') ||
      event.expectedVersion !== session.targetFoodVersion) fail('VERSION_CONFLICT', '确认对象与识别时不同，请重新核对');
  let id = session.targetFoodId || (sourceId ? hash('food-source:' + session.babyUid + ':' + sourceId) : hash('food:' + event.sessionId));
  let current;
  // 明确确认重复添加时按本次会话新建，不能命中已有食物的身份文档。
  const identityKey = session.purpose === 'preview' && !(session.binding && session.binding.allowDuplicate) && strongIdentityKey(session.confirmedIdentity, 'food');
  if (identityKey) {
    // 不同识别会话的同一强身份写入同一文档，让事务重试检测并发新增。
    id = hash('food-identity:' + session.babyUid + ':' + identityKey);
    for (let generation = 0; generation < 30; generation++) {
      current = await getDocument(tx, 'food_catalog', id);
      if (!current) break;
      if (current.babyUid !== session.babyUid || current.isSystem) fail('FORBIDDEN', '不能修改该食物');
      if (!current.deletedAt && (!current.status || current.status === 'active') && duplicateLevel(session.confirmedIdentity, candidateIdentity(current)) === 'exact') fail('VALIDATION_FAILED', '相同身份资料已保存，请查看已有资料');
      // 归档或已改名的旧条目保留原文档，下一槽位仍由原文档版本确定。
      id = hash('food-identity-next:' + id + ':' + Number(current.version || 0));
      current = undefined;
      if (generation === 29) fail('VERSION_CONFLICT', '同名资料版本较多，请到食物管理核对已有条目');
    }
  } else current = await getDocument(tx, 'food_catalog', id);
  if (current && (current.isSystem || current.babyUid !== session.babyUid)) fail('FORBIDDEN', '不能修改该食物');
  if (event.targetId && !current) fail('VERSION_CONFLICT', '食物已被删除，请重新加载');
  if (current && Number(current.version || 0) !== event.expectedVersion) fail('VERSION_CONFLICT', '其他监护人已修改该食物，请重新核对');
  let source = null;
  if (event.sourceSystemFoodId) {
    source = await getDocument(tx, 'food_catalog', event.sourceSystemFoodId);
    if (!source || !source.isSystem) fail('VALIDATION_FAILED', '系统食物来源无效');
  }
  const form = event.form || {};
  const category = text(form.category, 80);
  if (!category || !['natural', 'special'].includes(form.proteinSource)) fail('VALIDATION_FAILED', '请确认分类与蛋白来源');
  const quality = form.proteinSource === 'natural' ? form.proteinQuality : '';
  if (form.proteinSource === 'natural' && !['premium', 'regular'].includes(quality)) fail('VALIDATION_FAILED', '请确认蛋白质量类型');
  const nutrition = {};
  ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'].forEach(field => { nutrition[field] = number(patch[field]); });
  const submittedImages = form.images === undefined ? (form.image ? [form.image] : []) : form.images;
  if (!Array.isArray(submittedImages) || submittedImages.length > 3 || submittedImages.some(id =>
    typeof id !== 'string' || !id.trim() || id.length > 1000 || !id.trim().startsWith('cloud://'))) {
    fail('VALIDATION_FAILED', '食物图片最多3张，须先上传云存储');
  }
  const images = [...new Set(submittedImages.map(id => id.trim()))];
  const image = text(form.image, 1000) || images[0] || '';
  if (image && !images.includes(image)) fail('VALIDATION_FAILED', '封面须选自食物图片');
  const data = { ...(current || {}), name: patch.name, category, categoryLevel1: category,
    categoryLevel2: text(form.categoryLevel2, 100), nutritionBasis: { quantity: patch.baseQuantity, unit: patch.unit },
    nutritionPerBasis: nutrition, proteinSource: form.proteinSource, proteinQuality: quality, foodType: 'food',
    babyUid: session.babyUid, sharedBabyUids: Array.from(new Set([].concat(current && current.sharedBabyUids || [], session.babyUid))),
    isSystem: false, ownerType: 'baby', sourceType: source ? 'user_override' : current && current.sourceType || 'user_custom',
    recordType: 'food_catalog_item', schemaVersion: 2, status: 'active', isLiquid: patch.unit === 'ml',
    image, images, nutritionSource: 'user_confirmed', isPhotoAiRecognized: true, recognitionMeta: meta,
    version: Number(current && current.version || 0) + 1,
    createdBy: current && current.createdBy || session.ownerOpenid,
    createdAt: current && current.createdAt || now, updatedAt: now };
  if (source) {
    data.sourceSystemFoodId = source._id;
    data.sourceFoodCode = source.sourceFoodCode || (source.origin || {}).foodCode || '';
    data.isSystemSnapshot = true;
    data.snapshotOf = { collection: 'food_catalog', id: source._id, sourceFoodCode: data.sourceFoodCode };
  }
  delete data._id;
  await tx.collection('food_catalog').doc(id).set(data);
  return { targetType: 'food', itemId: id, finalValues: patch, version: data.version };
}

async function savePowder(tx, session, event, patch, meta, now) {
  const profileId = session.targetProfileId || 'profile_' + session.babyUid;
  const profile = await getDocument(tx, 'milk_nutrition_profiles', profileId);
  if (profile && profile.babyUid !== session.babyUid) fail('FORBIDDEN', '奶粉档案不属于当前宝宝');
  if (Number(profile && profile.version || 0) !== event.expectedVersion) fail('VERSION_CONFLICT', '其他监护人已修改营养档案，请重新加载后核对');
  if (!profile && session.targetProfileId) fail('VERSION_CONFLICT', '营养档案已被移除');
  if (!profile && session.seedLegacyDocumentId) {
    const legacy = await getDocument(tx, 'baby_info', session.seedLegacyDocumentId);
    if (!legacy || hash(JSON.stringify(normalizeLegacyProfileSeed(legacy.nutritionSettings || {}))) !== session.seedLegacyHash) {
      fail('VERSION_CONFLICT', '旧营养档案已变化，请重新加载');
    }
  }
  const categories = { regular_formula: 'natural', special_formula: 'special', energy_supplement: 'none' };
  const category = text((event.form || {}).category);
  if (!Object.prototype.hasOwnProperty.call(categories, category)) fail('VALIDATION_FAILED', '奶粉分类无效');
  const id = event.targetId || 'powder_' + event.sessionId.slice(0, 24);
  const powders = Array.isArray(profile && profile.formulaPowders) ? profile.formulaPowders : (session.seedProfile || {}).formulaPowders || [];
  const existing = powders.find(x => x.id === id);
  if (event.targetId && !existing) fail('VERSION_CONFLICT', '奶粉条目已被移除');
  const sourceId = text(event.sourceSystemPowderId, 128);
  if (sourceId) {
    const source = await getDocument(tx, 'powder_catalog', session.sourcePowderDocumentId || sourceId);
    if (!source || source.isSystem === false) fail('VALIDATION_FAILED', '系统奶粉来源无效');
    if (powders.some(x => x.id !== id && x.sourceSystemPowderId === sourceId && x.status === 'active')) {
      fail('VALIDATION_FAILED', '该系统奶粉已加入我的库，请编辑已有条目');
    }
  }
  const nutrition = {};
  ['calories', 'protein', 'fat', 'carbs', 'fiber'].forEach(field => { nutrition[field] = number(patch.nutritionPer100g[field]); });
  const powder = { ...(existing || {}), id, name: patch.name, category, proteinRole: categories[category],
    nutritionPer100g: nutrition, mixRatio: patch.mixRatio, status: 'active',
    source: sourceId ? 'system' : existing && existing.source || 'user',
    sourceSystemPowderId: sourceId || existing && existing.sourceSystemPowderId || '',
    recognitionMeta: meta, createdAt: existing && existing.createdAt || now, updatedAt: now, deletedAt: null };
  const data = { ...(profile || {}), babyUid: session.babyUid, schemaVersion: 1,
    breastMilk: profile && profile.breastMilk || (session.seedProfile || {}).breastMilk || { nutritionPer100ml: {} },
    formulaPowders: existing ? powders.map(x => x.id === id ? powder : x) : powders.concat(powder),
    version: Number(profile && profile.version || 0) + 1,
    createdAt: profile && profile.createdAt || now, updatedAt: now };
  delete data._id;
  await tx.collection('milk_nutrition_profiles').doc(profileId).set(data);
  return { targetType: 'powder', itemId: id, finalValues: patch, version: data.version, profileId };
}
module.exports = { saveFood, savePowder };
