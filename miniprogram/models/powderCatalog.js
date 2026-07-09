const SystemPowderIndex = require('../utils/systemPowderIndex');
const MilkNutritionProfileModel = require('./nutritionProfile');
const {
  POWDER_STATUSES,
  normalizeFormulaPowders
} = require('../utils/formulaPowderUtils');

const db = wx.cloud.database();

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function formatSystemPowder(powder = {}) {
  return {
    ...powder,
    _id: powder._id || powder.powderCode,
    isSystem: true,
    isCustom: false,
    libraryScope: 'system'
  };
}

function formatUserPowder(powder = {}) {
  return {
    ...powder,
    _id: powder.id || powder._id || '',
    isSystem: powder.source === 'system' || !!powder.sourceSystemPowderId,
    isCustom: powder.source !== 'system' && !powder.sourceSystemPowderId,
    libraryScope: 'mine',
    powderCode: powder.sourceSystemPowderId || powder.powderCode || '',
    nutritionPer100g: powder.nutritionPer100g || {},
    mixRatio: powder.mixRatio || {}
  };
}

class PowderCatalogModel {
  async getSystemPowders(options = {}) {
    try {
      const items = await SystemPowderIndex.getSystemPowderIndex(options);
      return (items || []).map(formatSystemPowder);
    } catch (error) {
      console.error('获取系统奶粉库失败:', error);
      return [];
    }
  }

  async getUserPowders(babyUid) {
    if (!babyUid) {
      return [];
    }

    try {
      const settings = await MilkNutritionProfileModel.getNutritionProfileSettings(babyUid, {
        includeLegacyFallback: true,
        throwOnError: false
      });
      const powders = normalizeFormulaPowders(settings?.formulaPowders || [])
        .filter((powder) => powder.status === POWDER_STATUSES.ACTIVE);

      return powders.map(formatUserPowder);
    } catch (error) {
      console.error('获取用户奶粉档案失败:', error);
      return [];
    }
  }

  async getAvailablePowders(babyUid, options = {}) {
    const [systemPowders, userPowders] = await Promise.all([
      this.getSystemPowders(options),
      this.getUserPowders(babyUid)
    ]);

    return {
      systemPowders,
      userPowders
    };
  }

  async resolvePowderImageUrls(powders = []) {
    const list = Array.isArray(powders) ? powders : [];
    const fileIds = Array.from(
      new Set(
        list
          .map((powder) => (powder?.image || '').toString().trim())
          .filter((image) => image.startsWith('cloud://'))
      )
    );

    if (!fileIds.length) {
      return list;
    }

    const imageUrlMap = new Map();
    const chunkSize = 50;

    try {
      for (let i = 0; i < fileIds.length; i += chunkSize) {
        const chunk = fileIds.slice(i, i + chunkSize);
        const { fileList } = await wx.cloud.getTempFileURL({
          fileList: chunk.map((fileID) => ({ fileID, maxAge: 604800 }))
        });

        (fileList || []).forEach((item) => {
          if (item?.fileID && item.tempFileURL) {
            imageUrlMap.set(item.fileID, item.tempFileURL);
          }
        });
      }
    } catch (error) {
      console.warn('解析奶粉图片临时地址失败:', error);
      return list;
    }

    return list.map((powder) => {
      const image = (powder?.image || '').toString().trim();
      return {
        ...powder,
        imageUrl: imageUrlMap.get(image) || image || ''
      };
    });
  }

  buildFormulaPowderFromSystem(systemPowder = {}) {
    const now = db.serverDate();
    return {
      id: createId('powder'),
      name: systemPowder.name || '未命名奶粉',
      category: systemPowder.category,
      proteinRole: systemPowder.proteinRole,
      nutritionPer100g: { ...(systemPowder.nutritionPer100g || {}) },
      mixRatio: { ...(systemPowder.mixRatio || {}) },
      status: POWDER_STATUSES.ACTIVE,
      source: 'system',
      sourceSystemPowderId: systemPowder.powderCode || systemPowder._id || '',
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
  }

  async _getWritableSettings(babyUid) {
    return await MilkNutritionProfileModel.getNutritionProfileSettings(babyUid, {
      includeLegacyFallback: true,
      throwOnError: true
    }) || { formulaPowders: [] };
  }

  async saveUserPowder(babyUid, draft = {}) {
    if (!babyUid) {
      throw new Error('未找到宝宝信息');
    }

    const settings = await this._getWritableSettings(babyUid);
    const powders = normalizeFormulaPowders(settings.formulaPowders || []);
    const now = db.serverDate();
    const powderId = draft.id || createId('powder');
    const existing = powders.find((item) => item.id === powderId);
    const sourceSystemPowderId = draft.sourceSystemPowderId || existing?.sourceSystemPowderId || '';

    if (sourceSystemPowderId) {
      const duplicated = powders.find(
        (item) => item.status === POWDER_STATUSES.ACTIVE
          && item.sourceSystemPowderId === sourceSystemPowderId
          && item.id !== powderId
      );
      if (duplicated) {
        return {
          added: false,
          powder: formatUserPowder(duplicated),
          message: '该奶粉已在你的档案中'
        };
      }
    }

    const nextPowder = {
      id: powderId,
      name: (draft.name || '').trim(),
      category: draft.category,
      proteinRole: draft.proteinRole,
      nutritionPer100g: { ...(draft.nutritionPer100g || {}) },
      mixRatio: { ...(draft.mixRatio || {}) },
      status: POWDER_STATUSES.ACTIVE,
      source: draft.source || existing?.source || 'user',
      sourceSystemPowderId,
      createdAt: existing?.createdAt || draft.createdAt || now,
      updatedAt: now,
      deletedAt: null
    };

    const nextPowders = existing
      ? powders.map((item) => (item.id === powderId ? nextPowder : item))
      : [...powders, nextPowder];

    const success = await MilkNutritionProfileModel.updateNutritionProfileSettings(babyUid, {
      ...settings,
      formulaPowders: nextPowders
    });

    if (!success) {
      throw new Error('保存奶粉失败');
    }

    return {
      added: true,
      powder: formatUserPowder(nextPowder),
      message: existing
        ? '奶粉已更新'
        : (sourceSystemPowderId ? '已加入我的奶粉' : '奶粉已添加')
    };
  }

  async deleteUserPowder(babyUid, powderId) {
    if (!babyUid || !powderId) {
      throw new Error('缺少宝宝信息或奶粉标识');
    }

    const settings = await this._getWritableSettings(babyUid);
    const powders = normalizeFormulaPowders(settings.formulaPowders || []);
    const target = powders.find((item) => item.id === powderId && item.status === POWDER_STATUSES.ACTIVE);

    if (!target) {
      throw new Error('未找到该奶粉');
    }

    const now = db.serverDate();
    const nextPowders = powders.map((powder) => {
      if (powder.id !== powderId) {
        return powder;
      }

      return {
        ...powder,
        status: POWDER_STATUSES.ARCHIVED,
        updatedAt: now,
        deletedAt: now
      };
    });

    const success = await MilkNutritionProfileModel.updateNutritionProfileSettings(babyUid, {
      ...settings,
      formulaPowders: nextPowders
    });

    if (!success) {
      throw new Error('删除奶粉失败');
    }

    return { message: '奶粉已删除' };
  }

  async saveBreastMilkSettings(babyUid, nutritionPer100ml = {}) {
    if (!babyUid) {
      throw new Error('缺少宝宝信息');
    }

    const settings = await this._getWritableSettings(babyUid);
    const nextSettings = {
      ...settings,
      natural_milk_protein: toNumber(nutritionPer100ml.protein),
      natural_milk_calories: toNumber(nutritionPer100ml.calories),
      natural_milk_fat: toNumber(nutritionPer100ml.fat),
      natural_milk_carbs: toNumber(nutritionPer100ml.carbs),
      natural_milk_fiber: toNumber(nutritionPer100ml.fiber)
    };

    const success = await MilkNutritionProfileModel.updateNutritionProfileSettings(babyUid, nextSettings);
    if (!success) {
      throw new Error('保存母乳参数失败');
    }

    return {
      added: true,
      message: '母乳参数已更新'
    };
  }
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = new PowderCatalogModel();
