const FeedingRecordV2Model = require('../models/feedingRecordV2');
const FoodIntakeRecordModel = require('../models/foodIntakeRecord');
const MedicationRecordModel = require('../models/medicationRecord');
const TreatmentRecordModel = require('../models/treatmentRecord');
const DailySummaryV2Model = require('../models/dailySummaryV2');
const {
  buildDailySummaryV2
} = require('./dailySummaryV2Utils');

const db = wx.cloud.database();
const growthRecordsV2Collection = db.collection('growth_records_v2');
const bowelRecordsCollection = db.collection('bowel_records');

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
    FoodIntakeRecordModel.findByDate(babyUid, date),
    MedicationRecordModel.findByDate(date, babyUid),
    TreatmentRecordModel.findByDate(date, babyUid),
    loadBowelRecords(babyUid, date),
    loadGrowthRecords(babyUid, date)
  ]);

  return {
    milkRecords: unwrapResult(milkRecords),
    foodIntakeRecords: unwrapResult(foodIntakeRecords),
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

async function rebuildDailySummaryForDate(babyUid, date, preloadedEvents = null) {
  const eventRecords = preloadedEvents || await loadEventRecords(babyUid, date);
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
  const [cachedSummary, eventRecords] = await Promise.all([
    DailySummaryV2Model.getByDate(babyUid, date),
    loadEventRecords(babyUid, date)
  ]);

  if (cachedSummary && cachedSummary.isDirty !== true) {
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

async function getDailySummariesForRange(babyUid, startDate, endDate, options = {}) {
  const summaries = await DailySummaryV2Model.getRange(babyUid, startDate, endDate);
  if (options.rebuildMissing === true) {
    return summaries;
  }
  return summaries;
}

module.exports = {
  getDailyRecordV2,
  rebuildDailySummaryForDate,
  getDailySummariesForRange
};
