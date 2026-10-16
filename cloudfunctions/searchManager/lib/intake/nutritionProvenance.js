// 手工编辑后保留识别原始证据，并更新最终值的来源。
const NUTRITION_FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'];

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
module.exports = { updateManualProvenance, updatePowderProvenance, copyRecognitionMetaForSnapshot };
