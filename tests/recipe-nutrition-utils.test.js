const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scaleNutrition,
  buildIngredientNutritionPreservingSplit,
  summarizeRecipeNutrition,
  summarizeBatchFromIngredients,
  resolveBatchIntake,
  shouldWarnYieldMismatch
} = require('../miniprogram/utils/recipeNutritionUtils');

test('summarizeRecipeNutrition builds per-100g from yield weight', () => {
  const ingredients = [
    {
      nutrition: {
        calories: 100, protein: 10, naturalProtein: 10, specialProtein: 0,
        fat: 2, carbs: 8, fiber: 1, sodium: 0
      }
    },
    {
      nutrition: {
        calories: 50, protein: 5, naturalProtein: 0, specialProtein: 5,
        fat: 1, carbs: 0, fiber: 0, sodium: 200
      }
    }
  ];
  const result = summarizeRecipeNutrition(ingredients, 200);
  assert.equal(result.totalNutrition.protein, 15);
  assert.equal(result.totalNutrition.naturalProtein, 10);
  assert.equal(result.totalNutrition.specialProtein, 5);
  assert.equal(result.nutritionPer100g.protein, 7.5);
  assert.equal(result.nutritionPer100g.calories, 75);
  assert.equal(result.proteinSource, 'mixed');
});

test('scaleNutrition by eaten grams uses per-100g', () => {
  const per100 = {
    calories: 75, protein: 7.5, naturalProtein: 5, specialProtein: 2.5,
    fat: 1.5, carbs: 4, fiber: 0.5, sodium: 100
  };
  const ate = scaleNutrition(per100, 60); // 60/100
  assert.equal(ate.protein, 4.5);
  assert.equal(ate.naturalProtein, 3);
  assert.equal(ate.specialProtein, 1.5);
});

test('unavailable mixed food scales its saved protein split with quantity', () => {
  const snapshot = {
    proteinSource: 'mixed',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { protein: 10 }
  };
  const nutrition = buildIngredientNutritionPreservingSplit(
    snapshot,
    150,
    {
      protein: 10,
      naturalProtein: 4,
      specialProtein: 6
    },
    100,
    {
      calculateNutrition: (food, quantity) => ({
        protein: food.nutritionPerBasis.protein * quantity / food.nutritionBasis.quantity
      })
    }
  );

  assert.equal(nutrition.protein, 15);
  assert.equal(nutrition.naturalProtein, 6);
  assert.equal(nutrition.specialProtein, 9);
});

test('shouldWarnYieldMismatch only when all units are g', () => {
  assert.equal(shouldWarnYieldMismatch([
    { quantity: 100, unit: 'g' },
    { quantity: 50, unit: 'g' }
  ], 200), true);
  assert.equal(shouldWarnYieldMismatch([
    { quantity: 100, unit: 'g' },
    { quantity: 10, unit: 'ml' }
  ], 200), false);
});

test('batch intake supports percent and grams from current ingredient amounts', () => {
  const ingredients = [
    {
      quantity: 100,
      unit: 'g',
      nutrition: {
        calories: 100, protein: 10, naturalProtein: 10, specialProtein: 0,
        fat: 2, carbs: 8, fiber: 1, sodium: 0
      }
    },
    {
      quantity: 100,
      unit: 'g',
      nutrition: {
        calories: 50, protein: 5, naturalProtein: 0, specialProtein: 5,
        fat: 1, carbs: 0, fiber: 0, sodium: 200
      }
    }
  ];
  const batch = summarizeBatchFromIngredients(ingredients);
  assert.equal(batch.totalWeightG, 200);
  assert.equal(batch.totalNutrition.protein, 15);
  assert.equal(batch.canUseGramsIntake, true);

  const byPercent = resolveBatchIntake(batch.totalNutrition, batch.totalWeightG, 'percent', 30);
  assert.equal(byPercent.eatenG, 60);
  assert.equal(byPercent.nutrition.protein, 4.5);

  const byGrams = resolveBatchIntake(batch.totalNutrition, batch.totalWeightG, 'grams', 60);
  assert.equal(byGrams.intakePercent, 30);
  assert.equal(byGrams.nutrition.protein, 4.5);

  // 未填用量时，全 g 配方也可选按克数；含非 g 单位则禁用
  assert.equal(summarizeBatchFromIngredients([
    { quantity: '', unit: 'g', nutrition: {} },
    { quantity: '', unit: 'g', nutrition: {} }
  ]).canUseGramsIntake, true);
  assert.equal(summarizeBatchFromIngredients([
    { quantity: 100, unit: 'g', nutrition: {} },
    { quantity: 10, unit: 'ml', nutrition: {} }
  ]).canUseGramsIntake, false);
});
