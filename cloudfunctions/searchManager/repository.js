'use strict';
const { fail, matchCandidate } = require('./lib/search');
const { getDocument, active, visibleFood } = require('./access');
const { normalizeCatalogCandidate } = require('./catalogAdapter');
const { expandDocument, normalizeDietCandidate } = require('./dietAdapter');
const SOURCES = {
  systemFood: { collection: 'food_catalog', type: 'food', source: 'system' },
  privateFood: { collection: 'food_catalog', type: 'food', source: 'mine' },
  systemPowder: { collection: 'powder_catalog', type: 'powder', source: 'system' },
  privatePowder: { collection: 'milk_nutrition_profiles', type: 'powder', source: 'mine' },
  recipes: { collection: 'recipe_catalog', type: 'recipe', source: 'mine' },
  medications: { collection: 'medications', type: 'medication', source: 'mine' },
  foodIntakes: { collection: 'food_intake_records', history: true },
  milkIntakes: { collection: 'feeding_records_v2', history: true },
  legacyString: { collection: 'feeding_records', history: true },
  legacyDate: { collection: 'feeding_records', history: true }
};
function sourceNames(query) {
  if (query.intent !== 'search_catalog') return [
    ...(query.scope.some(x => ['food', 'recipe'].includes(x)) ? ['foodIntakes'] : []),
    ...(query.scope.includes('powder') ? ['milkIntakes'] : []), 'legacyString', 'legacyDate'];
  return Object.keys(SOURCES).filter(name => { const s = SOURCES[name]; return !s.history && query.scope.includes(s.type) && (query.source === 'all' || query.source === s.source); });
}
function whereFor(db, name, babyUid, period) {
  const _ = db.command; const s = SOURCES[name];
  if (name === 'systemFood') return _.or([{ sourceType: 'system' }, { ownerType: 'system' }, { isSystem: true }]);
  if (name === 'privateFood') return _.and([_.or([{ babyUid }, { sharedBabyUids: _.in([babyUid]) }]), { sourceType: _.neq('system'), ownerType: _.neq('system'), isSystem: _.neq(true) }]);
  if (name === 'systemPowder') return { sourceType: 'system' };
  const where = { babyUid };
  if (s.history) {
    const lo = period.startDate || '1900-01-01'; const hi = period.endDateExclusive || '9999-01-01';
    const lower = name === 'legacyDate' ? new Date(lo + 'T00:00:00+08:00') : lo;
    const upper = name === 'legacyDate' ? new Date(hi + 'T00:00:00+08:00') : hi;
    where.date = _.gte(lower).and(_.lt(upper));
  }
  return where;
}
function decodeDate(value, name) { return name === 'legacyDate' && value ? new Date(value) : value; }
async function scanSource({ db, accessContext, query, period, source, position = {}, readLimit = 1 }) {
  const config = SOURCES[source]; if (!config) fail('INVALID_QUERY', '数据来源无效');
  let where = whereFor(db, source, accessContext.babyUid, period); const _ = db.command;
  // 用关键词中的汉字做宽松预筛选；完整名称、别名和营养条件仍由统一匹配器校验。
  // 单字可出现在任意被搜索字段中，不会漏掉跨字段拼接的中文关键词。
  const character = String(query.keyword || '').match(/[\u4e00-\u9fff]/);
  if (!config.history && character && typeof db.RegExp === 'function') {
    const fields = ['name', 'alias', 'aliasText', 'aliases', 'brand', 'series', 'stage', 'description',
      'category', 'categoryLevel1', 'categoryLevel2', 'sourceFoodCode', 'powderCode', 'notes',
      'ingredients.foodName', 'ingredients.foodSnapshot.name'];
    const prefix = source === 'privatePowder' ? 'formulaPowders.' : '';
    const matches = fields.map(field => ({ [prefix + field]: db.RegExp({ regexp: character[0], options: 'i' }) }));
    where = _.and([where, _.or(matches)]);
  }
  if (position.afterId) {
    const boundary = config.history ? _.or([{ date: _.lt(decodeDate(position.afterDate, source)) }, { date: decodeDate(position.afterDate, source), _id: _.lt(position.afterId) }]) : { _id: _.gt(position.afterId) };
    where = _.and([where, boundary]);
  }
  let read = db.collection(config.collection).where(where);
  if (config.history) read = read.orderBy('date', 'desc');
  const result = await read.orderBy('_id', config.history ? 'desc' : 'asc').limit(Math.max(1, Math.min(100, readLimit))).get();
  const documents = result.data || []; const last = documents[documents.length - 1];
  return { documents, nextPosition: last ? { afterId: last._id, ...(config.history ? { afterDate: last.date instanceof Date ? last.date.toISOString() : last.date } : {}) } : position, exhausted: !documents.length, readCount: Math.max(1, documents.length) };
}
function compareProfile(a, b) {
  const time = x => new Date(x || 0).getTime() || 0;
  const count = x => (x.formulaPowders || []).filter(active).length;
  return time(a.updatedAt) - time(b.updatedAt) || time(a.createdAt) - time(b.createdAt) || count(a) - count(b) || String(a._id).localeCompare(String(b._id));
}
function members(doc, source) { return source === 'privatePowder' ? doc.formulaPowders || [] : SOURCES[source].history ? expandDocument(doc, source) : [doc]; }
function normalizeCandidate(doc, source, offset, babyUid) {
  const s = SOURCES[source]; const member = members(doc, source)[offset]; if (!member) return null;
  const ref = { source, id: doc._id, offset, memberId: String(member.id || member._id || '') };
  if (s.history) return normalizeDietCandidate(doc, member, ref, babyUid);
  return normalizeCatalogCandidate(member, s.type, s.source, ref, babyUid);
}
async function migratedLegacy(db, doc, member) {
  if (!(member.id || member._id) || member.legacyFeeding) return false;
  const r = await db.collection('food_intake_records').where({ babyUid: doc.babyUid,
    'legacySource.collection': 'feeding_records', 'legacySource.recordId': doc._id, 'legacySource.intakeId': member.id || member._id }).limit(1).get();
  return (r.data || []).length > 0;
}
async function readCandidate(db, accessContext, ref) {
  const s = SOURCES[ref.source];
  if (!s || typeof ref.id !== 'string' || ref.id.length > 160 || !Number.isInteger(ref.offset) || ref.offset < 0) fail('INVALID_QUERY', '资料定位无效');
  const doc = await getDocument(db, s.collection, ref.id);
  if (!doc || !active(doc)) return null;
  const allowed = ref.source === 'systemFood' ? visibleFood(doc, '') && (doc.sourceType === 'system' || doc.ownerType === 'system' || doc.isSystem === true)
    : ref.source === 'systemPowder' ? doc.sourceType === 'system'
      : ref.source === 'privateFood' ? visibleFood(doc, accessContext.babyUid) : doc.babyUid === accessContext.babyUid;
  if (!allowed) fail('FORBIDDEN', '无权查看该资料');
  if (ref.memberId && String(((members(doc, ref.source)[ref.offset] || {}).id || (members(doc, ref.source)[ref.offset] || {})._id || '')) !== ref.memberId) return null;
  return normalizeCandidate(doc, ref.source, ref.offset, accessContext.babyUid);
}
async function previewSource(db, accessContext, selector) {
  const source = selector.source;
  if (!SOURCES[source] || SOURCES[source].history || SOURCES[source].type !== selector.type || typeof selector.sourceId !== 'string') fail('INVALID_QUERY', '不支持该资料类型');
  const offset = Number(selector.memberIndex || 0);
  const candidate = await readCandidate(db, accessContext, { source, id: selector.sourceId, offset });
  if (!candidate || candidate.deleted) fail('NOT_FOUND', '资料已删除或归档，请刷新搜索');
  if (selector.memberId && candidate.ref.memberId !== selector.memberId) fail('STALE_RESULT', '资料已变化，请刷新搜索');
  return candidate;
}
module.exports = { SOURCES, sourceNames, whereFor, scanSource, members, normalizeCandidate, migratedLegacy, readCandidate, previewSource, compareProfile, matchCandidate };
