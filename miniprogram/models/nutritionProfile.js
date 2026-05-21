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

async function getFirstDocument(collection, babyUid) {
  const query = collection.where({ babyUid });
  const executableQuery = typeof query.limit === 'function' ? query.limit(1) : query;
  const res = await executableQuery.get();
  return res.data && res.data[0];
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
      const profile = await getFirstDocument(milkNutritionProfileCollection, babyUid);
      if (profile) {
        return this.profileDocumentToNutritionSettings(profile);
      }

      if (!includeLegacyFallback) {
        return null;
      }

      const [babyRes, compatRes] = await Promise.all([
        getFirstDocument(babyInfoCollection, babyUid),
        getFirstDocument(nutritionSettingsCollection, babyUid)
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
      return null;
    }
  }

  async updateNutritionProfileSettings(babyUid, settings) {
    try {
      const data = this.buildProfileDataFromSettings(babyUid, settings);
      const profile = await getFirstDocument(milkNutritionProfileCollection, babyUid);

      if (profile) {
        await milkNutritionProfileCollection.doc(profile._id).update({
          data
        });
      } else {
        await milkNutritionProfileCollection.add({
          data: {
            ...data,
            createdAt: db.serverDate()
          }
        });
      }

      return true;
    } catch (error) {
      console.error('更新新版配奶营养档案失败：', error);
      return false;
    }
  }
}

module.exports = new MilkNutritionProfileModel();
