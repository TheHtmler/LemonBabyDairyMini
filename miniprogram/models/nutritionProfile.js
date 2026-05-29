// 新版配奶营养档案模型：milk_nutrition_profiles 是配奶设置的主数据源
const {
  POWDER_CATEGORIES,
  POWDER_STATUSES,
  normalizeFormulaPowders,
  createLegacyFormulaPowders
} = require('../utils/formulaPowderUtils');

const db = wx.cloud.database();
const milkNutritionProfileCollection = db.collection('milk_nutrition_profiles');
const babyInfoCollection = db.collection('baby_info');
const nutritionSettingsCollection = db.collection('nutrition_settings');

function toNumberOrEmpty(value) {
  if (value === '' || value === undefined || value === null) {
    return '';
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : '';
}

function nutritionPer100mlFromSettings(settings = {}) {
  return {
    protein: toNumberOrEmpty(settings.natural_milk_protein),
    calories: toNumberOrEmpty(settings.natural_milk_calories),
    fat: toNumberOrEmpty(settings.natural_milk_fat),
    carbs: toNumberOrEmpty(settings.natural_milk_carbs),
    fiber: toNumberOrEmpty(settings.natural_milk_fiber)
  };
}

function createEmptyLegacySettings() {
  return {
    natural_milk_protein: '',
    natural_milk_calories: '',
    natural_milk_fat: '',
    natural_milk_carbs: '',
    natural_milk_fiber: '',
    formula_milk_protein: '',
    formula_milk_calories: '',
    formula_milk_fat: '',
    formula_milk_carbs: '',
    formula_milk_fiber: '',
    formula_milk_ratio: {
      powder: '',
      water: ''
    },
    special_milk_protein: '',
    special_milk_calories: '',
    special_milk_fat: '',
    special_milk_carbs: '',
    special_milk_fiber: '',
    special_milk_ratio: {
      powder: '',
      water: ''
    },
    formulaPowders: [],
    mixingPlans: [],
    activeMixingPlanId: ''
  };
}

function mergeLegacySettings(babySettings = {}, compatSettings = {}) {
  return {
    ...babySettings,
    ...compatSettings
  };
}

function hasLegacySettingsData(settings = {}) {
  return Object.keys(settings).some((key) => {
    if (key === '_id' || key === 'babyUid' || key === 'createdAt' || key === 'updatedAt') {
      return false;
    }
    const value = settings[key];
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (value && typeof value === 'object') {
      return Object.keys(value).length > 0;
    }
    return value !== '' && value !== undefined && value !== null;
  });
}

function getTimeValue(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function countActivePowders(doc = {}) {
  return (Array.isArray(doc.formulaPowders) ? doc.formulaPowders : [])
    .filter((powder) => powder && powder.status !== POWDER_STATUSES.ARCHIVED)
    .length;
}

function sortDocumentsByFreshness(documents = []) {
  return [...documents].sort((left, right) => {
    const rightUpdatedAt = getTimeValue(right?.updatedAt);
    const leftUpdatedAt = getTimeValue(left?.updatedAt);
    if (rightUpdatedAt !== leftUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }
    const rightCreatedAt = getTimeValue(right?.createdAt);
    const leftCreatedAt = getTimeValue(left?.createdAt);
    if (rightCreatedAt !== leftCreatedAt) {
      return rightCreatedAt - leftCreatedAt;
    }
    // 时间戳相同时，优先保留有效奶粉更多的那份，避免选到空/残缺副本
    return countActivePowders(right) - countActivePowders(left);
  });
}

// 以 babyUid 取出该宝宝的所有配奶档案，按新鲜度排序（最新在前）。
async function getDocumentsByFreshness(collection, babyUid) {
  const res = await collection.where({ babyUid }).get();
  return sortDocumentsByFreshness(res.data || []);
}

async function getFirstDocument(collection, babyUid, debugName = 'collection') {
  const documents = await getDocumentsByFreshness(collection, babyUid);
  const selected = documents[0];
  console.info(`[NutritionProfile] ${debugName} query`, {
    babyUid,
    count: documents.length,
    selectedId: selected?._id || '',
    selectedUpdatedAt: selected?.updatedAt || null,
    selectedCreatedAt: selected?.createdAt || null,
    selectedPowderCount: Array.isArray(selected?.formulaPowders) ? selected.formulaPowders.length : undefined
  });
  return selected;
}

function applyPowderToLegacyFields(settings, prefix, powder) {
  if (!powder) return;
  const nutrition = powder.nutritionPer100g || {};
  const ratio = powder.mixRatio || {};
  settings[`${prefix}_protein`] = toNumberOrEmpty(nutrition.protein);
  settings[`${prefix}_calories`] = toNumberOrEmpty(nutrition.calories);
  settings[`${prefix}_fat`] = toNumberOrEmpty(nutrition.fat);
  settings[`${prefix}_carbs`] = toNumberOrEmpty(nutrition.carbs);
  settings[`${prefix}_fiber`] = toNumberOrEmpty(nutrition.fiber);
  settings[`${prefix}_ratio`] = {
    powder: toNumberOrEmpty(ratio.powder),
    water: toNumberOrEmpty(ratio.water)
  };
}

function withPowderLifecycle(powder, timestamp) {
  const status = powder.status === POWDER_STATUSES.ARCHIVED
    ? POWDER_STATUSES.ARCHIVED
    : POWDER_STATUSES.ACTIVE;
  return {
    ...powder,
    status,
    createdAt: powder.createdAt || timestamp,
    updatedAt: powder.updatedAt || timestamp,
    deletedAt: status === POWDER_STATUSES.ACTIVE ? null : (powder.deletedAt || timestamp)
  };
}

class MilkNutritionProfileModel {
  buildProfileDataFromSettings(babyUid, settings = {}) {
    const timestamp = db.serverDate();
    const explicitPowders = normalizeFormulaPowders(settings.formulaPowders || []);
    const formulaPowders = explicitPowders.length > 0
      ? explicitPowders
      : createLegacyFormulaPowders(settings);

    return {
      babyUid,
      schemaVersion: 1,
      breastMilk: {
        nutritionPer100ml: nutritionPer100mlFromSettings(settings)
      },
      formulaPowders: formulaPowders.map((powder) => withPowderLifecycle(powder, timestamp)),
      updatedAt: timestamp
    };
  }

  profileDocumentToNutritionSettings(profile = {}) {
    const settings = createEmptyLegacySettings();
    const breastNutrition = profile.breastMilk?.nutritionPer100ml || {};
    const powders = normalizeFormulaPowders(profile.formulaPowders || []);
    const regularPowder = powders.find((powder) => (
      powder.status === POWDER_STATUSES.ACTIVE &&
      powder.category === POWDER_CATEGORIES.REGULAR_FORMULA
    )) || powders.find((powder) => powder.category === POWDER_CATEGORIES.REGULAR_FORMULA);
    const specialPowder = powders.find((powder) => (
      powder.status === POWDER_STATUSES.ACTIVE &&
      powder.category === POWDER_CATEGORIES.SPECIAL_FORMULA
    )) || powders.find((powder) => powder.category === POWDER_CATEGORIES.SPECIAL_FORMULA);

    settings.natural_milk_protein = toNumberOrEmpty(breastNutrition.protein);
    settings.natural_milk_calories = toNumberOrEmpty(breastNutrition.calories);
    settings.natural_milk_fat = toNumberOrEmpty(breastNutrition.fat);
    settings.natural_milk_carbs = toNumberOrEmpty(breastNutrition.carbs);
    settings.natural_milk_fiber = toNumberOrEmpty(breastNutrition.fiber);
    settings.formulaPowders = powders;
    applyPowderToLegacyFields(settings, 'formula_milk', regularPowder);
    applyPowderToLegacyFields(settings, 'special_milk', specialPowder);

    return settings;
  }

  async getNutritionProfileSettings(babyUid, options = {}) {
    try {
      const includeLegacyFallback = options.includeLegacyFallback === true;
      const throwOnError = options.throwOnError === true;
      console.info('[NutritionProfile] getNutritionProfileSettings start', {
        babyUid,
        includeLegacyFallback,
        throwOnError
      });
      const profile = await getFirstDocument(milkNutritionProfileCollection, babyUid, 'milk_nutrition_profiles');
      if (profile) {
        const settings = this.profileDocumentToNutritionSettings(profile);
        console.info('[NutritionProfile] getNutritionProfileSettings hit v2 profile', {
          babyUid,
          profileId: profile._id || '',
          powderCount: settings.formulaPowders.length
        });
        return settings;
      }

      if (!includeLegacyFallback) {
        console.warn('[NutritionProfile] getNutritionProfileSettings no v2 profile and fallback disabled', {
          babyUid
        });
        return null;
      }

      const [babyRes, compatRes] = await Promise.all([
        getFirstDocument(babyInfoCollection, babyUid, 'baby_info'),
        getFirstDocument(nutritionSettingsCollection, babyUid, 'nutrition_settings')
      ]);
      const legacySettings = mergeLegacySettings(babyRes?.nutritionSettings || {}, compatRes || {});

      if (!hasLegacySettingsData(legacySettings)) {
        return null;
      }

      return this.profileDocumentToNutritionSettings(
        this.buildProfileDataFromSettings(babyUid, legacySettings)
      );
    } catch (error) {
      console.error('获取新版配奶营养档案失败：', error);
      if (options.throwOnError === true) {
        throw error;
      }
      return null;
    }
  }

  async updateNutritionProfileSettings(babyUid, settings) {
    try {
      const data = this.buildProfileDataFromSettings(babyUid, settings);
      console.info('[NutritionProfile] updateNutritionProfileSettings start', {
        babyUid,
        powderCount: data.formulaPowders.length,
        powderIds: data.formulaPowders.map((powder) => powder.id)
      });

      // 配奶档案以 babyUid 为准：所有绑定该宝宝的监护人（创建者/参与者）读写同一份文档。
      const documents = await getDocumentsByFreshness(milkNutritionProfileCollection, babyUid);

      if (documents.length === 0) {
        const addRes = await milkNutritionProfileCollection.add({
          data: {
            ...data,
            createdAt: db.serverDate()
          }
        });
        console.info('[NutritionProfile] add profile result', {
          babyUid,
          result: addRes
        });
        if (!addRes?._id) {
          throw new Error('milk_nutrition_profiles add did not return _id');
        }
        return true;
      }

      // 始终写入唯一的权威文档（最新那份），无论它由创建者还是参与者建立。
      const canonical = documents[0];
      const updateRes = await milkNutritionProfileCollection.doc(canonical._id).update({
        data
      });
      console.info('[NutritionProfile] update canonical profile result', {
        babyUid,
        profileId: canonical._id,
        duplicateCount: documents.length - 1,
        result: updateRes
      });

      // 合并去重：删除该 babyUid 下的其它历史/分裂副本，确保只剩一份共享档案，
      // 避免不同监护人各读各的副本导致“看不到对方最新配奶”。
      const duplicates = documents.slice(1);
      for (const duplicate of duplicates) {
        try {
          await milkNutritionProfileCollection.doc(duplicate._id).remove();
          console.info('[NutritionProfile] removed duplicate profile', {
            babyUid,
            removedId: duplicate._id
          });
        } catch (removeError) {
          console.warn('[NutritionProfile] 清理重复配奶档案失败（已忽略）', {
            babyUid,
            duplicateId: duplicate._id,
            error: removeError && (removeError.message || removeError.errMsg || String(removeError))
          });
        }
      }

      return true;
    } catch (error) {
      console.error('更新新版配奶营养档案失败：', error);
      return false;
    }
  }
}

module.exports = new MilkNutritionProfileModel();
