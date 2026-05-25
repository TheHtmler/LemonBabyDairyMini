const test = require('node:test');
const assert = require('node:assert/strict');

const utilsPath = '../miniprogram/utils/dailySummaryV2Utils.js';

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
    totalPowderWeight: 16.67,
    calories: 85.56,
    protein: 2.35,
    naturalProtein: 1.11,
    specialProtein: 1.23,
    zeroProteinCalories: 12.35
  });
  assert.deepEqual(summary.food, {
    calories: 92.35,
    protein: 1.73,
    naturalProtein: 1.23,
    specialProtein: 0.5,
    fat: 0.56,
    carbs: 20.79,
    fiber: 0.32
  });
  assert.deepEqual(summary.treatment, {
    calories: 34.56,
    protein: 0.11,
    carbs: 8.67,
    fat: 0.22
  });
  assert.deepEqual(summary.medication, {
    totalRecords: 2,
    takenMedicationIds: ['med-a', 'med-b']
  });
  assert.deepEqual(summary.bowel, {
    totalRecords: 2,
    latestType: 'loose'
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
    bowel: 2
  });
  assert.equal(summary.sourceUpdatedAt.feeding, '2026-05-25T08:10:00.000Z');
  assert.equal(summary.sourceUpdatedAt.food, '2026-05-25T12:40:00.000Z');
  assert.equal(summary.sourceUpdatedAt.treatment, '2026-05-25T14:00:00.000Z');
  assert.equal(summary.sourceUpdatedAt.medication, '2026-05-25T09:00:00.000Z');
  assert.equal(summary.sourceUpdatedAt.bowel, '2026-05-25T16:05:00.000Z');
  assert.equal(summary.isDirty, false);
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
