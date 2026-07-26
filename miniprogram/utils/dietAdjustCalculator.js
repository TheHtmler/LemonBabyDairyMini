/**
 * 饮食调整换算：按目标 + 占比 + 组内份额求解各品项用量（纯函数）
 */

const SHARE_TOLERANCE = 0.15;

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toPositive(value) {
  const num = toNumber(value, 0);
  return num > 0 ? num : 0;
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const m = 10 ** precision;
  return Math.round((num + Number.EPSILON) * m) / m;
}

function sumSharePercents(percents = []) {
  return roundValue((percents || []).reduce((sum, p) => sum + toNumber(p, 0), 0), 4);
}

function sharesAreValid(percents = [], expected = 100) {
  if (!Array.isArray(percents) || percents.length === 0) return expected === 0;
  return Math.abs(sumSharePercents(percents) - expected) <= SHARE_TOLERANCE;
}

function calculateWaterFromPowder(powderWeight, mixRatio = {}) {
  const powder = toPositive(mixRatio.powder);
  const water = toPositive(mixRatio.water);
  const weight = toPositive(powderWeight);
  if (!powder || !water || !weight) return 0;
  return roundValue((weight * water) / powder, 0);
}

function densityField(item = {}, mode = 'protein') {
  return mode === 'calorie'
    ? toPositive(item.caloriesPerUnit)
    : toPositive(item.proteinPerUnit);
}

function validateGroupShares(items = [], label = '组') {
  if (!items.length) return null;
  if (!sharesAreValid(items.map((i) => i.sharePercent))) {
    return `${label}份额合计须为 100%`;
  }
  return null;
}

function allocateGroup(items = [], groupTarget = 0, mode = 'protein') {
  const rows = [];
  for (const item of items) {
    const share = toPositive(item.sharePercent) / 100;
    const allocatedTarget = roundValue(groupTarget * share, 4);
    const density = densityField(item, mode);
    if (!(density > 0)) {
      return { ok: false, message: `「${item.name || item.key}」缺少有效营养浓度` };
    }
    const quantity = allocatedTarget > 0 ? allocatedTarget / density : 0;
    if (!(quantity > 0) && allocatedTarget > 0) {
      return { ok: false, message: `「${item.name || item.key}」推荐量无效，请调整目标或份额` };
    }
    const waterVolume = item.kind === 'formula_powder'
      ? calculateWaterFromPowder(quantity, item.mixRatio)
      : (item.kind === 'breast_milk' ? roundValue(quantity, 0) : 0);

    rows.push({
      ...item,
      allocatedTarget,
      quantity: item.kind === 'breast_milk' ? roundValue(quantity, 0) : roundValue(quantity, item.kind === 'food' ? 1 : 1),
      waterVolume,
      displayUnit: item.kind === 'breast_milk' ? 'ml' : (item.unit || 'g')
    });
  }
  return { ok: true, rows };
}

function summarizeQuantities(items = []) {
  const summary = {
    protein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    premiumProtein: 0
  };
  (items || []).forEach((item = {}) => {
    const q = toPositive(item.quantity);
    summary.protein += q * toPositive(item.proteinPerUnit);
    summary.calories += q * toPositive(item.caloriesPerUnit);
    summary.fat += q * toPositive(item.fatPerUnit);
    summary.carbs += q * toPositive(item.carbsPerUnit);
    summary.premiumProtein += q * toPositive(item.premiumProteinPerUnit);
  });
  return {
    protein: roundValue(summary.protein, 2),
    calories: roundValue(summary.calories, 0),
    fat: roundValue(summary.fat, 2),
    carbs: roundValue(summary.carbs, 2),
    premiumProtein: roundValue(summary.premiumProtein, 2)
  };
}

/**
 * @param {object} input
 * @param {'protein'|'calorie'} input.mode
 * @param {number} input.target
 * @param {number} input.milkRatio 0-1
 * @param {number} input.foodRatio 0-1
 * @param {number} [input.normalMilkOfMilkRatio]
 * @param {number} [input.specialMilkOfMilkRatio]
 * @param {Array} input.normalMilks
 * @param {Array} input.specialMilks
 * @param {Array} input.foods
 */
function solveDietAdjust(input = {}) {
  const mode = input.mode === 'calorie' ? 'calorie' : 'protein';
  const target = toPositive(input.target);
  if (!(target > 0)) {
    return { ok: false, message: '请填写有效的目标值' };
  }

  const milkRatio = toNumber(input.milkRatio, 0);
  const foodRatio = toNumber(input.foodRatio, 0);
  if (Math.abs(milkRatio + foodRatio - 1) > 0.002) {
    return { ok: false, message: '奶侧与辅食侧占比合计须为 100%' };
  }

  const normalMilks = Array.isArray(input.normalMilks) ? input.normalMilks : [];
  const specialMilks = Array.isArray(input.specialMilks) ? input.specialMilks : [];
  const foods = Array.isArray(input.foods) ? input.foods : [];

  if (milkRatio > 0 && normalMilks.length + specialMilks.length === 0) {
    return { ok: false, message: '奶侧占比大于 0 时请至少选择一种奶' };
  }
  if (foodRatio > 0 && foods.length === 0) {
    return { ok: false, message: '辅食侧占比大于 0 时请至少选择一种食物' };
  }
  if (!normalMilks.length && !specialMilks.length && !foods.length) {
    return { ok: false, message: '请先选择组成品项' };
  }

  const milkErr = validateGroupShares(normalMilks, '普奶')
    || validateGroupShares(specialMilks, '特奶')
    || validateGroupShares(foods, '食物');
  if (milkErr) return { ok: false, message: milkErr };

  let normalOfMilk = toNumber(input.normalMilkOfMilkRatio, normalMilks.length && specialMilks.length ? 0.5 : (normalMilks.length ? 1 : 0));
  let specialOfMilk = toNumber(input.specialMilkOfMilkRatio, normalMilks.length && specialMilks.length ? 0.5 : (specialMilks.length ? 1 : 0));
  if (normalMilks.length && !specialMilks.length) {
    normalOfMilk = 1;
    specialOfMilk = 0;
  } else if (!normalMilks.length && specialMilks.length) {
    normalOfMilk = 0;
    specialOfMilk = 1;
  } else if (normalMilks.length && specialMilks.length) {
    if (Math.abs(normalOfMilk + specialOfMilk - 1) > 0.002) {
      return { ok: false, message: '普奶/特奶占奶侧比例合计须为 100%' };
    }
  }

  const tMilk = target * milkRatio;
  const tFood = target * foodRatio;
  const tNormal = tMilk * normalOfMilk;
  const tSpecial = tMilk * specialOfMilk;

  const parts = [];
  if (normalMilks.length) {
    const allocated = allocateGroup(normalMilks, tNormal, mode);
    if (!allocated.ok) return allocated;
    parts.push(...allocated.rows);
  }
  if (specialMilks.length) {
    const allocated = allocateGroup(specialMilks, tSpecial, mode);
    if (!allocated.ok) return allocated;
    parts.push(...allocated.rows);
  }
  if (foods.length) {
    const allocated = allocateGroup(foods, tFood, mode);
    if (!allocated.ok) return allocated;
    parts.push(...allocated.rows);
  }

  const nonPositive = parts.find((row) => !(toPositive(row.quantity) > 0) && toPositive(row.allocatedTarget) > 0);
  if (nonPositive) {
    return { ok: false, message: '推荐量无效，请调整目标或份额' };
  }

  const achieved = summarizeQuantities(parts);
  return {
    ok: true,
    mode,
    target,
    items: parts,
    achieved,
    breakdown: {
      milkTarget: roundValue(tMilk, 2),
      foodTarget: roundValue(tFood, 2),
      normalMilkTarget: roundValue(tNormal, 2),
      specialMilkTarget: roundValue(tSpecial, 2)
    }
  };
}

module.exports = {
  SHARE_TOLERANCE,
  toNumber,
  toPositive,
  roundValue,
  sumSharePercents,
  sharesAreValid,
  calculateWaterFromPowder,
  summarizeQuantities,
  solveDietAdjust
};
