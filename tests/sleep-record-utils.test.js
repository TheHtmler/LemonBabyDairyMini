const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDateTime,
  resolveEndDateTime,
  resolveWakeEndDateTime,
  computeDurationMinutes,
  isOngoingSleep,
  formatDurationLabel
} = require('../miniprogram/utils/sleepRecordUtils');

test('resolveEndDateTime keeps same day when end after start', () => {
  const start = buildDateTime('2026-07-26', '08:00');
  const end = resolveEndDateTime('2026-07-26', '08:00', '09:30');
  assert.equal(end.getDate(), 26);
  assert.equal(computeDurationMinutes(start, end), 90);
});

test('resolveEndDateTime rolls to next day for cross-midnight', () => {
  const start = buildDateTime('2026-07-26', '22:00');
  const end = resolveEndDateTime('2026-07-26', '22:00', '06:00');
  assert.equal(end.getDate(), 27);
  assert.equal(computeDurationMinutes(start, end), 8 * 60);
});

test('resolveEndDateTime rejects same-minute end (no 24h roll)', () => {
  assert.equal(resolveEndDateTime('2026-07-26', '22:10', '22:10'), null);
});

test('resolveEndDateTime returns null when endTime empty', () => {
  assert.equal(resolveEndDateTime('2026-07-26', '22:00', ''), null);
  assert.equal(resolveEndDateTime('2026-07-26', '22:00', null), null);
});

test('isOngoingSleep detects missing end', () => {
  assert.equal(isOngoingSleep({ startTime: '22:00' }), true);
  assert.equal(isOngoingSleep({ startTime: '22:00', endTime: '06:00' }), false);
});

test('formatDurationLabel', () => {
  assert.equal(formatDurationLabel(90), '1小时30分');
  assert.equal(formatDurationLabel(60), '1小时');
  assert.equal(formatDurationLabel(45), '45分');
  assert.equal(formatDurationLabel(null), '');
});

test('resolveWakeEndDateTime uses wall clock across calendar days', () => {
  const start = buildDateTime('2026-07-25', '10:00');
  const now = buildDateTime('2026-07-26', '11:00');
  const end = resolveWakeEndDateTime(start, now);
  assert.equal(end.getDate(), 26);
  assert.equal(computeDurationMinutes(start, end), 25 * 60);
});

test('resolveWakeEndDateTime rejects same minute', () => {
  const start = buildDateTime('2026-07-26', '22:10');
  assert.equal(resolveWakeEndDateTime(start, buildDateTime('2026-07-26', '22:10')), null);
});
