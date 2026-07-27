const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scaleNutrition,
  buildIngredientNutritionPreservingSplit,
  summarizeRecipeNutrition,
  summarizeBatchFromIngredients,
  summarizePremiumProteinFromIngredients,
  scalePremiumProteinSummary,
  resolveDayPremiumProteinBase,
  resolveFoodIntakePremiumProteinSplit,
  summarizeMealItemsPremiumProtein,
  combinePremiumProteinWithDay,
  matchRecipeBySearch,
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

test('premium protein amount follows ingredient proteinQuality over natural protein', () => {
  const ingredients = [
    {
      quantity: 100,
      unit: 'g',
      proteinQuality: 'premium',
      nutrition: {
        calories: 100, protein: 8, naturalProtein: 8, specialProtein: 0,
        fat: 2, carbs: 8, fiber: 0, sodium: 0
      }
    },
    {
      quantity: 100,
      unit: 'g',
      proteinQuality: 'regular',
      nutrition: {
        calories: 50, protein: 2, naturalProtein: 2, specialProtein: 0,
        fat: 1, carbs: 4, fiber: 0, sodium: 0
      }
    },
    {
      quantity: 50,
      unit: 'g',
      proteinQuality: 'premium',
      nutrition: {
        calories: 20, protein: 5, naturalProtein: 0, specialProtein: 5,
        fat: 0, carbs: 0, fiber: 0, sodium: 0
      }
    }
  ];
  const batchPremium = summarizePremiumProteinFromIngredients(ingredients);
  assert.equal(batchPremium.premiumProtein, 8);
  assert.equal(batchPremium.regularProtein, 2);
  assert.equal(batchPremium.naturalProtein, 10);
  assert.equal(batchPremium.premiumRatio, 80);

  const intakePremium = scalePremiumProteinSummary(batchPremium, 0.3);
  assert.equal(intakePremium.premiumProtein, 2.4);
  assert.equal(intakePremium.regularProtein, 0.6);
  assert.equal(intakePremium.premiumRatio, 80);
});

test('resolveFoodIntakePremiumProteinSplit apportions recipe intake by ingredient quality ratio', () => {
  const split = resolveFoodIntakePremiumProteinSplit({
    sourceType: 'recipe',
    nutrition: { naturalProtein: 3 },
    recipeSource: {
      recipeId: 'r1',
      ingredientsSnapshot: [
        { proteinQuality: 'premium', nutrition: { naturalProtein: 8 } },
        { proteinQuality: 'regular', nutrition: { naturalProtein: 2 } }
      ]
    }
  });
  assert.equal(split.premiumProtein, 2.4);
  assert.equal(split.regularProtein, 0.6);
  assert.equal(split.premiumRatio, 80);

  const plain = resolveFoodIntakePremiumProteinSplit({
    proteinQuality: 'premium',
    nutrition: { naturalProtein: 1.5 }
  });
  assert.equal(plain.premiumProtein, 1.5);
  assert.equal(plain.regularProtein, 0);
  assert.equal(plain.premiumRatio, 100);
});

test('recipe search matches name and ingredient food names', () => {
  const recipe = {
    name: '番茄炒蛋',
    notes: '少油',
    ingredients: [
      { foodName: '番茄' },
      { foodName: '鸡蛋' }
    ]
  };
  assert.equal(matchRecipeBySearch(recipe, ''), true);
  assert.equal(matchRecipeBySearch(recipe, '番茄炒'), true);
  assert.equal(matchRecipeBySearch(recipe, '鸡蛋'), true);
  assert.equal(matchRecipeBySearch(recipe, '少油'), true);
  assert.equal(matchRecipeBySearch(recipe, '牛肉'), false);
});

test('day premium ratio combines saved day totals with current intake', () => {
  const dayBase = resolveDayPremiumProteinBase({
    milk: { naturalProtein: 4 },
    food: { naturalProtein: 6, premiumProtein: 2 }
  });
  assert.equal(dayBase.naturalProtein, 10);
  assert.equal(dayBase.premiumProtein, 6);

  const mealDraft = summarizeMealItemsPremiumProtein([
    {
      proteinQuality: 'premium',
      naturalProtein: 2,
      nutrition: { naturalProtein: 2 }
    }
  ]);
  assert.equal(mealDraft.premiumProtein, 2);

  const combined = combinePremiumProteinWithDay(
    {
      naturalProtein: dayBase.naturalProtein + mealDraft.naturalProtein,
      premiumProtein: dayBase.premiumProtein + mealDraft.premiumProtein
    },
    2.4,
    3
  );
  // day 10+2 natural, 6+2 premium; + intake 3 natural / 2.4 premium
  assert.equal(combined.naturalProtein, 15);
  assert.equal(combined.premiumProtein, 10.4);
  assert.equal(combined.premiumRatio, 69);
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
