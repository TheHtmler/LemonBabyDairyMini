const test = require('node:test');
const assert = require('node:assert/strict');
const {
  attachDotsToCalendarDays,
  attachMarksToCalendarDays,
  attachMarksToDateList,
  buildCalendarDotsMap,
  buildCalendarMarksMap,
  validateDayMarkPayload,
  getColorName
} = require('../miniprogram/utils/dayCalendarMarkUtils');

test('buildCalendarMarksMap groups labels and colors by date', () => {
  const map = buildCalendarMarksMap([
    { date: '2026-07-12', color: '#4A90D9', label: '住院' },
    { date: '2026-07-12', color: '#E85D4C', label: '呕吐' },
    { date: '2026-07-13', color: '#F5A623', label: '发热' }
  ]);

  assert.deepEqual(map['2026-07-12'], [
    { color: '#4A90D9', label: '住院' },
    { color: '#E85D4C', label: '呕吐' }
  ]);
  assert.deepEqual(map['2026-07-13'], [{ color: '#F5A623', label: '发热' }]);
});

test('buildCalendarDotsMap keeps up to three colors per date', () => {
  const map = buildCalendarDotsMap([
    { date: '2026-07-12', color: '#4A90D9', label: '住院' },
    { date: '2026-07-12', color: '#E85D4C', label: '呕吐' },
    { date: '2026-07-12', color: '#7B61D8', label: '腹泻' },
    { date: '2026-07-12', color: '#34C759', label: '发热' },
    { date: '2026-07-13', color: '#F5A623', label: '转奶' }
  ]);

  assert.deepEqual(map['2026-07-12'], ['#4A90D9', '#E85D4C', '#7B61D8']);
  assert.deepEqual(map['2026-07-13'], ['#F5A623']);
});

test('attachMarksToCalendarDays adds markItems and markDots to calendar cells', () => {
  const days = attachMarksToCalendarDays(
    [{ date: '2026-07-12', day: 12, isCurrentMonth: true }],
    {
      '2026-07-12': [
        { color: '#E85D4C', label: '呕吐' },
        { color: '#4A90D9', label: '住院' },
        { color: '#F5A623', label: '发热' },
        { color: '#34C759', label: '咳嗽' }
      ]
    }
  );

  assert.equal(days[0].markItems.length, 3);
  assert.deepEqual(days[0].markDots, ['#E85D4C', '#4A90D9', '#F5A623']);
});

test('attachMarksToDateList adds markDots to top date strip items', () => {
  const dateList = attachMarksToDateList(
    [{ date: '2026-07-12', day: 12 }],
    {
      '2026-07-12': [
        { color: '#4A90D9', label: '住院' },
        { color: '#E85D4C', label: '呕吐' }
      ]
    }
  );

  assert.deepEqual(dateList[0].markDots, ['#4A90D9', '#E85D4C']);
});

test('attachDotsToCalendarDays adds markDots to calendar cells', () => {
  const days = attachDotsToCalendarDays(
    [{ date: '2026-07-12', day: 12, isCurrentMonth: true }],
    { '2026-07-12': ['#E85D4C'] }
  );

  assert.deepEqual(days[0].markDots, ['#E85D4C']);
});

test('validateDayMarkPayload requires label and allowed color', () => {
  const invalid = validateDayMarkPayload({ label: '', color: '' });
  assert.equal(invalid.isValid, false);

  const valid = validateDayMarkPayload({ label: '呕吐', color: '#E85D4C', note: '两次' });
  assert.equal(valid.isValid, true);
  assert.equal(valid.normalized.label, '呕吐');
  assert.equal(valid.normalized.color, '#E85D4C');
});

test('getColorName resolves palette names', () => {
  assert.equal(getColorName('#4A90D9'), '蓝色');
  assert.equal(getColorName('#000'), '');
});
