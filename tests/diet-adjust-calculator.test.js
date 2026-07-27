const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHARE_TOLERANCE,
  sumSharePercents,
  sharesAreValid,
  withEqualShares,
  solveDietAdjust,
  summarizeQuantities
} = require('../miniprogram/utils/dietAdjustCalculator');

test('sharesAreValid tolerates tiny float error', () => {
  assert.equal(sharesAreValid([50, 50]), true);
  assert.equal(sharesAreValid([33.33, 33.33, 33.34]), true);
  assert.equal(sharesAreValid([60, 30]), false);
  assert.ok(SHARE_TOLERANCE >= 0.05);
});

test('withEqualShares fills missing percents', () => {
  const rows = withEqualShares([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
  assert.equal(sumSharePercents(rows.map((r) => r.sharePercent)), 100);
});

test('solveDietAdjust protein mode auto-splits milk/food without manual shares', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 10,
    milkRatio: 0.7,
    foodRatio: 0.3,
    calorieTarget: 800,
    normalMilks: [
      {
        key: 'bm',
        kind: 'breast_milk',
        name: '母乳',
        proteinPerUnit: 0.011,
        caloriesPerUnit: 0.67,
        fatPerUnit: 0.035,
        carbsPerUnit: 0.07,
        premiumProteinPerUnit: 0.011,
        unit: 'ml'
      }
    ],
    specialMilks: [],
    energyPowders: [],
    foods: [
      {
        key: 'rice',
        kind: 'food',
        name: '米糊',
        proteinPerUnit: 0.02,
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
  assert.ok(Math.abs(milk.quantity - 7 / 0.011) < 1);
  assert.ok(Math.abs(food.quantity - 3 / 0.02) < 0.2);
  assert.ok(Math.abs(result.achieved.protein - 10) < 0.2);
});

test('solveDietAdjust splits normal/special by protein coefficients', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 10,
    milkRatio: 1,
    foodRatio: 0,
    naturalProteinCoefficient: 1.2,
    specialProteinCoefficient: 0.8,
    normalMilks: [
      {
        key: 'n1',
        kind: 'formula_powder',
        name: '普奶A',
        proteinPerUnit: 0.12,
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

test('energy powder only fills calorie gap and does not take protein share', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 10,
    milkRatio: 1,
    foodRatio: 0,
    calorieTarget: 200,
    normalMilks: [
      {
        key: 'bm',
        kind: 'breast_milk',
        name: '母乳',
        proteinPerUnit: 0.011,
        caloriesPerUnit: 0.1,
        unit: 'ml'
      }
    ],
    specialMilks: [],
    energyPowders: [
      {
        key: 'e1',
        kind: 'formula_powder',
        name: '能量粉',
        proteinPerUnit: 0,
        caloriesPerUnit: 5,
        unit: 'g',
        mixRatio: { powder: 10, water: 30 }
      }
    ],
    foods: []
  });

  assert.equal(result.ok, true);
  const milk = result.items.find((i) => i.key === 'bm');
  const energy = result.items.find((i) => i.key === 'e1');
  assert.ok(milk);
  assert.ok(energy);
  assert.equal(energy.role, 'energy');
  assert.equal(energy.energyNote, '用来补热量');
  // 母乳约 10/0.011 ml * 0.1 kcal ≈ 90.9，缺口约 109 → 能量粉约 21.8g
  assert.ok(energy.quantity > 20);
  assert.ok(result.achieved.calories >= 195);
});

test('rejects milk ratio with only energy powder selected', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 10,
    milkRatio: 0.7,
    foodRatio: 0.3,
    normalMilks: [],
    specialMilks: [],
    energyPowders: [{
      key: 'e1',
      kind: 'formula_powder',
      name: '能量粉',
      caloriesPerUnit: 5,
      proteinPerUnit: 0,
      unit: 'g'
    }],
    foods: [{
      key: 'f',
      kind: 'food',
      name: '粥',
      proteinPerUnit: 0.02,
      caloriesPerUnit: 0.5,
      unit: 'g'
    }]
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /能量粉|普奶|特奶/);
});

test('soft targets produce gaps and hints', () => {
  const result = solveDietAdjust({
    mode: 'protein',
    target: 5,
    milkRatio: 0,
    foodRatio: 1,
    softTargets: {
      fat: 20,
      carbs: 30,
      premiumProtein: 4
    },
    normalMilks: [],
    specialMilks: [],
    foods: [
      {
        key: 'veg',
        kind: 'food',
        name: '蔬菜泥',
        proteinPerUnit: 0.02,
        caloriesPerUnit: 0.4,
        fatPerUnit: 0.01,
        carbsPerUnit: 0.05,
        premiumProteinPerUnit: 0,
        unit: 'g'
      },
      {
        key: 'meat',
        kind: 'food',
        name: '肉泥',
        proteinPerUnit: 0.05,
        caloriesPerUnit: 1,
        fatPerUnit: 0.03,
        carbsPerUnit: 0.01,
        premiumProteinPerUnit: 0.05,
        unit: 'g'
      }
    ]
  });
  assert.equal(result.ok, true);
  assert.ok(result.gaps.fat > 0);
  assert.ok(result.hints.length > 0);
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
});
