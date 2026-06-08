const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MILK_NUTRITION_PROFILES_COLLECTION = 'milk_nutrition_profiles';
const POWDER_STATUSES = {
  ACTIVE: 'active',
  ARCHIVED: 'archived'
};

const DEFAULT_BREAST_MILK_NUTRITION_PER_100ML = {
  protein: 1.1,
  calories: 67,
  fat: 4,
  carbs: 6.8,
  fiber: 0
};

function toNumberOrEmpty(value) {
  if (value === '' || value === undefined || value === null) {
    return '';
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : '';
}

function toNumberOrDefault(value, fallback) {
  const normalized = toNumberOrEmpty(value);
  return normalized === '' ? fallback : normalized;
}

function hasValue(value) {
  return value !== '' && value !== undefined && value !== null;
}

function normalizeRatio(settings = {}, key) {
  const ratio = settings[`${key}_ratio`] || {};
  return {
    powder: toNumberOrEmpty(ratio.powder ?? settings[`${key}_ratio_powder`]),
    water: toNumberOrEmpty(ratio.water ?? settings[`${key}_ratio_water`])
  };
}

function buildLegacyPowder(settings = {}, type, timestamp) {
  const prefix = type === 'special' ? 'special_milk' : 'formula_milk';
  const ratio = normalizeRatio(settings, prefix);
  const nutritionPer100g = {
    protein: toNumberOrEmpty(settings[`${prefix}_protein`]),
    calories: toNumberOrEmpty(settings[`${prefix}_calories`]),
    fat: toNumberOrEmpty(settings[`${prefix}_fat`]),
    carbs: toNumberOrEmpty(settings[`${prefix}_carbs`]),
    fiber: toNumberOrEmpty(settings[`${prefix}_fiber`])
  };
  const hasNutrition = Object.values(nutritionPer100g).some(hasValue);
  const hasRatio = hasValue(ratio.powder) || hasValue(ratio.water);

  if (!hasNutrition && !hasRatio) {
    return null;
  }

  if (type === 'special') {
    return {
      id: 'legacy_special_formula',
      name: '特奶',
      category: 'special_formula',
      proteinRole: 'special',
      nutritionPer100g,
      mixRatio: ratio,
      status: 'active',
      source: 'legacy',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    };
  }

  return {
    id: 'legacy_regular_formula',
    name: '普奶',
    category: 'regular_formula',
    proteinRole: 'natural',
    nutritionPer100g,
    mixRatio: ratio,
    status: 'active',
    source: 'legacy',
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  };
}

function normalizePowder(powder = {}, index = 0, timestamp) {
  const nutrition = powder.nutritionPer100g || {};
  const ratio = powder.mixRatio || {};
  const status = powder.status === POWDER_STATUSES.ARCHIVED
    ? POWDER_STATUSES.ARCHIVED
    : POWDER_STATUSES.ACTIVE;
  return {
    id: powder.id || `formula_powder_${index + 1}`,
    name: powder.name || '未命名配方粉',
    category: powder.category || 'regular_formula',
    proteinRole: powder.proteinRole || (powder.category === 'special_formula' ? 'special' : 'natural'),
    nutritionPer100g: {
      protein: toNumberOrEmpty(nutrition.protein),
      calories: toNumberOrEmpty(nutrition.calories),
      fat: toNumberOrEmpty(nutrition.fat),
      carbs: toNumberOrEmpty(nutrition.carbs),
      fiber: toNumberOrEmpty(nutrition.fiber)
    },
    mixRatio: {
      powder: toNumberOrEmpty(ratio.powder),
      water: toNumberOrEmpty(ratio.water)
    },
    status,
    source: powder.source || 'user',
    createdAt: powder.createdAt || timestamp,
    updatedAt: powder.updatedAt || timestamp,
    deletedAt: status === POWDER_STATUSES.ACTIVE ? null : (powder.deletedAt || timestamp)
  };
}

function buildFormulaPowders(settings = {}, timestamp) {
  if (Array.isArray(settings.formulaPowders) && settings.formulaPowders.length > 0) {
    return settings.formulaPowders.map((powder, index) => normalizePowder(powder, index, timestamp));
  }

  return [
    buildLegacyPowder(settings, 'regular', timestamp),
    buildLegacyPowder(settings, 'special', timestamp)
  ].filter(Boolean);
}

function buildProfileData(babyUid, settings = {}) {
  const timestamp = db.serverDate();
  return {
    babyUid,
    schemaVersion: 1,
    breastMilk: {
      nutritionPer100ml: {
        protein: toNumberOrDefault(settings.natural_milk_protein, DEFAULT_BREAST_MILK_NUTRITION_PER_100ML.protein),
        calories: toNumberOrDefault(settings.natural_milk_calories, DEFAULT_BREAST_MILK_NUTRITION_PER_100ML.calories),
        fat: toNumberOrDefault(settings.natural_milk_fat, DEFAULT_BREAST_MILK_NUTRITION_PER_100ML.fat),
        carbs: toNumberOrDefault(settings.natural_milk_carbs, DEFAULT_BREAST_MILK_NUTRITION_PER_100ML.carbs),
        fiber: toNumberOrDefault(settings.natural_milk_fiber, DEFAULT_BREAST_MILK_NUTRITION_PER_100ML.fiber)
      }
    },
    formulaPowders: buildFormulaPowders(settings, timestamp),
    migrationSource: 'legacy_nutrition_settings',
    updatedAt: timestamp
  };
}

function mergeSettings(babySettings = {}, compatSettings = {}) {
  return {
    ...babySettings,
    ...compatSettings
  };
}

function hasSettingsData(settings = {}) {
  return Object.keys(settings).some((key) => {
    if (key === '_id' || key === 'babyUid' || key === 'createdAt' || key === 'updatedAt') {
      return false;
    }
    return hasValue(settings[key]);
  });
}

function getBabyInfoBatch({ babyUid, pageSize, offset }) {
  let query = db.collection('baby_info');
  if (babyUid) {
    query = query.where({ babyUid });
  }
  return query.skip(offset).limit(pageSize).get();
}

exports.main = async (event = {}) => {
  const dryRun = event.dryRun === true;
  const targetBabyUid = event.babyUid || '';
  const pageSize = Number(event.pageSize) > 0 ? Number(event.pageSize) : 50;
  const offsetStart = Number(event.offset) >= 0 ? Number(event.offset) : 0;
  const maxBatches = Number(event.maxBatches) > 0 ? Number(event.maxBatches) : 0;
  let offset = offsetStart;
  let processedBatches = 0;
  let hasMore = false;
  let migrated = 0;
  let skipped = 0;
  const logs = [];

  while (true) {
    if (maxBatches > 0 && processedBatches >= maxBatches) {
      hasMore = true;
      break;
    }

    const res = await getBabyInfoBatch({
      babyUid: targetBabyUid,
      pageSize,
      offset
    });
    const batch = res.data || [];
    if (batch.length === 0) break;
    processedBatches++;

    for (const babyDoc of batch) {
      const babyUid = babyDoc.babyUid;
      if (!babyUid) {
        skipped++;
        continue;
      }

      const compatRes = await db.collection('nutrition_settings').where({ babyUid }).limit(1).get();
      const compatDoc = compatRes.data && compatRes.data[0];
      const settings = mergeSettings(babyDoc.nutritionSettings || {}, compatDoc || {});

      if (!hasSettingsData(settings)) {
        skipped++;
        continue;
      }

      const profileData = buildProfileData(babyUid, settings);
      const existing = await db.collection(MILK_NUTRITION_PROFILES_COLLECTION).where({ babyUid }).limit(1).get();

      if (!dryRun) {
        if (existing.data && existing.data.length > 0) {
          await db.collection(MILK_NUTRITION_PROFILES_COLLECTION).doc(existing.data[0]._id).update({
            data: profileData
          });
        } else {
          await db.collection(MILK_NUTRITION_PROFILES_COLLECTION).add({
            data: {
              ...profileData,
              createdAt: profileData.updatedAt
            }
          });
        }
      }

      migrated++;
      logs.push(`${dryRun ? 'dry-run' : 'migrated'} milk nutrition profile for ${babyUid}`);
    }

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return {
    migrated,
    skipped,
    dryRun,
    babyUid: targetBabyUid,
    offset: offsetStart,
    nextOffset: offset,
    pageSize,
    maxBatches,
    processedBatches,
    hasMore,
    logs
  };
};
