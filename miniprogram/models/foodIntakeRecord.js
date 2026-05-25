const db = wx.cloud.database();
const foodIntakeCollection = db.collection('food_intake_records');

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

function normalizeFoodIntakeRecord(record = {}) {
  const foodName = record.foodName || record.foodSnapshot?.name || '';

  return {
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
    notes: record.notes || '',
    legacySource: record.legacySource || {
      collection: '',
      recordId: '',
      intakeId: ''
    },
    deletedAt: record.deletedAt === undefined ? null : record.deletedAt
  };
}

function normalizeFoodIntakeUpdate(data = {}) {
  const updateData = { ...data };
  delete updateData._id;
  delete updateData.id;
  delete updateData.createdAt;

  if (Object.prototype.hasOwnProperty.call(updateData, 'quantity')) {
    updateData.quantity = toNumber(updateData.quantity);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'nutrition')) {
    updateData.nutrition = normalizeNutrition(updateData.nutrition);
  }
  if (Object.prototype.hasOwnProperty.call(updateData, 'foodSnapshot')) {
    updateData.foodSnapshot = normalizeFoodSnapshot(updateData.foodSnapshot, updateData.foodName);
  }

  return updateData;
}

async function createFoodIntake(data = {}) {
  const timestamp = serverDate();
  const normalized = normalizeFoodIntakeRecord(data);
  const res = await foodIntakeCollection.add({
    data: {
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
  });
  return res;
}

async function updateFoodIntake(recordId, data = {}) {
  await foodIntakeCollection.doc(recordId).update({
    data: {
      ...normalizeFoodIntakeUpdate(data),
      updatedAt: serverDate()
    }
  });
  return true;
}

async function deleteFoodIntake(recordId) {
  await foodIntakeCollection.doc(recordId).remove();
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
