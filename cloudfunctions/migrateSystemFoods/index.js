const cloud = require('wx-server-sdk');
const fs = require('fs');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const collection = db.collection('food_catalog');
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 200;
const DEFAULT_LOG_LIMIT = 20;
const NUTRIENT_UNITS = { calories: 'kcal', protein: 'g', fat: 'g', carbs: 'g', fiber: 'g', sodium: 'mg' };

function nutritionNumber(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && value.trim() !== '')) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeSystemNutrition(item, nutrition) {
  const values = {};
  const states = {};
  const meta = item.recognitionMeta || {};
  Object.entries(NUTRIENT_UNITS).forEach(([field, unit]) => {
    const previous = item.nutrientStates?.[field];
    const proof = previous && typeof previous === 'object' ? previous : { state: previous };
    const raw = nutrition[field];
    const entry = raw && typeof raw === 'object' ? raw : { value: raw };
    const declared = proof.state || entry.state;
    let value = nutritionNumber(entry.value);
    let state = 'known';
    let reason = '';
    if ([item.missingFields, nutrition.missingFields, meta.missingFields]
      .some(fields => Array.isArray(fields) && fields.includes(field))) {
      state = 'missing';
    } else if ((proof.unit || entry.unit || unit) !== unit) {
      state = 'not_convertible';
      reason = 'unknown_unit';
    } else if (['missing', 'trace', 'below_limit', 'unverified', 'not_convertible'].includes(declared)) {
      state = declared;
      reason = proof.reason || '';
    } else if (declared && !['known', 'present'].includes(declared)) {
      state = 'missing';
      reason = 'unknown_nutrient_state';
    } else if (value === null) {
      state = 'missing';
      reason = 'missing_or_invalid_value';
    } else if (value === 0 && !['known', 'present'].includes(declared) && proof.explicit !== true
      && !['label', 'reference', 'manual', 'model_estimate'].includes(meta.fieldSources?.[field])) {
      // 旧种子把空白也写为零；没有原始字段证据时，不能批量确认为真实零值。
      state = 'unverified';
      reason = 'unverified_zero';
    }
    if (state !== 'known') value = null;
    values[field] = value;
    states[field] = {
      ...proof,
      state,
      value,
      unit,
      reason,
      rawValue: Object.prototype.hasOwnProperty.call(proof, 'rawValue') ? proof.rawValue : (raw === undefined ? null : raw),
      source: proof.source || item.origin?.source || item.source || 'china_food_composition_table'
    };
  });
  return {
    nutritionPerBasis: values,
    nutrientStates: states,
    missingFields: Object.keys(states).filter(field => states[field].state !== 'known'),
    missingNutrition: Object.fromEntries(Object.keys(states).map(field => [field, states[field].state !== 'known']))
  };
}

function loadFoods() {
  const candidates = [
    path.resolve(__dirname, '../../miniprogram/data/foods.json'),
    path.resolve(__dirname, 'foods.json')
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  }
  throw new Error('foods.json 未找到，请将 miniprogram/data/foods.json 拷贝到云函数目录或保持相对路径可访问');
}

function normalizeFood(item) {
  const nutrition = item.nutritionPerBasis || item.nutritionPer100g || item.nutritionPerUnit || {};
  const normalizedNutrition = normalizeSystemNutrition(item, nutrition);
  const basis = item.nutritionBasis || {
    quantity: Number(item.baseQuantity) || 100,
    unit: item.baseUnit || 'g'
  };
  const origin = item.origin || {};
  const sourceFoodCode = item.sourceFoodCode || origin.foodCode || '';
  const categoryLevel1Code = item.categoryLevel1Code || origin.categoryLevel1Code || '';
  const categoryLevel2Code = item.categoryLevel2Code || origin.categoryLevel2Code || '';

  return {
    name: item.name,
    category: item.category || '',
    categoryLevel1: item.categoryLevel1 || item.category || '',
    categoryLevel2: item.categoryLevel2 || '',
    schemaVersion: Number(item.schemaVersion) || 2,
    recordType: item.recordType || 'food_catalog_item',
    status: item.status || 'active',
    sourceType: item.sourceType || 'system',
    ownerType: item.ownerType || 'system',
    alias: item.alias || [],
    aliasText: item.aliasText || '',
    defaultQuantity: Number(item.defaultQuantity) || Number(item.baseQuantity) || 100,
    image: item.image || '',
    isLiquid: !!item.isLiquid,
    isSystem: true,
    nutritionSource: item.nutritionSource || 'system',
    nutritionBasis: {
      quantity: Number(basis.quantity) || 100,
      unit: basis.unit || 'g'
    },
    ...normalizedNutrition,
    ...(item.recognitionMeta ? { recognitionMeta: item.recognitionMeta } : {}),
    nutritionExtra: item.nutritionExtra || {},
    origin: {
      source: origin.source || item.source || 'china_food_composition_table',
      foodCode: sourceFoodCode,
      categoryLevel1Code,
      categoryLevel2Code,
      ediblePercent: nutritionNumber(origin.ediblePercent ?? item.ediblePercent)
    },
    sourceFoodCode,
    categoryLevel1Code,
    categoryLevel2Code,
    proteinSource: item.proteinSource || 'natural',
    proteinQuality: item.proteinQuality || '',
    sharedBabyUids: [],
    babyUid: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
}

async function findExistingSystemFood(payload) {
  if (payload.sourceFoodCode) {
    const byCode = await collection
      .where({
        sourceFoodCode: payload.sourceFoodCode,
        sourceType: 'system'
      })
      .limit(1)
      .get();
    if (byCode.data && byCode.data.length > 0) {
      return byCode.data[0];
    }
  }

  const byLegacyKey = await collection
    .where({
      name: payload.name,
      category: payload.category,
      sourceType: 'system'
    })
    .limit(1)
    .get();
  return byLegacyKey.data && byLegacyKey.data.length > 0 ? byLegacyKey.data[0] : null;
}

function clampInteger(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(num), min), max);
}

function buildSeedKeys(foods) {
  const sourceFoodCodes = new Set();
  const legacyKeys = new Set();

  foods.forEach(item => {
    const payload = normalizeFood(item);
    if (payload.sourceFoodCode) {
      sourceFoodCodes.add(payload.sourceFoodCode);
    }
    legacyKeys.add(`${payload.name}::${payload.category}`);
  });

  return { sourceFoodCodes, legacyKeys };
}

function buildSystemFoodCleanupQuery() {
  return _.or([
    { sourceType: 'system' },
    { ownerType: 'system' },
    { isSystem: true }
  ]);
}

function isUserOwnedFood(doc = {}) {
  if (doc.sourceType === 'user_custom' || doc.sourceType === 'user_override') {
    return true;
  }
  if (doc.ownerType === 'baby') {
    return true;
  }
  return !!doc.babyUid && doc.sourceType !== 'system' && doc.ownerType !== 'system';
}

async function cleanupStaleSystemFoods(event = {}, foods = []) {
  const startIndex = clampInteger(event.startIndex ?? event.start, 0, 0, 1000000);
  const batchSize = clampInteger(event.batchSize ?? event.limit, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const logLimit = clampInteger(event.logLimit, DEFAULT_LOG_LIMIT, 0, 200);
  const execute = event.execute === true;
  const { sourceFoodCodes, legacyKeys } = buildSeedKeys(foods);
  const res = await collection
    .where(buildSystemFoodCleanupQuery())
    .skip(startIndex)
    .limit(batchSize)
    .get();
  const docs = res.data || [];
  const logs = [];
  let deleted = 0;
  let stale = 0;

  for (const doc of docs) {
    if (isUserOwnedFood(doc)) {
      continue;
    }

    const sourceFoodCode = doc.sourceFoodCode || doc.origin?.foodCode || '';
    const legacyKey = `${doc.name || ''}::${doc.category || ''}`;
    const existsInSeed = sourceFoodCode
      ? sourceFoodCodes.has(sourceFoodCode)
      : legacyKeys.has(legacyKey);

    if (existsInSeed) {
      continue;
    }

    stale++;
    logs.push(`stale: ${doc.name || doc._id} (${doc.category || ''})`);
    if (execute === true) {
      await collection.doc(doc._id).remove();
      deleted++;
    }
  }

  const nextStart = docs.length < batchSize
    ? null
    : startIndex + (execute ? docs.length - deleted : docs.length);

  return {
    ok: true,
    action: 'cleanupStale',
    dryRun: execute !== true,
    totalSeed: foods.length,
    startIndex,
    batchSize,
    scanned: docs.length,
    stale,
    deleted,
    nextStart,
    hasMore: nextStart !== null,
    logs: logs.slice(0, logLimit),
    logCount: logs.length
  };
}

exports.main = async (event = {}) => {
  const foods = loadFoods();
  if (event.action === 'cleanupStale') {
    return cleanupStaleSystemFoods(event, foods);
  }

  const startIndex = clampInteger(event.startIndex ?? event.start, 0, 0, foods.length);
  const batchSize = clampInteger(event.batchSize ?? event.limit, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const logLimit = clampInteger(event.logLimit, DEFAULT_LOG_LIMIT, 0, 200);
  const endIndex = Math.min(startIndex + batchSize, foods.length);
  const batch = foods.slice(startIndex, endIndex);
  let created = 0;
  let updated = 0;
  const logs = [];

  for (const item of batch) {
    const payload = normalizeFood(item);
    const existing = await findExistingSystemFood(payload);

    if (existing) {
      const id = existing._id;
      const recognitionMeta = existing.recognitionMeta || payload.recognitionMeta ? {
        ...(existing.recognitionMeta || {}),
        ...(payload.recognitionMeta || {}),
        // 原始识别证据保留，当前营养值的缺项与来源改用本次导入结果。
        missingFields: payload.missingFields,
        fieldSources: Object.fromEntries(Object.keys(payload.nutrientStates)
          .filter(field => payload.nutrientStates[field].state === 'known')
          .map(field => [field, 'reference'])),
        finalBasis: { ...payload.nutritionBasis, material: 'food' }
      } : null;
      await collection.doc(id).update({
        data: {
          ...payload,
          nutritionPerBasis: _.set(payload.nutritionPerBasis),
          nutrientStates: _.set(payload.nutrientStates),
          missingNutrition: _.set(payload.missingNutrition),
          ...(recognitionMeta ? { recognitionMeta: _.set(recognitionMeta) } : {}),
          createdAt: existing.createdAt || db.serverDate()
        }
      });
      updated++;
      logs.push(`update: ${payload.name} (${payload.category})`);
    } else {
      await collection.add({ data: payload });
      created++;
      logs.push(`create: ${payload.name} (${payload.category})`);
    }
  }

  const nextStart = endIndex < foods.length ? endIndex : null;

  return {
    ok: true,
    total: foods.length,
    startIndex,
    endIndex,
    batchSize,
    processed: batch.length,
    nextStart,
    hasMore: nextStart !== null,
    created,
    updated,
    logs: logs.slice(0, logLimit),
    logCount: logs.length
  };
};
