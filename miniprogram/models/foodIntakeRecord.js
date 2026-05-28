const db = wx.cloud.database();
const foodIntakeCollection = db.collection('food_intake_records');
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
    fiber: toNumber(nutrition.fiber)
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

function normalizeNutritionPer100g(nutrition = {}) {
  return {
    calories: toNumber(nutrition.calories),
    protein: toNumber(nutrition.protein),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber)
  };
}

function normalizeFoodSnapshot(foodSnapshot = {}, fallbackName = '') {
  return {
    name: foodSnapshot.name || fallbackName || '',
    category: foodSnapshot.category || '',
    proteinSource: foodSnapshot.proteinSource || 'natural',
    nutritionPer100g: normalizeNutritionPer100g(foodSnapshot.nutritionPer100g)
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

async function findByDate(babyUid, date) {
  const res = await foodIntakeCollection
    .where({
      babyUid,
      date,
      status: 'active'
    })
    .orderBy('recordedAt', 'asc')
    .get();

  return (res.data || [])
    .filter((record) => record.status === 'active')
    .map((record) => normalizeFoodIntakeRecord(record));
}

module.exports = {
  createFoodIntake,
  updateFoodIntake,
  deleteFoodIntake,
  findByDate,
  normalizeFoodIntakeRecord
};
