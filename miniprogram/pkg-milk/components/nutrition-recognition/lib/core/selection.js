'use strict';

const { FIELDS, text, number, fail, validateFinalPatch } = require('./contracts');
const { convertBasis } = require('./normalize');
const { validateEstimateBinding } = require('./estimate');
const { identityRequirement } = require('./identitySafety');

function buildConfirmedPatch({ observation, reference, estimate, confirmedIdentity, identityConfirmation, comparisonVersion,
  decisions = [], targetBasis, mode, name, mixRatio, proteinSource, useFormValues = false }) {
  if (identityRequirement({ mode, identity: confirmedIdentity, observation, identityConfirmation }).required) {
    fail('IDENTITY_INSUFFICIENT', '具体种类与制备状态尚未确认，营养待补充');
  }
  const label = convertBasis(observation.nutrients, observation.basis, targetBasis, observation.formula);
  const standard = reference && convertBasis(reference.nutrients, reference.basis, targetBasis);
  const values = {}; const fieldSources = {}; const evidence = {}; const missingFields = [];
  if (!Array.isArray(decisions) || decisions.some(x => !x || typeof x !== 'object' || Array.isArray(x) || typeof x.path !== 'string')) {
    fail('VALIDATION_FAILED', '选值字段格式无效');
  }
  if (decisions.length > FIELDS.length || new Set(decisions.map(x => x.path)).size !== decisions.length) {
    fail('VALIDATION_FAILED', '选值字段重复或过多');
  }
  if (useFormValues && !['g', 'ml', 'portion'].includes(targetBasis.unit)) {
    // 自定义单位没有自动换算关系，只采纳用户确认的最终值，原识别证据仍保留。
    decisions = decisions.map(decision => ({ ...decision, source: 'manual' }));
  }
  if (proteinSource === 'special' && decisions.some(decision => decision.source === 'model_estimate')) {
    fail('VALIDATION_FAILED', '特殊蛋白不能采用通用AI估算，请核对标签、产品资料或手工填写');
  }
  let estimated = null;
  if (decisions.some(decision => decision.source === 'model_estimate')) {
    try {
      estimated = validateEstimateBinding(estimate, { mode, identity: confirmedIdentity || observation.identityCandidates[0],
        observation, reference, basis: targetBasis, comparisonVersion, identityConfirmation });
    } catch (error) { if (!useFormValues) throw error; }
  }
  FIELDS.forEach(field => {
    const decision = decisions.find(x => x.path === field);
    let value = null;
    if (decision) {
      if (!['label', 'reference', 'manual', 'model_estimate'].includes(decision.source)) fail('VALIDATION_FAILED', '营养来源无效');
      if (mode === 'food_label' && !['label', 'manual'].includes(decision.source)) {
        fail('VALIDATION_FAILED', '包装食品以实拍营养标签为准，缺失指标请补拍或手填');
      }
      if (!useFormValues && (observation.nutrients[field] || {}).validationIssue && decision.source !== 'manual' &&
          !(decision.source === 'reference' && identityConfirmation && identityConfirmation.source === 'user_selected_reference' &&
            reference && identityConfirmation.referenceId === reference.referenceId)) {
        fail('VALIDATION_FAILED', field + '的标签数值与证据冲突，请对照包装手工核对');
      }
      if (decision.source === 'manual') value = number(decision.value);
      else if (decision.source === 'model_estimate') {
        if ((!estimated || !estimated.fields.includes(field)) && !useFormValues) fail('VALIDATION_FAILED', '已有标签或参考值的指标不能用AI估算替代');
        const entry = estimated && estimated.fields.includes(field) && estimated.nutrients && estimated.nutrients[field];
        if (entry && entry.state === 'present') value = number(entry.value);
      }
      else {
        const entry = (decision.source === 'label' ? label : standard) &&
          (decision.source === 'label' ? label : standard)[field];
        if (entry && entry.state === 'present') value = entry.value;
      }
      fieldSources[field] = decision.source;
      if (useFormValues) {
        const submitted = number(decision.value);
        if (submitted === null) fail('VALIDATION_FAILED', field + '不是有效的非负数字');
        // 保存采用当前表单；一位小数的显示舍入仍保留原来源。
        if (decision.source !== 'manual' && (value === null || Math.abs(submitted - value) > 0.05000001 ||
            (observation.nutrients[field] || {}).validationIssue)) fieldSources[field] = 'manual';
        value = submitted;
      }
      if (value === null) fail('VALIDATION_FAILED', field + '未提供可采用的营养值');
      if (fieldSources[field] === 'label' && observation.nutrients[field].evidence) {
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
    modelEstimate: estimated && Object.values(fieldSources).includes('model_estimate') ? { ...estimate, adoptedFields: Object.keys(fieldSources).filter(field => fieldSources[field] === 'model_estimate') } : null,
    reference: reference ? { referenceId: reference.referenceId, ...reference.source,
      identity: reference.identity, basis: reference.basis, nutrients: reference.nutrients } : null } };
}

module.exports = { buildConfirmedPatch };
