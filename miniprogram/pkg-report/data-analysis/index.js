// pages/data-analysis/index.js
const NutritionModel = require('../../models/nutrition');
const { calculator: feedingCalculator } = require('../../utils/feedingUtils');
const {
  buildDataRecordsSummaryPreview
} = require('../../utils/dataRecordsSummaryPreview');
const {
  summarizeTreatmentRecords
} = require('../../utils/treatmentUtils');
const {
  groupV2FeedingRecordsByDate
} = require('../../utils/dataRecordsV2Adapter');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');

// 母乳热量 67kcal/100ml
// 特奶热量 69.5kcal/100ml
const BREAST_MILK_KCAL = 0.67;
const SPECIAL_MILK_KCAL = 0.70;
const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_SPECIAL_MILK_PROTEIN = 13.1;
const DEFAULT_SPECIAL_MILK_PROTEIN_ML = 1.97;
const DEFAULT_NATURAL_PROTEIN_COEFFICIENT = 1.2;
const FAT_RATIO_POPUP_LINES = [
  '0-6月: 45%-50%',
  '>6月: 35%-40%',
  '1-2岁: 30%-35%',
  '>6岁: 25%-30%'
];
const MAX_CUSTOM_RANGE_DAYS = 31;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_PRESETS = [
  { key: 'last7', label: '近一周', days: 7 },
  { key: 'last14', label: '近两周', days: 14 },
  { key: 'last30', label: '近一个月', days: 30 }
];
const DEFAULT_RANGE_PRESET = 'last7';

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

function formatDateKeyValue(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function getInclusiveDayCount(startDate, endDate) {
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.floor((endUtc - startUtc) / ONE_DAY_MS) + 1;
}

function getRangePresetConfig(preset) {
  return RANGE_PRESETS.find(item => item.key === preset) || RANGE_PRESETS[0];
}

function calculateRecentDateRange(days, referenceDate = new Date()) {
  const safeDays = Math.max(1, Number(days) || 1);
  const endDate = new Date(referenceDate);
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - safeDays + 1);
  startDate.setHours(0, 0, 0, 0);
  return { startDate, endDate };
}

function calculateMacroEnergyRatios({ protein = 0, carbs = 0, fat = 0 } = {}) {
  const proteinEnergy = (Number(protein) || 0) * 4;
  const carbsEnergy = (Number(carbs) || 0) * 4;
  const fatEnergy = (Number(fat) || 0) * 9;
  const totalEnergy = proteinEnergy + carbsEnergy + fatEnergy;
  if (totalEnergy <= 0) {
    return {
      protein: 0,
      carbs: 0,
      fat: 0
    };
  }
  return {
    protein: roundNumber((proteinEnergy / totalEnergy) * 100, 1),
    carbs: roundNumber((carbsEnergy / totalEnergy) * 100, 1),
    fat: roundNumber((fatEnergy / totalEnergy) * 100, 1)
  };
}

function calculateAgeInMonths(birthday, referenceDate = new Date()) {
  if (!birthday) return null;
  const birthDate = new Date(birthday);
  const refDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(refDate.getTime())) return null;
  let months = (refDate.getFullYear() - birthDate.getFullYear()) * 12 + (refDate.getMonth() - birthDate.getMonth());
  if (refDate.getDate() < birthDate.getDate()) {
    months -= 1;
  }
  return months < 0 ? 0 : months;
}

function getFatEnergyReference(birthday, referenceDate) {
  const ageMonths = calculateAgeInMonths(birthday, referenceDate);
  if (ageMonths === null) {
    return FAT_RATIO_POPUP_LINES.join('；');
  }
  if (ageMonths <= 6) return FAT_RATIO_POPUP_LINES[0];
  if (ageMonths >= 72) return FAT_RATIO_POPUP_LINES[3];
  if (ageMonths >= 12 && ageMonths < 24) return FAT_RATIO_POPUP_LINES[2];
  return FAT_RATIO_POPUP_LINES[1];
}

function buildReferenceRanges(nutritionSettings = {}, babyInfo = {}, referenceDate = new Date()) {
  const naturalProteinCoefficient = Number(
    nutritionSettings.natural_protein_coefficient ||
    babyInfo.nutritionSettings?.natural_protein_coefficient
  ) || DEFAULT_NATURAL_PROTEIN_COEFFICIENT;
  const macroRows = buildDataRecordsSummaryPreview({
    fatRatioPopupLines: FAT_RATIO_POPUP_LINES
  }).macroRows;
  const macroRange = (label) => {
    const row = macroRows.find(item => item.label === label);
    return (row?.infoLines || []).join('；');
  };
  return {
    naturalProteinCoefficient: `${roundNumber(naturalProteinCoefficient, 2)}g/kg/日`,
    proteinEnergy: macroRange('蛋白'),
    carbsEnergy: macroRange('碳水'),
    fatEnergy: getFatEnergyReference(babyInfo.birthday, referenceDate)
  };
}

function getDateTimestamp(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeDateKey(value) {
  if (!value) return 'unknown';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date
    ? value
    : (typeof value === 'object' && value.$date ? new Date(value.$date) : new Date(value));
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return 'unknown';
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasBasicInfoValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function calculateFormulaPowder(naturalMilkVolume, nutritionSettings = {}) {
  if (!naturalMilkVolume || naturalMilkVolume <= 0) {
    return 0;
  }
  const ratioPowder = Number(nutritionSettings.formula_milk_ratio?.powder);
  const ratioWater = Number(nutritionSettings.formula_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) {
    return 0;
  }
  return Math.round((naturalMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function calculateSpecialMilkPowder(specialMilkVolume, nutritionSettings = {}) {
  if (!specialMilkVolume || specialMilkVolume <= 0) {
    return 0;
  }
  const ratioPowder = Number(nutritionSettings.special_milk_ratio?.powder);
  const ratioWater = Number(nutritionSettings.special_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) {
    return 0;
  }
  return Math.round((specialMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function getFeedingVolumes(feeding = {}) {
  const naturalMilkVolume = parseFloat(feeding.naturalMilkVolume) || 0;
  const specialMilkVolume = feedingCalculator.getSpecialMilkVolume(feeding);
  return {
    naturalMilkVolume,
    specialMilkVolume
  };
}

function getMilkIntakeVolumes(intakes = []) {
  return (Array.isArray(intakes) ? intakes : []).reduce((totals, intake = {}) => {
    const isMilkIntake = intake.type === 'milk' || !!intake.milkType;
    if (!isMilkIntake) {
      return totals;
    }

    const volume = parseFloat(intake.quantity) || 0;
    if (volume <= 0) {
      return totals;
    }

    const isSpecialMilk = intake.proteinSource === 'special' || intake.milkType === 'special_formula';
    if (isSpecialMilk) {
      totals.specialMilkVolume += volume;
    } else {
      totals.naturalMilkVolume += volume;
    }
    return totals;
  }, {
    naturalMilkVolume: 0,
    specialMilkVolume: 0
  });
}

function isFilledValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function mergeFilledFields(...sources) {
  return sources.reduce((merged, source = {}) => {
    Object.keys(source || {}).forEach(key => {
      if (isFilledValue(source[key]) && !isFilledValue(merged[key])) {
        merged[key] = source[key];
      }
    });
    return merged;
  }, {});
}

function dedupeIntakes(intakes = []) {
  const seen = new Set();
  return (Array.isArray(intakes) ? intakes : []).filter(item => {
    if (!item) return false;
    const key = item._id || `${item.foodId || item.nameSnapshot || ''}_${item.recordedAt || ''}_${item.quantity || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasAnalysisContent(record = {}) {
  return (Array.isArray(record.feedings) && record.feedings.length > 0) ||
    (Array.isArray(record.intakes) && record.intakes.length > 0) ||
    hasDailySummaryNutritionContent(record.dailySummaryV2);
}

function hasDailySummaryNutritionContent(summary = {}) {
  const macro = summary.macroSummary || {};
  const milk = summary.milk || {};
  const food = summary.food || {};
  const treatment = summary.treatment || {};
  return [
    macro.calories,
    macro.protein,
    macro.naturalProtein,
    macro.specialProtein,
    macro.carbs,
    macro.fat,
    milk.calories,
    milk.naturalProtein,
    milk.specialProtein,
    food.calories,
    food.naturalProtein,
    food.specialProtein,
    treatment.calories,
    treatment.totalCalories,
    treatment.protein,
    treatment.carbs,
    treatment.fat
  ].some(value => Number(value) > 0);
}

function getTreatmentCalories(treatment = {}) {
  return Number(treatment.calories ?? treatment.totalCalories) || 0;
}

function buildAnalysisSummaryFromDailySummary(summary = {}) {
  if (!hasDailySummaryNutritionContent(summary)) {
    return null;
  }

  const macro = summary.macroSummary || {};
  const milk = summary.milk || {};
  const food = summary.food || {};
  const treatment = summary.treatment || {};
  const milkNaturalProtein = Number(milk.naturalProtein) || 0;
  const foodPremiumProtein = Number(food.premiumProtein) || 0;
  const foodRegularProtein = Number(food.regularProtein) || 0;
  const foodNaturalProtein = Number(food.naturalProtein) || 0;
  const regularProtein = foodRegularProtein || Math.max(0, foodNaturalProtein - foodPremiumProtein);

  return {
    calories: roundCalories(Number(macro.calories) || (
      (Number(milk.calories) || 0) + (Number(food.calories) || 0) + getTreatmentCalories(treatment)
    )),
    naturalProtein: roundNumber(Number(macro.naturalProtein) || (
      milkNaturalProtein + foodNaturalProtein
    ), 2),
    specialProtein: roundNumber(Number(macro.specialProtein) || (
      (Number(milk.specialProtein) || 0) + (Number(food.specialProtein) || 0)
    ), 2),
    premiumProtein: roundNumber(milkNaturalProtein + foodPremiumProtein, 2),
    regularProtein: roundNumber(regularProtein, 2),
    carbs: roundNumber(Number(macro.carbs) || (
      (Number(milk.carbs) || 0) + (Number(food.carbs) || 0) + (Number(treatment.carbs) || 0)
    ), 2),
    fat: roundNumber(Number(macro.fat) || (
      (Number(milk.fat) || 0) + (Number(food.fat) || 0) + (Number(treatment.fat) || 0)
    ), 2),
    milkCalories: roundCalories(Number(milk.calories) || 0),
    foodCalories: roundCalories(Number(food.calories) || 0),
    treatmentCalories: roundCalories(getTreatmentCalories(treatment)),
    treatmentProtein: roundNumber(Number(treatment.protein) || 0, 2)
  };
}

function isFreshDailySummary(summary = {}) {
  return !!summary?.date && summary.isDirty !== true;
}

function normalizeAnalysisFoodIntake(record = {}) {
  const nutrition = record.nutrition || {};
  const protein = Number(nutrition.protein) || 0;
  const proteinSource = record.proteinSource || record.foodSnapshot?.proteinSource || 'natural';
  const naturalProtein = typeof nutrition.naturalProtein === 'number'
    ? nutrition.naturalProtein
    : (typeof record.naturalProtein === 'number' ? record.naturalProtein : (proteinSource === 'special' ? 0 : protein));
  const specialProtein = typeof nutrition.specialProtein === 'number'
    ? nutrition.specialProtein
    : (typeof record.specialProtein === 'number' ? record.specialProtein : (proteinSource === 'special' ? protein : 0));

  return {
    ...record,
    type: record.type || 'food',
    nameSnapshot: record.nameSnapshot || record.foodName || record.foodSnapshot?.name || '食物记录',
    proteinSource,
    proteinQuality: record.proteinQuality || record.foodSnapshot?.proteinQuality || '',
    naturalProtein,
    specialProtein,
    nutrition: {
      ...nutrition,
      naturalProtein,
      specialProtein
    }
  };
}

function hasFoodSummaryContent(food = {}) {
  return [
    food.calories,
    food.protein,
    food.naturalProtein,
    food.specialProtein,
    food.carbs,
    food.fat,
    food.fiber
  ].some(value => Number(value) > 0);
}

function hasMilkSummaryContent(milk = {}) {
  return [
    milk.totalVolume,
    milk.naturalMilkVolume,
    milk.specialMilkVolume,
    milk.calories,
    milk.protein,
    milk.naturalProtein,
    milk.specialProtein,
    milk.carbs,
    milk.fat
  ].some(value => Number(value) > 0);
}

function hasSummaryMilkVolumeSplit(summary = {}) {
  const milk = summary.milk || {};
  const totalVolume = Number(milk.totalVolume) || 0;
  if (totalVolume <= 0) return true;
  const naturalMilkVolume = Number(milk.naturalMilkVolume) || 0;
  const specialMilkVolume = Number(milk.specialMilkVolume) || 0;
  return naturalMilkVolume + specialMilkVolume > 0;
}

function summaryNeedsMilkRecordFallback(summary = {}) {
  const milkCount = Number(summary.recordCounts?.milk) || 0;
  const milk = summary.milk || {};
  const totalVolume = Number(milk.totalVolume) || 0;
  return (milkCount > 0 || totalVolume > 0) && !hasSummaryMilkVolumeSplit(summary);
}

function buildMilkSummaryFeeding(summary = {}) {
  const milk = summary.milk || {};
  if (!hasMilkSummaryContent(milk) || !hasSummaryMilkVolumeSplit(summary)) return null;
  return {
    _id: `daily-summary-milk-${summary.date || summary._id || ''}`,
    source: 'daily_summary_v2',
    isV2FeedingRecord: true,
    naturalMilkVolume: roundNumber(Number(milk.naturalMilkVolume) || 0, 2),
    specialMilkVolume: roundNumber(Number(milk.specialMilkVolume) || 0, 2),
    totalMilkVolume: roundNumber(Number(milk.totalVolume) || 0, 2),
    nutritionDisplay: {
      calories: roundCalories(Number(milk.calories) || 0),
      carbs: roundNumber(Number(milk.carbs) || 0, 2),
      fat: roundNumber(Number(milk.fat) || 0, 2),
      naturalProtein: roundNumber(Number(milk.naturalProtein) || 0, 2),
      specialProtein: roundNumber(Number(milk.specialProtein) || 0, 2)
    }
  };
}

function dailySummaryToAnalysisRecord(summary = {}, options = {}) {
  const food = summary.food || {};
  const foodIntakes = options.includeFoodSummary !== false && hasFoodSummaryContent(food)
    ? [{
      _id: `daily-summary-food-${summary.date || summary._id || ''}`,
      type: 'food',
      foodId: '',
      nameSnapshot: '食物汇总',
      proteinSource: 'natural',
      nutrition: {
        calories: roundCalories(Number(food.calories) || 0),
        protein: roundNumber(Number(food.protein) || 0, 2),
        naturalProtein: roundNumber(Number(food.naturalProtein) || 0, 2),
        specialProtein: roundNumber(Number(food.specialProtein) || 0, 2),
        carbs: roundNumber(Number(food.carbs) || 0, 2),
        fat: roundNumber(Number(food.fat) || 0, 2),
        fiber: roundNumber(Number(food.fiber) || 0, 2)
      },
      naturalProtein: roundNumber(Number(food.naturalProtein) || 0, 2),
      specialProtein: roundNumber(Number(food.specialProtein) || 0, 2)
    }]
    : [];

  const milkFeeding = options.includeMilkSummary === true
    ? buildMilkSummaryFeeding(summary)
    : null;

  return {
    _id: summary._id || `daily-summary-${summary.date || ''}`,
    babyUid: summary.babyUid || '',
    date: summary.date || '',
    basicInfo: { ...(summary.basicInfo || {}) },
    feedings: milkFeeding ? [milkFeeding] : [],
    intakes: foodIntakes,
    source: 'daily_summary_v2',
    dailySummaryV2: summary
  };
}

function getTreatmentRecordDateKey(record = {}) {
  if (record.dateKey && typeof record.dateKey === 'string') {
    return record.dateKey;
  }
  return normalizeDateKey(record.date || record.startDateTime);
}

function hasTreatmentNutritionContent(record = {}) {
  const summary = summarizeTreatmentRecords([record]);
  return summary.totalCalories > 0 || summary.carbs > 0 || summary.protein > 0 || summary.fat > 0;
}

function mergeDailyAnalysisRecord(existing, record = {}) {
  if (!existing) {
    return {
      ...record,
      basicInfo: { ...(record.basicInfo || {}) },
      feedings: Array.isArray(record.feedings) ? [...record.feedings] : [],
      intakes: Array.isArray(record.intakes) ? [...record.intakes] : []
    };
  }

  return {
    ...existing,
    ...record,
    date: existing.date || record.date,
    basicInfo: mergeFilledFields(existing.basicInfo, record.basicInfo),
    hasRawNutritionDetails: existing.hasRawNutritionDetails === true || record.hasRawNutritionDetails === true,
    feedings: [
      ...(Array.isArray(existing.feedings) ? existing.feedings : []),
      ...(Array.isArray(record.feedings) ? record.feedings : [])
    ],
    intakes: dedupeIntakes([
      ...(Array.isArray(existing.intakes) ? existing.intakes : []),
      ...(Array.isArray(record.intakes) ? record.intakes : [])
    ])
  };
}

function pickLatestBasicInfoSnapshot(feedingSnapshot = {}, growthSnapshot = {}) {
  const pickField = (feedingCandidate, growthCandidate) => {
    if (!feedingCandidate && !growthCandidate) {
      return { value: '', source: 'empty', timestamp: 0 };
    }
    if (!feedingCandidate) {
      return growthCandidate;
    }
    if (!growthCandidate) {
      return feedingCandidate;
    }
    return (growthCandidate.timestamp || 0) >= (feedingCandidate.timestamp || 0)
      ? growthCandidate
      : feedingCandidate;
  };

  const weightCandidate = pickField(
    hasBasicInfoValue(feedingSnapshot.weight) ? {
      value: feedingSnapshot.weight,
      source: feedingSnapshot.weightSource || 'history-feeding',
      timestamp: feedingSnapshot.weightTimestamp || 0
    } : null,
    hasBasicInfoValue(growthSnapshot.weight) ? {
      value: growthSnapshot.weight,
      source: growthSnapshot.weightSource || 'history-growth',
      timestamp: growthSnapshot.weightTimestamp || 0
    } : null
  );

  const heightCandidate = pickField(
    hasBasicInfoValue(feedingSnapshot.height) ? {
      value: feedingSnapshot.height,
      source: feedingSnapshot.heightSource || 'history-feeding',
      timestamp: feedingSnapshot.heightTimestamp || 0
    } : null,
    hasBasicInfoValue(growthSnapshot.height) ? {
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
}

function calculateMilkNutrition(feeding, nutritionSettings = {}) {
  const naturalMilkVolume = parseFloat(feeding.naturalMilkVolume) || 0;
  const specialMilkVolume = feedingCalculator.getSpecialMilkVolume(feeding);
  const specialPowderWeight = feedingCalculator.getSpecialMilkPowder(feeding, nutritionSettings);
  const naturalMilkType = feeding.naturalMilkType || 'breast';

  let naturalProtein = 0;
  let naturalCarbs = 0;
  let naturalFat = 0;
  let naturalCalories = naturalMilkVolume * BREAST_MILK_KCAL;
  if (naturalMilkType === 'formula') {
    const powderWeight = calculateFormulaPowder(naturalMilkVolume, nutritionSettings);
    const formulaProteinPer100g = Number(nutritionSettings.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
    const formulaCarbsPer100g = Number(nutritionSettings.formula_milk_carbs) || 0;
    const formulaFatPer100g = Number(nutritionSettings.formula_milk_fat) || 0;
    if (powderWeight > 0 && formulaProteinPer100g > 0) {
      naturalProtein = (powderWeight * formulaProteinPer100g) / 100;
      naturalCarbs = (powderWeight * formulaCarbsPer100g) / 100;
      naturalFat = (powderWeight * formulaFatPer100g) / 100;
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
    const naturalCarbsPer100ml = Number(nutritionSettings.natural_milk_carbs) || 0;
    const naturalFatPer100ml = Number(nutritionSettings.natural_milk_fat) || 0;
    naturalCarbs = (naturalMilkVolume * naturalCarbsPer100ml) / 100;
    naturalFat = (naturalMilkVolume * naturalFatPer100ml) / 100;
    const naturalCaloriesPer100ml = Number(nutritionSettings.natural_milk_calories);
    if (naturalCaloriesPer100ml > 0) {
      naturalCalories = (naturalMilkVolume * naturalCaloriesPer100ml) / 100;
    }
  }

  let specialProtein = 0;
  let specialCalories = 0;
  let specialCarbs = 0;
  let specialFat = 0;
  if (specialPowderWeight > 0) {
    const specialProteinPer100g = Number(nutritionSettings.special_milk_protein) || DEFAULT_SPECIAL_MILK_PROTEIN;
    const specialCaloriesPer100g = Number(nutritionSettings.special_milk_calories);
    const specialCarbsPer100g = Number(nutritionSettings.special_milk_carbs) || 0;
    const specialFatPer100g = Number(nutritionSettings.special_milk_fat) || 0;
    specialProtein = (specialPowderWeight * specialProteinPer100g) / 100;
    specialCarbs = (specialPowderWeight * specialCarbsPer100g) / 100;
    specialFat = (specialPowderWeight * specialFatPer100g) / 100;
    if (specialCaloriesPer100g > 0) {
      specialCalories = (specialPowderWeight * specialCaloriesPer100g) / 100;
    } else {
      specialCalories = specialMilkVolume * SPECIAL_MILK_KCAL;
    }
  } else if (specialMilkVolume > 0) {
    const ratioPowder = Number(nutritionSettings.special_milk_ratio?.powder);
    const ratioWater = Number(nutritionSettings.special_milk_ratio?.water);
    const specialProteinPer100g = Number(nutritionSettings.special_milk_protein);
    const specialCarbsPer100g = Number(nutritionSettings.special_milk_carbs);
    const specialFatPer100g = Number(nutritionSettings.special_milk_fat);
    const powderWeight = ratioPowder > 0 && ratioWater > 0
      ? specialMilkVolume * ratioPowder / ratioWater
      : 0;
    if (powderWeight > 0 && specialProteinPer100g > 0) {
      specialProtein = (powderWeight * specialProteinPer100g) / 100;
      if (specialCarbsPer100g > 0) {
        specialCarbs = (powderWeight * specialCarbsPer100g) / 100;
      }
      if (specialFatPer100g > 0) {
        specialFat = (powderWeight * specialFatPer100g) / 100;
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
    naturalProtein: roundNumber(naturalProtein, 2),
    specialProtein: roundNumber(specialProtein, 2),
    carbs: roundNumber(naturalCarbs + specialCarbs, 2),
    fat: roundNumber(naturalFat + specialFat, 2),
    naturalCalories: roundCalories(naturalCalories),
    specialCalories: roundCalories(specialCalories)
  };
}

Page({
  data: {
    // 日期范围选择
    rangePreset: DEFAULT_RANGE_PRESET,
    rangePresets: RANGE_PRESETS,
    customRangeActive: false,
    customRangeStartKey: '',
    customRangeEndKey: '',
    
    // 日期范围显示
    dateRangeText: '',
    
    // 日期选择器
    showDatePicker: false,
    datePickerMode: 'custom',
    pickerYear: new Date().getFullYear(),
    pickerMonth: new Date().getMonth() + 1,
    pickerRangeStartKey: '',
    pickerRangeEndKey: '',
    todayDateKey: formatDateKeyValue(new Date()),
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    
    // 图表数据
    chartData: {
      dates: [], // X轴日期数据
      milkVolumes: [], // 奶量数据
      naturalMilk: [], // 天然奶量
      specialMilk: [], // 特殊奶量
      naturalProteinCoefficient: [], // 天然蛋白系数 (g/kg)
      specialProteinCoefficient: [], // 特殊蛋白系数 (g/kg)
      totalProteinCoefficient: [], // 总蛋白系数 (g/kg)
      premiumProteinRatio: [], // 优质蛋白占比 (%)
      regularProteinRatio: [], // 普通蛋白占比 (%)
      totalCalories: [], // 总热量
      calorieCoefficient: [] // 热量系数 (kcal/kg)
    },
    
    // 统计数据
    statistics: {
      avgMilkVolume: 0, // 平均奶量
      avgNaturalMilk: 0, // 平均天然奶
      avgSpecialMilk: 0, // 平均特奶
      avgProteinRatio: '0:0', // 平均蛋白质比例
      avgCalories: 0, // 平均热量
      avgCalorieCoefficient: 0, // 平均热量系数
      avgTotalProteinCoefficient: 0, // 平均总蛋白系数
      avgPremiumProteinRatio: 0, // 平均优质蛋白占比
      avgRegularProteinRatio: 0, // 平均普通蛋白占比
      avgProteinEnergyRatio: 0, // 平均蛋白供能比
      avgCarbsEnergyRatio: 0, // 平均碳水供能比
      avgFatEnergyRatio: 0, // 平均脂肪供能比
      avgMilkCalories: 0, // 奶类日均热量
      avgFoodCalories: 0, // 食物日均热量
      avgTreatmentCalories: 0, // 治疗营养日均热量
      milkCalorieRatio: 0, // 奶类热量占比
      foodCalorieRatio: 0, // 食物热量占比
      treatmentCalorieRatio: 0, // 治疗热量占比
      hasCalorieSourceBreakdown: false,
      totalDays: 0, // 有记录天数
      rangeDays: 0 // 当前范围天数
    },
    referenceRanges: buildReferenceRanges(),
    
    // 加载状态
    loading: true,
    refreshing: false,
    hasLoadedAnalysis: false,
    hasData: false,
    
    // 宝宝信息
    babyInfo: null,
    nutritionSettings: null,
    
    // 图表配置
    ec: {
      lazyLoad: true
    }
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    // 刷新数据
    if (this.data.babyInfo) {
      this.loadAnalysisData();
    }
  },

  // 初始化页面
  async initPage() {
    try {
      wx.showLoading({ title: '加载中...' });
      
      // 获取宝宝信息
      await this.loadBabyInfo();
      
      // 加载配奶设置
      await this.loadNutritionSettings();
      
      // 加载分析数据
      await this.loadAnalysisData();
      
      wx.hideLoading();
    } catch (error) {
      console.error('初始化页面失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
  },

  // 加载宝宝信息
  async loadBabyInfo() {
    try {
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        throw new Error('未找到宝宝信息');
      }
      
      const db = wx.cloud.database();
      const res = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        this.setData({
          babyInfo: res.data[0]
        });
      }
    } catch (error) {
      console.error('加载宝宝信息失败:', error);
      throw error;
    }
  },

  // 加载配奶设置
  async loadNutritionSettings() {
    try {
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({
          nutritionSettings: defaultSettings,
          referenceRanges: buildReferenceRanges(defaultSettings, this.data.babyInfo)
        });
        return;
      }
      
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      
      if (settings) {
        this.setData({
          nutritionSettings: settings,
          referenceRanges: buildReferenceRanges(settings, this.data.babyInfo)
        });
      } else {
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({
          nutritionSettings: defaultSettings,
          referenceRanges: buildReferenceRanges(defaultSettings, this.data.babyInfo)
        });
      }
    } catch (error) {
      console.error('加载配奶设置失败:', error);
      const defaultSettings = NutritionModel.createDefaultSettings();
      this.setData({
        nutritionSettings: defaultSettings,
        referenceRanges: buildReferenceRanges(defaultSettings, this.data.babyInfo)
      });
    }
  },

  // 加载分析数据
  async loadAnalysisData() {
    const isInitialLoad = !this.data.hasLoadedAnalysis;
    try {
      this.setData(isInitialLoad ? { loading: true } : { refreshing: true });
      
      const { startDate, endDate } = this.calculateDateRange();
      
      // 更新日期范围文本
      this.updateDateRangeText(startDate, endDate);
      
      // 从数据库查询数据
      const [records, treatmentRecords] = await Promise.all([
        this.fetchFeedingRecords(startDate, endDate),
        this.fetchTreatmentRecords(startDate, endDate)
      ]);
      const basicInfoSnapshots = await this.loadAnalysisBasicInfoSnapshots(startDate, endDate, records);
      
      // 处理数据
      this.processAnalysisData(records, startDate, endDate, basicInfoSnapshots, treatmentRecords);
      
      // 初始化图表
      this.initCharts();
      
      this.setData({ 
        loading: false,
        refreshing: false,
        hasLoadedAnalysis: true,
        hasData: records.some(hasAnalysisContent) || treatmentRecords.some(hasTreatmentNutritionContent)
      });
      
    } catch (error) {
      console.error('加载分析数据失败:', error);
      this.setData({
        loading: false,
        refreshing: false,
        hasLoadedAnalysis: true
      });
      wx.showToast({
        title: '加载数据失败',
        icon: 'none'
      });
    }
  },

  // 计算日期范围
  calculateDateRange(timeDimension, weekOffset = 0, monthOffset = 0) {
    if (timeDimension === 'week' || timeDimension === 'month') {
      return this.calculateLegacyDateRange(timeDimension, weekOffset, monthOffset);
    }

    const today = new Date();
    let startDate;
    let endDate;
    if (this.data.customRangeActive) {
      startDate = parseDateKey(this.data.customRangeStartKey);
      endDate = parseDateKey(this.data.customRangeEndKey);
    }

    if (!startDate || !endDate) {
      const preset = getRangePresetConfig(this.data.rangePreset || DEFAULT_RANGE_PRESET);
      ({ startDate, endDate } = calculateRecentDateRange(preset.days, today));
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    if (endDate > todayEnd) {
      endDate = todayEnd;
    }

    return { startDate, endDate };
  },

  calculateLegacyDateRange(timeDimension, weekOffset = 0, monthOffset = 0) {
    const today = new Date();
    let startDate, endDate;
    
    if (timeDimension === 'week') {
      // 计算周范围
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周一为第一天
      
      startDate = new Date(today);
      startDate.setDate(today.getDate() + mondayOffset + (weekOffset * 7));
      startDate.setHours(0, 0, 0, 0);
      
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // 计算月范围 - 总是查询整个月的数据
      const year = today.getFullYear();
      const month = today.getMonth() + monthOffset;
      
      startDate = new Date(year, month, 1);
      startDate.setHours(0, 0, 0, 0);
      
      // 结束日期为该月最后一天（无论是否当前月）
      endDate = new Date(year, month + 1, 0);
      endDate.setHours(23, 59, 59, 999);
    }

    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const isCurrentPeriod = timeDimension === 'week' ? weekOffset === 0 : monthOffset === 0;
    if (isCurrentPeriod && endDate > todayEnd) {
      endDate = todayEnd;
    }
    
    return { startDate, endDate };
  },

  // 更新日期范围文本
  updateDateRangeText(startDate, endDate) {
    this.setData({
      dateRangeText: `${this.formatFullDate(startDate)} - ${this.formatFullDate(endDate)}`
    });
  },

  // 从数据库获取喂养记录
  async fetchFeedingRecords(startDate, endDate) {
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID');
        return [];
      }
      
      // 设置时间为当天的开始和结束（和 data-records 页面一致）
      const queryStartDate = new Date(startDate);
      queryStartDate.setHours(0, 0, 0, 0);
      
      const queryEndDate = new Date(endDate);
      queryEndDate.setHours(23, 59, 59, 999);
      
      console.log('查询日期范围:', this.formatDateKey(queryStartDate), '到', this.formatDateKey(queryEndDate));
      console.log('查询时间戳:', queryStartDate.getTime(), '到', queryEndDate.getTime());
      
      const startKey = this.formatDateKey(queryStartDate);
      const endKey = this.formatDateKey(queryEndDate);
      const summaryRecords = await DailyRecordV2Service.getDailySummariesForRange(babyUid, startKey, endKey, {
        rebuildMissing: false
      });
      const dateKeys = this.generateDateList(queryStartDate, queryEndDate).map(date => this.formatDateKey(date));
      const freshSummaryRecords = (summaryRecords || []).filter(isFreshDailySummary);
      const allDateSet = new Set(dateKeys);
      const rawRecords = await this.loadRawAnalysisRecordsForRange(babyUid, startKey, endKey, allDateSet);
      const rawMilkDateSet = new Set();
      const rawFoodDateSet = new Set();
      rawRecords.forEach(record => {
        const dateKey = normalizeDateKey(record.date);
        if (Array.isArray(record.feedings) && record.feedings.length > 0) {
          rawMilkDateSet.add(dateKey);
        }
        if (Array.isArray(record.intakes) && record.intakes.length > 0) {
          rawFoodDateSet.add(dateKey);
        }
      });

      const mergedMap = new Map();
      freshSummaryRecords
        .map(summary => {
          const dateKey = normalizeDateKey(summary.date);
          const includeMilkSummary = !rawMilkDateSet.has(dateKey) && !summaryNeedsMilkRecordFallback(summary);
          const includeFoodSummary = !rawFoodDateSet.has(dateKey);
          return dailySummaryToAnalysisRecord(summary, {
            includeMilkSummary,
            includeFoodSummary
          });
        })
        .forEach(record => {
          if (!record) return;
          const key = normalizeDateKey(record.date);
          mergedMap.set(key, mergeDailyAnalysisRecord(mergedMap.get(key), record));
        });
      let allData = Array.from(mergedMap.values());
      
      console.log('分页查询完成，总共:', allData.length, '条');

      rawRecords.forEach(record => {
        const dateKey = normalizeDateKey(record.date);
        if (dateKey === 'unknown') return;
        mergedMap.set(dateKey, mergeDailyAnalysisRecord(mergedMap.get(dateKey), record));
      });
      allData = Array.from(mergedMap.values()).filter(hasAnalysisContent);
      
      // 在前端排序，兼容 Date 和 YYYY-MM-DD 字符串两种日期形态
      if (allData.length > 0) {
        allData.sort((a, b) => normalizeDateKey(a.date).localeCompare(normalizeDateKey(b.date)));
      }
      
      // 构造返回格式与原来一致
      const res = { data: allData };
      
      console.log('======== 查询结果检查 ========');
      console.log('查询到的记录数:', res.data.length);
      if (res.data.length > 0) {
        console.log('第一条记录:', {
          date: res.data[0].date,
          babyUid: res.data[0].babyUid,
          type: typeof res.data[0].date,
          isDate: res.data[0].date instanceof Date,
          feedings: res.data[0].feedings?.length
        });
        console.log('最后一条记录:', {
          date: res.data[res.data.length - 1].date,
          babyUid: res.data[res.data.length - 1].babyUid,
          type: typeof res.data[res.data.length - 1].date,
          feedings: res.data[res.data.length - 1].feedings?.length
        });
        
        // 检查是否有21号之后的数据
        const after20 = res.data.filter(r => {
          const d = new Date(r.date);
          return d.getDate() > 20;
        });
        console.log('21号之后的记录数:', after20.length);
        if (after20.length > 0) {
          console.log('21号之后的日期:', after20.map(r => new Date(r.date).getDate()));
        }
      }
      
      return res.data || [];
    } catch (error) {
      console.error('获取喂养记录失败:', error);
      console.error('错误详情:', JSON.stringify(error));
      wx.showToast({
        title: '数据加载失败',
        icon: 'none'
      });
      return [];
    }
  },

  // 读取区间内的 v2 喂奶记录（奶统计数据源）。失败时返回空数组，奶统计自动降级回旧数据，避免崩溃。
  async loadV2MilkRecordsForRange(babyUid, startKey, endKey) {
    if (!babyUid || !startKey || !endKey) {
      return [];
    }
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      if (typeof db.collection !== 'function' || !_?.gte || !_?.lte) {
        return [];
      }
      const MAX_LIMIT = 20;
      let all = [];
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await db.collection('feeding_records_v2')
          .where({
            babyUid,
            status: 'active',
            date: _.gte(startKey).and(_.lte(endKey))
          })
          .orderBy('date', 'asc')
          .skip(skip)
          .limit(MAX_LIMIT)
          .get();
        const batch = res.data || [];
        all = all.concat(batch);
        skip += batch.length;
        if (batch.length < MAX_LIMIT) {
          hasMore = false;
        }
      }
      return all;
    } catch (error) {
      console.warn('加载 v2 喂奶记录失败，奶统计降级为旧数据:', error);
      return [];
    }
  },

  async loadFoodIntakeRecordsForRange(babyUid, startKey, endKey) {
    if (!babyUid || !startKey || !endKey) {
      return [];
    }
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      if (typeof db.collection !== 'function' || !_?.gte || !_?.lte) {
        return [];
      }
      const MAX_LIMIT = 20;
      let all = [];
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await db.collection('food_intake_records')
          .where({
            babyUid,
            status: 'active',
            date: _.gte(startKey).and(_.lte(endKey))
          })
          .orderBy('date', 'asc')
          .skip(skip)
          .limit(MAX_LIMIT)
          .get();
        const batch = res.data || [];
        all = all.concat(batch);
        skip += batch.length;
        if (batch.length < MAX_LIMIT) {
          hasMore = false;
        }
      }
      return all.map(normalizeAnalysisFoodIntake);
    } catch (error) {
      console.warn('加载区间食物记录失败，食物统计将仅使用汇总数据:', error);
      return [];
    }
  },

  async loadRawAnalysisRecordsForRange(babyUid, startKey, endKey, targetDateSet = new Set()) {
    if (!babyUid || !startKey || !endKey || targetDateSet.size === 0) {
      return [];
    }
    try {
      const [v2MilkRecords, foodIntakeRecords] = await Promise.all([
        this.loadV2MilkRecordsForRange(babyUid, startKey, endKey),
        this.loadFoodIntakeRecordsForRange(babyUid, startKey, endKey)
      ]);

      const mergedMap = new Map();
      const v2MilkByDate = groupV2FeedingRecordsByDate(v2MilkRecords, babyUid);
      v2MilkByDate.forEach((dailyRecord, dateKey) => {
        if (!targetDateSet.has(dateKey)) return;
        mergedMap.set(dateKey, mergeDailyAnalysisRecord(mergedMap.get(dateKey), {
          ...dailyRecord,
          hasRawNutritionDetails: true
        }));
      });

      foodIntakeRecords.forEach(intake => {
        const dateKey = normalizeDateKey(intake.date);
        if (!targetDateSet.has(dateKey)) return;
        const record = {
          _id: `raw-food-${dateKey}`,
          id: `raw-food-${dateKey}`,
          babyUid,
          date: dateKey,
          basicInfo: {},
          feedings: [],
          intakes: [intake],
          source: 'raw_range_fallback',
          hasRawNutritionDetails: true
        };
        mergedMap.set(dateKey, mergeDailyAnalysisRecord(mergedMap.get(dateKey), record));
      });

      return Array.from(mergedMap.values());
    } catch (error) {
      console.warn('区间原始记录兜底加载失败，数据分析将仅使用已有汇总:', error);
      return [];
    }
  },

  async fetchTreatmentRecords(startDate, endDate) {
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');

      if (!babyUid) {
        return [];
      }

      const queryStartDate = new Date(startDate);
      queryStartDate.setHours(0, 0, 0, 0);
      const queryEndDate = new Date(endDate);
      queryEndDate.setHours(23, 59, 59, 999);
      const startKey = this.formatDateKey(queryStartDate);
      const endKey = this.formatDateKey(queryEndDate);
      const pageSize = 20;

      const fetchPaged = async (whereObj, orderField) => {
        let allData = [];
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
          let query = db.collection('treatment_records').where(whereObj);
          if (orderField && typeof query.orderBy === 'function') {
            query = query.orderBy(orderField, 'asc');
          }
          const res = await query
            .skip(skip)
            .limit(pageSize)
            .get();
          const batch = res.data || [];
          allData = allData.concat(batch);
          skip += batch.length;
          hasMore = batch.length === pageSize;
        }

        return allData;
      };

      const [dateRecords, dateKeyRecords] = await Promise.all([
        fetchPaged({
          babyUid,
          date: _.gte(queryStartDate).and(_.lte(queryEndDate))
        }, 'date'),
        fetchPaged({
          babyUid,
          dateKey: _.gte(startKey).and(_.lte(endKey))
        }, 'dateKey')
      ]);

      const mergedMap = new Map();
      dateRecords.concat(dateKeyRecords).forEach(record => {
        if (!record) return;
        const key = record._id || `${record.babyUid || ''}_${getTreatmentRecordDateKey(record)}_${record.startTime || ''}`;
        mergedMap.set(key, record);
      });

      return Array.from(mergedMap.values())
        .sort((a, b) => getTreatmentRecordDateKey(a).localeCompare(getTreatmentRecordDateKey(b)));
    } catch (error) {
      console.warn('获取治疗记录失败，数据分析将仅展示喂养记录:', error);
      return [];
    }
  },

  async fetchRecordsByDateUpperBound(collectionName, babyUid, dateField, endDate, extraWhere = {}) {
    const db = wx.cloud.database();
    const _ = db.command;
    const pageSize = 100;
    let skip = 0;
    let hasMore = true;
    let allData = [];

    while (hasMore) {
      const res = await db.collection(collectionName)
        .where({
          babyUid,
          [dateField]: _.lte(endDate),
          ...extraWhere
        })
        .orderBy(dateField, 'desc')
        .skip(skip)
        .limit(pageSize)
        .get();

      const batch = res.data || [];
      allData = allData.concat(batch);
      skip += batch.length;
      hasMore = batch.length === pageSize;
    }

    return allData;
  },

  buildAnalysisBasicInfoSnapshots(startDate, endDate, feedingRecords = [], growthRecords = []) {
    const dateList = this.generateDateList(startDate, endDate);
    const feedingCandidates = [];
    const growthCandidates = [];

    (Array.isArray(feedingRecords) ? feedingRecords : []).forEach(record => {
      const basicInfo = record?.basicInfo || {};
      const timestamp = getDateTimestamp(record?.date);
      if (!timestamp) return;

      const snapshot = {
        weightTimestamp: timestamp,
        heightTimestamp: timestamp
      };
      if (hasBasicInfoValue(basicInfo.weight ?? record?.weight)) {
        snapshot.weight = basicInfo.weight ?? record.weight;
        snapshot.weightSource = 'history-feeding';
      }
      if (hasBasicInfoValue(basicInfo.height ?? record?.height)) {
        snapshot.height = basicInfo.height ?? record.height;
        snapshot.heightSource = 'history-feeding';
      }
      if (hasBasicInfoValue(snapshot.weight) || hasBasicInfoValue(snapshot.height)) {
        feedingCandidates.push(snapshot);
      }
    });

    (Array.isArray(growthRecords) ? growthRecords : []).forEach(record => {
      const timestamp = getDateTimestamp(record?.recordDate || record?.date);
      if (!timestamp) return;

      const snapshot = {
        weightTimestamp: timestamp,
        heightTimestamp: timestamp
      };
      if (hasBasicInfoValue(record?.weight)) {
        snapshot.weight = record.weight;
        snapshot.weightSource = 'history-growth';
      }
      if (hasBasicInfoValue(record?.length ?? record?.height)) {
        snapshot.height = record.length ?? record.height;
        snapshot.heightSource = 'history-growth';
      }
      if (hasBasicInfoValue(snapshot.weight) || hasBasicInfoValue(snapshot.height)) {
        growthCandidates.push(snapshot);
      }
    });

    const findLatestSnapshot = (candidates, date) => {
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      const endTimestamp = endOfDay.getTime();
      return candidates
        .filter(snapshot => {
          const timestamp = Math.max(snapshot.weightTimestamp || 0, snapshot.heightTimestamp || 0);
          return timestamp > 0 && timestamp <= endTimestamp;
        })
        .sort((a, b) => Math.max(b.weightTimestamp || 0, b.heightTimestamp || 0) - Math.max(a.weightTimestamp || 0, a.heightTimestamp || 0))[0] || {};
    };

    return dateList.reduce((snapshots, date) => {
      const dateKey = this.formatDateKey(date);
      snapshots[dateKey] = pickLatestBasicInfoSnapshot(
        findLatestSnapshot(feedingCandidates, date),
        findLatestSnapshot(growthCandidates, date)
      );
      return snapshots;
    }, {});
  },

  async loadAnalysisBasicInfoSnapshots(startDate, endDate, records = []) {
    try {
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        return this.buildAnalysisBasicInfoSnapshots(startDate, endDate, records, []);
      }

      const queryEndDate = new Date(endDate);
      queryEndDate.setHours(23, 59, 59, 999);
      // 每日体重在 v2 升级后写入 growth_records_v2（含历史回填），手动测量仍在 growth_records
      const [dailyWeightHistory, growthHistory] = await Promise.all([
        this.fetchRecordsByDateUpperBound('growth_records_v2', babyUid, 'date', queryEndDate, { status: 'active' }),
        this.fetchRecordsByDateUpperBound('growth_records', babyUid, 'recordDate', queryEndDate)
      ]);
      return this.buildAnalysisBasicInfoSnapshots(startDate, endDate, dailyWeightHistory, growthHistory);
    } catch (error) {
      console.warn('加载历史体重快照失败，降级使用当前范围记录:', error);
      return this.buildAnalysisBasicInfoSnapshots(startDate, endDate, records, []);
    }
  },

  // 处理分析数据
  processAnalysisData(records, startDate, endDate, basicInfoSnapshots = {}, treatmentRecords = []) {
    console.log('========== 开始处理分析数据 ==========');
    console.log('收到记录数:', records.length);
    
    const dates = [];
    const dateKeys = [];
    const milkVolumes = [];
    const naturalMilk = [];
    const specialMilk = [];
    const naturalProteinCoefficient = [];
    const specialProteinCoefficient = [];
    const totalProteinCoefficient = [];
    const premiumProteinRatio = [];
    const regularProteinRatio = [];
    const totalCalories = [];
    const calorieCoefficient = [];
    
    // 生成日期列表
    const dateList = this.generateDateList(startDate, endDate);
    console.log('======== 生成的日期列表 ========');
    console.log('需要展示的日期数:', dateList.length);
    console.log('第一天:', dateList[0]);
    console.log('最后一天:', dateList[dateList.length - 1]);
    console.log('日期范围:', this.formatDateKey(dateList[0]), '到', this.formatDateKey(dateList[dateList.length - 1]));
    // 打印最后几天的日期
    if (dateList.length > 5) {
      console.log('最后5天:');
      for (let i = dateList.length - 5; i < dateList.length; i++) {
        const d = dateList[i];
        console.log(`  ${i}: ${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`);
      }
    }
    
    // 创建日期到数据的映射
    const dateMap = new Map();
    records.forEach((record, index) => {
      const dateKey = normalizeDateKey(record.date);
      if (dateKey === 'unknown') {
        return;
      }
      
      dateMap.set(dateKey, mergeDailyAnalysisRecord(dateMap.get(dateKey), record));
      // 只打印前3条和后3条
      if (index < 3 || index >= records.length - 3) {
        console.log(`记录${index + 1}: 原始日期=${record.date}, 解析后=${dateKey}, 喂养次数=${record.feedings ? record.feedings.length : 0}`);
      } else if (index === 3) {
        console.log(`  ... (省略中间 ${records.length - 6} 条记录) ...`);
      }
    });
    
    console.log('日期映射Map大小:', dateMap.size);
    console.log('日期映射Keys:', Array.from(dateMap.keys()));

    const treatmentMap = new Map();
    (Array.isArray(treatmentRecords) ? treatmentRecords : []).forEach(record => {
      const dateKey = getTreatmentRecordDateKey(record);
      if (dateKey === 'unknown') return;
      const current = treatmentMap.get(dateKey) || [];
      current.push(record);
      treatmentMap.set(dateKey, current);
    });
    
    // 统计变量
    let totalMilk = 0;
    let totalNatural = 0;
    let totalSpecial = 0;
    let totalCal = 0;
    let totalNaturalProtein = 0;
    let totalSpecialProtein = 0;
    let totalCalorieCoefficient = 0;
    let coefficientDays = 0;
    let totalPremiumProteinRatio = 0;
    let totalRegularProteinRatio = 0;
    let proteinQualityDays = 0;
    let totalProteinEnergyRatio = 0;
    let totalCarbsEnergyRatio = 0;
    let totalFatEnergyRatio = 0;
    let macroRatioDays = 0;
    let totalMilkCalories = 0;
    let totalFoodCalories = 0;
    let totalTreatmentCalories = 0;
    let recordDays = 0;
    
    // 按日期顺序处理数据
    dateList.forEach((date, idx) => {
      // 使用相同的格式化方法
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      
      const record = dateMap.get(dateKey);
      const dayTreatmentRecords = treatmentMap.get(dateKey) || [];
      const hasTreatmentNutrition = dayTreatmentRecords.some(hasTreatmentNutritionContent);
      
      dates.push(this.formatDateDisplay(date));
      dateKeys.push(dateKey);
      
      // 打印所有20号之后的日期匹配情况
      if (idx < 5 || !record || day >= 20) {
        console.log(`[${idx}] 处理日期 ${dateKey}: ${record ? '✅有数据' : '❌无数据'}, feedings=${record?.feedings?.length || 0}`);
      }
      
      const hasFeedings = record && record.feedings && record.feedings.length > 0;
      const hasIntakes = record && Array.isArray(record.intakes) && record.intakes.length > 0;
      const hasDailySummaryNutrition = record && hasDailySummaryNutritionContent(record.dailySummaryV2);

      if ((record && (hasFeedings || hasIntakes || hasDailySummaryNutrition)) || hasTreatmentNutrition) {
        const analysisRecord = record || {};
        // 计算当天的总量
        let dayNaturalMilk = 0;
        let daySpecialMilk = 0;
        
        if (hasFeedings) {
          record.feedings.forEach(feeding => {
            const volumes = getFeedingVolumes(feeding);
            dayNaturalMilk += volumes.naturalMilkVolume;
            daySpecialMilk += volumes.specialMilkVolume;
          });
        }

        if (hasIntakes) {
          const milkIntakeVolumes = getMilkIntakeVolumes(record.intakes);
          dayNaturalMilk += milkIntakeVolumes.naturalMilkVolume;
          daySpecialMilk += milkIntakeVolumes.specialMilkVolume;
        }
        
        const dayTotalMilk = dayNaturalMilk + daySpecialMilk;
        const summary = this.calculateDailySummary(analysisRecord, dayTreatmentRecords);
        const dayCalories = summary.calories || 0;
        const dayTreatmentCalories = summary.treatmentCalories || 0;
        const dayQualityProtein = summary.naturalProtein || 0;
        const dayPremiumProteinRatio = dayQualityProtein > 0
          ? roundNumber((summary.premiumProtein / dayQualityProtein) * 100, 1)
          : 0;
        const dayRegularProteinRatio = dayQualityProtein > 0
          ? roundNumber((summary.regularProtein / dayQualityProtein) * 100, 1)
          : 0;
        const macroRatios = calculateMacroEnergyRatios({
          protein: (summary.naturalProtein || 0) + (summary.specialProtein || 0) + (summary.treatmentProtein || 0),
          carbs: summary.carbs || 0,
          fat: summary.fat || 0
        });
        
        // 获取当天体重：当天记录优先，其次沿用历史体重，今天才使用宝宝信息兜底
        const historicalSnapshot = basicInfoSnapshots[dateKey] || {};
        const isToday = dateKey === this.formatDateKey(new Date());
        let weight = 0;
        if (analysisRecord.basicInfo && analysisRecord.basicInfo.weight) {
          weight = parseFloat(analysisRecord.basicInfo.weight);
        } else if (analysisRecord.weight) {
          weight = parseFloat(analysisRecord.weight);
        } else if (hasBasicInfoValue(historicalSnapshot.weight)) {
          weight = parseFloat(historicalSnapshot.weight);
        } else if (isToday && this.data.babyInfo && hasBasicInfoValue(this.data.babyInfo.weight)) {
          weight = parseFloat(this.data.babyInfo.weight);
        }
        
        // 计算蛋白质系数 (g/kg)
        let dayNaturalProteinCoef = 0;
        let daySpecialProteinCoef = 0;
        let dayCalorieCoef = 0;
        
        if (weight > 0) {
          dayNaturalProteinCoef = (summary.naturalProtein / weight).toFixed(2);
          daySpecialProteinCoef = (summary.specialProtein / weight).toFixed(2);
          dayCalorieCoef = roundNumber(dayCalories / weight, 1);

          totalNaturalProtein += parseFloat(dayNaturalProteinCoef);
          totalSpecialProtein += parseFloat(daySpecialProteinCoef);
          totalCalorieCoefficient += dayCalorieCoef;
          coefficientDays++;
        }

        if (dayQualityProtein > 0) {
          totalPremiumProteinRatio += dayPremiumProteinRatio;
          totalRegularProteinRatio += dayRegularProteinRatio;
          proteinQualityDays++;
        }

        if (macroRatios.protein > 0 || macroRatios.carbs > 0 || macroRatios.fat > 0) {
          totalProteinEnergyRatio += macroRatios.protein;
          totalCarbsEnergyRatio += macroRatios.carbs;
          totalFatEnergyRatio += macroRatios.fat;
          macroRatioDays++;
        }
        
        const dayTotalProteinCoef = parseFloat(dayNaturalProteinCoef) + parseFloat(daySpecialProteinCoef);
        
        milkVolumes.push(Math.round(dayTotalMilk));
        naturalMilk.push(Math.round(dayNaturalMilk));
        specialMilk.push(Math.round(daySpecialMilk));
        naturalProteinCoefficient.push(parseFloat(dayNaturalProteinCoef));
        specialProteinCoefficient.push(parseFloat(daySpecialProteinCoef));
        totalProteinCoefficient.push(parseFloat(dayTotalProteinCoef.toFixed(2)));
        premiumProteinRatio.push(dayPremiumProteinRatio);
        regularProteinRatio.push(dayRegularProteinRatio);
        totalCalories.push(dayCalories);
        calorieCoefficient.push(dayCalorieCoef);
        
        // 累计统计
        totalMilk += dayTotalMilk;
        totalNatural += dayNaturalMilk;
        totalSpecial += daySpecialMilk;
        totalCal += dayCalories;
        totalMilkCalories += summary.milkCalories || 0;
        totalFoodCalories += summary.foodCalories || 0;
        totalTreatmentCalories += dayTreatmentCalories;
        recordDays++;
      } else {
        // 没有数据的日期
        milkVolumes.push(0);
        naturalMilk.push(0);
        specialMilk.push(0);
        naturalProteinCoefficient.push(0);
        specialProteinCoefficient.push(0);
        totalProteinCoefficient.push(0);
        premiumProteinRatio.push(0);
        regularProteinRatio.push(0);
        totalCalories.push(0);
        calorieCoefficient.push(0);
      }
    });
    
    // 计算平均值
    const avgMilkVolume = recordDays > 0 ? Math.round(totalMilk / recordDays) : 0;
    const avgNaturalMilk = recordDays > 0 ? Math.round(totalNatural / recordDays) : 0;
    const avgSpecialMilk = recordDays > 0 ? Math.round(totalSpecial / recordDays) : 0;
    const avgCalories = recordDays > 0 ? Math.round(totalCal / recordDays) : 0;
    const avgNaturalProteinCoef = coefficientDays > 0 ? (totalNaturalProtein / coefficientDays).toFixed(2) : '0.00';
    const avgSpecialProteinCoef = coefficientDays > 0 ? (totalSpecialProtein / coefficientDays).toFixed(2) : '0.00';
    const avgTotalProteinCoefficient = coefficientDays > 0
      ? roundNumber((Number(avgNaturalProteinCoef) || 0) + (Number(avgSpecialProteinCoef) || 0), 2)
      : 0;
    const avgCalorieCoefficient = coefficientDays > 0
      ? roundNumber(totalCalorieCoefficient / coefficientDays, 1)
      : 0;
    const avgPremiumProteinRatio = proteinQualityDays > 0
      ? roundNumber(totalPremiumProteinRatio / proteinQualityDays, 1)
      : 0;
    const avgRegularProteinRatio = proteinQualityDays > 0
      ? roundNumber(totalRegularProteinRatio / proteinQualityDays, 1)
      : 0;
    const avgProteinEnergyRatio = macroRatioDays > 0
      ? roundNumber(totalProteinEnergyRatio / macroRatioDays, 1)
      : 0;
    const avgCarbsEnergyRatio = macroRatioDays > 0
      ? roundNumber(totalCarbsEnergyRatio / macroRatioDays, 1)
      : 0;
    const avgFatEnergyRatio = macroRatioDays > 0
      ? roundNumber(totalFatEnergyRatio / macroRatioDays, 1)
      : 0;
    const avgMilkCalories = recordDays > 0 ? Math.round(totalMilkCalories / recordDays) : 0;
    const avgFoodCalories = recordDays > 0 ? Math.round(totalFoodCalories / recordDays) : 0;
    const avgTreatmentCalories = recordDays > 0 ? Math.round(totalTreatmentCalories / recordDays) : 0;
    const milkCalorieRatio = totalCal > 0 ? roundNumber((totalMilkCalories / totalCal) * 100, 1) : 0;
    const foodCalorieRatio = totalCal > 0 ? roundNumber((totalFoodCalories / totalCal) * 100, 1) : 0;
    const treatmentCalorieRatio = totalCal > 0 ? roundNumber((totalTreatmentCalories / totalCal) * 100, 1) : 0;
    const hasCalorieSourceBreakdown = totalCal > 0;
    const totalDaysInRange = dateList.length || 0;
    const todayKey = this.formatDateKey(new Date());
    const defaultCrosshairIndex = dateKeys.indexOf(todayKey);
    
    // 计算平均蛋白质系数比例
    let avgProteinRatio = `${avgNaturalProteinCoef}:${avgSpecialProteinCoef}`;
    
    console.log('========== 数据处理完成 ==========');
    console.log('有效记录天数:', recordDays);
    console.log('平均奶量:', avgMilkVolume, 'ml');
    console.log('平均蛋白比例:', avgProteinRatio);
    console.log('图表数据点数:', dates.length);
    
    this.setData({
      chartData: {
        dates,
        dateKeys,
        defaultCrosshairIndex,
        milkVolumes,
        naturalMilk,
        specialMilk,
        naturalProteinCoefficient,
        specialProteinCoefficient,
        totalProteinCoefficient,
        premiumProteinRatio,
        regularProteinRatio,
        totalCalories,
        calorieCoefficient
      },
      statistics: {
        avgMilkVolume,
        avgNaturalMilk,
        avgSpecialMilk,
        avgProteinRatio,
        avgCalories,
        avgCalorieCoefficient,
        avgTotalProteinCoefficient,
        avgPremiumProteinRatio,
        avgRegularProteinRatio,
        avgProteinEnergyRatio,
        avgCarbsEnergyRatio,
        avgFatEnergyRatio,
        avgMilkCalories,
        avgFoodCalories,
        avgTreatmentCalories,
        milkCalorieRatio,
        foodCalorieRatio,
        treatmentCalorieRatio,
        hasCalorieSourceBreakdown,
        totalDays: recordDays,
        rangeDays: totalDaysInRange
      },
      referenceRanges: buildReferenceRanges(this.data.nutritionSettings, this.data.babyInfo, endDate)
    });
  },

  // 生成日期列表
  generateDateList(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return dates;
  },

  // 格式化日期作为键
  formatDateKey(date) {
    return formatDateKeyValue(date);
  },

  formatFullDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  },

  // 格式化日期显示
  formatDateDisplay(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  },

  calculateDailySummary(record, treatmentRecords = []) {
    if (record.hasRawNutritionDetails !== true) {
      const dailySummary = buildAnalysisSummaryFromDailySummary(record.dailySummaryV2);
      if (dailySummary) {
        return dailySummary;
      }
    }

    const nutritionSettings = this.data.nutritionSettings || {};
    const intakes = Array.isArray(record.intakes) ? record.intakes : [];

    const summary = {
      calories: 0,
      naturalProtein: 0,
      specialProtein: 0,
      premiumProtein: 0,
      regularProtein: 0,
      carbs: 0,
      fat: 0,
      milkCalories: 0,
      foodCalories: 0,
      treatmentCalories: 0,
      treatmentProtein: 0
    };

    intakes.forEach(intake => {
      const nutrition = intake.nutrition || {};
      const calories = Number(nutrition.calories) || 0;
      const protein = Number(nutrition.protein) || 0;
      const naturalProtein = typeof intake.naturalProtein === 'number'
        ? intake.naturalProtein
        : (intake.proteinSource === 'special' ? 0 : protein);
      const specialProtein = typeof intake.specialProtein === 'number'
        ? intake.specialProtein
        : (intake.proteinSource === 'special' ? protein : 0);

      summary.calories += calories;
      if (intake.type === 'milk' || intake.milkType) {
        summary.milkCalories += calories;
      } else {
        summary.foodCalories += calories;
      }
      summary.naturalProtein += Number(naturalProtein) || 0;
      summary.specialProtein += Number(specialProtein) || 0;
      summary.carbs += Number(nutrition.carbs) || 0;
      summary.fat += Number(nutrition.fat) || 0;
      if (Number(naturalProtein) > 0) {
        if (intake.type === 'milk' || intake.milkType || intake.proteinQuality === 'premium') {
          summary.premiumProtein += Number(naturalProtein) || 0;
        } else {
          summary.regularProtein += Number(naturalProtein) || 0;
        }
      }
    });

    let totalNaturalVolumeBreast = 0;
    let totalNaturalVolumeFormula = 0;
    let totalSpecialVolume = 0;

    (record.feedings || []).forEach(feeding => {
      // v2 喂奶记录自带营养快照，直接累加，不用旧配奶参数重算（避免档案缺失/变更导致营养错算）
      if (feeding && feeding.isV2FeedingRecord) {
        const nutrition = feeding.nutritionDisplay || {};
        const naturalProtein = Number(nutrition.naturalProtein) || 0;
        const specialProtein = Number(nutrition.specialProtein) || 0;
        const calories = Number(nutrition.calories) || 0;
        summary.calories += calories;
        summary.milkCalories += calories;
        summary.naturalProtein += naturalProtein;
        summary.premiumProtein += naturalProtein;
        summary.specialProtein += specialProtein;
        summary.carbs += Number(nutrition.carbs) || 0;
        summary.fat += Number(nutrition.fat) || 0;
        return;
      }

      const { naturalMilkVolume: naturalVolume, specialMilkVolume: specialVolume } = getFeedingVolumes(feeding);
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
      const calories = nutrition.naturalCalories || 0;
      summary.calories += calories;
      summary.milkCalories += calories;
      summary.naturalProtein += nutrition.naturalProtein || 0;
      summary.premiumProtein += nutrition.naturalProtein || 0;
      summary.carbs += nutrition.carbs || 0;
      summary.fat += nutrition.fat || 0;
    }

    if (totalNaturalVolumeFormula > 0) {
      const nutrition = calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeFormula,
        naturalMilkType: 'formula',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }, nutritionSettings);
      const calories = nutrition.naturalCalories || 0;
      summary.calories += calories;
      summary.milkCalories += calories;
      summary.naturalProtein += nutrition.naturalProtein || 0;
      summary.premiumProtein += nutrition.naturalProtein || 0;
      summary.carbs += nutrition.carbs || 0;
      summary.fat += nutrition.fat || 0;
    }

    if (totalSpecialVolume > 0) {
      const specialPowder = calculateSpecialMilkPowder(totalSpecialVolume, nutritionSettings);
      const nutrition = calculateMilkNutrition({
        naturalMilkVolume: 0,
        naturalMilkType: 'breast',
        specialMilkVolume: totalSpecialVolume,
        specialMilkPowder: specialPowder
      }, nutritionSettings);
      const calories = nutrition.specialCalories || 0;
      summary.calories += calories;
      summary.milkCalories += calories;
      summary.specialProtein += nutrition.specialProtein || 0;
      summary.carbs += nutrition.carbs || 0;
      summary.fat += nutrition.fat || 0;
    }

    const treatmentSummary = summarizeTreatmentRecords(treatmentRecords);
    if (treatmentSummary.totalCalories > 0 || treatmentSummary.carbs > 0 || treatmentSummary.protein > 0 || treatmentSummary.fat > 0) {
      summary.calories += treatmentSummary.totalCalories || 0;
      summary.carbs += treatmentSummary.carbs || 0;
      summary.fat += treatmentSummary.fat || 0;
      summary.treatmentCalories = treatmentSummary.totalCalories || 0;
      summary.treatmentProtein = treatmentSummary.protein || 0;
    }

    summary.calories = roundCalories(summary.calories);
    summary.naturalProtein = roundNumber(summary.naturalProtein, 2);
    summary.specialProtein = roundNumber(summary.specialProtein, 2);
    summary.premiumProtein = roundNumber(summary.premiumProtein, 2);
    summary.regularProtein = roundNumber(summary.regularProtein, 2);
    summary.carbs = roundNumber(summary.carbs, 2);
    summary.fat = roundNumber(summary.fat, 2);
    summary.milkCalories = roundCalories(summary.milkCalories);
    summary.foodCalories = roundCalories(summary.foodCalories);
    summary.treatmentCalories = roundCalories(summary.treatmentCalories);
    summary.treatmentProtein = roundNumber(summary.treatmentProtein, 2);

    return summary;
  },

  // 初始化图表
  initCharts() {
    // 延迟一点，确保DOM已渲染
    setTimeout(() => {
      this.setData({
        'ec.lazyLoad': false
      });
      this.refreshInitializedCharts();
    }, 300);
  },

  refreshInitializedCharts() {
    if (typeof this.selectComponent !== 'function') {
      return;
    }

    [
      { selector: '#milk-chart', draw: this.initMilkChart },
      { selector: '#protein-chart', draw: this.initProteinChart },
      { selector: '#calorie-chart', draw: this.initCalorieChart }
    ].forEach(({ selector, draw }) => {
      const component = this.selectComponent(selector);
      if (!component || component.data?.isInit !== true || typeof component.drawChart !== 'function') {
        return;
      }
      draw.call(this, {
        detail: {
          component
        }
      });
    });
  },

  onRangePresetTap(e) {
    const preset = e.currentTarget.dataset.preset;
    if (!RANGE_PRESETS.some(item => item.key === preset)) {
      return;
    }
    if (!this.data.customRangeActive && this.data.rangePreset === preset) {
      return;
    }
    this.setData({
      rangePreset: preset,
      customRangeActive: false,
      customRangeStartKey: '',
      customRangeEndKey: ''
    });
    this.loadAnalysisData();
  },

  // 切换时间维度
  onTimeDimensionChange(e) {
    const dimension = e.currentTarget.dataset.dimension;
    
    if (dimension === this.data.timeDimension) {
      return;
    }
    
    this.setData({
      timeDimension: dimension,
      selectedWeek: 0,
      selectedMonth: 0,
      customRangeActive: false
    });
    
    this.loadAnalysisData();
  },

  // 上一周/月
  onPrevious() {
    const { timeDimension, selectedWeek, selectedMonth } = this.data;
    
    if (timeDimension === 'week') {
      this.setData({ selectedWeek: selectedWeek - 1 });
    } else if (this.data.customRangeActive) {
      const anchorDate = parseDateKey(this.data.customRangeStartKey) || new Date();
      this.setData({
        selectedMonth: this.getMonthOffsetFromDate(anchorDate) - 1,
        customRangeActive: false
      });
    } else {
      this.setData({ selectedMonth: selectedMonth - 1 });
    }
    
    this.loadAnalysisData();
  },

  // 下一周/月
  onNext() {
    const { timeDimension, selectedWeek, selectedMonth } = this.data;
    
    // 不能查看未来数据
    if ((timeDimension === 'week' && selectedWeek >= 0) ||
        (timeDimension === 'month' && !this.data.customRangeActive && selectedMonth >= 0)) {
      wx.showToast({
        title: '已是最新数据',
        icon: 'none'
      });
      return;
    }
    
    if (timeDimension === 'week') {
      this.setData({ selectedWeek: selectedWeek + 1 });
    } else if (this.data.customRangeActive) {
      const anchorDate = parseDateKey(this.data.customRangeEndKey) || new Date();
      const nextMonthOffset = this.getMonthOffsetFromDate(anchorDate) + 1;
      if (nextMonthOffset > 0) {
        wx.showToast({
          title: '已是最新数据',
          icon: 'none'
        });
        return;
      }
      this.setData({
        selectedMonth: nextMonthOffset,
        customRangeActive: false
      });
    } else {
      this.setData({ selectedMonth: selectedMonth + 1 });
    }
    
    this.loadAnalysisData();
  },

  // 打开日期选择器（仅月视图）
  onDatePicker() {
    const now = new Date();
    const { customRangeActive } = this.data;
    const { startDate, endDate } = this.calculateDateRange();
    
    this.setData({
      showDatePicker: true,
      datePickerMode: 'custom',
      pickerYear: now.getFullYear(),
      pickerMonth: now.getMonth() + 1,
      pickerRangeStartKey: customRangeActive ? this.data.customRangeStartKey : this.formatDateKey(startDate),
      pickerRangeEndKey: customRangeActive ? this.data.customRangeEndKey : this.formatDateKey(endDate),
      todayDateKey: this.formatDateKey(now)
    });
  },

  // 关闭日期选择器
  onCloseDatePicker() {
    this.setData({
      showDatePicker: false
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止点击弹窗内容时关闭弹窗
  },

  // 年份切换
  onYearChange(e) {
    const offset = parseInt(e.currentTarget.dataset.offset);
    const newYear = this.data.pickerYear + offset;
    
    // 限制年份范围（宝宝出生年份到当前年份）
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 5; // 假设最多查看5年前的数据
    
    if (newYear >= minYear && newYear <= currentYear) {
      this.setData({
        pickerYear: newYear
      });
    }
  },

  // 月份选择
  onMonthSelect(e) {
    const month = parseInt(e.currentTarget.dataset.month);
    this.setData({
      pickerMonth: month
    });
  },

  onDatePickerModeChange(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode !== 'month' && mode !== 'custom') {
      return;
    }
    this.setData({
      datePickerMode: mode
    });
  },

  onRangeStartChange(e) {
    this.setData({
      pickerRangeStartKey: e.detail.value
    });
  },

  onRangeEndChange(e) {
    this.setData({
      pickerRangeEndKey: e.detail.value
    });
  },

  getMonthOffsetFromDate(date) {
    const now = new Date();
    return (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
  },

  // 确认日期选择
  onDatePickerConfirm() {
    this.confirmCustomRange();
  },

  confirmCustomRange() {
    const { pickerRangeStartKey, pickerRangeEndKey } = this.data;
    const startDate = parseDateKey(pickerRangeStartKey);
    const endDate = parseDateKey(pickerRangeEndKey);
    if (!startDate || !endDate) {
      wx.showToast({
        title: '请选择完整日期',
        icon: 'none'
      });
      return;
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    if (startDate > endDate) {
      wx.showToast({
        title: '开始日期不能晚于结束日期',
        icon: 'none'
      });
      return;
    }

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    if (endDate > todayEnd) {
      wx.showToast({
        title: '不能选择未来日期',
        icon: 'none'
      });
      return;
    }

    if (getInclusiveDayCount(startDate, endDate) > MAX_CUSTOM_RANGE_DAYS) {
      wx.showToast({
        title: '最多选择31天',
        icon: 'none'
      });
      return;
    }

    this.setData({
      customRangeActive: true,
      rangePreset: 'custom',
      customRangeStartKey: this.formatDateKey(startDate),
      customRangeEndKey: this.formatDateKey(endDate),
      showDatePicker: false
    });

    this.loadAnalysisData();
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadAnalysisData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  getChartXAxisLabelInterval() {
    const rangeDays = Number(this.data.statistics?.rangeDays) || 0;
    return rangeDays > 14 ? 5 : 1;
  },

  // 初始化奶量统计图表
  initMilkChart(e) {
    const component = e.detail.component;
    const { dates, naturalMilk, specialMilk, milkVolumes, defaultCrosshairIndex } = this.data.chartData;
    
    if (!dates || dates.length === 0) {
      console.log('奶量图表：暂无数据');
      return;
    }
    
    setTimeout(() => {
      component.drawChart({
        xData: dates,
        series: [
          { name: '总量', data: milkVolumes, axisLabel: '左轴 ml', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 },
          { name: '天然', data: naturalMilk, axisLabel: '左轴 ml', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 },
          { name: '特奶', data: specialMilk, axisLabel: '左轴 ml', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 }
        ],
        options: {
          colors: ['#FFB800', '#4CAF50', '#2196F3'],
          showGrid: true,
          showLegend: true,
          showCrosshair: true,
          keepCrosshairVisible: true,
          defaultCrosshairTooltipVisible: false,
          defaultCrosshairIndex,
          padding: { top: 24, right: 20, bottom: 42, left: 38 },
          xAxisLabelSpace: 14,
          xAxisLabelInterval: this.getChartXAxisLabelInterval(),
          legendTopGap: 4,
          legendFont: '9px sans-serif',
          legendItemGap: 10
        }
      });
    }, 200);
  },

  // 初始化蛋白质系数比例图表（曲线图）
  initProteinChart(e) {
    const component = e.detail.component;
    const {
      dates,
      naturalProteinCoefficient,
      specialProteinCoefficient,
      totalProteinCoefficient,
      premiumProteinRatio,
      regularProteinRatio,
      defaultCrosshairIndex
    } = this.data.chartData;
    
    if (!dates || dates.length === 0) {
      console.log('蛋白质系数图表：暂无数据');
      return;
    }
    
    // 计算合理的Y轴范围
    const validData = [
      ...naturalProteinCoefficient.filter(v => v > 0),
      ...specialProteinCoefficient.filter(v => v > 0),
      ...totalProteinCoefficient.filter(v => v > 0)
    ];
    
    let yMax = 2.5; // 默认最大值
    if (validData.length > 0) {
      const maxValue = Math.max(...validData);
      // 向上取整到0.5的倍数
      yMax = Math.ceil(maxValue / 0.5) * 0.5;
      // 确保最小为2.0，最大不超过3.0
      yMax = Math.max(2.0, Math.min(yMax, 3.0));
    }
    
    console.log('蛋白质系数图表Y轴范围: 0 -', yMax);
    
    setTimeout(() => {
      component.drawChart({
        xData: dates,
        series: [
          { name: '总蛋白', data: totalProteinCoefficient, axisLabel: '左轴 g/kg', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 },
          { name: '天然', data: naturalProteinCoefficient, axisLabel: '左轴 g/kg', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 },
          { name: '特殊', data: specialProteinCoefficient, axisLabel: '左轴 g/kg', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 },
          { name: '优质占比', data: premiumProteinRatio, yAxisIndex: 1, axisLabel: '右轴 %', lineDash: [6, 4], showDots: true, dotShape: 'diamond', dotRadius: 2.5 },
          { name: '普通占比', data: regularProteinRatio, yAxisIndex: 1, axisLabel: '右轴 %', lineDash: [6, 4], showDots: true, dotShape: 'diamond', dotRadius: 2.5 }
        ],
        options: {
          colors: ['#FF9800', '#2E7D32', '#2196F3', '#7E57C2', '#795548'],
          showGrid: true,
          showLegend: true,
          showCrosshair: true,
          keepCrosshairVisible: true,
          defaultCrosshairTooltipVisible: false,
          defaultCrosshairIndex,
          yAxisLabel: 'g/kg',
          yAxisRightLabel: '%',
          padding: { top: 24, right: 30, bottom: 48, left: 36 },
          xAxisLabelSpace: 14,
          xAxisLabelInterval: this.getChartXAxisLabelInterval(),
          legendTopGap: 4,
          legendFont: '9px sans-serif',
          legendItemGap: 8,
          yAxisMax: yMax, // 动态调整最大值
          yAxisMin: 0, // 最小值从0开始
          yAxisRightMin: 0,
          yAxisRightMax: 100
        }
      });
    }, 200);
  },

  // 初始化热量图表
  initCalorieChart(e) {
    const component = e.detail.component;
    const { dates, totalCalories, calorieCoefficient, defaultCrosshairIndex } = this.data.chartData;
    
    if (!dates || dates.length === 0) {
      console.log('热量图表：暂无数据');
      return;
    }
    
    const validCoefficients = (calorieCoefficient || []).filter(v => v > 0);
    const yRightMax = validCoefficients.length > 0
      ? Math.ceil(Math.max(...validCoefficients) / 10) * 10
      : 100;

    setTimeout(() => {
      component.drawChart({
        xData: dates,
        series: [
          { name: '总热量', data: totalCalories, axisLabel: '左轴 kcal', lineStyle: 'solid', showDots: true, dotShape: 'circle', dotRadius: 2 },
          { name: '热量系数', data: calorieCoefficient, yAxisIndex: 1, axisLabel: '右轴 kcal/kg', lineDash: [6, 4], showDots: true, dotShape: 'diamond', dotRadius: 2.5 }
        ],
        options: {
          colors: ['#FF5722', '#4CAF50'],
          showGrid: true,
          showLegend: true,
          showCrosshair: true,
          keepCrosshairVisible: true,
          defaultCrosshairTooltipVisible: false,
          defaultCrosshairIndex,
          yAxisLabel: 'kcal',
          yAxisRightLabel: 'kcal/kg',
          padding: { top: 24, right: 30, bottom: 42, left: 38 },
          xAxisLabelSpace: 14,
          xAxisLabelInterval: this.getChartXAxisLabelInterval(),
          legendTopGap: 4,
          legendFont: '9px sans-serif',
          legendItemGap: 10,
          yAxisRightMin: 0,
          yAxisRightMax: yRightMax
        }
      });
    }, 200);
  }
});
