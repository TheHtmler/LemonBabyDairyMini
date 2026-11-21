const { invalidateSearchForBaby } = require('../utils/searchSession');
const { applyProfiles, getManualAminoAcidError, normalizeProfile } = require('../utils/aminoAcidIntake');
const PENDING_AMINO_TIME = Number.MAX_SAFE_INTEGER;
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

const DEFAULT_BREAST_MILK_SETTINGS = {
  natural_milk_protein: 1.1,
  natural_milk_calories: 67,
  natural_milk_fat: 4,
  natural_milk_carbs: 6.8,
  natural_milk_fiber: 0
};

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

function pickSettingNumber(value, fallback) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveNutritionProfileSeedSettings(legacySettings = {}) {
  return {
    ...legacySettings,
    natural_milk_protein: pickSettingNumber(
      legacySettings.natural_milk_protein,
      DEFAULT_BREAST_MILK_SETTINGS.natural_milk_protein
    ),
    natural_milk_calories: pickSettingNumber(
      legacySettings.natural_milk_calories,
      DEFAULT_BREAST_MILK_SETTINGS.natural_milk_calories
    ),
    natural_milk_fat: pickSettingNumber(
      legacySettings.natural_milk_fat,
      DEFAULT_BREAST_MILK_SETTINGS.natural_milk_fat
    ),
    natural_milk_carbs: pickSettingNumber(
      legacySettings.natural_milk_carbs,
      DEFAULT_BREAST_MILK_SETTINGS.natural_milk_carbs
    ),
    natural_milk_fiber: pickSettingNumber(
      legacySettings.natural_milk_fiber,
      DEFAULT_BREAST_MILK_SETTINGS.natural_milk_fiber
    )
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

function mapAminoArchiveTimes(archive, mapTime) {
  return Array.isArray(archive) ? archive.map(item => ({
    ...item,
    versions: (item.versions || []).map(version => ({
      ...version,
      effectiveAt: mapTime(version.effectiveAt),
      ...(version.appliedAtByDate ? {
        appliedAtByDate: Object.fromEntries(
          Object.entries(version.appliedAtByDate).map(([date, time]) => [date, mapTime(time)])
        )
      } : {})
    }))
  })) : [];
}

function readAminoArchive(document) {
  return mapAminoArchiveTimes(document?.aminoAcidArchive,
    value => getTimeValue(value?.$date ?? value) || null);
}

class MilkNutritionProfileModel {
  async getAminoAcidArchive(babyUid) {
    if (!babyUid) return [];
    const [profile] = await getDocumentsByFreshness(milkNutritionProfileCollection, babyUid);
    return readAminoArchive(profile);
  }

  async saveAminoAcidProfiles(babyUid, updates, { date = '', expectedArchive, applyReference = false } = {}) {
    if (!babyUid) throw new Error('请先选择宝宝');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('补算日期无效');
    if (!Array.isArray(updates) || !updates.length) throw new Error('请核对待保存的氨基酸资料');
    for (const item of updates) {
      const error = getManualAminoAcidError(item?.profile?.values);
      if (error) throw new Error(error);
      const profile = normalizeProfile(item?.profile);
      if (!item?.key || !profile) throw new Error('请核对待保存的氨基酸资料');
      if (profile.estimated && !applyReference) throw new Error('请先确认要应用的参考资料');
      if (applyReference) {
        const recordId = profile.estimated ? profile.source.recordId
          : profile.estimatedKeys?.length && profile.estimateSource?.recordId;
        if (!recordId) throw new Error('这条参考资料缺少官方样品编号');
      }
    }

    let [document] = await getDocumentsByFreshness(milkNutritionProfileCollection, babyUid);
    if (!document) {
      await this.ensureNutritionProfileSettings(babyUid, { throwOnError: true });
      [document] = await getDocumentsByFreshness(milkNutritionProfileCollection, babyUid);
    }
    if (!document) throw new Error('未找到宝宝的营养档案');

    const archive = readAminoArchive(document);
    // 家人可以补不同食物；同一食物已更新时先重新核对。
    if (Array.isArray(expectedArchive)) {
      const original = new Map(expectedArchive.map(item => [item.key, item.versions]));
      const current = new Map(archive.map(item => [item.key, item.versions]));
      if (updates.some(({ key }) => JSON.stringify(original.get(key)) !== JSON.stringify(current.get(key)))) {
        throw new Error('这份资料已被其他监护人更新，请刷新后再保存');
      }
    }

    const next = applyProfiles(archive, updates, { effectiveAt: PENDING_AMINO_TIME, date });
    if (JSON.stringify(next) === JSON.stringify(archive)) return archive;
    // 与摄入记录共用云端时钟，手机时间偏差不会把旧记录套进新档案。
    const stored = mapAminoArchiveTimes(next,
      time => time === PENDING_AMINO_TIME ? db.serverDate() : time);

    const version = Number(document.version || 0);
    const versionCondition = version === 0
      ? db.command.or(db.command.eq(0), db.command.exists(false)) : db.command.eq(version);
    const result = await milkNutritionProfileCollection.where({
      _id: document._id, babyUid, version: versionCondition
    }).update({
      data: {
        aminoAcidArchive: stored,
        version: version + 1,
        updatedAt: db.serverDate()
      }
    });
    if (result.stats?.updated !== 1) throw new Error('营养档案已变化，请刷新后再保存');
    try {
      const { data } = await milkNutritionProfileCollection.doc(document._id).get();
      return readAminoArchive(data);
    } catch (error) {
      throw new Error('资料已保存，请重新加载以查看新版本');
    }
  }

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
    if (profile._id) {
      settings._profileId = profile._id;
      settings._profileVersion = Number(profile.version || 0);
    }
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

      const babyRes = await getFirstDocument(babyInfoCollection, babyUid, 'baby_info');
      const legacySettings = babyRes?.nutritionSettings || {};

      if (!hasLegacySettingsData(legacySettings)) {
        return null;
      }

      const settings = this.profileDocumentToNutritionSettings(
        this.buildProfileDataFromSettings(babyUid, legacySettings)
      );
      return { ...settings, _profileId: '', _profileVersion: 0 };
    } catch (error) {
      console.error('获取新版配奶营养档案失败：', error);
      if (options.throwOnError === true) {
        throw error;
      }
      return null;
    }
  }

  async ensureNutritionProfileSettings(babyUid, options = {}) {
    if (!babyUid) {
      return null;
    }

    try {
      const existing = await getFirstDocument(
        milkNutritionProfileCollection,
        babyUid,
        'milk_nutrition_profiles'
      );
      if (existing) {
        return this.profileDocumentToNutritionSettings(existing);
      }

      const babyRes = await getFirstDocument(babyInfoCollection, babyUid, 'baby_info');
      const seedSettings = resolveNutritionProfileSeedSettings(
        options.seedSettings || babyRes?.nutritionSettings || {}
      );
      const success = await this.updateNutritionProfileSettings(babyUid, seedSettings, { createOnly: true });
      if (!success && options.throwOnError === true) {
        throw new Error('确保配奶营养档案失败');
      }

      const createdProfile = await getFirstDocument(milkNutritionProfileCollection, babyUid);
      const settings = this.profileDocumentToNutritionSettings(createdProfile || this.buildProfileDataFromSettings(babyUid, seedSettings));
      console.info('[NutritionProfile] ensureNutritionProfileSettings created default profile', {
        babyUid,
        protein: settings.natural_milk_protein,
        calories: settings.natural_milk_calories
      });
      return settings;
    } catch (error) {
      console.error('确保配奶营养档案失败：', error);
      if (options.throwOnError === true) {
        throw error;
      }
      return this.profileDocumentToNutritionSettings(
        this.buildProfileDataFromSettings(
          babyUid,
          resolveNutritionProfileSeedSettings(options.seedSettings || {})
        )
      );
    }
  }

  async updateNutritionProfileSettings(babyUid, settings, options = {}) {
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
        if (Number(settings._profileVersion || 0) > 0 || settings._profileId) {
          const conflict = new Error('营养档案已被移除，请重新加载');
          conflict.code = 'VERSION_CONFLICT';
          throw conflict;
        }
        try {
        const addRes = await milkNutritionProfileCollection.add({
          data: {
            ...data,
            _id: 'profile_' + babyUid,
            version: 1,
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
        settings._profileId = addRes._id;
        settings._profileVersion = 1;
        invalidateSearchForBaby(babyUid);
        return true;
        } catch (error) {
          // 初始化只能创建；并发创建成功后回读，不能拿旧种子覆盖新档案。
          if (options.createOnly && (await getDocumentsByFreshness(milkNutritionProfileCollection, babyUid)).length) return true;
          throw error;
        }
      }

      if (options.createOnly) return true;

      // 始终写入唯一的权威文档（最新那份），无论它由创建者还是参与者建立。
      const canonical = documents[0];
      const expectedVersion = settings._profileVersion;
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        const conflict = new Error('缺少读取时的营养档案版本，请重新加载');
        conflict.code = 'VERSION_CONFLICT';
        throw conflict;
      }
      if ((settings._profileId && settings._profileId !== canonical._id) || Number(canonical.version || 0) !== expectedVersion) {
        const conflict = new Error('营养档案已被其他监护人修改，请重新加载后保存');
        conflict.code = 'VERSION_CONFLICT';
        throw conflict;
      }
      const versionCondition = expectedVersion === 0
        ? db.command.or(db.command.eq(0), db.command.exists(false)) : db.command.eq(expectedVersion);
      const updateRes = await milkNutritionProfileCollection.where({ _id: canonical._id, babyUid, version: versionCondition }).update({
        data: { ...data, version: expectedVersion + 1 }
      });
      if (!updateRes.stats || updateRes.stats.updated !== 1) {
        const conflict = new Error('营养档案版本已变化，请重新加载后保存');
        conflict.code = 'VERSION_CONFLICT';
        throw conflict;
      }
      settings._profileId = canonical._id;
      settings._profileVersion = expectedVersion + 1;
      invalidateSearchForBaby(babyUid);
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
      if (error.code === 'VERSION_CONFLICT') throw error;
      return false;
    }
  }
}

module.exports = new MilkNutritionProfileModel();
