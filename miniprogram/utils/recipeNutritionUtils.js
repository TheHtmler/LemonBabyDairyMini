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
  return scaleNutritionByFactor(nutritionPer100g, factor);
}

function scaleNutritionByFactor(nutrition = {}, factor) {
  const scale = Number(factor);
  const result = emptyNutrition();
  const safeFactor = Number.isFinite(scale) ? scale : 0;
  NUTRITION_FIELDS.forEach((field) => {
    result[field] = roundNumber((Number(nutrition[field]) || 0) * safeFactor, 2);
  });
  return result;
}

function summarizeBatchFromIngredients(ingredients = []) {
  const totalNutrition = (ingredients || []).reduce(
    (sum, ingredient) => addNutrition(sum, ingredient && ingredient.nutrition),
    emptyNutrition()
  );
  let totalWeightG = 0;
  let hasNonGramUnit = false;
  (ingredients || []).forEach((item) => {
    const unit = String(item?.unit || 'g').toLowerCase();
    if (unit === 'g') {
      totalWeightG += Number(item.quantity) || 0;
    } else {
      // 只要配方含非克单位，就禁用按克数摄入（不必等填用量）
      hasNonGramUnit = true;
    }
  });
  totalWeightG = roundNumber(totalWeightG, 2);
  const nutritionPer100g = summarizeRecipeNutrition(
    [{ nutrition: totalNutrition }],
    totalWeightG
  ).nutritionPer100g;

  return {
    totalNutrition,
    totalWeightG,
    nutritionPer100g,
    proteinSource: deriveProteinSource(totalNutrition),
    // 单位全是 g 即可选按克数；确认时仍要求总重 > 0
    canUseGramsIntake: !hasNonGramUnit
  };
}

function resolveBatchIntake(batchNutrition = {}, batchWeightG, intakeMode, intakeValue) {
  const mode = intakeMode === 'percent' ? 'percent' : 'grams';
  const value = Number(intakeValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(mode === 'percent' ? '请输入有效的摄入百分比' : '请输入有效的食用克数');
  }

  const weight = Number(batchWeightG) || 0;
  if (mode === 'percent') {
    if (value > 100) {
      throw new Error('摄入百分比不能超过 100');
    }
    const factor = value / 100;
    return {
      intakeMode: 'percent',
      intakePercent: roundNumber(value, 2),
      eatenG: weight > 0 ? roundNumber(weight * factor, 2) : 0,
      nutrition: scaleNutritionByFactor(batchNutrition, factor)
    };
  }

  if (!(weight > 0)) {
    throw new Error('请先填写各原料用量以计算本次总重');
  }
  if (value > weight) {
    throw new Error('食用克数不能超过本次食谱总重');
  }
  const factor = value / weight;
  return {
    intakeMode: 'grams',
    intakePercent: roundNumber(factor * 100, 2),
    eatenG: roundNumber(value, 2),
    nutrition: scaleNutritionByFactor(batchNutrition, factor)
  };
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

function hasProteinSplit(nutrition = {}) {
  return nutrition.naturalProtein !== undefined
    && nutrition.naturalProtein !== null
    && nutrition.naturalProtein !== ''
    && nutrition.specialProtein !== undefined
    && nutrition.specialProtein !== null
    && nutrition.specialProtein !== ''
    && Number.isFinite(Number(nutrition.naturalProtein))
    && Number.isFinite(Number(nutrition.specialProtein));
}

function buildIngredientNutritionPreservingSplit(
  food,
  quantity,
  previousNutrition,
  previousQuantity,
  deps = {}
) {
  const nutrition = buildIngredientNutrition(food, quantity, deps);
  const oldQuantity = Number(previousQuantity);
  if (
    food?.proteinSource !== 'mixed'
    || !hasProteinSplit(previousNutrition)
    || !(oldQuantity > 0)
  ) {
    return nutrition;
  }

  const factor = (Number(quantity) || 0) / oldQuantity;
  return {
    ...nutrition,
    naturalProtein: roundNumber(Number(previousNutrition.naturalProtein) * factor, 2),
    specialProtein: roundNumber(Number(previousNutrition.specialProtein) * factor, 2)
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
  scaleNutritionByFactor,
  summarizeBatchFromIngredients,
  resolveBatchIntake,
  splitProtein,
  buildIngredientNutrition,
  buildIngredientNutritionPreservingSplit,
  summarizeRecipeNutrition,
  shouldWarnYieldMismatch,
  deriveProteinSource,
  roundNumber,
  YIELD_MISMATCH_THRESHOLD
};
