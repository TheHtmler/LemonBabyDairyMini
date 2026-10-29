'use strict';
const FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'];
const UNITS = { calories: 'kcal', protein: 'g', fat: 'g', carbs: 'g', fiber: 'g', sodium: 'mg' };

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_QUERY', '搜索条件包含不支持的字段');
}
// 先校验字段白名单，再将可选空值视为未提供；必填空值仍交由原规则拒绝。
function omitNullOptionals(value, required) {
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => entry !== null || required.includes(key)));
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validatePeriod(input) {
  let value = input || { kind: 'all' };
  keys(value, ['kind', 'days', 'startDate', 'endDateExclusive']);
  value = omitNullOptionals(value, ['kind']);
  if (!['today', 'yesterday', 'current_calendar_week', 'previous_calendar_week', 'last_n_days', 'current_month', 'previous_calendar_month', 'range', 'all'].includes(value.kind)) fail('INVALID_QUERY', '日期条件不支持');
  const expected = value.kind === 'range' ? ['kind', 'startDate', 'endDateExclusive'] : value.kind === 'last_n_days' ? ['kind', 'days'] : ['kind'];
  keys(value, expected);
  if (value.kind === 'last_n_days' && (!Number.isInteger(value.days) || value.days < 1 || value.days > 36600)) fail('INVALID_QUERY', '天数无效');
  if (value.kind === 'range' && (!date(value.startDate) || !date(value.endDateExclusive) || value.startDate >= value.endDateExclusive)) fail('INVALID_QUERY', '日期范围无效');
  return { ...value };
}
module.exports = { FIELDS, UNITS, fail, keys, omitNullOptionals, date, validatePeriod };
