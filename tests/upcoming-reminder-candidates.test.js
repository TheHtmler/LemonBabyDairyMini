const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUpcomingReminderCandidates,
  pickUpcomingReminderCandidate
} = require('../miniprogram/utils/upcomingReminderCandidates');

test('buildUpcomingReminderCandidates filters past records and picks future milk food medication reminders', () => {
  const now = new Date('2026-06-29T12:00:00+08:00');
  const candidates = buildUpcomingReminderCandidates({
    now,
    milkRecords: [
      {
        _id: 'milk-past',
        startDateTime: new Date('2026-06-29T11:00:00+08:00'),
        nutritionSummary: { totalVolume: 90 }
      },
      {
        _id: 'milk-next',
        startDateTime: new Date('2026-06-29T15:00:00+08:00'),
        nutritionSummary: { totalVolume: 120 },
        formulaComponents: [
          { kind: 'breast_milk', volume: 60 },
          { kind: 'formula_powder', proteinRole: 'special', powderName: '特奶', waterVolume: 60 }
        ]
      }
    ],
    foodIntakeRecords: [
      {
        _id: 'food-a',
        date: '2026-06-29',
        recordedAt: '14:30',
        mealBatchId: 'meal-1',
        mealLabel: '午餐',
        foodName: '米糊',
        quantity: 20,
        unit: 'g'
      },
      {
        _id: 'food-b',
        date: '2026-06-29',
        recordedAt: '14:30',
        mealBatchId: 'meal-1',
        mealLabel: '午餐',
        foodName: '南瓜泥',
        quantity: 15,
        unit: 'g'
      },
      {
        _id: 'food-past',
        date: '2026-06-29',
        recordedAt: '10:00',
        foodName: '苹果泥',
        quantity: 10,
        unit: 'g'
      }
    ],
    medicationRecords: [
      {
        _id: 'med-next',
        medicationName: '左卡尼丁',
        actualDateTime: new Date('2026-06-29T13:00:00+08:00'),
        dosage: '1.5',
        unit: 'ml'
      }
    ]
  });

  assert.equal(candidates.milk.sourceRecordId, 'milk-next');
  assert.equal(candidates.milk.content, '该喂奶啦');
  assert.match(candidates.milk.note, /120ml/);

  assert.equal(candidates.food.sourceRecordId, 'meal-1');
  assert.equal(candidates.food.content, '该吃辅食啦');
  assert.match(candidates.food.note, /午餐/);
  assert.match(candidates.food.note, /米糊/);
  assert.match(candidates.food.note, /南瓜泥/);

  assert.equal(candidates.medication.sourceRecordId, 'med-next');
  assert.equal(candidates.medication.content, '左卡尼丁该用药啦');
  assert.match(candidates.medication.note, /1.5ml/);
});

test('pickUpcomingReminderCandidate returns nearest future record for requested type', () => {
  const now = new Date('2026-06-29T12:00:00+08:00');
  const candidates = buildUpcomingReminderCandidates({
    now,
    milkRecords: [
      { _id: 'milk-late', startDateTime: new Date('2026-06-29T16:00:00+08:00'), nutritionSummary: { totalVolume: 100 } },
      { _id: 'milk-early', startDateTime: new Date('2026-06-29T13:00:00+08:00'), nutritionSummary: { totalVolume: 80 } }
    ]
  });

  assert.equal(pickUpcomingReminderCandidate(candidates, 'milk').sourceRecordId, 'milk-early');
  assert.equal(pickUpcomingReminderCandidate(candidates, 'food'), null);
});
