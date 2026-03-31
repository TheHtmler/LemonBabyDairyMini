// 获取某月的天数
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 获取某天是星期几
function getWeekday(date) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return weekdays[date.getDay()];
}

// 引入配奶设置模型
const NutritionModel = require('../../models/nutrition');
// 引入药物记录模型
const MedicationRecordModel = require('../../models/medicationRecord');
const TreatmentRecordModel = require('../../models/treatmentRecord');
// 引入食物模型
const FoodModel = require('../../models/food');
const InvitationModel = require('../../models/invitation');
const {
  createEmptyTreatmentOverview,
  mergeTreatmentIntoMacroSummary,
  mergeTreatmentIntoOverview,
  formatTreatmentRecordsForDisplay
} = require('../../utils/treatmentUtils');
const {
  buildDataRecordsSummaryPreview
} = require('../../utils/dataRecordsSummaryPreview');
// 通用工具
const { getBabyUid, waitForAppInitialization, checkUserPermission } = require('../../utils/index');

// 母乳热量 67kcal/100ml
// 特奶热量 69.5kcal/100ml
const BREAST_MILK_KCAL = 0.67;
const SPECIAL_MILK_KCAL = 0.70;
const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_FORMULA_RATIO = {
  powder: 7,
  water: 100
};
const DEFAULT_SPECIAL_MILK_PROTEIN = 13.1;
const DEFAULT_SPECIAL_MILK_PROTEIN_ML = 1.97;
const MILK_CATEGORY_ALIASES = ['milk', '奶类', '奶制品', '乳制品'];
const MAX_RECENT_FOODS = 10;
const CALORIE_RANGE_BY_AGE = [
  { maxMonths: 6, min: 72, max: 109, label: '0-6月龄推荐' },
  { maxMonths: 12, min: 65, max: 97, label: '6-12月龄推荐' },
  { maxMonths: 36, min: 66, max: 99, label: '1-3岁推荐' },
  { maxMonths: 84, min: 59, max: 88, label: '3-7岁推荐' },
  { maxMonths: 144, min: 43, max: 65, label: '7-12岁推荐' }
];

function roundNumber(value, precision = 2) {
  if (isNaN(value)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round(num);
}

function pickFirstFilled(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return '';
}

function calculateFormulaPowder(naturalMilkVolume, calculation_params = {}) {
  if (!calculation_params || !naturalMilkVolume || naturalMilkVolume <= 0) {
    return 0;
  }
  const ratioPowder = Number(calculation_params.formula_milk_ratio?.powder);
  const ratioWater = Number(calculation_params.formula_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) {
    return 0;
  }
  return Math.round((naturalMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function calculateSpecialMilkPowder(specialMilkVolume, calculation_params = {}) {
  if (!calculation_params || !specialMilkVolume || specialMilkVolume <= 0) {
    return 0;
  }
  const ratioPowder = Number(calculation_params.special_milk_ratio?.powder);
  const ratioWater = Number(calculation_params.special_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) {
    return 0;
  }
  return Math.round((specialMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function isMilkCategory(category) {
  if (!category) return false;
  return MILK_CATEGORY_ALIASES.includes(category);
}

function formatTime(date = new Date()) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function calculateMilkNutrition(feeding, nutritionSettings = {}) {
  const naturalMilkVolume = parseFloat(feeding.naturalMilkVolume) || 0;
  const specialMilkVolume = parseFloat(feeding.specialMilkVolume) || 0;
  const specialPowderWeight = parseFloat(feeding.specialMilkPowder) || 0;
  const naturalMilkType = feeding.naturalMilkType || 'breast';

  let naturalProtein = 0;
  let naturalFat = 0;
  let naturalCarbs = 0;
  let naturalCalories = naturalMilkVolume * BREAST_MILK_KCAL;
  if (naturalMilkType === 'formula') {
    const powderWeight = calculateFormulaPowder(naturalMilkVolume, nutritionSettings);
    const formulaProteinPer100g = Number(nutritionSettings.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
    const formulaFatPer100g = Number(nutritionSettings.formula_milk_fat) || 0;
    const formulaCarbsPer100g = Number(nutritionSettings.formula_milk_carbs) || 0;
    if (powderWeight > 0 && formulaProteinPer100g > 0) {
      naturalProtein = (powderWeight * formulaProteinPer100g) / 100;
      naturalFat = (powderWeight * formulaFatPer100g) / 100;
      naturalCarbs = (powderWeight * formulaCarbsPer100g) / 100;
      const formulaCaloriesPer100g = Number(nutritionSettings.formula_milk_calories) || DEFAULT_FORMULA_MILK_CALORIES;
      if (formulaCaloriesPer100g) {
        naturalCalories = (powderWeight * formulaCaloriesPer100g) / 100;
      }
    } else {
      const naturalProteinPer100ml = Number(nutritionSettings.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
      naturalProtein = (naturalMilkVolume * naturalProteinPer100ml) / 100;
    }
  } else {
    const naturalProteinPer100ml = Number(nutritionSettings.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
    naturalProtein = (naturalMilkVolume * naturalProteinPer100ml) / 100;
    const naturalFatPer100ml = Number(nutritionSettings.natural_milk_fat) || 0;
    const naturalCarbsPer100ml = Number(nutritionSettings.natural_milk_carbs) || 0;
    naturalFat = (naturalMilkVolume * naturalFatPer100ml) / 100;
    naturalCarbs = (naturalMilkVolume * naturalCarbsPer100ml) / 100;
    const naturalCaloriesPer100ml = Number(nutritionSettings.natural_milk_calories);
    if (naturalCaloriesPer100ml > 0) {
      naturalCalories = (naturalMilkVolume * naturalCaloriesPer100ml) / 100;
    }
  }

  let specialProtein = 0;
  let specialCalories = 0;
  let specialFat = 0;
  let specialCarbs = 0;
  if (specialPowderWeight > 0) {
    const specialProteinPer100g = Number(nutritionSettings.special_milk_protein) || DEFAULT_SPECIAL_MILK_PROTEIN;
    const specialCaloriesPer100g = Number(nutritionSettings.special_milk_calories);
    const specialFatPer100g = Number(nutritionSettings.special_milk_fat) || 0;
    const specialCarbsPer100g = Number(nutritionSettings.special_milk_carbs) || 0;
    specialProtein = (specialPowderWeight * specialProteinPer100g) / 100;
    specialFat = (specialPowderWeight * specialFatPer100g) / 100;
    specialCarbs = (specialPowderWeight * specialCarbsPer100g) / 100;
    if (specialCaloriesPer100g > 0) {
      specialCalories = (specialPowderWeight * specialCaloriesPer100g) / 100;
    } else {
      specialCalories = specialMilkVolume * SPECIAL_MILK_KCAL;
    }
  } else if (specialMilkVolume > 0) {
    const ratioPowder = Number(nutritionSettings.special_milk_ratio?.powder);
    const ratioWater = Number(nutritionSettings.special_milk_ratio?.water);
    const specialProteinPer100g = Number(nutritionSettings.special_milk_protein);
    const specialFatPer100g = Number(nutritionSettings.special_milk_fat);
    const specialCarbsPer100g = Number(nutritionSettings.special_milk_carbs);
    const powderWeight = ratioPowder > 0 && ratioWater > 0
      ? specialMilkVolume * ratioPowder / ratioWater
      : 0;
    if (powderWeight > 0 && specialProteinPer100g > 0) {
      specialProtein = (powderWeight * specialProteinPer100g) / 100;
      if (specialFatPer100g > 0) {
        specialFat = (powderWeight * specialFatPer100g) / 100;
      }
      if (specialCarbsPer100g > 0) {
        specialCarbs = (powderWeight * specialCarbsPer100g) / 100;
      }
    } else {
      const specialProteinPer100ml = Number(nutritionSettings.special_milk_protein_ml) || DEFAULT_SPECIAL_MILK_PROTEIN_ML;
      specialProtein = (specialMilkVolume * specialProteinPer100ml) / 100;
    }

    const specialCaloriesPer100g = Number(nutritionSettings.special_milk_calories);
    if (specialCaloriesPer100g > 0 && powderWeight > 0) {
      specialCalories = (powderWeight * specialCaloriesPer100g) / 100;
    } else {
      specialCalories = specialMilkVolume * SPECIAL_MILK_KCAL;
    }
  }

  return {
    calories: roundCalories(naturalCalories + specialCalories),
    protein: roundNumber(naturalProtein + specialProtein, 2),
    naturalProtein: roundNumber(naturalProtein, 2),
    specialProtein: roundNumber(specialProtein, 2),
    naturalCalories: roundCalories(naturalCalories),
    specialCalories: roundCalories(specialCalories),
    specialPowder: roundNumber(specialPowderWeight, 2),
    carbs: roundNumber(naturalCarbs + specialCarbs, 2),
    fat: roundNumber(naturalFat + specialFat, 2)
  };
}

function createEmptyIntakeOverview() {
  return {
    milk: {
      totalCalories: 0,
      normal: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0, coefficient: '' },
      special: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0, coefficient: '' }
    },
    food: {
      count: 0,
      totalCalories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    },
    treatment: createEmptyTreatmentOverview()
  };
}

function calculateIntakeOverview(feedings = [], intakes = [], weight = 0, nutritionSettings = {}, treatmentRecords = []) {
  const overview = createEmptyIntakeOverview();
  const addMilkStats = (group, { volume = 0, calories = 0, protein = 0, carbs = 0, fat = 0 }) => {
    group.volume += volume;
    group.calories += Number(calories) || 0;
    group.protein += protein;
    group.carbs += carbs || 0;
    group.fat += fat || 0;
  };

  // 先聚合奶量再计算，避免逐条舍入
  let totalNaturalVolumeBreast = 0;
  let totalNaturalVolumeFormula = 0;
  let totalSpecialVolume = 0;

  (feedings || []).forEach(feeding => {
    const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
    const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
    const naturalTypeRaw = feeding.naturalMilkType || 'breast';
    const naturalType = naturalTypeRaw === 'breast' ? 'breast' : 'formula';

    if (naturalVolume > 0) {
      if (naturalType === 'formula') {
        totalNaturalVolumeFormula += naturalVolume;
      } else {
        totalNaturalVolumeBreast += naturalVolume;
      }
    }
    if (specialVolume > 0) {
      totalSpecialVolume += specialVolume;
    }
  });

  if (totalNaturalVolumeBreast > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: totalNaturalVolumeBreast,
      naturalMilkType: 'breast',
      specialMilkVolume: 0,
      specialMilkPowder: 0
    }, nutritionSettings);
    addMilkStats(overview.milk.normal, {
      volume: totalNaturalVolumeBreast,
      calories: nutrition.naturalCalories || 0,
      protein: nutrition.naturalProtein || 0,
      carbs: nutrition.carbs || 0,
      fat: nutrition.fat || 0
    });
  }

  if (totalNaturalVolumeFormula > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: totalNaturalVolumeFormula,
      naturalMilkType: 'formula',
      specialMilkVolume: 0,
      specialMilkPowder: 0
    }, nutritionSettings);
    addMilkStats(overview.milk.normal, {
      volume: totalNaturalVolumeFormula,
      calories: nutrition.naturalCalories || 0,
      protein: nutrition.naturalProtein || 0,
      carbs: nutrition.carbs || 0,
      fat: nutrition.fat || 0
    });
  }

  if (totalSpecialVolume > 0) {
    const specialPowder = calculateSpecialMilkPowder(totalSpecialVolume, nutritionSettings);
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: 'breast',
      specialMilkVolume: totalSpecialVolume,
      specialMilkPowder: specialPowder
    }, nutritionSettings);
    addMilkStats(overview.milk.special, {
      volume: totalSpecialVolume,
      calories: nutrition.specialCalories || 0,
      protein: nutrition.specialProtein || 0,
      carbs: nutrition.carbs || 0,
      fat: nutrition.fat || 0
    });
  }

  (intakes || []).forEach(intake => {
    const nutrition = intake.nutrition || {};
    const calories = Number(nutrition.calories) || 0;
    const protein = Number(nutrition.protein) || 0;
    const naturalProtein = typeof intake.naturalProtein === 'number'
      ? intake.naturalProtein
      : (intake.proteinSource === 'special' ? 0 : protein);
    const specialProtein = typeof intake.specialProtein === 'number'
      ? intake.specialProtein
      : (intake.proteinSource === 'special' ? protein : 0);

    if (intake.type === 'milk') {
      const quantity = parseFloat(intake.quantity) || 0;
      const isSpecial = intake.proteinSource === 'special' || intake.milkType === 'special_formula';
      const target = isSpecial ? overview.milk.special : overview.milk.normal;

      let naturalCalories = 0;
      let specialCalories = 0;
      const totalProtein = naturalProtein + specialProtein;
      if (totalProtein > 0 && calories > 0) {
        naturalCalories = calories * (naturalProtein / totalProtein);
        specialCalories = calories - naturalCalories;
      } else if (calories > 0) {
        if (isSpecial) {
          specialCalories = calories;
        } else {
          naturalCalories = calories;
        }
      }

      addMilkStats(target, {
        volume: quantity,
        calories: isSpecial ? specialCalories : naturalCalories,
        protein: isSpecial ? specialProtein : naturalProtein,
        carbs: Number(nutrition.carbs) || 0,
        fat: Number(nutrition.fat) || 0
      });
      return;
    }

    overview.food.count += 1;
    overview.food.totalCalories += calories;
    overview.food.protein += protein;
    overview.food.naturalProtein += naturalProtein;
    overview.food.specialProtein += specialProtein;
    overview.food.carbs += Number(nutrition.carbs) || 0;
    overview.food.fat += Number(nutrition.fat) || 0;
  });

  overview.milk.normal = {
    volume: roundNumber(overview.milk.normal.volume, 2),
    calories: roundCalories(overview.milk.normal.calories),
    protein: roundNumber(overview.milk.normal.protein, 2),
    carbs: roundNumber(overview.milk.normal.carbs, 2),
    fat: roundNumber(overview.milk.normal.fat, 2),
    coefficient: ''
  };
  overview.milk.special = {
    volume: roundNumber(overview.milk.special.volume, 2),
    calories: roundCalories(overview.milk.special.calories),
    protein: roundNumber(overview.milk.special.protein, 2),
    carbs: roundNumber(overview.milk.special.carbs, 2),
    fat: roundNumber(overview.milk.special.fat, 2),
    coefficient: ''
  };
  overview.milk.totalCalories = roundCalories(
    (overview.milk.normal.calories || 0) + (overview.milk.special.calories || 0)
  );

  const parsedWeight = parseFloat(weight) || 0;
  if (parsedWeight > 0) {
    overview.milk.normal.coefficient = roundNumber(overview.milk.normal.protein / parsedWeight, 2);
    overview.milk.special.coefficient = roundNumber(overview.milk.special.protein / parsedWeight, 2);
  }

  overview.food.totalCalories = roundCalories(overview.food.totalCalories);
  overview.food.protein = roundNumber(overview.food.protein, 2);
  overview.food.naturalProtein = roundNumber(overview.food.naturalProtein, 2);
  overview.food.specialProtein = roundNumber(overview.food.specialProtein, 2);
  overview.food.carbs = roundNumber(overview.food.carbs, 2);
  overview.food.fat = roundNumber(overview.food.fat, 2);

  return mergeTreatmentIntoOverview(overview, treatmentRecords);
}

function normalizeIntakes(intakes = []) {
  if (!Array.isArray(intakes)) return [];

  return intakes
    .map(item => {
      if (!item) return null;
      const nutrition = item.nutrition || {};
      const proteinSource = item.proteinSource || (item.milkType === 'special_formula' ? 'special' : 'natural');
      const recordedAt = item.recordedAt || formatTimeFromDate(item.createdAt);
      const rawCategory =
        item.category || (item.type === 'milk' || item.milkType ? 'milk' : '');
      const normalizedCategory = rawCategory || '辅食';
      const hasProtein = Number(nutrition.protein) > 0;
      const milkLike = isMilkCategory(normalizedCategory) || item.type === 'milk' || !!item.milkType;
      const inferredType = !!item.milkType || (milkLike && hasProtein) ? 'milk' : 'food';
      let resolvedType = item.foodType || item.type || inferredType;
      if (!item.foodType && !item.milkType && item.type === 'milk' && !hasProtein) {
        resolvedType = 'food';
      }

      return {
        ...item,
        type: resolvedType === 'milk' ? 'milk' : 'food',
        foodType: resolvedType,
        category: normalizedCategory,
        recordedAt,
        nutrition: {
          calories: roundCalories(Number(nutrition.calories) || 0),
          protein: Number(nutrition.protein) || 0,
          carbs: Number(nutrition.carbs) || 0,
          fat: Number(nutrition.fat) || 0,
          fiber: Number(nutrition.fiber) || 0,
          sodium: Number(nutrition.sodium) || 0
        },
        naturalProtein: typeof item.naturalProtein === 'number' ? item.naturalProtein : null,
        specialProtein: typeof item.specialProtein === 'number' ? item.specialProtein : null,
        proteinSource
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const timeA = (a.recordedAt || '').replace(':', '');
      const timeB = (b.recordedAt || '').replace(':', '');
      return timeB.localeCompare(timeA);
    });
}

function groupFoodIntakesByMeal(intakes = []) {
  if (!Array.isArray(intakes) || intakes.length === 0) return [];

  const groups = new Map();

  intakes.forEach((intake, index) => {
    if (!intake || intake.type === 'milk' || !intake.mealBatchId) return;

    const mealTime = intake.mealTime || intake.recordedAt || '--:--';
    const groupKey = intake.mealBatchId
      ? `meal:${intake.mealBatchId}`
      : `single:${intake._id || `${intake.foodId || intake.nameSnapshot || 'food'}_${index}`}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: groupKey,
        mealBatchId: intake.mealBatchId || '',
        mealLabel: intake.mealLabel || '食物记录',
        mealTime,
        mealNote: intake.mealNote || '',
        sortKey: Number(String(mealTime).replace(':', '')) || 0,
        itemCount: 0,
        summary: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        },
        items: []
      });
    }

    const group = groups.get(groupKey);
    const nutrition = intake.nutrition || {};

    group.items.push({
      ...intake,
      originalIndex: index
    });
    group.itemCount += 1;
    group.summary.calories += Number(nutrition.calories) || 0;
    group.summary.protein += Number(nutrition.protein) || 0;
    group.summary.carbs += Number(nutrition.carbs) || 0;
    group.summary.fat += Number(nutrition.fat) || 0;

    if (!group.mealNote && intake.mealNote) {
      group.mealNote = intake.mealNote;
    }
  });

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      expanded: false,
      summary: {
        calories: roundCalories(group.summary.calories),
        protein: roundNumber(group.summary.protein, 2),
        carbs: roundNumber(group.summary.carbs, 2),
        fat: roundNumber(group.summary.fat, 2)
      },
      items: group.items.sort((a, b) => {
        const timeA = String(a.recordedAt || '').replace(':', '');
        const timeB = String(b.recordedAt || '').replace(':', '');
        return timeB.localeCompare(timeA);
      })
    }))
    .sort((a, b) => b.sortKey - a.sortKey);
}

function getLegacyFoodIntakes(intakes = []) {
  if (!Array.isArray(intakes) || intakes.length === 0) return [];

  return intakes.reduce((result, intake, index) => {
    if (!intake || intake.type === 'milk' || intake.mealBatchId) return result;
    result.push({
      ...intake,
      originalIndex: index
    });
    return result;
  }, []);
}

function calculateMacroSummary(intakes = [], feedings = [], nutritionSettings = {}, treatmentRecords = []) {
  const summary = {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    carbs: 0,
    fat: 0
  };

  (intakes || []).forEach(intake => {
    const nutrition = intake.nutrition || {};
    const protein = Number(nutrition.protein) || 0;
    const naturalProtein = typeof intake.naturalProtein === 'number'
      ? intake.naturalProtein
      : (intake.proteinSource === 'special' ? 0 : protein);
    const specialProtein = typeof intake.specialProtein === 'number'
      ? intake.specialProtein
      : (intake.proteinSource === 'special' ? protein : 0);

    summary.calories += Number(nutrition.calories) || 0;
    summary.protein += protein;
    summary.naturalProtein += naturalProtein;
    summary.specialProtein += specialProtein;
    summary.carbs += Number(nutrition.carbs) || 0;
    summary.fat += Number(nutrition.fat) || 0;
  });

  // 聚合奶量后再计算，避免逐条舍入导致的总量偏差
  let totalNaturalVolumeBreast = 0;
  let totalNaturalVolumeFormula = 0;
  let totalSpecialVolume = 0;
  (feedings || []).forEach(feeding => {
    const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
    const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
    const naturalTypeRaw = feeding.naturalMilkType || 'breast';
    const naturalType = naturalTypeRaw === 'breast' ? 'breast' : 'formula';
    if (naturalVolume > 0) {
      if (naturalType === 'formula') {
        totalNaturalVolumeFormula += naturalVolume;
      } else {
        totalNaturalVolumeBreast += naturalVolume;
      }
    }
    if (specialVolume > 0) {
      totalSpecialVolume += specialVolume;
    }
  });

  if (totalNaturalVolumeBreast > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: totalNaturalVolumeBreast,
      naturalMilkType: 'breast',
      specialMilkVolume: 0,
      specialMilkPowder: 0
    }, nutritionSettings);
    summary.calories += nutrition.calories;
    summary.protein += nutrition.protein;
    summary.naturalProtein += nutrition.naturalProtein;
    summary.specialProtein += nutrition.specialProtein;
    summary.carbs += nutrition.carbs;
    summary.fat += nutrition.fat;
  }

  if (totalNaturalVolumeFormula > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: totalNaturalVolumeFormula,
      naturalMilkType: 'formula',
      specialMilkVolume: 0,
      specialMilkPowder: 0
    }, nutritionSettings);
    summary.calories += nutrition.calories;
    summary.protein += nutrition.protein;
    summary.naturalProtein += nutrition.naturalProtein;
    summary.specialProtein += nutrition.specialProtein;
    summary.carbs += nutrition.carbs;
    summary.fat += nutrition.fat;
  }

  if (totalSpecialVolume > 0) {
    const specialPowder = calculateSpecialMilkPowder(totalSpecialVolume, nutritionSettings);
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: 'breast',
      specialMilkVolume: totalSpecialVolume,
      specialMilkPowder: specialPowder
    }, nutritionSettings);
    summary.calories += nutrition.calories;
    summary.protein += nutrition.protein;
    summary.naturalProtein += nutrition.naturalProtein;
    summary.specialProtein += nutrition.specialProtein;
    summary.carbs += nutrition.carbs;
    summary.fat += nutrition.fat;
  }

  summary.calories = roundCalories(summary.calories);
  summary.protein = roundNumber(summary.protein, 2);
  summary.naturalProtein = roundNumber(summary.naturalProtein, 2);
  summary.specialProtein = roundNumber(summary.specialProtein, 2);
  summary.carbs = roundNumber(summary.carbs, 2);
  summary.fat = roundNumber(summary.fat, 2);

  return mergeTreatmentIntoMacroSummary(summary, treatmentRecords);
}

function formatTimeFromDate(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string' && dateInput.includes(':')) {
    return dateInput;
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function toDateKey(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return '';
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildDateTimeFromDateKey(dateKey, timeValue = '00:00') {
  const safeDateKey = toDateKey(dateKey);
  if (!safeDateKey) return null;
  const [year, month, day] = safeDateKey.split('-').map(Number);
  const [hours, minutes] = (timeValue || '00:00').split(':').map(Number);
  return new Date(
    year,
    month - 1,
    day,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0
  );
}

function formatTreatmentRecords(records = []) {
  return formatTreatmentRecordsForDisplay(records);
}

function createCopyEntryId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDateTimestamp(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ts = date.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function getBasicInfoCompleteness(record = {}) {
  const basicInfo = record.basicInfo || {};
  let count = 0;
  ['weight', 'height', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient'].forEach(key => {
    const value = basicInfo[key];
    if (value !== '' && value !== null && value !== undefined) {
      count += 1;
    }
  });
  return count;
}

function scoreFeedingRecord(record = {}) {
  const feedingsCount = Array.isArray(record.feedings) ? record.feedings.length : 0;
  const intakesCount = Array.isArray(record.intakes) ? record.intakes.length : 0;
  const summaryCalories = Number(record.summary?.calories) || 0;
  const basicInfoCompleteness = getBasicInfoCompleteness(record);
  const updatedAtTs = getDateTimestamp(record.updatedAt);
  const createdAtTs = getDateTimestamp(record.createdAt);
  const dateTs = getDateTimestamp(record.date);

  // Prefer the record that actually contains daily content; timestamps only break ties.
  return (
    feedingsCount * 1000000 +
    intakesCount * 1000000 +
    summaryCalories * 100 +
    basicInfoCompleteness * 10 +
    Math.max(updatedAtTs, createdAtTs, dateTs) / 1000000000000
  );
}

function pickPrimaryFeedingRecord(records = []) {
  if (!Array.isArray(records) || records.length === 0) return null;
  return [...records].sort((a, b) => {
    const scoreDiff = scoreFeedingRecord(b) - scoreFeedingRecord(a);
    if (scoreDiff !== 0) return scoreDiff;
    const updatedDiff = getDateTimestamp(b?.updatedAt) - getDateTimestamp(a?.updatedAt);
    if (updatedDiff !== 0) return updatedDiff;
    const createdDiff = getDateTimestamp(b?.createdAt) - getDateTimestamp(a?.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return getDateTimestamp(b?.date) - getDateTimestamp(a?.date);
  })[0];
}

function mergeBasicInfoFromRecords(records = []) {
  if (!Array.isArray(records) || records.length === 0) return {};
  return [...records]
    .sort((a, b) => {
      const completenessDiff = getBasicInfoCompleteness(b) - getBasicInfoCompleteness(a);
      if (completenessDiff !== 0) return completenessDiff;
      return getDateTimestamp(b?.updatedAt) - getDateTimestamp(a?.updatedAt);
    })
    .reduce((merged, record) => {
      const basicInfo = record?.basicInfo || {};
      Object.keys(basicInfo).forEach(key => {
        const value = basicInfo[key];
        if (value !== '' && value !== null && value !== undefined && merged[key] === undefined) {
          merged[key] = value;
        }
      });
      return merged;
    }, {});
}

function dedupeIntakes(intakes = []) {
  const seen = new Set();
  return (intakes || []).filter(item => {
    if (!item) return false;
    const key = item._id || `${item.foodId || item.nameSnapshot || ''}_${item.recordedAt || ''}_${item.quantity || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeFeedingRecords(records = [], nutritionSettings = {}) {
  const primary = pickPrimaryFeedingRecord(records);
  if (!primary) return null;

  const mergedFeedings = records.flatMap(record => Array.isArray(record?.feedings) ? record.feedings : []);
  const mergedIntakes = dedupeIntakes(records.flatMap(record => Array.isArray(record?.intakes) ? record.intakes : []));
  const mergedBasicInfo = mergeBasicInfoFromRecords(records);
  const mergedSummary = calculateMacroSummary(mergedIntakes, mergedFeedings, nutritionSettings);

  return {
    ...primary,
    basicInfo: mergedBasicInfo,
    feedings: mergedFeedings,
    intakes: mergedIntakes,
    summary: mergedSummary
  };
}

function cloneFeedingForDate(feeding = {}, selectedDate, babyUid) {
  const now = new Date();
  const startTime = feeding.startTime || formatTimeFromDate(feeding.startDateTime) || '00:00';
  const {
    formattedStartTime,
    displayTime,
    nutritionDisplay,
    createdAt,
    updatedAt,
    ...rest
  } = feeding;

  return {
    ...rest,
    startTime,
    endTime: feeding.endTime || '',
    startDateTime: buildDateTimeFromDateKey(selectedDate, startTime),
    endDateTime: null,
    babyUid: babyUid || feeding.babyUid || '',
    createdAt: now,
    updatedAt: now
  };
}

function cloneIntakeForDate(intake = {}, openid = '') {
  const now = new Date();
  const {
    _id,
    createdAt,
    updatedAt,
    createdBy,
    ...rest
  } = intake;

  return {
    ...rest,
    _id: createCopyEntryId('intake'),
    recordedAt: intake.recordedAt || formatTime(now),
    createdAt: now,
    updatedAt: now,
    createdBy: openid || createdBy || ''
  };
}

function cloneMedicationForDate(record = {}, selectedDate, babyUid) {
  const now = new Date();
  const actualTime = record.actualTime || formatTimeFromDate(record.actualDateTime) || '00:00';
  const {
    _id,
    createdAt,
    updatedAt,
    actualDateTime,
    date,
    ...rest
  } = record;

  return {
    ...rest,
    babyUid: babyUid || record.babyUid || '',
    date: buildDateTimeFromDateKey(selectedDate, '00:00'),
    actualTime,
    actualDateTime: buildDateTimeFromDateKey(selectedDate, actualTime),
    createdAt: now,
    updatedAt: now
  };
}

function calculateAgeInMonths(birthday, referenceDateStr) {
  if (!birthday) return null;
  const birthDate = new Date(birthday);
  if (isNaN(birthDate.getTime())) return null;
  const refDate = referenceDateStr ? new Date(referenceDateStr) : new Date();
  if (isNaN(refDate.getTime())) return null;
  let months = (refDate.getFullYear() - birthDate.getFullYear()) * 12 + (refDate.getMonth() - birthDate.getMonth());
  if (refDate.getDate() < birthDate.getDate()) {
    months -= 1;
  }
  return months < 0 ? 0 : months;
}

function isFutureDateKey(dateStr) {
  const target = toDateKey(dateStr);
  const today = toDateKey(new Date());
  if (!target || !today) return false;
  return target > today;
}

function parseDateKey(dateStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if ([year, month, day].some(Number.isNaN)) return new Date(dateStr);
  return new Date(year, month - 1, day);
}

Page({
  data: {
    selectedDate: '',
    formattedSelectedDate: '', // 格式化后的日期显示
    dateList: [],
    feedingRecords: [],
    intakes: [],
    foodIntakes: [],
    foodMealGroups: [],
    legacyFoodIntakes: [],
    // 食物弹窗相关
    showFoodIntakeModal: false,
    showFoodIntakeExperimentModal: false,
    foodCatalog: [],
    foodCategories: [],
    categorizedFoods: {},
    filteredFoodOptions: [],
    foodSearchQuery: '',
    foodModalMode: 'create',
    editingFoodIntakeId: '',
    editingFoodIntakeIndex: -1,
    newFoodIntake: {
      category: '',
      foodId: '',
      food: null,
      quantity: '',
      unit: '',
      nutritionPreview: null,
      proteinSource: 'natural',
      recordTime: '',
      notes: ''
    },
    foodExperiment: {
      foodId: '',
      food: null,
      quantity: '',
      unit: '',
      nutritionPreview: null,
      recordTime: '',
      notes: ''
    },
    foodExperimentSearchQuery: '',
    foodExperimentCategories: [],
    foodExperimentCategory: 'recent',
    foodExperimentStep: 'select',
    filteredFoodExperimentOptions: [],
    recentFoodOptions: [],
    intakeOverview: createEmptyIntakeOverview(),
    medicationRecords: [],
    treatmentRecords: [],
    groupedMedicationRecords: [], // 按药物名称分组的药物记录
    bowelRecords: [], // 排便记录
    groupedBowelRecords: [], // 按类型分组的排便记录
    totalNaturalMilk: 0,
    totalSpecialMilk: 0,
    totalMilk: 0,
    goalKcalRange: {
      min: 0,
      max: 0
    },
    calorieGoalPerKgRange: {
      min: 0,
      max: 0,
      label: ''
    },
    caloriePerKg: '',
    dailyCaloriesTotal: 0,
    proteinSummaryDisplay: {
      natural: '0.00',
      special: '0.00',
      total: '0.00'
    },
    // 生长数据
    weight: '--',
    height: '--',
    weightSource: 'empty',
    heightSource: 'empty',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    // 蛋白质系数
    naturalProteinCoefficient: 0, // 天然蛋白系数 g/kg
    specialProteinCoefficient: 0, // 特殊蛋白系数 g/kg
    // 日历相关数据
    showCalendarPicker: false,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarDays: [],
    copyCalendarContext: null,
    isSelectedToday: true,
    // 滚动相关
    currentDateId: '',
    selectedDateIndex: 0,
    isReturning: false,
    showAddFeedingModal: false,
    showAddMedicationModal: false,
    showAddBowelModal: false,
    // 新增记录相关
    newFeeding: {
      startTime: '',
      naturalMilkVolume: '',
      naturalMilkType: 'breast',
      totalVolume: '',
      specialMilkVolume: 0,
      specialPowderWeight: 0,
      notes: ''
    },
    newFeedingDisplay: null,
    newMedication: {
      name: '',
      dosage: '',
      unit: '',
      time: '',
      notes: ''
    },
    selectedMedicationIndex: 0,
    newBowelRecord: {
      time: '',
      type: 'stool',
      consistency: '',
      color: '',
      smell: '',
      amount: '',
      notes: ''
    },
    // 编辑相关
    showEditFeedingModal: false,
    showEditMedicationModal: false,
    showEditBowelModal: false,
    editingFeedingIndex: -1,
    editingMedicationIndex: -1,
    editingFeeding: null,
    editingFeedingDisplay: null,
    editingMedication: null,
    editingBowelRecord: null,
    // 其他
    medications: [], // 药物配置列表
    showDeleteConfirm: false,
    deleteConfirmMessage: '',
    deleteType: '', // 'feeding' 或 'medication'
    deleteIndex: -1,
    deleteRecordId: '', // 药物记录的ID
    todayFullDate: '', // 今日完整日期（年月日）
    babyInfo: null, // 存储宝宝基本信息
    isDataLoading: false, // 新增数据加载状态
    scrollTimer: null, // 滚动定时器
    dateRangeLength: 30, // 显示最近30天记录
    // 配奶参数设置
    nutritionSettings: null,
    needsNutritionSetup: false,
    promptingNutrition: false,
    hasShownNutritionPrompt: false,
    totalBreastMilkKcal: 0,
    totalSpecialMilkKcal: 0,
    macroSummary: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    },
    macroRatios: {
      protein: 0,
      carbs: 0,
      fat: 0
    },
    fatRatioRangeText: '',
    showFatRatioPopup: false,
    fatRatioPopupLines: [
      '0-6月: 45%-50%',
      '>6月: 35%-40%',
      '1-2岁: 30%-35%',
      '>6岁: 25%-30%'
    ],
    activeTab: 'feeding',
    summaryPreview: buildDataRecordsSummaryPreview({}),
    activeMetricInfoLabel: '',
    activeMetricInfoTitle: '',
    activeMetricInfoLines: [],
    showBasicInfoModal: false,
    editingField: '',
    editingLabel: '',
    editingUnit: '',
    editBasicInfoValue: ''
  },

  // 显示食物摄入弹窗
  showFoodIntakeModal(options = {}) {
    if (options && options.currentTarget) {
      options = options.currentTarget.dataset || {};
    }
    const preferredCategory = options.category || options.preferredCategory || '';
    if (!this.data.foodCatalog || this.data.foodCatalog.length === 0) {
      wx.showToast({
        title: '请先前往“我的-食物管理”添加食物',
        icon: 'none'
      });
      return;
    }
    const categories = this.data.foodCategories.length > 0 ? this.data.foodCategories : ['婴幼儿辅食'];
    let defaultCategory = preferredCategory || categories[0];
    let foodsInCategory = this.data.categorizedFoods[defaultCategory] || [];
    let defaultOptions = foodsInCategory.length > 0 ? foodsInCategory : this.data.foodCatalog;
    let defaultFood = defaultOptions[0] || null;
    if (!defaultFood) {
      wx.showToast({ title: '暂无可用食物，请先添加', icon: 'none' });
      return;
    }
    const recordTime = formatTime(new Date());
    this.setData({
      'newFoodIntake.category': defaultCategory,
      'newFoodIntake.foodId': defaultFood?._id || '',
      'newFoodIntake.food': defaultFood || null,
      'newFoodIntake.quantity': '',
      'newFoodIntake.unit': this._getFoodUnit(defaultFood),
      'newFoodIntake.nutritionPreview': null,
      'newFoodIntake.proteinSource': defaultFood?.proteinSource || 'natural',
      'newFoodIntake.recordTime': recordTime,
      'newFoodIntake.notes': '',
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1,
      foodSearchQuery: '',
      filteredFoodOptions: this.data.foodCatalog,
      showFoodIntakeModal: true
    }, () => {
      this.filterFoodOptions('');
    });
  },

  hideFoodIntakeModal() {
    this.setData({
      showFoodIntakeModal: false,
      newFoodIntake: {
        category: '',
        foodId: '',
        food: null,
        quantity: '',
        unit: '',
        nutritionPreview: null,
        proteinSource: 'natural',
        recordTime: '',
        notes: ''
      },
      foodSearchQuery: '',
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1
    }, () => {
      this.filterFoodOptions('');
    });
  },

  showFoodIntakeExperimentModal() {
    if (!this.data.foodCatalog || this.data.foodCatalog.length === 0) {
      wx.showToast({
        title: '请先前往“我的-食物管理”添加食物',
        icon: 'none'
      });
      return;
    }
    const recordTime = formatTime(new Date());
    this.setData({
      foodExperiment: {
        foodId: '',
        food: null,
        quantity: '',
        unit: '',
        nutritionPreview: null,
        recordTime: recordTime,
        notes: ''
      },
      foodExperimentSearchQuery: '',
      foodExperimentStep: 'select',
      filteredFoodExperimentOptions: this.data.foodCatalog,
      showFoodIntakeExperimentModal: true
    }, () => {
      this.loadRecentFoodOptions().then(() => {
        this.initFoodExperimentCategories(true);
        this.filterFoodExperimentOptions('');
      });
    });
  },

  navigateToMealEditor() {
    const selectedDate = this.data.selectedDate || this.formatDate(new Date());
    wx.navigateTo({
      url: `/pages/meal-editor/index?date=${selectedDate}&from=records`
    });
  },

  navigateToTreatmentRecord() {
    const selectedDate = this.data.selectedDate || this.formatDate(new Date());
    wx.navigateTo({
      url: `/pages/treatment-record/index?date=${selectedDate}`
    });
  },

  openEditTreatmentRecord(e) {
    const recordId = e.currentTarget?.dataset?.recordId || e.detail?.recordId;
    const selectedDate = this.data.selectedDate || this.formatDate(new Date());
    if (!recordId) return;
    wx.navigateTo({
      url: `/pages/treatment-record/index?id=${encodeURIComponent(recordId)}&date=${selectedDate}`
    });
  },

  deleteTreatmentRecord(e) {
    const recordId = e.currentTarget?.dataset?.recordId || e.detail?.recordId;
    if (!recordId) return;
    wx.showModal({
      title: '删除治疗记录',
      content: '确认删除这条治疗记录吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          const result = await TreatmentRecordModel.delete(recordId);
          if (!result.success) {
            throw new Error(result.message || '删除失败');
          }
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.fetchDailyRecords(this.data.selectedDate, { silent: true });
        } catch (error) {
          wx.hideLoading();
          console.error('删除治疗记录失败:', error);
          wx.showToast({ title: error.message || '删除失败', icon: 'none' });
        }
      }
    });
  },

  navigateToMealGroupEditor(e) {
    const mealBatchId = e.currentTarget.dataset.mealBatchId;
    const selectedDate = this.data.selectedDate || this.formatDate(new Date());
    if (!mealBatchId) return;
    wx.navigateTo({
      url: `/pages/meal-editor/index?date=${selectedDate}&from=records&mealBatchId=${encodeURIComponent(mealBatchId)}`
    });
  },

  async deleteMealGroup(e) {
    const { mealBatchId, mealLabel, itemCount } = e.currentTarget.dataset || {};
    if (!mealBatchId) {
      wx.showToast({ title: '餐次不存在', icon: 'none' });
      return;
    }

    const label = mealLabel || '本顿食物';
    const count = Number(itemCount) || 0;
    const remainingIntakes = (this.data.intakes || []).filter(item => item.mealBatchId !== mealBatchId);
    if (remainingIntakes.length === (this.data.intakes || []).length) {
      wx.showToast({ title: '未找到可删除的食物', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: `确定要删除${label}${count ? `（${count}项食物）` : ''}吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          const db = wx.cloud.database();
          const updatedSummary = calculateMacroSummary(remainingIntakes, this.data.feedings, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
          const updatedOverview = calculateIntakeOverview(this.data.feedings || [], remainingIntakes, this.data.weight, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);

          if (this.data.recordId) {
            await db.collection('feeding_records').doc(this.data.recordId).update({
              data: {
                intakes: remainingIntakes,
                summary: updatedSummary,
                updatedAt: db.serverDate()
              }
            });
          }

          this.setData({
            intakes: remainingIntakes,
            foodIntakes: remainingIntakes.filter(item => item.type !== 'milk'),
            foodMealGroups: groupFoodIntakesByMeal(remainingIntakes.filter(item => item.type !== 'milk')),
            legacyFoodIntakes: getLegacyFoodIntakes(remainingIntakes.filter(item => item.type !== 'milk')),
            macroSummary: updatedSummary,
            macroRatios: this.computeMacroRatios(updatedSummary),
            intakeOverview: updatedOverview
          });

          wx.hideLoading();
          wx.showToast({ title: '本顿已删除', icon: 'success' });
          await this.fetchDailyRecords(this.data.selectedDate, { silent: true });
        } catch (error) {
          console.error('删除本顿食物失败:', error);
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  hideFoodIntakeExperimentModal() {
    this.setData({
      showFoodIntakeExperimentModal: false,
      foodExperiment: {
        foodId: '',
        food: null,
        quantity: '',
        unit: '',
        nutritionPreview: null,
        recordTime: '',
        notes: ''
      },
      foodExperimentSearchQuery: '',
      foodExperimentCategories: [],
      foodExperimentCategory: 'recent',
      foodExperimentStep: 'select',
      filteredFoodExperimentOptions: [],
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1,
      recentFoodOptions: []
    });
  },

  initFoodExperimentCategories(preserveSelection = false) {
    const catalog = this.data.foodCatalog || [];
    const categorySet = new Set();
    catalog.forEach(food => {
      if (food.category) categorySet.add(food.category);
    });
    const categories = Array.from(categorySet)
      .sort((a, b) => a.localeCompare(b))
      .map(category => ({ value: category, label: category }));
    const list = [{ value: 'recent', label: '最近' }, ...categories];
    const current = preserveSelection ? (this.data.foodExperimentCategory || '') : '';
    const availableValues = new Set(list.map(item => item.value));
    const nextCategory = current && availableValues.has(current) ? current : 'recent';
    this.setData({
      foodExperimentCategories: list,
      foodExperimentCategory: nextCategory
    });
  },

  getRecentFoodExperimentOptions(limit = MAX_RECENT_FOODS) {
    return (this.data.recentFoodOptions || []).slice(0, limit);
  },

  async loadRecentFoodOptions() {
    const babyUid = getBabyUid();
    if (!babyUid) return;
    try {
      const db = wx.cloud.database();
      const recordRes = await db.collection('feeding_records')
        .where({ babyUid })
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      const catalog = this.data.foodCatalog || [];
      const foodMap = new Map(catalog.map(food => [food._id, food]));
      const result = [];
      const seen = new Set();
      for (const record of recordRes.data || []) {
        const intakes = record?.intakes || [];
        for (const intake of intakes) {
          if (!intake || intake.type === 'milk') continue;
          const foodId = intake.foodId;
          if (!foodId || seen.has(foodId)) continue;
          const food = foodMap.get(foodId);
          if (!food) continue;
          seen.add(foodId);
          result.push(food);
          if (result.length >= MAX_RECENT_FOODS) break;
        }
        if (result.length >= MAX_RECENT_FOODS) break;
      }
      this.setData({ recentFoodOptions: result });
    } catch (error) {
      console.error('加载最近食物失败:', error);
      this.setData({ recentFoodOptions: [] });
    }
  },

  filterFoodExperimentOptions(query = this.data.foodExperimentSearchQuery || '') {
    const normalized = (query || '').trim().toLowerCase();
    const catalog = this.data.foodCatalog || [];
    const currentCategory = this.data.foodExperimentCategory || 'recent';
    let baseList = [];

    if (normalized) {
      baseList = catalog;
    } else if (currentCategory === 'recent') {
      baseList = this.getRecentFoodExperimentOptions();
      if (!baseList.length) {
        this.loadRecentFoodOptions().then(() => {
          this.filterFoodExperimentOptions(query);
        });
        return;
      }
    } else {
      baseList = catalog.filter(food => (food.category || '').toString().trim() === currentCategory);
    }

    const filtered = normalized
      ? baseList.filter(food => {
          const name = (food.name || '').toLowerCase();
          const category = (food.category || '').toLowerCase();
          const alias = (food.aliasText || '').toLowerCase();
          return name.includes(normalized) || category.includes(normalized) || alias.includes(normalized);
        })
      : baseList;

    this.setData({ filteredFoodExperimentOptions: filtered });
  },

  onFoodExperimentSearchInput(e) {
    const query = e.detail.value || '';
    this.setData({ foodExperimentSearchQuery: query });
    this.filterFoodExperimentOptions(query);
  },

  onFoodExperimentCategorySelect(e) {
    const { category } = e.detail;
    if (!category) return;
    this.setData({
      foodExperimentCategory: category,
      'foodExperiment.foodId': '',
      'foodExperiment.food': null,
      'foodExperiment.quantity': '',
      'foodExperiment.unit': '',
      'foodExperiment.nutritionPreview': null
    }, () => {
      this.filterFoodExperimentOptions(this.data.foodExperimentSearchQuery || '');
    });
  },

  onFoodExperimentFoodSelect(e) {
    const { id } = e.detail;
    const selectedFood = (this.data.foodCatalog || []).find(food => food._id === id);
    if (!selectedFood) return;
    this.setData({
      'foodExperiment.foodId': selectedFood._id,
      'foodExperiment.food': selectedFood,
      'foodExperiment.quantity': '',
      'foodExperiment.unit': this._getFoodUnit(selectedFood),
      'foodExperiment.nutritionPreview': null,
      'foodExperiment.recordTime': this.data.foodExperiment.recordTime || formatTime(new Date())
    });
  },

  confirmFoodExperimentSelection() {
    if (!this.data.foodExperiment.foodId) {
      wx.showToast({ title: '请选择食物', icon: 'none' });
      return;
    }
    this.setData({ foodExperimentStep: 'form' });
  },

  backToFoodExperimentSelection() {
    this.setData({ foodExperimentStep: 'select' });
  },

  handleFoodExperimentFormCancel() {
    const isEdit = this.data.foodModalMode === 'edit' && this.data.editingFoodIntakeId;
    if (isEdit) {
      this.hideFoodIntakeExperimentModal();
      return;
    }
    this.backToFoodExperimentSelection();
  },

  onFoodExperimentQuantityInput(e) {
    const quantity = e.detail.value;
    this.setData({
      'foodExperiment.quantity': quantity
    }, () => {
      this.updateFoodExperimentPreview();
    });
  },

  updateFoodExperimentPreview() {
    const { food, quantity } = this.data.foodExperiment;
    if (!food || !quantity) {
      this.setData({ 'foodExperiment.nutritionPreview': null });
      return;
    }
    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      this.setData({ 'foodExperiment.nutritionPreview': null });
      return;
    }
    const nutritionPreview = FoodModel.calculateNutrition(food, numQuantity);
    this.setData({ 'foodExperiment.nutritionPreview': nutritionPreview });
  },

  onFoodExperimentRecordTimeChange(e) {
    this.setData({
      'foodExperiment.recordTime': e.detail.value
    });
  },

  onFoodExperimentNotesInput(e) {
    this.setData({
      'foodExperiment.notes': e.detail.value
    });
  },

  async saveFoodIntakeExperiment() {
    const { foodId, food, quantity, recordTime, nutritionPreview, notes } = this.data.foodExperiment;
    if (!foodId || !food) {
      wx.showToast({ title: '请选择食物', icon: 'none' });
      return;
    }
    const unit = this._getFoodUnit(food);
    const isEdit = this.data.foodModalMode === 'edit' && this.data.editingFoodIntakeId;
    this.setData({
      newFoodIntake: {
        category: food.category || '',
        foodId: foodId,
        food: food,
        quantity: quantity,
        unit: unit,
        nutritionPreview: nutritionPreview,
        proteinSource: food.proteinSource || 'natural',
        recordTime: recordTime,
        notes: notes || ''
      },
      ...(isEdit ? {} : {
        foodModalMode: 'create',
        editingFoodIntakeId: '',
        editingFoodIntakeIndex: -1
      })
    }, async () => {
      await this.saveFoodIntake();
      this.hideFoodIntakeExperimentModal();
    });
  },

  openFoodManage() {
    wx.navigateTo({
      url: '/pages/food-management/index'
    });
  },

  async loadFoodCatalog() {
    try {
      const babyUid = getBabyUid();
      const remoteFoods = await FoodModel.getAvailableFoods(babyUid);
      const combinedFoods = (remoteFoods || [])
        .filter(item => !!item && !!item._id)
        .map(food => {
          const normalizedCategory = this.normalizeFoodCategoryValue(
            food.category || food.categoryLevel1
          );
          const aliasText = food.aliasText ||
            (Array.isArray(food.alias) ? food.alias.join(' / ') : (food.alias || ''));
          return {
            ...food,
            category: normalizedCategory,
            categoryLevel1: normalizedCategory,
            categoryLevel2: food.categoryLevel2 || '',
            isSystem: !!food.isSystem,
            aliasText
          };
        });

      const categorizedFoods = {};
      const categorySet = new Set();

      combinedFoods.forEach(food => {
        const category = food.category || '婴幼儿辅食';
        if (!categorizedFoods[category]) {
          categorizedFoods[category] = [];
        }
        categorizedFoods[category].push(food);
        categorySet.add(category);
      });

      Object.keys(categorizedFoods).forEach(category => {
        categorizedFoods[category] = categorizedFoods[category].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      });

      const foodCategories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));

      this.setData({
        foodCatalog: combinedFoods,
        categorizedFoods,
        foodCategories
      }, () => {
        this.filterFoodOptions(this.data.foodSearchQuery || '');
        this.loadRecentFoodOptions();
      });
    } catch (error) {
      console.error('加载食物库失败:', error);
      this.setData({
        foodCatalog: [],
        foodCategories: [],
        categorizedFoods: {}
      }, () => {
        this.filterFoodOptions(this.data.foodSearchQuery || '');
      });
    }
  },

  normalizeFoodCategoryValue(category) {
    const text = (category || '').toString().trim();
    if (!text) return '婴幼儿辅食';
    const lower = text.toLowerCase();
    if (lower === 'milk' || text === '奶类') return '乳类及制品';
    if (lower === 'food') return '主食及谷薯';
    if (text === '辅食') return '婴幼儿辅食';
    return text;
  },

  _getFoodUnit(food) {
    if (!food) return 'g';
    return food.baseUnit || (food.isLiquid ? 'ml' : 'g');
  },

  filterFoodOptions(query = this.data.foodSearchQuery || '') {
    const normalized = (query || '').trim().toLowerCase();
    const catalog = this.data.foodCatalog || [];
    const filtered = normalized
      ? catalog.filter(food => {
          const name = (food.name || '').toLowerCase();
          const category = (food.category || '').toLowerCase();
          const alias = (food.aliasText || '').toLowerCase();
          return name.includes(normalized) || category.includes(normalized) || alias.includes(normalized);
        })
      : catalog;
    this.setData({ filteredFoodOptions: filtered });
  },

  onFoodSearchInput(e) {
    const value = e.detail.value || '';
    this.setData({ foodSearchQuery: value });
    this.filterFoodOptions(value);
  },

  onFoodSelect(e) {
    const id = e.currentTarget.dataset.id;
    const selectedFood = (this.data.foodCatalog || []).find(food => food._id === id);
    if (!selectedFood) return;
    this.setData({
      'newFoodIntake.category': selectedFood.category || '',
      'newFoodIntake.foodId': selectedFood._id,
      'newFoodIntake.food': selectedFood,
      'newFoodIntake.quantity': '',
      'newFoodIntake.unit': this._getFoodUnit(selectedFood),
      'newFoodIntake.nutritionPreview': null,
      'newFoodIntake.proteinSource': selectedFood.proteinSource || 'natural'
    });
  },

  onFoodQuantityInput(e) {
    const quantity = e.detail.value;
    this.setData({
      'newFoodIntake.quantity': quantity
    }, () => {
      const { food } = this.data.newFoodIntake;
      const numQuantity = parseFloat(quantity);
      if (!food || isNaN(numQuantity) || numQuantity <= 0) {
        this.setData({ 'newFoodIntake.nutritionPreview': null });
        return;
      }
      const nutritionPreview = FoodModel.calculateNutrition(food, numQuantity);
      this.setData({ 'newFoodIntake.nutritionPreview': nutritionPreview });
    });
  },

  onFoodRecordTimeChange(e) {
    this.setData({
      'newFoodIntake.recordTime': e.detail.value
    });
  },

  onFoodNotesInput(e) {
    this.setData({
      'newFoodIntake.notes': e.detail.value
    });
  },

  openEditFoodModal(e) {
    const { index, id } = e.currentTarget.dataset;
    const foodIntakes = this.data.foodIntakes || [];
    let targetIndex = typeof index === 'number' ? index : -1;
    if (id) {
      const foundIndex = foodIntakes.findIndex(item => item._id === id);
      if (foundIndex !== -1) {
        targetIndex = foundIndex;
      }
    }
    const target = foodIntakes[targetIndex];
    if (!target) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    const catalogFood = (this.data.foodCatalog || []).find(food => food._id === target.foodId);
    const selectedFood = catalogFood || {
      _id: target.foodId || '',
      name: target.nameSnapshot,
      baseUnit: target.unit || 'g',
      category: target.category || '',
      proteinSource: target.proteinSource || 'natural',
      milkType: target.milkType || '',
      nutritionSource: target.milkType ? 'babySettings' : '',
      aliasText: target.aliasText || ''
    };
    const recordTime = target.recordedAt || formatTime(new Date());
    this.setData({
      foodModalMode: 'edit',
      editingFoodIntakeId: target._id,
      editingFoodIntakeIndex: targetIndex,
      foodExperiment: {
        foodId: selectedFood._id,
        food: selectedFood,
        quantity: target.quantity,
        unit: target.unit || this._getFoodUnit(selectedFood),
        nutritionPreview: target.nutrition || null,
        recordTime: recordTime,
        notes: target.notes || ''
      },
      foodExperimentSearchQuery: '',
      foodExperimentStep: 'form',
      foodExperimentCategory: (selectedFood.category || target.category || '').toString().trim() || 'recent',
      showFoodIntakeExperimentModal: true
    }, () => {
      this.initFoodExperimentCategories(true);
      this.filterFoodExperimentOptions('');
    });
  },

  async deleteFoodIntake(e) {
    const { index, id } = e.currentTarget.dataset;
    const foodIntakes = this.data.foodIntakes || [];
    let targetIndex = typeof index === 'number' ? index : -1;
    if (id) {
      const foundIndex = foodIntakes.findIndex(item => item._id === id);
      if (foundIndex !== -1) {
        targetIndex = foundIndex;
      }
    }
    const target = foodIntakes[targetIndex];
    if (!target) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 ${target.nameSnapshot || '该食物'} 记录吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          const db = wx.cloud.database();
          const remainingIntakes = (this.data.intakes || []).filter(item => item._id !== target._id);
          const updatedSummary = calculateMacroSummary(remainingIntakes, this.data.feedings, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
          const updatedOverview = calculateIntakeOverview(this.data.feedings || [], remainingIntakes, this.data.weight, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
          if (this.data.recordId) {
            await db.collection('feeding_records').doc(this.data.recordId).update({
              data: {
                intakes: remainingIntakes,
                summary: updatedSummary,
                updatedAt: db.serverDate()
              }
            });
          }
          this.setData({
            intakes: remainingIntakes,
            foodIntakes: remainingIntakes.filter(item => item.type !== 'milk'),
            foodMealGroups: groupFoodIntakesByMeal(remainingIntakes.filter(item => item.type !== 'milk')),
            legacyFoodIntakes: getLegacyFoodIntakes(remainingIntakes.filter(item => item.type !== 'milk')),
            macroSummary: updatedSummary,
            macroRatios: this.computeMacroRatios(updatedSummary),
            intakeOverview: updatedOverview
          });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.fetchDailyRecords(this.data.selectedDate, { silent: true });
        } catch (error) {
          console.error('删除食物记录失败:', error);
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  toggleFoodMealGroup(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;

    const nextGroups = (this.data.foodMealGroups || []).map(group => (
      group.id === id ? { ...group, expanded: !group.expanded } : group
    ));

    this.setData({ foodMealGroups: nextGroups });
  },

  async saveFoodIntake() {
    const { foodId, food, quantity, recordTime, nutritionPreview, proteinSource, notes } = this.data.newFoodIntake;
    if (!foodId || !food) {
      wx.showToast({ title: '请选择食物', icon: 'none' });
      return;
    }
    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      wx.showToast({ title: '请输入有效的重量', icon: 'none' });
      return;
    }
    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }
    let nutrition = nutritionPreview || FoodModel.calculateNutrition(food, numQuantity);
    const protein = Number(nutrition.protein) || 0;
    let naturalProtein = protein;
    let specialProtein = 0;
    if (proteinSource === 'special') {
      specialProtein = protein;
      naturalProtein = 0;
    } else if (proteinSource === 'mixed' && food.proteinSplit) {
      const naturalRatio = Number(food.proteinSplit.natural) || 0;
      const specialRatio = Number(food.proteinSplit.special) || 0;
      const totalRatio = naturalRatio + specialRatio || 1;
      naturalProtein = protein * (naturalRatio / totalRatio);
      specialProtein = protein * (specialRatio / totalRatio);
    }
    const categoryValue = (food.category && String(food.category).trim()) || '';
    const foodType = 'food';
    const isMilk = foodType === 'milk';
    const now = new Date();
    const recordTimeValue = recordTime || formatTime(now);
    const intake = {
      _id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: isMilk ? 'milk' : 'food',
      foodType: foodType,
      category: categoryValue || (isMilk ? '奶类' : '辅食'),
      foodId: foodId,
      nameSnapshot: food.name,
      unit: food.baseUnit || 'g',
      quantity: numQuantity,
      proteinSource,
      nutrition: {
        calories: roundCalories(Number(nutrition.calories) || 0),
        protein: roundNumber(Number(nutrition.protein) || 0, 2),
        carbs: roundNumber(Number(nutrition.carbs) || 0, 2),
        fat: roundNumber(Number(nutrition.fat) || 0, 2),
        fiber: roundNumber(Number(nutrition.fiber) || 0, 2),
        sodium: roundNumber(Number(nutrition.sodium) || 0, 2)
      },
      naturalProtein: roundNumber(naturalProtein, 2),
      specialProtein: roundNumber(specialProtein, 2),
      milkType: food.milkType || '',
      recordedAt: recordTimeValue,
      createdAt: now,
      updatedAt: now,
      createdBy: wx.getStorageSync('openid') || ''
    };
    intake.notes = String(notes || '').trim();

    const isEdit = this.data.foodModalMode === 'edit' && this.data.editingFoodIntakeId;
    try {
      wx.showLoading({ title: '保存中...' });
      const db = wx.cloud.database();
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const recordDate = new Date(year, month - 1, day);

      let recordId = this.data.recordId;
      let existingIntakes = [...this.data.intakes];
      if (isEdit) {
        const targetIndex = existingIntakes.findIndex(item => item._id === this.data.editingFoodIntakeId);
        if (targetIndex === -1) {
          wx.hideLoading();
          wx.showToast({ title: '记录不存在', icon: 'none' });
          return;
        }
        const original = existingIntakes[targetIndex];
        existingIntakes[targetIndex] = {
          ...original,
          ...intake,
          _id: original._id,
          createdAt: original.createdAt || intake.createdAt,
          createdBy: original.createdBy || intake.createdBy
        };
      } else {
        existingIntakes.unshift(intake);
      }

      const updatedSummary = calculateMacroSummary(existingIntakes, this.data.feedings, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
      const updatedOverview = calculateIntakeOverview(this.data.feedings || [], existingIntakes, this.data.weight, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);

      if (recordId) {
        await db.collection('feeding_records').doc(recordId).update({
          data: {
            intakes: existingIntakes,
            summary: updatedSummary,
            updatedAt: db.serverDate()
          }
        });
      } else {
        const result = await db.collection('feeding_records').add({
          data: {
            date: recordDate,
            feedings: [],
            intakes: existingIntakes,
            medicationRecords: [],
            summary: updatedSummary,
            babyUid: babyUid,
            basicInfo: this.buildPersistedBasicInfoForDate({}, this.data.selectedDate),
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        recordId = result._id;
        this.setData({ recordId });
      }

      wx.hideLoading();
      wx.showToast({ title: isEdit ? '修改成功' : '添加成功', icon: 'success' });
      this.setData({
        intakes: existingIntakes,
        foodIntakes: existingIntakes.filter(item => item.type !== 'milk'),
        foodMealGroups: groupFoodIntakesByMeal(existingIntakes.filter(item => item.type !== 'milk')),
        legacyFoodIntakes: getLegacyFoodIntakes(existingIntakes.filter(item => item.type !== 'milk')),
        macroSummary: updatedSummary,
        macroRatios: this.computeMacroRatios(updatedSummary),
        intakeOverview: updatedOverview
      });

      this.loadRecentFoodOptions();
      this.hideFoodIntakeModal();
      await this.fetchDailyRecords(this.data.selectedDate, { silent: true });
    } catch (error) {
      console.error('保存食物摄入失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  onLoad: function() {
    // 确保云环境已初始化
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        traceUser: true,
      });
    }

    this.initDateList();

    // 获取并格式化今天的日期
    const today = new Date();
    const formattedDate = this.formatDate(today);

    // 格式化今日完整日期显示（年月日）
    const todayFullDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

    this.setData({
      selectedDate: formattedDate,
      formattedSelectedDate: this.formatDisplayDate(formattedDate),
      currentDateId: 'date-0',
      selectedDateIndex: 0,
      todayFullDate: todayFullDate,
      isSelectedToday: true
    });

    this.initCalendar(today.getFullYear(), today.getMonth() + 1);

    // 等待应用初始化完成后再加载数据
    this.initializePage(formattedDate);
  },

  async initializePage(formattedDate) {
    try {
      wx.showLoading({ title: '加载中...', mask: true });

      await waitForAppInitialization();

      const hasPermission = await checkUserPermission();
      if (!hasPermission) {
        wx.hideLoading();
        wx.showModal({
          title: '权限不足',
          content: '您没有权限访问此页面，请重新登录',
          showCancel: false,
          success: () => {
            wx.reLaunch({ url: '/pages/role-selection/index' });
          }
        });
        return;
      }

      // 初始化完成后再加载数据
      this.getBabyInfo();
      await this.loadNutritionSettings();
      this.fetchDailyRecords(formattedDate);
      this.loadMedications();
      this.loadFoodCatalog();

      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      console.error('data-records 初始化失败:', error);
    }
  },

  onShow: async function() {
    if (!this.data.selectedDate) {
      return;
    }
    await this.loadNutritionSettings();
    this.fetchDailyRecords(this.data.selectedDate);
    this.loadMedications();
    this.loadFoodCatalog();
  },

  onShareAppMessage() {
    const babyInfo = this.data.babyInfo || wx.getStorageSync('baby_info') || {};
    const inviteCode = babyInfo.inviteCode;
    if (inviteCode) {
      return InvitationModel.getShareInfo(inviteCode, babyInfo.name);
    }
    return {
      title: '柠檬宝宝喂养记录',
      path: '/pages/role-selection/index',
      imageUrl: '/images/LemonLogo.png'
    };
  },

  // 初始化快速选择日期列表
  initDateList: function(baseDate = new Date()) {
    const selectedDate = baseDate instanceof Date ? new Date(baseDate) : parseDateKey(baseDate);
    const today = parseDateKey(this.formatDate(new Date()));
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysToToday = Math.max(0, Math.floor((today.getTime() - selectedDate.getTime()) / msPerDay));
    const baseRangeLength = this.data.dateRangeLength || 30;
    const rangeLength = Math.max(baseRangeLength, daysToToday + 8);
    const dateList = [];
    
    // 始终保持从今天向过去的连续时间轴，确保历史日期能被滚动到
    for (let i = 0; i < rangeLength; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dateList.push({
        id: `date-${i}`,
        date: this.formatDate(date),
        day: date.getDate(),
        month: date.getMonth() + 1,
        weekday: getWeekday(date),
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    this.setData({ dateList });
    return Math.min(daysToToday, Math.max(rangeLength - 1, 0));
  },

  // 初始化日历数据
  initCalendar: function(year, month) {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 这个月第一天是星期几
    const daysInMonth = getDaysInMonth(year, month);
    const daysInPrevMonth = getDaysInMonth(year, month - 1);
    
    const calendarDays = [];
    
    // 上个月的日期
    for (let i = 0; i < firstDay; i++) {
      const day = daysInPrevMonth - firstDay + i + 1;
      const date = new Date(year, month - 2, day);
      calendarDays.push({
        day,
        date: this.formatDate(date),
        isCurrentMonth: false,
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    // 当前月的日期
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month - 1, i);
      calendarDays.push({
        day: i,
        date: this.formatDate(date),
        isCurrentMonth: true,
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    // 补充下个月的日期，让日历呈现6行7列的形式
    const totalDays = 42; // 6行7列
    const remainingDays = totalDays - calendarDays.length;
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month, i);
      calendarDays.push({
        day: i,
        date: this.formatDate(date),
        isCurrentMonth: false,
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    this.setData({
      calendarYear: year,
      calendarMonth: month,
      calendarDays
    });
  },

  // 格式化日期为YYYY-MM-DD形式
  formatDate: function(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
  
  // 格式化日期为更易读的显示形式，如"2023年5月21日 星期日"
  formatDisplayDate: function(dateStr) {
    if (!dateStr) return '';

    const parts = dateStr.split('-').map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) {
      return dateStr;
    }

    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];

    return `${year}年${month}月${day}日 星期${weekday}`;
  },

  // 格式化时间为HH:mm
  formatTime: function(dateObj) {
    if (!dateObj) return '';
    
    // 确保传入的是Date对象
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
    
    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      console.error('无效的日期:', dateObj);
      return '';
    }
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  },

  // 日期选择相关方法
  onDateSelected: function(e) {
    const selectedDate = e.currentTarget.dataset.date;
    const index = e.currentTarget.dataset.index || 0;
    
    this.setData({ 
      selectedDate,
      formattedSelectedDate: this.formatDisplayDate(selectedDate),
      selectedDateIndex: index,
      currentDateId: `date-${index}`,
      isSelectedToday: selectedDate === this.formatDate(new Date())
    });
    
    this.fetchDailyRecords(selectedDate);
  },

  // 添加日期项点击处理函数
  onDateItemClick: function(e) {
    this.onDateSelected(e);
  },

  showCalendar: function() {
    this.setData({
      showCalendarPicker: true,
      copyCalendarContext: null
    });
  },

  async getFeedingRecordByDate(dateStr) {
    const babyUid = getBabyUid();
    if (!babyUid) return null;
    const db = wx.cloud.database();
    const _ = db.command;
    const targetDate = buildDateTimeFromDateKey(dateStr, '00:00');
    const endOfDay = buildDateTimeFromDateKey(dateStr, '23:59');

    const result = await db.collection('feeding_records').where({
      babyUid,
      date: _.gte(targetDate).and(_.lte(endOfDay))
    }).get();

    if (result.data && result.data.length > 0) {
      return mergeFeedingRecords(result.data, this.data.nutritionSettings || {});
    }

    const legacyResult = await db.collection('feeding_records').where({
      babyUid,
      date: dateStr
    }).get();
    return legacyResult.data && legacyResult.data.length > 0
      ? mergeFeedingRecords(legacyResult.data, this.data.nutritionSettings || {})
      : null;
  },

  async consolidateFeedingRecords(records = []) {
    if (!Array.isArray(records) || records.length === 0) {
      return records && records.length > 0 ? records[0] : null;
    }

    // 校验 babyUid 一致性，过滤掉不属于当前宝宝的记录
    const app = getApp();
    const currentBabyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    const safeRecords = currentBabyUid
      ? records.filter(r => r.babyUid === currentBabyUid)
      : records;

    if (safeRecords.length === 0) {
      return null;
    }
    if (safeRecords.length === 1) {
      return safeRecords[0];
    }

    const mergedRecord = mergeFeedingRecords(safeRecords, this.data.nutritionSettings || {});
    if (!mergedRecord?._id) return mergedRecord;

    try {
      const db = wx.cloud.database();
      await db.collection('feeding_records').doc(mergedRecord._id).update({
        data: {
          basicInfo: mergedRecord.basicInfo || {},
          feedings: mergedRecord.feedings || [],
          intakes: mergedRecord.intakes || [],
          summary: mergedRecord.summary || {},
          updatedAt: db.serverDate()
        }
      });
    } catch (error) {
      console.error('合并同日记录失败:', error);
    }

    return mergedRecord;
  },

  openCopyCalendar(type) {
    const configMap = {
      feeding: {
        hasSource: () => (this.data.feedings || []).length > 0,
        emptyText: '当前日期暂无喂奶记录',
        label: '喂奶记录'
      },
      food: {
        hasSource: () => (this.data.foodIntakes || []).length > 0,
        emptyText: '当前日期暂无食物记录',
        label: '食物记录'
      },
      medication: {
        hasSource: () => (this.data.medicationRecords || []).length > 0,
        emptyText: '当前日期暂无用药记录',
        label: '用药记录'
      }
    };

    const config = configMap[type];
    if (!config) return;

    if (!config.hasSource()) {
      wx.showToast({ title: config.emptyText, icon: 'none' });
      return;
    }

    const selectedDate = this.data.selectedDate || this.formatDate(new Date());
    const [year, month] = selectedDate.split('-').map(Number);
    this.initCalendar(year, month);
    this.setData({
      showCalendarPicker: true,
      copyCalendarContext: {
        type,
        label: config.label
      }
    });
  },

  onCopyFeedingToDate() {
    this.openCopyCalendar('feeding');
  },

  onCopyFoodToDate() {
    this.openCopyCalendar('food');
  },

  onCopyMedicationToDate() {
    this.openCopyCalendar('medication');
  },

  async handleCopyDatePicked(targetDateStr) {
    if (!targetDateStr) return;
    if (targetDateStr === this.data.selectedDate) {
      wx.showToast({
        title: '目标日期不能是当前日期',
        icon: 'none'
      });
      return;
    }

    const type = this.data.copyCalendarContext?.type;
    this.setData({
      showCalendarPicker: false,
      copyCalendarContext: null
    });

    if (type === 'feeding') {
      await this.applyFeedingCopyToDate(targetDateStr);
      return;
    }
    if (type === 'food') {
      await this.applyFoodCopyToDate(targetDateStr);
      return;
    }
    if (type === 'medication') {
      await this.applyMedicationCopyToDate(targetDateStr);
    }
  },

  async confirmOverwriteForDimension({ targetDateStr, dimensionLabel, hasExisting }) {
    if (!hasExisting) return true;

    return new Promise(resolve => {
      wx.showModal({
        title: '目标日期已有记录',
        content: `${this.formatDisplayDate(targetDateStr)} 已有${dimensionLabel}，是否确认覆盖？`,
        confirmText: '确认覆盖',
        success: res => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
  },

  async applyFeedingCopyToDate(targetDateStr) {
    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const sourceFeedings = this.data.feedings || [];
    const targetRecord = await this.getFeedingRecordByDate(targetDateStr);
    const shouldContinue = await this.confirmOverwriteForDimension({
      targetDateStr,
      dimensionLabel: '喂奶记录',
      hasExisting: !!(targetRecord && Array.isArray(targetRecord.feedings) && targetRecord.feedings.length > 0)
    });
    if (!shouldContinue) return;

    const copiedFeedings = sourceFeedings.map(item => cloneFeedingForDate(item, targetDateStr, babyUid));
    const targetIntakes = normalizeIntakes(targetRecord?.intakes || []);
    const updatedSummary = calculateMacroSummary(targetIntakes, copiedFeedings, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);

    wx.showLoading({ title: '复制中...' });
    try {
      const db = wx.cloud.database();
      if (targetRecord?._id) {
        await db.collection('feeding_records').doc(targetRecord._id).update({
          data: {
            feedings: copiedFeedings,
            summary: updatedSummary,
            updatedAt: db.serverDate()
          }
        });
      } else {
        await db.collection('feeding_records').add({
          data: {
            date: buildDateTimeFromDateKey(targetDateStr, '00:00'),
            basicInfo: {},
            feedings: copiedFeedings,
            intakes: [],
            medicationRecords: [],
            summary: updatedSummary,
            babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }
      wx.hideLoading();
      wx.showToast({ title: '已复制到目标日期', icon: 'success' });
    } catch (error) {
      console.error('复制喂奶记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '复制失败', icon: 'none' });
    }
  },

  async applyFoodCopyToDate(targetDateStr) {
    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const sourceFoodIntakes = normalizeIntakes(this.data.foodIntakes || []);
    const targetRecord = await this.getFeedingRecordByDate(targetDateStr);
    const targetIntakes = normalizeIntakes(targetRecord?.intakes || []);
    const targetNonFoodIntakes = targetIntakes.filter(item => item.type === 'milk');
    const targetFoodCount = targetIntakes.filter(item => item.type !== 'milk').length;
    const shouldContinue = await this.confirmOverwriteForDimension({
      targetDateStr,
      dimensionLabel: '食物记录',
      hasExisting: targetFoodCount > 0
    });
    if (!shouldContinue) return;

    const openid = wx.getStorageSync('openid') || '';
    const copiedFoodIntakes = sourceFoodIntakes.map(item => cloneIntakeForDate(item, openid));
    const mergedIntakes = [...targetNonFoodIntakes, ...copiedFoodIntakes];
    const updatedSummary = calculateMacroSummary(mergedIntakes, targetRecord?.feedings || [], this.data.nutritionSettings || {}, this.data.treatmentRecords || []);

    wx.showLoading({ title: '复制中...' });
    try {
      const db = wx.cloud.database();
      if (targetRecord?._id) {
        await db.collection('feeding_records').doc(targetRecord._id).update({
          data: {
            intakes: mergedIntakes,
            summary: updatedSummary,
            updatedAt: db.serverDate()
          }
        });
      } else {
        await db.collection('feeding_records').add({
          data: {
            date: buildDateTimeFromDateKey(targetDateStr, '00:00'),
            basicInfo: {},
            feedings: [],
            intakes: mergedIntakes,
            medicationRecords: [],
            summary: updatedSummary,
            babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }
      wx.hideLoading();
      wx.showToast({ title: '已复制到目标日期', icon: 'success' });
    } catch (error) {
      console.error('复制食物记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '复制失败', icon: 'none' });
    }
  },

  async applyMedicationCopyToDate(targetDateStr) {
    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const targetResult = await MedicationRecordModel.findByDate(targetDateStr, babyUid);
    const targetRecords = (targetResult.success ? targetResult.data : []) || [];
    const shouldContinue = await this.confirmOverwriteForDimension({
      targetDateStr,
      dimensionLabel: '用药记录',
      hasExisting: targetRecords.length > 0
    });
    if (!shouldContinue) return;

    const copiedMedicationRecords = (this.data.medicationRecords || []).map(record => cloneMedicationForDate(record, targetDateStr, babyUid));
    const db = wx.cloud.database();

    wx.showLoading({ title: '复制中...' });
    try {
      if (targetRecords.length > 0) {
        await Promise.all(targetRecords.map(record => db.collection('medication_records').doc(record._id).remove()));
      }
      if (copiedMedicationRecords.length > 0) {
        await Promise.all(
          copiedMedicationRecords.map(record =>
            db.collection('medication_records').add({
              data: {
                ...record,
                createdAt: db.serverDate(),
                updatedAt: db.serverDate()
              }
            })
          )
        );
      }
      wx.hideLoading();
      wx.showToast({ title: '已复制到目标日期', icon: 'success' });
    } catch (error) {
      console.error('复制用药记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '复制失败', icon: 'none' });
    }
  },

  hideCalendar: function() {
    this.setData({
      showCalendarPicker: false,
      copyCalendarContext: null
    });
  },

  prevMonth: function() {
    let year = this.data.calendarYear;
    let month = this.data.calendarMonth - 1;
    
    if (month < 1) {
      year--;
      month = 12;
    }
    
    this.initCalendar(year, month);
  },

  nextMonth: function() {
    let year = this.data.calendarYear;
    let month = this.data.calendarMonth + 1;
    
    if (month > 12) {
      year++;
      month = 1;
    }
    
    this.initCalendar(year, month);
  },

  selectCalendarDay: function(e) {
    const selectedDate = e.currentTarget.dataset.date;
    if (this.data.copyCalendarContext) {
      if (isFutureDateKey(selectedDate)) {
        wx.showToast({
          title: '复制目标不能晚于今天',
          icon: 'none'
        });
        return;
      }
      this.handleCopyDatePicked(selectedDate);
      return;
    }
    
    const selectedIndex = this.initDateList(parseDateKey(selectedDate));
    
    this.setData({ 
      selectedDate,
      formattedSelectedDate: this.formatDisplayDate(selectedDate),
      showCalendarPicker: false,
      selectedDateIndex: selectedIndex,
      currentDateId: `date-${selectedIndex}`,
      isSelectedToday: selectedDate === this.formatDate(new Date())
    });
    
    this.fetchDailyRecords(selectedDate);
  },

  goToToday: function() {
    const today = new Date();
    const formattedDate = this.formatDate(today);

    if (this.data.copyCalendarContext) {
      this.handleCopyDatePicked(formattedDate);
      return;
    }
    
    const selectedIndex = this.initDateList(today);
    this.setData({
      selectedDate: formattedDate,
      formattedSelectedDate: this.formatDisplayDate(formattedDate),
      showCalendarPicker: false,
      selectedDateIndex: selectedIndex,
      currentDateId: `date-${selectedIndex}`,
      isSelectedToday: true
    });
    
    this.fetchDailyRecords(formattedDate);
    this.initCalendar(today.getFullYear(), today.getMonth() + 1);
  },

  isFutureCalendarDay(dateStr) {
    return isFutureDateKey(dateStr);
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab) return;
    this.setData({ activeTab: tab });
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab) return;
    this.setData({ activeTab: tab });
  },

  // 获取当天的详细记录
  async fetchDailyRecords(dateStr, options = {}) {
    const silent = options.silent;
    if (!silent) {
      // 先设置数据区域透明，创建平滑过渡效果
      this.setData({
        isDataLoading: true
      });
      wx.showLoading({ title: '加载中...' });
    }
    
    try {
      // 确保配奶设置已加载
      if (!this.data.nutritionSettings) {
        await this.loadNutritionSettings();
      }
      
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 将日期字符串转换为Date对象
      const [year, month, day] = dateStr.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');

      if (!babyUid) {
        console.error('未找到宝宝UID，跳过数据查询');
        return;
      }

      let query = {
        date: _.gte(startOfDay).and(_.lte(endOfDay)),
        babyUid: babyUid
      };
      
      // 并行查询喂养记录、药物记录、治疗记录和排便记录
      const [feedingResult, medicationResult, treatmentResult, bowelResult] = await Promise.all([
        db.collection('feeding_records').where(query).get(),
        MedicationRecordModel.findByDate(dateStr, babyUid),
        TreatmentRecordModel.findByDate(dateStr, babyUid),
        db.collection('bowel_records').where({
          babyUid: babyUid,
          recordTime: _.gte(startOfDay).and(_.lte(endOfDay))
        }).orderBy('recordTime', 'desc').get()
      ]);
      const historicalBasicInfoSnapshot = await this.loadHistoricalBasicInfoSnapshot(dateStr, babyUid);
      const treatmentRecordsToSet = formatTreatmentRecords((treatmentResult.success ? treatmentResult.data : []) || []);
      let effectiveFeedingResult = feedingResult;
      if (!feedingResult.data || feedingResult.data.length === 0) {
        const legacyQuery = { date: dateStr, babyUid };
        effectiveFeedingResult = await db.collection('feeding_records').where(legacyQuery).get();
      }

      if (effectiveFeedingResult.data && effectiveFeedingResult.data.length > 0) {
        const record = await this.consolidateFeedingRecords(effectiveFeedingResult.data);
        const feedings = record.feedings || [];
        const intakes = normalizeIntakes(record.intakes || []);
        const foodIntakes = intakes.filter(item => item.type !== 'milk');
        const basicInfoSnapshot = this.resolveBasicInfoSnapshot(record, dateStr, historicalBasicInfoSnapshot);
        const recordWeight = basicInfoSnapshot.weight;
        const recordHeight = basicInfoSnapshot.height;

        const macroSummary = calculateMacroSummary(intakes, feedings, this.data.nutritionSettings || {}, treatmentRecordsToSet);
        const intakeOverview = calculateIntakeOverview(feedings, intakes, recordWeight, this.data.nutritionSettings || {}, treatmentRecordsToSet);
        const proteinSummaryDisplay = this.computeProteinSummaryDisplay(intakeOverview);

        const weightForCalorie = recordWeight;
        const heightForDisplay = recordHeight;
        const calorieMetrics = this.computeCalorieMetrics({
          totalCalories: macroSummary.calories,
          weight: weightForCalorie,
          dateStr: dateStr
        });
        
        // 获取药物记录数据
        const medicationRecordsToSet = (medicationResult.success ? medicationResult.data : []) || [];
        
        // 获取排便记录数据
        const bowelRecordsToSet = bowelResult.data || [];
        
        this.setData({
          recordId: record._id,
          feedings: feedings,
          intakes: intakes,
          foodIntakes: foodIntakes,
          foodMealGroups: groupFoodIntakesByMeal(foodIntakes),
          legacyFoodIntakes: getLegacyFoodIntakes(foodIntakes),
          macroSummary: macroSummary,
          macroRatios: this.computeMacroRatios(macroSummary),
          fatRatioRangeText: this.getFatRatioRangeText(dateStr),
          medicationRecords: medicationRecordsToSet,
          treatmentRecords: treatmentRecordsToSet,
          bowelRecords: bowelRecordsToSet,
          weight: weightForCalorie || '--',
          height: heightForDisplay || '--',
          weightSource: basicInfoSnapshot.weightSource,
          heightSource: basicInfoSnapshot.heightSource,
          naturalProteinCoefficientInput: record.basicInfo?.naturalProteinCoefficient || '',
          specialProteinCoefficientInput: record.basicInfo?.specialProteinCoefficient || '',
          intakeOverview,
          proteinSummaryDisplay,
          dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
          caloriePerKg: calorieMetrics.caloriePerKg,
          goalKcalRange: calorieMetrics.goalKcalRange,
          calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
          summaryPreview: this.buildSummaryPreviewData({
            formattedSelectedDate: this.formatDisplayDate(dateStr),
            feedings,
            intakeOverview,
            proteinSummaryDisplay,
            weight: weightForCalorie || '--',
            height: heightForDisplay || '--',
            totalMilk: (intakeOverview?.milk?.normal?.volume || 0) + (intakeOverview?.milk?.special?.volume || 0),
            dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
            caloriePerKg: calorieMetrics.caloriePerKg,
            calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
            macroRatios: this.computeMacroRatios(macroSummary),
            naturalProteinCoefficient: record.basicInfo?.naturalProteinCoefficient || '',
            specialProteinCoefficient: record.basicInfo?.specialProteinCoefficient || ''
          }),
          hasRecord: true,
          isDataLoading: false // 设置数据加载完成
        });
        
        // 处理喂奶、用药和排便记录
        this.processFeedingData(record.feedings || [], intakes);
        this.processMedicationData(medicationRecordsToSet);
        this.processBowelData(bowelRecordsToSet);
      } else {
        // 没有喂养记录，但可能有药物记录和排便记录
        const medicationRecordsToSet = (medicationResult.success ? medicationResult.data : []) || [];
        const bowelRecordsToSet = bowelResult.data || [];
        const basicInfoSnapshot = this.resolveBasicInfoSnapshot({}, dateStr, historicalBasicInfoSnapshot);
        const defaultWeight = basicInfoSnapshot.weight || '--';
        const defaultHeight = basicInfoSnapshot.height || '--';
        const calorieMetrics = this.computeCalorieMetrics({
          totalCalories: treatmentRecordsToSet.reduce((sum, record) => sum + (Number(record.summary?.totalCalories) || 0), 0),
          weight: basicInfoSnapshot.weight,
          dateStr: dateStr
        });
        const intakeOverview = mergeTreatmentIntoOverview(createEmptyIntakeOverview(), treatmentRecordsToSet);
        const macroSummary = mergeTreatmentIntoMacroSummary({
          calories: 0,
          protein: 0,
          naturalProtein: 0,
          specialProtein: 0,
          carbs: 0,
          fat: 0
        }, treatmentRecordsToSet);
        const proteinSummaryDisplay = this.computeProteinSummaryDisplay(intakeOverview);
        
        this.setData({
          recordId: '',
          feedings: [],
          intakes: [],
          foodIntakes: [],
          foodMealGroups: [],
          legacyFoodIntakes: [],
          macroSummary,
          macroRatios: this.computeMacroRatios(macroSummary),
          fatRatioRangeText: this.getFatRatioRangeText(dateStr),
          medicationRecords: medicationRecordsToSet,
          treatmentRecords: treatmentRecordsToSet,
          bowelRecords: bowelRecordsToSet,
          weight: defaultWeight,
          height: defaultHeight,
          weightSource: basicInfoSnapshot.weightSource,
          heightSource: basicInfoSnapshot.heightSource,
          hasRecord: medicationRecordsToSet.length > 0 || treatmentRecordsToSet.length > 0 || bowelRecordsToSet.length > 0, // 如果有药物/治疗/排便记录，也算有记录
          feedingRecords: [],
          totalNaturalMilk: 0,
          totalSpecialMilk: 0,
          totalMilk: 0,
          totalBreastMilkKcal: 0,
          totalSpecialMilkKcal: 0,
          goalKcalRange: calorieMetrics.goalKcalRange,
          calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
          dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
          caloriePerKg: calorieMetrics.caloriePerKg,
          totalFormulaPowderWeight: 0,
          naturalProteinCoefficient: 0,
          specialProteinCoefficient: 0,
          naturalProteinCoefficientInput: '',
          specialProteinCoefficientInput: '',
          intakeOverview,
          proteinSummaryDisplay,
          summaryPreview: this.buildSummaryPreviewData({
            formattedSelectedDate: this.formatDisplayDate(dateStr),
            feedings: [],
            intakeOverview,
            proteinSummaryDisplay,
            weight: defaultWeight,
            height: defaultHeight,
            totalMilk: 0,
            dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
            caloriePerKg: calorieMetrics.caloriePerKg,
            calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
            macroRatios: this.computeMacroRatios(macroSummary),
            naturalProteinCoefficient: '',
            specialProteinCoefficient: ''
          }),
          isDataLoading: false // 设置数据加载完成
        });
        
        // 处理药物记录和排便记录
        this.processMedicationData(medicationRecordsToSet);
        this.processBowelData(bowelRecordsToSet);
        this.processFeedingData([], []);
      }
      
      if (!silent) {
        wx.hideLoading();
      }
    } catch (error) {
      console.error('获取当日记录失败:', error);
      if (!silent) {
        wx.hideLoading();
      }
      wx.showToast({
        title: '获取记录失败',
        icon: 'error'
      });
      
      // 即使加载失败也要重置加载状态
      this.setData({
        isDataLoading: false
      });
    }
  },

  // 强制刷新数据（不使用缓存）
  async forceRefreshData() {
    try {
      // 清除本地数据
      this.setData({
      feedingRecords: [],
      intakes: [],
      foodIntakes: [],
      foodMealGroups: [],
      legacyFoodIntakes: [],
      medicationRecords: [],
      treatmentRecords: [],
      groupedMedicationRecords: [],
      bowelRecords: [],
      groupedBowelRecords: [],
      hasRecord: false,
      macroSummary: {
        calories: 0,
        protein: 0,
        naturalProtein: 0,
        specialProtein: 0,
        carbs: 0,
        fat: 0
      },
      macroRatios: { protein: 0, carbs: 0, fat: 0 }
    });
      
      // 重新获取数据
      await this.fetchDailyRecords(this.data.selectedDate);
      
      console.log('数据强制刷新完成');
    } catch (error) {
      console.error('强制刷新数据失败:', error);
      wx.showToast({
        title: '刷新数据失败',
        icon: 'error'
      });
    }
  },

  // 处理喂奶数据
  processFeedingData: function(feedingRecords, intakes = this.data.intakes || []) {
    if (!feedingRecords || feedingRecords.length === 0) {
      const calorieMetrics = this.computeCalorieMetrics({
        totalCalories: 0,
        weight: this.data.weight,
        dateStr: this.data.selectedDate
      });
      const intakeOverview = calculateIntakeOverview([], intakes, this.data.weight, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);

      this.setData({
        noFeeding: true,
        feedingRecords: [],
        totalNaturalMilk: 0,
        totalSpecialMilk: 0,
        totalMilk: 0,
        totalBreastMilkKcal: 0,
        totalSpecialMilkKcal: 0,
        goalKcalRange: calorieMetrics.goalKcalRange,
        calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
        caloriePerKg: calorieMetrics.caloriePerKg,
        dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
        totalFormulaPowderWeight: 0,
        naturalProteinCoefficient: 0,
        specialProteinCoefficient: 0,
        intakeOverview,
        proteinSummaryDisplay: this.computeProteinSummaryDisplay(intakeOverview),
        summaryPreview: this.buildSummaryPreviewData({
          feedings: [],
          intakeOverview,
          proteinSummaryDisplay: this.computeProteinSummaryDisplay(intakeOverview),
          totalMilk: 0,
          dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
          caloriePerKg: calorieMetrics.caloriePerKg,
          calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
          macroRatios: this.computeMacroRatios(this.data.macroSummary)
        })
      });
      return;
    }

    console.log('处理喂奶记录数据:', JSON.stringify(feedingRecords));
    
    // 按时间排序（优先使用startDateTime，其次使用startTime）
    feedingRecords.sort((a, b) => {
      let timeA, timeB;
      
      // 优先使用startDateTime进行排序
      if (a.startDateTime && b.startDateTime) {
        timeA = a.startDateTime instanceof Date ? a.startDateTime : new Date(a.startDateTime);
        timeB = b.startDateTime instanceof Date ? b.startDateTime : new Date(b.startDateTime);
        return timeB - timeA;
      }
      
      // 其次使用startTime进行排序
      if (a.startTime && b.startTime) {
        timeA = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
        timeB = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
        return timeB - timeA;
      }
      
      return 0;
    });
    
    // 处理每条记录的时间显示
    const nutritionSettings = this.data.nutritionSettings || {};
    const processedRecords = feedingRecords.map(record => {
      console.log('处理记录:', record);
      
      // 格式化开始时间
      let formattedStartTime = '--:--';
      if (record.startTime && typeof record.startTime === 'string' && record.startTime.includes(':')) {
        formattedStartTime = record.startTime;
      } else if (record.startDateTime) {
        const date = record.startDateTime instanceof Date ? record.startDateTime : new Date(record.startDateTime);
        if (!isNaN(date.getTime())) {
          formattedStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      } else if (record.startTime) {
        const date = record.startTime instanceof Date ? record.startTime : new Date(record.startTime);
        if (!isNaN(date.getTime())) {
          formattedStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      }

      const nutrition = calculateMilkNutrition({
        naturalMilkVolume: record.naturalMilkVolume,
        specialMilkVolume: record.specialMilkVolume,
        specialMilkPowder: record.specialMilkPowder,
        naturalMilkType: record.naturalMilkType || 'breast'
      }, nutritionSettings);

      return {
        ...record,
        naturalMilkType: record.naturalMilkType || 'breast',
        formattedStartTime: formattedStartTime,
        displayTime: formattedStartTime,
        nutritionDisplay: {
          calories: nutrition.calories || 0,
          carbs: nutrition.carbs || 0,
          fat: nutrition.fat || 0,
          naturalProtein: nutrition.naturalProtein || 0,
          specialProtein: nutrition.specialProtein || 0
        }
      };
    });

    const intakeOverview = calculateIntakeOverview(processedRecords, intakes, this.data.weight, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
    const proteinSummaryDisplay = this.computeProteinSummaryDisplay(intakeOverview);
    this.setData({
      noFeeding: false,
      feedingRecords: processedRecords,
      intakeOverview,
      proteinSummaryDisplay
    }, () => {
      this.calculateTotalMilk(processedRecords);
    });
  },

  buildFeedingDisplay(record) {
    if (!record) return null;
    const settings = this.data.nutritionSettings || {};
    const naturalMilkVolume = record.naturalMilkVolume || 0;
    const specialMilkVolume = record.specialMilkVolume || 0;
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume,
      specialMilkVolume,
      specialMilkPowder: record.specialPowderWeight || record.specialMilkPowder || 0,
      naturalMilkType: record.naturalMilkType || 'breast'
    }, settings);

    const formulaPowderWeight = record.naturalMilkType === 'formula'
      ? calculateFormulaPowder(naturalMilkVolume, settings)
      : 0;
    const specialPowderWeight = record.specialPowderWeight
      || calculateSpecialMilkPowder(specialMilkVolume, settings);

    return {
      ...record,
      startTime: record.startTime || record.formattedStartTime || '',
      normalProtein: nutrition.naturalProtein || 0,
      normalCalories: nutrition.naturalCalories || 0,
      specialProtein: nutrition.specialProtein || 0,
      specialCalories: nutrition.specialCalories || 0,
      formulaPowderWeight,
      specialPowderWeight,
      specialMilkPowder: record.specialMilkPowder || specialPowderWeight
    };
  },

  updateFeedingDisplay(scope) {
    if (scope === 'new') {
      const display = this.buildFeedingDisplay(this.data.newFeeding);
      this.setData({ newFeedingDisplay: display });
      return;
    }
    if (scope === 'edit') {
      const display = this.buildFeedingDisplay(this.data.editingFeeding);
      this.setData({ editingFeedingDisplay: display });
    }
  },

  // 计算总奶量
  calculateTotalMilk: function(records) {
    let totalNaturalMilk = 0;
    let totalSpecialMilk = 0;
    
    records.forEach(record => {
      totalNaturalMilk += parseFloat(record.naturalMilkVolume || 0);
      totalSpecialMilk += parseFloat(record.specialMilkVolume || 0);
    });
    
    // 计算总奶量
    const totalMilk = totalNaturalMilk + totalSpecialMilk;
    const currentWeight = parseFloat(this.data.weight);
    
    const settings = this.data.nutritionSettings || {};
    const canComputeNatural = this.isBreastSettingsComplete(settings);
    const canComputeSpecial = this.isSpecialSettingsComplete(settings);
    let naturalProteinCoefficient = '';
    let specialProteinCoefficient = '';
    // 以摄入总览为准计算蛋白量，避免只按奶量估算
    const overview = this.data.intakeOverview || calculateIntakeOverview(records, this.data.intakes || [], this.data.weight, this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
    const naturalProteinFromOverview = (overview?.milk?.normal?.protein || 0) + (overview?.food?.naturalProtein || 0);
    const specialProteinFromOverview = (overview?.milk?.special?.protein || 0) + (overview?.food?.specialProtein || 0);
    
    if (currentWeight && currentWeight > 0 && (canComputeNatural || canComputeSpecial || naturalProteinFromOverview || specialProteinFromOverview)) {
      const naturalProteinPer100ml = Number(settings.natural_milk_protein);
      const specialProteinPer100g = Number(settings.special_milk_protein);
      const specialRatioPowder = Number(settings.special_milk_ratio?.powder);
      const specialRatioWater = Number(settings.special_milk_ratio?.water);
      const specialPowderWeight = canComputeSpecial
        ? (totalSpecialMilk * specialRatioPowder) / specialRatioWater
        : 0;
      
      // 优先使用总览中的蛋白数，兜底按配方估算
      const naturalProteinIntake = naturalProteinFromOverview || (canComputeNatural ? ((totalNaturalMilk * naturalProteinPer100ml) / 100) : 0);
      const specialProteinIntake = specialProteinFromOverview || (canComputeSpecial ? ((specialPowderWeight * specialProteinPer100g) / 100) : 0);
      if (naturalProteinIntake) {
        naturalProteinCoefficient = Math.round((naturalProteinIntake / currentWeight) * 100) / 100;
      }
      if (specialProteinIntake) {
        specialProteinCoefficient = Math.round((specialProteinIntake / currentWeight) * 100) / 100;
      }
    }

    const calorieMetrics = this.computeCalorieMetrics({
      totalCalories: this.data.macroSummary?.calories || 0,
      weight: this.data.weight,
      dateStr: this.data.selectedDate
    });

    this.setData({
      totalNaturalMilk: Math.round(totalNaturalMilk),
      totalSpecialMilk: Math.round(totalSpecialMilk),
      totalMilk: Math.round(totalMilk),
      totalBreastMilkKcal: Math.round(totalNaturalMilk * BREAST_MILK_KCAL),
      totalSpecialMilkKcal: Math.round(totalSpecialMilk * SPECIAL_MILK_KCAL),
      naturalProteinCoefficient: naturalProteinCoefficient,
      specialProteinCoefficient: specialProteinCoefficient,
      goalKcalRange: calorieMetrics.goalKcalRange,
      calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
      caloriePerKg: calorieMetrics.caloriePerKg,
      dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
      summaryPreview: this.buildSummaryPreviewData({
        totalMilk: Math.round(totalMilk),
        dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
        caloriePerKg: calorieMetrics.caloriePerKg,
        calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
        naturalProteinCoefficient,
        specialProteinCoefficient
      })
    });

    this.refreshMacroSummary();
  },

  refreshMacroSummary() {
    const summary = calculateMacroSummary(this.data.intakes || [], this.data.feedings || [], this.data.nutritionSettings || {}, this.data.treatmentRecords || []);
    const calorieMetrics = this.computeCalorieMetrics({
      totalCalories: summary.calories,
      weight: this.data.weight,
      dateStr: this.data.selectedDate
    });
    this.setData({
      macroSummary: summary,
      macroRatios: this.computeMacroRatios(summary),
      goalKcalRange: calorieMetrics.goalKcalRange,
      calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
      caloriePerKg: calorieMetrics.caloriePerKg,
      dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
      summaryPreview: this.buildSummaryPreviewData({
        dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
        caloriePerKg: calorieMetrics.caloriePerKg,
        calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
        macroRatios: this.computeMacroRatios(summary)
      })
    });
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    if (this.data.selectedDate) {
      this.fetchDailyRecords(this.data.selectedDate);
    }
    wx.stopPullDownRefresh();
  },

  // 获取最近的喂奶记录数据作为默认值
  async getLatestFeedingData() {
    try {
      // 首先检查当前选择日期的记录
      if (this.data.feedingRecords?.length > 0) {
        const lastFeeding = this.data.feedingRecords[this.data.feedingRecords.length - 1];
        return {
          naturalMilkVolume: lastFeeding.naturalMilkVolume || '',
          specialMilkVolume: lastFeeding.specialMilkVolume || '0',
          naturalMilkType: lastFeeding.naturalMilkType || 'breast'
        };
      }
      
      // 如果当前日期没有记录，查询最近的历史记录
      const db = wx.cloud.database();
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取历史记录');
        return this.getCalculatedDefaultValues();
      }
      
      // 查询最近7天的记录
      const selectedDate = new Date(this.data.selectedDate);
      const sevenDaysAgo = new Date(selectedDate);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const result = await db.collection('feeding_records')
        .where({
          babyUid: babyUid,
          date: db.command.gte(sevenDaysAgo).and(db.command.lt(selectedDate))
        })
        .orderBy('date', 'desc')
        .limit(5)
        .get();
      
      // 查找最新的喂奶记录
      for (const record of result.data) {
        if (record.feedings && record.feedings.length > 0) {
          // 获取该天最后一次喂奶记录
          const sortedFeedings = record.feedings.sort((a, b) => {
            const timeA = a.startDateTime ? new Date(a.startDateTime) : new Date(`2000-01-01 ${a.startTime || '00:00'}`);
            const timeB = b.startDateTime ? new Date(b.startDateTime) : new Date(`2000-01-01 ${b.startTime || '00:00'}`);
            return timeB - timeA;
          });
          
          const latestFeeding = sortedFeedings[0];
          return {
            naturalMilkVolume: latestFeeding.naturalMilkVolume || '',
            specialMilkVolume: latestFeeding.specialMilkVolume || '0',
            naturalMilkType: latestFeeding.naturalMilkType || 'breast'
          };
        }
      }
      
      // 如果没有找到历史记录，返回计算的默认值
      return this.getCalculatedDefaultValues();
      
    } catch (error) {
      console.error('获取最近喂奶记录失败:', error);
      return this.getCalculatedDefaultValues();
    }
  },

  // 基于体重计算的默认值
  getCalculatedDefaultValues() {
    if (this.data.babyInfo?.weight && this.isNutritionSettingsComplete(this.data.nutritionSettings)) {
      const weight = parseFloat(this.data.babyInfo.weight);
      const settings = this.data.nutritionSettings;
      
      // 计算每日所需天然蛋白量
      const dailyNaturalProtein = weight * (settings.natural_protein_coefficient || 1.2);
      
      // 计算每日所需天然奶量
      const naturalMilkNeeded = (dailyNaturalProtein * 100) / (settings.natural_milk_protein || 1.1);
      
      // 假设一天8顿，计算每顿的理想量
      const perFeedingNaturalMilk = naturalMilkNeeded / 8;
      
      if (perFeedingNaturalMilk > 0) {
        return {
          naturalMilkVolume: Math.round(perFeedingNaturalMilk).toString(),
          specialMilkVolume: '0',
          naturalMilkType: 'breast'
        };
      }
    }
    
    // 兜底默认值
    return {
      naturalMilkVolume: '',
      specialMilkVolume: '0',
      naturalMilkType: 'breast'
    };
  },

  // 显示补充喂奶记录弹窗
  async showAddFeedingModal() {
    // 默认设置当前时间
    const now = new Date();
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hour}:${minute}`;
    
    // 获取最近的喂奶数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    const naturalMilk = parseFloat(defaultValues.naturalMilkVolume) || 0;
    const specialMilk = parseFloat(defaultValues.specialMilkVolume) || 0;
    const totalVolume = naturalMilk + specialMilk;
    
    // 计算特奶粉重量
    let specialPowderWeight = 0;
    if (specialMilk > 0) {
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        specialPowderWeight = Math.round((specialMilk * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        specialPowderWeight = Math.round((specialMilk * 13.5 / 90) * 10) / 10;
      }
    }

    const newFeeding = {
      startTime: currentTime,
      naturalMilkVolume: defaultValues.naturalMilkVolume,
      naturalMilkType: defaultValues.naturalMilkType || 'breast',
      specialMilkVolume: defaultValues.specialMilkVolume,
      totalVolume: totalVolume.toString(),
      specialPowderWeight: specialPowderWeight,
      notes: ''
    };

    if (!this.ensureFeedingSettings('new', newFeeding)) {
      return;
    }

    this.setData({
      showAddFeedingModal: true,
      newFeeding: {
        ...newFeeding
      }
    }, () => {
      this.updateFeedingDisplay('new');
    });
  },

  // 隐藏补充喂奶记录弹窗
  hideAddFeedingModal() {
    console.log('隐藏喂奶记录弹窗');
    this.setData({
      showAddFeedingModal: false,
      newFeedingDisplay: null
    });
  },

  onNaturalMilkTypeChange(e) {
    const { scope, type } = e.currentTarget.dataset;
    const path = scope === 'new'
      ? 'newFeeding.naturalMilkType'
      : scope === 'edit'
        ? 'editingFeeding.naturalMilkType'
        : '';
    if (!path) return;
    if (type === 'formula' && !this.isFormulaSettingsComplete()) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写普奶冲配参数，再记录普奶数据。');
      return;
    }
    if (type === 'breast' && !this.isBreastSettingsComplete()) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写母乳蛋白浓度，再记录母乳数据。');
      return;
    }
    this.setData({
      [path]: type
    }, () => {
      if (scope === 'new' || scope === 'edit') {
        this.updateFeedingDisplay(scope);
      }
    });
  },

  // 显示补充用药记录弹窗
  showAddMedicationModal() {
    console.log('显示用药记录弹窗', this.data.showAddMedicationModal);
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    this.setData({
      showAddMedicationModal: true
    }, () => {
      console.log('设置完成，弹窗状态:', this.data.showAddMedicationModal);
      this.setData({
        selectedMedicationIndex: 0,
        newMedication: {
          name: '',
          dosage: '',
          unit: '',
          time: currentTime,
          notes: ''
        }
      });
    });
  },

  goToMedicationManage() {
    this.setData({ showAddMedicationModal: false, showEditMedicationModal: false });
    wx.navigateTo({ url: '/pages/medications/index' });
  },

  // 隐藏补充用药记录弹窗
  hideAddMedicationModal() {
    console.log('隐藏用药记录弹窗');
    this.setData({
      showAddMedicationModal: false,
      selectedMedicationIndex: 0,
      newMedication: {
        name: '',
        dosage: '',
        unit: '',
        time: '',
        notes: ''
      }
    });
  },

  // 新喂奶记录输入处理
  onNewFeedingInput(e) {
    console.log('喂奶记录输入', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const newFeeding = { ...this.data.newFeeding };
    
    newFeeding[field] = value;
    
    // 重新计算总奶量（天然奶量 + 特奶量）
    if (field === 'specialMilkVolume' || field === 'naturalMilkVolume') {
      const natural = parseFloat(newFeeding.naturalMilkVolume) || 0;
      const special = parseFloat(newFeeding.specialMilkVolume) || 0;
      newFeeding.totalVolume = (natural + special).toFixed(1);
      
      // 计算特奶奶粉重量（根据配比 13.5g/90ml）
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        newFeeding.specialPowderWeight = Math.round((special * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        newFeeding.specialPowderWeight = Math.round((special * 13.5 / 90) * 10) / 10;
      }
    }
    
    this.setData({ newFeeding }, () => {
      this.updateFeedingDisplay('new');
    });
  },

  // 新喂奶记录时间选择处理
  onNewFeedingTimeChange(e) {
    console.log('喂奶记录时间变更', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const newFeeding = { ...this.data.newFeeding };
    newFeeding[field] = e.detail.value;
    this.setData({ newFeeding }, () => {
      this.updateFeedingDisplay('new');
    });
  },

  handleNewFeedingModalInputChange(e) {
    const { field, value } = e.detail || {};
    if (!field) return;
    this.onNewFeedingInput({
      currentTarget: { dataset: { field } },
      detail: { value }
    });
  },

  handleNewFeedingModalTimeChange(e) {
    this.onNewFeedingTimeChange({
      currentTarget: { dataset: { field: 'startTime' } },
      detail: { value: e.detail.value }
    });
  },

  handleNewFeedingModalTypeChange(e) {
    this.onNaturalMilkTypeChange({
      currentTarget: { dataset: { scope: 'new', type: e.detail.type } }
    });
  },

  handleNewFeedingModalAdjust(e) {
    const { field, action } = e.detail || {};
    if (!field) return;
    this.applyFeedingAdjust('new', field, action);
  },

  // 新用药记录输入处理
  onNewMedicationInput(e) {
    const field = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field) || e.detail.field;
    console.log('用药记录输入', field, e.detail.value);
    if (!field) {
      return;
    }
    const newMedication = { ...this.data.newMedication };
    newMedication[field] = e.detail.value;
    this.setData({ newMedication });
  },

  // 新用药记录时间选择处理
  onNewMedicationTimeChange(e) {
    const field = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field) || e.detail.field;
    console.log('用药记录时间变更', field, e.detail.value);
    if (!field) {
      return;
    }
    const newMedication = { ...this.data.newMedication };
    newMedication[field] = e.detail.value;
    this.setData({ newMedication });
  },

  // 保存新的喂奶记录
  async saveNewFeeding() {
    if (!this.ensureFeedingSettings('new')) {
      return;
    }
    console.log('保存喂奶记录', this.data.newFeeding);
    
    const { startTime, naturalMilkVolume, totalVolume } = this.data.newFeeding;
    
    // 验证输入
    if (!startTime) {
      wx.showToast({
        title: '请选择喂奶时间',
        icon: 'none'
      });
      return;
    }
    
    if (!naturalMilkVolume || !totalVolume) {
      wx.showToast({
        title: '请输入奶量',
        icon: 'none'
      });
      return;
    }
    
    // 验证结束时间大于开始时间
    const selectedDate = this.data.selectedDate; // 格式: YYYY-MM-DD
    const [year, month, day] = selectedDate.split('-').map(Number);
    
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const startDateTime = new Date(year, month - 1, day, startHour, startMinute, 0);
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 获取当天的开始和结束时间
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');

      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
        return;
      }

      // 查询当天的记录
      const query = {
        date: _.gte(startOfDay).and(_.lte(endOfDay)),
        babyUid: babyUid
      };

      const res = await db.collection('feeding_records').where(query).get();

      const feeding = {
        startTime: startTime,           // 字符串格式，用于显示
        endTime: '',                    // 保留字段，兼容旧数据
        startDateTime: startDateTime,   // Date对象，用于排序和比较
        endDateTime: null,
        naturalMilkVolume: parseFloat(naturalMilkVolume) || 0,
        naturalMilkType: this.data.newFeeding.naturalMilkType || 'breast',
        specialMilkVolume: parseFloat(this.data.newFeeding.specialMilkVolume) || 0,
        totalVolume: parseFloat(this.data.newFeeding.totalVolume) || 0,
        specialPowderWeight: parseFloat(this.data.newFeeding.specialPowderWeight) || 0,
        babyUid: babyUid,          // 添加宝宝UID关联
        createdAt: new Date()      // 添加创建时间戳
      };
      const feedingNotes = (this.data.newFeeding.notes || '').trim();
      if (feedingNotes) {
        feeding.notes = feedingNotes;
      }

      const existingRecord = pickPrimaryFeedingRecord(res.data || []);
      if (existingRecord?._id) {
        // 更新现有记录
        await db.collection('feeding_records').doc(existingRecord._id).update({
          data: {
            feedings: _.push([feeding]),
            updatedAt: db.serverDate()
          }
        });
      } else {
        // 创建新记录，使用新的数据结构
        const basicInfo = this.buildPersistedBasicInfoForDate({}, this.data.selectedDate);
        
        await db.collection('feeding_records').add({
          data: {
            date: startOfDay,
            basicInfo: basicInfo,   // 使用新的结构
            feedings: [feeding],
            medicationRecords: [],
            babyUid: babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      // 强制重新加载数据
      await this.forceRefreshData();
      this.hideAddFeedingModal();

    } catch (error) {
      console.error('保存喂奶记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 保存新的用药记录
  async saveNewMedication() {
    console.log('保存用药记录', this.data.newMedication);
    
    const { name, dosage, unit, time } = this.data.newMedication;
    
    // 验证输入
    if (!name) {
      wx.showToast({
        title: '请选择药物',
        icon: 'none'
      });
      return;
    }
    
    if (!dosage || dosage.trim() === '') {
      wx.showToast({
        title: '请输入用药剂量',
        icon: 'none'
      });
      return;
    }

    // 验证剂量是否为有效正数
    const dosageNum = parseFloat(dosage);
    if (isNaN(dosageNum) || dosageNum <= 0) {
      wx.showToast({
        title: '请输入有效的剂量数值',
        icon: 'none'
      });
      return;
    }
    
    if (!time) {
      wx.showToast({
        title: '请选择用药时间',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 获取当天的开始时间
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      
      // 创建完整的用药时间对象
      const [hours, minutes] = time.split(':').map(Number);
      const medicationTime = new Date(year, month - 1, day, hours, minutes, 0);
      
      // 查找药物ID（如果需要的话）
      const selectedMed = this.data.medications.find(med => med.name === name);
      const medicationId = selectedMed ? selectedMed._id : '';
      
      // 使用新的药物记录模型创建记录
      const medicationNotes = (this.data.newMedication.notes || '').trim();
      const result = await MedicationRecordModel.create({
         babyUid: babyUid,
         date: this.data.selectedDate,
         medicationId: medicationId,
         medicationName: name,
         dosage: parseFloat(dosage),
         unit: unit,
         actualTime: time,
         actualDateTime: medicationTime,
         ...(medicationNotes ? { notes: medicationNotes } : {})
       });
      
      if (result.success) {
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 强制重新加载数据
        await this.forceRefreshData();
        this.hideAddMedicationModal();
      } else {
        throw new Error(result.message || '保存失败');
      }
      
    } catch (error) {
      console.error('保存用药记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 加载药物配置
  async loadMedications() {
    try {
      const db = wx.cloud.database();
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) return;
      const res = await db.collection('medications').where({ babyUid }).get();
      this.setData({ medications: res.data });
    } catch (error) {
      console.error('加载药物配置失败:', error);
    }
  },

  // 选择药物处理
  onMedicationSelect(e) {
    const index = Number(e.detail.value) || 0;
    const medication = this.data.medications[index];
    if (!medication) {
      return;
    }
    const newMedication = {
      ...this.data.newMedication,
      name: medication.name,
      dosage: medication.dosage,
      unit: medication.unit,
      frequency: medication.frequency || ''
    };
    this.setData({ newMedication, selectedMedicationIndex: index });
  },

  // 显示删除喂奶记录确认对话框
  deleteFeeding(e) {
    const index = (e.detail && e.detail.index !== undefined) ? e.detail.index : e.currentTarget.dataset.index;
    const feeding = this.data.feedingRecords[index];
    const message = `确认删除 ${feeding.formattedStartTime} 的喂奶记录吗？`;
    
    this.setData({
      showDeleteConfirm: true,
      deleteConfirmMessage: message,
      deleteType: 'feeding',
      deleteIndex: index
    });
  },

  // 显示删除用药记录确认对话框
  deleteMedication(e) {
    const recordId = e.currentTarget.dataset.recordId;
    console.log('点击删除药物记录，recordId:', recordId);
    
    const medication = this.data.medicationRecords.find(record => record._id === recordId);
    console.log('找到的药物记录:', medication);
    
    if (!medication) {
      wx.showToast({
        title: '未找到药物记录',
        icon: 'none'
      });
      return;
    }
    
    const message = `确认删除 ${medication.medicationName} (${medication.actualTime}) 的用药记录吗？`;
    
    console.log('设置删除确认对话框数据:', {
      deleteType: 'medication',
      deleteRecordId: recordId
    });
    
    this.setData({
      showDeleteConfirm: true,
      deleteConfirmMessage: message,
      deleteType: 'medication',
      deleteRecordId: recordId // 使用recordId而不是index
    });
  },

  // 隐藏删除确认对话框
  hideDeleteConfirm() {
    this.setData({
      showDeleteConfirm: false,
      deleteConfirmMessage: '',
      deleteType: '',
      deleteIndex: -1,
      deleteRecordId: ''
    });
  },

  // 确认删除记录
  async confirmDelete() {
    const { deleteType, deleteIndex, deleteRecordId, selectedDate } = this.data;
    
    // 检查是否有有效的删除目标
    if (deleteType === 'feeding' && deleteIndex < 0) {
      this.hideDeleteConfirm();
      return;
    }
    
    if ((deleteType === 'medication' || deleteType === 'bowel') && !deleteRecordId) {
      this.hideDeleteConfirm();
      return;
    }

    wx.showLoading({
      title: '删除中...',
      mask: true
    });

    try {
      if (deleteType === 'feeding') {
        // 处理喂奶记录删除
        const db = wx.cloud.database();

        // 将日期字符串转换为 Date 对象
        const [year, month, day] = selectedDate.split('-').map(Number);
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59);

        // 查询当天的记录（添加babyUid条件）
        const app = getApp();
        const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
        
        if (!babyUid) {
          wx.hideLoading();
          wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
          return;
        }

        const deleteQuery = {
          date: db.command.gte(startOfDay).and(db.command.lte(endOfDay)),
          babyUid: babyUid
        };
        
        const res = await db.collection('feeding_records').where(deleteQuery).get();

        if (res.data.length === 0) {
          wx.hideLoading();
          wx.showToast({
            title: '未找到记录',
            icon: 'error'
          });
          this.hideDeleteConfirm();
          return;
        }

        const dayRecord = pickPrimaryFeedingRecord(res.data || []);
        if (!dayRecord) {
          wx.hideLoading();
          wx.showToast({
            title: '未找到记录',
            icon: 'error'
          });
          this.hideDeleteConfirm();
          return;
        }
        const feedings = [...dayRecord.feedings];
        
        // 找到要删除的记录（通过对比时间和奶量来确定）
        const targetFeeding = this.data.feedingRecords[deleteIndex];
        let targetIndex = -1;
        
        // 尝试通过时间和奶量匹配找到对应的记录
        for (let i = 0; i < feedings.length; i++) {
          const feeding = feedings[i];
          let feedingStartTime = '';
          
          // 处理时间格式
          if (feeding.startTime && typeof feeding.startTime === 'string' && feeding.startTime.includes(':')) {
            feedingStartTime = feeding.startTime;
          } else if (feeding.startDateTime) {
            const date = new Date(feeding.startDateTime);
            if (!isNaN(date.getTime())) {
              feedingStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            }
          }
          
          // 匹配条件：时间相同且天然奶量相同
          if (feedingStartTime === targetFeeding.formattedStartTime && 
              Math.abs(parseFloat(feeding.naturalMilkVolume || 0) - parseFloat(targetFeeding.naturalMilkVolume || 0)) < 0.1) {
            targetIndex = i;
            break;
          }
        }
        
        if (targetIndex >= 0) {
          feedings.splice(targetIndex, 1);
          
          // 更新数据库
          const deleteResult = await db.collection('feeding_records').doc(dayRecord._id).update({
            data: { 
              feedings,
              updatedAt: db.serverDate()
            }
          });
          
          console.log('删除喂奶记录数据库更新结果:', deleteResult);
        } else {
          console.error('删除喂奶记录失败: 未找到匹配的记录', {
            targetIndex,
            targetFeeding,
            feedingsInDb: feedings.map(f => ({
              startTime: f.startTime,
              naturalMilkVolume: f.naturalMilkVolume
            }))
          });
          throw new Error('未找到要删除的记录');
        }
        
      } else if (deleteType === 'medication') {
        // 删除用药记录 - 使用新的药物记录模型
        const recordId = this.data.deleteRecordId;
        console.log('准备删除药物记录，recordId:', recordId);
        
        if (recordId) {
          const result = await MedicationRecordModel.delete(recordId);
          console.log('删除药物记录结果:', result);
          
          if (!result.success) {
            throw new Error(result.message || '删除失败');
          }
        } else {
          throw new Error('无法找到要删除的药物记录');
        }
      } else if (deleteType === 'bowel') {
        // 删除排便记录
        const recordId = this.data.deleteRecordId;
        console.log('准备删除排便记录，recordId:', recordId);
        
        if (recordId) {
          const db = wx.cloud.database();
          const result = await db.collection('bowel_records').doc(recordId).remove();
          console.log('删除排便记录结果:', result);
          
          if (!result.stats || result.stats.removed === 0) {
            throw new Error('删除失败，记录可能不存在');
          }
        } else {
          throw new Error('无法找到要删除的排便记录');
        }
      }

      // 强制刷新数据
      await this.forceRefreshData();
      
      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
    } catch (error) {
      console.error('删除记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '删除失败',
        icon: 'error'
      });
    }

    this.hideDeleteConfirm();
  },

  // 获取宝宝基本信息（包括默认体重）
  async getBabyInfo() {
    try {
      const db = wx.cloud.database();
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) return;

      const res = await db.collection('baby_info').where({ babyUid }).limit(1).get();
      if (res.data && res.data.length > 0) {
        this.setData({
          babyInfo: res.data[0],
          fatRatioRangeText: this.getFatRatioRangeText(this.data.selectedDate, res.data[0].birthday)
        });
        
        if (this.isTodayDate(this.data.selectedDate)) {
          const fallbackUpdates = {};
          if ((this.data.weight === '--' || this.data.weight === '') && this.data.weightSource !== 'record') {
            fallbackUpdates.weight = res.data[0].weight || '--';
            fallbackUpdates.weightSource = res.data[0].weight ? 'global' : 'empty';
          }
          if ((this.data.height === '--' || this.data.height === '') && this.data.heightSource !== 'record') {
            fallbackUpdates.height = res.data[0].height || '--';
            fallbackUpdates.heightSource = res.data[0].height ? 'global' : 'empty';
          }
          if (Object.keys(fallbackUpdates).length > 0) {
            this.setData({
              ...fallbackUpdates,
              summaryPreview: this.buildSummaryPreviewData(fallbackUpdates)
            });
          }
        }

        // 更新热量相关区间，确保年龄段范围使用最新生日信息
        const calorieMetrics = this.computeCalorieMetrics({
          totalCalories: this.data.macroSummary?.calories || 0,
          weight: this.data.weight,
          dateStr: this.data.selectedDate
        });
        this.setData({
          goalKcalRange: calorieMetrics.goalKcalRange,
          calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
          caloriePerKg: calorieMetrics.caloriePerKg,
          dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal
        });
      }
    } catch (error) {
      console.error('获取宝宝信息失败:', error);
    }
  },
  
  // 处理用药记录
  processMedicationData: function(medicationRecords) {
    if (!medicationRecords || medicationRecords.length === 0) {
      this.setData({
        medicationRecords: [],
        groupedMedicationRecords: []
      });
      return;
    }

    console.log('处理用药记录数据:', JSON.stringify(medicationRecords));
    
    const processedMedicationRecords = medicationRecords.map(record => {
      console.log('处理用药记录:', record);
      
      // 直接使用新数据结构的原始数据，WXML 已适配新字段
      return {
        ...record
      };
    });
    
    // 按时间排序
    processedMedicationRecords.sort((a, b) => {
      // 如果时间格式是无效的，则排在后面
      if (!a.actualTime && b.actualTime) return 1;
      if (a.actualTime && !b.actualTime) return -1;
      if (!a.actualTime && !b.actualTime) return 0;
      
      // 将时间转换为分钟数进行比较
      const getMinutes = (timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
      };
      
      // 降序排列（最近的时间在前）
      return getMinutes(b.actualTime) - getMinutes(a.actualTime);
    });

    // 使用MedicationRecordModel的分组功能
    const groupedMedicationRecords = MedicationRecordModel.groupRecordsByMedication(processedMedicationRecords);
    
    this.setData({
      medicationRecords: processedMedicationRecords,
      groupedMedicationRecords: groupedMedicationRecords
    });
  },

  // 打开编辑喂奶记录弹窗
  openEditFeedingModal(e) {
    const index = (e.detail && e.detail.index !== undefined) ? e.detail.index : e.currentTarget.dataset.index;
    const feeding = this.data.feedingRecords[index];

    // 计算总奶量（如果没有的话）
    let totalVolume = feeding.totalVolume;
    if (!totalVolume && (feeding.naturalMilkVolume || feeding.specialMilkVolume)) {
      totalVolume = (parseFloat(feeding.naturalMilkVolume) || 0) + (parseFloat(feeding.specialMilkVolume) || 0);
    }
    
    // 计算特奶奶粉重量
    const specialMilkVolume = parseFloat(feeding.specialMilkVolume) || 0;
    let specialPowderWeight = 0;
    if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
      const ratio = this.data.nutritionSettings.special_milk_ratio;
      specialPowderWeight = Math.round((specialMilkVolume * ratio.powder / ratio.water) * 10) / 10;
    } else {
      // 使用默认配比 13.5g/90ml
      specialPowderWeight = Math.round((specialMilkVolume * 13.5 / 90) * 10) / 10;
    }

    let formattedStartTime = feeding.formattedStartTime;
    if (!formattedStartTime) {
      if (feeding.startTime && typeof feeding.startTime === 'string' && feeding.startTime.includes(':')) {
        formattedStartTime = feeding.startTime;
      } else if (feeding.startDateTime) {
        const date = feeding.startDateTime instanceof Date ? feeding.startDateTime : new Date(feeding.startDateTime);
        if (!isNaN(date.getTime())) {
          formattedStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      }
    }

    this.setData({
      showEditFeedingModal: true,
      editingFeedingIndex: index,
      editingFeeding: { 
        ...feeding,
        naturalMilkType: feeding.naturalMilkType || 'breast',
        formattedStartTime: formattedStartTime || '',
        totalVolume: totalVolume,
        specialPowderWeight: specialPowderWeight
      }
    }, () => {
      this.updateFeedingDisplay('edit');
    });
  },
  
  // 隐藏编辑喂奶记录弹窗
  hideEditFeedingModal() {
    this.setData({
      showEditFeedingModal: false,
      editingFeedingIndex: -1,
      editingFeeding: null,
      editingFeedingDisplay: null
    });
  },
  
  // 编辑喂奶记录输入处理
  onEditFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const editingFeeding = { ...this.data.editingFeeding };
    
    editingFeeding[field] = value;
    
    // 重新计算总奶量（天然奶量 + 特奶量）
    if (field === 'specialMilkVolume' || field === 'naturalMilkVolume') {
      const natural = parseFloat(editingFeeding.naturalMilkVolume) || 0;
      const special = parseFloat(editingFeeding.specialMilkVolume) || 0;
      editingFeeding.totalVolume = (natural + special).toFixed(1);
      
      // 计算特奶奶粉重量（根据配比 13.5g/90ml）
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        editingFeeding.specialPowderWeight = Math.round((special * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        editingFeeding.specialPowderWeight = Math.round((special * 13.5 / 90) * 10) / 10;
      }
      
    }
    
    this.setData({ editingFeeding }, () => {
      this.updateFeedingDisplay('edit');
    });
  },
  
  // 编辑喂奶记录时间选择处理
  onEditFeedingTimeChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const editingFeeding = { ...this.data.editingFeeding };
    
    editingFeeding[field] = value;
    this.setData({ editingFeeding }, () => {
      this.updateFeedingDisplay('edit');
    });
  },

  handleEditFeedingModalInputChange(e) {
    const { field, value } = e.detail || {};
    if (!field) return;
    this.onEditFeedingInput({
      currentTarget: { dataset: { field } },
      detail: { value }
    });
  },

  handleEditFeedingModalTimeChange(e) {
    this.onEditFeedingTimeChange({
      currentTarget: { dataset: { field: 'formattedStartTime' } },
      detail: { value: e.detail.value }
    });
  },

  handleEditFeedingModalTypeChange(e) {
    this.onNaturalMilkTypeChange({
      currentTarget: { dataset: { scope: 'edit', type: e.detail.type } }
    });
  },

  handleEditFeedingModalAdjust(e) {
    const { field, action } = e.detail || {};
    if (!field) return;
    this.applyFeedingAdjust('edit', field, action);
  },

  applyFeedingAdjust(scope, field, action) {
    const key = scope === 'edit' ? 'editingFeeding' : 'newFeeding';
    const target = this.data[key] || {};
    const currentValue = parseFloat(target[field]) || 0;
    const nextValue = action === 'increase'
      ? currentValue + 5
      : Math.max(0, currentValue - 5);
    if (scope === 'edit') {
      this.onEditFeedingInput({
        currentTarget: { dataset: { field } },
        detail: { value: nextValue.toString() }
      });
    } else {
      this.onNewFeedingInput({
        currentTarget: { dataset: { field } },
        detail: { value: nextValue.toString() }
      });
    }
  },
  
  // 保存编辑后的喂奶记录
  async saveEditedFeeding() {
    try {
      wx.showLoading({ title: '保存中...' });

      if (!this.ensureFeedingSettings('edit')) {
        wx.hideLoading();
        return;
      }
      
      const { editingFeeding, editingFeedingIndex, selectedDate } = this.data;
      
      // 验证输入
      if (!editingFeeding.formattedStartTime) {
        wx.showToast({
          title: '请选择喂奶时间',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }
      
      if (!editingFeeding.naturalMilkVolume && !editingFeeding.specialMilkVolume) {
        wx.showToast({
          title: '请输入奶量',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }
      
      // 准备更新的数据
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 获取当天的开始和结束时间
      const [year, month, day] = selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 解析时间
      const [startHour, startMinute] = editingFeeding.formattedStartTime.split(':').map(Number);
      
      const startDateTime = new Date(year, month - 1, day, startHour, startMinute, 0);

      // 查询当天记录（添加babyUid条件）
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
        return;
      }

      const whereQuery = {
        date: _.gte(startOfDay).and(_.lte(endOfDay)),
        babyUid: babyUid
      };
      
      const res = await db.collection('feeding_records')
        .where(whereQuery)
        .get();
      
      if (res.data.length === 0) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到记录',
          icon: 'error'
        });
        return;
      }
      
      // 获取记录并更新
      const record = pickPrimaryFeedingRecord(res.data || []);
      if (!record) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到记录',
          icon: 'error'
        });
        return;
      }
      const feedings = [...record.feedings];
      
      // 找到要编辑的记录（通过对比时间和奶量来确定）
      const originalFeeding = this.data.feedingRecords[editingFeedingIndex];
      let targetIndex = -1;
      
              // 尝试通过时间和奶量匹配找到对应的记录
        for (let i = 0; i < feedings.length; i++) {
          const feeding = feedings[i];
          let feedingStartTime = '';
          
          // 处理时间格式
          if (feeding.startTime && typeof feeding.startTime === 'string' && feeding.startTime.includes(':')) {
            feedingStartTime = feeding.startTime;
          } else if (feeding.startDateTime) {
            const date = new Date(feeding.startDateTime);
            if (!isNaN(date.getTime())) {
              feedingStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            }
          }
          
          // 匹配条件：时间相同且天然奶量相同
          if (feedingStartTime === originalFeeding.formattedStartTime && 
              Math.abs(parseFloat(feeding.naturalMilkVolume || 0) - parseFloat(originalFeeding.naturalMilkVolume || 0)) < 0.1) {
            targetIndex = i;
            break;
          }
        }
      
      if (targetIndex >= 0) {
        // 更新记录，确保包含完整的時間字段
        feedings[targetIndex] = {
          ...feedings[targetIndex],
          startTime: editingFeeding.formattedStartTime,      // 字符串格式，用于显示
          startDateTime: startDateTime,                      // Date对象，用于排序和比较
          endTime: '',
          endDateTime: null,
          naturalMilkVolume: parseFloat(editingFeeding.naturalMilkVolume) || 0,
          naturalMilkType: editingFeeding.naturalMilkType || 'breast',
          specialMilkVolume: parseFloat(editingFeeding.specialMilkVolume) || 0,
          totalVolume: parseFloat(editingFeeding.totalVolume) || 
                      (parseFloat(editingFeeding.naturalMilkVolume) || 0) + 
                      (parseFloat(editingFeeding.specialMilkVolume) || 0),
          specialPowderWeight: parseFloat(editingFeeding.specialPowderWeight) || 0,
          babyUid: babyUid, // 确保记录包含babyUid
          notes: editingFeeding.notes || ''
        };
        
        // 更新数据库
        const updateResult = await db.collection('feeding_records').doc(record._id).update({
          data: {
            feedings: feedings,
            updatedAt: db.serverDate()
          }
        });
        
        console.log('编辑喂奶记录数据库更新结果:', updateResult);
        
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 强制重新加载数据
        await this.forceRefreshData();
        this.hideEditFeedingModal();
      } else {
        console.error('编辑喂奶记录失败: 未找到匹配的记录', {
          targetIndex,
          originalFeeding,
          feedingsInDb: feedings.map(f => ({
            startTime: f.startTime,
            naturalMilkVolume: f.naturalMilkVolume
          }))
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '未找到要编辑的记录',
          icon: 'none'
        });
      }
      
    } catch (error) {
      console.error('保存编辑记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 打开编辑用药记录弹窗
  openEditMedicationModal(e) {
    const recordId = e.currentTarget.dataset.recordId;
    const medication = this.data.medicationRecords.find(record => record._id === recordId);
    
    if (!medication) {
      wx.showToast({
        title: '未找到药物记录',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showEditMedicationModal: true,
      editingMedicationRecordId: recordId, // 使用recordId而不是index
      editingMedication: { ...medication }
    });
  },
  
  // 隐藏编辑用药记录弹窗
  hideEditMedicationModal() {
    this.setData({
      showEditMedicationModal: false,
      editingMedicationIndex: -1,
      editingMedicationRecordId: '',
      editingMedication: null
    });
  },
  
  // 编辑用药记录输入处理
  onEditMedicationInput(e) {
    const field = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field) || e.detail.field;
    const value = e.detail.value;
    if (!field) {
      return;
    }
    const editingMedication = { ...this.data.editingMedication };
    
    editingMedication[field] = value;
    this.setData({ editingMedication });
  },

  // 编辑用药记录时间选择处理
  onEditMedicationTimeChange(e) {
    const rawField = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.field) || e.detail.field;
    const value = e.detail.value;
    if (!rawField) {
      return;
    }
    const editingMedication = { ...this.data.editingMedication };
    const field = rawField === 'time' ? 'actualTime' : rawField;
    editingMedication[field] = value;
    this.setData({ editingMedication });
  },
  
  // 保存编辑后的用药记录
  async saveEditedMedication() {
    try {
      wx.showLoading({ title: '保存中...' });
      
      const { editingMedication, selectedDate } = this.data;
      
      // 验证输入
      if (!editingMedication.actualTime) {
        wx.showToast({
          title: '请选择用药时间',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }

      const dosageValue = editingMedication.dosage;
      if (dosageValue === null || dosageValue === undefined || String(dosageValue).trim() === '') {
        wx.showToast({
          title: '请输入用药剂量',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }

      // 验证剂量是否为有效正数
      const dosage = parseFloat(dosageValue);
      if (isNaN(dosage) || dosage <= 0) {
        wx.showToast({
          title: '请输入有效的剂量数值',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }
      
      if (!editingMedication._id) {
        wx.showToast({
          title: '记录ID不存在',
          icon: 'error'
        });
        wx.hideLoading();
        return;
      }
      
      // 获取日期和时间
      const [year, month, day] = selectedDate.split('-').map(Number);
      const [hours, minutes] = editingMedication.actualTime.split(':').map(Number);
      const medicationTime = new Date(year, month - 1, day, hours, minutes, 0);
      
      // 使用新的药物记录模型更新
      const medicationNotes = (editingMedication.notes || '').trim();
      const result = await MedicationRecordModel.update(editingMedication._id, {
        actualTime: editingMedication.actualTime, // 保存为字符串格式
        actualDateTime: medicationTime, // 保存为Date对象
        dosage: parseFloat(editingMedication.dosage), // 确保是数字类型
        medicationName: editingMedication.medicationName,
        ...(medicationNotes ? { notes: medicationNotes } : { notes: '' })
      });
      
      if (result.success) {
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 强制重新加载数据
        await this.forceRefreshData();
        this.hideEditMedicationModal();
      } else {
        throw new Error(result.message || '更新失败');
      }
      
    } catch (error) {
      console.error('保存编辑用药记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 加载配奶参数设置
  async loadNutritionSettings() {
    try {
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      const defaultSettings = NutritionModel.createDefaultSettings();
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法加载配奶设置');
        this.setData({
          nutritionSettings: defaultSettings,
          needsNutritionSetup: true
        });
        this.promptNutritionSetup();
        return;
      }
      
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      const mergedSettings = {
        ...defaultSettings,
        ...(settings || {}),
        special_milk_ratio: {
          ...defaultSettings.special_milk_ratio,
          ...(settings?.special_milk_ratio || {})
        },
        formula_milk_ratio: {
          ...defaultSettings.formula_milk_ratio,
          ...(settings?.formula_milk_ratio || {})
        }
      };
      
      const isComplete = this.isNutritionSettingsComplete(mergedSettings);
      this.setData({
        nutritionSettings: mergedSettings,
        needsNutritionSetup: !isComplete,
        hasShownNutritionPrompt: isComplete ? false : this.data.hasShownNutritionPrompt
      });
      
      if (!isComplete) {
        this.promptNutritionSetup();
      }
    } catch (error) {
      console.error('加载配奶参数设置失败:', error);
      this.setData({
        nutritionSettings: NutritionModel.createDefaultSettings(),
        needsNutritionSetup: true,
        hasShownNutritionPrompt: this.data.hasShownNutritionPrompt
      });
      this.promptNutritionSetup();
    }
  },

  // 阻止事件冒泡
  preventBubble() {
    // 阻止事件冒泡
  },

  // === 排便记录相关方法 ===
  
  // 处理排便记录数据
  processBowelData(bowelRecords) {
    if (!bowelRecords || bowelRecords.length === 0) {
      this.setData({
        bowelRecords: [],
        groupedBowelRecords: []
      });
      return;
    }

    // 处理记录，添加显示用的文本
    const processedRecords = bowelRecords.map(record => ({
      ...record,
      typeText: this.getBowelTypeText(record.type),
      consistencyText: record.consistency ? this.getConsistencyText(record.consistency) : '',
      colorText: record.color ? this.getColorText(record.color) : '',
      smellText: record.smell ? this.getSmellText(record.smell) : '',
      amountText: record.amount ? this.getAmountText(record.amount) : ''
    }));

    // 按类型分组
    const groupedRecords = this.groupBowelRecordsByType(processedRecords);

    this.setData({
      bowelRecords: processedRecords,
      groupedBowelRecords: groupedRecords
    });
  },

  // 按类型分组排便记录
  groupBowelRecordsByType(records) {
    const groups = [];
    const typeOrder = ['stool', 'urine', 'mixed'];
    const typeLabels = {
      'stool': '大便',
      'urine': '小便', 
      'mixed': '混合'
    };
    
    typeOrder.forEach(type => {
      const typeRecords = records.filter(record => record.type === type);
      if (typeRecords.length > 0) {
        groups.push({
          type: type,
          typeText: typeLabels[type],
          records: typeRecords,
          count: typeRecords.length
        });
      }
    });
    
    return groups;
  },

  // 显示补充排便记录弹窗
  showAddBowelModal() {
    const now = new Date();
    const currentTime = this.formatTime(now);
    
    this.setData({
      showAddBowelModal: true,
      newBowelRecord: {
        time: currentTime,
        type: 'stool',
        consistency: '',
        color: '',
        smell: '',
        amount: '',
        notes: ''
      }
    });
  },

  // 隐藏补充排便记录弹窗
  hideAddBowelModal() {
    this.setData({
      showAddBowelModal: false,
      newBowelRecord: {
        time: '',
        type: 'stool',
        consistency: '',
        color: '',
        smell: '',
        amount: '',
        notes: ''
      }
    });
  },

  // 排便记录时间选择
  onNewBowelTimeChange(e) {
    const timeStr = e.detail.value;
    this.setData({
      'newBowelRecord.time': timeStr
    });
  },

  // 排便类型选择
  onBowelTypeSelect(e) {
    const { type } = e.currentTarget.dataset;
    this.setData({
      'newBowelRecord.type': type
    });
  },

  // 排便选项选择
  onBowelOptionSelect(e) {
    const { field, value } = e.currentTarget.dataset;
    this.setData({
      [`newBowelRecord.${field}`]: value
    });
  },

  // 排便记录输入
  onNewBowelInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`newBowelRecord.${field}`]: value
    });
  },

  // 保存新的排便记录
  async saveNewBowelRecord() {
    const { time, type, consistency, color, smell, amount, notes } = this.data.newBowelRecord;
    
    // 验证必填字段
    if (!time) {
      wx.showToast({
        title: '请选择时间',
        icon: 'none'
      });
      return;
    }
    
    if (!type) {
      wx.showToast({
        title: '请选择类型',
        icon: 'none'
      });
      return;
    }
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      const db = wx.cloud.database();
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        wx.showToast({
          title: '未找到宝宝信息',
          icon: 'none'
        });
        return;
      }
      
      // 创建时间对象
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const [hours, minutes] = time.split(':').map(Number);
      const recordTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
      
      // 准备保存的数据
      const recordData = {
        babyUid: babyUid,
        type: type,
        recordTime: recordTime,
        timeString: time,
        createdAt: new Date()
      };
      
      // 如果是大便，添加详细信息
      if (type === 'stool' || type === 'mixed') {
        recordData.consistency = consistency;
        recordData.color = color;
        recordData.smell = smell;
        recordData.amount = amount;
      }
      
      // 添加备注
      if (notes) {
        recordData.notes = notes;
      }
      
      // 保存到数据库
      await db.collection('bowel_records').add({
        data: recordData
      });
      
      // 隐藏弹窗
      this.hideAddBowelModal();
      
      // 重新加载数据
      await this.fetchDailyRecords(this.data.selectedDate);
      
      wx.hideLoading();
      wx.showToast({
        title: '记录成功',
        icon: 'success'
      });
      
    } catch (error) {
      console.error('保存排便记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  // 打开编辑排便记录弹窗
  openEditBowelModal(e) {
    const { recordId } = e.currentTarget.dataset;
    
    // 从排便记录中找到要编辑的记录
    const record = this.data.bowelRecords.find(r => r._id === recordId);
    
    if (!record) {
      wx.showToast({
        title: '未找到记录',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showEditBowelModal: true,
      editingBowelRecord: { ...record }
    });
  },

  // 隐藏编辑排便记录弹窗
  hideEditBowelModal() {
    this.setData({
      showEditBowelModal: false,
      editingBowelRecord: null
    });
  },

  // 编辑排便记录时间选择
  onEditBowelTimeChange(e) {
    const timeStr = e.detail.value;
    this.setData({
      'editingBowelRecord.timeString': timeStr
    });
  },

  // 编辑排便类型选择
  onEditBowelTypeSelect(e) {
    const { type } = e.currentTarget.dataset;
    this.setData({
      'editingBowelRecord.type': type
    });
  },

  // 编辑排便选项选择
  onEditBowelOptionSelect(e) {
    const { field, value } = e.currentTarget.dataset;
    this.setData({
      [`editingBowelRecord.${field}`]: value
    });
  },

  // 编辑排便记录输入
  onEditBowelInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`editingBowelRecord.${field}`]: value
    });
  },

  // 保存编辑的排便记录
  async saveEditedBowelRecord() {
    const record = this.data.editingBowelRecord;
    
    if (!record || !record._id) {
      wx.showToast({
        title: '记录数据无效',
        icon: 'none'
      });
      return;
    }
    
    // 验证必填字段
    if (!record.timeString) {
      wx.showToast({
        title: '请选择时间',
        icon: 'none'
      });
      return;
    }
    
    if (!record.type) {
      wx.showToast({
        title: '请选择类型',
        icon: 'none'
      });
      return;
    }
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      const db = wx.cloud.database();
      
      // 创建时间对象
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const [hours, minutes] = record.timeString.split(':').map(Number);
      const recordTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
      
      // 准备更新的数据
      const updateData = {
        type: record.type,
        recordTime: recordTime,
        timeString: record.timeString,
        updatedAt: new Date()
      };
      
      // 如果是大便，添加详细信息
      if (record.type === 'stool' || record.type === 'mixed') {
        updateData.consistency = record.consistency || '';
        updateData.color = record.color || '';
        updateData.smell = record.smell || '';
        updateData.amount = record.amount || '';
      } else {
        // 如果改为小便，清除大便相关信息
        updateData.consistency = '';
        updateData.color = '';
        updateData.smell = '';
        updateData.amount = '';
      }
      
      // 更新备注
      updateData.notes = record.notes || '';
      
      // 更新数据库
      await db.collection('bowel_records').doc(record._id).update({
        data: updateData
      });
      
      // 隐藏弹窗
      this.hideEditBowelModal();
      
      // 重新加载数据
      await this.fetchDailyRecords(this.data.selectedDate);
      
      wx.hideLoading();
      wx.showToast({
        title: '更新成功',
        icon: 'success'
      });
      
    } catch (error) {
      console.error('更新排便记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '更新失败',
        icon: 'none'
      });
    }
  },

  // 删除排便记录
  deleteBowelRecord(e) {
    const { recordId } = e.currentTarget.dataset;
    
    // 找到要删除的记录
    const record = this.data.bowelRecords.find(r => r._id === recordId);
    
    if (!record) {
      wx.showToast({
        title: '未找到记录',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showDeleteConfirm: true,
      deleteConfirmMessage: `确定要删除 ${record.timeString} 的${record.typeText}记录吗？`,
      deleteType: 'bowel',
      deleteRecordId: recordId
    });
  },

  // 获取类型显示文本
  getBowelTypeText(type) {
    const typeMap = {
      'stool': '大便',
      'urine': '小便',
      'mixed': '混合'
    };
    return typeMap[type] || type;
  },

  // 获取性状显示文本
  getConsistencyText(consistency) {
    const consistencyMap = {
      'liquid': '水样',
      'loose': '稀便',
      'soft': '糊状',
      'normal': '正常',
      'hard': '干硬'
    };
    return consistencyMap[consistency] || consistency;
  },

  // 获取颜色显示文本
  getColorText(color) {
    const colorMap = {
      'yellow': '黄色',
      'green': '绿色',
      'brown': '褐色',
      'white': '白色',
      'red': '红色',
      'black': '黑色'
    };
    return colorMap[color] || color;
  },

  // 获取气味显示文本
  getSmellText(smell) {
    const smellMap = {
      'normal': '正常',
      'sour': '酸臭',
      'fishy': '腥臭',
      'odorless': '无味'
    };
    return smellMap[smell] || smell;
  },

  // 获取分量显示文本
  getAmountText(amount) {
    const amountMap = {
      'small': '少量',
      'medium': '适量',
      'large': '大量'
    };
    return amountMap[amount] || amount;
  },

  // 体重输入处理
  onWeightInput(e) {
    const value = e.detail.value;
    this.setData({ weight: value });
  },

  // 身高输入处理
  onHeightInput(e) {
    const value = e.detail.value;
    this.setData({ height: value });
  },

  onNaturalCoefficientInput(e) {
    this.setData({ naturalProteinCoefficientInput: e.detail.value });
  },

  onSpecialCoefficientInput(e) {
    this.setData({ specialProteinCoefficientInput: e.detail.value });
  },

  async onNaturalCoefficientBlur(e) {
    await this.handleCoefficientBlur('natural', e.detail.value);
  },

  async onSpecialCoefficientBlur(e) {
    await this.handleCoefficientBlur('special', e.detail.value);
  },

  // 体重输入失焦时保存
  async onWeightBlur(e) {
    const value = (e.detail.value || '').trim();
    if (!value) {
      wx.showToast({ title: '请输入有效体重', icon: 'none' });
      return;
    }
    const weight = parseFloat(value);
    if (isNaN(weight) || weight <= 0) {
      wx.showToast({ title: '请输入有效体重', icon: 'none' });
      return;
    }
    this.setData({ weight });
    try {
      await this.saveBasicInfoFields({ weight });
      wx.showToast({ title: '体重已保存', icon: 'success' });
      this.calculateTotalMilk(this.data.feedingRecords);
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'error' });
      console.error('保存体重失败', err);
    }
  },

  // 身高输入失焦时保存
  async onHeightBlur(e) {
    const value = (e.detail.value || '').trim();
    if (!value) {
      wx.showToast({ title: '请输入有效身高', icon: 'none' });
      return;
    }
    const height = parseFloat(value);
    if (isNaN(height) || height <= 0) {
      wx.showToast({ title: '请输入有效身高', icon: 'none' });
      return;
    }
    this.setData({ height });
    try {
      await this.saveBasicInfoFields({ height });
      wx.showToast({ title: '身高已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'error' });
      console.error('保存身高失败', err);
    }
  },

  computeCalorieMetrics({ totalCalories = 0, weight = this.data.weight, dateStr = this.data.selectedDate } = {}) {
    const parsedWeight = parseFloat(weight);
    const total = roundCalories(totalCalories || 0);
    const perKg = parsedWeight && parsedWeight > 0 ? roundNumber(total / parsedWeight, 1) : '';
    const goalPerKgRange = this.getCalorieGoalPerKgRange(dateStr);
    const goalKcalRange = {
      min: parsedWeight > 0 ? Math.round(parsedWeight * goalPerKgRange.min) : 0,
      max: parsedWeight > 0 ? Math.round(parsedWeight * goalPerKgRange.max) : 0
    };

    return {
      dailyCaloriesTotal: total,
      caloriePerKg: perKg,
      goalKcalRange,
      calorieGoalPerKgRange: goalPerKgRange
    };
  },

  getCalorieGoalPerKgRange(dateStr = this.data.selectedDate) {
    const ageMonths = calculateAgeInMonths(this.data.babyInfo?.birthday, dateStr);
    const range = CALORIE_RANGE_BY_AGE.find(item => typeof ageMonths === 'number' ? ageMonths < item.maxMonths : false);
    if (range) {
      return { min: range.min, max: range.max, label: range.label };
    }
    return { min: 72, max: 109, label: '默认参考' };
  },

  isTodayDate(dateStr = this.data.selectedDate) {
    return !!dateStr && dateStr === this.formatDate(new Date());
  },

  pickHistoricalBasicInfoSnapshot(feedingSnapshot = {}, growthSnapshot = {}) {
    const pickField = (feedingCandidate, growthCandidate, fallbackField) => {
      if (!feedingCandidate && !growthCandidate) {
        return { value: '', source: 'empty', timestamp: 0 };
      }
      if (!feedingCandidate) {
        return growthCandidate;
      }
      if (!growthCandidate) {
        return feedingCandidate;
      }
      if ((growthCandidate.timestamp || 0) >= (feedingCandidate.timestamp || 0)) {
        return growthCandidate;
      }
      return feedingCandidate;
    };

    const weightCandidate = pickField(
      feedingSnapshot.weight ? {
        value: feedingSnapshot.weight,
        source: feedingSnapshot.weightSource || 'history-feeding',
        timestamp: feedingSnapshot.weightTimestamp || 0
      } : null,
      growthSnapshot.weight ? {
        value: growthSnapshot.weight,
        source: growthSnapshot.weightSource || 'history-growth',
        timestamp: growthSnapshot.weightTimestamp || 0
      } : null
    );

    const heightCandidate = pickField(
      feedingSnapshot.height ? {
        value: feedingSnapshot.height,
        source: feedingSnapshot.heightSource || 'history-feeding',
        timestamp: feedingSnapshot.heightTimestamp || 0
      } : null,
      growthSnapshot.height ? {
        value: growthSnapshot.height,
        source: growthSnapshot.heightSource || 'history-growth',
        timestamp: growthSnapshot.heightTimestamp || 0
      } : null
    );

    return {
      weight: weightCandidate.value,
      height: heightCandidate.value,
      weightSource: weightCandidate.source,
      heightSource: heightCandidate.source,
      weightTimestamp: weightCandidate.timestamp,
      heightTimestamp: heightCandidate.timestamp
    };
  },

  async loadHistoricalBasicInfoSnapshot(dateStr = this.data.selectedDate, babyUid) {
    if (!babyUid || !dateStr) {
      return this.pickHistoricalBasicInfoSnapshot();
    }

    const db = wx.cloud.database();
    const _ = db.command;
    const [year, month, day] = dateStr.split('-').map(Number);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
    const pageSize = 100;

    const feedingSnapshot = {};
    let feedingSkip = 0;
    let moreFeedings = true;
    while (moreFeedings && (!feedingSnapshot.weight || !feedingSnapshot.height)) {
      const res = await db.collection('feeding_records')
        .where({
          babyUid,
          date: _.lte(endOfDay)
        })
        .orderBy('date', 'desc')
        .skip(feedingSkip)
        .limit(pageSize)
        .get();

      const batch = (res.data || []).sort((a, b) => {
        const dateDiff = getDateTimestamp(b?.date) - getDateTimestamp(a?.date);
        if (dateDiff !== 0) return dateDiff;
        return getDateTimestamp(b?.updatedAt) - getDateTimestamp(a?.updatedAt);
      });

      batch.forEach((record) => {
        const basicInfo = record?.basicInfo || {};
        if (!feedingSnapshot.weight && basicInfo.weight !== '' && basicInfo.weight !== null && basicInfo.weight !== undefined) {
          feedingSnapshot.weight = basicInfo.weight;
          feedingSnapshot.weightSource = 'history-feeding';
          feedingSnapshot.weightTimestamp = getDateTimestamp(record?.date);
        }
        if (!feedingSnapshot.height && basicInfo.height !== '' && basicInfo.height !== null && basicInfo.height !== undefined) {
          feedingSnapshot.height = basicInfo.height;
          feedingSnapshot.heightSource = 'history-feeding';
          feedingSnapshot.heightTimestamp = getDateTimestamp(record?.date);
        }
      });

      moreFeedings = batch.length === pageSize;
      feedingSkip += pageSize;
    }

    const growthSnapshot = {};
    let growthSkip = 0;
    let moreGrowth = true;
    while (moreGrowth && (!growthSnapshot.weight || !growthSnapshot.height)) {
      const res = await db.collection('growth_records')
        .where({
          babyUid,
          recordDate: _.lte(endOfDay)
        })
        .orderBy('recordDate', 'desc')
        .skip(growthSkip)
        .limit(pageSize)
        .get();

      const batch = (res.data || []).sort((a, b) => {
        const dateDiff = getDateTimestamp(b?.recordDate) - getDateTimestamp(a?.recordDate);
        if (dateDiff !== 0) return dateDiff;
        return getDateTimestamp(b?.updatedAt) - getDateTimestamp(a?.updatedAt);
      });

      batch.forEach((record) => {
        if (!growthSnapshot.weight && record?.weight !== '' && record?.weight !== null && record?.weight !== undefined) {
          growthSnapshot.weight = record.weight;
          growthSnapshot.weightSource = 'history-growth';
          growthSnapshot.weightTimestamp = getDateTimestamp(record?.recordDate);
        }
        if (!growthSnapshot.height && record?.length !== '' && record?.length !== null && record?.length !== undefined) {
          growthSnapshot.height = record.length;
          growthSnapshot.heightSource = 'history-growth';
          growthSnapshot.heightTimestamp = getDateTimestamp(record?.recordDate);
        }
      });

      moreGrowth = batch.length === pageSize;
      growthSkip += pageSize;
    }

    return this.pickHistoricalBasicInfoSnapshot(feedingSnapshot, growthSnapshot);
  },

  resolveBasicInfoSnapshot(record = {}, dateStr = this.data.selectedDate, historicalSnapshot = {}) {
    const basicInfo = record?.basicInfo || {};
    const recordWeight = basicInfo.weight !== undefined ? basicInfo.weight : record?.weight;
    const recordHeight = basicInfo.height !== undefined ? basicInfo.height : record?.height;
    const globalWeight = this.data.babyInfo?.weight ?? '';
    const globalHeight = this.data.babyInfo?.height ?? '';
    const allowGlobalFallback = this.isTodayDate(dateStr);

    const hasRecordWeight = recordWeight !== undefined && recordWeight !== null && recordWeight !== '';
    const hasRecordHeight = recordHeight !== undefined && recordHeight !== null && recordHeight !== '';
    const hasGlobalWeight = globalWeight !== undefined && globalWeight !== null && globalWeight !== '';
    const hasGlobalHeight = globalHeight !== undefined && globalHeight !== null && globalHeight !== '';

    return {
      weight: hasRecordWeight ? recordWeight : (historicalSnapshot.weight !== '' && historicalSnapshot.weight !== undefined && historicalSnapshot.weight !== null
        ? historicalSnapshot.weight
        : (allowGlobalFallback && hasGlobalWeight ? globalWeight : '')),
      height: hasRecordHeight ? recordHeight : (historicalSnapshot.height !== '' && historicalSnapshot.height !== undefined && historicalSnapshot.height !== null
        ? historicalSnapshot.height
        : (allowGlobalFallback && hasGlobalHeight ? globalHeight : '')),
      weightSource: hasRecordWeight ? 'record' : (historicalSnapshot.weightSource || (allowGlobalFallback && hasGlobalWeight ? 'global' : 'empty')),
      heightSource: hasRecordHeight ? 'record' : (historicalSnapshot.heightSource || (allowGlobalFallback && hasGlobalHeight ? 'global' : 'empty'))
    };
  },

  buildPersistedBasicInfoForDate(updates = {}, dateStr = this.data.selectedDate) {
    const weightValue = Object.prototype.hasOwnProperty.call(updates, 'weight')
      ? updates.weight
      : (this.data.weightSource === 'record' && this.isNumberValue(this.data.weight) ? Number(this.data.weight) : '');
    const heightValue = Object.prototype.hasOwnProperty.call(updates, 'height')
      ? updates.height
      : (this.data.heightSource === 'record' && this.isNumberValue(this.data.height) ? Number(this.data.height) : '');

    return {
      weight: weightValue,
      height: heightValue,
      naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
      specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
      ...updates
    };
  },

  inferNaturalMilkType(feedings = this.data.feedings || []) {
    if (!Array.isArray(feedings) || feedings.length === 0) {
      return 'formula';
    }
    return feedings.some(item => item?.naturalMilkType === 'breast') ? 'breast' : 'formula';
  },

  buildSummaryPreviewData(overrides = {}) {
    const snapshot = {
      formattedSelectedDate: overrides.formattedSelectedDate ?? this.data.formattedSelectedDate,
      weight: overrides.weight ?? this.data.weight,
      height: overrides.height ?? this.data.height,
      totalMilk: overrides.totalMilk ?? this.data.totalMilk,
      dailyCaloriesTotal: overrides.dailyCaloriesTotal ?? this.data.dailyCaloriesTotal,
      caloriePerKg: overrides.caloriePerKg ?? this.data.caloriePerKg,
      proteinSummaryDisplay: overrides.proteinSummaryDisplay ?? this.data.proteinSummaryDisplay,
      naturalProteinCoefficient: pickFirstFilled(
        overrides.naturalProteinCoefficient,
        this.data.naturalProteinCoefficientInput,
        this.data.naturalProteinCoefficient
      ),
      specialProteinCoefficient: pickFirstFilled(
        overrides.specialProteinCoefficient,
        this.data.specialProteinCoefficientInput,
        this.data.specialProteinCoefficient
      ),
      calorieGoalPerKgRange: overrides.calorieGoalPerKgRange ?? this.data.calorieGoalPerKgRange,
      macroRatios: overrides.macroRatios ?? this.data.macroRatios,
      fatRatioPopupLines: overrides.fatRatioPopupLines ?? this.data.fatRatioPopupLines,
      intakeOverview: overrides.intakeOverview ?? this.data.intakeOverview,
      naturalMilkType: overrides.naturalMilkType ?? this.inferNaturalMilkType(overrides.feedings ?? this.data.feedings)
    };
    return buildDataRecordsSummaryPreview(snapshot);
  },

  updateSummaryPreview(overrides = {}) {
    this.setData({
      summaryPreview: this.buildSummaryPreviewData(overrides)
    });
  },

  computeProteinSummaryDisplay(intakeOverview = this.data.intakeOverview) {
    const natural = ((intakeOverview?.milk?.normal?.protein || 0) + (intakeOverview?.food?.naturalProtein || 0)).toFixed(2);
    const special = ((intakeOverview?.milk?.special?.protein || 0) + (intakeOverview?.food?.specialProtein || 0)).toFixed(2);
    const total = (
      (intakeOverview?.milk?.normal?.protein || 0) +
      (intakeOverview?.milk?.special?.protein || 0) +
      (intakeOverview?.food?.naturalProtein || 0) +
      (intakeOverview?.food?.specialProtein || 0) +
      (intakeOverview?.treatment?.protein || 0)
    ).toFixed(2);
    return { natural, special, total };
  },

  computeMacroRatios(summary = this.data.macroSummary) {
    const protein = Number(summary?.protein) || 0;
    const carbs = Number(summary?.carbs) || 0;
    const fat = Number(summary?.fat) || 0;
    const proteinEnergy = protein * 4;
    const carbsEnergy = carbs * 4;
    const fatEnergy = fat * 9;
    const total = proteinEnergy + carbsEnergy + fatEnergy;
    if (!total) {
      return { protein: 0, carbs: 0, fat: 0 };
    }
    return {
      protein: roundNumber((proteinEnergy / total) * 100, 1),
      carbs: roundNumber((carbsEnergy / total) * 100, 1),
      fat: roundNumber((fatEnergy / total) * 100, 1)
    };
  },

  getFatRatioRangeText(dateStr = this.data.selectedDate, birthday = this.data.babyInfo?.birthday) {
    const ageMonths = calculateAgeInMonths(birthday, dateStr);
    if (ageMonths === null) return '';
    if (ageMonths <= 6) return '45%-50%';
    if (ageMonths >= 72) return '25%-30%';
    if (ageMonths >= 12 && ageMonths < 24) return '30%-35%';
    return '35%-40%';
  },

  showFatRatioPopup() {
    this.setData({ showFatRatioPopup: true });
  },

  hideFatRatioPopup() {
    this.setData({ showFatRatioPopup: false });
  },

  toggleMetricInfo(e) {
    const { label = '', title = '', lines = [] } = e.currentTarget.dataset || {};
    if (!label || !lines.length) return;
    if (this.data.activeMetricInfoLabel === label) {
      this.setData({
        activeMetricInfoLabel: '',
        activeMetricInfoTitle: '',
        activeMetricInfoLines: []
      });
      return;
    }
    this.setData({
      activeMetricInfoLabel: label,
      activeMetricInfoTitle: title,
      activeMetricInfoLines: lines
    });
  },

  hideMetricInfo() {
    this.setData({
      activeMetricInfoLabel: '',
      activeMetricInfoTitle: '',
      activeMetricInfoLines: []
    });
  },

  stopBubble() {},

  openBasicInfoEditor(e) {
    const { field = '', label = '', unit = '' } = e.currentTarget.dataset || {};
    if (!field) return;
    const currentValue = this.data[field];
    this.setData({
      showBasicInfoModal: true,
      editingField: field,
      editingLabel: label,
      editingUnit: unit,
      editBasicInfoValue: currentValue === '--' ? '' : String(currentValue || '')
    });
  },

  closeBasicInfoModal() {
    this.setData({
      showBasicInfoModal: false,
      editingField: '',
      editingLabel: '',
      editingUnit: '',
      editBasicInfoValue: ''
    });
  },

  onBasicInfoModalInput(e) {
    this.setData({
      editBasicInfoValue: e.detail.value || ''
    });
  },

  async confirmBasicInfoEdit() {
    const { editingField, editingLabel, editBasicInfoValue, selectedDate } = this.data;
    const rawValue = String(editBasicInfoValue || '').trim();
    if (!editingField) return;
    if (!rawValue) {
      wx.showToast({ title: `请输入有效${editingLabel}`, icon: 'none' });
      return;
    }
    const parsed = parseFloat(rawValue);
    if (Number.isNaN(parsed) || parsed <= 0) {
      wx.showToast({ title: `请输入有效${editingLabel}`, icon: 'none' });
      return;
    }

    const nextValue = roundNumber(parsed, 2);
    const nextState = {
      [editingField]: nextValue,
      ...(editingField === 'weight' ? { weightSource: 'record' } : { heightSource: 'record' })
    };

    if (editingField === 'weight') {
      const nextOverview = calculateIntakeOverview(
        this.data.feedings || [],
        this.data.intakes || [],
        nextValue,
        this.data.nutritionSettings || {},
        this.data.treatmentRecords || []
      );
      const nextProteinSummary = this.computeProteinSummaryDisplay(nextOverview);
      const calorieMetrics = this.computeCalorieMetrics({
        totalCalories: this.data.macroSummary?.calories || 0,
        weight: nextValue,
        dateStr: selectedDate
      });
      Object.assign(nextState, {
        intakeOverview: nextOverview,
        proteinSummaryDisplay: nextProteinSummary,
        caloriePerKg: calorieMetrics.caloriePerKg,
        dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
        goalKcalRange: calorieMetrics.goalKcalRange,
        calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange
      });
    }

    this.setData({
      ...nextState,
      showBasicInfoModal: false,
      editingField: '',
      editingLabel: '',
      editingUnit: '',
      editBasicInfoValue: '',
      summaryPreview: this.buildSummaryPreviewData(nextState)
    });

    if (editingField === 'weight') {
      this.calculateTotalMilk(this.data.feedingRecords || []);
    } else {
      this.updateSummaryPreview({ height: nextValue });
    }

    try {
      await this.saveBasicInfoFields({ [editingField]: nextValue });
      wx.showToast({ title: `${editingLabel}已保存`, icon: 'success' });
    } catch (err) {
      console.error(`保存${editingLabel}失败`, err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async handleCoefficientBlur(type, rawValue) {
    const value = (rawValue || '').trim();
    const dataKey = type === 'natural'
      ? 'naturalProteinCoefficientInput'
      : 'specialProteinCoefficientInput';
    const fieldKey = type === 'natural'
      ? 'naturalProteinCoefficient'
      : 'specialProteinCoefficient';

    if (value && (isNaN(parseFloat(value)) || Number(value) < 0)) {
      wx.showToast({ title: '请输入有效数值', icon: 'none' });
      return;
    }

    this.setData({ [dataKey]: value });

    try {
      await this.saveBasicInfoFields({ [fieldKey]: value });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      console.error('保存蛋白系数失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async saveBasicInfoFields(updates = {}) {
    if (!updates || Object.keys(updates).length === 0) {
      return;
    }
    const selectedDate = this.data.selectedDate;
    if (!selectedDate) return;

    const db = wx.cloud.database();
    const _ = db.command;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
    const appInstance = getApp();
    const babyUid = appInstance.globalData.babyUid || wx.getStorageSync('baby_uid');

    if (!babyUid) return;

    const query = {
      date: _.gte(startOfDay).and(_.lte(endOfDay)),
      babyUid: babyUid
    };

    const res = await db.collection('feeding_records').where(query).get();
    const payload = Object.keys(updates).reduce((acc, key) => {
      acc[`basicInfo.${key}`] = updates[key];
      return acc;
    }, { updatedAt: db.serverDate() });

    const existingRecord = pickPrimaryFeedingRecord(res.data || []);
    if (existingRecord?._id) {
      await db.collection('feeding_records').doc(existingRecord._id).update({
        data: payload
      });
      if (!this.data.recordId) {
        this.setData({ recordId: existingRecord._id });
      }
      return;
    }

    const basicInfo = this.buildPersistedBasicInfoForDate(updates, selectedDate);

    const addRes = await db.collection('feeding_records').add({
      data: {
        date: startOfDay,
        basicInfo,
        feedings: [],
        medicationRecords: [],
        babyUid: babyUid,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    this.setData({ recordId: addRes._id });
  },

  isNumberValue(value) {
    if (value === null || value === undefined || value === '') {
      return false;
    }
    const parsed = Number(value);
    return !isNaN(parsed);
  },

  navigateToNutritionSettings() {
    wx.navigateTo({
      url: '/pages/nutrition-settings/index'
    });
  },

  isNutritionSettingsComplete(settings) {
    if (!settings) return false;
    return this.isBreastSettingsComplete(settings) ||
      this.isFormulaSettingsComplete(settings) ||
      this.isSpecialSettingsComplete(settings);
  },

  isFormulaSettingsComplete(settings = this.data.nutritionSettings) {
    if (!settings) return false;
    return Number(settings.formula_milk_protein) > 0 &&
           Number(settings.formula_milk_calories) > 0 &&
           this.isValidRatio(settings.formula_milk_ratio);
  },

  isBreastSettingsComplete(settings = this.data.nutritionSettings) {
    if (!settings) return false;
    return Number(settings.natural_milk_protein) > 0;
  },

  isSpecialSettingsComplete(settings = this.data.nutritionSettings) {
    if (!settings) return false;
    return Number(settings.special_milk_protein) > 0 &&
      this.isValidRatio(settings.special_milk_ratio);
  },

  isValidRatio(ratio) {
    if (!ratio) return false;
    const powder = Number(ratio.powder);
    const water = Number(ratio.water);
    return !isNaN(powder) && powder > 0 && !isNaN(water) && water > 0;
  },

  getFeedingDataByScope(scope) {
    const dataMap = {
      new: this.data.newFeeding,
      edit: this.data.editingFeeding
    };
    return dataMap[scope] || {};
  },

  getSpecialMilkVolumeFromFeeding(feeding) {
    if (!feeding) return 0;
    const specialMilk = parseFloat(feeding.specialMilkVolume);
    if (!isNaN(specialMilk)) {
      return specialMilk;
    }
    const naturalMilk = parseFloat(feeding.naturalMilkVolume);
    const totalVolume = parseFloat(feeding.totalVolume);
    if (isNaN(naturalMilk) || isNaN(totalVolume)) {
      return 0;
    }
    return Math.max(0, totalVolume - naturalMilk);
  },

  ensureFeedingSettings(scope, feedingOverride) {
    const settings = this.data.nutritionSettings;
    const feeding = feedingOverride || this.getFeedingDataByScope(scope);
    const naturalMilkType = feeding?.naturalMilkType || 'breast';

    if (naturalMilkType === 'formula') {
      if (!this.isFormulaSettingsComplete(settings)) {
        this.promptNutritionSetup(true, '请先在“配奶管理”中填写普奶冲配参数，再记录普奶数据。');
        return false;
      }
    } else if (!this.isBreastSettingsComplete(settings)) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写母乳蛋白浓度，再记录母乳数据。');
      return false;
    }

    const specialMilkVolume = this.getSpecialMilkVolumeFromFeeding(feeding);
    if (specialMilkVolume > 0 && !this.isSpecialSettingsComplete(settings)) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写特奶冲配参数，再记录特奶数据。');
      return false;
    }

    return true;
  },

  promptNutritionSetup(force = false, customMessage) {
    if (this.data.promptingNutrition) return;
    if (!force && this.data.hasShownNutritionPrompt) {
      return;
    }
    this.setData({ promptingNutrition: true, hasShownNutritionPrompt: true });
    wx.showModal({
      title: '完善配奶设置',
      content: customMessage || '请先在“配奶管理”中补充配奶参数，再记录喂奶数据。',
      confirmText: '去设置',
      cancelText: '稍后再说',
      success: (res) => {
        if (res.confirm) {
          this.navigateToNutritionSettings();
        }
      },
      complete: () => {
        this.setData({ promptingNutrition: false });
      }
    });
  }
}); 
