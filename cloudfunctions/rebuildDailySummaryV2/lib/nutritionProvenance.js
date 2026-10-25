// 手工编辑后保留识别原始证据，并更新最终值的来源。
const NUTRITION_FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'];

// 计算与汇总仍可复用数值算法，但有缺项的指标不能作为完整的零值输出。
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
module.exports = { updateManualProvenance, updatePowderProvenance, copyRecognitionMetaForSnapshot, withMissingNutrition };
