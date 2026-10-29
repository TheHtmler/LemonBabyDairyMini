'use strict';
const { businessDate, shanghaiDate, shiftDate, MEASURES, fail } = require('./lib/search');

const MINUTE = 60000;
const DAY = 86400000;
const TYPE_LABELS = { stool: '大便', urine: '小便', mixed: '混合尿布' };
const CONSISTENCY_LABELS = { liquid: '水样', loose: '稀便', soft: '软便', normal: '正常', hard: '硬便' };
const COLOR_LABELS = { yellow: '黄色', green: '绿色', brown: '棕色', white: '白色', red: '红色', black: '黑色' };
function validatePlan(plan) {
  if (!plan || !['sleep', 'bowel'].includes(plan.domain) || !['records.list', 'records.aggregate', 'metrics.series', 'metrics.aggregate', 'metrics.compare'].includes(plan.operation))
    fail('INVALID_QUERY', '护理查询不支持这个领域或操作');
  if (plan.operation === 'records.list') {
    if (plan.measure || ![undefined, null, 'latest'].includes(plan.aggregation)) fail('INVALID_QUERY', '护理记录列表不支持这个指标或统计方式');
    return;
  }
  const meta = ['sleep.duration', 'records.count'].includes(plan.measure) && MEASURES[plan.measure];
  if (!meta || !meta.domains.includes(plan.domain) || !meta.operations.includes(plan.operation) ||
      !(meta.aggregations.includes(plan.aggregation) || plan.operation === 'metrics.series' && plan.aggregation == null))
    fail('INVALID_QUERY', '护理查询不支持这个指标或统计方式');
}
function present(value) { return value !== undefined && value !== null && String(value).trim() !== ''; }
function round(value) { return Math.round(value * 1000000) / 1000000; }
function midnight(date) { return Date.parse(date + 'T00:00:00+08:00'); }
function timestamp(value) {
  if (!present(value)) return null;
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  let input = value;
  if (typeof input === 'string') {
    input = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(input)) return null;
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input)) input = input.replace(' ', 'T') + '+08:00';
  }
  const result = new Date(input).getTime();
  return Number.isFinite(result) ? result : null;
}
function clock(date, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value || '').trim())) return null;
  const result = Date.parse(date + 'T' + String(value).trim() + '+08:00');
  return Number.isFinite(result) && shanghaiDate(result) === date ? result : null;
}
function inDates(date, period, now) {
  return !!date && date <= shanghaiDate(now) && (!period.startDate || date >= period.startDate) && (!period.endDateExclusive || date < period.endDateExclusive);
}
function locator(plan, date, recordId = '') { return { kind: plan.domain, babyUid: plan.babyUid, date, recordId }; }
function itemFrom(raw, plan, date, start) {
  const id = String(raw._id || raw.id || '');
  return { id: plan.domain + ':' + id, source: 'history', sourceId: id, type: plan.domain, date,
    time: start === null ? '' : new Date(start + 28800000).toISOString().slice(11, 16), start,
    name: plan.domain === 'sleep' ? '睡眠记录' : (TYPE_LABELS[raw.type] || '尿布') + '记录',
    locator: locator(plan, date, id), raw };
}
function sleepItem(raw, plan) {
  const date = businessDate(raw.dateKey || raw.date);
  const start = timestamp(raw.startDateTime) ?? clock(date, raw.startTime);
  const item = itemFrom(raw, plan, start === null ? date : shanghaiDate(start), start);
  let end = timestamp(raw.endDateTime);
  const ongoing = !present(raw.endDateTime) && !present(raw.endTime);
  // 老记录只有钟点，按上海归属日恢复跨午夜区间，不依赖云函数宿主时区。
  if (!present(raw.endDateTime) && start !== null && present(raw.endTime)) {
    end = clock(item.date, raw.endTime);
    if (end !== null && end < start) end += DAY;
  }
  if (start === null || end === null || end <= start) end = null;
  return { ...item, end, ongoing, missingReason: start === null ? '缺少有效开始时间' : ongoing ? '睡眠尚未结束' : end === null ? '缺少有效结束依据' : '' };
}
function bowelState(raw, filters) {
  let unknown = false;
  for (const filter of filters) {
    const field = filter.field.slice(6);
    const value = raw[field];
    const allowed = field === 'type' ? TYPE_LABELS : field === 'consistency' ? CONSISTENCY_LABELS : COLOR_LABELS;
    if (!Object.prototype.hasOwnProperty.call(allowed, value)) { unknown = true; continue; }
    const matches = field === 'type' && ['stool', 'urine'].includes(filter.value)
      ? value === filter.value || value === 'mixed' : value === filter.value;
    if (!matches) return 'unmatched';
  }
  return unknown ? 'unknown' : 'matched';
}
async function selectPeriod(reader, plan, period, now) {
  const sleep = plan.domain === 'sleep';
  const rawRows = await reader.collection(sleep ? 'sleep_records' : 'bowel_records', period,
    sleep ? { overlapSleep: true } : { dated: true, fields: ['date', 'dateKey', 'recordTime'] });
  const items = []; const unknown = []; const observed = []; const seen = new Set();
  const lo = period.startDate ? midnight(period.startDate) : -Infinity;
  const hi = Math.min(now, period.endDateExclusive ? midnight(period.endDateExclusive) : Infinity);
  for (const raw of rawRows) {
    reader.budget();
    const id = raw._id || raw.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (sleep) {
      const item = sleepItem(raw, plan);
      if (item.start !== null) {
        if (item.start > now || (period.endDateExclusive && item.start >= midnight(period.endDateExclusive)) || (item.end !== null ? item.end : now) <= lo) continue;
        item.clippedStart = Math.max(item.start, lo);
        item.clippedEnd = Math.min(item.end === null ? now : item.end, hi);
        item.duration = item.end === null ? null : round((item.clippedEnd - item.clippedStart) / MINUTE);
      } else {
        if (!inDates(item.date, period, now)) continue;
        item.clippedStart = midnight(item.date);
        item.clippedEnd = Math.min(midnight(shiftDate(item.date, 1)), hi);
        item.duration = null;
      }
      items.push(item); observed.push(item);
    } else {
      const start = timestamp(raw.recordTime) ?? clock(businessDate(raw.dateKey || raw.date), raw.timeString || raw.time);
      const date = businessDate(raw.dateKey || raw.date || raw.recordTime);
      if (!inDates(date, period, now) || start !== null && start > now) continue;
      const item = itemFrom(raw, plan, date, start);
      observed.push(item);
      const state = bowelState(raw, plan.filters || []);
      if (state === 'unknown') unknown.push(item);
      if (state === 'matched') items.push(item);
    }
  }
  const latestFirst = (a, b) => b.date.localeCompare(a.date) || (b.start ?? -Infinity) - (a.start ?? -Infinity) || a.id.localeCompare(b.id);
  items.sort(latestFirst); unknown.sort(latestFirst);
  return { items, unknown, observed, period };
}
function publicItem(item, plan) {
  const { id, source, sourceId, type, name, date, time, locator: target } = item;
  const result = { id, source, sourceId, type, name, date, time, locator: target };
  if (plan.domain === 'sleep') {
    result.durationMinutes = item.duration;
    result.ongoing = item.ongoing;
    result.answers = [{ field: 'sleep.duration', label: '范围内睡眠时长', value: item.duration === null ? item.missingReason : item.duration + ' 分钟', known: item.duration !== null }];
  } else {
    result.answers = [{ field: 'bowel.type', label: '类型', value: TYPE_LABELS[item.raw.type] || '未填写', known: !!TYPE_LABELS[item.raw.type] }];
    for (const [field, label, labels] of [['consistency', '性状', CONSISTENCY_LABELS], ['color', '颜色', COLOR_LABELS]]) {
      if (present(item.raw[field])) result.answers.push({ field: 'bowel.' + field, label, value: labels[item.raw[field]] || '未提供有效记录', known: !!labels[item.raw[field]] });
    }
    if (present(item.raw.urineAmount)) {
      const amount = { small: '偏少', medium: '正常', large: '较多' }[item.raw.urineAmount];
      result.answers.push({ field: 'bowel.urineAmount', label: '尿量', value: amount || '未提供有效定性记录', known: !!amount });
    }
  }
  return result;
}
function dailyRows(selected, reader, plan, now) {
  const byDay = new Map(); const duration = plan.measure === 'sleep.duration';
  const ensure = date => {
    if (!byDay.has(date)) {
      if (byDay.size >= 36600) fail('QUERY_BUDGET', '日期范围过长');
      byDay.set(date, { date, value: 0, observed: 0, missingRecords: 0, items: [] });
    }
    return byDay.get(date);
  };
  const { period } = selected;
  if (period.startDate) {
    const end = period.endDateExclusive && period.endDateExclusive < shiftDate(shanghaiDate(now), 1) ? period.endDateExclusive : shiftDate(shanghaiDate(now), 1);
    for (let date = period.startDate; date < end; date = shiftDate(date, 1)) {
      reader.budget(); if (byDay.size >= 36600) fail('QUERY_BUDGET', '日期范围过长'); ensure(date);
    }
  }
  if (duration) {
    for (const item of selected.items) {
      for (let start = item.clippedStart; start < item.clippedEnd;) {
        reader.budget(); const date = shanghaiDate(start); const end = Math.min(item.clippedEnd, midnight(shiftDate(date, 1)));
        const day = ensure(date); day.observed++; day.items.push(item);
        if (item.duration === null) day.missingRecords++;
        else day.value += (end - start) / MINUTE;
        start = end;
      }
    }
  } else {
    for (const item of selected.observed) {
      if (!inDates(item.date, period, now)) continue;
      const day = ensure(item.date); day.observed++; day.items.push(item);
    }
    for (const item of selected.items) if (inDates(item.date, period, now)) ensure(item.date).value++;
    for (const item of selected.unknown) ensure(item.date).missingRecords++;
  }
  const unit = duration ? '分钟' : '次';
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)).map(day => {
    const known = day.observed > 0 && !day.missingRecords;
    return { date: day.date, value: known ? round(day.value) : null, unit, known, missingRecords: day.missingRecords,
      missingReason: day.missingRecords ? duration ? '睡眠未结束或缺少有效起止依据' : '部分记录缺少筛选依据' : day.observed ? '' : '当天没有记录，不推断实际为零',
      locator: day.items.length ? day.items[0].locator : locator(plan, day.date) };
  });
}
function latestRows(selected, plan, now) {
  const duration = plan.measure === 'sleep.duration';
  const latest = selected.items.find(item => duration || inDates(item.date, selected.period, now));
  const uncertain = selected.unknown.find(item => !latest || item.date > latest.date || item.date === latest.date && (item.start === null || latest.start === null || item.start >= latest.start));
  const item = uncertain || latest;
  if (!item) return [];
  const known = !uncertain && (!duration || item.duration !== null);
  return [{ date: item.date, value: known ? duration ? item.duration : 1 : null, unit: duration ? '分钟' : '次', known,
    missingRecords: known ? 0 : 1, missingReason: known ? '' : uncertain ? '最新候选记录缺少筛选依据' : item.missingReason,
    locator: item.locator }];
}
function aggregate(selected, rows, plan, now) {
  const duration = plan.measure === 'sleep.duration'; const valid = rows.filter(row => row.known);
  const items = duration ? selected.items : selected.items.filter(item => inDates(item.date, selected.period, now));
  const unknown = duration ? items.filter(item => item.duration === null) : selected.unknown;
  const label = duration ? '已记录睡眠时长' : '已记录次数'; const unit = duration ? '分钟' : '次';
  let value = null;
  if (plan.aggregation === 'latest') {
    const latest = items[0];
    const uncertain = !duration && latest && unknown.some(item => item.date > latest.date || item.date === latest.date && (item.start === null || latest.start === null || item.start >= latest.start));
    if (latest && !uncertain) value = duration ? latest.duration : 1;
  } else if (plan.aggregation === 'mean_daily') {
    if (valid.length) value = valid.reduce((sum, row) => sum + row.value, 0) / valid.length;
  } else if (['min', 'max'].includes(plan.aggregation)) {
    const values = plan.operation === 'records.aggregate' ? unknown.length ? [] : items.map(item => item.duration) : valid.map(row => row.value);
    if (values.length) value = plan.aggregation === 'min' ? Math.min(...values) : Math.max(...values);
  } else if (!unknown.length && rows.some(row => row.known)) {
    value = duration ? items.reduce((sum, item) => sum + item.duration, 0) : items.length;
  }
  const row = { label, value: value === null ? null : round(value), unit, known: value !== null,
    knownDays: valid.length, requestedDays: rows.length, missingRecords: unknown.length,
    locator: items.length ? items[0].locator : selected.observed.length ? selected.observed[0].locator : locator(plan, selected.period.startDate || '') };
  if (plan.aggregation === 'latest' && items.length) row.date = items[0].date;
  return row;
}
function noteFor(plan) {
  const basis = plan.domain === 'sleep' ? '时长只统计有有效结束依据的区间，按上海日期及当前时间裁剪；次数按开始日计数，跨日不重复计次' : '大便或小便筛选均包含混合记录，每次查询只计一次；尿量仅保留定性记录';
  const aggregation = plan.aggregation === 'mean_daily' ? '；日均仅使用有完整依据的日期' : ['min', 'max'].includes(plan.aggregation) ? plan.operation === 'records.aggregate' ? '；最值按单次范围内时长计算' : '；最值按每日合计计算' : '';
  return basis + aggregation + '；次数与时长仅代表已记录内容，未记录日期不补零';
}
async function queryCare({ reader, plan, now, offset = 0 }) {
  validatePlan(plan);
  const sides = await Promise.all(plan.effectivePeriods.map(period => selectPeriod(reader, plan, period, now)));
  const selected = sides[0]; const note = noteFor(plan);
  if (plan.operation === 'records.list') {
    const items = plan.aggregation === 'latest' ? selected.items.slice(0, 1) : selected.items;
    const page = items.slice(offset, offset + 20);
    return { status: items.length ? 'ready' : selected.unknown.length ? 'missing_data' : 'no_records',
      message: items.length ? '' : selected.unknown.length ? '部分记录缺少筛选依据，无法确认是否符合条件' : '这段时间没有符合条件的记录',
      result: { kind: 'list', items: page.map(item => publicItem(item, plan)), total: items.length,
        nextOffset: offset + page.length < items.length ? offset + page.length : null, missingRecords: selected.unknown.length,
        note: note + (selected.unknown.length ? '；缺少筛选依据的记录未纳入列表' : '') } };
  }
  const latestSeries = plan.operation === 'metrics.series' && plan.aggregation === 'latest';
  const days = sides.map(side => latestSeries ? latestRows(side, plan, now) : dailyRows(side, reader, plan, now));
  const observed = plan.measure === 'records.count' ? selected.observed.filter(item => inDates(item.date, selected.period, now)) : selected.observed;
  if (plan.operation === 'metrics.series') {
    const rows = days[0]; const page = rows.slice(offset, offset + 20); const knownDays = rows.filter(row => row.known).length;
    const missing = latestSeries ? rows.length : observed.length;
    return { status: knownDays ? 'ready' : missing ? 'missing_data' : 'no_records',
      message: knownDays ? '' : missing ? '缺少完整的时长或筛选依据' : '这段时间没有相关记录',
      result: { kind: 'series', label: plan.measure === 'sleep.duration' ? '已记录睡眠时长' : '已记录次数', unit: plan.measure === 'sleep.duration' ? '分钟' : '次',
        rows: page, total: rows.length, nextOffset: offset + page.length < rows.length ? offset + page.length : null, knownDays, requestedDays: rows.length, note } };
  }
  const summaries = sides.map((side, index) => aggregate(side, days[index], plan, now)); const left = summaries[0];
  if (plan.operation === 'metrics.compare') {
    const right = summaries[1]; const known = left.known && right.known;
    return { status: known ? 'ready' : 'missing_data', message: known ? '' : '其中一段时间缺少可比较的记录或完整依据',
      result: { kind: 'comparison', label: left.label, rows: [{ label: left.label, unit: left.unit, left: left.value, right: right.value,
        delta: known ? round(left.value - right.value) : null, percentage: known && right.value !== 0 ? round((left.value - right.value) / right.value * 100) : null,
        leftKnownDays: left.knownDays, leftRequestedDays: left.requestedDays, rightKnownDays: right.knownDays, rightRequestedDays: right.requestedDays,
        locator: left.locator, leftLocator: left.locator, rightLocator: right.locator }], note } };
  }
  const rows = plan.groupBy === 'day' ? days[0].map(day => ({ ...day, label: day.date })) : [left];
  return { status: rows.some(row => row.known) ? 'ready' : observed.length ? 'missing_data' : 'no_records',
    message: rows.some(row => row.known) ? '' : observed.length ? '缺少完整的时长或筛选依据' : '这段时间没有相关记录',
    result: { kind: 'scalar', label: left.label, rows, knownDays: left.knownDays, requestedDays: left.requestedDays,
      missingRecords: left.missingRecords, totalRecords: plan.measure === 'records.count' ? selected.items.filter(item => inDates(item.date, selected.period, now)).length : selected.items.length, note } };
}
module.exports = { queryCare };
