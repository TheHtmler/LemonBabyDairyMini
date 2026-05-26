const test = require('node:test');
const assert = require('node:assert/strict');

const {
  roundNumber,
  scaleNutrition,
  calculateActualMealItems,
  normalizeCompletionPercent,
  validateCompletionPercent,
  buildMealCombinationFromDraft,
  buildMealItemsFromCombination
} = require('../miniprogram/utils/mealCombinationUtils');

function createFood(overrides = {}) {
  return {
    _id: 'food-rice',
    name: '米粉',
    category: 'grain',
    baseQuantity: 100,
    baseUnit: 'g',
    proteinSource: 'natural',
    proteinQuality: 'complete',
    milkType: '',
    nutritionPerUnit: {
      calories: 360,
      protein: 7,
      carbs: 80,
      fat: 1,
      fiber: 2,
      sodium: 12
    },
    ...overrides
  };
}

function createPlannedMealItem(overrides = {}) {
  const food = createFood();
  const plannedNutrition = {
    calories: 72.33,
    protein: 1.47,
    naturalProtein: 1.47,
    specialProtein: 0,
    carbs: 16.11,
    fat: 0.23,
    fiber: 0.42,
    sodium: 2.55
  };
  const {
    plannedNutrition: plannedNutritionOverride,
    nutrition: nutritionOverride,
    naturalProtein,
    specialProtein,
    ...restOverrides
  } = overrides;
  const resolvedPlannedNutrition = plannedNutritionOverride || plannedNutrition;
  const resolvedNutrition = nutritionOverride || resolvedPlannedNutrition;

  return {
    localId: 'meal_item_original',
    foodId: food._id,
    food,
    nameSnapshot: food.name,
    category: food.category,
    unit: food.baseUnit,
    quantity: 20,
    plannedQuantity: 20,
    plannedNutrition: { ...resolvedPlannedNutrition },
    nutrition: { ...resolvedNutrition },
    proteinSource: 'natural',
    proteinQuality: 'complete',
    naturalProtein: naturalProtein ?? resolvedPlannedNutrition.naturalProtein,
    specialProtein: specialProtein ?? resolvedPlannedNutrition.specialProtein,
    milkType: '',
    notes: '午餐',
    ...restOverrides
  };
}

test('scaleNutrition rounds all nutrition fields to 2 decimals', () => {
  const result = scaleNutrition(
    {
      calories: 101.11,
      protein: 5.555,
      naturalProtein: 3.333,
      specialProtein: 2.222,
      carbs: 10.555,
      fat: 1.335,
      fiber: 0.555,
      sodium: 99.999
    },
    0.5
  );

  assert.deepEqual(result, {
    calories: 50.56,
    protein: 2.78,
    naturalProtein: 1.67,
    specialProtein: 1.11,
    carbs: 5.28,
    fat: 0.67,
    fiber: 0.28,
    sodium: 50
  });
});

test('scaleNutrition scales natural and special protein from the planned nutrition payload', () => {
  const result = scaleNutrition(
    {
      calories: 40,
      protein: 6,
      naturalProtein: 1.23,
      specialProtein: 4.77,
      carbs: 8,
      fat: 2,
      fiber: 1,
      sodium: 12
    },
    0.5
  );

  assert.equal(result.naturalProtein, 0.62);
  assert.equal(result.specialProtein, 2.39);
});

test('scaleNutrition keeps fractional calories at 2 decimals instead of integer rounding', () => {
  const result = scaleNutrition(
    {
      calories: 101.11,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sodium: 0
    },
    0.5
  );

  assert.equal(result.calories, 50.56);
});

test('roundNumber normalizes invalid or non-integer precision to 2 decimals', () => {
  assert.equal(roundNumber(1.2345, 1.5), 1.23);
  assert.equal(roundNumber(1.2345, 'bad'), 1.23);
  assert.equal(roundNumber(1.2345, -1), 1.23);
  assert.equal(roundNumber(1.2345, 0), 1);
});

test('calculateActualMealItems preserves planned item fields and scales quantity and nutrition by completion percent', () => {
  const item = createPlannedMealItem();
  const itemBefore = JSON.parse(JSON.stringify(item));

  const [actualItem] = calculateActualMealItems([item], 50);

  assert.deepEqual(item, itemBefore);
  assert.equal(actualItem.plannedQuantity, 20);
  assert.deepEqual(actualItem.plannedNutrition, item.plannedNutrition);
  assert.equal(actualItem.quantity, 10);
  assert.deepEqual(actualItem.nutrition, {
    calories: 36.17,
    protein: 0.74,
    naturalProtein: 0.74,
    specialProtein: 0,
    carbs: 8.06,
    fat: 0.12,
    fiber: 0.21,
    sodium: 1.28
  });
});

test('calculateActualMealItems returns top-level protein split consistent with scaled nutrition', () => {
  const item = createPlannedMealItem({
    plannedNutrition: {
      calories: 80,
      protein: 3,
      naturalProtein: 1.2,
      specialProtein: 1.8,
      carbs: 10,
      fat: 2,
      fiber: 1,
      sodium: 20
    },
    nutrition: {
      calories: 80,
      protein: 3,
      naturalProtein: 1.2,
      specialProtein: 1.8,
      carbs: 10,
      fat: 2,
      fiber: 1,
      sodium: 20
    },
    naturalProtein: 99,
    specialProtein: 88
  });

  const [actualItem] = calculateActualMealItems([item], 50);

  assert.equal(actualItem.naturalProtein, 0.6);
  assert.equal(actualItem.specialProtein, 0.9);
  assert.equal(actualItem.naturalProtein, actualItem.nutrition.naturalProtein);
  assert.equal(actualItem.specialProtein, actualItem.nutrition.specialProtein);
});

test('calculateActualMealItems keeps fractional calories rounded per item for multi-food meals', () => {
  const items = [
    createPlannedMealItem({
      localId: 'meal_item_1',
      plannedNutrition: {
        calories: 7.77,
        protein: 0.2,
        naturalProtein: 0.2,
        specialProtein: 0,
        carbs: 1,
        fat: 0.1,
        fiber: 0,
        sodium: 0
      },
      nutrition: {
        calories: 7.77,
        protein: 0.2,
        naturalProtein: 0.2,
        specialProtein: 0,
        carbs: 1,
        fat: 0.1,
        fiber: 0,
        sodium: 0
      }
    }),
    createPlannedMealItem({
      localId: 'meal_item_2',
      plannedNutrition: {
        calories: 11.11,
        protein: 0.4,
        naturalProtein: 0,
        specialProtein: 0.4,
        carbs: 2,
        fat: 0.2,
        fiber: 0,
        sodium: 0
      },
      nutrition: {
        calories: 11.11,
        protein: 0.4,
        naturalProtein: 0,
        specialProtein: 0.4,
        carbs: 2,
        fat: 0.2,
        fiber: 0,
        sodium: 0
      }
    })
  ];

  const actualItems = calculateActualMealItems(items, 50);

  assert.deepEqual(actualItems.map(item => item.nutrition.calories), [3.89, 5.56]);
});

test('validateCompletionPercent accepts 1-100 and rejects empty, zero, negative, and above-100 values', () => {
  assert.deepEqual(validateCompletionPercent(1), { valid: true, value: 1 });
  assert.deepEqual(validateCompletionPercent(50), { valid: true, value: 50 });
  assert.deepEqual(validateCompletionPercent('50'), { valid: true, value: 50 });
  assert.deepEqual(validateCompletionPercent(100), { valid: true, value: 100 });

  for (const value of ['', null, undefined, 0, -1, 100.01, true, false, [50], {}]) {
    const result = validateCompletionPercent(value);

    assert.equal(result.valid, false);
    assert.equal(typeof result.message, 'string');
    assert.ok(result.message.length > 0);
  }
});

test('normalizeCompletionPercent uses fallback for non-number and non-numeric-string values', () => {
  for (const value of [true, false, [50], {}]) {
    assert.equal(normalizeCompletionPercent(value, 80), 80);
  }
});

test('buildMealCombinationFromDraft stores current meal items as planned quantities and food snapshots', () => {
  const food = createFood({
    _id: 'food-apple',
    name: '苹果泥',
    category: 'fruit',
    baseUnit: 'g',
    proteinSource: 'natural',
    nutritionPerUnit: {
      calories: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
      fiber: 2.4,
      sodium: 1
    }
  });
  const mealDraft = {
    mealTime: '12:30',
    mealLabel: '午餐',
    mealNote: '吃了一半',
    items: [
      createPlannedMealItem({
        foodId: food._id,
        food,
        nameSnapshot: food.name,
        category: food.category,
        quantity: 35,
        nutrition: {
          calories: 18.2,
          protein: 0.11,
          naturalProtein: 0.11,
          specialProtein: 0,
          carbs: 4.9,
          fat: 0.07,
          fiber: 0.84,
          sodium: 0.35
        },
        notes: '细腻一点'
      })
    ]
  };

  const combination = buildMealCombinationFromDraft(mealDraft, '午餐模板');

  assert.equal(combination.name, '午餐模板');
  assert.equal(combination.items.length, 1);
  const [combinationItem] = combination.items;

  assert.equal(combinationItem.foodId, 'food-apple');
  assert.equal(combinationItem.foodName, '苹果泥');
  assert.equal(combinationItem.unit, 'g');
  assert.equal(combinationItem.notes, '细腻一点');
  assert.equal(combinationItem.plannedQuantity, 35);
  assert.deepEqual(combinationItem.plannedNutrition, mealDraft.items[0].nutrition);
  assert.deepEqual(combinationItem.foodSnapshot, {
    name: '苹果泥',
    category: 'fruit',
    proteinSource: 'natural',
    baseQuantity: 100,
    baseUnit: 'g',
    nutritionPerUnit: {
      calories: 52,
      protein: 0.3,
      carbs: 14,
      fat: 0.2,
      fiber: 2.4,
      sodium: 1
    },
    proteinQuality: 'complete',
    milkType: ''
  });
});

test('buildMealCombinationFromDraft preserves nutritionPer100g snapshots from v2 meal items', () => {
  const mealDraft = {
    mealNote: '从 v2 餐次保存',
    items: [
      createPlannedMealItem({
        foodId: 'food-pumpkin',
        food: null,
        foodSnapshot: {
          name: '南瓜泥',
          category: 'vegetable',
          proteinSource: 'natural',
          baseUnit: 'g',
          nutritionPer100g: {
            calories: 90,
            protein: 1.8,
            carbs: 18,
            fat: 0.4,
            fiber: 2.6,
            sodium: 4
          }
        },
        nameSnapshot: '南瓜泥',
        category: 'vegetable',
        unit: 'g',
        quantity: 25,
        plannedQuantity: 25,
        plannedNutrition: {
          calories: 22.5,
          protein: 0.45,
          naturalProtein: 0.45,
          specialProtein: 0,
          carbs: 4.5,
          fat: 0.1,
          fiber: 0.65,
          sodium: 1
        }
      })
    ]
  };

  const [combinationItem] = buildMealCombinationFromDraft(mealDraft, '南瓜午餐').items;

  assert.deepEqual(combinationItem.plannedNutrition, mealDraft.items[0].plannedNutrition);
  assert.deepEqual(combinationItem.foodSnapshot.nutritionPerUnit, {
    calories: 90,
    protein: 1.8,
    carbs: 18,
    fat: 0.4,
    fiber: 2.6,
    sodium: 4
  });
  assert.deepEqual(combinationItem.foodSnapshot.nutritionPer100g, {
    calories: 90,
    protein: 1.8,
    carbs: 18,
    fat: 0.4,
    fiber: 2.6,
    sodium: 4
  });
  assert.equal(combinationItem.foodSnapshot.baseQuantity, 100);
});

test('buildMealItemsFromCombination prefers current food catalog data for the same foodId', () => {
  const currentFood = createFood({
    _id: 'food-rice',
    name: '新米粉',
    category: 'updated-grain',
    proteinSource: 'special',
    nutritionPerUnit: {
      calories: 400,
      protein: 8,
      carbs: 82,
      fat: 2,
      fiber: 3,
      sodium: 10
    }
  });
  const combination = {
    items: [
      {
        localId: 'combo_item_1',
        foodId: 'food-rice',
        foodName: '旧米粉',
        plannedQuantity: 25,
        unit: 'g',
        foodSnapshot: {
          name: '旧米粉',
          category: 'old-grain',
          proteinSource: 'natural',
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 360,
            protein: 7,
            carbs: 80,
            fat: 1,
            fiber: 2,
            sodium: 12
          }
        }
      }
    ]
  };

  const [item] = buildMealItemsFromCombination(combination, [currentFood]);

  assert.equal(item.foodId, 'food-rice');
  assert.equal(item.nameSnapshot, '新米粉');
  assert.equal(item.category, 'updated-grain');
  assert.equal(item.proteinSource, 'special');
  assert.deepEqual(item.nutrition, {
    calories: 100,
    protein: 2,
    naturalProtein: 0,
    specialProtein: 2,
    carbs: 20.5,
    fat: 0.5,
    fiber: 0.75,
    sodium: 2.5
  });
});

test('buildMealItemsFromCombination falls back to the combination snapshot when catalog food is missing', () => {
  const combination = {
    items: [
      {
        localId: 'combo_item_1',
        foodId: 'food-snapshot-only',
        foodName: '快照土豆泥',
        plannedQuantity: 30,
        unit: 'g',
        notes: '用旧数据',
        foodSnapshot: {
          name: '快照土豆泥',
          category: 'vegetable',
          proteinSource: 'natural',
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 77,
            protein: 2,
            carbs: 17,
            fat: 0.1,
            fiber: 2.2,
            sodium: 6
          },
          proteinQuality: 'incomplete',
          milkType: ''
        }
      }
    ]
  };

  const [item] = buildMealItemsFromCombination(combination, []);

  assert.equal(item.foodId, 'food-snapshot-only');
  assert.equal(item.nameSnapshot, '快照土豆泥');
  assert.equal(item.category, 'vegetable');
  assert.equal(item.quantity, 30);
  assert.deepEqual(item.nutrition, {
    calories: 23.1,
    protein: 0.6,
    naturalProtein: 0.6,
    specialProtein: 0,
    carbs: 5.1,
    fat: 0.03,
    fiber: 0.66,
    sodium: 1.8
  });
  assert.equal(item.notes, '用旧数据');
});

test('buildMealItemsFromCombination uses plannedNutrition for snapshot fallback when available', () => {
  const plannedNutrition = {
    calories: 18.75,
    protein: 0.6,
    naturalProtein: 0.4,
    specialProtein: 0.2,
    carbs: 3,
    fat: 0.5,
    fiber: 0.2,
    sodium: 1.5
  };
  const combination = {
    items: [
      {
        foodId: 'food-snapshot-only',
        foodName: '快照辅食',
        plannedQuantity: 25,
        plannedNutrition,
        unit: 'g',
        foodSnapshot: {
          name: '快照辅食',
          category: 'vegetable',
          proteinSource: 'natural',
          baseUnit: 'g'
        }
      }
    ]
  };

  const [item] = buildMealItemsFromCombination(combination, []);

  assert.deepEqual(item.plannedNutrition, plannedNutrition);
  assert.deepEqual(item.nutrition, plannedNutrition);
  assert.equal(item.naturalProtein, 0.4);
  assert.equal(item.specialProtein, 0.2);
});

test('buildMealItemsFromCombination calculates snapshot fallback from nutritionPer100g when baseQuantity is missing', () => {
  const combination = {
    items: [
      {
        foodId: 'food-snapshot-100g',
        foodName: '快照山药泥',
        plannedQuantity: 30,
        unit: 'g',
        foodSnapshot: {
          name: '快照山药泥',
          category: 'vegetable',
          proteinSource: 'natural',
          baseUnit: 'g',
          nutritionPer100g: {
            calories: 118,
            protein: 1.5,
            carbs: 28,
            fat: 0.2,
            fiber: 4.1,
            sodium: 3
          }
        }
      }
    ]
  };

  const [item] = buildMealItemsFromCombination(combination, []);

  assert.deepEqual(item.nutrition, {
    calories: 35.4,
    protein: 0.45,
    naturalProtein: 0.45,
    specialProtein: 0,
    carbs: 8.4,
    fat: 0.06,
    fiber: 1.23,
    sodium: 0.9
  });
  assert.deepEqual(item.foodSnapshot.nutritionPerUnit, {
    calories: 118,
    protein: 1.5,
    carbs: 28,
    fat: 0.2,
    fiber: 4.1,
    sodium: 3
  });
});

test('buildMealItemsFromCombination normalizes mixed protein split weights', () => {
  const createMixedCombination = (proteinSplit) => ({
    items: [
      {
        foodId: 'food-mixed',
        foodName: '混合蛋白粉',
        plannedQuantity: 50,
        unit: 'g',
        foodSnapshot: {
          name: '混合蛋白粉',
          category: 'powder',
          proteinSource: 'mixed',
          proteinSplit,
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 100,
            protein: 6,
            carbs: 10,
            fat: 1,
            fiber: 0,
            sodium: 2
          }
        }
      }
    ]
  });

  const [equalSplitItem] = buildMealItemsFromCombination(createMixedCombination({ natural: 1, special: 1 }), []);
  const [weightedSplitItem] = buildMealItemsFromCombination(createMixedCombination({ natural: 2, special: 1 }), []);

  assert.equal(equalSplitItem.nutrition.protein, 3);
  assert.equal(equalSplitItem.nutrition.naturalProtein, 1.5);
  assert.equal(equalSplitItem.nutrition.specialProtein, 1.5);
  assert.equal(weightedSplitItem.nutrition.protein, 3);
  assert.equal(weightedSplitItem.nutrition.naturalProtein, 2);
  assert.equal(weightedSplitItem.nutrition.specialProtein, 1);
});

test('buildMealCombinationFromDraft preserves snapshot-only food fields after fallback item reuse', () => {
  const combination = {
    items: [
      {
        foodId: 'food-snapshot-only',
        foodName: '快照混合粉',
        plannedQuantity: 30,
        unit: 'g',
        foodSnapshot: {
          name: '快照混合粉',
          category: 'powder',
          proteinSource: 'mixed',
          proteinSplit: { natural: 2, special: 1 },
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 200,
            protein: 9,
            carbs: 20,
            fat: 2,
            fiber: 1,
            sodium: 3
          },
          proteinQuality: 'partial',
          milkType: 'none'
        }
      }
    ]
  };
  const [draftItem] = buildMealItemsFromCombination(combination, []);

  const savedCombination = buildMealCombinationFromDraft({ items: [draftItem] }, '快照组合');
  const [savedItem] = savedCombination.items;

  assert.deepEqual(savedItem.foodSnapshot, {
    name: '快照混合粉',
    category: 'powder',
    proteinSource: 'mixed',
    proteinSplit: { natural: 2, special: 1 },
    baseQuantity: 100,
    baseUnit: 'g',
    nutritionPerUnit: {
      calories: 200,
      protein: 9,
      carbs: 20,
      fat: 2,
      fiber: 1,
      sodium: 3
    },
    proteinQuality: 'partial',
    milkType: 'none'
  });
});

test('buildMealItemsFromCombination generates new localIds without mutating combination items', () => {
  const combination = {
    items: [
      {
        localId: 'combo_item_original',
        foodId: 'food-rice',
        foodName: '米粉',
        plannedQuantity: 20,
        unit: 'g',
        foodSnapshot: {
          name: '米粉',
          category: 'grain',
          proteinSource: 'natural',
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 360,
            protein: 7,
            carbs: 80,
            fat: 1,
            fiber: 2,
            sodium: 12
          }
        }
      }
    ]
  };
  const before = JSON.parse(JSON.stringify(combination.items));

  const [item] = buildMealItemsFromCombination(combination, []);

  assert.match(item.localId, /^meal_item_/);
  assert.notEqual(item.localId, 'combo_item_original');
  assert.notEqual(item, combination.items[0]);
  assert.deepEqual(combination.items, before);
});
