// 手工编辑后保留识别原始证据，并更新最终值的来源。
const NUTRITION_FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'];
const NUTRITION_UNITS = { calories: 'kcal', protein: 'g', fat: 'g', carbs: 'g', fiber: 'g', sodium: 'mg' };

// 食物展示和计算统一把缺失值按零处理，来源证据仍保留在原文档中。
function normalizeFoodNutritionValues(nutrition = {}) {
  const result = { ...(nutrition || {}) };
  [...NUTRITION_FIELDS, 'naturalProtein', 'specialProtein'].forEach(field => {
    if (!NUTRITION_FIELDS.includes(field) && !Object.prototype.hasOwnProperty.call(result, field)) return;
    const raw = result[field];
    const value = (typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
    result[field] = Number.isFinite(value) && value >= 0 ? value : 0;
  });
  delete result.missingFields;
  return result;
}

// 来源核对仍区分真实零值和缺项，不把展示默认值当作原始证据。
function withMissingNutrition(nutrition, ...sources) {
  const missing = new Set();
  [nutrition, ...sources].filter(Boolean).forEach(source => {
    const meta = source.recognitionMeta || {};
    [source.missingFields, meta.missingFields].filter(Array.isArray).flat().forEach(field => missing.add(field));
    NUTRITION_FIELDS.forEach(field => {
      const state = (source.nutrientStates || {})[field];
      const confirmed = ['label', 'reference', 'manual', 'model_estimate'].includes((meta.fieldSources || {})[field]);
      if (!confirmed && ((source.missingNutrition || {})[field] || state && ['missing', 'unverified', 'trace', 'below_limit', 'not_convertible'].includes(typeof state === 'string' ? state : state.state))) missing.add(field);
    });
  });
  const fields = NUTRITION_FIELDS.filter(field => missing.has(field) && Object.prototype.hasOwnProperty.call(nutrition, field));
  return fields.length ? { ...nutrition, ...Object.fromEntries(fields.map(field => [field, null])), missingFields: fields } : nutrition;
}

function copyRecognitionMetaForSnapshot(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const next = {};
  // 历史快照只带识别流程定义的字段，不带页面临时属性；深复制隔离后续目录编辑。
  ['sessionId', 'requestId', 'modelInfo', 'confirmedIdentity', 'originalBasis', 'originalNutrients',
    'formula', 'formulaEvidence', 'finalBasis', 'evidence', 'reference', 'comparisonStatus',
    'confirmedAt', 'confirmedBy', 'modelEstimate', 'mixRatioSource', 'identityEdited'].forEach(key => {
    if (meta[key] !== undefined) next[key] = meta[key];
  });
  next.fieldSources = {};
  NUTRITION_FIELDS.forEach(field => {
    const source = (meta.fieldSources || {})[field];
    if (['label', 'reference', 'manual', 'model_estimate'].includes(source)) next.fieldSources[field] = source;
  });
  next.missingFields = Array.isArray(meta.missingFields) ? meta.missingFields.filter(field => NUTRITION_FIELDS.includes(field)) : [];
  return JSON.parse(JSON.stringify(next));
}

function updateManualProvenance(meta, before = {}, after = {}, basisChanged = false, rawValues, touchedFields = []) {
  if (!meta) return undefined;
  const next = { ...meta, fieldSources: { ...(meta.fieldSources || {}) }, missingFields: [...(meta.missingFields || [])] };
  NUTRITION_FIELDS.forEach(field => {
    const hasRaw = rawValues && Object.prototype.hasOwnProperty.call(rawValues, field);
    if (hasRaw && (rawValues[field] == null || String(rawValues[field]).trim() === '')) {
      delete next.fieldSources[field];
      if (!next.missingFields.includes(field)) next.missingFields.push(field);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(after, field) && (basisChanged || touchedFields.includes(field) ||
        (hasRaw && next.missingFields.includes(field)) || Number(before[field]) !== Number(after[field]))) {
      next.fieldSources[field] = 'manual';
      next.missingFields = next.missingFields.filter(x => x !== field);
    }
  });
  if (basisChanged) next.comparisonStatus = 'stale';
  return next;
}

// 写入食物时同时更新数值和状态，避免手填零值仍被旧的缺项标记覆盖。
// 缺项按零保存用于计算，原始缺项状态仍保留，避免把默认零当作手工确认。
function reconcileFoodNutritionForWrite(foodData, normalized, previous = foodData) {
  const raw = foodData.rawNutrition || foodData.nutritionPerBasis || foodData.nutritionPer100g || foodData.nutritionPerUnit || {};
  const explicitForm = !!foodData.rawNutrition;
  const touched = new Set(foodData.touchedNutritionFields || []);
  const before = previous.nutritionPerBasis || previous.nutritionPer100g || previous.nutritionPerUnit || {};
  const previousStates = previous.nutrientStates || {};
  const meta = previous.recognitionMeta || foodData.recognitionMeta;
  const basis = foodData.nutritionBasis || {};
  const previousBasis = previous.nutritionBasis || {};
  const basisChanged = previous !== foodData && (basis.quantity !== previousBasis.quantity || basis.unit !== previousBasis.unit);
  const probe = withMissingNutrition(Object.fromEntries(NUTRITION_FIELDS.map(field => [field, 1])), before, previous);
  const values = { ...normalized };
  const states = {};
  const missing = new Set();
  const manualFields = new Set(touched);
  const isValue = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
    && Number.isFinite(Number(value)) && Number(value) >= 0;

  NUTRITION_FIELDS.forEach(field => {
    const value = raw[field];
    const previousState = previousStates[field];
    const state = typeof previousState === 'string' ? { state: previousState } : (previousState || {});
    const wasMissing = probe[field] == null;
    const confirmedZero = isValue(before[field]) && Number(before[field]) === 0
      && (['known', 'present'].includes(state.state) || state.explicit === true
        || ['label', 'reference', 'manual', 'model_estimate'].includes(meta?.fieldSources?.[field]));
    const unverifiedZero = !explicitForm && isValue(value) && Number(value) === 0 && !confirmedZero;
    const defaultedZero = explicitForm && !touched.has(field) && !basisChanged
      && isValue(value) && Number(value) === 0 && (wasMissing || !isValue(before[field]));
    if (!isValue(value) || defaultedZero || unverifiedZero) {
      if (explicitForm && value != null && String(value).trim() !== '' && !isValue(value)) {
        throw new Error(field + ' 必须填写大于等于 0 的有效数值');
      }
      values[field] = 0;
      missing.add(field);
      states[field] = {
        ...(!touched.has(field) && ['missing', 'trace', 'below_limit', 'unverified', 'not_convertible'].includes(state.state) ? state : {}),
        state: !touched.has(field) && ['trace', 'below_limit', 'unverified', 'not_convertible'].includes(state.state) ? state.state : 'missing',
        value: null,
        unit: NUTRITION_UNITS[field],
        reason: unverifiedZero ? 'unverified_zero' : !touched.has(field) && state.reason ? state.reason : 'missing'
      };
      return;
    }

    const displayedBefore = isValue(before[field]) ? Math.round(Number(before[field]) * 100) / 100 : null;
    const manuallyChanged = explicitForm && (previous === foodData && !state.state && !meta?.fieldSources?.[field]
      || basisChanged || touched.has(field) || wasMissing
      || displayedBefore === null || Number(value) !== displayedBefore);
    if (manuallyChanged) manualFields.add(field);
    // 未编辑的识别值保留数据库精度，不用表单显示的两位小数覆盖原始数值。
    if (!basisChanged && !manuallyChanged && meta?.fieldSources?.[field] && displayedBefore === Number(value)) {
      values[field] = Number(before[field]);
    }
    states[field] = { state: 'known', value: values[field], unit: NUTRITION_UNITS[field], reason: '',
      ...(manuallyChanged ? { source: 'manual', explicit: true } : state.source ? { source: state.source } : {}) };
  });

  const missingFields = NUTRITION_FIELDS.filter(field => missing.has(field));
  const result = {
    nutritionPerBasis: normalizeFoodNutritionValues(values),
    nutrientStates: states,
    missingFields,
    missingNutrition: Object.fromEntries(NUTRITION_FIELDS.map(field => [field, missing.has(field)]))
  };
  if (meta) {
    result.recognitionMeta = updateManualProvenance(meta, before, values, basisChanged,
      explicitForm ? raw : undefined, [...manualFields]);
    result.recognitionMeta.missingFields = missingFields;
    missingFields.forEach(field => { delete result.recognitionMeta.fieldSources[field]; });
    if (basisChanged) result.recognitionMeta.finalBasis = { ...basis, material: 'food' };
  }
  return result;
}

function updatePowderProvenance(meta, before = {}, after = {}) {
  const next = updateManualProvenance(meta, before.nutritionPer100g, after.nutritionPer100g,
    false, after.rawNutrition, after.touchedNutritionFields);
  if (!next) return undefined;
  if (before.name !== after.name) { next.comparisonStatus = 'stale'; next.identityEdited = true; }
  if (['powder', 'water'].some(field => Number((before.mixRatio || {})[field]) !== Number((after.mixRatio || {})[field]))) {
    next.mixRatioSource = 'manual';
  }
  return next;
}
module.exports = { updateManualProvenance, updatePowderProvenance, copyRecognitionMetaForSnapshot, withMissingNutrition, normalizeFoodNutritionValues, reconcileFoodNutritionForWrite };
