const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeFoodNutrition } = require('../miniprogram/utils/dailySummaryV2Utils');
const { scaleNutrition } = require('../miniprogram/utils/recipeNutritionUtils');

test('daily food summary adds normal food and 60g of a 200g recipe yield', () => {
  const recipeTotal = {
    calories: 300,
    protein: 20,
    naturalProtein: 14,
    specialProtein: 6,
    fat: 12,
    carbs: 30,
    fiber: 8,
    sodium: 400
  };
  const recipePer100g = scaleNutrition(recipeTotal, 100 / 2);
  const eatenRecipeNutrition = scaleNutrition(recipePer100g, 60);
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
      quantity: 60,
      unit: 'g',
      sourceType: 'recipe',
      recipeSource: {
        recipeId: 'recipe-1',
        recipeName: '番茄炒蛋',
        yieldWeightG: 200
      },
      nutrition: eatenRecipeNutrition
    }
  ]);

  assert.deepEqual(eatenRecipeNutrition, scaleNutrition(recipeTotal, 30));
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
