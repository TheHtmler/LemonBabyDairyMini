const db = wx.cloud.database();
const foodIntakeCollection = db.collection('food_intake_records');
const DB_READ_BATCH_SIZE = 20;
const {
  buildCreateAuditFields,
  buildUpdateAuditFields,
  resolveOperatorOpenid,
  stripProtectedAuditFields
} = require('../utils/auditFields');
const { recordHardDelete } = require('./auditLog');

function serverDate() {
  return db.serverDate();
}

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function hasOwn(record = {}, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeNutrition(nutrition = {}) {
  return {
    calories: toNumber(nutrition.calories),
    protein: toNumber(nutrition.protein),
    naturalProtein: toNumber(nutrition.naturalProtein),
    specialProtein: toNumber(nutrition.specialProtein),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber),
    sodium: toNumber(nutrition.sodium)
  };
}

function normalizePlannedNutrition(nutrition = {}) {
  const source = nutrition || {};
  const normalized = normalizeNutrition(source);

  if (hasOwn(source, 'sodium')) {
    normalized.sodium = toNumber(source.sodium);
  }

  return normalized;
}

function normalizeNutritionPerBasis(nutrition = {}) {
  return {
    calories: toNumber(nutrition.calories),
    protein: toNumber(nutrition.protein),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber),
    sodium: toNumber(nutrition.sodium)
  };
}

function normalizeNutritionBasis(basis = {}) {
  return {
    quantity: toNumber(basis.quantity, 100) || 100,
    unit: basis.unit || 'g'
  };
}

function normalizeFoodSnapshot(foodSnapshot = {}, fallbackName = '') {
  const nutritionBasis = normalizeNutritionBasis(foodSnapshot.nutritionBasis || {
    quantity: foodSnapshot.baseQuantity,
    unit: foodSnapshot.baseUnit
  });
  const nutritionPerBasis = normalizeNutritionPerBasis(
    foodSnapshot.nutritionPerBasis || foodSnapshot.nutritionPer100g
  );

  return {
    name: foodSnapshot.name || fallbackName || '',
    category: foodSnapshot.category || '',
    categoryLevel1: foodSnapshot.categoryLevel1 || foodSnapshot.category || '',
    categoryLevel2: foodSnapshot.categoryLevel2 || '',
    nutritionBasis,
    proteinSource: foodSnapshot.proteinSource || 'natural',
    proteinQuality: foodSnapshot.proteinQuality || '',
    nutritionPerBasis,
    sourceType: foodSnapshot.sourceType || '',
    libraryScope: foodSnapshot.libraryScope || (foodSnapshot.sourceType === 'system' ? 'system' : ''),
    sourceSystemFoodId: foodSnapshot.sourceSystemFoodId || '',
    sourceFoodCode: foodSnapshot.sourceFoodCode || ''
  };
}

function normalizeMealCombinationSource(source = {}) {
  const normalizedSource = source || {};

  return {
    combinationId: normalizedSource.combinationId || '',
    combinationName: normalizedSource.combinationName || '',
    ...(normalizedSource.sourceGroupId ? { sourceGroupId: normalizedSource.sourceGroupId } : {})
  };
}

function normalizeFoodIntakeRecord(record = {}) {
  const foodName = record.foodName || record.foodSnapshot?.name || '';

  const normalizedRecord = {
    ...record,
    schemaVersion: record.schemaVersion || 1,
    recordType: record.recordType || 'food_intake',
    source: record.source || 'meal_editor_v2',
    status: record.status || 'active',
    babyUid: record.babyUid || '',
    date: record.date || '',
    mealBatchId: record.mealBatchId || '',
    recordedAt: record.recordedAt || null,
    time: record.time || '',
    foodId: record.foodId || '',
    foodName,
    foodSnapshot: normalizeFoodSnapshot(record.foodSnapshot, foodName),
    quantity: toNumber(record.quantity),
    unit: record.unit || 'g',
    nutrition: normalizeNutrition(record.nutrition),
    completionPercent: toNumber(record.completionPercent, 100),
    notes: record.notes || '',
    legacySource: record.legacySource || {
      collection: '',
      recordId: '',
      intakeId: ''
    },
    deletedAt: record.deletedAt === undefined ? null : record.deletedAt
  };

  if (hasOwn(record, 'plannedQuantity')) {
    normalizedRecord.plannedQuantity = toNumber(record.plannedQuantity);
  }
  if (hasOwn(record, 'plannedNutrition')) {
    normalizedRecord.plannedNutrition = normalizePlannedNutrition(record.plannedNutrition);
  }
  if (hasOwn(record, 'mealCombinationSource')) {
    normalizedRecord.mealCombinationSource = normalizeMealCombinationSource(record.mealCombinationSource);
  }

  return normalizedRecord;
}

function normalizeFoodIntakeUpdate(data = {}) {
  const updateData = stripProtectedAuditFields(data);

  if (Object.prototype.hasOwnProperty.call(updateData, 'quantity')) {
    updateData.quantity = toNumber(updateData.quantity);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'nutrition')) {
    updateData.nutrition = normalizeNutrition(updateData.nutrition);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'foodSnapshot')) {
    updateData.foodSnapshot = normalizeFoodSnapshot(updateData.foodSnapshot, updateData.foodName);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'plannedQuantity')) {
    updateData.plannedQuantity = toNumber(updateData.plannedQuantity);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'plannedNutrition')) {
    updateData.plannedNutrition = normalizePlannedNutrition(updateData.plannedNutrition);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'completionPercent')) {
    updateData.completionPercent = toNumber(updateData.completionPercent, 100);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'mealCombinationSource')) {
    updateData.mealCombinationSource = normalizeMealCombinationSource(updateData.mealCombinationSource);
  }

  return updateData;
}

function normalizeSortOrder(value, index = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : index;
}

function isTimeOnly(value = '') {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(value || '').trim());
}

function normalizeTimeOnly(value = '') {
  const parts = String(value || '').trim().split(':');
  const hours = String(Number(parts[0]) || 0).padStart(2, '0');
  const minutes = String(Number(parts[1]) || 0).padStart(2, '0');
  const seconds = String(Number(parts[2]) || 0).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function recordUpdatedTimestamp(record = {}) {
  const auditTimestamp = record.updatedAt || record.createdAt;
  if (auditTimestamp) return auditTimestamp;

  const date = record.date || '';
  const recordTime = record.recordedAt || record.time || '';
  if (date && isTimeOnly(recordTime)) {
    return `${date}T${normalizeTimeOnly(recordTime)}`;
  }
  if (recordTime) return recordTime;
  return date;
}

function recentFoodKey(record = {}) {
  return record.foodId || record.foodSnapshot?.sourceFoodCode || record.foodName || record.foodSnapshot?.name || '';
}

async function loadAllFoodIntakes({ where = {}, orderBy = null, batchSize = DB_READ_BATCH_SIZE } = {}) {
  const records = [];
  let offset = 0;

  while (true) {
    let query = foodIntakeCollection.where(where);
    if (orderBy?.field) {
      query = query.orderBy(orderBy.field, orderBy.direction || 'asc');
    }
    const res = await query
      .skip(offset)
      .limit(batchSize)
      .get();
    const batch = res.data || [];
    records.push(...batch);
    if (batch.length < batchSize) break;
    offset += batch.length;
  }

  return records;
}

async function createFoodIntake(data = {}) {
  const timestamp = serverDate();
  const operatorOpenid = resolveOperatorOpenid(data);
  const normalized = normalizeFoodIntakeRecord(stripProtectedAuditFields(data));
  const res = await foodIntakeCollection.add({
    data: {
      ...normalized,
      ...buildCreateAuditFields({
        timestamp,
        operatorOpenid,
        recordType: 'food_intake',
        schemaVersion: normalized.schemaVersion
      })
    }
  });
  return res;
}

async function updateFoodIntake(recordId, data = {}) {
  const operatorOpenid = resolveOperatorOpenid(data);
  await foodIntakeCollection.doc(recordId).update({
    data: {
      ...normalizeFoodIntakeUpdate(data),
      ...buildUpdateAuditFields({
        timestamp: serverDate(),
        operatorOpenid
      })
    }
  });
  return true;
}

async function deleteFoodIntake(recordId, options = {}) {
  await foodIntakeCollection.doc(recordId).remove();
  await recordHardDelete({
    db,
    collectionName: 'food_intake_records',
    recordId,
    babyUid: options.babyUid || '',
    operatorOpenid: resolveOperatorOpenid(options)
  });
  return true;
}

async function softDeleteFoodIntake(recordId, options = {}) {
  const timestamp = serverDate();
  const operatorOpenid = resolveOperatorOpenid(options);
  await foodIntakeCollection.doc(recordId).update({
    data: {
      status: 'deleted',
      deletedAt: timestamp,
      ...(operatorOpenid ? { deletedBy: operatorOpenid } : {}),
      ...buildUpdateAuditFields({
        timestamp,
        operatorOpenid
      })
    }
  });
  return true;
}

async function findByMealBatch(babyUid, date, mealBatchId) {
  const records = await loadAllFoodIntakes({
    where: {
      babyUid,
      date,
      mealBatchId,
      status: 'active'
    },
    orderBy: { field: 'sortOrder', direction: 'asc' }
  });

  return records
    .filter((record) => record.status === 'active')
    .sort((left, right) => {
      const sortDiff = normalizeSortOrder(left.sortOrder) - normalizeSortOrder(right.sortOrder);
      if (sortDiff !== 0) return sortDiff;
      return String(left.recordedAt || '').localeCompare(String(right.recordedAt || ''));
    })
    .map((record) => normalizeFoodIntakeRecord(record));
}

async function deleteMealBatch(babyUid, date, mealBatchId, options = {}) {
  const records = await findByMealBatch(babyUid, date, mealBatchId);
  await Promise.all(records.map(record => softDeleteFoodIntake(record._id, {
    ...options,
    babyUid
  })));
  return {
    deletedCount: records.length,
    deletedIds: records.map(record => record._id).filter(Boolean)
  };
}

async function createFoodIntakes(records = [], defaults = {}) {
  const createdIds = [];
  for (const [index, record] of (records || []).entries()) {
    const payload = {
      ...defaults,
      ...record,
      sortOrder: normalizeSortOrder(record.sortOrder, index)
    };
    const result = await createFoodIntake(payload);
    createdIds.push(result._id);
  }
  return createdIds;
}

async function replaceMealBatch(options = {}) {
  const {
    babyUid = '',
    date = '',
    mealBatchId = '',
    records = [],
    operatorOpenid = ''
  } = options;
  const deleteResult = await deleteMealBatch(babyUid, date, mealBatchId, {
    babyUid,
    operatorOpenid
  });
  const createdIds = await createFoodIntakes(records, {
    babyUid,
    date,
    mealBatchId,
    operatorOpenid,
    source: options.source || 'meal_editor_v2'
  });

  return {
    deletedCount: deleteResult.deletedCount,
    deletedIds: deleteResult.deletedIds,
    createdIds
  };
}

async function findMigratedLegacyIntake(options = {}) {
  const {
    babyUid = '',
    recordId = '',
    intakeId = '',
    migrationVersion = '',
    collection = 'feeding_records'
  } = options;
  const res = await foodIntakeCollection
    .where({
      babyUid,
      status: 'active',
      source: 'legacy_migration',
      migrationVersion,
      'legacySource.collection': collection,
      'legacySource.recordId': recordId,
      'legacySource.intakeId': intakeId
    })
    .limit(1)
    .get();
  const record = (res.data || [])[0];
  return record ? normalizeFoodIntakeRecord(record) : null;
}

async function findRecentFoodIntakes(babyUid, options = {}) {
  const fetchLimit = Number(options.fetchLimit) || Math.max(Number(options.limit) || 20, 20);
  const outputLimit = Number(options.limit) || 20;
  const res = await foodIntakeCollection
    .where({
      babyUid
    })
    .orderBy('date', 'desc')
    .limit(fetchLimit)
    .get();
  const seen = new Set();
  const recent = [];
  (res.data || [])
    .filter((record) => record.status !== 'deleted')
    .sort((left, right) => String(recordUpdatedTimestamp(right)).localeCompare(String(recordUpdatedTimestamp(left))))
    .forEach((record) => {
      const key = recentFoodKey(record);
      if (!key || seen.has(key)) return;
      seen.add(key);
      recent.push(normalizeFoodIntakeRecord(record));
    });
  return recent.slice(0, outputLimit);
}

async function findByDate(babyUid, date) {
  const records = await loadAllFoodIntakes({
    where: {
      babyUid,
      date,
      status: 'active'
    },
    orderBy: { field: 'recordedAt', direction: 'asc' }
  });

  return records
    .filter((record) => record.status === 'active')
    .map((record) => normalizeFoodIntakeRecord(record));
}

module.exports = {
  createFoodIntake,
  createFoodIntakes,
  updateFoodIntake,
  deleteFoodIntake,
  softDeleteFoodIntake,
  deleteMealBatch,
  replaceMealBatch,
  findByMealBatch,
  findMigratedLegacyIntake,
  findRecentFoodIntakes,
  findByDate,
  normalizeFoodIntakeRecord
};
