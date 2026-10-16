'use strict';

const { FIELDS, UNITS, identity, number, text, fail } = require('./contracts');
const { convertBasis, normalizeNutrient } = require('./normalize');
const { searchText } = require('./reference');
const ESTIMATE_BASIS = { quantity: 100, unit: 'g', material: 'food' };
const GENERIC_NAMES = ['青菜', '绿叶菜', '蔬菜', '水果', '肉', '食物', 'vegetable', 'greens', 'food'];
const EXCLUDED_FOODS = /奶粉|配方粉|配方奶|母乳|特医|特殊医学|医学用途|氨基酸配方|医用营养|婴幼儿配方|formula|breast.?milk|medical.?food/i;
const LIMITS = { calories: 1000, protein: 100, fat: 100, carbs: 100, fiber: 100, sodium: 100000 };

function estimateIdentityKey(value) {
  const food = identity(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  return JSON.stringify([searchText(food.name), food.preparation, food.brand, food.series, food.stage, food.barcode]);
}

function estimateEligibility({ mode, identity: wanted, observation, reference, basis }) {
  const food = identity(wanted);
  const refuse = reason => ({ eligible: false, fields: [], reason });
  if (!['food_object', 'food_label'].includes(mode)) return refuse('奶粉和母乳需采用标签、厂家资料或手填值。');
  const candidates = [food].concat((observation && observation.identityCandidates || []).map(identity));
  if (candidates.some(item => EXCLUDED_FOODS.test(item.name + item.series) || item.brand || item.series || item.stage || item.barcode)) {
    return refuse('配方、特医和明确品牌的产品需核对具体产品资料，不提供通用AI估算。');
  }
  if (!food.name || GENERIC_NAMES.includes(searchText(food.name))) return refuse('请先确认具体食材名称，再生成AI估算。');
  if (!['raw', 'boiled', 'stir_fried'].includes(food.preparation)) return refuse('请先确认生鲜、水煮或炒制状态。');
  if (!basis || !(number(basis.quantity) > 0) || basis.unit !== 'g' || basis.material !== 'food') {
    return refuse('AI估算按每100g可食部分提供，请先使用克数营养基准。');
  }
  if (!observation) return refuse('请先完成图片识别和参考查询。');
  const label = convertBasis(observation.nutrients, observation.basis, basis, observation.formula);
  const standard = reference && convertBasis(reference.nutrients, reference.basis, basis);
  const hasValue = entry => entry && entry.state === 'present' && number(entry.value) !== null;
  const fields = FIELDS.filter(field => !hasValue(label && label[field]) && !hasValue(standard && standard[field]));
  return fields.length ? { eligible: true, fields, reason: '仅为缺少标签或可信参考的指标提供估算，请逐项核对后选用。' } :
    refuse('当前指标已有可采用的标签或参考值，无需生成AI估算。');
}

function normalizeModelEstimate(raw, wanted, requestedFields) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.identity ||
      typeof raw.identity !== 'object' || Array.isArray(raw.identity) ||
      estimateIdentityKey(raw.identity) !== estimateIdentityKey(wanted)) {
    fail('INVALID_MODEL_RESULT', 'AI估算的食材身份或制备状态不一致，请重新核对');
  }
  const basis = raw.basis || {};
  if (basis.quantity !== 100 || basis.unit !== 'g' || basis.material !== 'food') {
    fail('INVALID_MODEL_RESULT', 'AI估算必须使用每100g可食部分的基准');
  }
  if (!Array.isArray(requestedFields) || !requestedFields.length || requestedFields.some(field => !FIELDS.includes(field))) {
    fail('INVALID_INPUT', 'AI估算字段无效');
  }
  const nutrients = {}; const warnings = [];
  FIELDS.forEach(field => {
    const entry = requestedFields.includes(field) ? (raw.nutrients || {})[field] : undefined;
    if (entry != null && (typeof entry !== 'object' || Array.isArray(entry))) {
      fail('INVALID_MODEL_RESULT', 'AI估算指标结构无效');
    }
    if (entry && entry.value != null && (typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value < 0)) {
      fail('INVALID_MODEL_RESULT', 'AI估算指标必须为有效非负数字或缺失');
    }
    const normalized = normalizeNutrient(field, entry ? { value: entry.value, unit: entry.unit,
      state: entry.state, definition: ['calories', 'carbs', 'fiber'].includes(field) ? 'unknown' : field } : null, warnings);
    if (normalized.value !== null && normalized.value > LIMITS[field]) {
      fail('INVALID_MODEL_RESULT', 'AI估算超出每100g食物的合理数值范围');
    }
    // 估算不产生标签证据，也不宣称已经核验的营养定义。
    nutrients[field] = { ...normalized, evidence: null };
  });
  if (['protein', 'fat', 'carbs'].every(field => nutrients[field].value !== null) &&
      ['protein', 'fat', 'carbs'].reduce((sum, field) => sum + nutrients[field].value, 0) > 110) {
    fail('INVALID_MODEL_RESULT', 'AI估算的主要营养含量与100g基准不一致');
  }
  if (!requestedFields.some(field => nutrients[field].state === 'present')) {
    fail('INVALID_MODEL_RESULT', '模型未提供可采用的AI估算指标，请手工补充');
  }
  const assumptions = (Array.isArray(raw.assumptions) ? raw.assumptions : []).map(value => text(value, 160))
    .filter(value => value && !/https?:\/\/|www\.|官方|权威|实测|实验室|检测报告/i.test(value)).slice(0, 5);
  return { source: 'model_estimate', identity: identity(wanted), basis: { ...ESTIMATE_BASIS },
    nutrients, fields: [...new Set(requestedFields)], assumptions, warnings,
    disclaimer: 'AI估算，非实测或已核验标准；请核对后选用。' };
}

function validateEstimateBinding(estimate, context) {
  const eligible = estimateEligibility(context);
  if (!estimate || estimate.source !== 'model_estimate' ||
      estimate.comparisonVersion !== context.comparisonVersion ||
      estimateIdentityKey(estimate.identity) !== estimateIdentityKey(context.identity) ||
      !estimate.basis || estimate.basis.quantity !== 100 || estimate.basis.unit !== 'g' || estimate.basis.material !== 'food') {
    fail('COMPARISON_STALE', 'AI估算已失效，请重新核对身份、基准和参考');
  }
  if (!eligible.eligible) fail('VALIDATION_FAILED', eligible.reason);
  return { fields: eligible.fields.filter(field => (estimate.fields || []).includes(field)),
    nutrients: convertBasis(estimate.nutrients, estimate.basis, context.basis) };
}

module.exports = { ESTIMATE_BASIS, estimateIdentityKey, estimateEligibility, normalizeModelEstimate, validateEstimateBinding };
