'use strict';

const { FIELDS, UNITS, MODES, fail, text, number, identity, defaultDefinition } = require('./contracts');

function normalizeNutrient(field, raw, warnings = [], options = {}) {
  const entry = raw && typeof raw === 'object' ? raw : { value: raw, unit: UNITS[field] };
  let value = number(entry.value);
  let state = value === null ? 'missing' : 'present';
  if (['missing', 'trace', 'below_limit', 'unverified'].includes(entry.state)) {
    state = entry.state;
    value = null;
  }
  const unit = text(entry.unit).toLowerCase().replace('μ', 'u').replace('µ', 'u');
  if (value !== null) {
    if (field === 'calories' && unit === 'kj') value /= 4.184;
    else if (UNITS[field] === 'g' && unit === 'mg') value /= 1000;
    else if (UNITS[field] === 'mg' && unit === 'g') value *= 1000;
    else if (unit !== UNITS[field]) {
      warnings.push(field + '的单位无法确认，未采用该数值');
      value = null; state = 'missing';
    }
  }
  let evidence = null;
  if (entry.evidence && typeof entry.evidence === 'object') {
    const index = entry.evidence.imageIndex;
    const content = text(entry.evidence.text, 600);
    if (Number.isInteger(index) && index >= 0 && index < options.imageCount && content) {
      evidence = { imageIndex: index, text: content };
    } else if (options.requireEvidence) {
      fail('INVALID_MODEL_RESULT', '识别证据的图片序号或文字无效');
    }
  }
  if (options.requireEvidence && value !== null && !evidence) {
    warnings.push(field + '缺少图片文字证据，未自动采用');
    value = null; state = 'missing';
  }
  if (options.requireEvidence && evidence && /微量|痕量|trace/i.test(evidence.text)) {
    value = null; state = 'trace';
  } else if (options.requireEvidence && evidence && /[<≤]|低于|小于|少于/.test(evidence.text)) {
    value = null; state = 'below_limit';
  } else if (options.requireEvidence && evidence && /[%％]/.test(evidence.text) &&
      !/kcal|kJ|\d\s*(?:mg|g)|毫克|千卡|千焦|克/i.test(evidence.text)) {
    value = null; state = 'missing'; warnings.push(field + '的证据只有百分比，未采用为营养含量');
  }
  return { value, state, unit: UNITS[field],
    definition: text(entry.definition, 80) || defaultDefinition(field), evidence };
}

function normalizeObservation(raw = {}, { mode, imageCount = 1 } = {}) {
  if (!MODES.includes(mode) || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('INVALID_MODEL_RESULT', '识别结果结构无效');
  }
  const warnings = [];
  const hasEvidence = evidence => evidence && Number.isInteger(evidence.imageIndex) &&
    evidence.imageIndex >= 0 && evidence.imageIndex < imageCount && text(evidence.text, 600);
  const candidates = Array.isArray(raw.identityCandidates) ? raw.identityCandidates : [];
  const identityCandidates = candidates.map(identity).filter(x => x.name).slice(0, 8);
  if (!identityCandidates.length) fail('INVALID_MODEL_RESULT', '未能识别食物或产品名称，请补拍清晰图片');
  const sourceBasis = raw.basis || {};
  const basis = {
    quantity: number(sourceBasis.quantity),
    unit: ['g', 'ml', 'portion'].includes(sourceBasis.unit) ? sourceBasis.unit : null,
    material: ['food', 'dry_powder', 'prepared_formula', 'unknown'].includes(sourceBasis.material)
      ? sourceBasis.material : 'unknown'
  };
  if (mode === 'food_object') {
    basis.quantity = null; basis.unit = null; basis.material = 'food';
  }
  if (mode !== 'food_object' && !hasEvidence(sourceBasis.evidence)) {
    basis.quantity = null;
    warnings.push('计量基准缺少标签证据，请核对后手工填写');
  }
  if (mode !== 'food_object' && hasEvidence(sourceBasis.evidence)) basis.evidence = {
    imageIndex: sourceBasis.evidence.imageIndex, text: text(sourceBasis.evidence.text, 600)
  };
  if (mode === 'powder_label' && ['dry_powder', 'prepared_formula'].includes(basis.material)) {
    identityCandidates.forEach(candidate => { candidate.preparation = basis.material; });
  }
  const nutrients = {};
  FIELDS.forEach(field => {
    const entry = (raw.nutrients || {})[field];
    if (entry && entry.value !== null && entry.value !== undefined &&
        (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0)) {
      fail('INVALID_MODEL_RESULT', field + '不是有效的非负数字');
    }
    nutrients[field] = normalizeNutrient(field, mode === 'food_object' ? null : entry, warnings,
      { imageCount, requireEvidence: mode !== 'food_object' });
  });
  const formula = {};
  const formulaEvidence = {};
  ['powderGrams', 'addedWaterMl', 'preparedVolumeMl', 'scoopCount', 'scoopGrams'].forEach(field => {
    const evidence = (raw.formulaEvidence || {})[field];
    formula[field] = mode !== 'food_object' && hasEvidence(evidence) ? number((raw.formula || {})[field]) : null;
    if (mode !== 'food_object' && hasEvidence(evidence)) formulaEvidence[field] = { imageIndex: evidence.imageIndex, text: text(evidence.text, 600) };
  });
  if (!formula.powderGrams && formula.scoopCount > 0 && formula.scoopGrams > 0) {
    formula.powderGrams = formula.scoopCount * formula.scoopGrams;
  }
  return { identityCandidates, basis, nutrients, formula, formulaEvidence, warnings,
    missingFields: FIELDS.filter(field => nutrients[field].state !== 'present') };
}

function convertBasis(nutrients, basis, target, formula = {}) {
  let scale = null;
  if (basis.quantity > 0 && target.quantity > 0 && basis.unit === target.unit &&
      basis.material === target.material) scale = target.quantity / basis.quantity;
  // 冲调液只能使用粉重与成品体积换算，不能用加水量代替成品体积。
  if (basis.material === 'prepared_formula' && basis.unit === 'ml' && basis.quantity > 0 &&
      target.material === 'dry_powder' && target.unit === 'g' &&
      formula.powderGrams > 0 && formula.preparedVolumeMl > 0) {
    scale = formula.preparedVolumeMl / basis.quantity * target.quantity / formula.powderGrams;
  }
  if (scale === null || !Number.isFinite(scale)) return null;
  const result = {};
  FIELDS.forEach(field => {
    const entry = nutrients[field];
    result[field] = { ...entry, value: entry && entry.state === 'present' ? entry.value * scale : null };
  });
  return result;
}

function toComparableBasis(observation, reference) {
  const warnings = [];
  const observed = convertBasis(observation.nutrients, observation.basis, reference.basis, observation.formula);
  if (!observed) warnings.push('计量基准或物料状态不同，无法直接比较');
  return { observed, reference: reference.nutrients, warnings };
}

function observationPatch(observation, mode) {
  const name = observation.identityCandidates[0].name;
  if (mode === 'food_object') return { name };
  const target = mode === 'powder_label'
    ? { quantity: 100, unit: 'g', material: 'dry_powder' } : observation.basis;
  const values = convertBasis(observation.nutrients, observation.basis, target, observation.formula);
  const nutrition = {};
  if (values) FIELDS.forEach(field => {
    if (values[field].state === 'present') nutrition[field] = values[field].value;
  });
  if (mode === 'powder_label') {
    delete nutrition.sodium;
    return { name, nutritionPer100g: nutrition,
      mixRatio: { powder: observation.formula.powderGrams, water: observation.formula.addedWaterMl } };
  }
  return { name, unit: target.unit === 'portion' ? '份' : target.unit,
    baseQuantity: target.quantity, ...nutrition };
}

function normalizeAutomaticObservation(raw, options) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['food_label', 'powder_label', 'food_object', 'uncertain', 'unsupported'].includes(raw.resolvedMode)) fail('INVALID_MODEL_RESULT', '自动识别类型无效，请重新拍摄');
  let resolvedMode = raw.resolvedMode;
  const candidates = (Array.isArray(raw.identityCandidates) ? raw.identityCandidates : []).map(identity).filter(x => x.name);
  const products = new Set(candidates.filter(x => x.brand || x.series || x.stage).map(x => [x.brand, x.series, x.stage].join('|')));
  const evidence = raw.typeEvidence;
  const validEvidence = evidence && Number.isInteger(evidence.imageIndex) && evidence.imageIndex >= 0 && evidence.imageIndex < options.imageCount && text(evidence.text, 600);
  if (resolvedMode !== 'unsupported' && (raw.multipleProducts === true || products.size > 1 || !candidates.length || !validEvidence)) resolvedMode = 'uncertain';
  if (['uncertain', 'unsupported'].includes(resolvedMode)) {
    return { resolvedMode, observation: { identityCandidates: candidates, basis: { quantity: null, unit: null, material: 'unknown' },
      nutrients: Object.fromEntries(FIELDS.map(field => [field, normalizeNutrient(field, null)])), formula: {}, formulaEvidence: {}, missingFields: [...FIELDS],
      warnings: [resolvedMode === 'unsupported' ? '图片内容不属于可识别的食物或奶粉' : '物品类型或身份不明确，请确认类型并重新识别'] } };
  }
  return { resolvedMode, observation: normalizeObservation(raw, { ...options, mode: resolvedMode }) };
}
module.exports = { normalizeNutrient, normalizeObservation, normalizeAutomaticObservation, convertBasis, toComparableBasis, observationPatch };
