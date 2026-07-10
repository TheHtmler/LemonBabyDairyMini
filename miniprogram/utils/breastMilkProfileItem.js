const { POWDER_CATEGORIES, PROTEIN_ROLES, POWDER_STATUSES } = require('./formulaPowderUtils');

const DEFAULT_BREAST_MILK_NUTRITION = {
  natural_milk_protein: 1.1,
  natural_milk_calories: 67,
  natural_milk_fat: 4.0,
  natural_milk_carbs: 6.8,
  natural_milk_fiber: 0
};

const VIRTUAL_BREAST_MILK_ID = '__virtual_breast_milk__';

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildVirtualBreastMilkPowder(settings = {}) {
  const merged = { ...DEFAULT_BREAST_MILK_NUTRITION, ...settings };
  const nutritionPer100ml = {
    protein: toNumber(merged.natural_milk_protein, DEFAULT_BREAST_MILK_NUTRITION.natural_milk_protein),
    calories: toNumber(merged.natural_milk_calories, DEFAULT_BREAST_MILK_NUTRITION.natural_milk_calories),
    fat: toNumber(merged.natural_milk_fat, DEFAULT_BREAST_MILK_NUTRITION.natural_milk_fat),
    carbs: toNumber(merged.natural_milk_carbs, DEFAULT_BREAST_MILK_NUTRITION.natural_milk_carbs),
    fiber: toNumber(merged.natural_milk_fiber, DEFAULT_BREAST_MILK_NUTRITION.natural_milk_fiber)
  };

  return {
    _id: VIRTUAL_BREAST_MILK_ID,
    id: VIRTUAL_BREAST_MILK_ID,
    powderId: VIRTUAL_BREAST_MILK_ID,
    name: '母乳',
    category: POWDER_CATEGORIES.BREAST_MILK,
    proteinRole: PROTEIN_ROLES.NATURAL,
    nutritionPer100g: nutritionPer100ml,
    nutritionBasisUnit: 'ml',
    nutritionBasisQuantity: 100,
    mixRatio: {
      powder: 0,
      water: 0
    },
    status: POWDER_STATUSES.ACTIVE,
    source: 'nutrition_profile',
    isVirtualBreastMilk: true,
    isFixedPowder: true,
    libraryScope: 'mine',
    isSystem: false,
    powderCode: VIRTUAL_BREAST_MILK_ID,
    brandStageText: '天然蛋白来源'
  };
}

function buildBreastMilkPowderDraft(powder = {}) {
  const nutrition = powder.nutritionPer100g || {};
  return {
    id: VIRTUAL_BREAST_MILK_ID,
    name: '母乳',
    category: POWDER_CATEGORIES.BREAST_MILK,
    proteinRole: PROTEIN_ROLES.NATURAL,
    nutritionPer100g: {
      protein: `${nutrition.protein ?? ''}`,
      calories: `${nutrition.calories ?? ''}`,
      fat: `${nutrition.fat ?? ''}`,
      carbs: `${nutrition.carbs ?? ''}`,
      fiber: `${nutrition.fiber ?? ''}`
    },
    mixRatio: {
      powder: '',
      water: ''
    },
    status: POWDER_STATUSES.ACTIVE,
    source: 'nutrition_profile',
    sourceSystemPowderId: '',
    createdAt: '',
    updatedAt: '',
    deletedAt: null
  };
}

function isVirtualBreastMilkPowder(powder = {}) {
  return !!powder.isVirtualBreastMilk || powder._id === VIRTUAL_BREAST_MILK_ID;
}

function stripVirtualBreastMilkPowders(powders = []) {
  return (powders || []).filter((powder) => !isVirtualBreastMilkPowder(powder));
}

module.exports = {
  DEFAULT_BREAST_MILK_NUTRITION,
  VIRTUAL_BREAST_MILK_ID,
  buildVirtualBreastMilkPowder,
  buildBreastMilkPowderDraft,
  isVirtualBreastMilkPowder,
  stripVirtualBreastMilkPowders
};
