const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scaleRecipeItems,
  buildRecipeItemsFromMealItems,
  detectRecipeDrift,
  buildRecipeSourceMeta
} = require('../miniprogram/utils/recipeUtils');

test('scaleRecipeItems scales quantity, nutrition, and protein splits by consumed ratio', () => {
  const scaled = scaleRecipeItems([
    {
      foodId: 'A',
      nameSnapshot: '食物A',
      unit: 'g',
      category: '主食',
      baseQuantity: 10,
      nutritionSnapshot: { calories: 100, protein: 2, carbs: 5.5, fat: 1.2, fiber: 0.7, sodium: 12.3 },
      proteinSource: 'natural',
      proteinQuality: 'premium',
      naturalProtein: 2,
      specialProtein: 0
    },
    {
      foodId: 'B',
      nameSnapshot: '食物B',
      unit: 'ml',
      category: '饮品',
      baseQuantity: 3,
      nutritionSnapshot: { calories: 30, protein: 1, carbs: 2, fat: 0.4, fiber: 0, sodium: 1.5 },
      proteinSource: 'special',
      proteinQuality: '',
      naturalProtein: 0,
      specialProtein: 1
    }
  ], 0.7);

  assert.equal(scaled[0].quantity, 7);
  assert.equal(scaled[0].recipeBaseQuantity, 10);
  assert.deepEqual(scaled[0].nutrition, {
    calories: 70,
    protein: 1.4,
    carbs: 3.85,
    fat: 0.84,
    fiber: 0.49,
    sodium: 8.61
  });
  assert.equal(scaled[0].naturalProtein, 1.4);
  assert.equal(scaled[0].specialProtein, 0);

  assert.equal(scaled[1].quantity, 2.1);
  assert.equal(scaled[1].recipeBaseQuantity, 3);
  assert.equal(scaled[1].nutrition.calories, 21);
  assert.equal(scaled[1].specialProtein, 0.7);
});

test('buildRecipeItemsFromMealItems converts meal items into template base items', () => {
  const recipeItems = buildRecipeItemsFromMealItems([
    {
      localId: 'meal_item_1',
      foodId: 'A',
      nameSnapshot: '食物A',
      category: '主食',
      unit: 'g',
      quantity: 12.5,
      nutrition: { calories: 88, protein: 3.5, carbs: 10, fat: 1.2, fiber: 0.3, sodium: 4.2 },
      proteinSource: 'mixed',
      proteinQuality: 'regular',
      naturalProtein: 2.1,
      specialProtein: 1.4
    }
  ]);

  assert.deepEqual(recipeItems, [
    {
      foodId: 'A',
      nameSnapshot: '食物A',
      category: '主食',
      unit: 'g',
      baseQuantity: 12.5,
      nutritionSnapshot: { calories: 88, protein: 3.5, carbs: 10, fat: 1.2, fiber: 0.3, sodium: 4.2 },
      proteinSource: 'mixed',
      proteinQuality: 'regular',
      naturalProtein: 2.1,
      specialProtein: 1.4
    }
  ]);
});

test('detectRecipeDrift returns updated base quantities derived from the current meal items', () => {
  const drift = detectRecipeDrift({
    items: [
      { foodId: 'A', nameSnapshot: '食物A', unit: 'g', baseQuantity: 10 },
      { foodId: 'C', nameSnapshot: '食物C', unit: 'g', baseQuantity: 25 }
    ]
  }, [
    { foodId: 'A', nameSnapshot: '食物A', unit: 'g', quantity: 7, nutrition: {}, naturalProtein: 0, specialProtein: 0 },
    { foodId: 'C', nameSnapshot: '食物C', unit: 'g', quantity: 20, nutrition: {}, naturalProtein: 0, specialProtein: 0 }
  ], 0.7);

  assert.equal(drift.changed, true);
  assert.deepEqual(drift.updatedItems.map((item) => item.baseQuantity), [10, 28.57]);
  assert.equal(drift.reason, 'quantity');
});

test('detectRecipeDrift marks membership changes when meal items differ from recipe composition', () => {
  const drift = detectRecipeDrift({
    items: [
      { foodId: 'A', nameSnapshot: '食物A', unit: 'g', baseQuantity: 10 }
    ]
  }, [
    { foodId: 'A', nameSnapshot: '食物A', unit: 'g', quantity: 10, nutrition: {}, naturalProtein: 0, specialProtein: 0 },
    { foodId: 'B', nameSnapshot: '食物B', unit: 'g', quantity: 5, nutrition: {}, naturalProtein: 0, specialProtein: 0 }
  ], 1);

  assert.equal(drift.changed, true);
  assert.equal(drift.reason, 'membership');
  assert.deepEqual(drift.updatedItems.map((item) => item.foodId), ['A', 'B']);
});

test('buildRecipeSourceMeta builds flattened recipe provenance for intake snapshots', () => {
  assert.deepEqual(
    buildRecipeSourceMeta({ _id: 'recipe_1', name: '早餐模板' }, 0.7, 10),
    {
      sourceType: 'recipe',
      recipeId: 'recipe_1',
      recipeNameSnapshot: '早餐模板',
      recipeConsumedRatio: 0.7,
      recipeBaseQuantity: 10,
      recipeScaledFromBase: true
    }
  );
});
