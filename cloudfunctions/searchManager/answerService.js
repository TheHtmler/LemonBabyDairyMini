'use strict';
const { ANSWER_FIELDS, FIELDS, businessDate, shiftDate, fail, configuredFrequency } = require('./lib/search');
const { active } = require('./access');

function periodText(period) {
  return period.startDate ? period.startDate + ' 至 ' + shiftDate(period.endDateExclusive, -1) : '全部历史';
}

function recordStamp(record) {
  const date = businessDate(record.date || record.actualDateTime);
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d/.exec(String(record.actualTime || ''));
  const actual = record.actualDateTime ? new Date(record.actualDateTime).getTime() : NaN;
  return { date, time: time ? time[0] : Number.isFinite(actual) && businessDate(new Date(actual)) === date ? new Date(actual + 8 * 3600000).toISOString().slice(11, 16) : '' };
}

// 按药物 ID 汇总真实记录；旧记录没有 ID 时才用唯一完整名称关联。
async function medicationStats({ db, accessContext, items, period, now }) {
  const ids = items.map(item => item.sourceId); const names = items.map(item => item.name);
  const nameIds = new Map();
  items.forEach(item => nameIds.set(item.name, [...(nameIds.get(item.name) || []), item.sourceId]));
  const stats = new Map(ids.map(id => [id, { count: 0, days: new Set(), last: null }]));
  const _ = db.command; let afterId = ''; let read = 0;
  const today = businessDate(new Date(now));
  const currentTime = new Date(now + 8 * 3600000).toISOString().slice(11, 16);
  for (;;) {
    const where = [{ babyUid: accessContext.babyUid }, _.or([{ medicationId: _.in(ids) }, { medicationName: _.in(names) }])];
    if (afterId) where.push({ _id: _.gt(afterId) });
    // 药物日期包含 Date 和旧字符串两种存储，均按上海日期筛选。
    if (period.startDate || period.endDateExclusive) {
      const lo = period.startDate || '1900-01-01'; const hi = period.endDateExclusive || shiftDate(today, 1);
      where.push(_.or([{ date: _.gte(shiftDate(lo, -1)).and(_.lt(shiftDate(hi, 1))) },
        { date: _.gte(new Date(lo + 'T00:00:00+08:00')).and(_.lt(new Date(hi + 'T00:00:00+08:00'))) }]));
    }
    const response = await db.collection('medication_records').where(_.and(where)).orderBy('_id', 'asc').limit(100).get();
    const rows = response.data || [];
    for (const record of rows) {
      if (++read > 2000) fail('SEARCH_BUSY', '服药记录较多，请缩短日期范围后重试');
      if (record.babyUid !== accessContext.babyUid || !active(record)) continue;
      if (record.actualDateTime && new Date(record.actualDateTime).getTime() > now) continue;
      const id = record.medicationId || ((nameIds.get(record.medicationName) || []).length === 1 ? nameIds.get(record.medicationName)[0] : '');
      const value = stats.get(id); if (!value) continue;
      const stamp = recordStamp(record);
      if (!stamp.date || stamp.date > today || stamp.date === today && stamp.time > currentTime ||
        period.startDate && stamp.date < period.startDate || period.endDateExclusive && stamp.date >= period.endDateExclusive) continue;
      value.count++; value.days.add(stamp.date);
      if (!value.last || stamp.date + stamp.time > value.last.date + value.last.time) value.last = { ...stamp, recordId: record._id };
    }
    if (rows.length < 100) return stats;
    afterId = rows[rows.length - 1]._id;
  }
}

function fieldAnswer(item, field, stats, query) {
  let value = ''; let note = ''; let locator = null;
  if (field === 'frequency') value = configuredFrequency(item);
  else if (field === 'dosage') value = item.dosage ? item.dosage + ' ' + (item.unit || '') : '';
  else if (field === 'concentration') value = item.concentration ? item.concentration + ' ' + (item.concentrationUnit || '') + (item.volumeUnit ? '/' + item.volumeUnit : '') : '';
  else if (field === 'notes') value = item.notes || '';
  else if (field === 'ingredients') value = (item.ingredients || []).filter(Boolean).join('、');
  else if (FIELDS.includes(field)) {
    const nutrient = (item.nutrients || {})[field] || {};
    const incompatiblePowder = item.type === 'powder' && item.nutritionBasis.material !== (query.powderBasis === 'prepared' ? 'prepared_formula' : 'dry_powder');
    if (incompatiblePowder) note = '缺少所选基准的营养数据';
    if (nutrient.state === 'known' && !incompatiblePowder) {
      value = Math.round(nutrient.value * 1000) / 1000 + ' ' + nutrient.unit;
      const basis = item.nutritionBasis || {};
      note = basis.quantity > 0 && basis.unit ? '每 ' + basis.quantity + ' ' + ({ g: '克', ml: '毫升', portion: '份' }[basis.unit] || basis.unit) + (basis.material === 'dry_powder' ? '干粉' : '') : '计量基准未提供';
    }
  } else if (field === 'intakeCount' && stats) {
    value = stats.count + ' 次'; note = stats.count ? stats.days.size + ' 天有服用记录' : '这段时间没有服用记录';
  } else if (field === 'lastIntake' && stats) {
    value = stats.last ? stats.last.date + (stats.last.time ? ' ' + stats.last.time : '') : '这段时间没有服用记录';
    if (stats.last) locator = { kind: 'medication', babyUid: item.locator.babyUid, medicationId: item.sourceId, recordId: stats.last.recordId, date: stats.last.date };
  }
  return { field, label: ANSWER_FIELDS[field].label, value: value || (FIELDS.includes(field) ? '未提供' : '未填写'), known: !!value, note, ...(locator ? { locator } : {}) };
}

async function attachAnswers({ db, accessContext, items, query, period, now }) {
  if (!query.answerFields || !items.length) return items;
  const history = query.answerFields.some(field => ANSWER_FIELDS[field].history);
  const stats = history ? await medicationStats({ db, accessContext, items, period, now }) : null;
  return items.map(item => ({ ...item, answers: query.answerFields.map(field => fieldAnswer(item, field, stats && stats.get(item.sourceId), query)),
    answerPeriod: history ? periodText(period) : '' }));
}

module.exports = { attachAnswers };
