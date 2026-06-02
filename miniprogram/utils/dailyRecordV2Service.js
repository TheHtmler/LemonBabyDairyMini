const FeedingRecordV2Model = require('../models/feedingRecordV2');
const MedicationRecordModel = require('../models/medicationRecord');
const TreatmentRecordModel = require('../models/treatmentRecord');
const DailySummaryV2Model = require('../models/dailySummaryV2');
const {
  buildDailySummaryV2
} = require('./dailySummaryV2Utils');

const db = wx.cloud.database();
const growthRecordsV2Collection = db.collection('growth_records_v2');
const bowelRecordsCollection = db.collection('bowel_records');
const legacyFeedingRecordCollection = db.collection('feeding_records');

function unwrapResult(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (result?.success === false) {
    return [];
  }
  if (Array.isArray(result?.data)) {
    return result.data;
  }
  return [];
}

function toDateStart(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateEnd(dateStr) {
  const start = toDateStart(dateStr);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
}

async function loadGrowthRecords(babyUid, date) {
  const res = await growthRecordsV2Collection
    .where({
      babyUid,
      date,
      status: 'active'
    })
    .orderBy('updatedAt', 'desc')
    .get();
  return res.data || [];
}

async function loadBowelRecords(babyUid, date) {
  if (db.command?.gte && db.command?.lt) {
    const startOfDay = toDateStart(date);
    const endOfDay = toDateEnd(date);
    const res = await bowelRecordsCollection
      .where({
        babyUid,
        recordTime: db.command.gte(startOfDay).and(db.command.lt(endOfDay))
      })
      .orderBy('recordTime', 'desc')
      .get();
    return res.data || [];
  }

  const res = await bowelRecordsCollection
    .where({
      babyUid,
      date,
      status: 'active'
    })
    .orderBy('recordTime', 'desc')
    .get();
  return res.data || [];
}

function dedupeById(records = []) {
  const seen = new Set();
  return (records || []).filter((record = {}) => {
    const key = record._id || record.id || JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractLegacyFoodIntakes(records = []) {
  return (records || []).flatMap((record = {}) => {
    const intakes = Array.isArray(record.intakes) ? record.intakes : [];
    return intakes
      .filter((intake = {}) => (intake.status || 'active') === 'active')
      .filter((intake = {}) => intake.type !== 'milk' && !intake.milkType)
      .map((intake = {}) => ({
        ...intake,
        legacyRecordId: record._id || record.id || '',
        date: record.date || intake.date || ''
      }));
  });
}

async function loadLegacyFoodIntakes(babyUid, date) {
  const results = [];
  if (db.command?.gte && db.command?.lt) {
    const startOfDay = toDateStart(date);
    const endOfDay = toDateEnd(date);
    const rangeRes = await legacyFeedingRecordCollection
      .where({
        babyUid,
        date: db.command.gte(startOfDay).and(db.command.lt(endOfDay))
      })
      .get();
    results.push(...(rangeRes.data || []));
  }

  const stringRes = await legacyFeedingRecordCollection
    .where({
      babyUid,
      date
    })
    .get();
  results.push(...(stringRes.data || []));

  return extractLegacyFoodIntakes(dedupeById(results));
}

async function loadEventRecords(babyUid, date) {
  const [
    milkRecords,
    foodIntakeRecords,
    medicationResult,
    treatmentResult,
    bowelRecords,
    growthRecords
  ] = await Promise.all([
    FeedingRecordV2Model.getRecordsByDate(babyUid, date),
    loadLegacyFoodIntakes(babyUid, date),
    MedicationRecordModel.findByDate(date, babyUid),
    TreatmentRecordModel.findByDate(date, babyUid),
    loadBowelRecords(babyUid, date),
    loadGrowthRecords(babyUid, date)
  ]);

  return {
    milkRecords: unwrapResult(milkRecords),
    foodIntakeRecords: unwrapResult(foodIntakeRecords),
    usesLegacyFoodIntakes: true,
    medicationRecords: unwrapResult(medicationResult),
    treatmentRecords: unwrapResult(treatmentResult),
    bowelRecords: unwrapResult(bowelRecords),
    growthRecords: unwrapResult(growthRecords)
  };
}

function buildServiceResult(babyUid, date, eventRecords, summary) {
  return {
    babyUid,
    date,
    summary,
    basicInfo: summary.basicInfo || {},
    milkRecords: eventRecords.milkRecords,
    foodIntakeRecords: eventRecords.foodIntakeRecords,
    usesLegacyFoodIntakes: eventRecords.usesLegacyFoodIntakes === true,
    medicationRecords: eventRecords.medicationRecords,
    treatmentRecords: eventRecords.treatmentRecords,
    bowelRecords: eventRecords.bowelRecords,
    growthRecords: eventRecords.growthRecords,
    overview: {
      milk: summary.milk,
      food: summary.food,
      treatment: summary.treatment,
      medication: summary.medication,
      bowel: summary.bowel,
      macroSummary: summary.macroSummary,
      recordCounts: summary.recordCounts
    }
  };
}

function getBasicInfoCompleteness(basicInfo = {}) {
  return ['weight', 'height', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient']
    .filter((key) => {
      const value = basicInfo[key];
      return value !== '' && value !== null && value !== undefined;
    }).length;
}

function shouldRefreshCachedBasicInfo(cachedSummary = {}, rebuiltSummary = {}) {
  return getBasicInfoCompleteness(rebuiltSummary.basicInfo)
    > getBasicInfoCompleteness(cachedSummary.basicInfo);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function hasNumericIncrease(cached = {}, rebuilt = {}, fields = []) {
  return fields.some((field) => toNumber(rebuilt[field]) > toNumber(cached[field]));
}

function hasRecordCountIncrease(cachedSummary = {}, rebuiltSummary = {}) {
  const cachedCounts = cachedSummary.recordCounts || {};
  const rebuiltCounts = rebuiltSummary.recordCounts || {};
  return ['milk', 'food', 'medication', 'treatment', 'bowel']
    .some((field) => toNumber(rebuiltCounts[field]) > toNumber(cachedCounts[field]));
}

function shouldRefreshCachedSummary(cachedSummary = {}, rebuiltSummary = {}) {
  if (shouldRefreshCachedBasicInfo(cachedSummary, rebuiltSummary)) {
    return true;
  }

  const macroFields = ['calories', 'protein', 'naturalProtein', 'specialProtein', 'carbs', 'fat'];
  const foodFields = ['calories', 'protein', 'naturalProtein', 'specialProtein', 'carbs', 'fat', 'fiber'];
  const milkFields = ['calories', 'protein', 'naturalProtein', 'specialProtein', 'totalVolume', 'totalPowderWeight'];
  const treatmentFields = ['calories', 'protein', 'carbs', 'fat'];

  if (hasNumericIncrease(cachedSummary.macroSummary, rebuiltSummary.macroSummary, macroFields)) {
    return true;
  }
  if (hasNumericIncrease(cachedSummary.food, rebuiltSummary.food, foodFields)) {
    return true;
  }
  if (hasNumericIncrease(cachedSummary.milk, rebuiltSummary.milk, milkFields)) {
    return true;
  }
  if (hasNumericIncrease(cachedSummary.treatment, rebuiltSummary.treatment, treatmentFields)) {
    return true;
  }

  return hasRecordCountIncrease(cachedSummary, rebuiltSummary)
    && toNumber(rebuiltSummary.macroSummary?.calories) >= toNumber(cachedSummary.macroSummary?.calories);
}

function hasValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function getBodyMeasurementCompleteness(basicInfo = {}) {
  return ['weight', 'height'].filter((key) => hasValue(basicInfo[key])).length;
}

function normalizeGrowthRecordBasicInfo(record = {}) {
  return {
    weight: record.weight || '',
    height: record.height || record.length || '',
    naturalProteinCoefficient: record.naturalProteinCoefficient || '',
    specialProteinCoefficient: record.specialProteinCoefficient || '',
    calorieCoefficient: record.calorieCoefficient || ''
  };
}

function shouldCarryForwardBasicInfo(currentBasicInfo = {}, snapshot = {}) {
  return getBodyMeasurementCompleteness(snapshot) > getBodyMeasurementCompleteness(currentBasicInfo);
}

async function ensureGrowthRecordForDate(babyUid, date, eventRecords = {}) {
  const growthRecords = Array.isArray(eventRecords.growthRecords) ? eventRecords.growthRecords : [];
  const currentGrowthRecord = growthRecords.find((record = {}) => (record.status || 'active') === 'active') || null;
  const currentBasicInfo = normalizeGrowthRecordBasicInfo(currentGrowthRecord || {});
  if (getBodyMeasurementCompleteness(currentBasicInfo) >= 2) {
    return eventRecords;
  }

  const snapshot = await FeedingRecordV2Model.resolveBasicInfoSnapshot(babyUid, date, {
    includeFallbacks: false,
    includeProfileInitial: true,
    carryForwardMissing: true
  });
  if (!shouldCarryForwardBasicInfo(currentBasicInfo, snapshot)) {
    return eventRecords;
  }

  // 只顺延体重/身高这类“真实测量值”，绝不顺延蛋白/热量系数：
  // 系数属于设定，不应被自动写进当天成长记录，否则会出现“今天没记录却带出昨天系数”。
  const nextBasicInfo = {
    weight: hasValue(snapshot.weight) ? snapshot.weight : currentBasicInfo.weight,
    height: hasValue(snapshot.height) ? snapshot.height : currentBasicInfo.height
  };

  await FeedingRecordV2Model.upsertGrowthRecordForDate(babyUid, date, nextBasicInfo);
  return {
    ...eventRecords,
    growthRecords: [
      {
        ...(currentGrowthRecord || {}),
        babyUid,
        date,
        status: 'active',
        source: currentGrowthRecord?.source || 'daily_record_v2_carry_forward',
        ...nextBasicInfo
      },
      ...growthRecords.filter((record) => record !== currentGrowthRecord)
    ]
  };
}

async function rebuildDailySummaryForDate(babyUid, date, preloadedEvents = null) {
  const loadedEventRecords = preloadedEvents || await loadEventRecords(babyUid, date);
  const eventRecords = await ensureGrowthRecordForDate(babyUid, date, loadedEventRecords);
  const summary = buildDailySummaryV2({
    babyUid,
    date,
    ...eventRecords
  });
  const savedSummary = await DailySummaryV2Model.upsertSummary(summary);
  return {
    summary: savedSummary,
    eventRecords
  };
}

async function getDailyRecordV2(babyUid, date) {
  const [cachedSummary, loadedEventRecords] = await Promise.all([
    DailySummaryV2Model.getByDate(babyUid, date),
    loadEventRecords(babyUid, date)
  ]);
  const eventRecords = await ensureGrowthRecordForDate(babyUid, date, loadedEventRecords);

  if (cachedSummary && cachedSummary.isDirty !== true) {
    const rebuilt = buildDailySummaryV2({
      babyUid,
      date,
      ...eventRecords
    });
    if (shouldRefreshCachedSummary(cachedSummary, rebuilt)) {
      const savedSummary = await DailySummaryV2Model.upsertSummary({
        ...rebuilt,
        _id: cachedSummary._id
      });
      return buildServiceResult(babyUid, date, eventRecords, savedSummary);
    }
    return buildServiceResult(babyUid, date, eventRecords, cachedSummary);
  }

  const rebuilt = buildDailySummaryV2({
    babyUid,
    date,
    ...eventRecords
  });
  const savedSummary = await DailySummaryV2Model.upsertSummary({
    ...rebuilt,
    _id: cachedSummary?._id
  });

  return buildServiceResult(babyUid, date, eventRecords, savedSummary);
}

function enumerateDateKeys(startDate, endDate) {
  const result = [];
  const [sy, sm, sd] = String(startDate).split('-').map(Number);
  const [ey, em, ed] = String(endDate).split('-').map(Number);
  if ([sy, sm, sd, ey, em, ed].some((value) => !Number.isFinite(value))) {
    return result;
  }
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cursor <= end) {
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    result.push(`${cursor.getFullYear()}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

// 取范围内每日汇总。
// 默认只读已存在的 daily_summary_v2 缓存（懒生成）。
// rebuildMissing=true 时，对范围内“缺失或过期(isDirty)”的天按原始记录重建并补齐，
// 让趋势与「数据记录」页同源（会顺延体重、为缺数据的天写入空汇总）。
// skipDates 用于排除“调用方另行实时处理”的日期（如首页的今天），避免与 getDailyRecordV2 并发重建产生重复文档。
async function getDailySummariesForRange(babyUid, startDate, endDate, options = {}) {
  const summaries = await DailySummaryV2Model.getRange(babyUid, startDate, endDate);
  if (options.rebuildMissing !== true) {
    return summaries;
  }

  const skip = new Set(options.skipDates || []);
  const freshDates = new Set(
    summaries.filter((summary) => summary.isDirty !== true).map((summary) => summary.date)
  );
  const targetDates = enumerateDateKeys(startDate, endDate)
    .filter((date) => !skip.has(date) && !freshDates.has(date));
  if (targetDates.length === 0) {
    return summaries;
  }

  const targetSet = new Set(targetDates);
  const kept = summaries.filter((summary) => !targetSet.has(summary.date));
  const rebuilt = [];
  for (const date of targetDates) {
    try {
      const { summary } = await rebuildDailySummaryForDate(babyUid, date);
      if (summary) {
        rebuilt.push(summary);
      }
    } catch (error) {
      // 单天重建失败不应阻断整体趋势加载
      console.error('重建当日汇总失败:', date, error);
    }
  }

  return kept.concat(rebuilt);
}

module.exports = {
  getDailyRecordV2,
  rebuildDailySummaryForDate,
  getDailySummariesForRange,
  loadLegacyFoodIntakes
};
