'use strict';
const { MEASURES, buildDailyNutritionMetricFromSummary, businessDate, shiftDate, shanghaiDate, fail } = require('./lib/search');
const { buildDailySummaryV2 } = require('./lib/intake/dailySummaryV2Utils');
const { queryRecords, matchesEntity } = require('./recordQueryService');

function finite(value) { return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0; }
function knownNutrition(event, field) {
  const raw = event.raw; const nutrition = event.domain === 'milk' ? raw.nutritionSummary || {} : raw.nutrition || {};
  if (raw.__nutritionMissing || raw.legacy && event.domain === 'milk' && !raw.nutritionSummary) return false;
  if (event.domain === 'milk' && raw.__nutritionFields && !raw.__nutritionFields.includes(field)) return false;
  const requested = ['naturalProtein', 'specialProtein'].includes(field) ? 'protein' : field;
  const snapshot = raw.foodSnapshot || {};
  if (((snapshot.recognitionMeta || {}).missingFields || []).includes(requested)) return false;
  const state = (snapshot.nutrientStates || {})[requested];
  if (['missing', 'unverified', 'trace', 'below_limit', 'not_convertible'].includes(typeof state === 'string' ? state : (state || {}).state)) return false;
  if (event.domain === 'milk' && (raw.formulaComponents || []).some(component => {
    const status = (component.nutrientStates || {})[requested];
    return ((component.recognitionMeta || {}).missingFields || []).includes(requested) || status && (typeof status === 'string' ? status : status.state) !== 'known';
  })) return false;
  return finite(nutrition[field]) || ['naturalProtein', 'specialProtein'].includes(field) && (finite(nutrition.protein) || finite(raw[field]));
}
function countedTreatmentItems(record) {
  return (record.groups || [{ items: record.items || [] }]).flatMap(x => x.items || []).filter(x => typeof x.countInNutrition === 'boolean' ? x.countInNutrition : ['dextrose_10', 'dextrose_5'].includes(x.category));
}
function hasTreatmentNutrition(record) { return Object.keys(record.summary || {}).some(x => ['totalCalories', 'calories', 'protein', 'carbs', 'fat'].includes(x)) || countedTreatmentItems(record).length > 0; }
function knownTreatment(record, field) {
  if (['naturalProtein', 'specialProtein'].includes(field) || !hasTreatmentNutrition(record)) return true;
  if (Object.keys(record.summary || {}).some(x => ['totalCalories', 'calories', 'protein', 'carbs', 'fat'].includes(x))) return finite(field === 'calories' ? record.summary.totalCalories ?? record.summary.calories : record.summary[field]);
  return countedTreatmentItems(record).every(x => finite(x[field === 'calories' ? field : field + 'G']));
}
async function dailyRows({ reader, plan, period, now }) {
  const [allFoods, allMilk, allTreatments] = await Promise.all([
    reader.events('diet', period), plan.domain === 'diet' ? [] : reader.events('milk', period),
    reader.collection('treatment_records', period, { dated: true, fields: ['date', 'dateKey', 'startDateTime'] })
  ]);
  const foods = allFoods.filter(item => matchesEntity(item, plan));
  const milk = allMilk.filter(item => matchesEntity(item, plan));
  const treatments = plan.entities.length || plan.domain === 'diet' ? [] : allTreatments;
  const meta = MEASURES[plan.measure]; const coefficient = plan.measure.startsWith('metrics.');
  const nutrient = coefficient ? plan.measure.includes('calorie') ? 'calories' : plan.measure.includes('natural') ? 'naturalProtein' : plan.measure.includes('special') ? 'specialProtein' : 'protein' : meta.field;
  const until = { startDate: null, endDateExclusive: period.endDateExclusive || shiftDate(shanghaiDate(now), 1) };
  const [growth, oldMilk, profiles] = await Promise.all([
    reader.collection('growth_records_v2', until, { dated: true }),
    reader.collection('feeding_records_v2', until, { dated: true }),
    reader.collection('baby_info', null)
  ]);
  const recorded = new Set([...foods, ...milk].map(row => row.date));
  if (!['naturalProtein', 'specialProtein'].includes(nutrient)) treatments.filter(hasTreatmentNutrition).forEach(row => recorded.add(businessDate(row.dateKey || row.date)));
  let dates;
  if (!period.startDate) dates = [...recorded].sort().reverse();
  else {
    dates = []; const end = period.endDateExclusive < shiftDate(shanghaiDate(now), 1) ? period.endDateExclusive : shiftDate(shanghaiDate(now), 1);
    for (let day = period.startDate; day < end; day = shiftDate(day, 1)) { if (dates.length >= 36600) fail('QUERY_BUDGET', '日期范围过长'); dates.push(day); }
    dates.reverse();
  }
  if (plan.aggregation === 'latest') dates = dates.filter(day => recorded.has(day)).slice(0, 1);
  const pickWeight = date => {
    const order = rows => rows.slice().sort((a, b) => businessDate(b.date).localeCompare(businessDate(a.date)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const sameGrowth = order(growth.filter(row => businessDate(row.date) === date && finite(row.weight) && Number(row.weight) > 0))[0];
    const sameMilk = order(oldMilk.filter(row => businessDate(row.date) === date && finite((row.basicInfoSnapshot || {}).weight) && Number(row.basicInfoSnapshot.weight) > 0))[0];
    const previous = order(growth.filter(row => businessDate(row.date) < date && finite(row.weight) && Number(row.weight) > 0))[0];
    const previousMilk = order(oldMilk.filter(row => businessDate(row.date) < date && finite((row.basicInfoSnapshot || {}).weight) && Number(row.basicInfoSnapshot.weight) > 0))[0];
    const row = sameGrowth || sameMilk || previous || previousMilk;
    if (row) return { value: Number(row.weight || (row.basicInfoSnapshot || {}).weight), date: businessDate(row.date), source: row === sameGrowth || row === previous ? 'growth_record' : 'feeding_snapshot' };
    const profile = profiles.find(row => finite(row.weight) && Number(row.weight) > 0);
    return profile ? { value: Number(profile.weight), date: '', source: 'baby_info_initial' } : { value: 0, date: '', source: '' };
  };
  const rows = dates.map(date => {
    reader.budget(); const foodDay = foods.filter(x => x.date === date); const milkDay = milk.filter(x => x.date === date);
    const treatmentDay = treatments.filter(x => businessDate(x.dateKey || x.date) === date);
    const hasRecords = recorded.has(date);
    const quality = [...foodDay, ...milkDay].every(event => knownNutrition(event, nutrient)) && treatmentDay.every(row => knownTreatment(row, nutrient));
    const weight = pickWeight(date);
    const summary = buildDailySummaryV2({ date, foodIntakeRecords: foodDay.map(x => x.raw), milkRecords: milkDay.map(x => x.raw), treatmentRecords: treatmentDay,
      growthRecords: weight.value > 0 ? [{ date, weight: String(weight.value) }] : [] });
    const metric = buildDailyNutritionMetricFromSummary(summary, date, weight.value);
    const value = coefficient ? metric && metric[meta.field] : (summary.macroSummary || {})[meta.field];
    const known = hasRecords && quality && (!coefficient || weight.value > 0) && typeof value === 'number' && Number.isFinite(value);
    const reason = !hasRecords ? '没有可计算的饮食记录' : !quality ? '缺少当时的营养依据' : coefficient && !weight.value ? '缺少有效体重' : !known ? '缺少可计算的摄入依据' : '';
    return { date, value: known ? value : null, unit: meta.unit, known, missingReason: reason, weight: weight.value || null, weightDate: weight.date, weightSource: weight.source,
      locator: { kind: 'day', date, babyUid: (plan.entities[0] || {}).locator && plan.entities[0].locator.babyUid || plan.babyUid } };
  });
  return rows;
}
function aggregate(rows, plan) {
  const valid = rows.filter(x => x.known); const meta = MEASURES[plan.measure]; let value = null;
  if (valid.length && (plan.aggregation !== 'sum' || valid.length === rows.length)) {
    const values = valid.map(x => x.value);
    value = plan.aggregation === 'min' ? Math.min(...values) : plan.aggregation === 'max' ? Math.max(...values) : plan.aggregation === 'sum' ? values.reduce((sum, x) => sum + x, 0) : values.reduce((sum, x) => sum + x, 0) / values.length;
    value = Math.round(value * 1000000) / 1000000;
  }
  return { label: meta.label, value, unit: meta.unit, known: value !== null, knownDays: valid.length, requestedDays: rows.length };
}
async function queryMetrics({ reader, plan, now, offset = 0 }) {
  if (plan.operation === 'metrics.compare' && !plan.measure.startsWith('metrics.') && !plan.measure.startsWith('intake.')) {
    const sides = [];
    for (const period of plan.effectivePeriods) sides.push(await queryRecords({ reader, plan: { ...plan, operation: 'records.aggregate' }, period, now }));
    const left = sides[0].result.rows || []; const right = sides[1].result.rows || [];
    if (sides.some(x => !['ready', 'no_records'].includes(x.status)) || !left.length || !right.length) return { status: 'missing_data', message: '其中一段时间缺少完整可比较数据', result: { kind: 'comparison', rows: [] } };
    const groupKey = x => x.groupKey || x.unit + ':' + x.label;
    const groups = [...new Map([...left, ...right].map(x => [groupKey(x), x])).values()];
    const rows = groups.map(group => { const a = left.find(x => groupKey(x) === groupKey(group)); const b = right.find(x => groupKey(x) === groupKey(group)); return { label: group.label, unit: group.unit, left: a ? a.value : null, right: b ? b.value : null, delta: a && b ? a.value - b.value : null, percentage: a && b && b.value !== 0 ? (a.value - b.value) / b.value * 100 : null }; });
    return { status: rows.every(x => x.left !== null && x.right !== null) ? 'ready' : 'missing_data', result: { kind: 'comparison', label: MEASURES[plan.measure].label, rows, note: '不同单位分别比较；某段没有对应单位的记录时不假定为零' } };
  }
  const sides = [];
  for (const period of plan.effectivePeriods) sides.push(await dailyRows({ reader, plan, period, now }));
  if (plan.operation === 'metrics.series') {
    const rows = sides[0] || []; const page = rows.slice(offset, offset + 20);
    return { status: rows.some(x => x.known) ? 'ready' : rows.length ? 'missing_data' : 'no_records', message: rows.some(x => x.known) ? '' : rows.length ? '缺少计算所需的记录、营养或体重' : '没有可用的饮食记录',
      result: { kind: 'series', label: MEASURES[plan.measure].label, unit: MEASURES[plan.measure].unit, rows: page, total: rows.length, nextOffset: offset + page.length < rows.length ? offset + page.length : null,
        knownDays: rows.filter(x => x.known).length, requestedDays: rows.length, note: '按各日实际摄入量和有效体重计算；今天以当前已记录内容为准' } };
  }
  const left = aggregate(sides[0] || [], plan);
  if (plan.operation === 'metrics.compare') {
    const right = aggregate(sides[1] || [], plan);
    return { status: left.known && right.known ? 'ready' : 'missing_data', message: left.known && right.known ? '' : '其中一段时间缺少可计算数据', result: { kind: 'comparison', label: left.label,
      rows: [{ label: left.label, unit: left.unit, left: left.value, right: right.value, delta: left.known && right.known ? left.value - right.value : null,
        percentage: left.known && right.known && right.value !== 0 ? (left.value - right.value) / right.value * 100 : null, leftKnownDays: left.knownDays, leftRequestedDays: left.requestedDays, rightKnownDays: right.knownDays, rightRequestedDays: right.requestedDays }], note: '日均仅使用有完整计算依据的日期；两段覆盖情况分别列出' } };
  }
  return { status: left.known ? 'ready' : 'missing_data', message: left.known ? '' : '缺少可计算的饮食或体重数据', result: { kind: 'scalar', label: left.label, rows: [left], knownDays: left.knownDays, requestedDays: left.requestedDays, note: plan.aggregation === 'mean_daily' ? '仅对有计算依据的日期求日均，未记录日期不补零' : '' } };
}
module.exports = { queryMetrics, dailyRows, knownNutrition };
