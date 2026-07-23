const NUTRITION_FIELDS = [
  'calories',
  'protein',
  'naturalProtein',
  'specialProtein',
  'fat',
  'carbs',
  'fiber',
  'sodium'
];

const YIELD_MISMATCH_THRESHOLD = 0.25;

function roundNumber(num, precision = 2) {
  if (isNaN(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(num * multiplier) / multiplier;
}

function emptyNutrition() {
  return {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    sodium: 0
  };
}

function addNutrition(a = {}, b = {}) {
  const result = emptyNutrition();
  NUTRITION_FIELDS.forEach((field) => {
    result[field] = roundNumber((Number(a[field]) || 0) + (Number(b[field]) || 0), 2);
  });
  return result;
}

function scaleNutrition(nutritionPer100g = {}, ateG) {
  const factor = Number(ateG) / 100;
  const result = emptyNutrition();
  NUTRITION_FIELDS.forEach((field) => {
    result[field] = roundNumber((Number(nutritionPer100g[field]) || 0) * factor, 2);
  });
  return result;
}

function splitProtein(protein, proteinSource, proteinSplit) {
  const totalProtein = Number(protein) || 0;
  const source = proteinSource || 'natural';
  let naturalProtein = totalProtein;
  let specialProtein = 0;

  if (source === 'special') {
    naturalProtein = 0;
    specialProtein = totalProtein;
  } else if (source === 'mixed' && proteinSplit) {
    const naturalRatio = Number(proteinSplit.natural) || 0;
    const specialRatio = Number(proteinSplit.special) || 0;
    const ratioTotal = naturalRatio + specialRatio || 1;
    naturalProtein = totalProtein * (naturalRatio / ratioTotal);
    specialProtein = totalProtein * (specialRatio / ratioTotal);
  }

  return {
    naturalProtein: roundNumber(naturalProtein, 2),
    specialProtein: roundNumber(specialProtein, 2)
  };
}

function buildIngredientNutrition(food, quantity, deps = {}) {
  let calculateNutrition = deps.calculateNutrition;
  if (!calculateNutrition) {
    const FoodModel = require('../models/food.js');
    calculateNutrition = FoodModel.calculateNutrition.bind(FoodModel);
  }

  const base = calculateNutrition(food, quantity) || {};
  const proteinSource = (food && food.proteinSource) || 'natural';
  const { naturalProtein, specialProtein } = splitProtein(
    base.protein,
    proteinSource,
    food && food.proteinSplit
  );

  return {
    calories: roundNumber(Number(base.calories) || 0, 2),
    protein: roundNumber(Number(base.protein) || 0, 2),
    naturalProtein,
    specialProtein,
    fat: roundNumber(Number(base.fat) || 0, 2),
    carbs: roundNumber(Number(base.carbs) || 0, 2),
    fiber: roundNumber(Number(base.fiber) || 0, 2),
    sodium: roundNumber(Number(base.sodium) || 0, 2)
  };
}

function deriveProteinSource(nutrition = {}) {
  const natural = Number(nutrition.naturalProtein) || 0;
  const special = Number(nutrition.specialProtein) || 0;
  if (natural > 0 && special > 0) return 'mixed';
  if (special > 0) return 'special';
  return 'natural';
}

function summarizeRecipeNutrition(ingredients = [], yieldWeightG) {
  const totalNutrition = (ingredients || []).reduce(
    (sum, ingredient) => addNutrition(sum, ingredient && ingredient.nutrition),
    emptyNutrition()
  );
  const weight = Number(yieldWeightG);
  const factor = weight > 0 ? 100 / weight : 0;
  const nutritionPer100g = emptyNutrition();
  NUTRITION_FIELDS.forEach((field) => {
    nutritionPer100g[field] = roundNumber((Number(totalNutrition[field]) || 0) * factor, 2);
  });

  return {
    totalNutrition,
    nutritionPer100g,
    proteinSource: deriveProteinSource(totalNutrition)
  };
}

function shouldWarnYieldMismatch(ingredients = [], yieldWeightG) {
  if (!ingredients.every((item) => String(item.unit || '').toLowerCase() === 'g')) {
    return false;
  }
  const sum = ingredients.reduce((total, item) => total + Number(item.quantity || 0), 0);
  if (!(yieldWeightG > 0) || !(sum > 0)) {
    return false;
  }
  const ratio = Math.abs(sum - yieldWeightG) / yieldWeightG;
  return ratio >= YIELD_MISMATCH_THRESHOLD;
}

module.exports = {
  emptyNutrition,
  addNutrition,
  scaleNutrition,
  splitProtein,
  buildIngredientNutrition,
  summarizeRecipeNutrition,
  shouldWarnYieldMismatch,
  deriveProteinSource,
  roundNumber,
  YIELD_MISMATCH_THRESHOLD
};
