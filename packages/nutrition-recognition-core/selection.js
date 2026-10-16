'use strict';

const { FIELDS, text, number, fail, validateFinalPatch } = require('./contracts');
const { convertBasis } = require('./normalize');
const { validateEstimateBinding } = require('./estimate');

function buildConfirmedPatch({ observation, reference, estimate, confirmedIdentity, comparisonVersion,
  decisions = [], targetBasis, mode, name, mixRatio }) {
  const label = convertBasis(observation.nutrients, observation.basis, targetBasis, observation.formula);
  const standard = reference && convertBasis(reference.nutrients, reference.basis, targetBasis);
  const values = {}; const fieldSources = {}; const evidence = {}; const missingFields = [];
  if (!Array.isArray(decisions) || decisions.some(x => !x || typeof x !== 'object' || Array.isArray(x) || typeof x.path !== 'string')) {
    fail('VALIDATION_FAILED', '选值字段格式无效');
  }
  if (decisions.length > FIELDS.length || new Set(decisions.map(x => x.path)).size !== decisions.length) {
    fail('VALIDATION_FAILED', '选值字段重复或过多');
  }
  const estimated = decisions.some(decision => decision.source === 'model_estimate') ? validateEstimateBinding(estimate,
    { mode, identity: confirmedIdentity || observation.identityCandidates[0], observation, reference,
      basis: targetBasis, comparisonVersion }) : null;
  FIELDS.forEach(field => {
    const decision = decisions.find(x => x.path === field);
    let value = null;
    if (decision) {
      if (!['label', 'reference', 'manual', 'model_estimate'].includes(decision.source)) fail('VALIDATION_FAILED', '营养来源无效');
      if (decision.source === 'manual') value = number(decision.value);
      else if (decision.source === 'model_estimate') {
        if (!estimated.fields.includes(field)) fail('VALIDATION_FAILED', '已有标签或参考值的指标不能用AI估算替代');
        const entry = estimated.nutrients && estimated.nutrients[field];
        if (entry && entry.state === 'present') value = number(entry.value);
      }
      else {
        const entry = (decision.source === 'label' ? label : standard) &&
          (decision.source === 'label' ? label : standard)[field];
        if (entry && entry.state === 'present') value = entry.value;
      }
      if (value === null) fail('VALIDATION_FAILED', field + '未提供可采用的营养值');
      fieldSources[field] = decision.source;
      if (decision.source === 'label' && observation.nutrients[field].evidence) {
        evidence[field] = observation.nutrients[field].evidence;
      }
    } else missingFields.push(field);
    values[field] = value;
  });
  if (decisions.some(x => !FIELDS.includes(x.path))) fail('VALIDATION_FAILED', '存在非白名单营养字段');
  const patch = mode === 'powder_label'
    ? { name: text(name), nutritionPer100g: values,
      mixRatio: { powder: number(mixRatio && mixRatio.powder), water: number(mixRatio && mixRatio.water) } }
    : { name: text(name), unit: targetBasis.unit === 'portion' ? '份' : targetBasis.unit,
      baseQuantity: targetBasis.quantity, ...values };
  if (mode === 'powder_label') {
    delete patch.nutritionPer100g.sodium;
    const sodiumIndex = missingFields.indexOf('sodium');
    if (sodiumIndex !== -1) missingFields.splice(sodiumIndex, 1);
  }
  const validation = validateFinalPatch(mode, patch);
  if (!validation.valid) fail('VALIDATION_FAILED', '请补充：' + validation.missingFields.join('、'));
  return { patch, recognitionMeta: { fieldSources, evidence, missingFields,
    originalBasis: observation.basis, originalNutrients: observation.nutrients,
    formula: observation.formula, formulaEvidence: observation.formulaEvidence || {}, finalBasis: targetBasis,
    modelEstimate: estimated ? { ...estimate, adoptedFields: Object.keys(fieldSources).filter(field => fieldSources[field] === 'model_estimate') } : null,
    reference: reference ? { referenceId: reference.referenceId, ...reference.source,
      identity: reference.identity, basis: reference.basis, nutrients: reference.nutrients } : null } };
}

module.exports = { buildConfirmedPatch };
