'use strict';
const { normalizeNutrients, businessDate, finite, searchText } = require('./lib/search');
const { evidenceFor, basisFor } = require('./catalogAdapter');
const { active, hash } = require('./access');
function timeOf(raw) {
  if (raw instanceof Date || typeof raw === 'string' && /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const parsed = new Date(raw).getTime(); if (Number.isFinite(parsed)) return new Date(parsed + 28800000).toISOString().slice(11, 19);
  }
  const match = String(raw || '').match(/(?:^|T)(\d{2}:\d{2})(?::(\d{2}))?/);
  return match ? match[1] + ':' + (match[2] || '00') : '00:00:00';
}
function normalizeDietCandidate(doc, member, ref, babyUid) {
  if (member.type === 'milk' || member.milkType) return null;
  const snapshot = member.foodSnapshot || {};
  const type = member.sourceType === 'recipe' || member.recipeSource ? 'recipe' : 'food';
  const name = member.foodName || member.name || member.nameSnapshot || snapshot.name || (member.recipeSource || {}).recipeName || '未命名食物';
  const raw = snapshot.nutritionPerBasis || snapshot.nutritionPer100g || snapshot.nutritionPerUnit || {};
  const basis = basisFor(snapshot, 'food'); const quantity = finite(member.quantity) || 0; const unit = member.unit || 'g';
  const identity = [type, babyUid, type === 'recipe' ? (member.recipeSource || {}).recipeId : member.foodId,
    snapshot.sourceFoodCode || '', name, (snapshot.recognitionMeta || {}).confirmedIdentity || '', snapshot.category || ''];
  // 无稳定资料身份时不按同名合并，以免混淆品牌、段数与生熟状态。
  if (!member.foodId && !(member.recipeSource || {}).recipeId) identity.push(doc._id, ref.offset);
  const date = businessDate(doc.date || member.date);
  const time = timeOf(member.time || member.recordedAt || doc.startTime || doc.time || doc.recordedAt);
  const aliases = [];
  const candidate = { id: hash([ref.source, doc._id, ref.offset]), type, source: 'history', sourceId: doc._id, groupKey: hash(identity), name: String(name).slice(0, 240), aliases,
    searchText: searchText([name, member.notes, member.mealType, doc.notes, doc.mealType, snapshot.category, ...(type === 'recipe' ? (((member.recipeSource || {}).ingredientsSnapshot) || []).map(x => x.foodName || (x.foodSnapshot || {}).name || '') : [])].filter(Boolean).join(' ')),
    image: typeof snapshot.image === 'string' ? snapshot.image : '',
    date, time, actualQuantity: quantity, actualUnit: unit, nutritionBasis: basis, nutrients: normalizeNutrients(raw, evidenceFor(snapshot), basis),
    provenance: { fieldSources: (snapshot.recognitionMeta || {}).fieldSources || {}, kind: 'historical_snapshot' },
    deleted: !active(doc) || !active(member),
    locator: { kind: ref.source.startsWith('legacy') ? 'legacy' : ref.source === 'milkIntakes' ? 'milk' : 'meal', babyUid, date, recordId: doc._id, mealBatchId: member.mealBatchId || '', legacyIntakeId: ref.source.startsWith('legacy') ? String(member.id || member._id || '') : '' }, ref };
  return candidate;
}
module.exports = { timeOf, normalizeDietCandidate };
