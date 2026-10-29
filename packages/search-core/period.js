'use strict';
const { validatePeriod, date } = require('./contracts');
const DAY = 86400000;
function shanghaiDate(now = Date.now()) { return new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10); }
function shiftDate(value, days) { return new Date(Date.parse(value + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10); }
function resolvePeriod(period, now = Date.now()) {
  const p = validatePeriod(period); const today = shanghaiDate(now); const tomorrow = shiftDate(today, 1);
  if (p.kind === 'all') return { startDate: null, endDateExclusive: null, anchorDate: today };
  if (p.kind === 'range') return { startDate: p.startDate, endDateExclusive: p.endDateExclusive, anchorDate: today };
  let startDate = today; let endDateExclusive = tomorrow;
  const weekday = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
  if (p.kind === 'yesterday') { startDate = shiftDate(today, -1); endDateExclusive = today; }
  // 近期统计只覆盖已结束的自然日，避免把尚未记录完整的今天计入。
  if (p.kind === 'last_n_days') { startDate = shiftDate(today, -p.days); endDateExclusive = today; }
  if (p.kind === 'current_calendar_week') startDate = shiftDate(today, -weekday);
  if (p.kind === 'previous_calendar_week') { endDateExclusive = shiftDate(today, -weekday); startDate = shiftDate(endDateExclusive, -7); }
  if (p.kind === 'current_month') startDate = today.slice(0, 7) + '-01';
  if (p.kind === 'previous_calendar_month') { endDateExclusive = today.slice(0, 7) + '-01'; startDate = shiftDate(endDateExclusive, -1).slice(0, 7) + '-01'; }
  return { startDate, endDateExclusive, anchorDate: today };
}
function businessDate(value) { if (value === null || value === undefined || value === '') return ''; if (date(value)) return value; const d = new Date(value); return Number.isFinite(d.getTime()) ? shanghaiDate(d) : ''; }
module.exports = { shanghaiDate, shiftDate, resolvePeriod, businessDate };
