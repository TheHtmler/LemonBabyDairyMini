const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActualMeasurementSeries,
  calculateAgeMonthsPosition,
  normalizeGrowthRecordsForChart
} = require('../miniprogram/utils/growthChartUtils');

test('calculateAgeMonthsPosition uses the exact position between monthly anniversaries', () => {
  const position = calculateAgeMonthsPosition('2026-05-15', '2026-06-30');

  assert.equal(position.monthAge, 1);
  assert.equal(position.xMonth, 1.5);
});

test('normalizeGrowthRecordsForChart maps v2 height and head fields into chart measurements', () => {
  const records = normalizeGrowthRecordsForChart({
    babyInfo: { birthday: '2026-05-15' },
    v2Records: [
      {
        _id: 'growth-1',
        date: '2026-06-15',
        status: 'active',
        source: 'data_records_v2',
        weight: '4.35',
        height: '55.2',
        headCircumference: '38.1'
      }
    ]
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].weight, 4.35);
  assert.equal(records[0].length, 55.2);
  assert.equal(records[0].head, 38.1);
  assert.equal(records[0].monthAge, 1);
  assert.equal(records[0].xMonth, 1);
});

test('normalizeGrowthRecordsForChart keeps height-only v2 measurements and filters carry-forward records', () => {
  const records = normalizeGrowthRecordsForChart({
    babyInfo: { birthday: '2026-05-15' },
    v2Records: [
      {
        _id: 'carried',
        date: '2026-06-15',
        status: 'active',
        source: 'daily_record_v2_carry_forward',
        weight: '4.1',
        height: '54'
      },
      {
        _id: 'height-only',
        date: '2026-06-20',
        status: 'active',
        source: 'data_records_v2',
        height: '55.8'
      }
    ]
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]._id, 'height-only');
  assert.equal(records[0].weight, null);
  assert.equal(records[0].length, 55.8);
});

test('normalizeGrowthRecordsForChart keeps migrated legacy feeding height measurements', () => {
  const records = normalizeGrowthRecordsForChart({
    babyInfo: { birthday: '2025-03-24' },
    v2Records: [
      {
        _id: 'legacy-feeding',
        date: '2025-06-10',
        status: 'active',
        source: 'legacy_feeding_basic_info',
        weight: '7.025',
        height: '78'
      }
    ]
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].weight, 7.025);
  assert.equal(records[0].length, 78);
});

test('normalizeGrowthRecordsForChart prefers v2 records over migrated legacy records on the same day', () => {
  const records = normalizeGrowthRecordsForChart({
    babyInfo: { birthday: '2026-05-15' },
    legacyRecords: [
      {
        _id: 'legacy',
        recordDate: '2026-06-15',
        monthAge: 1,
        weight: '4.1',
        length: '54'
      }
    ],
    v2Records: [
      {
        _id: 'v2',
        date: '2026-06-15',
        status: 'active',
        source: 'growth_records_page',
        weight: '4.35',
        height: '55.2'
      }
    ]
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]._id, 'v2');
  assert.equal(records[0].weight, 4.35);
  assert.equal(records[0].length, 55.2);
});

test('buildActualMeasurementSeries preserves fractional month positions for chart dots', () => {
  const records = normalizeGrowthRecordsForChart({
    babyInfo: { birthday: '2026-05-15' },
    v2Records: [
      {
        _id: 'growth-1',
        date: '2026-06-30',
        status: 'active',
        source: 'data_records_v2',
        weight: '4.6',
        height: '56.4'
      }
    ]
  });
  const series = buildActualMeasurementSeries(records, 36);

  assert.deepEqual(series.weightPoints, [{ x: 1.5, value: 4.6 }]);
  assert.deepEqual(series.lengthPoints, [{ x: 1.5, value: 56.4 }]);
  assert.equal(series.weightData[1], 4.6);
  assert.equal(series.lengthData[1], 56.4);
});

test('buildActualMeasurementSeries only plots value changes for each measurement type', () => {
  const records = normalizeGrowthRecordsForChart({
    babyInfo: { birthday: '2026-05-15' },
    v2Records: [
      {
        _id: 'growth-1',
        date: '2026-06-15',
        status: 'active',
        source: 'data_records_v2',
        weight: '4.6',
        height: '56.4'
      },
      {
        _id: 'growth-same',
        date: '2026-06-20',
        status: 'active',
        source: 'data_records_v2',
        weight: '4.6',
        height: '56.4'
      },
      {
        _id: 'growth-weight-change',
        date: '2026-06-25',
        status: 'active',
        source: 'data_records_v2',
        weight: '4.8',
        height: '56.4'
      },
      {
        _id: 'growth-length-change',
        date: '2026-06-30',
        status: 'active',
        source: 'data_records_v2',
        weight: '4.8',
        height: '57'
      }
    ]
  });
  const series = buildActualMeasurementSeries(records, 36);

  assert.deepEqual(series.weightPoints.map(point => point.value), [4.6, 4.8]);
  assert.deepEqual(series.lengthPoints.map(point => point.value), [56.4, 57]);
});
