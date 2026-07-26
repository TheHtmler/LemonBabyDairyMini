const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHARE_TOLERANCE,
  sumSharePercents,
  sharesAreValid,
  solveDietAdjust,
  summarizeQuantities
} = require('../miniprogram/utils/dietAdjustCalculator');

test('sharesAreValid tolerates tiny float error', () => {
  assert.equal(sharesAreValid([50, 50]), true);
  assert.equal(sharesAreValid([33.33, 33.33, 33.34]), true);
  assert.equal(sharesAreValid([60, 30]), false);
  assert.ok(SHARE_TOLERANCE >= 0.05);
});

test('solveDietAdjust protein mode splits milk/food and item shares', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 10,
    milkRatio: 0.7,
    foodRatio: 0.3,
    normalMilkOfMilkRatio: 1,
    specialMilkOfMilkRatio: 0,
    normalMilks: [
      {
        key: 'bm',
        kind: 'breast_milk',
        name: '母乳',
        sharePercent: 100,
        proteinPerUnit: 0.011, // 1.1g/100ml
        caloriesPerUnit: 0.67,
        fatPerUnit: 0.035,
        carbsPerUnit: 0.07,
        premiumProteinPerUnit: 0.011,
        unit: 'ml'
      }
    ],
    specialMilks: [],
    foods: [
      {
        key: 'rice',
        kind: 'food',
        name: '米糊',
        sharePercent: 100,
        proteinPerUnit: 0.02, // 2g / 100g basis → per g
        caloriesPerUnit: 0.8,
        fatPerUnit: 0.01,
        carbsPerUnit: 0.15,
        premiumProteinPerUnit: 0,
        unit: 'g'
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  const milk = result.items.find((i) => i.key === 'bm');
  const food = result.items.find((i) => i.key === 'rice');
  // milk protein 7g → volume = 7 / 0.011 ≈ 636 ml（取整）
  assert.ok(Math.abs(milk.quantity - 7 / 0.011) < 1);
  assert.ok(Math.abs(food.quantity - 3 / 0.02) < 0.2);
  assert.ok(Math.abs(result.achieved.protein - 10) < 0.2);
});

test('solveDietAdjust splits normal/special milk side ratios', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 10,
    milkRatio: 1,
    foodRatio: 0,
    normalMilkOfMilkRatio: 0.6,
    specialMilkOfMilkRatio: 0.4,
    normalMilks: [
      {
        key: 'n1',
        kind: 'formula_powder',
        name: '普奶A',
        sharePercent: 100,
        proteinPerUnit: 0.12, // g protein / g powder
        caloriesPerUnit: 5,
        fatPerUnit: 0.25,
        carbsPerUnit: 0.5,
        premiumProteinPerUnit: 0.12,
        unit: 'g',
        mixRatio: { powder: 13.5, water: 90 }
      }
    ],
    specialMilks: [
      {
        key: 's1',
        kind: 'formula_powder',
        name: '特奶B',
        sharePercent: 100,
        proteinPerUnit: 0.13,
        caloriesPerUnit: 4.8,
        fatPerUnit: 0.2,
        carbsPerUnit: 0.55,
        premiumProteinPerUnit: 0,
        unit: 'g',
        mixRatio: { powder: 13.5, water: 90 }
      }
    ],
    foods: []
  });

  assert.equal(result.ok, true);
  const n = result.items.find((i) => i.key === 'n1');
  const s = result.items.find((i) => i.key === 's1');
  assert.ok(Math.abs(n.allocatedTarget - 6) < 0.01);
  assert.ok(Math.abs(s.allocatedTarget - 4) < 0.01);
  assert.ok(n.waterVolume > 0);
});

test('solveDietAdjust rejects invalid shares and missing density', () => {
  const badShare = solveDietAdjust({
    mode: 'protein',
    target: 5,
    milkRatio: 0.5,
    foodRatio: 0.5,
    normalMilks: [{
      key: 'a', kind: 'breast_milk', name: '母乳', sharePercent: 60,
      proteinPerUnit: 0.01, caloriesPerUnit: 0.6, unit: 'ml'
    }],
    specialMilks: [],
    foods: [{
      key: 'f', kind: 'food', name: '粥', sharePercent: 100,
      proteinPerUnit: 0.02, caloriesPerUnit: 0.5, unit: 'g'
    }]
  });
  assert.equal(badShare.ok, false);

  const badDensity = solveDietAdjust({
    mode: 'calorie',
    target: 500,
    milkRatio: 1,
    foodRatio: 0,
    normalMilks: [{
      key: 'a', kind: 'breast_milk', name: '母乳', sharePercent: 100,
      proteinPerUnit: 0.01, caloriesPerUnit: 0, unit: 'ml'
    }],
    specialMilks: [],
    foods: []
  });
  assert.equal(badDensity.ok, false);
});

test('summarizeQuantities recomputes macros after tweak', () => {
  const items = [
    {
      key: 'bm',
      quantity: 100,
      proteinPerUnit: 0.011,
      caloriesPerUnit: 0.67,
      fatPerUnit: 0.035,
      carbsPerUnit: 0.07,
      premiumProteinPerUnit: 0.011
    }
  ];
  const summary = summarizeQuantities(items);
  assert.ok(Math.abs(summary.protein - 1.1) < 0.01);
  assert.ok(Math.abs(summary.calories - 67) < 0.5);
  assert.equal(sumSharePercents([40, 60]), 100);
});
