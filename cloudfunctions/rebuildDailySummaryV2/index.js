const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const BABY_INFO_COLLECTION = 'baby_info';
const LEGACY_FEEDING_RECORDS_COLLECTION = 'feeding_records';
const DAILY_SUMMARY_COLLECTION = 'daily_summary_v2';
const FEEDING_RECORDS_V2_COLLECTION = 'feeding_records_v2';
const FOOD_INTAKE_COLLECTION = 'food_intake_records';
const TREATMENT_RECORDS_COLLECTION = 'treatment_records';
const MEDICATION_RECORDS_COLLECTION = 'medication_records';
const BOWEL_RECORDS_COLLECTION = 'bowel_records';
const GROWTH_RECORDS_V2_COLLECTION = 'growth_records_v2';

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function parseDateKey(dateKey = '') {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function toDateStart(dateKey) {
  const date = dateKey instanceof Date ? dateKey : parseDateKey(dateKey);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateEnd(dateKey) {
  const start = toDateStart(dateKey);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function enumerateDateKeys(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!startDate || !endDate || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const result = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    result.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
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

function createEmptySummary(babyUid = '', date = '') {
  return {
    schemaVersion: 1,
    recordType: 'daily_summary',
    source: 'summary_builder_v2',
    status: 'active',
    babyUid,
    date,
    basicInfo: createEmptyBasicInfo(),
    milk: {
      totalVolume: 0,
      totalPowderWeight: 0,
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0,
      zeroProteinCalories: 0
    },
    food: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0
    },
    treatment: {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    },
    medication: {
      totalRecords: 0,
      takenMedicationIds: []
    },
    bowel: {
      totalRecords: 0,
      latestType: ''
    },
    macroSummary: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    },
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

function getTimestampValue(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestTimestamp(records = []) {
  return (records || [])
    .map(record => record.updatedAt || record.createdAt || record.recordTime || record.recordedAt || record.startDateTime)
    .filter(Boolean)
    .sort((left, right) => getTimestampValue(right) - getTimestampValue(left))[0] || null;
}

function mergeMilkNutrition(records = []) {
  const milk = createEmptySummary().milk;
  (records || []).forEach((record = {}) => {
    const nutrition = record.nutritionSummary || {};
    milk.totalVolume += toNumber(nutrition.totalVolume);
    milk.totalPowderWeight += toNumber(nutrition.totalPowderWeight);
    milk.calories += toNumber(nutrition.calories);
    milk.protein += toNumber(nutrition.protein);
    milk.naturalProtein += toNumber(nutrition.naturalProtein);
    milk.specialProtein += toNumber(nutrition.specialProtein);
    milk.carbs += toNumber(nutrition.carbs);
    milk.fat += toNumber(nutrition.fat);
    milk.zeroProteinCalories += toNumber(nutrition.zeroProteinCalories);
  });
  Object.keys(milk).forEach(key => { milk[key] = roundValue(milk[key]); });
  return milk;
}

function resolveFoodProteinSplit(record = {}) {
  const nutrition = record.nutrition || {};
  const protein = toNumber(nutrition.protein);
  const proteinSource = record.proteinSource
    || record.foodSnapshot?.proteinSource
    || (record.milkType === 'special_formula' ? 'special' : '');
  const natural = typeof nutrition.naturalProtein === 'number' && Number.isFinite(nutrition.naturalProtein)
    ? nutrition.naturalProtein
    : (typeof record.naturalProtein === 'number' && Number.isFinite(record.naturalProtein)
      ? record.naturalProtein
      : (proteinSource === 'special' ? 0 : protein));
  const special = typeof nutrition.specialProtein === 'number' && Number.isFinite(nutrition.specialProtein)
    ? nutrition.specialProtein
    : (typeof record.specialProtein === 'number' && Number.isFinite(record.specialProtein)
      ? record.specialProtein
      : (proteinSource === 'special' ? protein : 0));
  return { natural, special };
}

function mergeFoodNutrition(records = []) {
  const food = createEmptySummary().food;
  (records || []).forEach((record = {}) => {
    const nutrition = record.nutrition || {};
    const split = resolveFoodProteinSplit(record);
    food.calories += toNumber(nutrition.calories);
    food.protein += toNumber(nutrition.protein);
    food.naturalProtein += toNumber(split.natural);
    food.specialProtein += toNumber(split.special);
    food.fat += toNumber(nutrition.fat);
    food.carbs += toNumber(nutrition.carbs);
    food.fiber += toNumber(nutrition.fiber);
  });
  Object.keys(food).forEach(key => { food[key] = roundValue(food[key]); });
  return food;
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
      if (!shouldCountTreatmentItem(item)) return;
      summary.calories += toNumber(item.calories);
      summary.protein += toNumber(item.proteinG);
      summary.carbs += toNumber(item.carbsG);
      summary.fat += toNumber(item.fatG);
    });
  });
}

function mergeTreatmentNutrition(records = []) {
  const treatment = createEmptySummary().treatment;
  (records || []).forEach((record = {}) => {
    const summary = record.summary || {};
    const hasSummary = summary.totalCalories !== undefined
      || summary.calories !== undefined
      || summary.protein !== undefined
      || summary.carbs !== undefined
      || summary.fat !== undefined;

    if (hasSummary) {
      treatment.calories += toNumber(summary.totalCalories ?? summary.calories);
      treatment.protein += toNumber(summary.protein);
      treatment.carbs += toNumber(summary.carbs);
      treatment.fat += toNumber(summary.fat);
      return;
    }

    if (Array.isArray(record.groups)) {
      addTreatmentGroups(treatment, record.groups);
      return;
    }

    if (Array.isArray(record.items)) {
      addTreatmentGroups(treatment, [{ items: record.items }]);
    }
  });
  Object.keys(treatment).forEach(key => { treatment[key] = roundValue(treatment[key]); });
  return treatment;
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
  const milkSnapshot = (milkRecords || []).find(record => record.basicInfoSnapshot)?.basicInfoSnapshot;
  const activeGrowth = (growthRecords || []).find(record => (record.status || 'active') === 'active');
  if (activeGrowth) {
    const growthInfo = normalizeBasicInfoFields(activeGrowth);
    return milkSnapshot ? fillMissingBasicInfo(growthInfo, milkSnapshot) : growthInfo;
  }
  return milkSnapshot ? normalizeBasicInfoFields(milkSnapshot) : createEmptyBasicInfo();
}

function buildMedicationSummary(records = []) {
  return {
    totalRecords: (records || []).length,
    takenMedicationIds: (records || []).map(record => record.medicationId || record._id || record.id || '').filter(Boolean)
  };
}

function buildBowelSummary(records = []) {
  const latest = [...(records || [])].sort((left, right) => (
    new Date(right.recordTime || right.updatedAt || right.createdAt || 0).getTime()
      - new Date(left.recordTime || left.updatedAt || left.createdAt || 0).getTime()
  ))[0];
  return {
    totalRecords: (records || []).length,
    latestType: latest?.stoolType || latest?.type || latest?.bowelType || ''
  };
}

function buildMacroSummary(milk, food, treatment) {
  return {
    calories: roundValue(toNumber(milk.calories) + toNumber(food.calories) + toNumber(treatment.calories)),
    protein: roundValue(toNumber(milk.protein) + toNumber(food.protein) + toNumber(treatment.protein)),
    naturalProtein: roundValue(toNumber(milk.naturalProtein) + toNumber(food.naturalProtein)),
    specialProtein: roundValue(toNumber(milk.specialProtein) + toNumber(food.specialProtein)),
    carbs: roundValue(toNumber(milk.carbs) + toNumber(food.carbs) + toNumber(treatment.carbs)),
    fat: roundValue(toNumber(milk.fat) + toNumber(food.fat) + toNumber(treatment.fat))
  };
}

function stripDocumentFields(data = {}) {
  const nextData = { ...data };
  delete nextData._id;
  delete nextData.id;
  delete nextData.createdAt;
  return nextData;
}

async function queryByDate(collectionName, babyUid, date, options = {}) {
  const where = {
    babyUid,
    date,
    ...(options.status !== false ? { status: options.status || 'active' } : {})
  };
  const res = await db.collection(collectionName).where(where).get();
  return res.data || [];
}

async function loadBowelRecords(babyUid, date) {
  const startOfDay = toDateStart(date);
  const endOfDay = toDateEnd(date);
  const res = await db.collection(BOWEL_RECORDS_COLLECTION)
    .where({
      babyUid,
      recordTime: db.command.gte(startOfDay).and(db.command.lt(endOfDay))
    })
    .orderBy('recordTime', 'desc')
    .get();
  return res.data || [];
}

async function loadMedicationRecords(babyUid, date) {
  const startOfDay = toDateStart(date);
  const endOfDay = toDateEnd(date);
  const res = await db.collection(MEDICATION_RECORDS_COLLECTION)
    .where({
      babyUid,
      date: db.command.gte(startOfDay).and(db.command.lt(endOfDay))
    })
    .orderBy('actualDateTime', 'desc')
    .get();
  return res.data || [];
}

async function loadTreatmentRecords(babyUid, date) {
  const startOfDay = toDateStart(date);
  const endOfDay = toDateEnd(date);
  const res = await db.collection(TREATMENT_RECORDS_COLLECTION)
    .where({
      babyUid,
      date: db.command.gte(startOfDay).and(db.command.lt(endOfDay))
    })
    .orderBy('startDateTime', 'desc')
    .get();
  return res.data || [];
}

async function getExistingSummary(babyUid, date) {
  const res = await db.collection(DAILY_SUMMARY_COLLECTION)
    .where({ babyUid, date, status: 'active' })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function loadEventRecords(babyUid, date) {
  const [
    milkRecords,
    foodRecords,
    treatmentRecords,
    medicationRecords,
    bowelRecords,
    growthRecords
  ] = await Promise.all([
    queryByDate(FEEDING_RECORDS_V2_COLLECTION, babyUid, date),
    queryByDate(FOOD_INTAKE_COLLECTION, babyUid, date),
    loadTreatmentRecords(babyUid, date),
    loadMedicationRecords(babyUid, date),
    loadBowelRecords(babyUid, date),
    queryByDate(GROWTH_RECORDS_V2_COLLECTION, babyUid, date)
  ]);
  return { milkRecords, foodRecords, treatmentRecords, medicationRecords, bowelRecords, growthRecords };
}

function buildDailySummaryForDate(babyUid, date, events) {
  const milk = mergeMilkNutrition(events.milkRecords);
  const food = mergeFoodNutrition(events.foodRecords);
  const treatment = mergeTreatmentNutrition(events.treatmentRecords);
  const summary = {
    ...createEmptySummary(babyUid, date),
    basicInfo: buildBasicInfo(events.growthRecords, events.milkRecords),
    milk,
    food,
    treatment,
    medication: buildMedicationSummary(events.medicationRecords),
    bowel: buildBowelSummary(events.bowelRecords),
    macroSummary: buildMacroSummary(milk, food, treatment),
    recordCounts: {
      milk: events.milkRecords.length,
      food: events.foodRecords.length,
      medication: events.medicationRecords.length,
      treatment: events.treatmentRecords.length,
      bowel: events.bowelRecords.length
    },
    sourceUpdatedAt: {
      feeding: latestTimestamp(events.milkRecords),
      food: latestTimestamp(events.foodRecords),
      medication: latestTimestamp(events.medicationRecords),
      treatment: latestTimestamp(events.treatmentRecords),
      bowel: latestTimestamp(events.bowelRecords),
      growth: latestTimestamp(events.growthRecords)
    },
    isDirty: false
  };
  return summary;
}

async function upsertDailySummary(summary) {
  const timestamp = db.serverDate();
  const existing = await getExistingSummary(summary.babyUid, summary.date);
  const data = stripDocumentFields({
    ...summary,
    isDirty: false,
    rebuiltAt: timestamp,
    updatedAt: timestamp
  });
  if (existing?._id) {
    await db.collection(DAILY_SUMMARY_COLLECTION).doc(existing._id).update({ data });
    return { ...data, _id: existing._id };
  }
  const addRes = await db.collection(DAILY_SUMMARY_COLLECTION).add({
    data: {
      ...data,
      createdAt: timestamp
    }
  });
  return { ...data, _id: addRes._id, createdAt: timestamp };
}

async function rebuildDailySummaryForDate(babyUid, date, options = {}) {
  const events = await loadEventRecords(babyUid, date);
  const summary = buildDailySummaryForDate(babyUid, date, events);
  if (options.dryRun) {
    return { date, summary, dryRun: true };
  }
  const savedSummary = await upsertDailySummary(summary);
  return { date, summary: savedSummary, dryRun: false };
}

async function loadBabyUidCandidates(collectionName, limit = 1000) {
  const res = await db.collection(collectionName)
    .where({})
    .limit(limit)
    .get();
  return (res.data || [])
    .map(record => record.babyUid || '')
    .filter(Boolean);
}

async function listBabyUids(event = {}) {
  const pageSize = Number(event.pageSize) || 50;
  const offset = Number(event.offset) || 0;
  const scanLimit = Number(event.scanLimit) || 1000;
  const [fromBabyInfo, fromLegacyFeeding, fromFoodIntakes] = await Promise.all([
    loadBabyUidCandidates(BABY_INFO_COLLECTION, scanLimit),
    loadBabyUidCandidates(LEGACY_FEEDING_RECORDS_COLLECTION, scanLimit),
    loadBabyUidCandidates(FOOD_INTAKE_COLLECTION, scanLimit)
  ]);
  const allBabyUids = Array.from(new Set([
    ...fromBabyInfo,
    ...fromLegacyFeeding,
    ...fromFoodIntakes
  ])).sort();
  const babyUids = allBabyUids.slice(offset, offset + pageSize);
  return {
    ok: true,
    mode: 'listBabyUids',
    pageSize,
    offset,
    scanLimit,
    nextOffset: offset + babyUids.length,
    hasMore: offset + babyUids.length < allBabyUids.length,
    total: allBabyUids.length,
    babyUids
  };
}

exports.main = async (event = {}) => {
  if (event.listBabyUids === true) {
    return listBabyUids(event);
  }

  const babyUid = event.babyUid || '';
  const dryRun = event.dryRun !== false;
  const pageSize = Number(event.pageSize) || 10;
  const offset = Number(event.offset) || 0;
  const allDates = enumerateDateKeys(event.startDate || '', event.endDate || '');
  const targetDates = allDates.slice(offset, offset + pageSize);
  const result = {
    ok: true,
    dryRun,
    babyUid,
    startDate: event.startDate || '',
    endDate: event.endDate || '',
    pageSize,
    offset,
    nextOffset: offset + targetDates.length,
    hasMore: offset + targetDates.length < allDates.length,
    scannedDates: targetDates.length,
    rebuilt: 0,
    failed: 0,
    dates: targetDates,
    errors: []
  };

  if (!babyUid) {
    return {
      ...result,
      ok: false,
      error: 'missing babyUid'
    };
  }

  for (const date of targetDates) {
    try {
      await rebuildDailySummaryForDate(babyUid, date, { dryRun });
      if (!dryRun) result.rebuilt += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ date, message: error.message || String(error) });
    }
  }

  return result;
};

exports._internal = {
  enumerateDateKeys,
  listBabyUids,
  mergeMilkNutrition,
  mergeFoodNutrition,
  buildDailySummaryForDate,
  rebuildDailySummaryForDate
};
