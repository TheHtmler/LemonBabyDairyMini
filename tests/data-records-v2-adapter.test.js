const test = require('node:test');
const assert = require('node:assert/strict');

const {
  groupV2FeedingRecordsByDate
} = require('../miniprogram/utils/dataRecordsV2Adapter');

test('groupV2FeedingRecordsByDate groups active milk feedings by date with legacy-shaped feedings', () => {
  const result = groupV2FeedingRecordsByDate([
    {
      _id: 'r1',
      babyUid: 'baby-1',
      date: '2026-05-20',
      status: 'active',
      recordType: 'milk_feeding',
      startTime: '08:00',
      formulaComponents: [
        { kind: 'breast_milk', volume: 60, nutritionSnapshot: { protein: 1.1, calories: 67 } }
      ],
      nutritionSummary: { totalVolume: 60, calories: 40.2, naturalProtein: 0.66, specialProtein: 0 }
    },
    {
      _id: 'r2',
      babyUid: 'baby-1',
      date: '2026-05-20',
      status: 'active',
      recordType: 'milk_feeding',
      startTime: '11:00',
      formulaComponents: [
        { kind: 'breast_milk', volume: 50, nutritionSnapshot: { protein: 1.1, calories: 67 } }
      ],
      nutritionSummary: { totalVolume: 50, calories: 33.5, naturalProtein: 0.55, specialProtein: 0 }
    },
    {
      _id: 'r3',
      babyUid: 'baby-1',
      date: '2026-05-21',
      status: 'active',
      recordType: 'milk_feeding',
      startTime: '09:00',
      formulaComponents: [],
      nutritionSummary: { totalVolume: 0, calories: 0 }
    }
  ], 'baby-1');

  assert.equal(result.size, 2);
  const day20 = result.get('2026-05-20');
  assert.equal(day20.source, 'feeding_records_v2');
  assert.equal(day20.feedings.length, 2);
  assert.equal(day20.feedings[0].isV2FeedingRecord, true);
  assert.ok(day20.feedings[0].nutritionDisplay);
  assert.equal(result.get('2026-05-21').feedings.length, 1);
});

test('groupV2FeedingRecordsByDate skips archived records and daily basic info documents', () => {
  const result = groupV2FeedingRecordsByDate([
    {
      _id: 'archived',
      babyUid: 'baby-1',
      date: '2026-05-20',
      status: 'archived',
      recordType: 'milk_feeding',
      formulaComponents: []
    },
    {
      _id: 'basic-info',
      babyUid: 'baby-1',
      date: '2026-05-20',
      status: 'active',
      recordType: 'daily_basic_info',
      basicInfoSnapshot: { weight: 5.5 }
    }
  ], 'baby-1');

  assert.equal(result.size, 0);
});
