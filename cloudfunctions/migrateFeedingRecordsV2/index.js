const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const LEGACY_FEEDING_RECORDS_COLLECTION = 'feeding_records';
const FEEDING_RECORDS_V2_COLLECTION = 'feeding_records_v2';
const MILK_NUTRITION_PROFILES_COLLECTION = 'milk_nutrition_profiles';

const POWDER_CATEGORIES = {
  REGULAR_FORMULA: 'regular_formula',
  SPECIAL_FORMULA: 'special_formula'
};

const PROTEIN_ROLES = {
  NATURAL: 'natural',
  SPECIAL: 'special',
  NONE: 'none'
};

function toNumber(value, fallback = 0) {
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
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  // Legacy date-only values were stored as midnight in China time.
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = `${chinaTime.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${chinaTime.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeNutrition(nutrition = {}) {
  return {
    protein: toNumber(nutrition.protein),
    calories: toNumber(nutrition.calories),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber)
  };
}

function normalizePowder(powder = {}) {
  return {
    id: powder.id || '',
    name: powder.name || '奶粉',
    category: powder.category || POWDER_CATEGORIES.REGULAR_FORMULA,
    proteinRole: powder.proteinRole || (
      powder.category === POWDER_CATEGORIES.SPECIAL_FORMULA
        ? PROTEIN_ROLES.SPECIAL
        : PROTEIN_ROLES.NATURAL
    ),
    mixRatio: {
      powder: toNumber(powder.mixRatio?.powder),
      water: toNumber(powder.mixRatio?.water)
    },
    nutritionPer100g: normalizeNutrition(powder.nutritionPer100g)
  };
}

function getActivePowders(profile = {}) {
  return (profile.formulaPowders || [])
    .filter((powder) => powder && powder.status !== 'archived')
    .map(normalizePowder);
}

function getDefaultPowder(profile = {}, category) {
  const powders = getActivePowders(profile);
  return powders.find((powder) => powder.category === category) || null;
}

function isDateInRule(date, rule = {}) {
  if (!date) return false;
  if (rule.startDate && date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  return true;
}

function resolvePowderForDate({ profile = {}, category, date, powderVersionRules = {} }) {
  const defaultPowder = getDefaultPowder(profile, category);
  const rules = Array.isArray(powderVersionRules[category])
    ? powderVersionRules[category]
    : [];
  const matchedRules = rules.filter((rule) => isDateInRule(date, rule));

  if (matchedRules.length === 1) {
    const powderId = matchedRules[0].powderId;
    const powder = getActivePowders(profile).find((item) => item.id === powderId);
    if (powder) {
      return {
        powder,
        ruleMeta: {
          matched: true,
          ruleId: matchedRules[0].id || matchedRules[0].ruleId || '',
          powderId
        },
        warning: ''
      };
    }

    return {
      powder: defaultPowder,
      ruleMeta: {
        matched: false,
        ruleId: matchedRules[0].id || matchedRules[0].ruleId || '',
        powderId,
        reason: 'powder_not_found'
      },
      warning: `规则命中的奶粉不存在：${category}/${powderId}`
    };
  }

  if (matchedRules.length > 1) {
    return {
      powder: defaultPowder,
      ruleMeta: {
        matched: false,
        reason: 'multiple_rules_matched'
      },
      warning: `命中多个奶粉版本规则：${category}/${date}`
    };
  }

  return {
    powder: defaultPowder,
    ruleMeta: {
      matched: false,
      reason: rules.length > 0 ? 'no_rule_matched' : 'no_rules'
    },
    warning: rules.length > 0 ? `未命中奶粉版本规则，已回退默认奶粉：${category}/${date}` : ''
  };
}

function calculatePowderFromWater(waterVolume, ratio = {}) {
  const waterNum = toNumber(waterVolume);
  const powder = toNumber(ratio.powder);
  const water = toNumber(ratio.water);
  if (waterNum <= 0 || powder <= 0 || water <= 0) {
    return 0;
  }
  return roundValue((waterNum * powder) / water);
}

function buildFormulaComponent(powder, waterVolume, explicitPowderWeight) {
  if (!powder || waterVolume <= 0) return null;
  const powderWeight = explicitPowderWeight > 0
    ? explicitPowderWeight
    : calculatePowderFromWater(waterVolume, powder.mixRatio);

  return {
    kind: 'formula_powder',
    powderId: powder.id,
    powderName: powder.name,
    category: powder.category,
    proteinRole: powder.proteinRole,
    waterVolume: roundValue(waterVolume),
    powderWeight: roundValue(powderWeight),
    ratioMode: explicitPowderWeight > 0 ? 'custom' : 'standard',
    mixRatioSnapshot: {
      powder: roundValue(powder.mixRatio.powder),
      water: roundValue(powder.mixRatio.water)
    },
    nutritionSnapshot: normalizeNutrition(powder.nutritionPer100g)
  };
}

function buildBreastMilkComponent(profile = {}, volume) {
  const nutrition = profile.breastMilk?.nutritionPer100ml || {};
  return {
    kind: 'breast_milk',
    volume: roundValue(volume),
    nutritionSnapshot: normalizeNutrition(nutrition)
  };
}

function getSpecialMilkVolume(feeding = {}) {
  const explicit = toNumber(feeding.specialMilkVolume, NaN);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const total = toNumber(feeding.totalVolume, NaN);
  const natural = toNumber(feeding.naturalMilkVolume);
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, total - natural);
}

function createEmptySummary() {
  return {
    totalVolume: 0,
    totalPowderWeight: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    zeroProteinCalories: 0
  };
}

function addNutrition(summary, component = {}) {
  const nutrition = normalizeNutrition(component.nutritionSnapshot);
  if (component.kind === 'breast_milk') {
    const volume = toNumber(component.volume);
    const factor = volume / 100;
    const protein = nutrition.protein * factor;
    summary.totalVolume += volume;
    summary.protein += protein;
    summary.naturalProtein += protein;
    summary.calories += nutrition.calories * factor;
    summary.fat += nutrition.fat * factor;
    summary.carbs += nutrition.carbs * factor;
    summary.fiber += nutrition.fiber * factor;
    return;
  }

  if (component.kind !== 'formula_powder') return;

  const powderWeight = toNumber(component.powderWeight);
  const factor = powderWeight / 100;
  const protein = nutrition.protein * factor;
  const calories = nutrition.calories * factor;
  summary.totalVolume += toNumber(component.waterVolume);
  summary.totalPowderWeight += powderWeight;
  summary.calories += calories;
  summary.fat += nutrition.fat * factor;
  summary.carbs += nutrition.carbs * factor;
  summary.fiber += nutrition.fiber * factor;

  if (component.proteinRole === PROTEIN_ROLES.NONE) {
    summary.zeroProteinCalories += calories;
    return;
  }

  summary.protein += protein;
  if (component.proteinRole === PROTEIN_ROLES.SPECIAL) {
    summary.specialProtein += protein;
  } else {
    summary.naturalProtein += protein;
  }
}

function buildNutritionSummary(components = []) {
  const summary = createEmptySummary();
  (components || []).forEach((component) => addNutrition(summary, component));
  return {
    totalVolume: roundValue(summary.totalVolume),
    totalPowderWeight: roundValue(summary.totalPowderWeight),
    protein: roundValue(summary.protein),
    naturalProtein: roundValue(summary.naturalProtein),
    specialProtein: roundValue(summary.specialProtein),
    calories: roundValue(summary.calories),
    fat: roundValue(summary.fat),
    carbs: roundValue(summary.carbs),
    fiber: roundValue(summary.fiber),
    zeroProteinCalories: roundValue(summary.zeroProteinCalories)
  };
}

function buildDateTime(date, timeText) {
  const dateKey = formatDateKey(date);
  if (!dateKey || !timeText) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = String(timeText).split(':').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}

function buildBasicInfoSnapshot(legacyRecord = {}) {
  const basicInfo = legacyRecord.basicInfo || {};
  return {
    weight: basicInfo.weight ?? '',
    height: basicInfo.height ?? basicInfo.length ?? '',
    naturalProteinCoefficient: basicInfo.naturalProteinCoefficient ?? basicInfo.natural_protein_coefficient ?? '',
    specialProteinCoefficient: basicInfo.specialProteinCoefficient ?? basicInfo.special_protein_coefficient ?? '',
    calorieCoefficient: basicInfo.calorieCoefficient ?? basicInfo.calorie_coefficient ?? '',
    source: 'legacy_record'
  };
}

function buildMigratedFeedingRecord({
  legacyRecord = {},
  feeding = {},
  feedingIndex = 0,
  profile = {},
  powderVersionRules = {},
  migrationVersion = 'milk-v2-migration',
  migratedAt = db.serverDate()
} = {}) {
  const date = formatDateKey(legacyRecord.date || feeding.date || '');
  const warnings = [];
  const droppedComponents = [];
  const migrationPowderRules = {};
  const formulaComponents = [];
  const naturalMilkVolume = toNumber(feeding.naturalMilkVolume);
  const naturalMilkType = feeding.naturalMilkType === 'formula' ? 'formula' : 'breast';

  if (naturalMilkVolume > 0 && naturalMilkType === 'breast') {
    formulaComponents.push(buildBreastMilkComponent(profile, naturalMilkVolume));
  }

  if (naturalMilkVolume > 0 && naturalMilkType === 'formula') {
    const regularResult = resolvePowderForDate({
      profile,
      category: POWDER_CATEGORIES.REGULAR_FORMULA,
      date,
      powderVersionRules
    });
    migrationPowderRules[POWDER_CATEGORIES.REGULAR_FORMULA] = regularResult.ruleMeta;
    if (regularResult.warning) warnings.push(regularResult.warning);
    const component = buildFormulaComponent(
      regularResult.powder,
      naturalMilkVolume,
      toNumber(feeding.formulaPowderWeight)
    );
    if (component) {
      formulaComponents.push(component);
    } else {
      // 没有可用的普奶档案：绝不静默丢弃，记录丢失量并告警，便于修档案后排查。
      droppedComponents.push({
        category: POWDER_CATEGORIES.REGULAR_FORMULA,
        waterVolume: roundValue(naturalMilkVolume),
        reason: 'missing_powder_profile'
      });
      warnings.push(`缺少普奶档案，未迁移普奶组件（约 ${roundValue(naturalMilkVolume)}ml）：${date}`);
    }
  }

  const specialMilkVolume = getSpecialMilkVolume(feeding);
  if (specialMilkVolume > 0) {
    const specialResult = resolvePowderForDate({
      profile,
      category: POWDER_CATEGORIES.SPECIAL_FORMULA,
      date,
      powderVersionRules
    });
    migrationPowderRules[POWDER_CATEGORIES.SPECIAL_FORMULA] = specialResult.ruleMeta;
    if (specialResult.warning) warnings.push(specialResult.warning);
    const component = buildFormulaComponent(
      specialResult.powder,
      specialMilkVolume,
      toNumber(feeding.specialMilkPowder || feeding.specialPowderWeight)
    );
    if (component) {
      formulaComponents.push(component);
    } else {
      // 没有可用的特奶档案：绝不静默丢弃，记录丢失量并告警。
      droppedComponents.push({
        category: POWDER_CATEGORIES.SPECIAL_FORMULA,
        waterVolume: roundValue(specialMilkVolume),
        reason: 'missing_powder_profile'
      });
      warnings.push(`缺少特奶档案，未迁移特奶组件（约 ${roundValue(specialMilkVolume)}ml）：${date}`);
    }
  }

  const matchedRule = Object.values(migrationPowderRules).some((rule) => rule?.matched === true);
  const nutritionAccuracy = matchedRule
    ? 'matched_powder_version_rule'
    : 'estimated_current_profile';

  return {
    schemaVersion: 1,
    recordType: 'milk_feeding',
    source: 'legacy_migration',
    babyUid: legacyRecord.babyUid || feeding.babyUid || '',
    date,
    startTime: feeding.startTime || '',
    endTime: feeding.endTime || '',
    startDateTime: buildDateTime(date, feeding.startTime),
    endDateTime: buildDateTime(date, feeding.endTime),
    formulaComponents,
    nutritionSummary: buildNutritionSummary(formulaComponents),
    basicInfoSnapshot: buildBasicInfoSnapshot(legacyRecord),
    notes: feeding.notes || '',
    status: 'active',
    legacyRecordId: legacyRecord._id || legacyRecord.id || '',
    legacyFeedingIndex: feedingIndex,
    migrationVersion,
    migratedAt,
    nutritionAccuracy,
    migrationPowderRules,
    migrationWarnings: warnings,
    migrationDroppedComponents: droppedComponents,
    createdAt: migratedAt,
    updatedAt: migratedAt,
    deletedAt: null
  };
}

async function queryExistingMigratedRecordsForLegacyDay({ babyUid, legacyRecordId, migrationVersion }) {
  const res = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
    .where({
      babyUid,
      source: 'legacy_migration',
      legacyRecordId,
      migrationVersion
    })
    .get();
  return new Set(
    (res.data || [])
      .map((record) => Number(record.legacyFeedingIndex))
      .filter((index) => Number.isInteger(index) && index >= 0)
  );
}

async function getNutritionProfile(babyUid) {
  const res = await db.collection(MILK_NUTRITION_PROFILES_COLLECTION)
    .where({ babyUid })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

function buildDateRangeCondition(dbCommand, startDate, endDate) {
  if (startDate && endDate && dbCommand?.gte && dbCommand?.lte) {
    return dbCommand.gte(startDate).and(dbCommand.lte(endDate));
  }
  if (startDate && dbCommand?.gte) {
    return dbCommand.gte(startDate);
  }
  if (endDate && dbCommand?.lte) {
    return dbCommand.lte(endDate);
  }
  return null;
}

async function getLegacyFeedingBatch({ babyUid, pageSize, offset, startDate, endDate }) {
  let query = db.collection(LEGACY_FEEDING_RECORDS_COLLECTION);
  const where = {};
  if (babyUid) {
    where.babyUid = babyUid;
  }
  const dateRange = buildDateRangeCondition(db.command, startDate, endDate);
  if (dateRange) {
    where.date = dateRange;
  }
  if (Object.keys(where).length > 0) {
    query = query.where(where);
  }
  return query.skip(offset).limit(pageSize).get();
}

async function repairExistingMigratedDates(event = {}) {
  const dryRun = event.dryRun !== false;
  const babyUid = event.babyUid || '';
  const pageSize = Number(event.pageSize) > 0 ? Number(event.pageSize) : 50;
  const offsetStart = Number(event.offset) >= 0 ? Number(event.offset) : 0;
  const maxBatches = Number(event.maxBatches) > 0 ? Number(event.maxBatches) : 0;
  const startDate = event.startDate || '';
  const endDate = event.endDate || '';
  const migrationVersion = event.migrationVersion || 'milk-v2-migration';
  const repairedAt = db.serverDate();
  let offset = offsetStart;
  let processedBatches = 0;
  let hasMore = false;
  let checked = 0;
  let repaired = 0;
  let skipped = 0;
  const warnings = [];
  const errors = [];

  while (true) {
    if (maxBatches > 0 && processedBatches >= maxBatches) {
      hasMore = true;
      break;
    }

    const res = await getLegacyFeedingBatch({
      babyUid,
      pageSize,
      offset,
      startDate,
      endDate
    });
    const batch = res.data || [];
    if (batch.length === 0) break;
    processedBatches++;

    for (const legacyRecord of batch) {
      const recordBabyUid = legacyRecord.babyUid;
      const legacyRecordId = legacyRecord._id || legacyRecord.id || '';
      const dateKey = formatDateKey(legacyRecord.date);
      if (!recordBabyUid || !legacyRecordId || !dateKey) {
        skipped++;
        warnings.push({ legacyRecordId, reason: 'missing_repair_key' });
        continue;
      }

      try {
        const migratedRes = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
          .where({
            babyUid: recordBabyUid,
            source: 'legacy_migration',
            legacyRecordId,
            migrationVersion
          })
          .get();

        const migratedRecords = migratedRes.data || [];
        checked += migratedRecords.length;

        for (const migratedRecord of migratedRecords) {
          if (migratedRecord.date === dateKey) {
            skipped++;
            continue;
          }

          repaired++;
          if (!dryRun) {
            await db.collection(FEEDING_RECORDS_V2_COLLECTION).doc(migratedRecord._id).update({
              data: {
                date: dateKey,
                startDateTime: buildDateTime(dateKey, migratedRecord.startTime),
                endDateTime: buildDateTime(dateKey, migratedRecord.endTime),
                dateRepairedAt: repairedAt,
                updatedAt: repairedAt
              }
            });
          }
        }
      } catch (error) {
        errors.push({
          babyUid: recordBabyUid,
          legacyRecordId,
          message: error.message || String(error)
        });
      }
    }

    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  return {
    mode: 'repairExistingDates',
    dryRun,
    babyUid,
    startDate,
    endDate,
    migrationVersion,
    offset: offsetStart,
    nextOffset: offset,
    pageSize,
    maxBatches,
    processedBatches,
    hasMore,
    checked,
    repaired,
    skipped,
    warnings,
    errors
  };
}

// 只读诊断：盘清已迁移数据现状，决定如何对齐到新默认版本号。
async function inspectMigration(event = {}) {
  const babyUid = event.babyUid || '';
  const targetDefaultVersion = event.toVersion || 'milk-v2';
  const $ = db.command.aggregate;
  const baseMatch = babyUid ? { babyUid } : {};

  const versionAgg = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
    .aggregate()
    .match({ ...baseMatch, source: 'legacy_migration' })
    .group({ _id: '$migrationVersion', count: $.sum(1) })
    .end();
  const versionCounts = (versionAgg.list || [])
    .map((item) => ({ migrationVersion: item._id, count: item.count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0));

  const dupAgg = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
    .aggregate()
    .match({ ...baseMatch, source: 'legacy_migration' })
    .group({
      _id: {
        babyUid: '$babyUid',
        legacyRecordId: '$legacyRecordId',
        legacyFeedingIndex: '$legacyFeedingIndex'
      },
      count: $.sum(1)
    })
    .match({ count: db.command.gt(1) })
    .end();
  const duplicateGroups = (dupAgg.list || []).length;
  const duplicateSamples = (dupAgg.list || []).slice(0, 10);

  const nonMigrationRes = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
    .where({ ...baseMatch, source: db.command.neq('legacy_migration') })
    .count();
  const totalRes = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
    .where(baseMatch)
    .count();
  const migrationTotal = versionCounts.reduce((sum, item) => sum + (item.count || 0), 0);

  return {
    mode: 'inspect',
    babyUid,
    targetDefaultVersion,
    totalV2: totalRes.total,
    migrationTotal,
    nonMigrationTotal: nonMigrationRes.total,
    versionCounts,
    duplicateGroups,
    duplicateSamples
  };
}

// 边改/删边收敛的批处理：execute 始终取匹配集前 pageSize 条（skip 0），dry-run 用 offset 翻页统计。
async function runMutationBatches({ where, dryRun, pageSize, maxBatches, offsetStart, mutate }) {
  let offset = Number(offsetStart) >= 0 ? Number(offsetStart) : 0;
  let processedBatches = 0;
  let hasMore = false;
  let matched = 0;
  let mutated = 0;
  const errors = [];

  while (true) {
    if (maxBatches > 0 && processedBatches >= maxBatches) {
      hasMore = true;
      break;
    }
    const res = await db.collection(FEEDING_RECORDS_V2_COLLECTION)
      .where(where)
      .skip(dryRun ? offset : 0)
      .limit(pageSize)
      .get();
    const batch = res.data || [];
    if (batch.length === 0) break;
    processedBatches++;
    matched += batch.length;

    if (!dryRun) {
      const before = mutated;
      for (const record of batch) {
        try {
          await mutate(record);
          mutated++;
        } catch (error) {
          errors.push({ recordId: record._id, message: error.message || String(error) });
        }
      }
      if (mutated === before) {
        // 整批都没改成功：避免 skip 0 模式下死循环
        break;
      }
    } else {
      offset += pageSize;
    }

    if (batch.length < pageSize) break;
  }

  return {
    processedBatches,
    hasMore,
    matched,
    mutated,
    errors,
    nextOffset: dryRun ? offset : 0
  };
}

// 把旧版本号的迁移记录统一改成目标版本号（默认 milk-v2），让后续增量用固定默认值即可幂等。
async function realignMigrationVersion(event = {}) {
  const dryRun = event.dryRun !== false;
  const babyUid = event.babyUid || '';
  const toVersion = event.toVersion || 'milk-v2';
  const fromVersions = Array.isArray(event.fromVersions) ? event.fromVersions.filter(Boolean) : [];
  const pageSize = Number(event.pageSize) > 0 ? Number(event.pageSize) : 50;
  const maxBatches = Number(event.maxBatches) > 0 ? Number(event.maxBatches) : 1;
  const updatedAt = db.serverDate();

  const where = { source: 'legacy_migration' };
  if (babyUid) where.babyUid = babyUid;
  where.migrationVersion = fromVersions.length > 0
    ? db.command.in(fromVersions)
    : db.command.neq(toVersion);

  const result = await runMutationBatches({
    where,
    dryRun,
    pageSize,
    maxBatches,
    offsetStart: event.offset,
    mutate: (record) => db.collection(FEEDING_RECORDS_V2_COLLECTION).doc(record._id).update({
      data: {
        migrationVersion: toVersion,
        versionRealignedFrom: record.migrationVersion,
        versionRealignedAt: updatedAt,
        updatedAt
      }
    })
  });

  return {
    mode: 'realignVersion',
    dryRun,
    babyUid,
    toVersion,
    fromVersions: fromVersions.length > 0 ? fromVersions : 'ALL_NON_TARGET',
    pageSize,
    maxBatches,
    processedBatches: result.processedBatches,
    hasMore: result.hasMore,
    matched: result.matched,
    updated: result.mutated,
    nextOffset: result.nextOffset,
    errors: result.errors
  };
}

// 删除迁移记录（仅 source:'legacy_migration'），用于「清空后用新版本号重迁」路线。绝不动用户新建记录。
async function cleanupMigratedRecords(event = {}) {
  const dryRun = event.dryRun !== false;
  const babyUid = event.babyUid || '';
  const versions = Array.isArray(event.migrationVersions) ? event.migrationVersions.filter(Boolean) : [];
  const pageSize = Number(event.pageSize) > 0 ? Number(event.pageSize) : 50;
  const maxBatches = Number(event.maxBatches) > 0 ? Number(event.maxBatches) : 1;

  const where = { source: 'legacy_migration' };
  if (babyUid) where.babyUid = babyUid;
  if (versions.length > 0) {
    where.migrationVersion = db.command.in(versions);
  }

  const result = await runMutationBatches({
    where,
    dryRun,
    pageSize,
    maxBatches,
    offsetStart: event.offset,
    mutate: (record) => db.collection(FEEDING_RECORDS_V2_COLLECTION).doc(record._id).remove()
  });

  return {
    mode: 'cleanupMigrated',
    dryRun,
    babyUid,
    migrationVersions: versions.length > 0 ? versions : 'ALL_LEGACY_MIGRATION',
    pageSize,
    maxBatches,
    processedBatches: result.processedBatches,
    hasMore: result.hasMore,
    matched: result.matched,
    removed: result.mutated,
    nextOffset: result.nextOffset,
    errors: result.errors
  };
}

exports.main = async (event = {}) => {
  if (event.inspect === true) {
    return inspectMigration(event);
  }
  if (event.realignVersion === true) {
    return realignMigrationVersion(event);
  }
  if (event.cleanupMigrated === true) {
    return cleanupMigratedRecords(event);
  }
  if (event.repairExistingDates === true) {
    return repairExistingMigratedDates(event);
  }

  const dryRun = event.dryRun === true;
  const babyUid = event.babyUid || '';
  const pageSize = Number(event.pageSize) > 0 ? Number(event.pageSize) : 50;
  const offsetStart = Number(event.offset) >= 0 ? Number(event.offset) : 0;
  const maxBatches = Number(event.maxBatches) > 0 ? Number(event.maxBatches) : 0;
  const startDate = event.startDate || '';
  const endDate = event.endDate || '';
  const migrationVersion = event.migrationVersion || 'milk-v2-migration';
  const powderVersionRules = event.powderVersionRules || {};
  const migratedAt = db.serverDate();
  let offset = offsetStart;
  let processedBatches = 0;
  let hasMore = false;
  let migrated = 0;
  let skipped = 0;
  let existingSkipped = 0;
  const errors = [];
  const warnings = [];
  const profileCache = {};

  while (true) {
    if (maxBatches > 0 && processedBatches >= maxBatches) {
      hasMore = true;
      break;
    }

    const res = await getLegacyFeedingBatch({
      babyUid,
      pageSize,
      offset,
      startDate,
      endDate
    });
    const batch = res.data || [];
    if (batch.length === 0) break;
    processedBatches++;

    for (const legacyRecord of batch) {
      const recordBabyUid = legacyRecord.babyUid;
      if (!recordBabyUid) {
        skipped++;
        warnings.push({ legacyRecordId: legacyRecord._id || '', reason: 'missing_babyUid' });
        continue;
      }

      const feedings = Array.isArray(legacyRecord.feedings) ? legacyRecord.feedings : [];
      if (feedings.length === 0) {
        skipped++;
        continue;
      }

      if (!profileCache[recordBabyUid]) {
        profileCache[recordBabyUid] = await getNutritionProfile(recordBabyUid);
      }
      const profile = profileCache[recordBabyUid];
      if (!profile) {
        skipped += feedings.length;
        warnings.push({ babyUid: recordBabyUid, reason: 'missing_milk_nutrition_profile' });
        continue;
      }

      let existingMigratedIndices = new Set();
      if (!dryRun) {
        existingMigratedIndices = await queryExistingMigratedRecordsForLegacyDay({
          babyUid: recordBabyUid,
          legacyRecordId: legacyRecord._id || legacyRecord.id || '',
          migrationVersion
        });
      }

      for (let index = 0; index < feedings.length; index += 1) {
        const feeding = feedings[index];
        if (!feeding || feeding.isTemporary) {
          skipped++;
          continue;
        }

        if (existingMigratedIndices.has(index)) {
          existingSkipped++;
          continue;
        }

        try {
          const migratedRecord = buildMigratedFeedingRecord({
            legacyRecord,
            feeding,
            feedingIndex: index,
            profile,
            powderVersionRules,
            migrationVersion,
            migratedAt
          });

          if (migratedRecord.formulaComponents.length === 0) {
            skipped++;
            warnings.push({
              babyUid: recordBabyUid,
              legacyRecordId: migratedRecord.legacyRecordId,
              legacyFeedingIndex: index,
              reason: 'empty_formula_components'
            });
            continue;
          }

          if (!dryRun) {
            await db.collection(FEEDING_RECORDS_V2_COLLECTION).add({
              data: migratedRecord
            });
          }

          migrated++;
          if (migratedRecord.migrationWarnings.length > 0) {
            warnings.push({
              babyUid: recordBabyUid,
              legacyRecordId: migratedRecord.legacyRecordId,
              legacyFeedingIndex: index,
              warnings: migratedRecord.migrationWarnings
            });
          }
        } catch (error) {
          errors.push({
            babyUid: recordBabyUid,
            legacyRecordId: legacyRecord._id || '',
            legacyFeedingIndex: index,
            message: error.message || String(error)
          });
        }
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
    migrationVersion,
    offset: offsetStart,
    nextOffset: offset,
    pageSize,
    maxBatches,
    processedBatches,
    hasMore,
    migrated,
    skipped,
    existingSkipped,
    warnings,
    errors
  };
};

exports._internal = {
  buildMigratedFeedingRecord,
  resolvePowderForDate,
  formatDateKey,
  buildNutritionSummary
};
