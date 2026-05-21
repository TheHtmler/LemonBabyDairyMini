const MILK_CATEGORY_TAG_CONFIG = require('../config/milkCategoryTags');

const POWDER_CATEGORIES = {
  REGULAR_FORMULA: 'regular_formula',
  SPECIAL_FORMULA: 'special_formula',
  ENERGY_SUPPLEMENT: 'energy_supplement'
};

const POWDER_CATEGORY_META = {
  [POWDER_CATEGORIES.REGULAR_FORMULA]: MILK_CATEGORY_TAG_CONFIG[POWDER_CATEGORIES.REGULAR_FORMULA],
  [POWDER_CATEGORIES.SPECIAL_FORMULA]: MILK_CATEGORY_TAG_CONFIG[POWDER_CATEGORIES.SPECIAL_FORMULA],
  [POWDER_CATEGORIES.ENERGY_SUPPLEMENT]: MILK_CATEGORY_TAG_CONFIG[POWDER_CATEGORIES.ENERGY_SUPPLEMENT]
};

const POWDER_CATEGORY_ORDER = [
  POWDER_CATEGORIES.REGULAR_FORMULA,
  POWDER_CATEGORIES.SPECIAL_FORMULA,
  POWDER_CATEGORIES.ENERGY_SUPPLEMENT
];

const BREAST_MILK_TAG_META = MILK_CATEGORY_TAG_CONFIG.breast_milk;

const PROTEIN_ROLES = {
  NATURAL: 'natural',
  SPECIAL: 'special',
  NONE: 'none'
};

const POWDER_STATUSES = {
  ACTIVE: 'active',
  ARCHIVED: 'archived'
};

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildCategoryBadgeStyle(meta = {}) {
  const colors = meta.colors || {};
  const background = colors.background || '#F5F5F5';
  const text = colors.text || '#666666';
  const border = colors.border || 'transparent';
  return `background: ${background}; color: ${text}; border-color: ${border};`;
}

function sortFormulaPowdersByCategory(powders = []) {
  const categoryOrder = POWDER_CATEGORY_ORDER.reduce((acc, category, index) => {
    acc[category] = index;
    return acc;
  }, {});

  return [...(powders || [])].sort((left, right) => {
    const leftOrder = categoryOrder[left.category] ?? POWDER_CATEGORY_ORDER.length;
    const rightOrder = categoryOrder[right.category] ?? POWDER_CATEGORY_ORDER.length;
    return leftOrder - rightOrder;
  });
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function hasPositiveValue(value) {
  return toNumber(value) > 0;
}

function getDefaultProteinRole(category) {
  if (category === POWDER_CATEGORIES.SPECIAL_FORMULA) {
    return PROTEIN_ROLES.SPECIAL;
  }
  if (category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT) {
    return PROTEIN_ROLES.NONE;
  }
  return PROTEIN_ROLES.NATURAL;
}

function normalizeNutritionPer100g(nutrition = {}) {
  return {
    protein: toNumber(nutrition.protein),
    calories: toNumber(nutrition.calories),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber)
  };
}

function normalizeMixRatio(ratio = {}) {
  return {
    powder: toNumber(ratio.powder),
    water: toNumber(ratio.water)
  };
}

function normalizePowderStatus(status) {
  return Object.values(POWDER_STATUSES).includes(status)
    ? status
    : POWDER_STATUSES.ACTIVE;
}

function normalizeFormulaPowders(powders = []) {
  if (!Array.isArray(powders)) {
    return [];
  }

  return powders
    .map((powder, index) => {
      if (!powder || typeof powder !== 'object') {
        return null;
      }

      const category = Object.values(POWDER_CATEGORIES).includes(powder.category)
        ? powder.category
        : POWDER_CATEGORIES.REGULAR_FORMULA;
      const proteinRole = Object.values(PROTEIN_ROLES).includes(powder.proteinRole)
        ? powder.proteinRole
        : getDefaultProteinRole(category);
      const id = powder.id || `formula_powder_${index + 1}`;
      const name = powder.name || '未命名配方粉';
      const status = normalizePowderStatus(powder.status);

      return {
        id,
        name,
        category,
        proteinRole,
        nutritionPer100g: normalizeNutritionPer100g(powder.nutritionPer100g),
        mixRatio: normalizeMixRatio(powder.mixRatio),
        status,
        source: powder.source || 'user',
        createdAt: powder.createdAt || null,
        updatedAt: powder.updatedAt || null,
        deletedAt: status === POWDER_STATUSES.ARCHIVED ? (powder.deletedAt || null) : null
      };
    })
    .filter(Boolean);
}

function createLegacyFormulaPowders(settings = {}) {
  const profiles = [];
  const formulaRatio = normalizeMixRatio(settings.formula_milk_ratio || {});
  const hasFormulaData = [
    settings.formula_milk_protein,
    settings.formula_milk_calories,
    settings.formula_milk_fat,
    settings.formula_milk_carbs,
    settings.formula_milk_fiber,
    formulaRatio.powder,
    formulaRatio.water
  ].some(hasPositiveValue);

  if (hasFormulaData) {
    profiles.push({
      id: 'legacy_regular_formula',
      name: '默认普通配方粉',
      category: POWDER_CATEGORIES.REGULAR_FORMULA,
      proteinRole: PROTEIN_ROLES.NATURAL,
      nutritionPer100g: {
        protein: toNumber(settings.formula_milk_protein),
        calories: toNumber(settings.formula_milk_calories),
        fat: toNumber(settings.formula_milk_fat),
        carbs: toNumber(settings.formula_milk_carbs),
        fiber: toNumber(settings.formula_milk_fiber)
      },
      mixRatio: formulaRatio,
      status: POWDER_STATUSES.ACTIVE,
      source: 'legacy'
    });
  }

  const specialRatio = normalizeMixRatio(settings.special_milk_ratio || {});
  const hasSpecialData = [
    settings.special_milk_protein,
    settings.special_milk_calories,
    settings.special_milk_fat,
    settings.special_milk_carbs,
    settings.special_milk_fiber,
    specialRatio.powder,
    specialRatio.water
  ].some(hasPositiveValue);

  if (hasSpecialData) {
    profiles.push({
      id: 'legacy_special_formula',
      name: '默认特殊配方粉',
      category: POWDER_CATEGORIES.SPECIAL_FORMULA,
      proteinRole: PROTEIN_ROLES.SPECIAL,
      nutritionPer100g: {
        protein: toNumber(settings.special_milk_protein),
        calories: toNumber(settings.special_milk_calories),
        fat: toNumber(settings.special_milk_fat),
        carbs: toNumber(settings.special_milk_carbs),
        fiber: toNumber(settings.special_milk_fiber)
      },
      mixRatio: specialRatio,
      status: POWDER_STATUSES.ACTIVE,
      source: 'legacy'
    });
  }

  return normalizeFormulaPowders(profiles);
}

function normalizePlanComponent(component = {}, powderIds = new Set()) {
  if (component.kind === 'breast_milk') {
    return {
      kind: 'breast_milk',
      volume: toNumber(component.volume)
    };
  }

  if (component.kind === 'formula_powder' && powderIds.has(component.powderId)) {
    return {
      kind: 'formula_powder',
      powderId: component.powderId,
      waterVolume: toNumber(component.waterVolume),
      powderWeight: toNumber(component.powderWeight),
      ratioMode: component.ratioMode === 'custom' ? 'custom' : 'standard'
    };
  }

  return null;
}

function normalizeMixingPlans(plans = [], powders = []) {
  if (!Array.isArray(plans)) {
    return [];
  }

  const powderIds = new Set((powders || []).map((powder) => powder.id).filter(Boolean));

  return plans
    .map((plan, index) => {
      if (!plan || typeof plan !== 'object') {
        return null;
      }

      return {
        id: plan.id || `mixing_plan_${index + 1}`,
        name: plan.name || '未命名配奶方案',
        components: (plan.components || [])
          .map((component) => normalizePlanComponent(component, powderIds))
          .filter(Boolean),
        enabled: plan.enabled !== false,
        createdAt: plan.createdAt || null,
        updatedAt: plan.updatedAt || null
      };
    })
    .filter(Boolean);
}

function createEmptyNutritionSummary() {
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

function roundNutritionSummary(summary) {
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

function addNutrition(target, source) {
  Object.keys(target).forEach((key) => {
    target[key] += toNumber(source[key]);
  });
}

function calculatePowderNutrition(profile = {}, powderWeight = 0) {
  const weight = toNumber(powderWeight);
  const nutrition = normalizeNutritionPer100g(profile.nutritionPer100g);
  const summary = createEmptyNutritionSummary();
  const factor = weight / 100;

  summary.totalPowderWeight = weight;
  summary.protein = nutrition.protein * factor;
  summary.calories = nutrition.calories * factor;
  summary.fat = nutrition.fat * factor;
  summary.carbs = nutrition.carbs * factor;
  summary.fiber = nutrition.fiber * factor;

  if (profile.proteinRole === PROTEIN_ROLES.SPECIAL) {
    summary.specialProtein = summary.protein;
  } else if (profile.proteinRole === PROTEIN_ROLES.NONE) {
    summary.protein = 0;
    summary.zeroProteinCalories = summary.calories;
  } else {
    summary.naturalProtein = summary.protein;
  }

  return roundNutritionSummary(summary);
}

function calculateBreastMilkNutrition(settings = {}, volume = 0) {
  const volumeNum = toNumber(volume);
  const factor = volumeNum / 100;
  const summary = createEmptyNutritionSummary();
  const protein = toNumber(settings.natural_milk_protein) * factor;

  summary.totalVolume = volumeNum;
  summary.protein = protein;
  summary.naturalProtein = protein;
  summary.calories = toNumber(settings.natural_milk_calories) * factor;
  summary.fat = toNumber(settings.natural_milk_fat) * factor;
  summary.carbs = toNumber(settings.natural_milk_carbs) * factor;
  summary.fiber = toNumber(settings.natural_milk_fiber) * factor;

  return roundNutritionSummary(summary);
}

function calculateMixingPlanPreview(settings = {}, powders = [], plan = {}) {
  const summary = createEmptyNutritionSummary();
  const normalizedPowders = normalizeFormulaPowders(powders);
  const powderMap = new Map(normalizedPowders.map((powder) => [powder.id, powder]));

  (plan.components || []).forEach((component) => {
    if (component.kind === 'breast_milk') {
      addNutrition(summary, calculateBreastMilkNutrition(settings, component.volume));
      return;
    }

    if (component.kind !== 'formula_powder') {
      return;
    }

    const profile = powderMap.get(component.powderId);
    if (!profile || profile.status !== POWDER_STATUSES.ACTIVE) {
      return;
    }

    const powderNutrition = calculatePowderNutrition(profile, component.powderWeight);
    addNutrition(summary, {
      ...powderNutrition,
      totalVolume: toNumber(component.waterVolume)
    });
  });

  return roundNutritionSummary(summary);
}

function calculatePowderFromWater(waterVolume, ratio = {}) {
  const waterNum = toNumber(waterVolume);
  const powder = toNumber(ratio.powder);
  const water = toNumber(ratio.water);
  if (waterNum <= 0 || powder <= 0 || water <= 0) {
    return 0;
  }
  return roundValue((waterNum * powder) / water);
}

function getLegacySpecialVolume(feeding = {}) {
  if (hasPositiveValue(feeding.specialMilkVolume)) {
    return toNumber(feeding.specialMilkVolume);
  }

  const totalVolume = toNumber(feeding.totalVolume);
  const naturalVolume = toNumber(feeding.naturalMilkVolume);
  return Math.max(0, totalVolume - naturalVolume);
}

function createSnapshotFromProfile(profile) {
  return {
    protein: profile.nutritionPer100g.protein,
    calories: profile.nutritionPer100g.calories,
    fat: profile.nutritionPer100g.fat,
    carbs: profile.nutritionPer100g.carbs,
    fiber: profile.nutritionPer100g.fiber
  };
}

function createFormulaComponentFromProfile(profile, waterVolume, powderWeight) {
  return {
    kind: 'formula_powder',
    powderId: profile.id,
    powderName: profile.name,
    category: profile.category,
    proteinRole: profile.proteinRole,
    waterVolume: roundValue(waterVolume),
    powderWeight: roundValue(powderWeight),
    nutritionSnapshot: createSnapshotFromProfile(profile)
  };
}

function createFormulaComponentsFromLegacyFeeding(feeding = {}, calculationParams = {}) {
  const components = [];
  const legacyProfiles = createLegacyFormulaPowders(calculationParams);
  const regularProfile = legacyProfiles.find((profile) => profile.category === POWDER_CATEGORIES.REGULAR_FORMULA);
  const specialProfile = legacyProfiles.find((profile) => profile.category === POWDER_CATEGORIES.SPECIAL_FORMULA);
  const naturalVolume = toNumber(feeding.naturalMilkVolume);

  if (feeding.naturalMilkType === 'breast' && naturalVolume > 0) {
    components.push({
      kind: 'breast_milk',
      volume: roundValue(naturalVolume)
    });
  }

  if (feeding.naturalMilkType === 'formula' && naturalVolume > 0 && regularProfile) {
    const formulaPowderWeight = hasPositiveValue(feeding.formulaPowderWeight)
      ? toNumber(feeding.formulaPowderWeight)
      : calculatePowderFromWater(naturalVolume, regularProfile.mixRatio);

    components.push(createFormulaComponentFromProfile(regularProfile, naturalVolume, formulaPowderWeight));
  }

  const specialVolume = getLegacySpecialVolume(feeding);
  if (specialVolume > 0 && specialProfile) {
    const specialPowderWeight = hasPositiveValue(feeding.specialMilkPowder)
      ? toNumber(feeding.specialMilkPowder)
      : calculatePowderFromWater(specialVolume, specialProfile.mixRatio);

    components.push(createFormulaComponentFromProfile(specialProfile, specialVolume, specialPowderWeight));
  }

  return components;
}

module.exports = {
  POWDER_CATEGORIES,
  POWDER_CATEGORY_META,
  POWDER_CATEGORY_ORDER,
  BREAST_MILK_TAG_META,
  MILK_CATEGORY_TAG_CONFIG,
  PROTEIN_ROLES,
  POWDER_STATUSES,
  buildCategoryBadgeStyle,
  sortFormulaPowdersByCategory,
  normalizeFormulaPowders,
  createLegacyFormulaPowders,
  normalizeMixingPlans,
  calculatePowderNutrition,
  calculateMixingPlanPreview,
  createFormulaComponentsFromLegacyFeeding
};
