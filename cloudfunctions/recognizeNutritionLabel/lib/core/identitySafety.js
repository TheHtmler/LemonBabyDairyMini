'use strict';

const { fail, identity, text } = require('./contracts');

const GENERIC_NAMES = new Set(['食物', '食品', '食材', '肉', '肉类', '冻肉', '冷冻肉', '肉片', '生肉',
  '红肉', '白肉', '五花肉', '排骨', '蔬菜', '青菜', '绿叶菜', '水果', '根茎', '根茎类', '豆类',
  'food', 'meat', 'frozenmeat', 'vegetable', 'greens', 'fruit']);
const MEAT = /猪|(?:牛|羊|鸡|鸭|鹅|兔)(?:肉|胸|脯|腿|翅|排|腩|腱|肝|肾|舌|肚|心|胗|蹄|肠|颈)|肉类|生肉|冻肉|(?:^|[^果])肉[片块]|五花|排骨|里脊|肥瘦|pork|beef|lamb|mutton|chicken|duck|turkey|\bmeat\b/i;
const CATEGORIES = ['肉类', '鱼虾类', '果蔬类', '水果', '蔬菜', '根茎类', '谷物类', '豆类', '蛋类', '食品'];
const FEATURES = ['冷冻', '肥瘦相间', '切片', '切块', '带骨', '切半', '去皮', '带核'];
const canonical = value => text(value).normalize('NFKC').toLowerCase().replace(/\s/g, '');

function assertFoodRecognition({ mode, observation, identity: wanted } = {}) {
  const candidates = (observation && observation.identityCandidates || []).concat(wanted || []);
  // 粉状只是物理形态，咖啡粉、米粉等普通食品不能据此判为奶粉。
  if (mode === 'powder_label' || (observation && observation.basis || {}).material === 'prepared_formula' ||
      candidates.some(item => item.preparation === 'prepared_formula' ||
        /(?:奶粉|乳粉|配方粉)(?:[（(].*[）)])?$|\binfant\s+formula\b|\bmilk\s+powder$/i.test(text(item.name)))) {
    fail('VALIDATION_FAILED', '暂不支持奶粉识别，请在奶粉管理中按包装手动填写。');
  }
}

function identityConfirmationKey(value) {
  const food = identity(value || {});
  return JSON.stringify([canonical(food.name), food.preparation, canonical(food.brand), canonical(food.series),
    canonical(food.stage), canonical(food.barcode)]);
}

function isGenericIdentity(value) {
  const name = canonical(value && typeof value === 'object' ? value.name : value);
  return !name || GENERIC_NAMES.has(name) || /^(?:冷冻|冷藏|新鲜|生)?(?:肉类?|肉片|肉块|食物|食品|食材)$/.test(name);
}

function makeIdentityConfirmation(value, source = 'user_confirmed', referenceId = '') {
  if (!['user_confirmed', 'user_selected_reference'].includes(source) || isGenericIdentity(value)) return null;
  if (source === 'user_selected_reference' && !text(referenceId)) return null;
  return { source, identityKey: identityConfirmationKey(value),
    ...(source === 'user_selected_reference' ? { referenceId: text(referenceId, 128) } : {}) };
}

function hasIdentityConfirmation(value, confirmation) {
  return !!confirmation && ['user_confirmed', 'user_selected_reference'].includes(confirmation.source) &&
    confirmation.identityKey === identityConfirmationKey(value) && !isGenericIdentity(value) &&
    (confirmation.source !== 'user_selected_reference' || !!text(confirmation.referenceId));
}

// 粗类别和可见特征用于展示，不能当成精确身份或营养依据。
function assessVisualIdentity(raw, observation, mode, imageCount) {
  const source = raw && raw.typeEvidence;
  const evidence = source && Number.isInteger(source.imageIndex) && source.imageIndex >= 0 &&
    source.imageIndex < imageCount && text(source.text, 600) ? { imageIndex: source.imageIndex, text: text(source.text, 600) } : null;
  const candidates = observation.identityCandidates || [];
  const names = candidates.map(item => item.name).join(' ');
  const description = evidence ? evidence.text : '';
  const summary = raw && raw.foodSummary || {};
  const conflictingProducts = ['brand', 'series', 'stage', 'barcode'].some(key =>
    new Set(candidates.map(item => canonical(item[key])).filter(Boolean)).size > 1);
  const category = CATEGORIES.includes(summary.category) ? summary.category : '';
  const labelMode = ['food_label', 'powder_label'].includes(mode);
  const meat = !labelMode && (category === '肉类' || (raw.classification || {}).proteinGroup === 'meat' ||
    MEAT.test(names + ' ' + description));
  const visibleFeatures = FEATURES.filter(feature => description.includes(feature) ||
    (Array.isArray(summary.features) && summary.features.includes(feature))).slice(0, 4);
  if (description.includes('冰霜') && !visibleFeatures.includes('冷冻')) visibleFeatures.push('表面有冰霜');
  if (meat && description.includes('脂肪') && !visibleFeatures.includes('肥瘦相间')) visibleFeatures.push('可见脂肪');
  const coarseCategory = meat ? '肉类' : category;
  let reason = '';
  if (mode === 'unsupported') reason = 'unsupported';
  else if (raw.multipleProducts === true || conflictingProducts) reason = 'multiple_products';
  else if (!labelMode && raw.uncertaintyReason === 'image_unclear') reason = 'image_unclear';
  else if (mode === 'uncertain' && (!evidence || !coarseCategory)) reason = 'image_unclear';
  else if (!labelMode && (meat || mode === 'uncertain' || candidates.length !== 1 ||
      isGenericIdentity(candidates[0]) || raw.uncertaintyReason === 'identity_insufficient')) reason = 'identity_insufficient';
  const canConfirm = reason === 'identity_insufficient' && (mode === 'food_object' || !!evidence);
  return { reason, coarseCategory, visibleFeatures, evidence,
    requiresConfirmation: reason === 'identity_insufficient', canConfirm };
}

function identityRequirement({ mode, identity: wanted, observation, identityConfirmation } = {}) {
  const assessment = observation && observation.identityAssessment || {};
  const candidates = observation && observation.identityCandidates || [];
  const food = identity(wanted || candidates[0] || {});
  const visual = mode === 'food_object' || mode === 'uncertain';
  const meat = visual && (assessment.coarseCategory === '肉类' ||
    candidates.concat([food]).some(item => MEAT.test(item.name || '')));
  const reason = assessment.reason || (mode === 'unsupported' ? 'unsupported' :
    mode === 'uncertain' ? 'image_unclear' : '');
  const unavailable = ['unsupported', 'image_unclear', 'multiple_products'].includes(reason);
  // 缺少附加评估字段不等于身份不明，仍按具体候选和实际风险判断。
  const insufficient = visual && (meat || reason === 'identity_insufficient' ||
    assessment.requiresConfirmation || candidates.length !== 1 || isGenericIdentity(food));
  const confirmed = hasIdentityConfirmation(food, identityConfirmation);
  const preparationKnown = ['raw', 'boiled', 'stir_fried', 'other'].includes(food.preparation);
  const required = unavailable || insufficient && (!confirmed || !preparationKnown || isGenericIdentity(food));
  return { required, reason: required ? unavailable ? reason : 'identity_insufficient' : '',
    coarseCategory: meat ? '肉类' : text(assessment.coarseCategory, 40),
    visibleFeatures: Array.isArray(assessment.visibleFeatures) ? assessment.visibleFeatures : [],
    canConfirm: !unavailable && (mode === 'food_object' || assessment.canConfirm === true) };
}

module.exports = { assertFoodRecognition, assessVisualIdentity, identityRequirement, identityConfirmationKey, isGenericIdentity,
  makeIdentityConfirmation, hasIdentityConfirmation };
