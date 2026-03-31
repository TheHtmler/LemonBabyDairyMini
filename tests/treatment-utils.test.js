const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeTreatmentRecords,
  mergeTreatmentIntoMacroSummary,
  mergeTreatmentIntoOverview,
  createEmptyTreatmentOverview,
  formatTreatmentRecordsForDisplay,
  TREATMENT_ITEM_UNITS
} = require('../miniprogram/utils/treatmentUtils');

test('summarizeTreatmentRecords only counts nutrition-enabled items', () => {
  const records = [
    {
      groups: [
        {
          items: [
            {
              category: 'dextrose',
              countInNutrition: true,
              calories: 102,
              carbsG: 25.5,
              proteinG: 0,
              fatG: 0
            },
            {
              category: 'drug',
              countInNutrition: false,
              calories: 999,
              carbsG: 999,
              proteinG: 999,
              fatG: 999
            }
          ]
        }
      ]
    },
    {
      groups: [
        {
          items: [
            {
              category: 'lipid',
              countInNutrition: true,
              calories: 45,
              carbsG: 0,
              proteinG: 0,
              fatG: 5
            }
          ]
        }
      ]
    }
  ];

  assert.deepEqual(summarizeTreatmentRecords(records), {
    count: 2,
    groupCount: 2,
    itemCount: 3,
    nutritionItemCount: 2,
    totalCalories: 147,
    carbs: 25.5,
    protein: 0,
    fat: 5
  });
});

test('mergeTreatmentIntoMacroSummary adds treatment nutrition to existing summary', () => {
  const baseSummary = {
    calories: 320,
    protein: 12,
    naturalProtein: 8,
    specialProtein: 4,
    carbs: 30,
    fat: 10
  };

  const merged = mergeTreatmentIntoMacroSummary(baseSummary, [
    {
      groups: [
        {
          items: [
            {
              countInNutrition: true,
              calories: 80,
              carbsG: 20,
              proteinG: 0,
              fatG: 0
            }
          ]
        }
      ]
    }
  ]);

  assert.deepEqual(merged, {
    calories: 400,
    protein: 12,
    naturalProtein: 8,
    specialProtein: 4,
    carbs: 50,
    fat: 10
  });
});

test('mergeTreatmentIntoOverview appends treatment bucket without mutating milk and food', () => {
  const baseOverview = {
    milk: { totalCalories: 120, normal: {}, special: {} },
    food: { count: 1, totalCalories: 60, protein: 2, naturalProtein: 2, specialProtein: 0, carbs: 8, fat: 1 }
  };

  const merged = mergeTreatmentIntoOverview(baseOverview, [
    {
      groups: [
        {
          items: [
            {
              countInNutrition: true,
              calories: 68,
              carbsG: 17,
              proteinG: 0,
              fatG: 0
            },
            {
              countInNutrition: false,
              calories: 20,
              carbsG: 5,
              proteinG: 5,
              fatG: 5
            }
          ]
        }
      ]
    }
  ]);

  assert.equal(merged.milk.totalCalories, 120);
  assert.equal(merged.food.totalCalories, 60);
  assert.deepEqual(merged.treatment, {
    count: 1,
    groupCount: 1,
    itemCount: 2,
    nutritionItemCount: 1,
    totalCalories: 68,
    carbs: 17,
    protein: 0,
    fat: 0
  });
  assert.deepEqual(createEmptyTreatmentOverview(), {
    count: 0,
    groupCount: 0,
    itemCount: 0,
    nutritionItemCount: 0,
    totalCalories: 0,
    carbs: 0,
    protein: 0,
    fat: 0
  });
});

test('formatTreatmentRecordsForDisplay builds compact group summaries for list cards', () => {
  const formatted = formatTreatmentRecordsForDisplay([
    {
      _id: 'older',
      recordType: 'iv',
      startTime: '08:30',
      startDateTime: '2026-03-25T08:30:00+08:00',
      notes: '第一天住院补液观察耐受',
      summary: {
        totalCalories: 85,
        carbs: 25,
        protein: 0,
        fat: 0
      },
      groups: [
        {
          name: '第1组',
          items: [
            { name: '10%葡萄糖', amount: 250, unit: 'ml' },
            { name: '精氨酸', amount: 1, unit: '剂' }
          ]
        },
        {
          name: '第2组',
          items: [
            { name: '5%葡萄糖', amount: 250, unit: 'ml' },
            { name: '碳酸氢钠', amount: 5, unit: 'ml' }
          ]
        },
        {
          name: '第3组',
          items: [
            { name: '左卡尼丁', amount: 1, unit: '剂' }
          ]
        }
      ]
    },
    {
      _id: 'newer',
      recordType: 'iv',
      startTime: '10:00',
      startDateTime: '2026-03-25T10:00:00+08:00',
      summary: {
        totalCalories: 34,
        carbs: 10,
        protein: 0,
        fat: 0
      },
      items: [
        { category: 'dextrose_10', name: '10%葡萄糖', amount: 100, unit: 'ml' }
      ]
    }
  ]);

  assert.equal(formatted[0]._id, 'newer');
  assert.equal(formatted[0].groupCount, 1);
  assert.deepEqual(formatted[0].groupPreviewLines, [
    '第1组 · 10%葡萄糖 100ml'
  ]);

  assert.equal(formatted[1]._id, 'older');
  assert.equal(formatted[1].typeLabel, '输液');
  assert.deepEqual(formatted[1].groupPreviewLines, [
    '第1组 · 10%葡萄糖 250ml + 精氨酸 1剂',
    '第2组 · 5%葡萄糖 250ml + 碳酸氢钠 5ml',
    '第3组 · 左卡尼丁 1剂'
  ]);
  assert.equal(formatted[1].overflowGroupCount, 0);
  assert.equal(formatted[1].notePreview, '第一天住院补液观察耐受');
});

test('summarizeTreatmentRecords falls back to record summary for legacy treatment records', () => {
  const summary = summarizeTreatmentRecords([
    {
      summary: {
        totalCalories: 85,
        carbs: 25,
        protein: 0,
        fat: 0
      },
      groups: [
        {
          items: [
            {
              category: 'dextrose',
              name: '10%葡萄糖',
              amount: 250,
              unit: 'ml'
            }
          ]
        }
      ]
    }
  ]);

  assert.equal(summary.count, 1);
  assert.equal(summary.groupCount, 1);
  assert.equal(summary.itemCount, 1);
  assert.equal(summary.totalCalories, 85);
  assert.equal(summary.carbs, 25);
});

test('treatment unit options include 剂 for unclear medication units', () => {
  assert.equal(TREATMENT_ITEM_UNITS.includes('剂'), true);
});
