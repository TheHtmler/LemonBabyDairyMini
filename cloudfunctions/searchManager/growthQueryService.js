'use strict';
const { MEASURES, businessDate, shanghaiDate, shiftDate, date: validDate, fail } = require('./lib/search');
const { CARRY_FORWARD_GROWTH_SOURCES } = require('./lib/intake/growthChartUtils');

const GROWTH_MEASURES = ['growth.weight', 'growth.height', 'growth.head_circumference'];
const NOTE = '仅纳入真实有效测量，同日每项取最近更新值；自动沿用和未测量日期不计入、不补零';

function measurementValue(value) {
  if (!['number', 'string'].includes(typeof value) || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
function measurementDate(record, now) {
  const value = record.date || record.recordDate;
  if (!(value instanceof Date) && !['string', 'number'].includes(typeof value)) return '';
  if (typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(value) || !validDate(value.slice(0, 10)))) return '';
  if (!validDate(value) && new Date(value).getTime() > new Date(now).getTime()) return '';
  const day = businessDate(value);
  return day && day <= shanghaiDate(now) ? day : '';
}
function updatedTime(record) {
  const time = new Date(record.updatedAt || record.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}
function recentFirst(left, right) {
  return right.date.localeCompare(left.date) || updatedTime(right.record) - updatedTime(left.record) || String(right.record._id).localeCompare(String(left.record._id));
}
function publicMeasurement(row) {
  const { record, ...measurement } = row;
  return measurement;
}
async function selectedMeasurements({ reader, plan, period, now, measures }) {
  const records = await reader.collection('growth_records_v2', period, { dated: true, fields: ['date', 'recordDate'] });
  const byMeasure = new Map(measures.map(key => [key, new Map()]));
  const recordedDays = new Set();
  for (const record of records) {
    reader.budget();
    if (CARRY_FORWARD_GROWTH_SOURCES.has(record.source)) continue;
    const day = measurementDate(record, now);
    if (!day || period.startDate && day < period.startDate || period.endDateExclusive && day >= period.endDateExclusive) continue;
    recordedDays.add(day);
    for (const key of measures) {
      const meta = MEASURES[key]; const value = measurementValue(record[meta.field]);
      if (value === null) continue;
      const row = { date: day, value, unit: meta.unit, known: true, source: 'growth_records_v2', measurementSource: record.source || 'data_records_v2', record,
        locator: { kind: 'growth', babyUid: plan.babyUid, date: day, recordId: record._id } };
      const previous = byMeasure.get(key).get(day);
      // 各项独立去重，较新的记录未填某项时保留同日该项的有效测量。
      if (!previous || recentFirst(row, previous) < 0) byMeasure.get(key).set(day, row);
    }
  }
  const tomorrow = shiftDate(shanghaiDate(now), 1);
  const end = period.endDateExclusive && period.endDateExclusive < tomorrow ? period.endDateExclusive : tomorrow;
  const requestedDays = period.startDate ? Math.max(0, (Date.parse(end) - Date.parse(period.startDate)) / 86400000) : recordedDays.size;
  return { rows: new Map([...byMeasure].map(([key, rows]) => [key, [...rows.values()].sort(recentFirst)])), recordedDays: recordedDays.size, requestedDays };
}
function aggregate(selected, plan) {
  const rows = selected.rows.get(plan.measure); const meta = MEASURES[plan.measure];
  const latest = rows[0]; const first = rows[rows.length - 1];
  let value = null; let point;
  if (rows.length) {
    if (plan.aggregation === 'latest') { point = latest; value = point.value; }
    if (plan.aggregation === 'mean_daily') value = rows.reduce((mean, row, index) => mean + (row.value - mean) / (index + 1), 0);
    if (plan.aggregation === 'min' || plan.aggregation === 'max') {
      point = rows.reduce((best, row) => (plan.aggregation === 'min' ? row.value < best.value : row.value > best.value) ? row : best);
      value = point.value;
    }
    if (plan.aggregation === 'change' && rows.length >= 2) value = latest.value - first.value;
  }
  const missingReason = value !== null ? '' : !selected.recordedDays ? '这段时间没有真实成长测量记录' : !rows.length ? '成长记录缺少有效的' + meta.label + '测量值' : '期间增量至少需要两个不同日期的有效测量';
  return { label: meta.label, value: value === null ? null : Number(value.toFixed(6)), unit: meta.unit, known: value !== null, missingReason,
    knownDays: rows.length, requestedDays: selected.requestedDays, source: 'growth_records_v2',
    measurementDates: rows.map(row => row.date), locators: rows.map(row => row.locator),
    ...(point ? { date: point.date, locator: point.locator } : {}),
    ...(plan.aggregation === 'change' && rows.length ? { firstMeasurement: publicMeasurement(first), lastMeasurement: publicMeasurement(latest) } : {}) };
}
function statusOf(selected, row) { return row.known ? 'ready' : selected.recordedDays ? 'missing_data' : 'no_records'; }

async function queryGrowth({ reader, plan, now = Date.now(), offset = 0 }) {
  const list = plan.operation === 'records.list';
  if (plan.domain !== 'growth' || !['records.list', 'metrics.series', 'metrics.aggregate', 'metrics.compare'].includes(plan.operation) ||
      (plan.measure ? !GROWTH_MEASURES.includes(plan.measure) : !list) || !Number.isInteger(offset) || offset < 0 ||
      !Array.isArray(plan.effectivePeriods) || plan.effectivePeriods.length !== (plan.operation === 'metrics.compare' ? 2 : 1) ||
      (list || plan.operation === 'metrics.series' ? plan.aggregation && plan.aggregation !== 'latest' : !['latest', 'mean_daily', 'min', 'max', 'change'].includes(plan.aggregation)))
    fail('INVALID_QUERY', '成长查询的指标、日期或统计方式不支持');
  const measures = plan.measure ? [plan.measure] : GROWTH_MEASURES;
  if (measures.some(key => !MEASURES[key])) fail('INVALID_QUERY', '成长查询指标暂未就绪');
  const sides = await Promise.all(plan.effectivePeriods.map(period => selectedMeasurements({ reader, plan, period, now, measures })));
  const selected = sides[0];
  const note = NOTE + (plan.aggregation === 'mean_daily' ? '；测量均值仅对有效测量日期求平均' : plan.aggregation === 'change' ? '；期间增量为最晚测量值减最早测量值' : '');
  if (list) {
    const byRecord = new Map();
    for (const key of measures) for (const row of selected.rows.get(key)) {
      const id = row.record._id; const meta = MEASURES[key];
      if (!byRecord.has(id)) byRecord.set(id, { ...row, answers: [] });
      byRecord.get(id).answers.push({ field: key, label: meta.label, value: row.value + ' ' + meta.unit, known: true });
    }
    const all = [...byRecord.values()].sort(recentFirst);
    const display = plan.aggregation === 'latest' ? all.filter(row => row.date === (all[0] || {}).date) : all;
    const page = display.slice(offset, offset + 20);
    const knownDays = new Set(all.map(row => row.date)).size;
    return { status: display.length ? 'ready' : selected.recordedDays ? 'missing_data' : 'no_records',
      message: display.length ? '' : selected.recordedDays ? '成长记录缺少所需的有效测量值' : '这段时间没有真实成长测量记录',
      result: { kind: 'list', items: page.map(row => ({ id: 'growth:' + row.record._id, source: 'history', sourceId: row.record._id, type: 'growth',
        name: plan.measure ? MEASURES[plan.measure].label + '记录' : '成长记录', date: row.date, locator: row.locator, answers: row.answers })),
      total: display.length, nextOffset: offset + page.length < display.length ? offset + page.length : null, knownDays, requestedDays: selected.requestedDays, note } };
  }
  if (plan.operation === 'metrics.series') {
    const all = selected.rows.get(plan.measure); const rows = plan.aggregation === 'latest' ? all.slice(0, 1) : all;
    const page = rows.slice(offset, offset + 20); const meta = MEASURES[plan.measure];
    return { status: rows.length ? 'ready' : selected.recordedDays ? 'missing_data' : 'no_records',
      message: rows.length ? '' : selected.recordedDays ? '成长记录缺少有效的' + meta.label + '测量值' : '这段时间没有真实成长测量记录',
      result: { kind: 'series', label: meta.label, unit: meta.unit, rows: page.map(publicMeasurement), total: rows.length,
        nextOffset: offset + page.length < rows.length ? offset + page.length : null, knownDays: all.length, requestedDays: selected.requestedDays, note } };
  }
  const left = aggregate(selected, plan);
  if (plan.operation === 'metrics.compare') {
    const right = aggregate(sides[1], plan); const known = left.known && right.known;
    return { status: known ? 'ready' : !selected.recordedDays && !sides[1].recordedDays ? 'no_records' : 'missing_data',
      message: known ? '' : '其中一段时间缺少可比较的有效成长测量',
      result: { kind: 'comparison', label: left.label, rows: [{ label: left.label, unit: left.unit, left: left.value, right: right.value,
        delta: known ? Math.round((left.value - right.value) * 1000000) / 1000000 : null, percentage: known && right.value !== 0 ? (left.value - right.value) / right.value * 100 : null,
        leftKnownDays: left.knownDays, leftRequestedDays: left.requestedDays, rightKnownDays: right.knownDays, rightRequestedDays: right.requestedDays,
        leftMissingReason: left.missingReason, rightMissingReason: right.missingReason, leftDate: left.date || '', rightDate: right.date || '',
        leftMeasurements: { dates: left.measurementDates, locators: left.locators }, rightMeasurements: { dates: right.measurementDates, locators: right.locators } }], note } };
  }
  return { status: statusOf(selected, left), message: left.missingReason,
    result: { kind: 'scalar', label: left.label, rows: [left], knownDays: left.knownDays, requestedDays: left.requestedDays, note } };
}
module.exports = { queryGrowth };
