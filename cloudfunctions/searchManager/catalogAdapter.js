'use strict';
const { normalizeNutrients, finite, FIELDS, searchText, configuredFrequency } = require('./lib/search');
const { hash, active } = require('./access');
function evidenceFor(doc) {
  const meta = doc.recognitionMeta || {};
  const states = doc.nutrientStates || {};
  const result = {};
  FIELDS.forEach(field => {
    if ((meta.missingFields || []).includes(field)) result[field] = { state: 'missing' };
    else if (states[field]) result[field] = typeof states[field] === 'string' ? { state: states[field] } : states[field];
    else if (['label', 'reference', 'manual', 'model_estimate'].includes((meta.fieldSources || {})[field])) result[field] = { state: 'known', explicit: true };
  });
  return result;
}
function basisFor(doc, type) {
  if (type === 'powder') return { quantity: 100, unit: 'g', material: 'dry_powder' };
  const raw = doc.nutritionBasis || doc.servingBasis || {};
  const quantity = finite(raw.quantity !== undefined ? raw.quantity : doc.baseQuantity !== undefined ? doc.baseQuantity : doc.nutritionPer100g ? 100 : null);
  const unit = raw.unit || doc.baseUnit || (doc.nutritionPer100g ? 'g' : null);
  return { quantity, unit: unit === '份' ? 'portion' : unit, material: 'food', ...(finite(raw.weightGrams) > 0 ? { weightGrams: Number(raw.weightGrams) } : {}) };
}
function normalizeCatalogCandidate(doc, type, source, ref, babyUid) {
  const aliases = [...new Set([
    ...(Array.isArray(doc.alias) ? doc.alias : typeof doc.alias === 'string' ? [doc.alias] : []),
    ...(Array.isArray(doc.aliases) ? doc.aliases : []),
    ...String(doc.aliasText || '').split(/[/、，,]/).filter(Boolean)
  ])];
  const ingredientNames = (doc.ingredients || []).map(x => x.foodName || x.foodSnapshot && x.foodSnapshot.name || '');
  const name = String(doc.name || '').slice(0, 240);
  const basis = basisFor(doc, type);
  const nutrition = doc.nutritionPerBasis || doc.nutritionPer100g || doc.nutritionPerUnit || {};
  const identity = [type, source, ref.id, ref.memberId || '', doc.brand || '', doc.series || '', doc.stage || '', (doc.recognitionMeta || {}).confirmedIdentity || ''];
  return { id: hash([ref.source, ref.id, ref.offset || 0]), type, source, sourceId: ref.id, groupKey: hash(identity), name,
    aliases, searchText: searchText([name, ...aliases, doc.brand, doc.series, doc.stage, doc.description, doc.category, doc.categoryLevel1, doc.categoryLevel2, doc.sourceFoodCode, doc.powderCode, doc.notes, ...ingredientNames].filter(Boolean).join(' ')),
    category: doc.category || doc.categoryLevel1 || '', categoryPath: [doc.category, doc.categoryLevel1, doc.categoryLevel2].filter(Boolean).join('/'), brand: doc.brand || '', series: doc.series || '', stage: doc.stage || '', ingredients: ingredientNames,
    ...(type === 'medication' ? { dosage: String(doc.dosage || ''), unit: String(doc.unit || ''), frequency: configuredFrequency(doc),
      frequencyDays: doc.frequencyDays || '', frequencyTimes: doc.frequencyTimes || '',
      concentration: String(doc.concentration || ''), concentrationUnit: String(doc.concentrationUnit || ''), volumeUnit: String(doc.volumeUnit || ''), notes: String(doc.notes || '').slice(0, 1000) } : {}),
    image: typeof doc.image === 'string' ? doc.image : '',
    date: '', time: '', actualQuantity: 0, actualUnit: '', nutritionBasis: basis,
    nutrients: normalizeNutrients(nutrition, evidenceFor(doc), basis), provenance: { fieldSources: (doc.recognitionMeta || {}).fieldSources || {}, kind: doc.recognitionMeta ? 'confirmed' : source },
    deleted: !active(doc), locator: { kind: 'catalog', babyUid, sourceId: ref.id, memberId: ref.memberId || '', memberIndex: ref.offset || 0, source: ref.source, type }, ref };
}
function publicCandidate(candidate) { const { ref, deleted, searchText, aliases, ...value } = candidate; return value; }
module.exports = { evidenceFor, basisFor, normalizeCatalogCandidate, publicCandidate };
