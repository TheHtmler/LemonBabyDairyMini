'use strict';

const MAX_COMPONENTS = 50;
const RELATIONS = ['eq', 'gte', 'lte'];
const SOURCE_TYPES = ['manual', 'user_food', 'system_food'];

function finiteNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 明细自带取值快照，引用ID只用于追溯，不在计算时重新读取食物库。 */
function normalizeProteinComposition(value) {
  if (!value || typeof value !== 'object') return null;
  const basis = value.basis || {};
  return {
    basis: { quantity: finiteNumber(basis.quantity), unit: String(basis.unit || '') },
    premiumComponents: (Array.isArray(value.premiumComponents) ? value.premiumComponents : []).map(row => {
      row = row || {};
      const amount = row.amount || {};
      const source = row.source || {};
      return {
        name: String(row.name || '').trim().slice(0, 80),
        amount: { value: finiteNumber(amount.value), unit: String(amount.unit || ''), relation: String(amount.relation || 'eq') },
        proteinPer100g: finiteNumber(row.proteinPer100g),
        source: { type: SOURCE_TYPES.includes(source.type) ? source.type : 'manual', foodId: String(source.foodId || '').slice(0, 160) || null }
      };
    })
  };
}

function compositionProteinPer100g(composition) {
  return (composition?.premiumComponents || []).reduce((sum, row) => {
    // 基准固定每100g成品，因此50%与50g具有相同的参考用量。
    return sum + Number(row.amount.value) * Number(row.proteinPer100g) / 100;
  }, 0);
}

/** 成分必填校验独立于营养表，保存时优先提示尚未填写的成分。 */
function validateProteinCompositionDetails(value) {
  const composition = normalizeProteinComposition(value);
  if (!composition || !composition.premiumComponents.length || composition.premiumComponents.every(row =>
    !row.name && row.amount.value == null && row.proteinPer100g == null)) throw new Error('请填写优质蛋白成分');
  if (composition.basis.quantity !== 100 || composition.basis.unit !== 'g') {
    throw new Error('请按每100g成品填写优质成分');
  }
  const rows = composition.premiumComponents;
  if (!rows.length || rows.length > MAX_COMPONENTS) throw new Error('请添加1至50行优质成分');
  let amountTotal = 0;
  rows.forEach((row, index) => {
    const prefix = '第' + (index + 1) + '行：';
    if (!row.name) throw new Error(prefix + '请填写优质成分名称');
    if (!['%', 'g'].includes(row.amount.unit) || !RELATIONS.includes(row.amount.relation)) throw new Error(prefix + '请确认用量单位和比较符');
    if (row.amount.value == null || row.amount.value <= 0 || row.amount.value > 100) throw new Error(prefix + '用量须大于0且不超过100');
    if (row.proteinPer100g == null || row.proteinPer100g < 0 || row.proteinPer100g > 100) throw new Error(prefix + '每100g蛋白质须为0至100g');
    amountTotal += row.amount.value;
  });
  if (amountTotal > 100 + 1e-8) throw new Error('优质成分的参考用量合计不能超过每100g成品');
  return composition;
}

/** 保存端统一校验：绝不以截断到总蛋白的方式掩盖冲突。 */
function validateProteinComposition(food = {}) {
  if (food.proteinQuality !== 'mixed') return null;
  if (food.proteinSource !== 'natural') throw new Error('混合优质成分仅适用于天然蛋白');
  const composition = validateProteinCompositionDetails(food.proteinComposition);
  const basis = food.nutritionBasis || {};
  const quantity = finiteNumber(basis.quantity);
  const total = finiteNumber((food.nutritionPerBasis || {}).protein);
  if (basis.unit !== 'g' || quantity == null || quantity <= 0) throw new Error('混合食品的营养基准请使用克（g），不能直接以毫升或份数换算');
  if (total == null || total < 0) throw new Error('请填写包装总蛋白质后再计算混合蛋白');
  if (compositionProteinPer100g(composition) > total * 100 / quantity + 1e-8) throw new Error('优质蛋白估算超过包装总蛋白，请核对成分用量及蛋白含量');
  return composition;
}

function mixedPremiumRatio(food = {}) {
  const composition = validateProteinComposition(food);
  const total = Number(food.nutritionPerBasis?.protein) * 100 / Number(food.nutritionBasis?.quantity);
  return total > 0 ? compositionProteinPer100g(composition) / total : 0;
}

module.exports = { MAX_COMPONENTS, normalizeProteinComposition, compositionProteinPer100g, validateProteinCompositionDetails, validateProteinComposition, mixedPremiumRatio };
