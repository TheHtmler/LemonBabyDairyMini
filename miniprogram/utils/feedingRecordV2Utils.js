const {
  POWDER_CATEGORY_META,
  PROTEIN_ROLES,
  buildCategoryBadgeStyle
} = require('./formulaPowderUtils');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function normalizeNutritionSnapshot(nutrition = {}) {
  return {
    protein: toNumber(nutrition.protein),
    calories: toNumber(nutrition.calories),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber)
  };
}

function createEmptySummary() {
  return {
    totalVolume: 0,
    totalPowderWeight: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    zeroProteinCalories: 0
  };
}

function roundSummary(summary = {}) {
  return {
    totalVolume: roundValue(summary.totalVolume),
    totalPowderWeight: roundValue(summary.totalPowderWeight),
    protein: roundValue(summary.protein),
    naturalProtein: roundValue(summary.naturalProtein),
    specialProtein: roundValue(summary.specialProtein),
    calories: roundValue(summary.calories),
    fat: roundValue(summary.fat),
    carbs: roundValue(summary.carbs),
    fiber: roundValue(summary.fiber),
    zeroProteinCalories: roundValue(summary.zeroProteinCalories)
  };
}

function buildBreastMilkComponent(volume, settings = {}) {
  return {
    kind: 'breast_milk',
    volume: roundValue(volume),
    nutritionSnapshot: normalizeNutritionSnapshot({
      protein: settings.natural_milk_protein,
      calories: settings.natural_milk_calories,
      fat: settings.natural_milk_fat,
      carbs: settings.natural_milk_carbs,
      fiber: settings.natural_milk_fiber
    })
  };
}

function calculateStandardPowderWeight(waterVolume, ratio = {}) {
  const waterNum = toNumber(waterVolume);
  const powder = toNumber(ratio.powder);
  const water = toNumber(ratio.water);
  if (waterNum <= 0 || powder <= 0 || water <= 0) {
    return 0;
  }
  return roundValue((waterNum * powder) / water);
}

function buildFormulaPowderComponent(profile = {}, draft = {}) {
  const ratioMode = draft.ratioMode === 'custom' ? 'custom' : 'standard';
  const mixRatio = {
    powder: toNumber(profile.mixRatio?.powder),
    water: toNumber(profile.mixRatio?.water)
  };
  const powderWeight = draft.powderWeight !== undefined && draft.powderWeight !== ''
    ? toNumber(draft.powderWeight)
    : calculateStandardPowderWeight(draft.waterVolume, mixRatio);
  const categoryMeta = POWDER_CATEGORY_META[profile.category] || {};

  const sourceType = profile.sourceType || (profile.source === 'system' ? 'system' : 'user');
  const sourcePowderCode = profile.sourcePowderCode
    || profile.sourceSystemPowderId
    || (sourceType === 'system' ? (profile.powderCode || profile.id || '') : '')
    || '';

  return {
    kind: 'formula_powder',
    powderId: profile.id || '',
    powderName: profile.name || '未命名配方粉',
    category: profile.category || '',
    categoryShortLabel: categoryMeta.shortLabel || '',
    categoryBadgeClass: categoryMeta.badgeClass || '',
    categoryBadgeStyle: buildCategoryBadgeStyle(categoryMeta),
    proteinRole: profile.proteinRole || PROTEIN_ROLES.NATURAL,
    sourceType,
    sourcePowderCode,
    waterVolume: roundValue(draft.waterVolume),
    powderWeight: roundValue(powderWeight),
    ratioMode,
    mixRatioSnapshot: mixRatio,
    nutritionSnapshot: normalizeNutritionSnapshot(profile.nutritionPer100g)
  };
}

function addBreastMilkSummary(summary, component) {
  const volume = toNumber(component.volume);
  const factor = volume / 100;
  const nutrition = normalizeNutritionSnapshot(component.nutritionSnapshot);
  const protein = nutrition.protein * factor;

  summary.totalVolume += volume;
  summary.protein += protein;
  summary.naturalProtein += protein;
  summary.calories += nutrition.calories * factor;
  summary.fat += nutrition.fat * factor;
  summary.carbs += nutrition.carbs * factor;
  summary.fiber += nutrition.fiber * factor;
}

function addFormulaPowderSummary(summary, component) {
  const powderWeight = toNumber(component.powderWeight);
  const factor = powderWeight / 100;
  const nutrition = normalizeNutritionSnapshot(component.nutritionSnapshot);
  const protein = nutrition.protein * factor;
  const calories = nutrition.calories * factor;

  summary.totalVolume += toNumber(component.waterVolume);
  summary.totalPowderWeight += powderWeight;
  summary.calories += calories;
  summary.fat += nutrition.fat * factor;
  summary.carbs += nutrition.carbs * factor;
  summary.fiber += nutrition.fiber * factor;

  if (component.proteinRole === PROTEIN_ROLES.NONE) {
    summary.zeroProteinCalories += calories;
    return;
  }

  summary.protein += protein;
  if (component.proteinRole === PROTEIN_ROLES.SPECIAL) {
    summary.specialProtein += protein;
  } else {
    summary.naturalProtein += protein;
  }
}

function buildNutritionSummary(components = []) {
  const summary = createEmptySummary();

  (components || []).forEach((component) => {
    if (component?.kind === 'breast_milk') {
      addBreastMilkSummary(summary, component);
      return;
    }
    if (component?.kind === 'formula_powder') {
      addFormulaPowderSummary(summary, component);
    }
  });

  return roundSummary(summary);
}

function normalizeFeedingRecordV2(record = {}, options = {}) {
  const includeArchived = options.includeArchived === true;
  const status = record.status || 'active';
  if (!includeArchived && status !== 'active') {
    return null;
  }

  const components = Array.isArray(record.formulaComponents)
    ? record.formulaComponents
    : [];
  const summary = record.nutritionSummary || buildNutritionSummary(components);
  const startTime = record.startTime || '';

  return {
    ...record,
    id: record._id || record.id || '',
    status,
    formulaComponents: components,
    nutritionSummary: roundSummary(summary),
    title: `${startTime || '--:--'} 喂奶`
  };
}

module.exports = {
  buildBreastMilkComponent,
  buildFormulaPowderComponent,
  buildNutritionSummary,
  normalizeFeedingRecordV2
};
