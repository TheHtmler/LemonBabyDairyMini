function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
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

function createEmptyBasicInfo() {
  return {
    weight: '',
    height: '',
    naturalProteinCoefficient: '',
    specialProteinCoefficient: '',
    calorieCoefficient: ''
  };
}

function createEmptyMilkSummary() {
  return {
    totalVolume: 0,
    totalPowderWeight: 0,
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    carbs: 0,
    fat: 0,
    zeroProteinCalories: 0
  };
}

function createEmptyFoodSummary() {
  return {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0
  };
}

function createEmptyTreatmentSummary() {
  return {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  };
}

function createEmptyMacroSummary() {
  return {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    carbs: 0,
    fat: 0
  };
}

function createEmptyDailySummaryV2(babyUid = '', date = '') {
  return {
    schemaVersion: 1,
    recordType: 'daily_summary',
    source: 'summary_builder_v2',
    status: 'active',
    babyUid,
    date,
    basicInfo: createEmptyBasicInfo(),
    milk: createEmptyMilkSummary(),
    food: createEmptyFoodSummary(),
    treatment: createEmptyTreatmentSummary(),
    medication: {
      totalRecords: 0,
      takenMedicationIds: []
    },
    bowel: {
      totalRecords: 0,
      latestType: ''
    },
    macroSummary: createEmptyMacroSummary(),
    recordCounts: {
      milk: 0,
      food: 0,
      medication: 0,
      treatment: 0,
      bowel: 0
    },
    sourceUpdatedAt: {
      feeding: null,
      food: null,
      medication: null,
      treatment: null,
      bowel: null,
      growth: null
    },
    isDirty: false,
    rebuiltAt: null,
    createdAt: null,
    updatedAt: null
  };
}

function roundMilkSummary(summary = {}) {
  return {
    totalVolume: roundValue(summary.totalVolume),
    totalPowderWeight: roundValue(summary.totalPowderWeight),
    calories: roundValue(summary.calories),
    protein: roundValue(summary.protein),
    naturalProtein: roundValue(summary.naturalProtein),
    specialProtein: roundValue(summary.specialProtein),
    carbs: roundValue(summary.carbs),
    fat: roundValue(summary.fat),
    zeroProteinCalories: roundValue(summary.zeroProteinCalories)
  };
}

function roundFoodSummary(summary = {}) {
  return {
    calories: roundValue(summary.calories),
    protein: roundValue(summary.protein),
    naturalProtein: roundValue(summary.naturalProtein),
    specialProtein: roundValue(summary.specialProtein),
    fat: roundValue(summary.fat),
    carbs: roundValue(summary.carbs),
    fiber: roundValue(summary.fiber)
  };
}

function roundTreatmentSummary(summary = {}) {
  return {
    calories: roundValue(summary.calories),
    protein: roundValue(summary.protein),
    carbs: roundValue(summary.carbs),
    fat: roundValue(summary.fat)
  };
}

function roundMacroSummary(summary = {}) {
  return {
    calories: roundValue(summary.calories),
    protein: roundValue(summary.protein),
    naturalProtein: roundValue(summary.naturalProtein),
    specialProtein: roundValue(summary.specialProtein),
    carbs: roundValue(summary.carbs),
    fat: roundValue(summary.fat)
  };
}

function mergeMilkNutrition(records = []) {
  const summary = createEmptyMilkSummary();
  (Array.isArray(records) ? records : []).forEach((record = {}) => {
    const nutrition = record.nutritionSummary || {};
    summary.totalVolume += toNumber(nutrition.totalVolume);
    summary.totalPowderWeight += toNumber(nutrition.totalPowderWeight);
    summary.calories += toNumber(nutrition.calories);
    summary.protein += toNumber(nutrition.protein);
    summary.naturalProtein += toNumber(nutrition.naturalProtein);
    summary.specialProtein += toNumber(nutrition.specialProtein);
    summary.carbs += toNumber(nutrition.carbs);
    summary.fat += toNumber(nutrition.fat);
    summary.zeroProteinCalories += toNumber(nutrition.zeroProteinCalories);
  });
  return roundMilkSummary(summary);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 兼容两种食物结构：
// - v2 food_intake_records：naturalProtein/specialProtein 在 nutrition 里
// - 旧 feeding_records.intakes：naturalProtein/specialProtein 在顶层，nutrition 里没有
// 都缺失时按 proteinSource 兜底（与页面/报告/分析口径一致），否则天然/特殊蛋白拆分会被算成 0。
function resolveFoodProteinSplit(record = {}) {
  const nutrition = record.nutrition || {};
  const protein = toNumber(nutrition.protein);
  const proteinSource = record.proteinSource
    || (record.milkType === 'special_formula' ? 'special' : '');

  const natural = isFiniteNumber(nutrition.naturalProtein)
    ? nutrition.naturalProtein
    : (isFiniteNumber(record.naturalProtein)
      ? record.naturalProtein
      : (proteinSource === 'special' ? 0 : protein));
  const special = isFiniteNumber(nutrition.specialProtein)
    ? nutrition.specialProtein
    : (isFiniteNumber(record.specialProtein)
      ? record.specialProtein
      : (proteinSource === 'special' ? protein : 0));

  return { natural, special };
}

function mergeFoodNutrition(records = []) {
  const summary = createEmptyFoodSummary();
  (Array.isArray(records) ? records : []).forEach((record = {}) => {
    const nutrition = record.nutrition || {};
    const { natural, special } = resolveFoodProteinSplit(record);
    summary.calories += toNumber(nutrition.calories);
    summary.protein += toNumber(nutrition.protein);
    summary.naturalProtein += toNumber(natural);
    summary.specialProtein += toNumber(special);
    summary.fat += toNumber(nutrition.fat);
    summary.carbs += toNumber(nutrition.carbs);
    summary.fiber += toNumber(nutrition.fiber);
  });
  return roundFoodSummary(summary);
}

function shouldCountTreatmentItem(item = {}) {
  if (typeof item.countInNutrition === 'boolean') {
    return item.countInNutrition;
  }
  return item.category === 'dextrose_10' || item.category === 'dextrose_5';
}

function addTreatmentGroups(summary, groups = []) {
  (Array.isArray(groups) ? groups : []).forEach((group = {}) => {
    (Array.isArray(group.items) ? group.items : []).forEach((item = {}) => {
      if (!shouldCountTreatmentItem(item)) {
        return;
      }
      summary.calories += toNumber(item.calories);
      summary.protein += toNumber(item.proteinG);
      summary.carbs += toNumber(item.carbsG);
      summary.fat += toNumber(item.fatG);
    });
  });
}

function mergeTreatmentNutrition(records = []) {
  const summary = createEmptyTreatmentSummary();
  (Array.isArray(records) ? records : []).forEach((record = {}) => {
    const recordSummary = record.summary || {};
    const hasSummary = recordSummary.totalCalories !== undefined
      || recordSummary.calories !== undefined
      || recordSummary.protein !== undefined
      || recordSummary.carbs !== undefined
      || recordSummary.fat !== undefined;

    if (hasSummary) {
      summary.calories += toNumber(recordSummary.totalCalories ?? recordSummary.calories);
      summary.protein += toNumber(recordSummary.protein);
      summary.carbs += toNumber(recordSummary.carbs);
      summary.fat += toNumber(recordSummary.fat);
      return;
    }

    if (Array.isArray(record.groups)) {
      addTreatmentGroups(summary, record.groups);
      return;
    }

    if (Array.isArray(record.items)) {
      addTreatmentGroups(summary, [{ items: record.items }]);
    }
  });
  return roundTreatmentSummary(summary);
}

function getTimestampValue(value) {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getLatestSourceUpdatedAt(records = []) {
  return (Array.isArray(records) ? records : [])
    .map((record = {}) => record.updatedAt || record.createdAt || record.recordTime || record.recordedAt)
    .filter(Boolean)
    .sort((left, right) => getTimestampValue(right) - getTimestampValue(left))[0] || null;
}

function hasBasicInfoValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function normalizeBasicInfoFields(source = {}) {
  return {
    weight: source.weight || '',
    height: source.height || source.length || '',
    naturalProteinCoefficient: source.naturalProteinCoefficient || '',
    specialProteinCoefficient: source.specialProteinCoefficient || '',
    calorieCoefficient: source.calorieCoefficient || ''
  };
}

// 用 fallback 仅补齐 primary 中缺失的字段，已有值不被覆盖。
function fillMissingBasicInfo(primary = {}, fallback = {}) {
  const merged = { ...primary };
  ['weight', 'height', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient']
    .forEach((key) => {
      if (!hasBasicInfoValue(merged[key]) && hasBasicInfoValue(fallback[key])) {
        merged[key] = fallback[key];
      }
    });
  return merged;
}

function buildBasicInfo(growthRecords = [], milkRecords = []) {
  const milkSnapshot = (Array.isArray(milkRecords) ? milkRecords : [])
    .find((record = {}) => record.basicInfoSnapshot)?.basicInfoSnapshot;

  const activeGrowthRecord = (Array.isArray(growthRecords) ? growthRecords : [])
    .find((record = {}) => (record.status || 'active') === 'active');
  if (activeGrowthRecord) {
    const growthInfo = normalizeBasicInfoFields(activeGrowthRecord);
    // 成长记录历史上只存身高体重、不存系数；缺系数时回退到喂奶快照，
    // 避免“身高体重有、蛋白系数没有”，也能恢复旧版写入丢失系数的成长记录。
    return milkSnapshot ? fillMissingBasicInfo(growthInfo, milkSnapshot) : growthInfo;
  }

  if (milkSnapshot) {
    return normalizeBasicInfoFields(milkSnapshot);
  }

  return createEmptyBasicInfo();
}

function buildMedicationSummary(records = []) {
  const validRecords = Array.isArray(records) ? records.filter(Boolean) : [];
  return {
    totalRecords: validRecords.length,
    takenMedicationIds: validRecords
      .map((record = {}) => record.medicationId || record._id || record.id || '')
      .filter(Boolean)
  };
}

function buildBowelSummary(records = []) {
  const validRecords = Array.isArray(records) ? records.filter(Boolean) : [];
  const latest = [...validRecords].sort((left = {}, right = {}) => (
    getTimestampValue(right.recordTime || right.createdAt || right.updatedAt)
      - getTimestampValue(left.recordTime || left.createdAt || left.updatedAt)
  ))[0];
  return {
    totalRecords: validRecords.length,
    latestType: latest?.stoolType || latest?.type || latest?.bowelType || ''
  };
}

function buildMacroSummary(milk, food, treatment) {
  return roundMacroSummary({
    calories: toNumber(milk.calories) + toNumber(food.calories) + toNumber(treatment.calories),
    protein: toNumber(milk.protein) + toNumber(food.protein) + toNumber(treatment.protein),
    naturalProtein: toNumber(milk.naturalProtein) + toNumber(food.naturalProtein),
    specialProtein: toNumber(milk.specialProtein) + toNumber(food.specialProtein),
    carbs: toNumber(milk.carbs) + toNumber(food.carbs) + toNumber(treatment.carbs),
    fat: toNumber(milk.fat) + toNumber(food.fat) + toNumber(treatment.fat)
  });
}

function normalizeDailySummaryV2(summary = {}) {
  return {
    ...createEmptyDailySummaryV2(summary.babyUid, summary.date),
    ...summary,
    basicInfo: {
      ...createEmptyBasicInfo(),
      ...(summary.basicInfo || {})
    },
    milk: roundMilkSummary(summary.milk || {}),
    food: roundFoodSummary(summary.food || {}),
    treatment: roundTreatmentSummary(summary.treatment || {}),
    medication: {
      totalRecords: toNumber(summary.medication?.totalRecords),
      takenMedicationIds: Array.isArray(summary.medication?.takenMedicationIds)
        ? summary.medication.takenMedicationIds
        : []
    },
    bowel: {
      totalRecords: toNumber(summary.bowel?.totalRecords),
      latestType: summary.bowel?.latestType || ''
    },
    macroSummary: roundMacroSummary(summary.macroSummary || {}),
    recordCounts: {
      milk: toNumber(summary.recordCounts?.milk),
      food: toNumber(summary.recordCounts?.food),
      medication: toNumber(summary.recordCounts?.medication),
      treatment: toNumber(summary.recordCounts?.treatment),
      bowel: toNumber(summary.recordCounts?.bowel)
    },
    sourceUpdatedAt: {
      ...createEmptyDailySummaryV2().sourceUpdatedAt,
      ...(summary.sourceUpdatedAt || {})
    },
    isDirty: summary.isDirty === true
  };
}

function buildDailySummaryV2(input = {}) {
  const milkRecords = input.milkRecords || [];
  const foodIntakeRecords = input.foodIntakeRecords || [];
  const treatmentRecords = input.treatmentRecords || [];
  const medicationRecords = input.medicationRecords || [];
  const bowelRecords = input.bowelRecords || [];
  const growthRecords = input.growthRecords || [];
  const milk = mergeMilkNutrition(milkRecords);
  const food = mergeFoodNutrition(foodIntakeRecords);
  const treatment = mergeTreatmentNutrition(treatmentRecords);
  const summary = {
    ...createEmptyDailySummaryV2(input.babyUid || '', input.date || ''),
    basicInfo: buildBasicInfo(growthRecords, milkRecords),
    milk,
    food,
    treatment,
    medication: buildMedicationSummary(medicationRecords),
    bowel: buildBowelSummary(bowelRecords),
    macroSummary: buildMacroSummary(milk, food, treatment),
    recordCounts: {
      milk: Array.isArray(milkRecords) ? milkRecords.length : 0,
      food: Array.isArray(foodIntakeRecords) ? foodIntakeRecords.length : 0,
      medication: Array.isArray(medicationRecords) ? medicationRecords.length : 0,
      treatment: Array.isArray(treatmentRecords) ? treatmentRecords.length : 0,
      bowel: Array.isArray(bowelRecords) ? bowelRecords.length : 0
    },
    sourceUpdatedAt: {
      feeding: getLatestSourceUpdatedAt(milkRecords),
      food: getLatestSourceUpdatedAt(foodIntakeRecords),
      medication: getLatestSourceUpdatedAt(medicationRecords),
      treatment: getLatestSourceUpdatedAt(treatmentRecords),
      bowel: getLatestSourceUpdatedAt(bowelRecords),
      growth: getLatestSourceUpdatedAt(growthRecords)
    },
    isDirty: false
  };

  return normalizeDailySummaryV2(summary);
}

module.exports = {
  createEmptyDailySummaryV2,
  buildDailySummaryV2,
  mergeMilkNutrition,
  mergeFoodNutrition,
  mergeTreatmentNutrition,
  normalizeDailySummaryV2
};
