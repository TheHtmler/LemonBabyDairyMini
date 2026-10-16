'use strict';
const { FIELDS, UNITS } = require('./contracts');
function finite(value) { return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null; }
function normalizeNutrients(raw = {}, evidence = {}, basis = {}) {
  const result = {};
  FIELDS.forEach(field => {
    const entry = raw[field] && typeof raw[field] === 'object' ? raw[field] : { value: raw[field] };
    const proof = evidence[field] || {};
    const state = proof.state === 'missing' ? 'missing' : entry.state || proof.state;
    let value = finite(entry.value);
    let unit = entry.unit || proof.unit || UNITS[field];
    let reason = '';
    if (['missing', 'trace', 'below_limit', 'unverified'].includes(state)) { value = null; reason = state; }
    if (state === 'not_convertible') reason = proof.reason || 'not_convertible';
    // 旧模型会将缺失写成零，没有字段证据时无法证明这个零是真实观测。
    if (value === 0 && !['present', 'known'].includes(state) && proof.explicit !== true) { value = null; reason = 'unverified_zero'; }
    if (value !== null) {
      if (field === 'calories' && unit === 'kJ') value /= 4.184;
      else if (UNITS[field] === 'g' && unit === 'mg') value /= 1000;
      else if (UNITS[field] === 'mg' && unit === 'g') value *= 1000;
      else if (unit !== UNITS[field]) { value = null; reason = 'unknown_unit'; }
    }
    const usableBasis = finite(basis.quantity) > 0 && ['g', 'ml', 'portion'].includes(basis.unit);
    result[field] = { state: state === 'not_convertible' || reason === 'unknown_unit' ? 'not_convertible' : value === null ? 'missing' : usableBasis ? 'known' : 'not_convertible', value, unit: UNITS[field], reason: reason || (value === null ? 'missing' : usableBasis ? '' : 'missing_basis') };
  });
  return result;
}
function compareNutrient(candidate, condition, powderBasis) {
  const entry = candidate.nutrients[condition.field]; const basis = candidate.nutritionBasis || {};
  if (!entry || entry.state !== 'known') return { state: 'unknown', reason: entry && entry.reason || 'missing' };
  if (candidate.type === 'powder' && basis.material !== (powderBasis === 'dry' ? 'dry_powder' : 'prepared_formula')) return { state: 'unknown', reason: 'incompatible_material' };
  const denominator = basis.unit === 'portion' && condition.basisUnit === 'g' && finite(basis.weightGrams) > 0 ? Number(basis.weightGrams) : basis.unit === condition.basisUnit ? basis.quantity : null;
  if (!(denominator > 0) || (condition.basisUnit === 'portion' && !basis.portionIdentity)) return { state: 'unknown', reason: 'not_convertible' };
  const value = entry.value * condition.basisQuantity / denominator;
  const bound = condition.value;
  const matched = { lt: value < bound, lte: value <= bound, eq: Math.abs(value - bound) <= 1e-9, gte: value >= bound, gt: value > bound }[condition.operator];
  return { state: matched ? 'matched' : 'unmatched', value, reason: '' };
}
function indexNutrientStates(doc, raw, basis) {
  const meta = doc.recognitionMeta || {}; const evidence = {};
  FIELDS.forEach(field => {
    const previous = (doc.nutrientStates || {})[field];
    if ((meta.missingFields || []).includes(field)) evidence[field] = { state: 'missing' };
    else if (previous) evidence[field] = typeof previous === 'string' ? { state: previous } : previous;
    else if (['label', 'reference', 'manual', 'model_estimate'].includes((meta.fieldSources || {})[field])) evidence[field] = { state: 'known' };
  });
  return normalizeNutrients(raw, evidence, basis);
}
module.exports = { finite, normalizeNutrients, compareNutrient, indexNutrientStates };
