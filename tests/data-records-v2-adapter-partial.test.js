const test = require('node:test');
const assert = require('node:assert/strict');

const { createFeedingDisplayFromV2 } = require('../miniprogram/utils/dataRecordsV2Adapter');

test('createFeedingDisplayFromV2 exposes partialIntakeText', () => {
  const display = createFeedingDisplayFromV2({
    startTime: '09:30',
    formulaComponents: [{ kind: 'breast_milk', volume: 40, nutritionSnapshot: {} }],
    nutritionSummary: { calories: 1, carbs: 0, fat: 0, naturalProtein: 0, specialProtein: 0 },
    preparedFinalVolume: 155,
    leftoverVolume: 55,
    consumedBottleVolume: 100
  });
  assert.equal(display.partialIntakeText, '冲后 155 · 喝 100（剩 55）');
});

test('createFeedingDisplayFromV2 leaves partialIntakeText empty when fully finished', () => {
  const display = createFeedingDisplayFromV2({
    startTime: '09:30',
    formulaComponents: [{ kind: 'breast_milk', volume: 40, nutritionSnapshot: {} }],
    nutritionSummary: { calories: 1, carbs: 0, fat: 0, naturalProtein: 0, specialProtein: 0 }
  });
  assert.equal(display.partialIntakeText, '');
});
