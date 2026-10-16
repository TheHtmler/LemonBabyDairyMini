'use strict';
const { MEASURES, matchCandidate, businessDate } = require('./lib/search');
const { inPeriod } = require('./readRepository');
function matchesEntity(item, plan) {
  if (!plan.entities.length) return true;
  if (item.domain === 'milk') return (item.raw.formulaComponents || []).some(component => plan.entities.some(entity => component.powderId === (entity.locator && entity.locator.memberId || entity.sourceId) || component.powderName === entity.name));
  return plan.entities.some(entity => item.entityId ? item.entityId === entity.sourceId : item.name === entity.name);
}
async function selectedEvents(reader, plan, period, now) {
  const events = await reader.events(plan.domain, period);
  const unique = new Map(); let unknown = 0;
  for (const item of events) {
    if (!inPeriod(item.raw, period, now) || !matchesEntity(item, plan)) continue;
    if (plan.filters.length) {
      if (!item.candidate) { unknown++; continue; }
      const conditions = plan.filters.filter(x => x.field.startsWith('nutrition.')).map(x => ({ ...x, field: x.field.slice(10) }));
      const matched = matchCandidate(item.candidate, { intent: 'search_diet_records', scope: [item.candidate.type], source: 'all', keyword: '', conditions, powderBasis: plan.powderBasis });
      if (matched.state === 'unknown') unknown++;
      if (matched.state !== 'matched') continue;
    }
    unique.set(item.id, item);
  }
  return { items: [...unique.values()].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time) || a.id.localeCompare(b.id)), unknown };
}
function amount(item, measure) {
  const raw = item.raw; let value; let unit = MEASURES[measure].unit;
  if (measure === 'records.count') return { value: 1, unit: '次' };
  if (measure === 'medication.amount') { value = raw.dosage; unit = String(raw.unit || '').trim(); if (!unit) return null; }
  if (measure === 'water.volume') value = raw.volumeMl !== undefined ? raw.volumeMl : raw.volume;
  if (measure === 'milk.recorded_volume') {
    value = raw.nutritionSummary && raw.nutritionSummary.totalVolume;
    if (raw.legacy && value === undefined && (raw.naturalMilkVolume !== undefined || raw.specialMilkVolume !== undefined)) value = Number(raw.naturalMilkVolume || 0) + Number(raw.specialMilkVolume || 0);
    if (raw.__nutritionMissing || raw.__nutritionFields && !raw.__nutritionFields.includes('totalVolume')) value = undefined;
  }
  if (measure === 'milk.consumed_volume') {
    value = raw.consumedBottleVolume;
    if (value === undefined && raw.preparedFinalVolume !== undefined && raw.leftoverVolume !== undefined) value = Number(raw.preparedFinalVolume) - Number(raw.leftoverVolume);
    if (value === undefined && (raw.formulaComponents || []).length && raw.formulaComponents.every(x => x.kind === 'breast_milk')) value = raw.formulaComponents.reduce((sum, x) => sum + Number(x.volume || 0), 0);
  }
  if (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
  value = Number(value);
  if (measure === 'medication.amount' && unit === 'g') { value *= 1000; unit = 'mg'; }
  return { value, unit };
}
function publicEvent(item, plan) {
  const raw = item.raw;
  const result = { ...(item.candidate || {}), id: item.id, source: 'history', sourceId: item.sourceId, type: item.type, name: item.name, date: item.date, time: item.time, locator: item.locator };
  delete result.ref; delete result.searchText; delete result.deleted;
  if (item.domain === 'medication') result.answers = [{ label: '已记录服用量', value: (raw.dosage === undefined ? '未填写' : raw.dosage + ' ' + (raw.unit || '')), known: raw.dosage !== undefined }];
  if (item.domain === 'water') { const value = amount(item, 'water.volume'); result.answers = [{ label: '已记录饮水量', value: value ? value.value + ' ml' : '未填写', known: !!value }]; }
  if (item.domain === 'milk') {
    const volume = amount(item, 'milk.recorded_volume');
    result.answers = [{ label: '已记录奶量', value: volume ? volume.value + ' ml' : '未提供', known: !!volume }];
    if (plan.measure === 'milk.components') result.answers = (raw.formulaComponents || []).filter(x => x.kind === 'formula_powder').map((x, i) => ({ field: 'component-' + i, label: x.powderName || '未命名奶粉', value: x.powderWeight === undefined ? '用量未提供' : x.powderWeight + ' g', known: x.powderWeight !== undefined }));
  }
  return result;
}
async function queryRecords({ reader, plan, period = plan.effectivePeriods[0], offset = 0, now }) {
  const selected = await selectedEvents(reader, plan, period, now); const items = selected.items;
  if (plan.operation === 'records.list') {
    let display = items;
    if (plan.groupBy === 'entity') {
      const seen = new Set();
      display = items.filter(item => { const key = item.candidate && item.candidate.groupKey || item.entityId || item.name; if (seen.has(key)) return false; seen.add(key); return true; });
    }
    if (plan.aggregation === 'latest') display = display.slice(0, 1);
    const page = display.slice(offset, offset + 20);
    return { status: display.length ? 'ready' : selected.unknown ? 'missing_data' : 'no_records', message: display.length ? '' : selected.unknown ? '部分记录缺少可比较的营养快照' : '这段时间没有符合条件的记录',
      result: { kind: 'list', items: page.map(item => publicEvent(item, plan)), total: display.length, nextOffset: offset + page.length < display.length ? offset + page.length : null, note: selected.unknown ? '部分记录缺少比较依据，未纳入列表' : '' } };
  }
  const meta = MEASURES[plan.measure]; const groups = new Map(); let missing = selected.unknown;
  for (const item of items) {
    const value = amount(item, plan.measure);
    if (!value) { missing++; continue; }
    const byMedication = plan.measure === 'medication.amount';
    const entity = byMedication || plan.groupBy === 'entity' ? item.entityId || item.name : plan.groupBy === 'day' ? item.date : '';
    const day = plan.groupBy === 'day' ? item.date : '';
    const key = entity + ':' + day + ':' + value.unit;
    if (!groups.has(key)) groups.set(key, { groupKey: key, label: byMedication ? item.name + (day ? ' · ' + day : '') : day || (entity ? item.name : meta.label), value: 0, unit: value.unit, dates: new Set() });
    const row = groups.get(key); row.value += value.value; row.dates.add(item.date);
  }
  if (missing) return { status: 'missing_data', message: missing + ' 条记录缺少可计算的用量或比较依据，无法给出完整合计', result: { kind: 'scalar', label: meta.label, rows: [], knownDays: new Set(items.map(x => x.date)).size, missingRecords: missing } };
  const rows = [...groups.values()].map(row => ({ groupKey: row.groupKey, label: row.label, value: Math.round((plan.aggregation === 'mean_daily' ? row.value / row.dates.size : row.value) * 10000) / 10000, unit: row.unit, known: true, recordedDays: row.dates.size }));
  if (!items.length && plan.measure === 'records.count') rows.push({ label: meta.label, value: 0, unit: '次', known: true, recordedDays: 0 });
  return { status: items.length ? 'ready' : 'no_records', message: items.length ? '' : '这段时间没有服用或摄入记录', result: { kind: 'scalar', label: meta.label, rows, recordedDays: new Set(items.map(x => x.date)).size, totalRecords: items.length,
    note: plan.measure === 'milk.recorded_volume' ? '沿用当日统计的奶量口径；配奶水量不等同于成品实际入口体积' : plan.measure === 'records.count' ? '次数仅代表已记录事件，不推断未记录时是否实际服用' : '' } };
}
module.exports = { queryRecords, selectedEvents, amount, publicEvent, matchesEntity };
