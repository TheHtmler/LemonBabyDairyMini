const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeFoodNutrition } = require('../miniprogram/utils/dailySummaryV2Utils');
const { resolveBatchIntake } = require('../miniprogram/utils/recipeNutritionUtils');

test('daily food summary adds normal food and 30% of a recipe batch', () => {
  const recipeBatch = {
    calories: 300,
    protein: 20,
    naturalProtein: 14,
    specialProtein: 6,
    fat: 12,
    carbs: 30,
    fiber: 8,
    sodium: 400
  };
  const intake = resolveBatchIntake(recipeBatch, 200, 'percent', 30);
  const normalFoodNutrition = {
    calories: 40,
    protein: 2,
    naturalProtein: 2,
    specialProtein: 0,
    fat: 1,
    carbs: 8,
    fiber: 1,
    sodium: 0
  };

  const summary = mergeFoodNutrition([
    {
      foodName: '苹果',
      quantity: 80,
      unit: 'g',
      proteinQuality: 'regular',
      nutrition: normalFoodNutrition
    },
    {
      foodName: '番茄炒蛋',
      quantity: intake.eatenG,
      unit: 'g',
      sourceType: 'recipe',
      recipeSource: {
        recipeId: 'recipe-1',
        recipeName: '番茄炒蛋',
        batchWeightG: 200,
        yieldWeightG: 200,
        intakeMode: 'percent',
        intakePercent: 30
      },
      nutrition: intake.nutrition
    }
  ]);

  assert.equal(intake.eatenG, 60);
  assert.equal(intake.nutrition.protein, 6);
  assert.deepEqual(summary, {
    calories: 130,
    protein: 8,
    naturalProtein: 6.2,
    specialProtein: 1.8,
    premiumProtein: 0,
    regularProtein: 6.2,
    fat: 4.6,
    carbs: 17,
    fiber: 3.4,
    fluidVolume: 0
  });
});
