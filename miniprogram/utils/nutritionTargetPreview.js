const DEFAULT_NUTRITION_TREATMENT_CATEGORIES = ['dextrose_10', 'dextrose_5'];

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function formatFixed(value, precision = 2) {
  return roundValue(value, precision).toFixed(precision);
}

function formatAmount(value, unit) {
  const precision = unit === 'kcal' ? 0 : 2;
  return `${formatFixed(value, precision)}${unit}`;
}

function formatPercentText(value) {
  return `${formatFixed(value, 1)}%`;
}

function normalizeSummary(summary = {}) {
  return {
    calories: roundValue(toNumber(summary.calories), 2),
    protein: roundValue(toNumber(summary.protein), 2),
    naturalProtein: roundValue(toNumber(summary.naturalProtein), 2),
    specialProtein: roundValue(toNumber(summary.specialProtein), 2),
    carbs: roundValue(toNumber(summary.carbs), 2),
    fat: roundValue(toNumber(summary.fat), 2)
  };
}

function addSummaries(left = {}, right = {}) {
  const a = normalizeSummary(left);
  const b = normalizeSummary(right);
  return normalizeSummary({
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    naturalProtein: a.naturalProtein + b.naturalProtein,
    specialProtein: a.specialProtein + b.specialProtein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat
  });
}

function subtractSummaries(left = {}, right = {}) {
  const a = normalizeSummary(left);
  const b = normalizeSummary(right);
  return normalizeSummary({
    calories: Math.max(0, a.calories - b.calories),
    protein: Math.max(0, a.protein - b.protein),
    naturalProtein: Math.max(0, a.naturalProtein - b.naturalProtein),
    specialProtein: Math.max(0, a.specialProtein - b.specialProtein),
    carbs: Math.max(0, a.carbs - b.carbs),
    fat: Math.max(0, a.fat - b.fat)
  });
}

function buildGoalRow({ key, label, displayLabel, tone, actual, draft, target, unit = 'g' }) {
  const hasTarget = target > 0;
  const precision = unit === 'kcal' ? 0 : 2;
  const actualValue = roundValue(actual, precision);
  const draftValue = roundValue(draft, precision);
  const targetValue = roundValue(target, precision);
  const remaining = hasTarget ? Math.max(0, roundValue(targetValue - actualValue, precision)) : 0;
  const overAmount = hasTarget ? Math.max(0, roundValue(actualValue - targetValue, precision)) : 0;
  const pct = hasTarget && targetValue > 0 ? roundValue((actualValue / targetValue) * 100, 1) : 0;
  const status = !hasTarget
    ? 'unset'
    : (overAmount > 0 ? 'over' : (pct >= 90 ? 'warn' : 'ok'));
  const badgeText = !hasTarget
    ? '未设置'
    : (overAmount > 0 ? `超出 ${formatAmount(overAmount, unit)}` : `还差 ${formatAmount(remaining, unit)}`);

  return {
    key,
    label,
    displayLabel: displayLabel || label,
    tone,
    unit,
    actual: actualValue,
    draft: draftValue,
    target: targetValue,
    remaining,
    overAmount,
    pct,
    barPct: hasTarget ? Math.min(100, pct) : 0,
    status,
    hasTarget,
    badgeText,
    valueText: formatFixed(actualValue, precision),
    valueWithUnitText: formatAmount(actualValue, unit),
    pctText: formatPercentText(pct),
    targetText: hasTarget ? `${formatFixed(targetValue, precision)}${unit}` : '',
    draftText: `本次增加 +${formatAmount(draftValue, unit)}`,
    actionText: overAmount > 0 ? '仍然保存' : '保存'
  };
}

function buildCalorieNote({ actual, draft, target, includeCalories }) {
  const targetValue = roundValue(target, 0);
  if (!includeCalories || targetValue <= 0) {
    return { visible: false };
  }

  const row = buildGoalRow({
    key: 'calorie',
    label: '热量',
    tone: 'cal',
    actual,
    draft,
    target,
    unit: 'kcal'
  });
  const relation = row.overAmount > 0
    ? `今日超出 ${row.overAmount} kcal`
    : `今日还差 ${row.remaining} kcal`;

  return {
    visible: true,
    ...row,
    text: `本次 +${row.draft} kcal · ${relation}`
  };
}

function buildEntryTargetPreview({
  currentSummary = {},
  draftSummary = {},
  previousSummary = {},
  weight = 0,
  targetPreferences = {},
  includeCalories = true
} = {}) {
  const safeWeight = toNumber(weight);
  const draft = normalizeSummary(draftSummary);
  const baseAfterRemovingPrevious = subtractSummaries(currentSummary, previousSummary);
  const afterSave = addSummaries(baseAfterRemovingPrevious, draft);
  const naturalTarget = safeWeight * toNumber(targetPreferences.naturalProteinCoefficient);
  const specialTarget = safeWeight * toNumber(targetPreferences.specialProteinCoefficient);
  const calorieTarget = safeWeight * toNumber(targetPreferences.calorieCoefficient);
  const proteinRows = [
    buildGoalRow({
      key: 'naturalProtein',
      label: '天然蛋白',
      displayLabel: '今日天然蛋白',
      tone: 'nat',
      actual: afterSave.naturalProtein,
      draft: draft.naturalProtein,
      target: naturalTarget,
      unit: 'g'
    }),
    buildGoalRow({
      key: 'specialProtein',
      label: '特殊蛋白',
      displayLabel: '今日特殊蛋白',
      tone: 'spe',
      actual: afterSave.specialProtein,
      draft: draft.specialProtein,
      target: specialTarget,
      unit: 'g'
    })
  ];

  return {
    weight: safeWeight,
    currentSummary: normalizeSummary(currentSummary),
    draftSummary: draft,
    previousSummary: normalizeSummary(previousSummary),
    afterSaveSummary: afterSave,
    proteinRows,
    calorieNote: buildCalorieNote({
      actual: afterSave.calories,
      draft: draft.calories,
      target: calorieTarget,
      includeCalories
    }),
    hasProteinTarget: proteinRows.some(row => row.hasTarget),
    hasOverProtein: proteinRows.some(row => row.status === 'over'),
    actionText: proteinRows.some(row => row.status === 'over') ? '仍然保存' : '保存'
  };
}

function summarizeFoodItems(items = []) {
  const summary = (items || []).reduce((acc, item = {}) => {
    const nutrition = item.nutrition || {};
    const protein = toNumber(nutrition.protein);
    const hasNatural = item.naturalProtein !== undefined && item.naturalProtein !== null && item.naturalProtein !== '';
    const hasSpecial = item.specialProtein !== undefined && item.specialProtein !== null && item.specialProtein !== '';
    const naturalProtein = hasNatural
      ? toNumber(item.naturalProtein)
      : (item.proteinSource === 'special' ? 0 : protein);
    const specialProtein = hasSpecial
      ? toNumber(item.specialProtein)
      : (item.proteinSource === 'special' ? protein : 0);

    acc.calories += toNumber(nutrition.calories);
    acc.protein += protein;
    acc.naturalProtein += naturalProtein;
    acc.specialProtein += specialProtein;
    acc.carbs += toNumber(nutrition.carbs);
    acc.fat += toNumber(nutrition.fat);
    return acc;
  }, normalizeSummary());

  return normalizeSummary(summary);
}

function shouldCountTreatmentNutrition(item = {}) {
  if (typeof item.countInNutrition === 'boolean') {
    return item.countInNutrition;
  }
  return DEFAULT_NUTRITION_TREATMENT_CATEGORIES.includes(item.category);
}

function summarizeTreatmentGroups(groups = []) {
  const summary = (groups || []).reduce((acc, group = {}) => {
    (group.items || []).forEach(item => {
      if (!shouldCountTreatmentNutrition(item)) return;
      acc.calories += toNumber(item.calories);
      acc.protein += toNumber(item.proteinG);
      acc.carbs += toNumber(item.carbsG);
      acc.fat += toNumber(item.fatG);
    });
    return acc;
  }, normalizeSummary());

  return normalizeSummary({
    ...summary,
    naturalProtein: 0,
    specialProtein: 0
  });
}

module.exports = {
  buildEntryTargetPreview,
  summarizeFoodItems,
  summarizeTreatmentGroups,
  normalizeSummary,
  addSummaries,
  subtractSummaries
};
