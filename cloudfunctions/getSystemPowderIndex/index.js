const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const POWDER_COLLECTION = 'powder_catalog';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const INDEX_FIELDS = {
  _id: true,
  powderCode: true,
  name: true,
  category: true,
  proteinRole: true,
  brand: true,
  stage: true,
  image: true,
  nutritionPer100g: true,
  mixRatio: true,
  alias: true,
  description: true,
  status: true,
  schemaVersion: true
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
    protein: Number(nutrition.protein) || 0,
    calories: Number(nutrition.calories) || 0,
    fat: Number(nutrition.fat) || 0,
    carbs: Number(nutrition.carbs) || 0,
    fiber: Number(nutrition.fiber) || 0
  };
}

function normalizeMixRatio(ratio = {}) {
  return {
    powder: Number(ratio.powder) || 0,
    water: Number(ratio.water) || 0
  };
}

function buildSearchText(powder = {}) {
  return normalizeSearchText([
    powder.name || '',
    powder.brand || '',
    powder.stage || '',
    powder.powderCode || '',
    powder.description || '',
    Array.isArray(powder.alias) ? powder.alias.join(' ') : ''
  ].join(' '));
}

function toIndexItem(powder = {}) {
  const powderCode = powder.powderCode || powder._id || '';
  return {
    _id: powder._id || powderCode,
    powderCode,
    name: powder.name || '',
    category: powder.category || 'regular_formula',
    proteinRole: powder.proteinRole || '',
    brand: powder.brand || '',
    stage: powder.stage || '',
    image: powder.image || '',
    nutritionPer100g: normalizeNutrition(powder.nutritionPer100g || {}),
    mixRatio: normalizeMixRatio(powder.mixRatio || {}),
    alias: Array.isArray(powder.alias) ? powder.alias : [],
    description: powder.description || '',
    schemaVersion: Number(powder.schemaVersion) || 1,
    recordType: 'powder_catalog_item',
    status: powder.status || 'active',
    sourceType: 'system',
    ownerType: 'system',
    isSystem: true,
    libraryScope: 'system',
    searchText: buildSearchText(powder)
  };
}

exports.main = async (event = {}) => {
  const startIndex = clampStartIndex(event.startIndex ?? event.start);
  const batchSize = clampBatchSize(event.batchSize);
  const res = await db.collection(POWDER_COLLECTION)
    .where({
      sourceType: 'system'
    })
    .field(INDEX_FIELDS)
    .orderBy('powderCode', 'asc')
    .skip(startIndex)
    .limit(batchSize)
    .get();

  const batch = res.data || [];
  const index = batch.filter((powder) => powder.status !== 'archived').map(toIndexItem);
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
