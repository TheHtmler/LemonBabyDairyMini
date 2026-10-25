'use strict';

const { FIELDS, number, text, identity } = require('./contracts');
const { normalizeNutrient, convertBasis } = require('./normalize');

function normalizeReferenceRecord(raw, options = {}) {
  const source = raw.source || {};
  const provider = text(options.provider || source.provider, 80);
  const version = text(options.version || source.version, 80);
  const recordId = text(source.recordId || raw.recordId, 100);
  const verified = options.usageVerified === true && source.verified === true;
  const nutrients = {};
  FIELDS.forEach(field => { nutrients[field] = normalizeNutrient(field, (raw.nutrients || {})[field]); });
  return {
    referenceId: provider + ':' + recordId + ':' + version,
    identity: identity(raw.identity || raw),
    basis: { quantity: number((raw.basis || {}).quantity), unit: (raw.basis || {}).unit || null,
      material: (raw.basis || {}).material || 'unknown' },
    nutrients,
    source: { provider, recordId, version, verified,
      url: text(options.sourceUrl || source.url, 1000), dataType: text(source.dataType, 100) }
  };
}

function searchText(value) { return text(value).toLowerCase().replace(/[\s（）()、，,·-]/g, ''); }

function identityMatches(left, right) {
  // other 表示明确的其他制备方式或成品，不能与状态未知混为一谈。
  if (left.preparation === 'unknown' || right.preparation === 'unknown' ||
      left.preparation !== right.preparation) return false;
  const barcodeMatches = left.barcode && right.barcode && /^\d{8,14}$/.test(left.barcode) && left.barcode === right.barcode;
  const isProduct = ['dry_powder', 'prepared_formula'].includes(left.preparation) ||
    [left.brand, left.series, left.stage, right.brand, right.series, right.stage].some(Boolean);
  if (isProduct) {
    if (['brand', 'series', 'stage'].some(k => left[k] && right[k] && searchText(left[k]) !== searchText(right[k]))) return false;
    if (barcodeMatches) return true;
    if (!left.brand || !left.series || !right.brand || !right.series) return false;
    if (['brand', 'series', 'stage'].some(k => searchText(left[k]) !== searchText(right[k]))) return false;
  }
  if (left.barcode && right.barcode && left.barcode !== right.barcode) return false;
  const genericNames = ['青菜', '绿叶菜', '蔬菜', '水果', '肉', '食物', '奶粉', '配方粉', '婴儿配方奶粉', 'vegetable', 'greens'];
  if (genericNames.includes(searchText(left.name)) || genericNames.includes(searchText(right.name))) return false;
  const names = [right.name].concat(right.aliases || []).map(searchText);
  // 仅可信参考维护的名称映射可证明同一身份，模型生成别名只用于查找候选。
  return names.includes(searchText(left.name));
}

function matchReferenceCandidates(input, references) {
  const wanted = identity(input);
  if (!wanted.name) return { status: 'not_found', candidates: [], exactIds: [] };
  const verified = references.filter(x => x.source && x.source.verified);
  const exact = verified.filter(x => identityMatches(wanted, x.identity));
  const list = exact.length ? exact : verified.filter(x =>
    [x.identity.name].concat(x.identity.aliases || []).some(name =>
      searchText(name).includes(searchText(wanted.name)) || searchText(wanted.name).includes(searchText(name))));
  return { status: exact.length === 1 ? 'matched' : list.length ? 'ambiguous' : 'not_found',
    candidates: list.slice(0, 20), exactIds: exact.map(x => x.referenceId) };
}

function compareNutrition(observation, reference, version, targetBasis) {
  const basis = targetBasis || (reference && reference.basis);
  const observed = basis ? convertBasis(observation.nutrients, observation.basis, basis, observation.formula) : null;
  const standard = reference && basis ? convertBasis(reference.nutrients, reference.basis, basis) : null;
  const warnings = reference && (!observed || !standard) ? ['计量基准或物料状态不同，无法直接比较'] : [];
  return { version, referenceId: reference ? reference.referenceId : null,
    basis, status: reference ? 'matched' : 'not_found', warnings,
    fields: FIELDS.map(path => {
      const a = observed && observed[path];
      const b = standard && standard[path];
      let state = 'comparable';
      if (reference && (!observed || !standard)) state = 'incompatible_basis';
      else if (!b || b.state !== 'present') state = 'missing_reference';
      else if (observation.nutrients[path].state !== 'present') state = 'missing_observed';
      else if (!a) state = 'incompatible_basis';
      else if (a.definition === 'unknown' || b.definition === 'unknown' || a.definition !== b.definition) {
        state = 'incompatible_definition';
      }
      const delta = state === 'comparable' ? a.value - b.value : null;
      return { path, observed: a ? a.value : null, reference: b ? b.value : null, state, delta,
        deltaPercent: delta !== null && b.value > 0 ? delta / b.value * 100 : null };
    }) };
}

module.exports = { normalizeReferenceRecord, searchText, identityMatches, matchReferenceCandidates, compareNutrition };
