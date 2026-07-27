/**
 * 饮食调整换算：滑条大类 + 自动均分 + 能量粉补热 + 软目标对照（纯函数）
 */

const {
  buildMacroRatioSummary
} = require('./dietAdjustMacroRanges');

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

function withEqualShares(items = []) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];
  const hasAllShares = list.every((item) => toPositive(item.sharePercent) > 0)
    && sharesAreValid(list.map((item) => item.sharePercent));
  if (hasAllShares) return list.map((item) => ({ ...item }));

  let assigned = 0;
  return list.map((item, index) => {
    const sharePercent = index === list.length - 1
      ? roundValue(100 - assigned, 2)
      : roundValue(100 / list.length, 2);
    assigned = roundValue(assigned + sharePercent, 2);
    return { ...item, sharePercent };
  });
}

function allocateGroup(items = [], groupTarget = 0, mode = 'protein') {
  const equalized = withEqualShares(items);
  const rows = [];
  for (const item of equalized) {
    const share = toPositive(item.sharePercent) / 100;
    const allocatedTarget = roundValue(groupTarget * share, 4);
    const density = densityField(item, mode);
    if (!(density > 0)) {
      return { ok: false, message: `「${item.name || item.key}」缺少有效营养浓度` };
    }
    const quantity = allocatedTarget > 0 ? allocatedTarget / density : 0;
    if (!(quantity > 0) && allocatedTarget > 0) {
      return { ok: false, message: `「${item.name || item.key}」推荐量无效，请调整目标或比例` };
    }
    const waterVolume = item.kind === 'formula_powder'
      ? calculateWaterFromPowder(quantity, item.mixRatio)
      : (item.kind === 'breast_milk' ? roundValue(quantity, 0) : 0);

    rows.push({
      ...item,
      role: item.role || (item.kind === 'food' ? 'food' : 'milk'),
      allocatedTarget,
      quantity: item.kind === 'breast_milk'
        ? roundValue(quantity, 0)
        : roundValue(quantity, 1),
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

function resolveMilkSplit(input, normalMilks, specialMilks) {
  if (normalMilks.length && !specialMilks.length) return { normalOfMilk: 1, specialOfMilk: 0 };
  if (!normalMilks.length && specialMilks.length) return { normalOfMilk: 0, specialOfMilk: 1 };

  const naturalCoef = toPositive(input.naturalProteinCoefficient);
  const specialCoef = toPositive(input.specialProteinCoefficient);
  const coefTotal = naturalCoef + specialCoef;
  if (coefTotal > 0) {
    return {
      normalOfMilk: naturalCoef / coefTotal,
      specialOfMilk: specialCoef / coefTotal
    };
  }

  let normalOfMilk = toNumber(input.normalMilkOfMilkRatio, 0.5);
  let specialOfMilk = toNumber(input.specialMilkOfMilkRatio, 0.5);
  if (Math.abs(normalOfMilk + specialOfMilk - 1) > 0.002) {
    return { error: '普奶/特奶占奶侧比例合计须为 100%' };
  }
  return { normalOfMilk, specialOfMilk };
}

function allocateEnergyPowders(energyPowders = [], calorieGap = 0) {
  const list = withEqualShares(energyPowders);
  if (!list.length || !(calorieGap > 0)) return { ok: true, rows: [], filledCalories: 0 };

  const rows = [];
  let filled = 0;
  for (const item of list) {
    const share = toPositive(item.sharePercent) / 100;
    const allocatedCalories = roundValue(calorieGap * share, 4);
    const density = toPositive(item.caloriesPerUnit);
    if (!(density > 0)) {
      return { ok: false, message: `「${item.name || item.key}」缺少有效热量浓度` };
    }
    const quantity = allocatedCalories / density;
    const waterVolume = calculateWaterFromPowder(quantity, item.mixRatio);
    rows.push({
      ...item,
      role: 'energy',
      allocatedTarget: allocatedCalories,
      quantity: roundValue(quantity, 1),
      waterVolume,
      displayUnit: item.unit || 'g',
      energyNote: '用来补热量'
    });
    filled += allocatedCalories;
  }
  return { ok: true, rows, filledCalories: roundValue(filled, 0) };
}

function softRebalancePremiumFoods(items = [], premiumTarget = 0) {
  if (!(premiumTarget > 0)) return { items, adjusted: false };
  const achieved = summarizeQuantities(items);
  if (achieved.premiumProtein >= premiumTarget * 0.95) {
    return { items, adjusted: false };
  }

  const foodIndexes = [];
  items.forEach((item, index) => {
    if (item.kind === 'food') foodIndexes.push(index);
  });
  if (foodIndexes.length < 2) return { items, adjusted: false };

  const premiumIndexes = foodIndexes.filter((index) => toPositive(items[index].premiumProteinPerUnit) > 0);
  const otherIndexes = foodIndexes.filter((index) => !(toPositive(items[index].premiumProteinPerUnit) > 0));
  if (!premiumIndexes.length || !otherIndexes.length) return { items, adjusted: false };

  const next = items.map((item) => ({ ...item }));
  let movedProtein = 0;
  const need = premiumTarget - achieved.premiumProtein;
  for (const index of otherIndexes) {
    if (movedProtein >= need) break;
    const item = next[index];
    const proteinDensity = toPositive(item.proteinPerUnit);
    if (!(proteinDensity > 0) || !(toPositive(item.quantity) > 0)) continue;
    const movableQty = item.quantity * 0.3;
    const movableProtein = movableQty * proteinDensity;
    const takeProtein = Math.min(movableProtein, need - movedProtein);
    const takeQty = takeProtein / proteinDensity;
    item.quantity = roundValue(item.quantity - takeQty, 1);
    movedProtein += takeProtein;
  }

  if (!(movedProtein > 0)) return { items, adjusted: false };

  const perPremium = movedProtein / premiumIndexes.length;
  for (const index of premiumIndexes) {
    const item = next[index];
    const proteinDensity = toPositive(item.proteinPerUnit) || toPositive(item.premiumProteinPerUnit);
    if (!(proteinDensity > 0)) continue;
    item.quantity = roundValue(item.quantity + perPremium / proteinDensity, 1);
  }

  return { items: next, adjusted: true };
}

function buildGaps(achieved, targets = {}) {
  const gaps = {};
  ['protein', 'calories', 'fat', 'carbs', 'premiumProtein'].forEach((key) => {
    const target = toPositive(targets[key]);
    if (!(target > 0)) return;
    gaps[key] = roundValue(target - toNumber(achieved[key], 0), key === 'calories' ? 0 : 2);
  });
  return gaps;
}

function midpointOfRange(range = {}) {
  const min = toNumber(range.min, NaN);
  const max = toNumber(range.max, NaN);
  if (Number.isFinite(min) && Number.isFinite(max)) return (min + max) / 2;
  if (Number.isFinite(min)) return min;
  if (Number.isFinite(max)) return max;
  return 0;
}

function buildHints(gaps = {}, options = {}) {
  const hints = [];
  if (toNumber(gaps.calories) > 5 && !options.hasEnergyPowder) {
    hints.push(`热量还差约 ${gaps.calories} kcal，可添加能量粉补热`);
  } else if (toNumber(gaps.calories) > 5) {
    hints.push(`热量仍差约 ${gaps.calories} kcal，可略增能量粉`);
  }
  if (toNumber(gaps.protein) > 0.2) {
    hints.push(`蛋白还差约 ${gaps.protein} g，请检查浓度或微调数量`);
  }
  (options.ratioRows || []).forEach((row) => {
    if (row.status === 'low') {
      hints.push(`${row.label}偏低（现在 ${row.value}%），建议范围 ${row.rangeText}`);
    } else if (row.status === 'high') {
      hints.push(`${row.label}偏高（现在 ${row.value}%），建议范围 ${row.rangeText}`);
    }
  });
  if (options.premiumAdjusted) {
    hints.push('已尽量提高优质蛋白食物占比');
  }
  return hints;
}

/**
 * @param {object} input
 * @param {'protein'|'calorie'} input.mode
 * @param {number} input.target
 * @param {number} input.milkRatio 0-1
 * @param {number} input.foodRatio 0-1
 * @param {number} [input.calorieTarget] 保蛋白时用于能量粉补热与对照
 * @param {number} [input.naturalProteinCoefficient]
 * @param {number} [input.specialProteinCoefficient]
 * @param {object} [input.softTargets] 兼容旧字段 { fat, carbs, premiumProtein, calories }
 * @param {object} [input.ratioRanges] { proteinEnergy, fatEnergy, carbsEnergy, premiumProteinRatio }
 * @param {Array} input.normalMilks
 * @param {Array} input.specialMilks
 * @param {Array} [input.energyPowders]
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
    return { ok: false, message: '奶与辅食比例合计须为 100%' };
  }

  const normalMilks = Array.isArray(input.normalMilks) ? input.normalMilks : [];
  const specialMilks = Array.isArray(input.specialMilks) ? input.specialMilks : [];
  const energyPowders = Array.isArray(input.energyPowders) ? input.energyPowders : [];
  const foods = Array.isArray(input.foods) ? input.foods : [];

  if (milkRatio > 0 && normalMilks.length + specialMilks.length === 0) {
    return {
      ok: false,
      message: energyPowders.length
        ? '蛋白/主目标需要先选普奶或特奶；能量粉只用来补热量'
        : '奶的比例大于 0 时请至少选择一种普奶或特奶'
    };
  }
  if (foodRatio > 0 && foods.length === 0) {
    return { ok: false, message: '辅食比例大于 0 时请至少选择一种食物' };
  }
  if (!normalMilks.length && !specialMilks.length && !foods.length) {
    return { ok: false, message: '请先勾选要吃的奶或食物' };
  }

  const split = resolveMilkSplit(input, normalMilks, specialMilks);
  if (split.error) return { ok: false, message: split.error };

  const tMilk = target * milkRatio;
  const tFood = target * foodRatio;
  const tNormal = tMilk * split.normalOfMilk;
  const tSpecial = tMilk * split.specialOfMilk;

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

  const softTargets = input.softTargets && typeof input.softTargets === 'object'
    ? input.softTargets
    : {};
  const ratioRanges = input.ratioRanges && typeof input.ratioRanges === 'object'
    ? input.ratioRanges
    : {};
  const calorieTarget = mode === 'calorie'
    ? target
    : toPositive(input.calorieTarget) || toPositive(softTargets.calories);

  let workingItems = parts;
  let premiumAdjusted = false;
  const premiumRatioMid = midpointOfRange(ratioRanges.premiumProteinRatio);
  const draftAchieved = summarizeQuantities(workingItems);
  let premiumGramTarget = toPositive(softTargets.premiumProtein);
  if (!(premiumGramTarget > 0) && premiumRatioMid > 0 && draftAchieved.protein > 0) {
    premiumGramTarget = draftAchieved.protein * (premiumRatioMid / 100);
  }
  if (premiumGramTarget > 0) {
    const rebalanced = softRebalancePremiumFoods(workingItems, premiumGramTarget);
    workingItems = rebalanced.items;
    premiumAdjusted = rebalanced.adjusted;
  }

  const baseAchieved = summarizeQuantities(workingItems);
  const calorieGap = calorieTarget > 0
    ? Math.max(0, calorieTarget - baseAchieved.calories)
    : 0;

  if (energyPowders.length && calorieGap > 0) {
    const energy = allocateEnergyPowders(energyPowders, calorieGap);
    if (!energy.ok) return energy;
    workingItems = workingItems.concat(energy.rows);
  }

  const nonPositive = workingItems.find((row) => (
    !(toPositive(row.quantity) > 0) && toPositive(row.allocatedTarget) > 0
  ));
  if (nonPositive) {
    return { ok: false, message: '推荐量无效，请调整目标或比例' };
  }

  const achieved = summarizeQuantities(workingItems);
  const macroRatioSummary = buildMacroRatioSummary(achieved, ratioRanges);
  const comparisonTargets = {
    protein: mode === 'protein' ? target : toPositive(softTargets.protein),
    calories: calorieTarget
  };
  const gaps = buildGaps(achieved, comparisonTargets);
  const hints = buildHints(gaps, {
    hasEnergyPowder: energyPowders.length > 0,
    premiumAdjusted,
    ratioRows: macroRatioSummary.rows
  });

  return {
    ok: true,
    mode,
    target,
    items: workingItems,
    achieved,
    gaps,
    hints,
    comparisonTargets,
    macroRatioSummary,
    premiumAdjusted,
    breakdown: {
      milkTarget: roundValue(tMilk, 2),
      foodTarget: roundValue(tFood, 2),
      normalMilkTarget: roundValue(tNormal, 2),
      specialMilkTarget: roundValue(tSpecial, 2),
      calorieTarget: roundValue(calorieTarget, 0),
      calorieGapBeforeEnergy: roundValue(calorieGap, 0)
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
  withEqualShares,
  calculateWaterFromPowder,
  summarizeQuantities,
  buildGaps,
  buildHints,
  solveDietAdjust
};
