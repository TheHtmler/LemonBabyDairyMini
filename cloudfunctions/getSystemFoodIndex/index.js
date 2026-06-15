const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const FOOD_COLLECTION = 'food_catalog';
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
  nutritionBasis: true,
  nutritionPerBasis: true,
  proteinSource: true,
  proteinQuality: true,
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

function normalizeNutrition(nutrition = {}) {
  return {
    calories: Number(nutrition.calories) || 0,
    protein: Number(nutrition.protein) || 0,
    carbs: Number(nutrition.carbs) || 0,
    fat: Number(nutrition.fat) || 0,
    fiber: Number(nutrition.fiber) || 0,
    sodium: Number(nutrition.sodium) || 0
  };
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
  const nutritionBasis = food.nutritionBasis || {
    quantity: Number(food.baseQuantity) || 100,
    unit: food.baseUnit || 'g'
  };

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
    nutritionBasis: {
      quantity: Number(nutritionBasis.quantity) || 100,
      unit: nutritionBasis.unit || 'g'
    },
    nutritionPerBasis: normalizeNutrition(food.nutritionPerBasis || food.nutritionPerUnit || {}),
    proteinSource: food.proteinSource || 'natural',
    proteinQuality: food.proteinQuality || '',
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
    indexSchemaVersion: Number(event.indexSchemaVersion) || 1,
    index
  };
};
