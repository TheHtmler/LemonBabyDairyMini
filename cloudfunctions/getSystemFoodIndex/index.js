const cloud = require('wx-server-sdk');
const { indexNutrientStates } = require('./lib/search');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const FOOD_COLLECTION = 'food_catalog';
const INDEX_SCHEMA_VERSION = 3;
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const INDEX_FIELDS = {
  _id: true,
  name: true,
  category: true,
  categoryLevel1: true,
  categoryLevel2: true,
  status: true,
  schemaVersion: true,
  sourceFoodCode: true,
  categoryLevel1Code: true,
  categoryLevel2Code: true,
  origin: true,
  nutritionBasis: true,
  servingBasis: true,
  baseQuantity: true,
  baseUnit: true,
  nutritionPer100g: true,
  nutritionPerUnit: true,
  nutritionPerBasis: true,
  nutrientStates: true,
  recognitionMeta: true,
  proteinSource: true,
  proteinQuality: true,
  proteinComposition: true,
  aliasText: true
};

function clampBatchSize(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.max(1, Math.min(Math.floor(numberValue), MAX_BATCH_SIZE));
}

function clampStartIndex(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  return Math.max(0, Math.floor(numberValue));
}

function normalizeSearchText(value = '') {
  return value.toString().trim().toLowerCase().replace(/\s+/g, '');
}

function nutritionFromStates(states) {
  return Object.fromEntries(['calories', 'protein', 'carbs', 'fat', 'fiber', 'sodium'].map(field => {
    const entry = states[field];
    // 选择食物时提供可直接展示和计算的零值，来源状态另行保留。
    return [field, entry?.state === 'known' ? entry.value : 0];
  }));
}

function buildIndexNutrientStates(food, nutrition, basis) {
  const states = indexNutrientStates(food, nutrition, basis);
  Object.entries(states).forEach(([field, state]) => {
    const previous = food.nutrientStates?.[field];
    const proof = previous && typeof previous === 'object' ? previous : {};
    // 索引保留原始证据，不能在云端、客户端连续归一化时丢失真实零与微量的区别。
    state.rawValue = Object.prototype.hasOwnProperty.call(proof, 'rawValue')
      ? proof.rawValue : (nutrition[field] === undefined ? null : nutrition[field]);
    ['source', 'limit'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(proof, key)) state[key] = proof[key];
    });
    if (proof.sourceState || proof.state) state.sourceState = proof.sourceState || proof.state;
    if (state.state !== 'known' && proof.reason) state.reason = proof.reason;
  });
  return states;
}

function buildSearchText(food = {}) {
  return normalizeSearchText([
    food.name || '',
    food.category || '',
    food.categoryLevel1 || '',
    food.categoryLevel2 || '',
    food.sourceFoodCode || food.origin?.foodCode || '',
    Array.isArray(food.alias) ? food.alias.join(' ') : (food.aliasText || food.alias || '')
  ].join(' '));
}

function toIndexItem(food = {}) {
  const nutrition = food.nutritionPerBasis || food.nutritionPer100g || food.nutritionPerUnit || {};
  const sourceBasis = food.nutritionBasis || food.servingBasis || {
    quantity: food.baseQuantity != null ? food.baseQuantity : (food.nutritionPer100g ? 100 : null),
    unit: food.baseUnit || (food.nutritionPer100g ? 'g' : null)
  };
  const quantity = Number(sourceBasis.quantity);
  const nutritionBasis = {
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit: sourceBasis.unit || null
  };
  const nutrientStates = buildIndexNutrientStates(food, nutrition, nutritionBasis);

  return {
    _id: food._id || '',
    name: food.name || '',
    category: food.category || food.categoryLevel1 || '',
    categoryLevel1: food.categoryLevel1 || food.category || '',
    categoryLevel2: food.categoryLevel2 || '',
    schemaVersion: Number(food.schemaVersion) || 2,
    recordType: food.recordType || 'food_catalog_item',
    status: food.status || 'active',
    sourceType: 'system',
    ownerType: 'system',
    isSystem: true,
    libraryScope: 'system',
    sourceFoodCode: food.sourceFoodCode || food.origin?.foodCode || '',
    categoryLevel1Code: food.categoryLevel1Code || food.origin?.categoryLevel1Code || '',
    categoryLevel2Code: food.categoryLevel2Code || food.origin?.categoryLevel2Code || '',
    nutritionBasis,
    nutritionPerBasis: nutritionFromStates(nutrientStates),
    nutrientStates,
    ...(food.recognitionMeta ? { recognitionMeta: food.recognitionMeta } : {}),
    origin: food.origin || {},
    proteinSource: food.proteinSource || 'natural',
    proteinQuality: food.proteinQuality || '',
    proteinComposition: food.proteinComposition || null,
    aliasText: food.aliasText || (Array.isArray(food.alias) ? food.alias.join(' / ') : (food.alias || '')),
    searchText: buildSearchText(food)
  };
}

exports.main = async (event = {}) => {
  const startIndex = clampStartIndex(event.startIndex ?? event.start);
  const batchSize = clampBatchSize(event.batchSize);
  const res = await db.collection(FOOD_COLLECTION)
    .where({
      sourceType: 'system'
    })
    .field(INDEX_FIELDS)
    .orderBy('sourceFoodCode', 'asc')
    .skip(startIndex)
    .limit(batchSize)
    .get();

  const batch = res.data || [];
  const index = batch.filter(food => food.status !== 'archived').map(toIndexItem);
  const endIndex = startIndex + batch.length;
  const nextStart = batch.length < batchSize ? null : endIndex;

  return {
    ok: true,
    startIndex,
    endIndex,
    batchSize,
    processed: batch.length,
    returned: index.length,
    nextStart,
    hasMore: nextStart !== null,
    indexSchemaVersion: INDEX_SCHEMA_VERSION,
    index
  };
};
