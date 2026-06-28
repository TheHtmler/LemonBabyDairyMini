const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGrowthCurvePointsForRecord,
  normalizeGrowthCurvePointsForChart
} = require('../miniprogram/utils/growthCurvePointUtils');

test('buildGrowthCurvePointsForRecord creates separate weight and height points', () => {
  const points = buildGrowthCurvePointsForRecord({
    _id: 'growth-1',
    babyUid: 'baby-1',
    date: '2026-06-02',
    source: 'data_records_v2',
    weight: '10.2',
    height: 75
  });

  assert.deepEqual(points, [
    {
      babyUid: 'baby-1',
      date: '2026-06-02',
      metric: 'weight',
      value: 10.2,
      sourceRecordId: 'growth-1',
      source: 'data_records_v2',
      status: 'active',
      schemaVersion: 1
    },
    {
      babyUid: 'baby-1',
      date: '2026-06-02',
      metric: 'height',
      value: 75,
      sourceRecordId: 'growth-1',
      source: 'data_records_v2',
      status: 'active',
      schemaVersion: 1
    }
  ]);
});

test('buildGrowthCurvePointsForRecord excludes automatic carry-forward records', () => {
  const points = buildGrowthCurvePointsForRecord({
    _id: 'growth-1',
    babyUid: 'baby-1',
    date: '2026-06-03',
    source: 'daily_record_v2_carry_forward',
    weight: 10.2,
    height: 75
  });

  assert.deepEqual(points, []);
});

test('buildGrowthCurvePointsForRecord excludes backfilled carry-forward records', () => {
  const points = buildGrowthCurvePointsForRecord({
    _id: 'growth-1',
    babyUid: 'baby-1',
    date: '2026-06-03',
    source: 'carry_forward_backfill',
    weight: 10.2,
    height: 75
  });

  assert.deepEqual(points, []);
});

test('buildGrowthCurvePointsForRecord keeps migrated legacy feeding height measurements', () => {
  const points = buildGrowthCurvePointsForRecord({
    _id: 'growth-1',
    babyUid: 'baby-1',
    date: '2026-06-03',
    source: 'legacy_feeding_basic_info',
    weight: 10.2,
    height: 75
  });

  assert.deepEqual(points.map(point => point.metric), ['weight', 'height']);
});

test('normalizeGrowthCurvePointsForChart maps indexed points to chart measurements', () => {
  const records = normalizeGrowthCurvePointsForChart({
    babyInfo: { birthday: '2026-05-15' },
    points: [
      {
        _id: 'point-weight',
        babyUid: 'baby-1',
        date: '2026-06-30',
        metric: 'weight',
        value: 4.8,
        status: 'active'
      },
      {
        _id: 'point-height',
        babyUid: 'baby-1',
        date: '2026-06-30',
        metric: 'height',
        value: 57,
        status: 'active'
      }
    ]
  });

  assert.deepEqual(records.map(record => ({
    date: record.recordDateText,
    xMonth: record.xMonth,
    weight: record.weight,
    length: record.length
  })), [
    { date: '2026-06-30', xMonth: 1.5, weight: 4.8, length: null },
    { date: '2026-06-30', xMonth: 1.5, weight: null, length: 57 }
  ]);
});
