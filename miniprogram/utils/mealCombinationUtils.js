const NUTRITION_FIELDS = [
  'calories',
  'protein',
  'naturalProtein',
  'specialProtein',
  'carbs',
  'fat',
  'fiber',
  'sodium'
];

const MEAL_SUMMARY_FIELDS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sodium'
];

const COMPLETION_PERCENT_ERROR = '请输入 1-100 的吃完比例';

function parseNumber(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseOptionalNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue || !/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(trimmedValue)) {
      return null;
    }
    const num = Number(trimmedValue);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const precisionNumber = Number(precision);
  const normalizedPrecision = Number.isInteger(precisionNumber) && precisionNumber >= 0
    ? precisionNumber
    : 2;
  return Number(`${Math.round(Number(`${num}e${normalizedPrecision}`))}e-${normalizedPrecision}`);
}

function scaleNutrition(nutrition = {}, factor = 1) {
  const scaleFactor = parseNumber(factor);
  return NUTRITION_FIELDS.reduce((result, field) => {
    result[field] = roundNumber(parseNumber(nutrition[field]) * scaleFactor);
    return result;
  }, {});
}

function normalizeCompletionPercent(value, fallback = 100) {
  const parsedValue = parseOptionalNumber(value);
  const percent = parsedValue === null ? parseNumber(fallback, 100) : parsedValue;
  return Math.min(100, Math.max(1, percent));
}

function validateCompletionPercent(value) {
  const parsedValue = parseOptionalNumber(value);
  if (parsedValue === null || parsedValue < 1 || parsedValue > 100) {
    return {
      valid: false,
      message: COMPLETION_PERCENT_ERROR
    };
  }

  return {
    valid: true,
    value: parsedValue
  };
}

function createEmptyMealSummary() {
  return MEAL_SUMMARY_FIELDS.reduce((summary, field) => {
    summary[field] = 0;
    return summary;
  }, {});
}

function calculateMealSummary(items = []) {
  const summary = createEmptyMealSummary();
  (items || []).forEach((item = {}) => {
    const nutrition = item.nutrition || {};
    MEAL_SUMMARY_FIELDS.forEach((field) => {
      summary[field] += parseNumber(nutrition[field]);
    });
  });

  return MEAL_SUMMARY_FIELDS.reduce((roundedSummary, field) => {
    roundedSummary[field] = roundNumber(summary[field]);
    return roundedSummary;
  }, {});
}

function calculateActualMealItems(items = [], completionPercent = 100) {
  const factor = normalizeCompletionPercent(completionPercent) / 100;

  return (items || []).map((item = {}) => {
    const plannedQuantity = item.plannedQuantity !== undefined
      ? item.plannedQuantity
      : item.quantity;
    const plannedNutrition = item.plannedNutrition || item.nutrition || {};
    const nutrition = scaleNutrition(plannedNutrition, factor);

    return {
      ...item,
      plannedQuantity,
      plannedNutrition: { ...plannedNutrition },
      quantity: roundNumber(parseNumber(plannedQuantity) * factor),
      nutrition,
      naturalProtein: nutrition.naturalProtein,
      specialProtein: nutrition.specialProtein
    };
  });
}

function normalizeNutritionPerUnit(nutrition = {}) {
  return {
    calories: parseNumber(nutrition.calories),
    protein: parseNumber(nutrition.protein),
    carbs: parseNumber(nutrition.carbs),
    fat: parseNumber(nutrition.fat),
    fiber: parseNumber(nutrition.fiber),
    sodium: parseNumber(nutrition.sodium)
  };
}

function normalizePlannedNutrition(nutrition = {}) {
  return NUTRITION_FIELDS.reduce((result, field) => {
    result[field] = parseNumber(nutrition[field]);
    return result;
  }, {});
}

function hasNutritionValues(nutrition = {}) {
  return MEAL_SUMMARY_FIELDS.some(field => parseNumber(nutrition[field]) !== 0);
}

function createFoodSnapshot(food = {}, fallbackName = '') {
  const hasPerUnit = hasNutritionValues(food.nutritionPerUnit);
  const hasPer100g = hasNutritionValues(food.nutritionPer100g);
  const sourceNutrition = hasPerUnit ? food.nutritionPerUnit : food.nutritionPer100g;
  const nutritionPerUnit = normalizeNutritionPerUnit(sourceNutrition);
  const baseQuantity = parseNumber(food.baseQuantity) || (hasPer100g ? 100 : 0);

  const snapshot = {
    name: food.name || fallbackName || '',
    category: food.category || '',
    proteinSource: food.proteinSource || '',
    baseQuantity,
    baseUnit: food.baseUnit || '',
    nutritionPerUnit,
    proteinQuality: food.proteinQuality || '',
    milkType: food.milkType || ''
  };
  if (hasPer100g) {
    snapshot.nutritionPer100g = normalizeNutritionPerUnit(food.nutritionPer100g);
  }
  if (food.proteinSplit) {
    snapshot.proteinSplit = { ...food.proteinSplit };
  }
  return snapshot;
}

function buildMealCombinationFromDraft(mealDraft = {}, name = '') {
  const items = Array.isArray(mealDraft.items) ? mealDraft.items : [];

  return {
    name: name || '',
    description: mealDraft.description || '',
    notes: mealDraft.notes || mealDraft.mealNote || '',
    items: items.map((item = {}, index) => {
      const food = item.food || {};
      const snapshotSource = {
        ...item,
        ...food,
        ...(item.foodSnapshot || {})
      };
      const foodName = item.nameSnapshot || item.foodName || snapshotSource.name || '';
      const plannedNutrition = item.nutrition || item.plannedNutrition || {};

      return {
        foodId: item.foodId || food._id || food.id || '',
        foodName,
        foodSnapshot: createFoodSnapshot(snapshotSource, foodName),
        plannedQuantity: parseNumber(item.quantity !== undefined ? item.quantity : item.plannedQuantity),
        plannedNutrition: { ...plannedNutrition },
        unit: item.unit || snapshotSource.baseUnit || '',
        sortOrder: parseNumber(item.sortOrder, index),
        notes: item.notes || ''
      };
    })
  };
}

function buildFoodCatalogMap(foodCatalog = []) {
  return (foodCatalog || []).reduce((catalogMap, food = {}) => {
    const id = food._id || food.id;
    if (id) {
      catalogMap.set(id, food);
    }
    return catalogMap;
  }, new Map());
}

function resolveProteinSplit(food = {}, nutrition = {}) {
  const protein = parseNumber(nutrition.protein);
  const source = food.proteinSource || '';
  if (source === 'special') {
    return {
      naturalProtein: 0,
      specialProtein: protein
    };
  }

  if (source === 'mixed') {
    const split = food.proteinSplit || food.proteinSourceSplit || {};
    const naturalRatio = parseOptionalNumber(split.natural ?? split.naturalRatio ?? split.naturalPercent);
    const specialRatio = parseOptionalNumber(split.special ?? split.specialRatio ?? split.specialPercent);

    if (naturalRatio !== null || specialRatio !== null) {
      const naturalWeight = Math.max(0, naturalRatio || 0);
      const specialWeight = Math.max(0, specialRatio || 0);
      const totalWeight = naturalWeight + specialWeight;
      const normalizedNaturalRatio = totalWeight > 0
        ? naturalWeight / totalWeight
        : 1;
      const naturalProtein = roundNumber(protein * normalizedNaturalRatio);
      return {
        naturalProtein,
        specialProtein: roundNumber(protein - naturalProtein)
      };
    }
  }

  return {
    naturalProtein: protein,
    specialProtein: 0
  };
}

function calculateFoodNutrition(food = {}, quantity = 0) {
  const hasPerUnit = hasNutritionValues(food.nutritionPerUnit);
  const hasPer100g = hasNutritionValues(food.nutritionPer100g);
  const baseQuantity = parseNumber(food.baseQuantity) || (hasPer100g ? 100 : 0);
  const factor = baseQuantity > 0 ? parseNumber(quantity) / baseQuantity : 0;
  const baseNutrition = scaleNutrition(hasPerUnit ? food.nutritionPerUnit : (food.nutritionPer100g || {}), factor);
  const proteinSplit = resolveProteinSplit(food, baseNutrition);

  return {
    ...baseNutrition,
    naturalProtein: proteinSplit.naturalProtein,
    specialProtein: proteinSplit.specialProtein
  };
}

function createLocalMealItemId(index) {
  return `meal_item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildMealItemsFromCombination(combination = {}, foodCatalog = []) {
  const catalogMap = buildFoodCatalogMap(foodCatalog);
  const combinationItems = Array.isArray(combination.items) ? combination.items : [];

  return combinationItems.map((combinationItem = {}, index) => {
    const currentFood = catalogMap.get(combinationItem.foodId);
    const snapshot = combinationItem.foodSnapshot || {};
    const sourceFood = currentFood || {
      ...snapshot,
      _id: combinationItem.foodId
    };
    const plannedQuantity = parseNumber(combinationItem.plannedQuantity);
    const plannedNutrition = currentFood
      ? calculateFoodNutrition(sourceFood, plannedQuantity)
      : (hasNutritionValues(combinationItem.plannedNutrition)
        ? normalizePlannedNutrition(combinationItem.plannedNutrition)
        : calculateFoodNutrition(sourceFood, plannedQuantity));

    return {
      localId: createLocalMealItemId(index),
      foodId: combinationItem.foodId || sourceFood._id || sourceFood.id || '',
      food: currentFood || null,
      foodSnapshot: currentFood ? createFoodSnapshot(currentFood, sourceFood.name) : createFoodSnapshot(sourceFood, combinationItem.foodName),
      nameSnapshot: sourceFood.name || combinationItem.foodName || '',
      category: sourceFood.category || '',
      unit: combinationItem.unit || sourceFood.baseUnit || '',
      quantity: plannedQuantity,
      plannedQuantity,
      plannedNutrition: { ...plannedNutrition },
      nutrition: { ...plannedNutrition },
      proteinSource: sourceFood.proteinSource || '',
      proteinQuality: sourceFood.proteinQuality || '',
      naturalProtein: plannedNutrition.naturalProtein,
      specialProtein: plannedNutrition.specialProtein,
      milkType: sourceFood.milkType || '',
      notes: combinationItem.notes || ''
    };
  });
}

module.exports = {
  roundNumber,
  scaleNutrition,
  normalizeCompletionPercent,
  validateCompletionPercent,
  createEmptyMealSummary,
  calculateMealSummary,
  calculateActualMealItems,
  buildMealCombinationFromDraft,
  buildMealItemsFromCombination
};
