'use strict';
const { businessDate, shanghaiDate, shiftDate, fail } = require('./lib/search');
const { active, hash } = require('./access');
const catalog = require('./repository');
const { normalizeFeedingRecordV2 } = require('./lib/intake/feedingRecordV2Utils');
const { timeOf, normalizeDietCandidate } = require('./dietAdapter');

function stamp(row) {
  const date = businessDate(row.dateKey || row.date || row.recordDate || row.recordTime || row.startDateTime || row.actualDateTime);
  const time = timeOf(row.actualTime || row.timeString || row.startTime || row.time || row.actualDateTime || row.recordTime || row.startDateTime);
  return { date, time };
}
function inPeriod(row, period, now) {
  const s = stamp(row); const today = shanghaiDate(now);
  if (!s.date || s.date > today || period && period.startDate && s.date < period.startDate || period && period.endDateExclusive && s.date >= period.endDateExclusive) return false;
  const explicit = row.actualDateTime || row.recordTime || row.startDateTime;
  if (explicit && Number.isFinite(new Date(explicit).getTime()) && new Date(explicit).getTime() > now) return false;
  return s.date !== today || s.time <= new Date(now + 28800000).toISOString().slice(11, 19);
}
function missingCollection(error) { return /COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST/.test(String(error.code || '')); }
async function mapConcurrent(values, limit, action) {
  const result = new Array(values.length); let position = 0; let stopped = false;
  const worker = async () => {
    while (!stopped && position < values.length) {
      const index = position++;
      try { result[index] = await action(values[index]); }
      catch (error) { stopped = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return result;
}
function createReadRepository({ db, accessContext, now, deadline = Date.now() + 22000, maxReads = 5000 }) {
  let reads = 0; const cache = new Map(); const manifests = [];
  function budget(count = 0) { reads += count; if (reads > maxReads || Date.now() >= deadline) fail('QUERY_BUDGET', '记录较多，请缩短日期范围后重试'); }
  async function manifest(collection, where) {
    budget(3);
    try {
      const [count, latest, last] = await Promise.all([
        db.collection(collection).where(where).count(),
        db.collection(collection).where(where).orderBy('updatedAt', 'desc').limit(1).get(),
        db.collection(collection).where(where).orderBy('_id', 'desc').limit(1).get()
      ]);
      const top = (latest.data || [])[0] || {};
      return hash([Number(count.total) || 0, top.updatedAt || top.createdAt || null, top._id || '', ((last.data || [])[0] || {})._id || '']);
    } catch (error) { if (missingCollection(error)) return 'absent'; throw error; }
  }
  function dateWhere(period, fields) {
    if (!period || !period.startDate && !period.endDateExclusive) return null;
    const _ = db.command; const lo = period.startDate || '1900-01-01'; const hi = period.endDateExclusive || shiftDate(shanghaiDate(now), 1);
    return _.or(fields.flatMap(field => [
      { [field]: _.gte(shiftDate(lo, -1)).and(_.lt(shiftDate(hi, 1))) },
      { [field]: _.gte(new Date(lo + 'T00:00:00+08:00')).and(_.lt(new Date(hi + 'T00:00:00+08:00'))) }
    ]));
  }
  async function collection(name, period, options = {}) {
    const key = JSON.stringify([name, period, options.fields, !!options.dated, !!options.overlapSleep]);
    if (cache.has(key)) return cache.get(key);
    const task = (async () => {
      const _ = db.command; const clauses = [{ babyUid: accessContext.babyUid }];
      if (options.overlapSleep && name === 'sleep_records' && period) {
        const lo = period.startDate || '1900-01-01';
        const hi = period.endDateExclusive || shiftDate(shanghaiDate(now), 1);
        const absent = field => _.or([{ [field]: null }, { [field]: '' }, { [field]: _.exists(false) }]);
        const unfinished = _.and([absent('endDateTime'), absent('endTime')]);
        // 日期预筛选保留长睡眠和历史未结束记录，精确交集由护理执行器校验。
        clauses.push(_.or([
          dateWhere({ startDate: shiftDate(lo, -1), endDateExclusive: hi }, ['date', 'dateKey', 'startDateTime', 'endDateTime']),
          _.and([{ startDateTime: _.lt(new Date(hi + 'T00:00:00+08:00')) }, _.or([{ endDateTime: _.gt(new Date(lo + 'T00:00:00+08:00')) }, unfinished])]),
          _.and([{ startDateTime: _.lt(shiftDate(hi, 1)) }, { endDateTime: _.gt(shiftDate(lo, -1)) }]),
          _.and([_.or([{ date: _.lt(hi) }, { dateKey: _.lt(hi) }]), unfinished])
        ]));
      } else {
        const range = dateWhere(period, options.fields || ['date']); if (range) clauses.push(range);
      }
      const base = clauses.length === 1 ? clauses[0] : _.and(clauses);
      let before;
      try { before = await manifest(name, base); } catch (_) { fail('SOURCE_UNAVAILABLE', '所需记录暂时读取失败，请重试'); }
      if (before === 'absent') { manifests.push({ key, collection: name, where: base, before }); return []; }
      const rows = []; let after = '';
      for (;;) {
        budget(); const where = after ? _.and([base, { _id: _.gt(after) }]) : base;
        let response;
        try { response = await db.collection(name).where(where).orderBy('_id', 'asc').limit(100).get(); }
        catch (_) { fail('SOURCE_UNAVAILABLE', '所需记录暂时读取失败，请重试'); }
        const batch = response.data || []; budget(batch.length);
        rows.push(...batch.filter(row => row.babyUid === accessContext.babyUid && active(row) && (options.overlapSleep || !options.dated || inPeriod(row, period, now))));
        if (batch.length < 100) break;
        const last = batch[batch.length - 1]._id; if (!last || last === after) fail('SOURCE_UNAVAILABLE', '记录分页未完成，请重试'); after = last;
      }
      manifests.push({ key, collection: name, where: base, before });
      return rows;
    })(); cache.set(key, task); return task;
  }
  async function catalogItems(domain = 'catalog', keyword = '', source = 'all') {
    const key = JSON.stringify(['catalog', domain, keyword, source]);
    if (cache.has(key)) return cache.get(key);
    const task = (async () => {
      const query = { scope: domain === 'catalog' ? ['food', 'powder', 'recipe', 'medication'] : [domain], source, keyword };
      const sources = await mapConcurrent(catalog.sourceNames(query), 3, async name => {
        const result = [];
        const collectionName = catalog.SOURCES[name].collection;
        const where = catalog.whereFor(db, name, accessContext.babyUid);
        let before;
        try { before = await manifest(collectionName, where); } catch (_) { fail('SOURCE_UNAVAILABLE', '资料状态暂时读取失败，请重试'); }
        manifests.push({ key: 'catalog-source:' + name, collection: collectionName, where, before });
        if (before === 'absent') return result;
        let position = {}; let profile = null;
        for (;;) {
          budget(); let response;
          try { response = await catalog.scanSource({ db, accessContext, query: name === 'privatePowder' ? { ...query, keyword: '' } : query, source: name, position, readLimit: 100 }); }
          catch (error) { if (missingCollection(error)) break; fail('SOURCE_UNAVAILABLE', '资料暂时读取失败，请重试'); }
          budget(response.documents.length); position = response.nextPosition;
          for (const doc of response.documents) {
            if (!active(doc)) continue;
            if (name === 'privatePowder') { if (!profile || catalog.compareProfile(doc, profile) > 0) profile = doc; continue; }
            const item = catalog.normalizeCandidate(doc, name, 0, accessContext.babyUid);
            if (item && !item.deleted) result.push({ ...item, ingredientEntities: Array.isArray(doc.ingredients) ? doc.ingredients.map(x => ({ id: x.foodId || (x.foodSnapshot || {})._id || '', name: x.foodName || (x.foodSnapshot || {}).name || '', category: [(x.foodSnapshot || {}).category, (x.foodSnapshot || {}).categoryLevel1, (x.foodSnapshot || {}).categoryLevel2].filter(Boolean).join('/') })) : [],
              ingredientsComplete: Array.isArray(doc.ingredients) && doc.ingredients.length > 0 && doc.ingredients.every(x => x.foodId && (x.foodName || (x.foodSnapshot || {}).name)) });
          }
          if (response.exhausted || response.documents.length < 100) break;
        }
        if (profile) for (let i = 0; i < (profile.formulaPowders || []).length; i++) { const item = catalog.normalizeCandidate(profile, name, i, accessContext.babyUid); if (item && !item.deleted) result.push(item); }
        return result;
      });
      const items = sources.flat();
      return items;
    })(); cache.set(key, task); return task;
  }
  async function events(domain, period) {
    if (domain === 'medication') return (await collection('medication_records', period, { dated: true, fields: ['date', 'dateKey', 'actualDateTime'] })).map(raw => event(raw, 'medication', raw.medicationName || '未命名药物', raw.medicationId || '', accessContext.babyUid));
    if (domain === 'water') return (await collection('water_records', period, { dated: true, fields: ['date', 'dateKey', 'recordTime'] })).map(raw => event(raw, 'water', '饮水记录', '', accessContext.babyUid));
    const [legacy, current] = await Promise.all([
      collection('feeding_records', period, { dated: true }),
      collection(domain === 'milk' ? 'feeding_records_v2' : 'food_intake_records', period, { dated: true })
    ]);
    if (domain === 'milk') {
      const fresh = current.map(row => {
        const normalized = normalizeFeedingRecordV2(row);
        const known = Object.entries(row.nutritionSummary || {}).filter(([, value]) => value !== null && value !== '' && Number.isFinite(Number(value))).map(([key]) => key);
        return normalized ? { ...normalized, __nutritionMissing: !row.nutritionSummary, __nutritionFields: known } : null;
      }).filter(Boolean);
      const migrated = new Set(fresh.map(row => (row.legacySource || {}).recordId + ':' + (row.legacySource || {}).feedingId));
      const old = legacy.flatMap(doc => (doc.feedings || []).filter(active).filter(row => !migrated.has(doc._id + ':' + (row._id || row.id || ''))).map((row, i) => ({ ...row, _id: doc._id + ':' + (row._id || row.id || i), date: doc.date, legacyRecordId: doc._id, legacy: true })));
      return [...fresh, ...old].filter(raw => inPeriod(raw, period, now)).map(raw => event(raw, 'milk', '喂奶记录', '', accessContext.babyUid));
    }
    const fresh = current;
    const migrated = new Set(fresh.map(row => (row.legacySource || {}).recordId + ':' + (row.legacySource || {}).intakeId));
    const old = legacy.flatMap(doc => (doc.intakes || []).filter(active).filter(row => row.type !== 'milk' && !row.milkType && !migrated.has(doc._id + ':' + (row._id || row.id || '')))
      .map((row, i) => ({ ...row, _id: doc._id + ':' + (row._id || row.id || i), date: doc.date, legacyRecordId: doc._id, legacy: true })));
    return [...fresh, ...old].filter(raw => inPeriod(raw, period, now)).map(raw => {
      const value = event(raw, 'diet', raw.foodName || raw.name || raw.nameSnapshot || (raw.foodSnapshot || {}).name || (raw.recipeSource || {}).recipeName || '未命名食物', raw.foodId || (raw.recipeSource || {}).recipeId || '', accessContext.babyUid);
      value.candidate = normalizeDietCandidate(raw, raw, { source: 'foodIntakes', id: raw._id, offset: 0 }, accessContext.babyUid); return value;
    });
  }
  async function verify() {
    await mapConcurrent(manifests, 3, async item => {
      let current; try { current = await manifest(item.collection, item.where); } catch (_) { fail('SOURCE_UNAVAILABLE', '记录变更状态读取失败，请重试'); }
      if (current !== item.before) fail('DATA_CHANGED', '查询期间记录发生变化，请重新查询');
    });
    budget();
  }
  return { collection, catalogItems, events, verify, budget, revisions: () => Object.fromEntries(manifests.map(x => [hash(x.key), x.before])) };
}
function event(raw, domain, name, entityId, babyUid) {
  const s = stamp(raw); return { id: domain + ':' + raw._id, sourceId: raw._id, domain, type: domain === 'diet' ? raw.sourceType === 'recipe' ? 'recipe' : 'food' : domain, name, entityId, date: s.date, time: s.time, raw,
    locator: { kind: raw.legacy ? 'legacy' : domain === 'milk' ? 'milk' : domain === 'diet' ? 'meal' : domain, babyUid, date: s.date, recordId: raw.legacyRecordId || raw._id, mealBatchId: raw.mealBatchId || '' } };
}
module.exports = { createReadRepository, stamp, inPeriod };
