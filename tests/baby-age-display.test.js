const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateBabyAgeParts,
  formatBabyAgeText
} = require('../miniprogram/utils/babyAgeDisplay');

test('formatBabyAgeText keeps week hint only for young babies', () => {
  assert.equal(formatBabyAgeText('2026-05-21', '2026-06-11'), '21天（约3周）');
  assert.equal(formatBabyAgeText('2026-02-01', '2026-06-11'), '4个月零10天');
});

test('formatBabyAgeText uses year-month-day wording after one year', () => {
  assert.equal(formatBabyAgeText('2025-03-08', '2026-06-11'), '1岁3个月零3天');
  assert.equal(formatBabyAgeText('2025-06-11', '2026-06-11'), '1岁');
  assert.equal(formatBabyAgeText('2025-06-01', '2026-06-11'), '1岁零10天');
  assert.equal(formatBabyAgeText('2024-04-20', '2026-06-11'), '2岁1个月零22天');
});

test('calculateBabyAgeParts handles month-end birthdays', () => {
  assert.deepEqual(calculateBabyAgeParts('2025-01-31', '2026-02-28'), {
    years: 1,
    months: 0,
    days: 28,
    totalMonths: 12,
    totalDays: 393
  });
});
