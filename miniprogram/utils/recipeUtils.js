function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}

function normalizeRatio(ratio = 1) {
  const num = Number(ratio);
  if (!Number.isFinite(num) || num <= 0) {
    return 1;
  }
  return roundNumber(num, 4);
}

function normalizeQuantity(value) {
  return roundNumber(value, 2);
}

function normalizeNutrition(nutrition = {}) {
  return {
    calories: roundCalories(Number(nutrition.calories) || 0),
    protein: roundNumber(Number(nutrition.protein) || 0, 2),
    carbs: roundNumber(Number(nutrition.carbs) || 0, 2),
    fat: roundNumber(Number(nutrition.fat) || 0, 2),
    fiber: roundNumber(Number(nutrition.fiber) || 0, 2),
    sodium: roundNumber(Number(nutrition.sodium) || 0, 2)
  };
}

function scaleNutrition(nutrition = {}, ratio = 1) {
  const safeRatio = normalizeRatio(ratio);
  return normalizeNutrition({
    calories: (Number(nutrition.calories) || 0) * safeRatio,
    protein: (Number(nutrition.protein) || 0) * safeRatio,
    carbs: (Number(nutrition.carbs) || 0) * safeRatio,
    fat: (Number(nutrition.fat) || 0) * safeRatio,
    fiber: (Number(nutrition.fiber) || 0) * safeRatio,
    sodium: (Number(nutrition.sodium) || 0) * safeRatio
  });
}

function getRecipeItemKey(item = {}, index = 0) {
  return `${item.foodId || item.nameSnapshot || 'recipe_item'}__${index}`;
}

function scaleRecipeItems(items = [], ratio = 1) {
  const safeRatio = normalizeRatio(ratio);

  return (items || []).map((item) => {
    const baseQuantity = normalizeQuantity(Number(item.baseQuantity) || 0);
    return {
      foodId: item.foodId || '',
      nameSnapshot: item.nameSnapshot || '',
      category: item.category || '',
      unit: item.unit || 'g',
      quantity: normalizeQuantity(baseQuantity * safeRatio),
      recipeBaseQuantity: baseQuantity,
      nutrition: scaleNutrition(item.nutritionSnapshot || {}, safeRatio),
      proteinSource: item.proteinSource || 'natural',
      proteinQuality: item.proteinQuality || '',
      naturalProtein: roundNumber((Number(item.naturalProtein) || 0) * safeRatio, 2),
      specialProtein: roundNumber((Number(item.specialProtein) || 0) * safeRatio, 2),
      milkType: item.milkType || '',
      notes: item.notes || ''
    };
  });
}

function buildRecipeItemsFromMealItems(items = []) {
  return (items || []).map((item) => ({
    foodId: item.foodId || '',
    nameSnapshot: item.nameSnapshot || '',
    category: item.category || '',
    unit: item.unit || 'g',
    baseQuantity: normalizeQuantity(Number(item.quantity) || 0),
    nutritionSnapshot: normalizeNutrition(item.nutrition || {}),
    proteinSource: item.proteinSource || 'natural',
    proteinQuality: item.proteinQuality || '',
    naturalProtein: roundNumber(Number(item.naturalProtein) || 0, 2),
    specialProtein: roundNumber(Number(item.specialProtein) || 0, 2)
  }));
}

function buildRecipeSourceMeta(recipe = {}, ratio = 1, baseQuantity = 0) {
  return {
    sourceType: 'recipe',
    recipeId: recipe._id || recipe.recipeId || '',
    recipeNameSnapshot: recipe.nameSnapshot || recipe.name || '',
    recipeConsumedRatio: normalizeRatio(ratio),
    recipeBaseQuantity: normalizeQuantity(baseQuantity),
    recipeScaledFromBase: true
  };
}

function detectRecipeDrift(recipe = {}, mealItems = [], ratio = 1) {
  const safeRatio = normalizeRatio(ratio);
  const recipeItems = Array.isArray(recipe.items) ? recipe.items : [];
  const currentItems = buildRecipeItemsFromMealItems(mealItems).map((item) => ({
    ...item,
    baseQuantity: normalizeQuantity((Number(item.baseQuantity) || 0) / safeRatio)
  }));

  let changed = recipeItems.length !== currentItems.length;
  let reason = changed ? 'membership' : '';

  if (!changed) {
    for (let index = 0; index < recipeItems.length; index += 1) {
      const recipeItem = recipeItems[index] || {};
      const currentItem = currentItems[index] || {};
      const recipeKey = getRecipeItemKey(recipeItem, index);
      const currentKey = getRecipeItemKey(currentItem, index);
      if (recipeKey !== currentKey) {
        changed = true;
        reason = 'membership';
        break;
      }

      const recipeBase = normalizeQuantity(Number(recipeItem.baseQuantity) || 0);
      const currentBase = normalizeQuantity(Number(currentItem.baseQuantity) || 0);
      const unitChanged = (recipeItem.unit || 'g') !== (currentItem.unit || 'g');
      if (unitChanged) {
        changed = true;
        reason = 'membership';
        break;
      }
      if (Math.abs(recipeBase - currentBase) > 0.01) {
        changed = true;
        reason = 'quantity';
        break;
      }
    }
  }

  return {
    changed,
    reason: changed ? (reason || 'quantity') : '',
    updatedItems: currentItems
  };
}

module.exports = {
  roundNumber,
  roundCalories,
  normalizeNutrition,
  scaleNutrition,
  scaleRecipeItems,
  buildRecipeItemsFromMealItems,
  buildRecipeSourceMeta,
  detectRecipeDrift
};
