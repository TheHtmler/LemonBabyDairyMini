'use strict';

const { FIELDS, UNITS, MODES, fail, text, number, identity, defaultDefinition } = require('./contracts');
const { validateNutrientEvidence, validateBasisEvidence, readLabelEnergy } = require('./evidenceValidation');
const NUTRIENT_LABELS = { calories: '能量', protein: '蛋白质', fat: '脂肪', carbs: '碳水化合物', fiber: '膳食纤维', sodium: '钠' };

const UNIT_ALIASES = {
  克: 'g', 公克: 'g', gram: 'g', grams: 'g',
  毫克: 'mg', milligram: 'mg', milligrams: 'mg',
  千焦: 'kj', 千焦耳: 'kj', kilojoule: 'kj', kilojoules: 'kj',
  千卡: 'kcal', 大卡: 'kcal', 千卡路里: 'kcal', kilocalorie: 'kcal', kilocalories: 'kcal',
  毫升: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  份: 'portion', serving: 'portion', servings: 'portion'
};
function normalizeUnit(value) {
  const unit = text(value).normalize('NFKC').toLowerCase().replace(/\s/g, '').replace(/[μµ]/g, 'u');
  return typeof UNIT_ALIASES[unit] === 'string' ? UNIT_ALIASES[unit] : unit;
}

function normalizePackageEvidence(raw, imageCount) {
  const result = { identity: null, nutrition: null };
  ['identity', 'nutrition'].forEach(key => {
    const evidence = raw && raw[key];
    if (evidence && Number.isInteger(evidence.imageIndex) && evidence.imageIndex >= 0 &&
        evidence.imageIndex < imageCount && text(evidence.text, 600)) {
      result[key] = { imageIndex: evidence.imageIndex, text: text(evidence.text, 600) };
    }
  });
  return result;
}

function normalizeNutrient(field, raw, warnings = [], options = {}) {
  let entry = raw && typeof raw === 'object' ? raw : { value: raw, unit: UNITS[field] };
  let value = number(entry.value);
  let state = value === null ? 'missing' : 'present';
  let validationIssue = null;
  if (['missing', 'trace', 'below_limit', 'unverified'].includes(entry.state)) {
    state = entry.state;
    value = null;
  }
  // 模型保留标签原单位，中文和英文写法应进入同一换算分支。
  let unit = normalizeUnit(entry.unit);
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
  // 能量原文优先于模型的结构化数值和单位，避免漏换算或重复换算。
  if (options.requireEvidence && evidence && field === 'calories' && value !== null) {
    const energy = readLabelEnergy(evidence.text);
    if (energy) { entry = { ...entry, ...energy }; value = energy.value; unit = energy.unit; }
  }
  if (value !== null) {
    if (field === 'calories' && unit === 'kj') value /= 4.184;
    else if (UNITS[field] === 'g' && unit === 'mg') value /= 1000;
    else if (UNITS[field] === 'mg' && unit === 'g') value *= 1000;
    else if (unit !== UNITS[field]) {
      warnings.push(field + '的单位无法确认，未采用该数值');
      value = null; state = 'missing';
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
  if (options.requireEvidence && evidence && value !== null) {
    const problem = validateNutrientEvidence(field, entry, unit, evidence.text);
    if (problem) {
      const message = (NUTRIENT_LABELS[field] || field) + problem.message + '，未自动采用该读数';
      warnings.push(message); value = null; state = 'missing';
      if (problem.conflict) validationIssue = { code: 'EVIDENCE_CONFLICT', message,
        observedValue: entry.value, observedUnit: text(entry.unit, 40) };
    }
  }
  return { value, state, unit: UNITS[field],
    definition: text(entry.definition, 80) || defaultDefinition(field), evidence,
    ...(validationIssue ? { validationIssue } : {}) };
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
  const packageEvidence = normalizePackageEvidence(mode === 'food_object' ? null : raw.packageEvidence, imageCount);
  if (mode !== 'food_object') {
    const canonical = value => text(value, 600).normalize('NFKC').toLowerCase().replace(/\s/g, '');
    const packageText = canonical(packageEvidence.identity && packageEvidence.identity.text);
    identityCandidates.forEach(candidate => {
      ['brand', 'series', 'stage', 'barcode'].forEach(key => {
        if (candidate[key] && (!packageText.includes(canonical(candidate[key])) ||
            key === 'barcode' && !/^\d{8,14}$/.test(candidate[key]))) candidate[key] = '';
      });
    });
  }
  // 营养表局部图可能没有商品名称，保留已有读数，待补拍正面或手动确认身份。
  if (!identityCandidates.length && !(['food_label', 'powder_label'].includes(mode) && packageEvidence.nutrition)) {
    fail('INVALID_MODEL_RESULT', '未能识别食物或产品名称，请补拍清晰图片');
  }
  if (!identityCandidates.length) packageEvidence.identity = null;
  const sourceBasis = raw.basis || {};
  const basisUnit = normalizeUnit(sourceBasis.unit);
  const basis = {
    quantity: number(sourceBasis.quantity),
    unit: ['g', 'ml', 'portion'].includes(basisUnit) ? basisUnit : null,
    material: ['food', 'dry_powder', 'prepared_formula', 'unknown'].includes(sourceBasis.material)
      ? sourceBasis.material : 'unknown'
  };
  // 普通粉状食品仍按食品计量，不套用奶粉干粉的换算基准。
  if (mode === 'food_label' && ['unknown', 'dry_powder'].includes(basis.material)) basis.material = 'food';
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
  if (basis.evidence && basis.quantity !== null) {
    const problem = validateBasisEvidence(basis, basis.evidence.text);
    if (problem) { basis.quantity = null; basis.unit = null; warnings.push(problem); }
  }
  if (mode === 'powder_label' && ['dry_powder', 'prepared_formula'].includes(basis.material)) {
    identityCandidates.forEach(candidate => { candidate.preparation = basis.material; });
  }
  if (mode === 'food_label') {
    const packageText = [packageEvidence.identity, packageEvidence.nutrition, basis.evidence]
      .filter(Boolean).map(entry => entry.text).join(' ');
    identityCandidates.forEach(candidate => {
      const preparation = candidate.preparation;
      const supported = preparation === 'dry_powder'
        ? /干粉|粉末|粉状|固体饮料|powder/i.test(packageText)
        : /冲调后|冲调液|配制后|调制后|prepared\s+(?:formula|product)|as\s+prepared/i.test(packageText);
      if (['dry_powder', 'prepared_formula'].includes(preparation) && !supported) {
        candidate.preparation = 'unknown';
        warnings.push('商品处理状态缺少相应包装证据，已保留为未知');
      }
    });
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
  return { identityCandidates, packageEvidence, basis, nutrients, formula, formulaEvidence, warnings,
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

function observationPatch(observation, mode) {
  const name = (observation.identityCandidates[0] || {}).name;
  const namePatch = name ? { name } : {};
  if (mode === 'food_object') return namePatch;
  const target = mode === 'powder_label'
    ? { quantity: 100, unit: 'g', material: 'dry_powder' } : observation.basis;
  const values = convertBasis(observation.nutrients, observation.basis, target, observation.formula);
  const nutrition = {};
  if (values) FIELDS.forEach(field => {
    if (values[field].state === 'present') nutrition[field] = values[field].value;
  });
  if (mode === 'powder_label') {
    delete nutrition.sodium;
    return { ...namePatch, nutritionPer100g: nutrition,
      mixRatio: { powder: observation.formula.powderGrams, water: observation.formula.addedWaterMl } };
  }
  return { ...namePatch, unit: target.unit === 'portion' ? '份' : target.unit,
    baseQuantity: target.quantity, ...nutrition };
}

function normalizeAutomaticObservation(raw, options) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !['food_label', 'powder_label', 'food_object', 'uncertain', 'unsupported'].includes(raw.resolvedMode)) fail('INVALID_MODEL_RESULT', '自动识别类型无效，请重新拍摄');
  let resolvedMode = raw.resolvedMode;
  const candidates = (Array.isArray(raw.identityCandidates) ? raw.identityCandidates : []).map(identity).filter(x => x.name);
  // 同一商品不同角度可能只读到部分身份，缺字段不等于不同商品。
  const conflictingProducts = ['brand', 'series', 'stage', 'barcode'].some(key =>
    new Set(candidates.map(candidate => text(candidate[key]).normalize('NFKC').toLowerCase().replace(/\s/g, '')).filter(Boolean)).size > 1);
  const evidence = raw.typeEvidence;
  const validEvidence = evidence && Number.isInteger(evidence.imageIndex) && evidence.imageIndex >= 0 && evidence.imageIndex < options.imageCount && text(evidence.text, 600);
  const packageEvidence = normalizePackageEvidence(raw.packageEvidence, options.imageCount);
  const nutritionOnly = ['food_label', 'powder_label'].includes(resolvedMode) && !!packageEvidence.nutrition;
  if (resolvedMode !== 'unsupported' && (raw.multipleProducts === true || conflictingProducts || (!candidates.length && !nutritionOnly) || !validEvidence)) resolvedMode = 'uncertain';
  if (['uncertain', 'unsupported'].includes(resolvedMode)) {
    return { resolvedMode, observation: { identityCandidates: candidates, basis: { quantity: null, unit: null, material: 'unknown' },
      nutrients: Object.fromEntries(FIELDS.map(field => [field, normalizeNutrient(field, null)])), formula: {}, formulaEvidence: {}, missingFields: [...FIELDS],
      warnings: [resolvedMode === 'unsupported' ? '图片内容不属于可识别的食物' : '图片内容不明确，请拍清一种食品或完整包装'] } };
  }
  return { resolvedMode, observation: normalizeObservation(raw, { ...options, mode: resolvedMode }) };
}
module.exports = { normalizeNutrient, normalizeObservation, normalizeAutomaticObservation, convertBasis, observationPatch };
