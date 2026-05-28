const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const LEGACY_FEEDING_RECORDS_COLLECTION = 'feeding_records';
const GROWTH_RECORDS_V2_COLLECTION = 'growth_records_v2';
const BABY_INFO_COLLECTION = 'baby_info';
const DEFAULT_LEGACY_GROWTH_COLLECTIONS = [];

function hasValue(value) {
  return value !== '' && value !== undefined && value !== null;
}

function formatDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = `${chinaTime.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${chinaTime.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeBasicInfo(input = {}) {
  return {
    weight: hasValue(input.weight) ? input.weight : '',
    height: hasValue(input.height) ? input.height : (hasValue(input.length) ? input.length : ''),
    naturalProteinCoefficient: input.naturalProteinCoefficient ?? input.natural_protein_coefficient ?? '',
    specialProteinCoefficient: input.specialProteinCoefficient ?? input.special_protein_coefficient ?? '',
    calorieCoefficient: input.calorieCoefficient ?? input.calorie_coefficient ?? ''
  };
}

function hasBasicInfoData(info = {}) {
  return Object.values(normalizeBasicInfo(info)).some(hasValue);
}

function mergeMissingBasicInfo(primary = {}, fallback = {}) {
  const merged = { ...normalizeBasicInfo(primary) };
  const normalizedFallback = normalizeBasicInfo(fallback);
  Object.keys(merged).forEach((key) => {
    if (!hasValue(merged[key]) && hasValue(normalizedFallback[key])) {
      merged[key] = normalizedFallback[key];
    }
  });
  return merged;
}

function getChangedFields(existing = {}, nextData = {}) {
  return Object.keys(normalizeBasicInfo(nextData)).filter((key) => (
    hasValue(nextData[key]) && existing[key] !== nextData[key]
  ));
}

function createLegacyFeedingSnapshot(record = {}) {
  const date = formatDateKey(record.date);
  const basicInfo = normalizeBasicInfo(record.basicInfo || {});
  if (!date || !hasBasicInfoData(basicInfo)) {
    return null;
  }
  return {
    date,
    source: 'legacy_feeding_basic_info',
    basicInfo
  };
}

function createLegacyGrowthSnapshot(record = {}, sourceCollection = 'legacy_growth') {
  const date = formatDateKey(record.date || record.recordDate || record.recordedAt || record.createdAt);
  const basicInfo = normalizeBasicInfo(record.basicInfo || record);
  if (!date || !hasBasicInfoData(basicInfo)) {
    return null;
  }
  return {
    date,
    source: sourceCollection,
    basicInfo
  };
}

function pickLatestSnapshotForDate(sourceSnapshots = [], date) {
  return sourceSnapshots
    .filter((snapshot) => snapshot.date === date)
    .sort((left, right) => {
      const leftScore = left.source === 'legacy_growth_record' ? 1 : 0;
      const rightScore = right.source === 'legacy_growth_record' ? 1 : 0;
      return rightScore - leftScore;
    })[0] || null;
}

function sortSourceSnapshots(sourceSnapshots = []) {
  return (sourceSnapshots || [])
    .map((snapshot) => ({
      ...snapshot,
      date: formatDateKey(snapshot.date)
    }))
    .filter((snapshot) => snapshot.date && hasBasicInfoData(snapshot.basicInfo || {}))
    .sort((left, right) => {
      if (left.date === right.date) {
        const leftScore = left.source === 'legacy_growth_record' ? 1 : 0;
        const rightScore = right.source === 'legacy_growth_record' ? 1 : 0;
        return leftScore - rightScore;
      }
      return left.date > right.date ? 1 : -1;
    });
}

function buildBackfillPlan({
  babyUid = '',
  businessDates = [],
  sourceSnapshots = [],
  existingGrowthRecords = [],
  timestamp = db.serverDate()
} = {}) {
  const uniqueDates = Array.from(new Set((businessDates || []).map(formatDateKey).filter(Boolean))).sort();
  const existingByDate = new Map(
    (existingGrowthRecords || [])
      .filter((record) => record && (record.status || 'active') === 'active')
      .map((record) => [formatDateKey(record.date), record])
  );
  const sortedSnapshots = sortSourceSnapshots(sourceSnapshots);
  let snapshotIndex = 0;
  let latestInfo = null;
  let latestSourceDate = '';
  let latestSource = '';
  const plan = [];

  uniqueDates.forEach((date) => {
    let hasSameDaySnapshot = false;
    while (snapshotIndex < sortedSnapshots.length && sortedSnapshots[snapshotIndex].date <= date) {
      const snapshot = sortedSnapshots[snapshotIndex];
      hasSameDaySnapshot = hasSameDaySnapshot || snapshot.date === date;
      latestInfo = mergeMissingBasicInfo(snapshot.basicInfo, latestInfo || {});
      latestSourceDate = snapshot.date;
      latestSource = snapshot.source || 'legacy_feeding_basic_info';
      snapshotIndex++;
    }

    const nextInfo = latestInfo ? normalizeBasicInfo(latestInfo) : null;

    if (!nextInfo || !hasBasicInfoData(nextInfo)) {
      return;
    }

    const sourceDate = latestSourceDate;
    const carryForward = !hasSameDaySnapshot;
    const existing = existingByDate.get(date);
    const mergedInfo = existing
      ? mergeMissingBasicInfo(existing, nextInfo)
      : nextInfo;
    const changedFields = existing ? getChangedFields(existing, mergedInfo) : Object.keys(mergedInfo).filter((key) => hasValue(mergedInfo[key]));

    if (changedFields.length > 0) {
      plan.push({
        action: existing ? 'update' : 'add',
        recordId: existing?._id || '',
        babyUid,
        date,
        carryForward,
        sourceDate,
        source: carryForward ? 'carry_forward_backfill' : latestSource,
        changedFields,
        data: {
          ...mergedInfo,
          babyUid,
          date,
          schemaVersion: 1,
          recordType: 'growth_record',
          status: 'active',
          source: carryForward ? 'carry_forward_backfill' : latestSource,
          sourceDate,
          carryForward,
          backfilledAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null
        }
      });
    }

  });

  return plan;
}

async function getLegacyFeedingBatch({ babyUid, pageSize, offset }) {
  let query = db.collection(LEGACY_FEEDING_RECORDS_COLLECTION);
  if (babyUid) {
    query = query.where({ babyUid });
  }
  return query.skip(offset).limit(pageSize).get();
}

async function queryExistingGrowthRecords(babyUid, dates = []) {
  if (!babyUid || dates.length === 0) return [];
  const res = await db.collection(GROWTH_RECORDS_V2_COLLECTION)
    .where({
      babyUid,
      status: 'active'
    })
    .get();
  const dateSet = new Set(dates);
  return (res.data || []).filter((record) => dateSet.has(formatDateKey(record.date)));
}

async function queryLegacyGrowthSnapshots(babyUid, legacyGrowthCollections = []) {
  const snapshots = [];
  for (const collectionName of legacyGrowthCollections) {
    if (!collectionName) continue;
    try {
      const res = await db.collection(collectionName).where({ babyUid }).get();
      (res.data || []).forEach((record) => {
        const snapshot = createLegacyGrowthSnapshot(record, 'legacy_growth_record');
        if (snapshot) snapshots.push(snapshot);
      });
    } catch (error) {
      snapshots.push({
        date: '',
        source: collectionName,
        warning: error.message || String(error)
      });
    }
  }
  return snapshots;
}

async function queryInitialBabyInfoSnapshot(babyUid) {
  if (!babyUid) return null;
  const res = await db.collection(BABY_INFO_COLLECTION).where({ babyUid }).limit(1).get();
  const babyInfo = (res.data || [])[0];
  if (!babyInfo) return null;
  const basicInfo = normalizeBasicInfo(babyInfo);
  if (!hasBasicInfoData(basicInfo)) return null;
  return {
    date: formatDateKey(babyInfo.createdAt || babyInfo.updatedAt) || '0000-00-00',
    source: 'baby_info_initial',
    basicInfo
  };
}

async function applyPlan(plan = [], dryRun = true) {
  if (dryRun) return { added: 0, updated: 0 };
  let added = 0;
  let updated = 0;
  for (const item of plan) {
    if (item.action === 'update' && item.recordId) {
      await db.collection(GROWTH_RECORDS_V2_COLLECTION).doc(item.recordId).update({
        data: item.data
      });
      updated++;
      continue;
    }
    await db.collection(GROWTH_RECORDS_V2_COLLECTION).add({
      data: {
        ...item.data,
        createdAt: item.data.updatedAt
      }
    });
    added++;
  }
  return { added, updated };
}

exports.main = async (event = {}) => {
  const dryRun = event.dryRun === true;
  const babyUid = event.babyUid || '';
  const pageSize = Number(event.pageSize) > 0 ? Number(event.pageSize) : 50;
  const offsetStart = Number(event.offset) >= 0 ? Number(event.offset) : 0;
  const maxBatches = Number(event.maxBatches) > 0 ? Number(event.maxBatches) : 1;
  const startDate = event.startDate || '';
  const endDate = event.endDate || '';
  const includeBabyInfoInitial = event.includeBabyInfoInitial === true;
  const legacyGrowthCollections = Array.isArray(event.legacyGrowthCollections)
    ? event.legacyGrowthCollections
    : DEFAULT_LEGACY_GROWTH_COLLECTIONS;
  const timestamp = db.serverDate();
  let offset = offsetStart;
  let processedBatches = 0;
  let hasMore = false;
  let planned = 0;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const warnings = [];
  const errors = [];

  while (true) {
    if (maxBatches > 0 && processedBatches >= maxBatches) {
      hasMore = true;
      break;
    }

    const res = await getLegacyFeedingBatch({ babyUid, pageSize, offset });
    const batch = res.data || [];
    if (batch.length === 0) break;
    processedBatches++;

    const byBabyUid = new Map();
    batch.forEach((record) => {
      const recordBabyUid = record.babyUid || babyUid;
      const date = formatDateKey(record.date);
      if (!recordBabyUid || !date) {
        skipped++;
        return;
      }
      if ((startDate && date < startDate) || (endDate && date > endDate)) {
        skipped++;
        return;
      }
      if (!byBabyUid.has(recordBabyUid)) {
        byBabyUid.set(recordBabyUid, []);
      }
      byBabyUid.get(recordBabyUid).push(record);
    });

    for (const [recordBabyUid, records] of byBabyUid.entries()) {
      try {
        const businessDates = records.map((record) => formatDateKey(record.date)).filter(Boolean);
        const legacyFeedingSnapshots = records.map(createLegacyFeedingSnapshot).filter(Boolean);
        const legacyGrowthSnapshots = await queryLegacyGrowthSnapshots(recordBabyUid, legacyGrowthCollections);
        const initialSnapshot = includeBabyInfoInitial ? await queryInitialBabyInfoSnapshot(recordBabyUid) : null;
        const sourceSnapshots = [
          initialSnapshot,
          ...legacyGrowthSnapshots.filter((snapshot) => !snapshot.warning),
          ...legacyFeedingSnapshots
        ].filter(Boolean);
        legacyGrowthSnapshots
          .filter((snapshot) => snapshot.warning)
          .forEach((snapshot) => warnings.push({
            babyUid: recordBabyUid,
            source: snapshot.source,
            warning: snapshot.warning
          }));
        const existingGrowthRecords = await queryExistingGrowthRecords(recordBabyUid, businessDates);
        const plan = buildBackfillPlan({
          babyUid: recordBabyUid,
          businessDates,
          sourceSnapshots,
          existingGrowthRecords,
          timestamp
        });
        const result = await applyPlan(plan, dryRun);
        planned += plan.length;
        added += result.added;
        updated += result.updated;
      } catch (error) {
        errors.push({
          babyUid: recordBabyUid,
          message: error.message || String(error)
        });
      }
    }

    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  return {
    dryRun,
    babyUid,
    startDate,
    endDate,
    offset: offsetStart,
    nextOffset: offset,
    pageSize,
    maxBatches,
    processedBatches,
    hasMore,
    planned,
    added,
    updated,
    skipped,
    warnings,
    errors
  };
};

exports._internal = {
  formatDateKey,
  normalizeBasicInfo,
  createLegacyFeedingSnapshot,
  createLegacyGrowthSnapshot,
  buildBackfillPlan
};
