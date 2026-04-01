const ReportModel = require('../models/report');
const {
  mergeTreatmentIntoMacroSummary,
  mergeTreatmentIntoOverview
} = require('./treatmentUtils');

const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_SPECIAL_MILK_PROTEIN = 13.1;
const DEFAULT_SPECIAL_MILK_PROTEIN_ML = 1.97;
const BREAST_MILK_KCAL = 0.67;
const SPECIAL_MILK_KCAL = 0.70;

const KEY_METRICS_BY_REPORT_TYPE = {
  [ReportModel.REPORT_TYPES.URINE_MS]: ['methylmalonic_acid', 'methylcitric_acid', 'hydroxypropionic_acid', 'hydroxybutyric_acid'],
  [ReportModel.REPORT_TYPES.BLOOD_MS]: ['c3', 'c3_c2', 'c3_c0', 'c0'],
  [ReportModel.REPORT_TYPES.BLOOD_GAS]: ['ph', 'hco3', 'be'],
  [ReportModel.REPORT_TYPES.BLOOD_AMMONIA]: ['ammonia']
};

const TREND_OVERLAY_LABELS = ['叠加：天然蛋白系数', '叠加：热卡系数'];
const REPORT_TYPE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: ReportModel.REPORT_TYPES.BLOOD_MS, label: '血串联' },
  { key: ReportModel.REPORT_TYPES.URINE_MS, label: '尿串联' },
  { key: ReportModel.REPORT_TYPES.BLOOD_GAS, label: '血气' },
  { key: ReportModel.REPORT_TYPES.BLOOD_AMMONIA, label: '血氨' }
];

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

  let totalNaturalVolumeBreast = 0;
  let totalNaturalVolumeFormula = 0;
  let totalSpecialVolume = 0;

  (feedings || []).forEach((feeding) => {
    const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
    const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
    const naturalType = (feeding.naturalMilkType || 'breast') === 'formula' ? 'formula' : 'breast';
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
      calories: nutrition.calories,
      protein: nutrition.naturalProtein,
      carbs: nutrition.carbs,
      fat: nutrition.fat
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
      calories: nutrition.calories,
      protein: nutrition.naturalProtein,
      carbs: nutrition.carbs,
      fat: nutrition.fat
    });
  }

  if (totalSpecialVolume > 0) {
    const nutrition = calculateMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: 'breast',
      specialMilkVolume: totalSpecialVolume,
      specialMilkPowder: calculateSpecialMilkPowder(totalSpecialVolume, nutritionSettings)
    }, nutritionSettings);
    addMilkStats(overview.milk.special, {
      volume: totalSpecialVolume,
      calories: nutrition.calories,
      protein: nutrition.specialProtein,
      carbs: nutrition.carbs,
      fat: nutrition.fat
    });
  }

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
    if (intake.proteinQuality === 'premium') {
      summary.premiumProtein += naturalP;
    } else if (naturalP > 0) {
      summary.regularProtein += naturalP;
    }
    summary.carbs += Number(nutrition.carbs) || 0;
    summary.fat += Number(nutrition.fat) || 0;
  });

  let totalNaturalVolumeBreast = 0;
  let totalNaturalVolumeFormula = 0;
  let totalSpecialVolume = 0;
  (feedings || []).forEach((feeding) => {
    const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
    const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
    const naturalType = (feeding.naturalMilkType || 'breast') === 'formula' ? 'formula' : 'breast';
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

  if (totalNaturalVolumeBreast > 0) {
    applyMilkNutrition({ naturalMilkVolume: totalNaturalVolumeBreast, naturalMilkType: 'breast', specialMilkVolume: 0, specialMilkPowder: 0 });
  }
  if (totalNaturalVolumeFormula > 0) {
    applyMilkNutrition({ naturalMilkVolume: totalNaturalVolumeFormula, naturalMilkType: 'formula', specialMilkVolume: 0, specialMilkPowder: 0 });
  }
  if (totalSpecialVolume > 0) {
    applyMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: 'breast',
      specialMilkVolume: totalSpecialVolume,
      specialMilkPowder: calculateSpecialMilkPowder(totalSpecialVolume, nutritionSettings)
    });
  }

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
  const summaryCalories = Number(record.summary?.calories) || 0;
  const basicInfoCompleteness = getBasicInfoCompleteness(record);
  return (
    feedingsCount * 1000000 +
    intakesCount * 1000000 +
    summaryCalories * 100 +
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
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return value === undefined || value === null ? '--' : String(value);
  }
  if (Number.isInteger(num)) return String(num);
  return String(roundNumber(num, precision)).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatDelta(currentValue, previousValue) {
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return '';
  const delta = roundNumber(current - previous, 2);
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : ''}${formatCompactNumber(delta, 2)}`;
}

function buildDailyNutritionMetric(record = {}, nutritionSettings = {}, fallbackWeight = 0) {
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
  return {
    key: label === '区间摘要' ? 'interval' : 'last7',
    label,
    dateRange: `${startDateKey.slice(5)} 至 ${endDateKey.slice(5)}`,
    badge: label === '区间摘要' ? `记录覆盖率 ${coverageRate}%` : '化验前 7 天',
    metrics: [
      { label: '天然蛋白系数', value: averageMetric(records, 'naturalProteinCoefficient', 2), unit: 'g/kg/d' },
      { label: '特殊蛋白系数', value: averageMetric(records, 'specialProteinCoefficient', 2), unit: 'g/kg/d' },
      { label: '热卡系数', value: averageMetric(records, 'calorieCoefficient', 1), unit: 'kcal/kg/d' },
      { label: metricFourLabel, value: averageMetric(records, metricFourLabel === '脂肪' ? 'fat' : 'carbs', 2), unit: 'g/d' }
    ],
    note: label === '区间摘要' ? '记录日均，适合看整个两次化验间的执行结构。' : '更贴近本次报告前的近期营养背景。'
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
      const currentValue = current.value ?? '--';
      const previousValue = previous.value ?? '--';
      const currentNum = Number(currentValue);
      const previousNum = Number(previousValue);
      const direction = Number.isFinite(currentNum) && Number.isFinite(previousNum)
        ? (currentNum === previousNum ? 'flat' : currentNum > previousNum ? 'up' : 'down')
        : 'flat';

      return {
        key,
        name: config.name || key,
        current: formatCompactNumber(currentValue, 2),
        previous: formatCompactNumber(previousValue, 2),
        delta: formatDelta(currentValue, previousValue),
        direction,
        status: current.status || 'unknown',
        unit: config.unit || ''
      };
    });
}

function buildTrendMetrics(currentReport, sameTypeReports = []) {
  const metricConfigMap = getMetricConfigMap(currentReport.reportType);
  const keys = (KEY_METRICS_BY_REPORT_TYPE[currentReport.reportType] || []).slice(0, 2);
  const pointsBase = [...sameTypeReports]
    .sort((a, b) => parseDateKey(toDateKey(a.reportDate)).getTime() - parseDateKey(toDateKey(b.reportDate)).getTime())
    .slice(-4);

  return keys
    .filter((key) => pointsBase.some((report) => report.indicators?.[key]?.value !== undefined))
    .map((key, index) => ({
      key,
      name: metricConfigMap[key]?.abbr || metricConfigMap[key]?.name || key,
      overlayLabel: TREND_OVERLAY_LABELS[index] || '叠加：总蛋白系数',
      points: pointsBase.map((report) => ({
        date: toDateKey(report.reportDate).slice(5),
        value: formatCompactNumber(report.indicators?.[key]?.value, 2),
        active: getReportId(report) === getReportId(currentReport)
      }))
    }));
}

function buildDoctorSummary(compareCards, intervalSummary, shortTermSummary) {
  const compareText = compareCards
    .map((card) => `${card.name}${card.direction === 'up' ? '上升' : card.direction === 'down' ? '下降' : '基本持平'}`)
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
    .map((key) => `${metricConfigMap[key]?.name || key} ${formatCompactNumber(report.indicators[key].value, 2)}`);
  return summaryParts.length ? summaryParts.join('，') : '可进入详情页补充查看完整指标。';
}

function buildIndicatorItem(config = {}, currentReport = {}, previousReport = {}) {
  const current = currentReport.indicators?.[config.key] || {};
  const previous = previousReport?.indicators?.[config.key] || {};
  const currentValue = current.value ?? '--';
  const previousValue = previous.value ?? '--';
  const currentNum = Number(currentValue);
  const previousNum = Number(previousValue);
  const direction = Number.isFinite(currentNum) && Number.isFinite(previousNum)
    ? (currentNum === previousNum ? 'flat' : currentNum > previousNum ? 'up' : 'down')
    : 'flat';

  return {
    key: config.key,
    name: config.name || config.key,
    abbr: config.abbr || config.key,
    current: formatCompactNumber(currentValue, 2),
    previous: formatCompactNumber(previousValue, 2),
    delta: formatDelta(currentValue, previousValue),
    direction,
    status: current.status || 'unknown',
    unit: config.unit || ''
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
        hint: '优先看 pH、HCO3-、BE 的变化。',
        configs: indicatorConfigs.filter((item) => ['ph', 'hco3', 'be'].includes(item.key))
      },
      {
        key: 'gas-pressure',
        title: '气体分压指标',
        hint: '补充查看二氧化碳和氧分压。',
        configs: indicatorConfigs.filter((item) => ['pco2', 'po2'].includes(item.key))
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
    const summary = ReportModel.getReportSummary(report);
    return {
      reportId: getReportId(report),
      reportType: report.reportType,
      reportTypeLabel: ReportModel.getReportTypeName(report.reportType),
      formattedDate: toDateKey(report.reportDate),
      abnormalCount: summary.abnormalCount,
      normalCount: summary.normalCount,
      totalCount: summary.totalCount,
      statusText: summary.abnormalCount > 0 ? `${summary.abnormalCount} 项异常` : '本次无异常项',
      keySummary: buildKeySummary(report)
    };
  });

  const selectedCard = reportCards.find((item) => item.reportId === selectedCompareReportId) || reportCards[0] || null;

  return {
    tabs,
    filterType,
    reportCards,
    selectedCompareReportId: selectedCard?.reportId || ''
  };
}

function buildReportWorkbenchView({ selectedReportId, reports = [], feedingRecords = [], nutritionSettings = {}, fallbackWeight = 0 }) {
  const sortedReports = [...reports].sort((a, b) => parseDateKey(toDateKey(b.reportDate)).getTime() - parseDateKey(toDateKey(a.reportDate)).getTime());
  const currentReport = pickSelectedReport(sortedReports, selectedReportId);
  if (!currentReport) return null;

  const sameTypeReports = sortedReports.filter((report) => report.reportType === currentReport.reportType);
  const previousReport = sameTypeReports
    .filter((report) => toDateKey(report.reportDate) < toDateKey(currentReport.reportDate))
    .sort((a, b) => parseDateKey(toDateKey(b.reportDate)).getTime() - parseDateKey(toDateKey(a.reportDate)).getTime())[0];

  const compareCards = buildCompareCards(currentReport, previousReport);
  const trendMetrics = buildTrendMetrics(currentReport, sameTypeReports);
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
  buildReportArchivePreview,
  buildReportWorkbenchView,
  toDateKey
};
