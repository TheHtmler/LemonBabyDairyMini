/**
 * 饮食调整换算：月龄默认宏量比例范围 + 供能比计算
 */

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toPositive(value) {
  const num = toNumber(value, 0);
  return num > 0 ? num : 0;
}

function roundValue(value, precision = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const m = 10 ** precision;
  return Math.round((num + Number.EPSILON) * m) / m;
}

function calculateAgeInMonths(birthday, referenceDate = new Date()) {
  if (!birthday) return null;
  const birthDate = new Date(birthday);
  const refDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(refDate.getTime())) return null;
  let months = (refDate.getFullYear() - birthDate.getFullYear()) * 12
    + (refDate.getMonth() - birthDate.getMonth());
  if (refDate.getDate() < birthDate.getDate()) months -= 1;
  return months < 0 ? 0 : months;
}

/** 与数据记录页 getFatRatioRangeText / 分析页 FAT_RATIO 对齐 */
function getFatEnergyRangeByAgeMonths(ageMonths) {
  if (ageMonths === null || ageMonths === undefined) {
    return { min: 35, max: 40, label: '参考' };
  }
  if (ageMonths <= 6) return { min: 45, max: 50, label: '0-6月龄' };
  if (ageMonths >= 72) return { min: 25, max: 30, label: '≥6岁' };
  if (ageMonths >= 12 && ageMonths < 24) return { min: 30, max: 35, label: '1-2岁' };
  return { min: 35, max: 40, label: '6月龄起参考' };
}

function getDefaultMacroRatioRanges(ageMonths) {
  return {
    proteinEnergy: { min: 10, max: 15, label: '参考' },
    carbsEnergy: { min: 55, max: 60, label: '参考' },
    fatEnergy: getFatEnergyRangeByAgeMonths(ageMonths),
    premiumProteinRatio: { min: 30, max: 50, label: '默认' }
  };
}

function getDefaultMacroRatioRangesByBirthday(birthday, referenceDate = new Date()) {
  const ageMonths = calculateAgeInMonths(birthday, referenceDate);
  return {
    ageMonths,
    ranges: getDefaultMacroRatioRanges(ageMonths)
  };
}

function calculateEnergyRatios({ protein = 0, carbs = 0, fat = 0, calories = 0 } = {}) {
  const proteinEnergy = toPositive(protein) * 4;
  const carbsEnergy = toPositive(carbs) * 4;
  const fatEnergy = toPositive(fat) * 9;
  const fromMacros = proteinEnergy + carbsEnergy + fatEnergy;
  const total = fromMacros > 0 ? fromMacros : toPositive(calories);
  if (!(total > 0)) {
    return { protein: 0, carbs: 0, fat: 0, totalEnergy: 0 };
  }
  return {
    protein: roundValue((proteinEnergy / total) * 100, 1),
    carbs: roundValue((carbsEnergy / total) * 100, 1),
    fat: roundValue((fatEnergy / total) * 100, 1),
    totalEnergy: roundValue(total, 0)
  };
}

function calculatePremiumProteinRatio(premiumProtein = 0, protein = 0) {
  const total = toPositive(protein);
  if (!(total > 0)) return 0;
  return roundValue((toPositive(premiumProtein) / total) * 100, 1);
}

/**
 * @returns {'in'|'low'|'high'|'skip'}
 */
function evaluateRatioRange(value, range = {}) {
  const min = toNumber(range.min, NaN);
  const max = toNumber(range.max, NaN);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (!hasMin && !hasMax) return 'skip';
  const num = toNumber(value, 0);
  if (hasMin && num < min) return 'low';
  if (hasMax && num > max) return 'high';
  return 'in';
}

function statusLabel(status) {
  if (status === 'in') return '在范围内';
  if (status === 'low') return '偏低';
  if (status === 'high') return '偏高';
  return '';
}

function buildMacroRatioSummary(achieved = {}, ranges = {}) {
  const energy = calculateEnergyRatios(achieved);
  const premiumRatio = calculatePremiumProteinRatio(achieved.premiumProtein, achieved.protein);
  const rows = [
    {
      key: 'proteinEnergy',
      label: '蛋白供能',
      value: energy.protein,
      unit: '%',
      range: ranges.proteinEnergy,
      status: evaluateRatioRange(energy.protein, ranges.proteinEnergy)
    },
    {
      key: 'fatEnergy',
      label: '脂肪供能',
      value: energy.fat,
      unit: '%',
      range: ranges.fatEnergy,
      status: evaluateRatioRange(energy.fat, ranges.fatEnergy)
    },
    {
      key: 'carbsEnergy',
      label: '碳水供能',
      value: energy.carbs,
      unit: '%',
      range: ranges.carbsEnergy,
      status: evaluateRatioRange(energy.carbs, ranges.carbsEnergy)
    },
    {
      key: 'premiumProteinRatio',
      label: '优质蛋白占比',
      value: premiumRatio,
      unit: '%',
      range: ranges.premiumProteinRatio,
      status: evaluateRatioRange(premiumRatio, ranges.premiumProteinRatio)
    }
  ].map((row) => ({
    ...row,
    statusText: statusLabel(row.status),
    rangeText: formatRangeText(row.range)
  }));

  return { energy, premiumRatio, rows };
}

function formatRangeText(range = {}) {
  const min = toNumber(range.min, NaN);
  const max = toNumber(range.max, NaN);
  if (Number.isFinite(min) && Number.isFinite(max)) return `${min}%-${max}%`;
  if (Number.isFinite(min)) return `≥${min}%`;
  if (Number.isFinite(max)) return `≤${max}%`;
  return '';
}

function parseRangeInputs(prefix, data = {}) {
  const minRaw = data[`${prefix}Min`];
  const maxRaw = data[`${prefix}Max`];
  const min = minRaw === '' || minRaw === undefined || minRaw === null ? NaN : Number(minRaw);
  const max = maxRaw === '' || maxRaw === undefined || maxRaw === null ? NaN : Number(maxRaw);
  const range = {};
  if (Number.isFinite(min)) range.min = min;
  if (Number.isFinite(max)) range.max = max;
  return range;
}

module.exports = {
  calculateAgeInMonths,
  getFatEnergyRangeByAgeMonths,
  getDefaultMacroRatioRanges,
  getDefaultMacroRatioRangesByBirthday,
  calculateEnergyRatios,
  calculatePremiumProteinRatio,
  evaluateRatioRange,
  statusLabel,
  buildMacroRatioSummary,
  formatRangeText,
  parseRangeInputs
};
