const { buildDailyNutritionMetricFromSummary } = require('./search-core/dailyMetrics');
const ReportModel = require('../models/report');
const { buildReportDisplay, buildIndicatorDisplay, hasReportValue, readReportNumber, formatReportValue } = require('./reportDisplay');
const { toExactReportNumber } = require('./reportNumeric');
const { areReportUnitsComparable } = require('./reportUnits');
const { calculator: feedingCalculator } = require('./feedingUtils');
const {
  mergeTreatmentIntoMacroSummary,
  mergeTreatmentIntoOverview
} = require('./treatmentUtils');
const {
  resolveFoodIntakePremiumProteinSplit
} = require('./recipeNutritionUtils');

const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_SPECIAL_MILK_PROTEIN = 13.1;
const DEFAULT_SPECIAL_MILK_PROTEIN_ML = 1.97;
const BREAST_MILK_KCAL = 0.67;
const SPECIAL_MILK_KCAL = 0.70;

const KEY_METRICS_BY_REPORT_TYPE = {
  [ReportModel.REPORT_TYPES.URINE_MS]: ['methylmalonic_acid', 'methylcitric_acid_1', 'methylcitric_acid_2', 'lactate', 'hydroxypropionic_acid', 'hydroxybutyric_acid'],
  [ReportModel.REPORT_TYPES.BLOOD_MS]: ['c3', 'c3_c2', 'c3_c0', 'c0'],
  [ReportModel.REPORT_TYPES.BLOOD_GAS]: ['ph', 'hco3', 'be', 'lactate'],
  [ReportModel.REPORT_TYPES.BLOOD_CBC]: ['hgb', 'plt', 'wbc'],
  [ReportModel.REPORT_TYPES.BLOOD_CBC_CRP]: ['crp', 'wbc', 'hgb', 'plt', 'neut_pct'],
  [ReportModel.REPORT_TYPES.BLOOD_BIOCHEM]: ['alt', 'ast', 'crea', 'k', 'glu'],
  [ReportModel.REPORT_TYPES.BLOOD_AMMONIA]: ['ammonia']
};

const TREND_OVERLAY_LABELS = ['可结合查看：天然蛋白系数', '可结合查看：热卡系数'];
const REPORT_TYPE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: ReportModel.REPORT_TYPES.BLOOD_MS, label: '血串联' },
  { key: ReportModel.REPORT_TYPES.URINE_MS, label: '尿串联' },
  { key: ReportModel.REPORT_TYPES.BLOOD_GAS, label: '血气' },
  { key: ReportModel.REPORT_TYPES.BLOOD_CBC, label: '血常规' },
  { key: ReportModel.REPORT_TYPES.BLOOD_CBC_CRP, label: '血五分类CRP' },
  { key: ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, label: '大生化' },
  { key: ReportModel.REPORT_TYPES.BLOOD_AMMONIA, label: '血氨' }
];

function formatDirectionChangeText(direction = 'flat', delta = '') {
  const normalizedDelta = String(delta || '').replace(/^[+-]/, '');
  if (direction === 'up') return `上升 ${normalizedDelta}`;
  if (direction === 'down') return `下降 ${normalizedDelta}`;
  return '持平';
}

function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(num * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.round(num);
}

function toDateKey(dateInput) {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateKey(parsed);
    }
    return '';
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(dateKey, offset) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + offset);
  return formatDateKey(date);
}

function daysBetweenInclusive(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey).getTime();
  const end = parseDateKey(endDateKey).getTime();
  if (!startDateKey || !endDateKey || Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 0;
  }
  return Math.floor((end - start) / 86400000) + 1;
}

function calculateFormulaPowder(naturalMilkVolume, nutritionSettings = {}) {
  if (!naturalMilkVolume || naturalMilkVolume <= 0) return 0;
  const ratioPowder = Number(nutritionSettings.formula_milk_ratio?.powder);
  const ratioWater = Number(nutritionSettings.formula_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) return 0;
  return Math.round((naturalMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function calculateSpecialMilkPowder(specialMilkVolume, nutritionSettings = {}) {
  if (!specialMilkVolume || specialMilkVolume <= 0) return 0;
  const ratioPowder = Number(nutritionSettings.special_milk_ratio?.powder);
  const ratioWater = Number(nutritionSettings.special_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) return 0;
  return Math.round((specialMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function createEmptyV2MilkGroup() {
  return { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0 };
}

function addV2MilkGroup(target, source = {}) {
  target.volume += Number(source.volume) || 0;
  target.calories += Number(source.calories) || 0;
  target.protein += Number(source.protein) || 0;
  target.carbs += Number(source.carbs) || 0;
  target.fat += Number(source.fat) || 0;
}

function aggregateMilkComponentTotals(feedings = [], nutritionSettings = {}) {
  return (feedings || []).reduce((totals, feeding) => {
    // v2 喂奶记录自带营养快照，单独按快照累加，不进旧体积重算桶（避免用旧配奶参数错算）
    if (feeding && feeding.isV2FeedingRecord) {
      const overview = feeding.milkOverviewSnapshot || {};
      addV2MilkGroup(totals.v2.normal, overview.normal);
      addV2MilkGroup(totals.v2.special, overview.special);
      return totals;
    }

    const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
    const naturalType = (feeding.naturalMilkType || 'breast') === 'formula' ? 'formula' : 'breast';

    if (naturalVolume > 0) {
      if (naturalType === 'formula') {
        totals.formulaVolume += naturalVolume;
        totals.formulaPowderWeight += feedingCalculator.getFormulaMilkPowder(feeding, nutritionSettings);
      } else {
        totals.breastVolume += naturalVolume;
      }
    }

    const specialVolume = feedingCalculator.getSpecialMilkVolume(feeding);
    if (specialVolume > 0) {
      totals.specialVolume += specialVolume;
      totals.specialPowderWeight += feedingCalculator.getSpecialMilkPowder(feeding, nutritionSettings);
    }

    return totals;
  }, {
    breastVolume: 0,
    formulaVolume: 0,
    formulaPowderWeight: 0,
    specialVolume: 0,
    specialPowderWeight: 0,
    v2: {
      normal: createEmptyV2MilkGroup(),
      special: createEmptyV2MilkGroup()
    }
  });
}

function calculateMilkNutrition(feeding, nutritionSettings = {}) {
  const naturalMilkVolume = parseFloat(feeding.naturalMilkVolume) || 0;
  const specialMilkVolume = feedingCalculator.getSpecialMilkVolume(feeding);
  const specialPowderWeight = feedingCalculator.getSpecialMilkPowder(feeding, nutritionSettings);
  const formulaPowderWeight = feedingCalculator.getFormulaMilkPowder(feeding, nutritionSettings);
  const naturalMilkType = feeding.naturalMilkType || 'breast';

  let naturalProtein = 0;
  let naturalFat = 0;
  let naturalCarbs = 0;
  let naturalCalories = naturalMilkVolume * BREAST_MILK_KCAL;
  if (naturalMilkType === 'formula') {
    const powderWeight = formulaPowderWeight;
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
    const powderWeight = ratioPowder > 0 && ratioWater > 0 ? specialMilkVolume * ratioPowder / ratioWater : 0;
    if (powderWeight > 0 && specialProteinPer100g > 0) {
      specialProtein = (powderWeight * specialProteinPer100g) / 100;
      specialFat = specialFatPer100g > 0 ? (powderWeight * specialFatPer100g) / 100 : 0;
      specialCarbs = specialCarbsPer100g > 0 ? (powderWeight * specialCarbsPer100g) / 100 : 0;
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
    carbs: roundNumber(naturalCarbs + specialCarbs, 2),
    fat: roundNumber(naturalFat + specialFat, 2)
  };
}

function normalizeIntakes(intakes = []) {
  if (!Array.isArray(intakes)) return [];
  return intakes.map((item) => {
    const nutrition = item?.nutrition || {};
    const protein = Number(nutrition.protein) || 0;
    const proteinSource = item?.proteinSource || (item?.milkType === 'special_formula' ? 'special' : 'natural');
    return {
      ...item,
      type: item?.type === 'milk' ? 'milk' : (item?.milkType ? 'milk' : 'food'),
      nutrition: {
        calories: roundCalories(Number(nutrition.calories) || 0),
        protein,
        carbs: Number(nutrition.carbs) || 0,
        fat: Number(nutrition.fat) || 0
      },
      naturalProtein: typeof item?.naturalProtein === 'number' ? item.naturalProtein : (proteinSource === 'special' ? 0 : protein),
      specialProtein: typeof item?.specialProtein === 'number' ? item.specialProtein : (proteinSource === 'special' ? protein : 0),
      proteinSource
    };
  });
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
    treatment: { count: 0, groupCount: 0, itemCount: 0, nutritionItemCount: 0, totalCalories: 0, carbs: 0, protein: 0, fat: 0 }
  };
}

function calculateIntakeOverview(feedings = [], intakes = [], weight = 0, nutritionSettings = {}, treatmentRecords = []) {
  const overview = createEmptyIntakeOverview();
  const addMilkStats = (group, values = {}) => {
    group.volume += values.volume || 0;
    group.calories += Number(values.calories) || 0;
    group.protein += Number(values.protein) || 0;
    group.carbs += Number(values.carbs) || 0;
    group.fat += Number(values.fat) || 0;
  };

  const milkTotals = aggregateMilkComponentTotals(feedings, nutritionSettings);

  if (milkTotals.breastVolume > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: milkTotals.breastVolume,
      naturalMilkType: 'breast',
      specialMilkVolume: 0,
      specialMilkPowder: 0
    }, nutritionSettings);
    addMilkStats(overview.milk.normal, {
      volume: milkTotals.breastVolume,
      calories: nutrition.calories,
      protein: nutrition.naturalProtein,
      carbs: nutrition.carbs,
      fat: nutrition.fat
    });
  }

  if (milkTotals.formulaVolume > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: milkTotals.formulaVolume,
      naturalMilkType: 'formula',
      formulaPowderWeight: milkTotals.formulaPowderWeight,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    }, nutritionSettings);
    addMilkStats(overview.milk.normal, {
      volume: milkTotals.formulaVolume,
      calories: nutrition.calories,
      protein: nutrition.naturalProtein,
      carbs: nutrition.carbs,
      fat: nutrition.fat
    });
  }

  if (milkTotals.specialVolume > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: 'breast',
      specialMilkVolume: milkTotals.specialVolume,
      specialMilkPowder: milkTotals.specialPowderWeight
    }, nutritionSettings);
    addMilkStats(overview.milk.special, {
      volume: milkTotals.specialVolume,
      calories: nutrition.calories,
      protein: nutrition.specialProtein,
      carbs: nutrition.carbs,
      fat: nutrition.fat
    });
  }

  // v2 喂奶记录直接用自带营养快照累加（普奶/特奶分组）
  addMilkStats(overview.milk.normal, milkTotals.v2.normal);
  addMilkStats(overview.milk.special, milkTotals.v2.special);

  (intakes || []).forEach((intake) => {
    const nutrition = intake.nutrition || {};
    if (intake.type === 'milk') {
      return;
    }
    overview.food.count += 1;
    overview.food.totalCalories += Number(nutrition.calories) || 0;
    overview.food.protein += Number(nutrition.protein) || 0;
    overview.food.naturalProtein += Number(intake.naturalProtein) || 0;
    overview.food.specialProtein += Number(intake.specialProtein) || 0;
    overview.food.carbs += Number(nutrition.carbs) || 0;
    overview.food.fat += Number(nutrition.fat) || 0;
  });

  overview.milk.normal.volume = roundNumber(overview.milk.normal.volume, 2);
  overview.milk.normal.calories = roundCalories(overview.milk.normal.calories);
  overview.milk.normal.protein = roundNumber(overview.milk.normal.protein, 2);
  overview.milk.normal.carbs = roundNumber(overview.milk.normal.carbs, 2);
  overview.milk.normal.fat = roundNumber(overview.milk.normal.fat, 2);
  overview.milk.special.volume = roundNumber(overview.milk.special.volume, 2);
  overview.milk.special.calories = roundCalories(overview.milk.special.calories);
  overview.milk.special.protein = roundNumber(overview.milk.special.protein, 2);
  overview.milk.special.carbs = roundNumber(overview.milk.special.carbs, 2);
  overview.milk.special.fat = roundNumber(overview.milk.special.fat, 2);
  overview.milk.totalCalories = roundCalories(overview.milk.normal.calories + overview.milk.special.calories);

  const parsedWeight = Number(weight) || 0;
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

function calculateMacroSummary(intakes = [], feedings = [], nutritionSettings = {}, treatmentRecords = []) {
  const summary = {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    premiumProtein: 0,
    regularProtein: 0,
    carbs: 0,
    fat: 0
  };

  (intakes || []).forEach((intake) => {
    const nutrition = intake.nutrition || {};
    summary.calories += Number(nutrition.calories) || 0;
    summary.protein += Number(nutrition.protein) || 0;
    summary.naturalProtein += Number(intake.naturalProtein) || 0;
    summary.specialProtein += Number(intake.specialProtein) || 0;
    const naturalP = Number(intake.naturalProtein) || 0;
    if (naturalP > 0) {
      if (intake.type === 'milk' || intake.milkType) {
        summary.premiumProtein += naturalP;
      } else {
        const qualitySplit = resolveFoodIntakePremiumProteinSplit(intake, naturalP);
        summary.premiumProtein += Number(qualitySplit.premiumProtein) || 0;
        summary.regularProtein += Number(qualitySplit.regularProtein) || 0;
      }
    }
    summary.carbs += Number(nutrition.carbs) || 0;
    summary.fat += Number(nutrition.fat) || 0;
  });

  const milkTotals = aggregateMilkComponentTotals(feedings, nutritionSettings);

  const applyMilkNutrition = (feeding) => {
    const nutrition = calculateMilkNutrition(feeding, nutritionSettings);
    summary.calories += nutrition.calories;
    summary.protein += nutrition.protein;
    summary.naturalProtein += nutrition.naturalProtein;
    summary.specialProtein += nutrition.specialProtein;
    summary.premiumProtein += nutrition.naturalProtein;
    summary.carbs += nutrition.carbs;
    summary.fat += nutrition.fat;
  };

  if (milkTotals.breastVolume > 0) {
    applyMilkNutrition({ naturalMilkVolume: milkTotals.breastVolume, naturalMilkType: 'breast', specialMilkVolume: 0, specialMilkPowder: 0 });
  }
  if (milkTotals.formulaVolume > 0) {
    applyMilkNutrition({
      naturalMilkVolume: milkTotals.formulaVolume,
      naturalMilkType: 'formula',
      formulaPowderWeight: milkTotals.formulaPowderWeight,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    });
  }
  if (milkTotals.specialVolume > 0) {
    applyMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: 'breast',
      specialMilkVolume: milkTotals.specialVolume,
      specialMilkPowder: milkTotals.specialPowderWeight
    });
  }

  // v2 喂奶记录直接用自带营养快照累加，不再用旧配奶参数重算
  const v2Normal = milkTotals.v2.normal;
  const v2Special = milkTotals.v2.special;
  summary.calories += (Number(v2Normal.calories) || 0) + (Number(v2Special.calories) || 0);
  summary.naturalProtein += Number(v2Normal.protein) || 0;
  summary.specialProtein += Number(v2Special.protein) || 0;
  summary.premiumProtein += Number(v2Normal.protein) || 0;
  summary.protein += (Number(v2Normal.protein) || 0) + (Number(v2Special.protein) || 0);
  summary.carbs += (Number(v2Normal.carbs) || 0) + (Number(v2Special.carbs) || 0);
  summary.fat += (Number(v2Normal.fat) || 0) + (Number(v2Special.fat) || 0);

  summary.calories = roundCalories(summary.calories);
  summary.protein = roundNumber(summary.protein, 2);
  summary.naturalProtein = roundNumber(summary.naturalProtein, 2);
  summary.specialProtein = roundNumber(summary.specialProtein, 2);
  summary.premiumProtein = roundNumber(summary.premiumProtein, 2);
  summary.regularProtein = roundNumber(summary.regularProtein, 2);
  summary.carbs = roundNumber(summary.carbs, 2);
  summary.fat = roundNumber(summary.fat, 2);
  return mergeTreatmentIntoMacroSummary(summary, treatmentRecords);
}

function getBasicInfoCompleteness(record = {}) {
  const basicInfo = record.basicInfo || {};
  let count = 0;
  ['weight', 'height', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient'].forEach((key) => {
    const value = basicInfo[key];
    if (value !== '' && value !== null && value !== undefined) {
      count += 1;
    }
  });
  return count;
}

function getDateTimestamp(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ts = date.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function scoreFeedingRecord(record = {}) {
  const feedingsCount = Array.isArray(record.feedings) ? record.feedings.length : 0;
  const intakesCount = Array.isArray(record.intakes) ? record.intakes.length : 0;
  const basicInfoCompleteness = getBasicInfoCompleteness(record);
  return (
    feedingsCount * 1000000 +
    intakesCount * 1000000 +
    basicInfoCompleteness * 10 +
    Math.max(getDateTimestamp(record.updatedAt), getDateTimestamp(record.createdAt), getDateTimestamp(record.date)) / 1000000000000
  );
}

function pickPrimaryFeedingRecord(records = []) {
  if (!Array.isArray(records) || records.length === 0) return null;
  return [...records].sort((a, b) => scoreFeedingRecord(b) - scoreFeedingRecord(a))[0];
}

function mergeBasicInfoFromRecords(records = []) {
  if (!Array.isArray(records) || records.length === 0) return {};
  return [...records]
    .sort((a, b) => getBasicInfoCompleteness(b) - getBasicInfoCompleteness(a))
    .reduce((merged, record) => {
      const basicInfo = record?.basicInfo || {};
      Object.keys(basicInfo).forEach((key) => {
        const value = basicInfo[key];
        if (merged[key] === undefined && value !== '' && value !== null && value !== undefined) {
          merged[key] = value;
        }
      });
      return merged;
    }, {});
}

function dedupeIntakes(intakes = []) {
  const seen = new Set();
  return (intakes || []).filter((item) => {
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
  const mergedFeedings = records.flatMap((record) => Array.isArray(record?.feedings) ? record.feedings : []);
  const mergedIntakes = dedupeIntakes(records.flatMap((record) => Array.isArray(record?.intakes) ? record.intakes : []));
  return {
    ...primary,
    basicInfo: mergeBasicInfoFromRecords(records),
    feedings: mergedFeedings,
    intakes: mergedIntakes,
    summary: calculateMacroSummary(normalizeIntakes(mergedIntakes), mergedFeedings, nutritionSettings, records.flatMap((record) => record?.treatmentRecords || []))
  };
}

function formatCompactNumber(value, precision = 2) {
  const num = toExactReportNumber(value);
  if (!Number.isFinite(num)) {
    return value === undefined || value === null ? '--' : String(value);
  }
  if (Number.isInteger(num)) return String(num);
  return String(roundNumber(num, precision)).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatDelta(currentValue, previousValue) {
  const current = toExactReportNumber(currentValue);
  const previous = toExactReportNumber(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return '';
  const difference = current - previous;
  if (!Number.isFinite(difference)) return '';
  const delta = roundNumber(difference, 2);
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : ''}${formatCompactNumber(delta, 2)}`;
}

function buildDailyNutritionMetric(record = {}, nutritionSettings = {}, fallbackWeight = 0) {
  if (record.summaryMetrics) {
    const metrics = record.summaryMetrics || {};
    const weight = Number(record.basicInfo?.weight) || Number(fallbackWeight) || 0;
    const calories = Number(metrics.calories) || 0;
    const protein = Number(metrics.protein) || 0;
    const naturalProtein = Number(metrics.naturalProtein) || 0;
    const specialProtein = Number(metrics.specialProtein) || 0;
    return {
      date: toDateKey(record.date),
      weight,
      calories,
      carbs: Number(metrics.carbs) || 0,
      fat: Number(metrics.fat) || 0,
      naturalProteinCoefficient: weight > 0 ? roundNumber(naturalProtein / weight, 2) : null,
      specialProteinCoefficient: weight > 0 ? roundNumber(specialProtein / weight, 2) : null,
      totalProteinCoefficient: weight > 0 ? roundNumber(protein / weight, 2) : null,
      calorieCoefficient: weight > 0 ? roundNumber(calories / weight, 1) : null
    };
  }

  const normalizedIntakes = normalizeIntakes(record.intakes || []);
  const treatmentRecords = record.treatmentRecords || [];
  const summary = calculateMacroSummary(normalizedIntakes, record.feedings || [], nutritionSettings, treatmentRecords);
  const weight = Number(record.basicInfo?.weight) || Number(fallbackWeight) || 0;
  const overview = calculateIntakeOverview(record.feedings || [], normalizedIntakes, weight, nutritionSettings, treatmentRecords);
  const naturalProtein = (overview.milk.normal.protein || 0) + (overview.food.naturalProtein || 0);
  const specialProtein = (overview.milk.special.protein || 0) + (overview.food.specialProtein || 0);
  return {
    date: toDateKey(record.date),
    weight,
    calories: Number(summary.calories) || 0,
    carbs: Number(summary.carbs) || 0,
    fat: Number(summary.fat) || 0,
    naturalProteinCoefficient: weight > 0 ? roundNumber(naturalProtein / weight, 2) : null,
    specialProteinCoefficient: weight > 0 ? roundNumber(specialProtein / weight, 2) : null,
    totalProteinCoefficient: weight > 0 ? roundNumber((Number(summary.protein) || 0) / weight, 2) : null,
    calorieCoefficient: weight > 0 ? roundNumber((Number(summary.calories) || 0) / weight, 1) : null
  };
}

function averageMetric(records = [], key, precision = 2) {
  const values = records.map((record) => record[key]).filter((value) => Number.isFinite(value));
  if (!values.length) return '--';
  return formatCompactNumber(values.reduce((sum, value) => sum + value, 0) / values.length, precision);
}

function buildWindowSummary(records = [], startDateKey, endDateKey, label, metricFourLabel) {
  const totalDays = daysBetweenInclusive(startDateKey, endDateKey);
  const recordedDays = records.length;
  const coverageRate = totalDays > 0 ? Math.round((recordedDays / totalDays) * 100) : 0;
  const hasData = recordedDays > 0;
  return {
    key: label === '区间摘要' ? 'interval' : 'last7',
    label,
    dateRange: `${startDateKey.slice(5)} 至 ${endDateKey.slice(5)}`,
    badge: hasData
      ? (label === '区间摘要' ? `记录覆盖率 ${coverageRate}%` : '化验前 7 天')
      : '暂无喂养记录',
    metrics: [
      { label: '天然蛋白系数', value: averageMetric(records, 'naturalProteinCoefficient', 2), unit: 'g/kg/d' },
      { label: '特殊蛋白系数', value: averageMetric(records, 'specialProteinCoefficient', 2), unit: 'g/kg/d' },
      { label: '热卡系数', value: averageMetric(records, 'calorieCoefficient', 1), unit: 'kcal/kg/d' },
      { label: metricFourLabel, value: averageMetric(records, metricFourLabel === '脂肪' ? 'fat' : 'carbs', 2), unit: 'g/d' }
    ],
    note: hasData
      ? (label === '区间摘要' ? '记录日均，适合看整个两次化验间的执行结构。' : '更贴近本次报告前的近期营养背景。')
      : '该时间窗口内暂无喂养记录，所以这里暂时不能生成营养摘要。'
  };
}

function getMetricConfigMap(reportType) {
  return ReportModel.getIndicators(reportType).reduce((map, item) => {
    map[item.key] = item;
    return map;
  }, {});
}

function getReportId(report = {}) {
  return report._id || report.id || report.reportId;
}

function pickSelectedReport(reports = [], selectedReportId) {
  if (!reports.length) return null;
  return reports.find((report) => getReportId(report) === selectedReportId) || reports[0];
}

function buildCompareCards(currentReport, previousReport) {
  const metricConfigMap = getMetricConfigMap(currentReport.reportType);
  const keys = KEY_METRICS_BY_REPORT_TYPE[currentReport.reportType] || Object.keys(currentReport.indicators || {}).slice(0, 4);
  return keys
    .filter((key) => currentReport.indicators?.[key])
    .map((key) => {
      const config = metricConfigMap[key] || {};
      const current = currentReport.indicators[key] || {};
      const previous = previousReport?.indicators?.[key] || {};
      const currentValue = current.value;
      const previousValue = previous.value;
      const currentNum = toExactReportNumber(currentValue);
      const previousNum = toExactReportNumber(previousValue);
      const unitsComparable = areReportUnitsComparable(current.unit, previous.unit, config);
      const comparable = unitsComparable && Number.isFinite(currentNum) && Number.isFinite(previousNum);
      const display = buildIndicatorDisplay(config, current);
      const direction = comparable
        ? (currentNum === previousNum ? 'flat' : currentNum > previousNum ? 'up' : 'down')
        : 'missing';

      return {
        key,
        name: ReportModel.getIndicatorDisplayName(config) || key,
        current: formatReportValue(currentValue),
        previous: [formatReportValue(previousValue), !unitsComparable ? previous.unit : ''].filter(Boolean).join(' '),
        delta: comparable ? formatDelta(currentValue, previousValue) : '',
        direction, comparable,
        status: display.status,
        unit: display.unit
      };
    });
}

function buildTrendMetrics(currentReport, sameTypeReports = []) {
  const metricConfigMap = getMetricConfigMap(currentReport.reportType);
  const keys = currentReport.reportType === ReportModel.REPORT_TYPES.URINE_MS
    ? ['methylmalonic_acid', 'methylcitric_acid_1', 'lactate']
    : (KEY_METRICS_BY_REPORT_TYPE[currentReport.reportType] || []).slice(0, 2);
  const pointsBase = [...sameTypeReports]
    .sort((a, b) => parseDateKey(toDateKey(a.reportDate)).getTime() - parseDateKey(toDateKey(b.reportDate)).getTime())
    .slice(-4);

  return keys
    .filter((key) => pointsBase.some((report) => report.indicators?.[key]?.value !== undefined))
    .map((key, index) => ({
      key,
      name: metricConfigMap[key]?.abbr || metricConfigMap[key]?.name || key,
      overlayLabel: TREND_OVERLAY_LABELS[index] || '叠加：总蛋白系数',
      points: pointsBase.map((report) => {
        const indicator = report.indicators?.[key] || {};
        const config = metricConfigMap[key] || {};
        const unitsComparable = areReportUnitsComparable(indicator.unit, currentReport.indicators?.[key]?.unit, config);
        const value = unitsComparable ? readReportNumber(indicator.value) : null;
        return {
          date: toDateKey(report.reportDate).slice(5),
          value: value === null ? null : formatCompactNumber(value, 2),
          valueText: [formatReportValue(indicator.value), indicator.unit].filter(Boolean).join(' '),
          missing: value === null,
          active: getReportId(report) === getReportId(currentReport)
        };
      })
    }));
}

function buildDoctorSummary(compareCards, intervalSummary, shortTermSummary) {
  const compareText = compareCards
    .map((card) => `${card.name}${card.direction === 'missing' ? '暂不比较' : card.direction === 'up' ? '上升' : card.direction === 'down' ? '下降' : '基本持平'}`)
    .join('，');
  return [
    `本次较上次：${compareText}。`,
    `两次化验间记录覆盖率 ${intervalSummary.recordedDays}/${intervalSummary.totalDays} 天，区间数据可作为门诊沟通参考。`,
    `区间记录日均：天然蛋白系数 ${intervalSummary.natural} g/kg/d，特殊蛋白系数 ${intervalSummary.special} g/kg/d，热卡系数 ${intervalSummary.calorie} kcal/kg/d。`,
    `化验前 7 天均值：天然蛋白系数 ${shortTermSummary.natural}，特殊蛋白系数 ${shortTermSummary.special}，热卡系数 ${shortTermSummary.calorie}。`
  ];
}

function buildKeySummary(report = {}) {
  const metricConfigMap = getMetricConfigMap(report.reportType);
  const keys = KEY_METRICS_BY_REPORT_TYPE[report.reportType] || [];
  const summaryParts = keys
    .filter((key) => report.indicators?.[key]?.value !== undefined && report.indicators?.[key]?.value !== '')
    .slice(0, 2)
    .map((key) => `${ReportModel.getIndicatorDisplayName(metricConfigMap[key]) || key} ${formatReportValue(report.indicators[key].value)}`);
  return summaryParts.length ? summaryParts.join('，') : '可进入详情页补充查看完整指标。';
}

function buildIndicatorItem(config = {}, currentReport = {}, previousReport = {}) {
  const current = currentReport.indicators?.[config.key] || {};
  const previous = previousReport?.indicators?.[config.key] || {};
  const currentValue = current.value;
  const previousValue = previous.value;
  const currentNum = toExactReportNumber(currentValue);
  const previousNum = toExactReportNumber(previousValue);
  const unitsComparable = areReportUnitsComparable(current.unit, previous.unit, config);
  const comparable = unitsComparable && Number.isFinite(currentNum) && Number.isFinite(previousNum);
  const display = buildIndicatorDisplay(config, current);
  const direction = comparable
    ? (currentNum === previousNum ? 'flat' : currentNum > previousNum ? 'up' : 'down')
    : 'missing';

  return {
    key: config.key,
    name: ReportModel.getIndicatorDisplayName(config) || config.key,
    abbr: config.abbr || config.key,
    current: formatReportValue(currentValue),
    previous: [formatReportValue(previousValue), !unitsComparable ? previous.unit : ''].filter(Boolean).join(' '),
    delta: comparable ? formatDelta(currentValue, previousValue) : '',
    direction, comparable,
    status: display.status,
    unit: display.unit
  };
}

function buildDetailIndicatorItem(config = {}, currentReport = {}) {
  const current = currentReport.indicators?.[config.key] || {};
  const display = buildIndicatorDisplay(config, current);
  return {
    key: config.key,
    name: ReportModel.getIndicatorDisplayName(config) || config.key,
    abbr: config.abbr || config.key,
    current: display.valueText,
    status: display.status,
    unit: display.unit,
    minRange: current.minRange || '',
    maxRange: current.maxRange || ''
  };
}

function splitIndicatorGroups(reportType, indicatorConfigs = []) {
  if (reportType === ReportModel.REPORT_TYPES.BLOOD_MS) {
    return [
      {
        key: 'amino-acids',
        title: '氨基酸相关指标',
        hint: 'MMA 常关注的支链氨基酸和蛋氨酸变化。',
        configs: indicatorConfigs.filter((item) => ReportModel.isAminoAcidIndicator(item.key))
      },
      {
        key: 'acylcarnitines',
        title: '酰基肉碱与比值',
        hint: '用于看 C3 及相关比值是否持续偏高。',
        configs: indicatorConfigs.filter((item) => !ReportModel.isAminoAcidIndicator(item.key))
      }
    ].filter((group) => group.configs.length);
  }

  if (reportType === ReportModel.REPORT_TYPES.BLOOD_GAS) {
    return [
      {
        key: 'acid-base',
        title: '酸碱相关指标',
        hint: '优先看 pH、HCO3-、细胞外(标准)剩余碱与(实际)剩余碱的变化。',
        configs: indicatorConfigs.filter((item) => ['ph', 'hco3', 'beecf', 'be'].includes(item.key))
      },
      {
        key: 'gas-pressure',
        title: '气体分压指标',
        hint: '补充查看二氧化碳和氧分压。',
        configs: indicatorConfigs.filter((item) => ['pco2', 'po2'].includes(item.key))
      },
      {
        key: 'metabolism',
        title: '代谢相关指标',
        hint: '失代偿或感染时重点看乳酸和血糖。',
        configs: indicatorConfigs.filter((item) => ['lactate', 'glucose'].includes(item.key))
      },
      {
        key: 'electrolytes',
        title: '电解质指标',
        hint: '用于评估电解质平衡及阴离子间隙。',
        configs: indicatorConfigs.filter((item) => ['sodium', 'potassium', 'chloride', 'calcium'].includes(item.key))
      },
      {
        key: 'blood-cells',
        title: '血细胞指标',
        hint: '血气仪附带检测，可按报告单选填。',
        configs: indicatorConfigs.filter((item) => ['hct', 'cthb'].includes(item.key))
      }
    ].filter((group) => group.configs.length);
  }

  if (reportType === ReportModel.REPORT_TYPES.BLOOD_CBC) {
    return [
      {
        key: 'cbc-core',
        title: '核心指标',
        hint: '',
        configs: indicatorConfigs.filter((item) => ['hgb', 'plt'].includes(item.key))
      },
      {
        key: 'cbc-wbc',
        title: '白细胞相关',
        hint: '',
        configs: indicatorConfigs.filter((item) => ['wbc', 'neut_abs', 'neut_pct', 'lym_pct'].includes(item.key))
      },
      {
        key: 'cbc-rbc',
        title: '红细胞相关',
        hint: '',
        configs: indicatorConfigs.filter((item) => ['hct', 'mcv'].includes(item.key))
      }
    ].filter((group) => group.configs.length);
  }

  return [
    {
      key: 'all-indicators',
      title: '全部指标',
      hint: '按同一份报告完整展开，适合和医生逐项核对。',
      configs: indicatorConfigs
    }
  ];
}

function buildAllIndicatorGroups(currentReport, previousReport) {
  const indicatorConfigs = ReportModel.getIndicators(currentReport.reportType);
  return splitIndicatorGroups(currentReport.reportType, indicatorConfigs).map((group) => ({
    key: group.key,
    title: group.title,
    hint: group.hint,
    items: group.configs
      .filter((config) => currentReport.indicators?.[config.key] || previousReport?.indicators?.[config.key])
      .map((config) => buildIndicatorItem(config, currentReport, previousReport))
  })).filter((group) => group.items.length);
}

function buildDetailIndicatorGroups(currentReport) {
  const indicatorConfigs = ReportModel.getIndicators(currentReport.reportType);
  return splitIndicatorGroups(currentReport.reportType, indicatorConfigs).map((group) => ({
    key: group.key,
    title: group.title,
    hint: group.hint,
    items: group.configs
      .filter((config) => currentReport.indicators?.[config.key])
      .map((config) => buildDetailIndicatorItem(config, currentReport))
  })).filter((group) => group.items.length);
}

function buildReportArchivePreview({ reports = [], filterType = 'all', selectedCompareReportId = '' }) {
  const sortedReports = [...reports].sort((a, b) => parseDateKey(toDateKey(b.reportDate)).getTime() - parseDateKey(toDateKey(a.reportDate)).getTime());
  const tabs = REPORT_TYPE_FILTERS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    count: tab.key === 'all'
      ? sortedReports.length
      : sortedReports.filter((report) => report.reportType === tab.key).length,
    active: tab.key === filterType
  }));

  const filteredReports = filterType === 'all'
    ? sortedReports
    : sortedReports.filter((report) => report.reportType === filterType);

  const reportCards = filteredReports.map((report) => {
    const summary = buildReportDisplay(report).summary;
    const dateKey = toDateKey(report.reportDate);
    const [year, month, day] = dateKey.split('-');
    const metricConfigMap = getMetricConfigMap(report.reportType);
    const keys = KEY_METRICS_BY_REPORT_TYPE[report.reportType] || [];
    const keyTags = keys
      .filter((key) => report.indicators?.[key]?.value !== undefined && report.indicators?.[key]?.value !== '')
      .slice(0, 3)
      .map((key) => {
        const config = metricConfigMap[key] || {};
        const display = buildIndicatorDisplay(config, report.indicators[key]);
        const value = display.valueText;
        const abnormal = display.abnormal;
        return {
          key,
          text: `${ReportModel.getIndicatorDisplayName(config) || key} ${value}`,
          abnormal
        };
      });
    return {
      reportId: getReportId(report),
      reportType: report.reportType,
      reportTypeLabel: ReportModel.getReportTypeName(report.reportType),
      formattedDate: dateKey,
      monthDay: dateKey ? dateKey.slice(5).replace('-', '.') : '—',
      labName: report.labName || '',
      formattedYear: year,
      formattedMonth: `${Number(month)}月`,
      formattedDay: String(Number(day)),
      abnormalCount: summary.abnormalCount,
      normalCount: summary.normalCount,
      totalCount: summary.totalCount,
      filledCount: summary.filledCount,
      unknownCount: summary.unknownCount,
      statusText: summary.statusText,
      statusClass: summary.statusClass,
      keySummary: buildKeySummary(report),
      keyTags
    };
  });

  const reportYearGroups = [];
  const yearGroupMap = new Map();
  reportCards.forEach((card) => {
    const year = card.formattedYear || '未知';
    if (!yearGroupMap.has(year)) {
      const group = { year, reports: [] };
      yearGroupMap.set(year, group);
      reportYearGroups.push(group);
    }
    yearGroupMap.get(year).reports.push(card);
  });

  const selectedCard = reportCards.find((item) => item.reportId === selectedCompareReportId) || reportCards[0] || null;

  return {
    tabs,
    filterType,
    reportCards,
    reportYearGroups,
    selectedCompareReportId: selectedCard?.reportId || ''
  };
}

function resolveTrendContext({ selectedReportId = '', reports = [], feedingRecords = [], nutritionSettings = {}, fallbackWeight = 0, reportType = '' }) {
  const sortedReports = [...reports].sort((a, b) => parseDateKey(toDateKey(b.reportDate)).getTime() - parseDateKey(toDateKey(a.reportDate)).getTime());
  const inferredReportType = reportType || pickSelectedReport(sortedReports, selectedReportId)?.reportType || '';
  const sameTypeReports = sortedReports.filter((report) => report.reportType === inferredReportType);
  const currentReport = selectedReportId
    ? pickSelectedReport(sameTypeReports, selectedReportId)
    : sameTypeReports[0] || null;

  if (!currentReport) {
    return null;
  }

  const previousReport = sameTypeReports
    .filter((report) => toDateKey(report.reportDate) < toDateKey(currentReport.reportDate))
    .sort((a, b) => parseDateKey(toDateKey(b.reportDate)).getTime() - parseDateKey(toDateKey(a.reportDate)).getTime())[0];

  const currentDateKey = toDateKey(currentReport.reportDate);
  const intervalStart = previousReport ? addDays(toDateKey(previousReport.reportDate), 1) : addDays(currentDateKey, -7);
  const intervalEnd = addDays(currentDateKey, -1);
  const last7Start = daysBetweenInclusive(intervalStart, intervalEnd) > 7 ? addDays(currentDateKey, -7) : intervalStart;
  const feedingRecordsByDate = feedingRecords.reduce((map, record) => {
    const key = toDateKey(record.date);
    if (!key) return map;
    if (!map[key]) map[key] = [];
    map[key].push(record);
    return map;
  }, {});
  const metricFourLabel = currentReport.reportType === ReportModel.REPORT_TYPES.BLOOD_MS ? '碳水' : '脂肪';
  const intervalMetrics = Object.keys(feedingRecordsByDate)
    .filter((dateKey) => dateKey >= intervalStart && dateKey <= intervalEnd)
    .sort()
    .map((dateKey) => mergeFeedingRecords(feedingRecordsByDate[dateKey], nutritionSettings))
    .filter(Boolean)
    .map((record) => buildDailyNutritionMetric(record, nutritionSettings, fallbackWeight));
  const last7Metrics = intervalMetrics.filter((record) => record.date >= last7Start && record.date <= intervalEnd);
  const intervalSummary = {
    recordedDays: intervalMetrics.length,
    totalDays: daysBetweenInclusive(intervalStart, intervalEnd),
    natural: averageMetric(intervalMetrics, 'naturalProteinCoefficient', 2),
    special: averageMetric(intervalMetrics, 'specialProteinCoefficient', 2),
    calorie: averageMetric(intervalMetrics, 'calorieCoefficient', 1)
  };
  const shortTermSummary = {
    natural: averageMetric(last7Metrics, 'naturalProteinCoefficient', 2),
    special: averageMetric(last7Metrics, 'specialProteinCoefficient', 2),
    calorie: averageMetric(last7Metrics, 'calorieCoefficient', 1)
  };

  return {
    currentReport,
    previousReport,
    sameTypeReports,
    currentDateKey,
    metricFourLabel,
    intervalStart,
    intervalEnd,
    last7Start,
    intervalMetrics,
    last7Metrics,
    intervalSummary,
    shortTermSummary
  };
}

function buildReportDetailPreview({ selectedReportId, reports = [] }) {
  const sortedReports = [...reports].sort((a, b) => parseDateKey(toDateKey(b.reportDate)).getTime() - parseDateKey(toDateKey(a.reportDate)).getTime());
  const currentReport = pickSelectedReport(sortedReports, selectedReportId);
  if (!currentReport) return null;

  const summary = ReportModel.getReportSummary(currentReport);
  const filledCount = Object.values(currentReport.indicators || {}).filter((indicator) => indicator?.value !== '' && indicator?.value !== undefined && indicator?.value !== null).length;

  return {
    reportId: getReportId(currentReport),
    reportType: currentReport.reportType,
    reportTypeLabel: ReportModel.getReportTypeName(currentReport.reportType),
    reportDate: toDateKey(currentReport.reportDate),
    summary: {
      ...summary,
      filledCount
    },
    keySummary: buildKeySummary(currentReport),
    keyIndicators: buildCompareCards(currentReport, null),
    indicatorGroups: buildDetailIndicatorGroups(currentReport)
  };
}

function resolveWeekBeforeReport(reportDateKey) {
  const endDate = addDays(reportDateKey, -1);
  const startDate = addDays(reportDateKey, -7);
  return { startDate, endDate };
}

function mergeDateRange(startDate, endDate, nextStart, nextEnd) {
  if (!nextStart || !nextEnd) {
    return { startDate, endDate };
  }
  if (!startDate || !endDate) {
    return { startDate: nextStart, endDate: nextEnd };
  }
  return {
    startDate: nextStart < startDate ? nextStart : startDate,
    endDate: nextEnd > endDate ? nextEnd : endDate
  };
}

function resolveFeedingDataRange(reports = []) {
  const byType = (reports || []).reduce((map, report = {}) => {
    const type = report.reportType || '';
    const dateKey = toDateKey(report.reportDate);
    if (!type || !dateKey) return map;
    if (!map[type]) map[type] = [];
    map[type].push({ ...report, dateKey });
    return map;
  }, {});

  let startDate = '';
  let endDate = '';
  Object.values(byType).forEach((items) => {
    const sorted = [...items].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    sorted.forEach((report, index) => {
      const previous = sorted[index - 1];
      const intervalStart = previous ? addDays(previous.dateKey, 1) : addDays(report.dateKey, -7);
      const intervalEnd = addDays(report.dateKey, -1);
      if (intervalStart && intervalEnd && intervalEnd >= intervalStart) {
        ({ startDate, endDate } = mergeDateRange(startDate, endDate, intervalStart, intervalEnd));
      }
      const weekBefore = resolveWeekBeforeReport(report.dateKey);
      ({ startDate, endDate } = mergeDateRange(startDate, endDate, weekBefore.startDate, weekBefore.endDate));
    });
  });

  return startDate && endDate ? { startDate, endDate } : null;
}

function resolveCompareFeedingDataRange(reports = [], reportAId = '', reportBId = '', reportType = '') {
  const sameTypeReports = reportType
    ? reports.filter((report) => report.reportType === reportType)
    : reports.filter(Boolean);
  const reportA = reportAId ? pickSelectedReport(sameTypeReports, reportAId) : null;
  const reportB = reportBId ? pickSelectedReport(sameTypeReports, reportBId) : null;
  if (!reportA || !reportB) return null;

  const weekA = resolveWeekBeforeReport(toDateKey(reportA.reportDate));
  const weekB = resolveWeekBeforeReport(toDateKey(reportB.reportDate));
  let { startDate, endDate } = weekA;
  ({ startDate, endDate } = mergeDateRange(startDate, endDate, weekB.startDate, weekB.endDate));
  return startDate && endDate ? { startDate, endDate } : null;
}

function resolveCompareNutritionWindows(reports = [], reportAId = '', reportBId = '', reportType = '') {
  const sameTypeReports = reportType
    ? reports.filter((report) => report.reportType === reportType)
    : reports.filter(Boolean);
  const reportA = reportAId ? pickSelectedReport(sameTypeReports, reportAId) : null;
  const reportB = reportBId ? pickSelectedReport(sameTypeReports, reportBId) : null;
  if (!reportA || !reportB) return [];

  const seen = new Set();
  return [reportA, reportB]
    .map((report) => resolveWeekBeforeReport(toDateKey(report.reportDate)))
    .filter((window) => {
      if (!window?.startDate || !window?.endDate) return false;
      const key = `${window.startDate}_${window.endDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function collectNutritionMetricsForRange(feedingRecords = [], startDate, endDate, nutritionSettings = {}, fallbackWeight = 0) {
  const feedingRecordsByDate = feedingRecords.reduce((map, record) => {
    const key = toDateKey(record.date);
    if (!key) return map;
    if (!map[key]) map[key] = [];
    map[key].push(record);
    return map;
  }, {});

  return Object.keys(feedingRecordsByDate)
    .filter((dateKey) => dateKey >= startDate && dateKey <= endDate)
    .sort()
    .map((dateKey) => mergeFeedingRecords(feedingRecordsByDate[dateKey], nutritionSettings))
    .filter(Boolean)
    .map((record) => buildDailyNutritionMetric(record, nutritionSettings, fallbackWeight));
}

function collectNutritionMetricsFromSummaries(summaries = [], startDate, endDate, fallbackWeight = 0) {
  const sorted = (summaries || [])
    .map((summary) => ({ summary, dateKey: toDateKey(summary.date) }))
    .filter((item) => item.dateKey && item.dateKey >= startDate && item.dateKey <= endDate)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return sorted
    .map(({ summary, dateKey }) => {
      const dayWeight = Number(summary.basicInfo?.weight) || 0;
      return buildDailyNutritionMetricFromSummary(summary, dateKey, dayWeight);
    })
    .filter(Boolean);
}

function formatShortDateRange(startDate, endDate) {
  if (!startDate || !endDate) return '';
  const formatPart = (dateKey) => {
    const [, month, day] = String(dateKey).split('-');
    return `${Number(month)}.${Number(day)}`;
  };
  return `${formatPart(startDate)}–${formatPart(endDate)}`;
}

function metricPrecisionForSeriesKey(key = '') {
  return key === 'calorieCoefficient' ? 1 : 2;
}

function averageFromSeriesPoints(points = [], precision = 2) {
  const values = (points || [])
    .map((point) => point.raw)
    .filter((value) => Number.isFinite(value));
  if (!values.length) return '';
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return formatCompactNumber(avg, precision);
}

function averageNumberFromSeriesPoints(points = []) {
  const values = (points || [])
    .map((point) => point.raw)
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildDailyCoefficientSeries(dailyMetrics = [], startDate, endDate) {
  const dateKeys = [];
  let cursor = startDate;
  while (cursor && endDate && cursor <= endDate) {
    dateKeys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  const metricsByDate = (dailyMetrics || []).reduce((map, item) => {
    if (item?.date) map[item.date] = item;
    return map;
  }, {});

  const buildSeries = (metricKey, precision = 2) => {
    const points = dateKeys.map((dateKey) => {
      const metric = metricsByDate[dateKey];
      const raw = readReportNumber(metric?.[metricKey]);
      return {
        date: dateKey,
        label: String(Number(dateKey.slice(-2))),
        raw: Number.isFinite(raw) ? raw : null,
        value: Number.isFinite(raw) ? formatCompactNumber(raw, precision) : '--'
      };
    });
    const values = points.map((point) => point.raw).filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const span = max - min || 1;
    return points.map((point) => ({
      ...point,
      missing: !Number.isFinite(point.raw),
      heightRpx: Number.isFinite(point.raw)
        ? Math.max(12, Math.round(((point.raw - min) / span) * 56 + 12))
        : 8,
      heightPercent: Number.isFinite(point.raw)
        ? Math.round(((point.raw - min) / span) * 68 + 22)
        : 10
    }));
  };

  return [
    {
      key: 'naturalProteinCoefficient',
      label: '天然蛋白系数',
      unit: 'g/kg/d',
      points: buildSeries('naturalProteinCoefficient', 2)
    },
    {
      key: 'specialProteinCoefficient',
      label: '特殊蛋白系数',
      unit: 'g/kg/d',
      points: buildSeries('specialProteinCoefficient', 2)
    },
    {
      key: 'calorieCoefficient',
      label: '热卡系数',
      unit: 'kcal/kg/d',
      points: buildSeries('calorieCoefficient', 1)
    }
  ];
}

function buildReportNutritionWindow(
  report,
  feedingRecords = [],
  nutritionSettings = {},
  fallbackWeight = 0,
  dailySummaries = []
) {
  const dateKey = toDateKey(report.reportDate);
  const { startDate, endDate } = resolveWeekBeforeReport(dateKey);
  const metricFourLabel = report.reportType === ReportModel.REPORT_TYPES.BLOOD_MS ? '碳水' : '脂肪';
  const metrics = Array.isArray(dailySummaries)
    ? collectNutritionMetricsFromSummaries(dailySummaries, startDate, endDate, fallbackWeight)
    : collectNutritionMetricsForRange(
      feedingRecords,
      startDate,
      endDate,
      nutritionSettings,
      fallbackWeight
    );
  const summary = buildWindowSummary(metrics, startDate, endDate, '化验前 7 天', metricFourLabel);
  const totalDays = daysBetweenInclusive(startDate, endDate);

  return {
    reportId: getReportId(report),
    reportDate: dateKey,
    fullDateRange: `${startDate} 至 ${endDate}`,
    dateRangeShort: formatShortDateRange(startDate, endDate),
    recordedDays: metrics.length,
    totalDays,
    coverageText: totalDays > 0 ? `${metrics.length}/${totalDays} 天` : '0/0 天',
    coefficientSeries: buildDailyCoefficientSeries(metrics, startDate, endDate),
    ...summary
  };
}

function buildCompareHero(compareRows = []) {
  const ranked = (compareRows || [])
    .map((row) => {
      const deltaText = String(row.delta || '').replace(/^\+/, '');
      const deltaAbs = Number(deltaText);
      return {
        ...row,
        deltaAbs: Number.isFinite(deltaAbs) ? Math.abs(deltaAbs) : 0
      };
    })
    .filter((row) => row.deltaAbs > 0)
    .sort((a, b) => b.deltaAbs - a.deltaAbs);
  const top = ranked[0];
  if (!top) return null;
  return {
    key: top.key,
    name: top.abbr || top.name,
    delta: top.delta,
    direction: top.direction,
    current: top.current,
    previous: top.previous
  };
}

function rangesDiffer(minRangeA = '', maxRangeA = '', minRangeB = '', maxRangeB = '') {
  // 比较原始数值，不因展示精度相同而漏掉范围差异。
  const normalize = value => {
    const number = readReportNumber(value);
    return number === null ? String(value ?? '').trim() : String(number);
  };
  return normalize(minRangeA) !== normalize(minRangeB) || normalize(maxRangeA) !== normalize(maxRangeB);
}

function buildNutritionCompareSeries(windowA = {}, windowB = {}) {
  const seriesA = windowA.coefficientSeries || [];
  return seriesA.map(series => {
    const peer = (windowB.coefficientSeries || []).find(item => item.key === series.key) || {};
    const precision = metricPrecisionForSeriesKey(series.key);
    const values = [...(series.points || []), ...(peer.points || [])].map(point => point.raw).filter(Number.isFinite);
    const ceiling = Math.max(0, ...values) || 1;
    const buildSide = (window, points = []) => ({
      date: window.reportDate,
      dateRangeShort: window.dateRangeShort,
      fullDateRange: window.fullDateRange,
      coverageText: points.filter(point => Number.isFinite(point.raw)).length + '/' + points.length + ' 天',
      averageText: averageFromSeriesPoints(points, precision),
      points: points.map(point => ({
        ...point,
        heightRpx: Number.isFinite(point.raw) ? Math.max(2, Math.round(point.raw / ceiling * 68)) : 0
      }))
    });
    return { key: series.key, label: series.label, unit: series.unit,
      reportA: buildSide(windowA, series.points), reportB: buildSide(windowB, peer.points) };
  });
}

function buildDietCompareSummaryLines(nutritionCompareSeries = []) {
  return (nutritionCompareSeries || []).map((series) => {
    const precision = metricPrecisionForSeriesKey(series.key);
    const avgA = averageNumberFromSeriesPoints(series.reportA?.points || []);
    const avgB = averageNumberFromSeriesPoints(series.reportB?.points || []);
    const leftText = Number.isFinite(avgB) ? formatCompactNumber(avgB, precision) : '--';
    const rightText = Number.isFinite(avgA) ? formatCompactNumber(avgA, precision) : '--';

    if (!Number.isFinite(avgA) || !Number.isFinite(avgB)) {
      return `${series.label}：${leftText} → ${rightText}，数据不足。`;
    }

    const delta = avgA - avgB;
    const change = Math.abs(delta) < Number.EPSILON
      ? '持平'
      : `${delta > 0 ? '上升' : '下降'} ${formatCompactNumber(Math.abs(delta), precision)} ${series.unit}`;
    return `${series.label}：${leftText} → ${rightText}，${change}`;
  });
}

function buildCompareCardsForKeys(currentReport, previousReport, metricKeys = []) {
  const configMap = getMetricConfigMap(currentReport.reportType);
  return metricKeys.filter(key => configMap[key]).map(key => {
    const config = configMap[key];
    const a = buildIndicatorDisplay(config, currentReport.indicators?.[key] || {});
    const b = buildIndicatorDisplay(config, previousReport.indicators?.[key] || {});
    const unitsComparable = areReportUnitsComparable(a.unit, b.unit, config);
    const rawDifference = unitsComparable && a.numericValue !== null && b.numericValue !== null ? a.numericValue - b.numericValue : null;
    const comparable = Number.isFinite(rawDifference);
    const difference = comparable ? Number(rawDifference.toPrecision(12)) : null;
    const direction = !comparable ? 'missing' : difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat';
    const delta = comparable ? (difference > 0 ? '+' : '') + String(difference) : '—';
    return {
      key, name: a.name, abbr: a.abbr, unit: a.unit, secondaryText: a.secondaryText,
      current: a.valueText, previous: [b.valueText, !unitsComparable ? b.unit : ''].filter(Boolean).join(' '), delta, direction, comparable,
      changeText: comparable ? formatDirectionChangeText(direction, delta) : unitsComparable ? '数据不足' : '单位未确认一致，暂不比较',
      status: a.status, statusText: a.statusText, statusClass: a.statusClass, marker: a.marker,
      previousStatus: b.status, previousStatusText: b.statusText, previousStatusClass: b.statusClass, previousMarker: b.marker,
      rangeA: a.rangeText, rangeB: b.rangeText,
      rangeMismatch: rangesDiffer(currentReport.indicators?.[key]?.minRange, currentReport.indicators?.[key]?.maxRange,
        previousReport.indicators?.[key]?.minRange, previousReport.indicators?.[key]?.maxRange),
      abnormal: a.abnormal || b.abnormal
    };
  });
}

function buildCompareMetricOptions(reportType, reportA, reportB, selectedMetricKeys = []) {
  const primaryKeys = KEY_METRICS_BY_REPORT_TYPE[reportType] || [];
  const configs = ReportModel.getIndicators(reportType);
  const selectedSet = new Set(selectedMetricKeys);
  const hasExplicitSelection = selectedMetricKeys.length > 0;

  return configs.map((config) => {
    const aValue = reportA?.indicators?.[config.key]?.value;
    const bValue = reportB?.indicators?.[config.key]?.value;
    const hasData = hasReportValue(aValue) || hasReportValue(bValue);
    const isPrimary = primaryKeys.includes(config.key);
    return {
      key: config.key,
      name: config.name || ReportModel.getIndicatorDisplayName(config) || config.key,
      abbr: config.abbr || config.key,
      isPrimary,
      hasData,
      selected: hasExplicitSelection ? selectedSet.has(config.key) : hasData
    };
  }).filter((item) => item.hasData);
}

function buildCompareSummary(compareRows = []) {
  const counts = compareRows.reduce((result, row) => {
    result[row.direction] += 1;
    return result;
  }, { up: 0, down: 0, flat: 0, missing: 0 });
  return [
    '可比较 ' + (counts.up + counts.down + counts.flat) + ' 项 · 升高 ' + counts.up + ' · 降低 ' + counts.down + ' · 相同 ' + counts.flat,
    '数据不足 ' + counts.missing + ' 项 · 全部已录入指标'
  ];
}

function buildReportComparePickerOptions(reports = [], reportType = '') {
  const sorted = reports.filter(report => report.reportType === reportType)
    .sort((a, b) => toDateKey(b.reportDate).localeCompare(toDateKey(a.reportDate)) || getReportId(b).localeCompare(getReportId(a)));
  const dateCounts = new Map();
  const datePositions = new Map();
  sorted.forEach(report => {
    const date = toDateKey(report.reportDate);
    dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
  });
  return sorted.map(report => {
    const date = toDateKey(report.reportDate);
    const position = (datePositions.get(date) || 0) + 1;
    datePositions.set(date, position);
    const sameDayLabel = dateCounts.get(date) > 1 ? '同日第 ' + position + ' 份' : '';
    return {
      reportId: getReportId(report), date, labName: report.labName || '', sameDayLabel,
      label: [date, report.labName, sameDayLabel].filter(Boolean).join(' · ')
    };
  });
}

function resolveCompareReportSelection(reports = [], reportType = '', reportAId = '', reportBId = '') {
  const options = buildReportComparePickerOptions(reports, reportType);
  if (!options.length) {
    return {
      options,
      reportAId: '',
      reportBId: '',
      reportAIndex: 0,
      reportBIndex: 0
    };
  }

  const findOptionIndex = (id) => options.findIndex((item) => item.reportId === id);

  let reportAIndex = findOptionIndex(reportAId);
  if (reportAIndex < 0) reportAIndex = 0;

  let reportBIndex = findOptionIndex(reportBId);
  if (options.length === 1) {
    reportBIndex = 0;
  } else if (reportBIndex < 0 || reportBIndex === reportAIndex) {
    reportBIndex = options.findIndex((_, index) => index !== reportAIndex);
    if (reportBIndex < 0) {
      reportBIndex = reportAIndex === 0 ? 1 : 0;
    }
  }

  return {
    options,
    reportAId: options[reportAIndex].reportId,
    reportBId: options[reportBIndex].reportId,
    reportAIndex,
    reportBIndex
  };
}

function findReportById(reports = [], selectedReportId = '') {
  if (!selectedReportId) return null;
  return reports.find((report) => getReportId(report) === selectedReportId) || null;
}

function inferDefaultCompareReportType(reports = [], preferredType = '') {
  if (preferredType && preferredType !== 'all') return preferredType;
  const sorted = reports.slice().sort((a, b) => toDateKey(b.reportDate).localeCompare(toDateKey(a.reportDate)));
  const counts = new Map();
  sorted.forEach(report => counts.set(report.reportType, (counts.get(report.reportType) || 0) + 1));
  // 无明确选择时优先展示已有两份报告的最近类型，避免进入可避免的空状态。
  const candidate = sorted.find(report => counts.get(report.reportType) >= 2) || sorted[0];
  return candidate?.reportType || ReportModel.REPORT_TYPES.BLOOD_MS;
}

function buildReportComparePreview({
  reportType = '',
  reportAId = '',
  reportBId = '',
  selectedMetricKeys = [],
  reports = [],
  feedingRecords = [],
  dailySummaries = [],
  nutritionSettings = {},
  fallbackWeight = 0,
  includeNutrition = true
} = {}) {
  const sameTypeReports = reports.filter((report) => report.reportType === reportType);
  let reportA = reportAId ? findReportById(sameTypeReports, reportAId) : sameTypeReports[0] || null;
  let reportB = reportBId ? findReportById(sameTypeReports, reportBId) : sameTypeReports[1] || null;

  if (!reportA || !reportB) {
    return {
      reportType,
      reportTypeLabel: ReportModel.getReportTypeName(reportType),
      canCompare: false,
      reportCount: sameTypeReports.length,
      reportA: reportA ? { id: getReportId(reportA), date: toDateKey(reportA.reportDate) } : null,
      reportB: reportB ? { id: getReportId(reportB), date: toDateKey(reportB.reportDate) } : null,
      compareRows: [],
      metricOptions: [],
      nutritionWindows: [],
      summaryLines: ['至少需要两份同类报告才能开始对比。']
    };
  }

  if (getReportId(reportA) === getReportId(reportB)) {
    return {
      reportType,
      reportTypeLabel: ReportModel.getReportTypeName(reportType),
      canCompare: false,
      reportCount: sameTypeReports.length,
      reportA: { id: getReportId(reportA), date: toDateKey(reportA.reportDate) },
      reportB: { id: getReportId(reportB), date: toDateKey(reportB.reportDate) },
      pickerReportA: { id: getReportId(reportA), date: toDateKey(reportA.reportDate) },
      pickerReportB: { id: getReportId(reportB), date: toDateKey(reportB.reportDate) },
      compareRows: [],
      metricOptions: buildCompareMetricOptions(reportType, reportA, reportB, selectedMetricKeys),
      nutritionWindows: [],
      nutritionCompareSeries: [],
      summaryLines: ['请选择两份不同的报告。']
    };
  }

  const pickerReportA = reportA;
  const pickerReportB = reportB;
  const metricOptions = buildCompareMetricOptions(reportType, pickerReportA, pickerReportB, selectedMetricKeys);
  const activeKeys = metricOptions.filter((item) => item.selected).map((item) => item.key);
  const compareRows = buildCompareCardsForKeys(pickerReportA, pickerReportB, activeKeys);
  const nutritionWindowA = includeNutrition
    ? buildReportNutritionWindow(
      pickerReportA,
      [],
      nutritionSettings,
      fallbackWeight,
      dailySummaries
    )
    : null;
  const nutritionWindowB = includeNutrition
    ? buildReportNutritionWindow(
      pickerReportB,
      [],
      nutritionSettings,
      fallbackWeight,
      dailySummaries
    )
    : null;
  const nutritionWindows = includeNutrition ? [nutritionWindowA, nutritionWindowB] : [];
  const nutritionCompareSeries = includeNutrition ? buildNutritionCompareSeries(nutritionWindowA, nutritionWindowB) : [];
  const allCompareRows = buildCompareCardsForKeys(pickerReportA, pickerReportB, metricOptions.map(item => item.key));
  const primaryKeys = KEY_METRICS_BY_REPORT_TYPE[reportType] || [];
  const focusMetricKeys = allCompareRows.filter(row => row.abnormal || primaryKeys.includes(row.key))
    .sort((a, b) => Number(b.abnormal) - Number(a.abnormal)).slice(0, 4).map(row => row.key);
  const hasRangeMismatch = allCompareRows.some((row) => row.rangeMismatch);
  const hasNutritionData = nutritionCompareSeries.some((series) => (
    (series.reportA.points || []).some((point) => !point.missing)
    || (series.reportB.points || []).some((point) => !point.missing)
  ));

  return {
    reportType,
    reportTypeLabel: ReportModel.getReportTypeName(reportType),
    canCompare: true,
    reportCount: sameTypeReports.length,
    reportA: {
      id: getReportId(pickerReportA),
      date: toDateKey(pickerReportA.reportDate)
    },
    reportB: {
      id: getReportId(pickerReportB),
      date: toDateKey(pickerReportB.reportDate)
    },
    pickerReportA: {
      id: getReportId(pickerReportA),
      date: toDateKey(pickerReportA.reportDate)
    },
    pickerReportB: {
      id: getReportId(pickerReportB),
      date: toDateKey(pickerReportB.reportDate)
    },
    compareRows,
    hasRangeMismatch,
    rangeMismatchText: hasRangeMismatch
      ? '两份报告参考范围不一致，可能来自不同机构，对比时请注意参考区间差异。'
      : '',
    hasNutritionData,
    nutritionEmptyText: hasNutritionData
      ? ''
      : '化验前 7 天暂无喂养记录，请先在「数据记录」补全对应日期后再对比。',
    metricOptions,
    nutritionWindows,
    nutritionCompareSeries,
    dietSummaryLines: buildDietCompareSummaryLines(nutritionCompareSeries),
    summaryLines: buildCompareSummary(allCompareRows),
    allCompareRows,
    focusMetricKeys: focusMetricKeys.length ? focusMetricKeys : metricOptions.slice(0, 4).map(item => item.key)
  };
}

function buildReportTrendPreview({ reportType = '', selectedReportId = '', reports = [], feedingRecords = [], nutritionSettings = {}, fallbackWeight = 0 }) {
  const context = resolveTrendContext({
    reportType,
    selectedReportId,
    reports,
    feedingRecords,
    nutritionSettings,
    fallbackWeight
  });
  if (!context) return null;

  const {
    currentReport,
    previousReport,
    sameTypeReports,
    currentDateKey,
    metricFourLabel,
    intervalStart,
    intervalEnd,
    last7Start,
    intervalMetrics,
    last7Metrics,
    intervalSummary,
    shortTermSummary
  } = context;

  return {
    reportType: currentReport.reportType,
    reportTypeLabel: ReportModel.getReportTypeName(currentReport.reportType),
    reportCount: sameTypeReports.length,
    selectedReportId: getReportId(currentReport),
    selectedReportDate: currentDateKey,
    previousReportId: previousReport ? getReportId(previousReport) : '',
    previousReportDate: previousReport ? toDateKey(previousReport.reportDate) : '',
    compareCards: buildCompareCards(currentReport, previousReport),
    trendMetrics: buildTrendMetrics(currentReport, sameTypeReports),
    nutritionWindows: [
      buildWindowSummary(intervalMetrics, intervalStart, intervalEnd, '区间摘要', metricFourLabel),
      buildWindowSummary(last7Metrics, last7Start, intervalEnd, '近检摘要', metricFourLabel)
    ],
    doctorSummary: buildDoctorSummary(buildCompareCards(currentReport, previousReport), intervalSummary, shortTermSummary),
    detailLinks: {
      currentReportId: getReportId(currentReport),
      previousReportId: previousReport ? getReportId(previousReport) : ''
    }
  };
}

function buildReportWorkbenchView({ selectedReportId, reports = [], feedingRecords = [], nutritionSettings = {}, fallbackWeight = 0 }) {
  const context = resolveTrendContext({
    selectedReportId,
    reports,
    feedingRecords,
    nutritionSettings,
    fallbackWeight
  });
  if (!context) return null;

  const {
    currentReport,
    previousReport,
    sameTypeReports,
    currentDateKey,
    metricFourLabel,
    intervalStart,
    intervalEnd,
    last7Start,
    intervalMetrics,
    last7Metrics,
    intervalSummary,
    shortTermSummary
  } = context;

  const compareCards = buildCompareCards(currentReport, previousReport);
  const trendMetrics = buildTrendMetrics(currentReport, sameTypeReports);

  const indicatorCount = ReportModel.getIndicators(currentReport.reportType).length;
  const filledCount = Object.values(currentReport.indicators || {}).filter((indicator) => indicator?.value !== '' && indicator?.value !== undefined && indicator?.value !== null).length;

  return {
    id: getReportId(currentReport),
    reportTypeLabel: ReportModel.getReportTypeName(currentReport.reportType),
    reportDate: currentDateKey,
    compareDate: previousReport ? toDateKey(previousReport.reportDate) : '无同类历史报告',
    completion: `${filledCount}/${indicatorCount}`,
    coverage: `${intervalSummary.recordedDays}/${intervalSummary.totalDays} 天`,
    coverageRate: `${intervalSummary.totalDays > 0 ? Math.round((intervalSummary.recordedDays / intervalSummary.totalDays) * 100) : 0}%`,
    statusNote: '用于记录、对比与门诊沟通，不替代医生解读。',
    compareCards,
    trendMetrics,
    allIndicatorGroups: buildAllIndicatorGroups(currentReport, previousReport),
    nutritionWindows: [
      buildWindowSummary(intervalMetrics, intervalStart, intervalEnd, '区间摘要', metricFourLabel),
      buildWindowSummary(last7Metrics, last7Start, intervalEnd, '近检摘要', metricFourLabel)
    ],
    doctorSummary: buildDoctorSummary(compareCards, intervalSummary, shortTermSummary)
  };
}

module.exports = {
  KEY_METRICS_BY_REPORT_TYPE,
  buildCompareHero,
  buildNutritionCompareSeries,
  buildDailyCoefficientSeries,
  buildReportArchivePreview,
  buildReportComparePickerOptions,
  buildReportNutritionWindow,
  buildReportComparePreview,
  collectNutritionMetricsFromSummaries,
  buildDailyNutritionMetricFromSummary,
  buildReportDetailPreview,
  buildReportTrendPreview,
  buildReportWorkbenchView,
  inferDefaultCompareReportType,
  resolveCompareReportSelection,
  resolveFeedingDataRange,
  resolveCompareFeedingDataRange,
  resolveCompareNutritionWindows,
  resolveWeekBeforeReport,
  toDateKey
};
