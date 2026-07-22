const test = require('node:test');
const assert = require('node:assert/strict');

const utilsPath = '../miniprogram/utils/dailySummaryV2Utils.js';

test('buildDailySummaryV2 stores natural and special milk volumes for analysis without reading feeding details', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);
  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-06-24',
    milkRecords: [
      {
        nutritionSummary: {
          totalVolume: 120,
          calories: 80,
          protein: 2,
          naturalProtein: 0.7,
          specialProtein: 1.3,
          carbs: 6,
          fat: 3
        },
        formulaComponents: [
          { kind: 'breast_milk', volume: 59 },
          { kind: 'formula_powder', proteinRole: 'special', waterVolume: 61 }
        ]
      },
      {
        nutritionSummary: {
          totalVolume: 90,
          calories: 60,
          protein: 1,
          naturalProtein: 1,
          specialProtein: 0,
          carbs: 4,
          fat: 2
        },
        formulaComponents: [
          { kind: 'formula_powder', proteinRole: 'regular', waterVolume: 90 }
        ]
      }
    ]
  });

  assert.equal(summary.milk.totalVolume, 210);
  assert.equal(summary.milk.naturalMilkVolume, 149);
  assert.equal(summary.milk.specialMilkVolume, 61);
});

test('buildDailySummaryV2 merges v2 milk, food, treatment, medication, and bowel sections', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);
  const input = {
    babyUid: 'baby-1',
    date: '2026-05-25',
    milkRecords: [
      {
        _id: 'milk-1',
        updatedAt: '2026-05-25T08:10:00.000Z',
        nutritionSummary: {
          totalVolume: 120,
          totalPowderWeight: 16.666,
          calories: 85.555,
          protein: 2.345,
          naturalProtein: 1.111,
          specialProtein: 1.234,
          zeroProteinCalories: 12.345
        }
      }
    ],
    foodIntakeRecords: [
      {
        _id: 'food-1',
        updatedAt: '2026-05-25T12:40:00.000Z',
        nutrition: {
          calories: 72.345,
          protein: 1.234,
          naturalProtein: 1.234,
          specialProtein: 0,
          fat: 0.456,
          carbs: 16.789,
          fiber: 0.222
        }
      },
      {
        _id: 'food-2',
        nutrition: {
          calories: 20,
          protein: 0.5,
          naturalProtein: 0,
          specialProtein: 0.5,
          fat: 0.1,
          carbs: 4,
          fiber: 0.1
        }
      }
    ],
    treatmentRecords: [
      {
        _id: 'treatment-1',
        updatedAt: '2026-05-25T14:00:00.000Z',
        summary: {
          totalCalories: 34.555,
          carbs: 8.666,
          protein: 0.111,
          fat: 0.222
        }
      }
    ],
    medicationRecords: [
      {
        _id: 'medication-1',
        medicationId: 'med-a',
        updatedAt: '2026-05-25T09:00:00.000Z'
      },
      {
        _id: 'medication-2',
        medicationId: 'med-b'
      }
    ],
    bowelRecords: [
      {
        _id: 'bowel-1',
        type: 'normal',
        recordTime: '2026-05-25T07:00:00.000Z'
      },
      {
        _id: 'bowel-2',
        stoolType: 'loose',
        recordTime: '2026-05-25T16:00:00.000Z',
        updatedAt: '2026-05-25T16:05:00.000Z'
      }
    ],
    waterRecords: [
      {
        _id: 'water-1',
        volumeMl: 30,
        updatedAt: '2026-05-25T10:00:00.000Z'
      },
      {
        _id: 'water-2',
        volumeMl: 20,
        updatedAt: '2026-05-25T15:30:00.000Z'
      }
    ]
  };
  const cloned = JSON.parse(JSON.stringify(input));

  const summary = buildDailySummaryV2(input);

  assert.deepEqual(input, cloned);
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.recordType, 'daily_summary');
  assert.equal(summary.source, 'summary_builder_v2');
  assert.equal(summary.status, 'active');
  assert.equal(summary.babyUid, 'baby-1');
  assert.equal(summary.date, '2026-05-25');
  assert.deepEqual(summary.milk, {
    totalVolume: 120,
    naturalMilkVolume: 0,
    specialMilkVolume: 0,
    totalPowderWeight: 16.67,
    calories: 85.56,
    protein: 2.35,
    naturalProtein: 1.11,
    specialProtein: 1.23,
    carbs: 0,
    fat: 0,
    zeroProteinCalories: 12.35
  });
  assert.deepEqual(summary.food, {
    calories: 92.35,
    protein: 1.73,
    naturalProtein: 1.23,
    specialProtein: 0.5,
    premiumProtein: 0,
    regularProtein: 1.23,
    fat: 0.56,
    carbs: 20.79,
    fiber: 0.32,
    fluidVolume: 0
  });
  assert.deepEqual(summary.treatment, {
    calories: 34.56,
    protein: 0.11,
    carbs: 8.67,
    fat: 0.22,
    fluidVolume: 0
  });
  assert.deepEqual(summary.medication, {
    totalRecords: 2,
    takenMedicationIds: ['med-a', 'med-b']
  });
  assert.deepEqual(summary.bowel, {
    totalRecords: 2,
    latestType: 'loose'
  });
  assert.deepEqual(summary.water, {
    totalVolume: 50,
    totalRecords: 2
  });
  assert.deepEqual(summary.macroSummary, {
    calories: 212.47,
    protein: 4.19,
    naturalProtein: 2.34,
    specialProtein: 1.73,
    carbs: 29.46,
    fat: 0.78
  });
  assert.deepEqual(summary.recordCounts, {
    milk: 1,
    food: 2,
    medication: 2,
    treatment: 1,
    bowel: 2,
    water: 2
  });
  assert.equal(summary.sourceUpdatedAt.feeding, '2026-05-25T08:10:00.000Z');
  assert.equal(summary.sourceUpdatedAt.food, '2026-05-25T12:40:00.000Z');
  assert.equal(summary.sourceUpdatedAt.treatment, '2026-05-25T14:00:00.000Z');
  assert.equal(summary.sourceUpdatedAt.medication, '2026-05-25T09:00:00.000Z');
  assert.equal(summary.sourceUpdatedAt.bowel, '2026-05-25T16:05:00.000Z');
  assert.equal(summary.sourceUpdatedAt.water, '2026-05-25T15:30:00.000Z');
  assert.equal(summary.isDirty, false);
});

test('mergeFoodNutrition splits natural/special protein for legacy top-level intakes and proteinSource fallback', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);

  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-05-25',
    foodIntakeRecords: [
      // 旧 feeding_records.intakes 结构：naturalProtein/specialProtein 在顶层
      {
        nutrition: { calories: 100, protein: 3, carbs: 10, fat: 2 },
        naturalProtein: 3,
        specialProtein: 0,
        proteinSource: 'natural'
      },
      // 顶层与 nutrition 都缺拆分，按 proteinSource=special 兜底
      {
        nutrition: { calories: 40, protein: 2, carbs: 4, fat: 1 },
        proteinSource: 'special'
      },
      // v2 food_intake_records 结构：naturalProtein 在 nutrition 内
      {
        nutrition: { calories: 50, protein: 1, naturalProtein: 1, specialProtein: 0, carbs: 5, fat: 1 }
      }
    ]
  });

  // 旧结构食物的天然/特殊蛋白必须正确拆分，而不是被算成 0
  assert.equal(summary.food.protein, 6);
  assert.equal(summary.food.naturalProtein, 4);
  assert.equal(summary.food.specialProtein, 2);
  assert.equal(summary.macroSummary.naturalProtein, 4);
  assert.equal(summary.macroSummary.specialProtein, 2);
});

test('buildDailySummaryV2 tracks premium and regular natural protein from food quality', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);

  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-06-28',
    foodIntakeRecords: [
      {
        proteinQuality: 'premium',
        nutrition: { calories: 10, protein: 1.37, naturalProtein: 1.37, specialProtein: 0 }
      },
      {
        proteinQuality: 'regular',
        nutrition: { calories: 12, protein: 0.75, naturalProtein: 0.75, specialProtein: 0 }
      },
      {
        proteinSource: 'special',
        nutrition: { calories: 30, protein: 2, specialProtein: 2 }
      },
      {
        foodSnapshot: { proteinQuality: 'premium' },
        nutrition: { calories: 14, protein: 1.46, naturalProtein: 1.46, specialProtein: 0 }
      }
    ]
  });

  assert.equal(summary.food.naturalProtein, 3.58);
  assert.equal(summary.food.specialProtein, 2);
  assert.equal(summary.food.premiumProtein, 2.83);
  assert.equal(summary.food.regularProtein, 0.75);
});

test('macroSummary includes milk carbs and fat from v2 nutritionSummary', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);

  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-05-25',
    milkRecords: [
      {
        _id: 'milk-1',
        nutritionSummary: {
          totalVolume: 120,
          calories: 80,
          protein: 2,
          naturalProtein: 1.2,
          specialProtein: 0.8,
          carbs: 8,
          fat: 4
        }
      }
    ]
  });

  // 奶的碳水/脂肪必须计入汇总，否则碳水/脂肪偏低、蛋白占比偏高
  assert.equal(summary.milk.carbs, 8);
  assert.equal(summary.milk.fat, 4);
  assert.equal(summary.macroSummary.carbs, 8);
  assert.equal(summary.macroSummary.fat, 4);
  assert.equal(summary.macroSummary.protein, 2);
});

test('basicInfo prefers growth_records_v2 over milk record snapshots', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);

  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-05-25',
    growthRecords: [
      {
        _id: 'growth-1',
        status: 'active',
        weight: '6.2',
        height: '61',
        naturalProteinCoefficient: '1.1',
        specialProteinCoefficient: '0.8',
        calorieCoefficient: '95',
        updatedAt: '2026-05-25T06:00:00.000Z'
      }
    ],
    milkRecords: [
      {
        _id: 'milk-1',
        basicInfoSnapshot: {
          weight: '5.9',
          height: '60',
          naturalProteinCoefficient: '1.0',
          specialProteinCoefficient: '0.7',
          calorieCoefficient: '90'
        }
      }
    ]
  });

  assert.deepEqual(summary.basicInfo, {
    weight: '6.2',
    height: '61',
    naturalProteinCoefficient: '1.1',
    specialProteinCoefficient: '0.8',
    calorieCoefficient: '95'
  });
  assert.equal(summary.sourceUpdatedAt.growth, '2026-05-25T06:00:00.000Z');
});

test('basicInfo recovers missing coefficients from milk snapshot when growth record only has body measurements', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);

  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-05-25',
    growthRecords: [
      {
        _id: 'growth-1',
        status: 'active',
        weight: '6.2',
        height: '61'
        // 旧版/运行时成长记录只存身高体重，没有蛋白系数
      }
    ],
    milkRecords: [
      {
        _id: 'milk-1',
        basicInfoSnapshot: {
          weight: '5.9',
          height: '60',
          naturalProteinCoefficient: '1.2',
          specialProteinCoefficient: '0.8',
          calorieCoefficient: '95'
        }
      }
    ]
  });

  // 身高体重以成长记录为准，缺失的蛋白系数回退到喂奶快照，避免“系数没有”。
  assert.deepEqual(summary.basicInfo, {
    weight: '6.2',
    height: '61',
    naturalProteinCoefficient: '1.2',
    specialProteinCoefficient: '0.8',
    calorieCoefficient: '95'
  });
});

test('missing data returns a zeroed daily summary shape', () => {
  const {
    createEmptyDailySummaryV2,
    buildDailySummaryV2
  } = require(utilsPath);

  assert.deepEqual(
    buildDailySummaryV2({ babyUid: 'baby-1', date: '2026-05-25' }),
    createEmptyDailySummaryV2('baby-1', '2026-05-25')
  );
});

test('buildDailySummaryV2 aggregates treatment and food fluid volumes for total liquid stats', () => {
  const {
    buildDailySummaryV2
  } = require(utilsPath);

  const summary = buildDailySummaryV2({
    babyUid: 'baby-1',
    date: '2026-07-22',
    foodIntakeRecords: [
      { unit: 'ml', quantity: 45, nutrition: { calories: 10 } },
      { unit: 'g', quantity: 30, nutrition: { calories: 20 } }
    ],
    treatmentRecords: [
      {
        summary: {
          totalCalories: 34,
          carbs: 8,
          protein: 0,
          fat: 0,
          fluidVolume: 120
        }
      },
      {
        groups: [
          {
            items: [
              { name: '10%葡萄糖', unit: 'ml', amount: 80, category: 'dextrose_10', calories: 27 },
              { name: '左卡尼丁', unit: 'mg', amount: 30 }
            ]
          }
        ]
      }
    ],
    waterRecords: [{ volumeMl: 35 }]
  });

  assert.equal(summary.food.fluidVolume, 45);
  assert.equal(summary.treatment.fluidVolume, 200);
  assert.equal(summary.water.totalVolume, 35);
});
