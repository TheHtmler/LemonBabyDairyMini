const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const LEGACY_FEEDING_RECORDS_COLLECTION = 'feeding_records';
const FOOD_INTAKE_RECORDS_COLLECTION = 'food_intake_records';
const DEFAULT_MIGRATION_VERSION = 'food-v2';

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

function formatDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = `${chinaTime.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${chinaTime.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeNutrition(nutrition = {}, intake = {}) {
  const protein = toNumber(nutrition.protein);
  const proteinSource = intake.proteinSource || intake.foodSnapshot?.proteinSource || 'natural';
  const naturalProtein = nutrition.naturalProtein !== undefined
    ? toNumber(nutrition.naturalProtein)
    : (intake.naturalProtein !== undefined ? toNumber(intake.naturalProtein) : (proteinSource === 'special' ? 0 : protein));
  const specialProtein = nutrition.specialProtein !== undefined
    ? toNumber(nutrition.specialProtein)
    : (intake.specialProtein !== undefined ? toNumber(intake.specialProtein) : (proteinSource === 'special' ? protein : 0));

  return {
    calories: roundValue(toNumber(nutrition.calories)),
    protein: roundValue(protein),
    naturalProtein: roundValue(naturalProtein),
    specialProtein: roundValue(specialProtein),
    fat: roundValue(toNumber(nutrition.fat)),
    carbs: roundValue(toNumber(nutrition.carbs)),
    fiber: roundValue(toNumber(nutrition.fiber)),
    sodium: roundValue(toNumber(nutrition.sodium))
  };
}

function normalizeNutritionBasis(basis = {}) {
  return {
    quantity: toNumber(basis.quantity || basis.baseQuantity, 100) || 100,
    unit: basis.unit || basis.baseUnit || 'g'
  };
}

function normalizeNutritionPerBasis(nutrition = {}) {
  return {
    calories: roundValue(toNumber(nutrition.calories)),
    protein: roundValue(toNumber(nutrition.protein)),
    fat: roundValue(toNumber(nutrition.fat)),
    carbs: roundValue(toNumber(nutrition.carbs)),
    fiber: roundValue(toNumber(nutrition.fiber)),
    sodium: roundValue(toNumber(nutrition.sodium))
  };
}

function normalizeFoodSnapshot(snapshot = {}, fallbackName = '', intake = {}) {
  const nutritionBasis = normalizeNutritionBasis(snapshot.nutritionBasis || {
    quantity: snapshot.baseQuantity,
    unit: snapshot.baseUnit
  });
  const nutritionPerBasis = normalizeNutritionPerBasis(
    snapshot.nutritionPerBasis || snapshot.nutritionPer100g || snapshot.nutritionPerUnit || {}
  );
  return {
    name: snapshot.name || fallbackName || '',
    category: snapshot.category || '',
    categoryLevel1: snapshot.categoryLevel1 || snapshot.category || '',
    categoryLevel2: snapshot.categoryLevel2 || '',
    nutritionBasis,
    proteinSource: snapshot.proteinSource || intake.proteinSource || 'natural',
    proteinQuality: snapshot.proteinQuality || intake.proteinQuality || '',
    nutritionPerBasis,
    sourceType: snapshot.sourceType || intake.sourceType || '',
    libraryScope: snapshot.libraryScope || intake.libraryScope || '',
    sourceSystemFoodId: snapshot.sourceSystemFoodId || '',
    sourceFoodCode: snapshot.sourceFoodCode || snapshot.origin?.foodCode || ''
  };
}

function resolveTimeText(intake = {}) {
  const candidates = [intake.recordedAt, intake.mealTime, intake.time];
  for (const value of candidates) {
    if (!value) continue;
    if (typeof value === 'string') {
      const match = value.match(/(\d{1,2}):(\d{2})/);
      if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${`${value.getHours()}`.padStart(2, '0')}:${`${value.getMinutes()}`.padStart(2, '0')}`;
    }
  }
  return '';
}

function resolveRecordedAt(dateKey, intake = {}) {
  const value = intake.recordedAt || intake.recordTime || '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const timeText = resolveTimeText(intake);
  if (dateKey && timeText) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const [hour, minute] = timeText.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  return null;
}

function normalizeMealCombinationSource(source = {}) {
  if (!source || typeof source !== 'object') return undefined;
  const combinationId = (source.combinationId || '').toString().trim();
  const combinationName = (source.combinationName || '').toString().trim();
  const sourceGroupId = (source.sourceGroupId || '').toString().trim();
  if (!combinationId && !combinationName) return undefined;
  return {
    combinationId,
    combinationName,
    ...(sourceGroupId ? { sourceGroupId } : {})
  };
}

function buildLegacyIntakeKey(intake = {}, index = 0) {
  return intake._id
    || `${intake.mealBatchId || ''}|${intake.foodId || intake.nameSnapshot || ''}|${intake.recordedAt || intake.mealTime || ''}|${intake.quantity || ''}|${index}`;
}

function normalizeKeyPart(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value).trim();
}

function buildMigrationDedupKey(payload = {}) {
  const timeKey = payload.time || resolveTimeText(payload) || normalizeKeyPart(payload.recordedAt);
  return [
    payload.babyUid,
    payload.date,
    payload.mealBatchId,
    payload.foodId || payload.foodName || payload.foodSnapshot?.name || '',
    timeKey,
    payload.quantity,
    payload.unit,
    payload.sortOrder
  ].map(normalizeKeyPart).join('|');
}

function isActiveFoodIntake(intake = {}) {
  if (!intake || (intake.status || 'active') !== 'active') {
    return { active: false, reason: 'inactive' };
  }
  if (intake.type === 'milk' || intake.foodType === 'milk' || intake.milkType) {
    return { active: false, reason: 'non_food' };
  }
  return { active: true, reason: '' };
}

function buildV2FoodIntakePayloadFromLegacyIntake({
  legacyRecord = {},
  intake = {},
  intakeIndex = 0,
  migrationVersion = DEFAULT_MIGRATION_VERSION,
  migratedAt = db.serverDate()
} = {}) {
  const dateKey = formatDateKey(legacyRecord.date || intake.date);
  const foodName = intake.foodName || intake.foodSnapshot?.name || intake.nameSnapshot || '食物';
  const foodSnapshot = normalizeFoodSnapshot(intake.foodSnapshot || {}, foodName, intake);
  const plannedNutrition = intake.plannedNutrition
    ? normalizeNutrition(intake.plannedNutrition, intake)
    : undefined;
  const mealCombinationSource = normalizeMealCombinationSource(intake.mealCombinationSource);

  const payload = {
    schemaVersion: 1,
    recordType: 'food_intake',
    source: 'legacy_migration',
    status: 'active',
    babyUid: legacyRecord.babyUid || intake.babyUid || '',
    date: dateKey,
    mealBatchId: intake.mealBatchId || '',
    recordedAt: resolveRecordedAt(dateKey, intake),
    time: resolveTimeText(intake),
    foodId: intake.foodId || '',
    foodName,
    foodSnapshot,
    quantity: toNumber(intake.quantity),
    unit: intake.unit || foodSnapshot.nutritionBasis.unit || 'g',
    nutrition: normalizeNutrition(intake.nutrition || {}, intake),
    completionPercent: toNumber(intake.completionPercent, 100),
    notes: intake.notes || '',
    mealTime: intake.mealTime || resolveTimeText(intake),
    mealLabel: intake.mealLabel || '',
    mealNote: intake.mealNote || '',
    sortOrder: toNumber(intake.sortOrder, intakeIndex),
    sourceType: intake.sourceType || (mealCombinationSource ? 'meal_combination' : 'manual_food'),
    legacySource: {
      collection: LEGACY_FEEDING_RECORDS_COLLECTION,
      recordId: legacyRecord._id || legacyRecord.id || '',
      intakeId: buildLegacyIntakeKey(intake, intakeIndex)
    },
    migrationVersion,
    migratedAt,
    createdAt: intake.createdAt || legacyRecord.createdAt || migratedAt,
    updatedAt: intake.updatedAt || legacyRecord.updatedAt || migratedAt,
    deletedAt: null,
    createdBy: intake.createdBy || legacyRecord.createdBy || '',
    updatedBy: intake.updatedBy || intake.createdBy || legacyRecord.updatedBy || legacyRecord.createdBy || '',
    deletedBy: ''
  };

  if (intake.plannedQuantity !== undefined) {
    payload.plannedQuantity = toNumber(intake.plannedQuantity);
  }
  if (plannedNutrition) {
    payload.plannedNutrition = plannedNutrition;
  }
  if (mealCombinationSource) {
    payload.mealCombinationSource = mealCombinationSource;
  }
  payload.migrationDedupKey = buildMigrationDedupKey(payload);

  return payload;
}

async function findExistingMigratedIntake({
  babyUid = '',
  recordId = '',
  intakeId = '',
  migrationVersion = DEFAULT_MIGRATION_VERSION
} = {}) {
  const res = await db.collection(FOOD_INTAKE_RECORDS_COLLECTION)
    .where({
      babyUid,
      status: 'active',
      source: 'legacy_migration',
      migrationVersion,
      'legacySource.collection': LEGACY_FEEDING_RECORDS_COLLECTION,
      'legacySource.recordId': recordId,
      'legacySource.intakeId': intakeId
    })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function findExistingLogicalMigratedIntake({
  babyUid = '',
  migrationDedupKey = '',
  migrationVersion = DEFAULT_MIGRATION_VERSION
} = {}) {
  if (!migrationDedupKey) return null;
  const res = await db.collection(FOOD_INTAKE_RECORDS_COLLECTION)
    .where({
      babyUid,
      status: 'active',
      source: 'legacy_migration',
      migrationVersion,
      migrationDedupKey
    })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

function createSummary({ dryRun, pageSize, offset, migrationVersion }) {
  return {
    ok: true,
    dryRun,
    migrationVersion,
    pageSize,
    offset,
    nextOffset: offset,
    hasMore: false,
    scannedLegacyRecords: 0,
    scannedIntakes: 0,
    migratableIntakes: 0,
    created: 0,
    skippedExisting: 0,
    skippedNonFood: 0,
    skippedInactive: 0,
    warnings: []
  };
}

function dateInRange(dateKey, startDate = '', endDate = '') {
  if (!dateKey) return false;
  if (startDate && dateKey < startDate) return false;
  if (endDate && dateKey > endDate) return false;
  return true;
}

async function loadLegacyBatch({ babyUid = '', pageSize, offset }) {
  let query = db.collection(LEGACY_FEEDING_RECORDS_COLLECTION);
  if (babyUid) {
    query = query.where({ babyUid });
  }
  return query.skip(offset).limit(pageSize).get();
}

function getRecordTimestamp(record = {}) {
  const value = record.createdAt || record.migratedAt || record.updatedAt || '';
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getMigratedRecordDedupKey(record = {}) {
  if (record.migrationDedupKey) return record.migrationDedupKey;
  return buildMigrationDedupKey({
    babyUid: record.babyUid || '',
    date: record.date || '',
    mealBatchId: record.mealBatchId || '',
    foodId: record.foodId || '',
    foodName: record.foodName || record.foodSnapshot?.name || '',
    foodSnapshot: record.foodSnapshot || {},
    time: record.time || record.mealTime || resolveTimeText(record),
    recordedAt: record.recordedAt || '',
    quantity: record.quantity,
    unit: record.unit || 'g',
    sortOrder: record.sortOrder || 0
  });
}

async function loadMigratedFoodBatch({ babyUid = '', migrationVersion = DEFAULT_MIGRATION_VERSION, pageSize, offset }) {
  return db.collection(FOOD_INTAKE_RECORDS_COLLECTION)
    .where({
      ...(babyUid ? { babyUid } : {}),
      status: 'active',
      source: 'legacy_migration',
      migrationVersion
    })
    .skip(offset)
    .limit(pageSize)
    .get();
}

async function cleanupDuplicateMigratedFoodIntakes(event = {}) {
  const dryRun = event.dryRun !== false;
  const babyUid = event.babyUid || '';
  const migrationVersion = event.migrationVersion || DEFAULT_MIGRATION_VERSION;
  const startDate = event.startDate || '';
  const endDate = event.endDate || '';
  const pageSize = Number(event.pageSize) || 50;
  const offset = Number(event.offset) || 0;
  const maxBatches = Number(event.maxBatches) || 1;
  const deletedBy = event.deletedBy || 'migration_duplicate_cleanup';
  const groups = new Map();
  const summary = {
    ok: true,
    mode: 'cleanupDuplicates',
    dryRun,
    babyUid,
    migrationVersion,
    pageSize,
    offset,
    nextOffset: offset,
    hasMore: false,
    scannedRecords: 0,
    duplicateGroups: 0,
    duplicateRecords: 0,
    updated: 0,
    samples: []
  };

  let currentOffset = offset;
  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const res = await loadMigratedFoodBatch({
      babyUid,
      migrationVersion,
      pageSize,
      offset: currentOffset
    });
    const batch = res.data || [];
    if (batch.length === 0) {
      summary.hasMore = false;
      break;
    }

    batch.forEach((record) => {
      if (!dateInRange(record.date, startDate, endDate)) return;
      summary.scannedRecords += 1;
      const key = getMigratedRecordDedupKey(record);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });

    currentOffset += batch.length;
    summary.nextOffset = currentOffset;
    summary.hasMore = batch.length === pageSize;
    if (batch.length < pageSize) break;
  }

  const duplicateGroups = Array.from(groups.entries())
    .map(([key, records]) => ({
      key,
      records: [...records].sort((left, right) => {
        const timeDiff = getRecordTimestamp(left) - getRecordTimestamp(right);
        if (timeDiff !== 0) return timeDiff;
        return String(left._id || '').localeCompare(String(right._id || ''));
      })
    }))
    .filter(group => group.records.length > 1);

  summary.duplicateGroups = duplicateGroups.length;
  summary.duplicateRecords = duplicateGroups.reduce((sum, group) => sum + group.records.length - 1, 0);
  summary.samples = duplicateGroups.slice(0, 10).map(group => ({
    key: group.key,
    keepId: group.records[0]._id,
    duplicateIds: group.records.slice(1).map(record => record._id)
  }));

  if (!dryRun) {
    const timestamp = db.serverDate();
    for (const group of duplicateGroups) {
      for (const duplicate of group.records.slice(1)) {
        await db.collection(FOOD_INTAKE_RECORDS_COLLECTION).doc(duplicate._id).update({
          data: {
            status: 'deleted',
            deletedAt: timestamp,
            deletedBy,
            updatedAt: timestamp,
            duplicateCleanup: {
              keptRecordId: group.records[0]._id,
              dedupKey: group.key,
              cleanedAt: timestamp
            }
          }
        });
        summary.updated += 1;
      }
    }
  }

  return summary;
}

exports.main = async (event = {}) => {
  if (event.cleanupDuplicates === true) {
    return cleanupDuplicateMigratedFoodIntakes(event);
  }
  const dryRun = event.dryRun !== false;
  const pageSize = Number(event.pageSize) || 50;
  const offset = Number(event.offset) || 0;
  const migrationVersion = event.migrationVersion || DEFAULT_MIGRATION_VERSION;
  const maxBatches = Number(event.maxBatches) || 1;
  const startDate = event.startDate || '';
  const endDate = event.endDate || '';
  const migratedAt = db.serverDate();
  const summary = createSummary({ dryRun, pageSize, offset, migrationVersion });
  const foodIntakeCollection = db.collection(FOOD_INTAKE_RECORDS_COLLECTION);

  let currentOffset = offset;
  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const res = await loadLegacyBatch({
      babyUid: event.babyUid || '',
      pageSize,
      offset: currentOffset
    });
    const batch = res.data || [];
    if (batch.length === 0) {
      summary.hasMore = false;
      break;
    }

    for (const legacyRecord of batch) {
      const dateKey = formatDateKey(legacyRecord.date);
      if (!dateInRange(dateKey, startDate, endDate)) continue;
      summary.scannedLegacyRecords += 1;
      const intakes = Array.isArray(legacyRecord.intakes) ? legacyRecord.intakes : [];

      for (const [intakeIndex, intake] of intakes.entries()) {
        summary.scannedIntakes += 1;
        const activeState = isActiveFoodIntake(intake);
        if (!activeState.active) {
          if (activeState.reason === 'inactive') summary.skippedInactive += 1;
          if (activeState.reason === 'non_food') summary.skippedNonFood += 1;
          continue;
        }

        summary.migratableIntakes += 1;
        const intakeId = buildLegacyIntakeKey(intake, intakeIndex);
        if (!intake._id) {
          summary.warnings.push({
            type: 'missing_intake_id',
            recordId: legacyRecord._id || legacyRecord.id || '',
            intakeId
          });
        }
        const payload = buildV2FoodIntakePayloadFromLegacyIntake({
          legacyRecord,
          intake,
          intakeIndex,
          migrationVersion,
          migratedAt
        });
        const existing = await findExistingMigratedIntake({
          babyUid: legacyRecord.babyUid || intake.babyUid || '',
          recordId: legacyRecord._id || legacyRecord.id || '',
          intakeId,
          migrationVersion
        }) || await findExistingLogicalMigratedIntake({
          babyUid: payload.babyUid,
          migrationDedupKey: payload.migrationDedupKey,
          migrationVersion
        });
        if (existing) {
          summary.skippedExisting += 1;
          continue;
        }

        if (!dryRun) {
          await foodIntakeCollection.add({ data: payload });
          summary.created += 1;
        }
      }
    }

    currentOffset += batch.length;
    summary.nextOffset = currentOffset;
    summary.hasMore = batch.length === pageSize;
    if (batch.length < pageSize) break;
  }

  return summary;
};

exports._internal = {
  formatDateKey,
  normalizeNutrition,
  normalizeFoodSnapshot,
  resolveRecordedAt,
  buildMigrationDedupKey,
  buildV2FoodIntakePayloadFromLegacyIntake,
  findExistingMigratedIntake,
  cleanupDuplicateMigratedFoodIntakes
};
