const db = wx.cloud.database();
const mealCombinationCollection = db.collection('meal_combinations');

function serverDate() {
  return db.serverDate();
}

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function hasNutritionValues(nutrition = {}) {
  return ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'].some(field => toNumber(nutrition[field]) !== 0);
}

function normalizeNutritionPerUnit(nutrition = {}) {
  return {
    calories: toNumber(nutrition.calories),
    protein: toNumber(nutrition.protein),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber),
    sodium: toNumber(nutrition.sodium)
  };
}

function normalizePlannedNutrition(nutrition = {}) {
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

function normalizeFoodSnapshot(foodSnapshot = {}, fallbackName = '') {
  const hasPer100g = hasNutritionValues(foodSnapshot.nutritionPer100g);
  const sourceNutrition = hasNutritionValues(foodSnapshot.nutritionPerUnit)
    ? foodSnapshot.nutritionPerUnit
    : foodSnapshot.nutritionPer100g;
  const normalizedNutritionPerUnit = normalizeNutritionPerUnit(sourceNutrition);
  const normalizedBaseQuantity = toNumber(foodSnapshot.baseQuantity)
    || (hasPer100g ? 100 : 0);

  const snapshot = {
    name: foodSnapshot.name || fallbackName || '',
    category: foodSnapshot.category || '',
    proteinSource: foodSnapshot.proteinSource || '',
    baseQuantity: normalizedBaseQuantity,
    baseUnit: foodSnapshot.baseUnit || '',
    nutritionPerUnit: normalizedNutritionPerUnit,
    proteinQuality: foodSnapshot.proteinQuality || '',
    milkType: foodSnapshot.milkType || ''
  };
  if (hasPer100g) {
    snapshot.nutritionPer100g = normalizeNutritionPerUnit(foodSnapshot.nutritionPer100g);
  }
  return snapshot;
}

function normalizeCombinationItem(item = {}, index = 0) {
  const foodName = item.foodName || item.foodSnapshot?.name || '';
  const foodSnapshot = normalizeFoodSnapshot(item.foodSnapshot, foodName);

  return {
    foodId: item.foodId || '',
    foodName,
    foodSnapshot,
    plannedQuantity: toNumber(item.plannedQuantity),
    plannedNutrition: normalizePlannedNutrition(item.plannedNutrition),
    unit: item.unit || foodSnapshot.baseUnit || '',
    sortOrder: toNumber(item.sortOrder, index),
    notes: item.notes || ''
  };
}

function normalizeMealCombination(record = {}) {
  return {
    ...record,
    schemaVersion: record.schemaVersion || 1,
    recordType: record.recordType || 'meal_combination',
    status: record.status || 'active',
    items: Array.isArray(record.items)
      ? record.items.map((item, index) => normalizeCombinationItem(item, index))
      : [],
    usageCount: toNumber(record.usageCount),
    lastUsedAt: record.lastUsedAt === undefined ? null : record.lastUsedAt
  };
}

function normalizeMealCombinationUpdate(data = {}) {
  const updateData = { ...data };
  delete updateData._id;
  delete updateData.id;
  delete updateData.createdAt;

  if (Object.prototype.hasOwnProperty.call(updateData, 'items')) {
    updateData.items = Array.isArray(updateData.items)
      ? updateData.items.map((item, index) => normalizeCombinationItem(item, index))
      : [];
  }

  return updateData;
}

async function createMealCombination(data = {}) {
  const timestamp = serverDate();
  const normalized = normalizeMealCombination(data);
  const res = await mealCombinationCollection.add({
    data: {
      ...normalized,
      usageCount: toNumber(normalized.usageCount),
      lastUsedAt: normalized.lastUsedAt === undefined ? null : normalized.lastUsedAt,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  });
  return res;
}

async function updateMealCombination(recordId, data = {}) {
  await mealCombinationCollection.doc(recordId).update({
    data: {
      ...normalizeMealCombinationUpdate(data),
      updatedAt: serverDate()
    }
  });
  return true;
}

async function deleteMealCombination(recordId) {
  await mealCombinationCollection.doc(recordId).update({
    data: {
      status: 'deleted',
      updatedAt: serverDate()
    }
  });
  return true;
}

async function findByBaby(babyUid) {
  const pageSize = 20;
  let offset = 0;
  const records = [];
  let hasMore = true;

  while (hasMore) {
    const res = await mealCombinationCollection
      .where({
        babyUid,
        status: 'active'
      })
      .orderBy('updatedAt', 'desc')
      .skip(offset)
      .limit(pageSize)
      .get();

    const batch = res.data || [];
    records.push(...batch);

    if (batch.length < pageSize) {
      hasMore = false;
    } else {
      offset += batch.length;
    }
  }

  return records.map((record) => normalizeMealCombination(record));
}

async function incrementUsage(recordId) {
  const timestamp = serverDate();
  await mealCombinationCollection.doc(recordId).update({
    data: {
      usageCount: db.command.inc(1),
      lastUsedAt: timestamp,
      updatedAt: timestamp
    }
  });
  return true;
}

module.exports = {
  createMealCombination,
  updateMealCombination,
  deleteMealCombination,
  findByBaby,
  incrementUsage,
  normalizeMealCombination
};
