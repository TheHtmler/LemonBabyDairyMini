const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sleepRecord model covers CRUD ongoing and dirty', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'models', 'sleepRecord.js'), 'utf8');
  assert.match(source, /sleep_records/);
  assert.match(source, /startTime/);
  assert.match(source, /endTime/);
  assert.match(source, /durationMinutes/);
  assert.match(source, /findOngoing/);
  assert.match(source, /completeSleep/);
  assert.match(source, /markDirty/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async delete/);
  assert.match(source, /resolveEndDateTime/);
  assert.match(source, /resolveWakeEndDateTime/);
});

test('buildDailySummaryV2 aggregates sleep duration and ongoing', () => {
  const { buildDailySummaryV2 } = require('../miniprogram/utils/dailySummaryV2Utils');

  const summary = buildDailySummaryV2({
    babyUid: 'b1',
    date: '2026-07-26',
    sleepRecords: [
      {
        status: 'active',
        durationMinutes: 90,
        endTime: '09:30',
        updatedAt: '2026-07-26T09:30:00.000Z'
      },
      {
        status: 'active',
        startTime: '22:00',
        updatedAt: '2026-07-26T22:00:00.000Z'
      } // ongoing
    ]
  });

  assert.equal(summary.sleep.totalRecords, 2);
  assert.equal(summary.sleep.totalDurationMinutes, 90);
  assert.equal(summary.sleep.ongoingCount, 1);
  assert.equal(summary.recordCounts.sleep, 2);
  assert.equal(summary.sourceUpdatedAt.sleep, '2026-07-26T22:00:00.000Z');
});
