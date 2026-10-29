const { invalidateSearchForBaby } = require('../utils/searchSession');
// 食物数据模型，支持自定义食物库与营养计算
const SystemFoodIndex = require('../utils/systemFoodIndex');
const { updateManualProvenance, withMissingNutrition } = require('../utils/nutritionProvenance');
const { stableHash } = require('../utils/nutritionHash');
const db = wx.cloud.database();
const _ = db.command;

class FoodModel {
  constructor() {
    this.collection = db.collection('food_catalog');
    this._systemFoodsEnsured = false;
    this._catalogGeneration = 0;
  }

  markCatalogDirty(babyUid) {
    invalidateSearchForBaby(babyUid);
    this._catalogGeneration = (Number(this._catalogGeneration) || 0) + 1;
  }

  getCatalogGeneration() {
    return Number(this._catalogGeneration) || 0;
  }

  hasCatalogChanged(seenGeneration) {
    return typeof seenGeneration === 'number' && seenGeneration !== this.getCatalogGeneration();
  }

  /**
   * 获取可用的食物列表（系统默认 + 当前宝宝自定义）
   * @param {string} babyUid
   * @returns {Promise<Array>}
   */
  async getAvailableFoods(babyUid, options = {}) {
    try {
      const userFoodsPromise = babyUid ? this._getUserFoods(babyUid) : Promise.resolve([]);
      const systemFoods = await this._getSystemFoodsFromIndex({
        preferLocal: options.preferLocalSystemIndex === true,
        forceRefresh: options.forceRefreshSystemIndex === true,
        allowClientPaging: options.allowClientPaging === true,
        onProgress: async partialSystemFoods => {
          if (typeof options.onProgress !== 'function') return;
          const userFoods = await userFoodsPromise;
          options.onProgress(this._mergeAndFormatFoods(partialSystemFoods, userFoods));
        }
      });
      const userFoods = await userFoodsPromise;
      return this._mergeAndFormatFoods(systemFoods, userFoods);
    } catch (error) {
      console.error('获取食物列表失败:', error);
      return [];
    }
  }

  _mergeAndFormatFoods(systemFoods = [], userFoods = []) {
      const allFoods = [...systemFoods, ...userFoods];

      const foodMap = new Map();
      const addFood = (doc, override = false) => {
        if (!doc) return;
        const key = doc._id || `${doc.name}_${doc.category || ''}_${doc.babyUid || doc.sharedBabyUids || 'sys'}`;
        if (!foodMap.has(key) || override) {
          foodMap.set(key, doc);
        }
      };

      allFoods.forEach(doc => {
        if (!doc) return;
        addFood(this._formatFoodDoc(doc), true);
      });

      return Array.from(foodMap.values());
  }

  async _getSystemFoodsFromIndex(options = {}) {
    try {
      return await SystemFoodIndex.getSystemFoodIndex(options);
    } catch (error) {
      console.warn('读取系统食物本地索引失败:', error);
      return [];
    }
  }

  async _getUserFoods(babyUid) {
    if (!babyUid) return [];
    return this._fetchFoodsByConditions([
      { babyUid: _.eq(babyUid) },
      { sharedBabyUids: _.in([babyUid]) }
    ]);
  }

  async _fetchFoodsByConditions(conditions = []) {
    const allFoods = [];
    const pageSize = 20;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await this.collection
        .where(conditions.length === 1 ? conditions[0] : _.or(conditions))
        .skip(offset)
        .limit(pageSize)
        .get();

      const batch = (res && res.data) || [];
      allFoods.push(...batch);

      if (batch.length < pageSize) {
        hasMore = false;
      } else {
        offset += batch.length;
      }
    }

    return allFoods;
  }

  async resolveFoodImageUrls(foods = []) {
    const list = Array.isArray(foods) ? foods : [];
    const fileIds = list
      .flatMap(food => this._normalizeFoodImages(food))
      .filter(image => image.startsWith('cloud://'));

    if (!fileIds.length) {
      return list;
    }

    const { resolveCloudTempUrls } = require('../utils/cloudTempUrlCache');
    let imageUrlMap = new Map();
    try {
      imageUrlMap = await resolveCloudTempUrls(fileIds);
    } catch (error) {
      console.warn('解析食物图片临时地址失败:', error);
      return list;
    }

    return list.map(food => {
      const image = (food?.image || '').toString().trim();
      return {
        ...food,
        imageUrl: imageUrlMap.get(image) || image || '',
        imageUrls: this._normalizeFoodImages(food).map(id => imageUrlMap.get(id) || id)
      };
    });
  }

  /**
   * 计算指定数量食物的营养值
   * @param {Object} food 食物对象
   * @param {number} quantity 输入数量（与 baseUnit 相同）
   * @returns {Object} 营养数值
   */
  calculateNutrition(food, quantity) {
    const nutrition = this._normalizeNutritionPerBasis(food || {});
    const basis = this._normalizeNutritionBasis(food || {});
    if (!food || !nutrition) {
      return {
        calories: 0,
        protein: 0,
        proteinText: '0.00',
        carbs: 0,
        fat: 0,
        fiber: 0,
        sodium: 0
      };
    }

    const baseQuantity = Number(basis.quantity) || 100;
    const factor = quantity / baseQuantity;
    const perUnit = nutrition || {};

    const result = {
      calories: this._roundNumber((perUnit.calories || 0) * factor, 2),
      protein: this._roundNumber((perUnit.protein || 0) * factor, 2),
      carbs: this._roundNumber((perUnit.carbs || 0) * factor, 2),
      fat: this._roundNumber((perUnit.fat || 0) * factor, 2),
      fiber: this._roundNumber((perUnit.fiber || 0) * factor, 2),
      sodium: this._roundNumber((perUnit.sodium || 0) * factor, 2)
    };
    result.proteinText = this._formatProteinText(result.protein);

    return withMissingNutrition(result, nutrition, food);
  }

  /**
   * 创建自定义食物
   * @param {Object} foodData
   * @returns {Promise<string>} 新建文档ID
   */
  async createFood(foodData) {
    if (!foodData || !foodData.name) {
      throw new Error('缺少必需的食物数据');
    }

    try {
      const sharedBabyUids = Array.isArray(foodData.sharedBabyUids) ? [...foodData.sharedBabyUids] : [];
      if (foodData.babyUid && !sharedBabyUids.includes(foodData.babyUid)) {
        sharedBabyUids.push(foodData.babyUid);
      }

      const payload = this._normalizeFoodForWrite({
        ...foodData,
        isPhotoAiRecognized: foodData.isPhotoAiRecognized === true,
        sharedBabyUids
      });
      payload.version = 1;
      payload.createdAt = db.serverDate();
      payload.updatedAt = db.serverDate();

      const res = await this.collection.add({
        data: payload
      });

      this.markCatalogDirty(foodData.babyUid);
      sharedBabyUids.forEach(invalidateSearchForBaby);
      return res._id;
    } catch (error) {
      console.error('创建食物失败:', error);
      throw error;
    }
  }

  async createSystemFoodSnapshot(systemFood, foodData, babyUid) {
    if (!systemFood || !systemFood._id) {
      throw new Error('缺少系统食物信息');
    }
    if (!foodData || !foodData.name) {
      throw new Error('缺少快照食物数据');
    }
    if (!babyUid) {
      throw new Error('缺少宝宝信息，无法创建食物快照');
    }

    try {
      const sourceFood = this._formatFoodDoc(systemFood);
      const sourceFoodCode = sourceFood.sourceFoodCode || sourceFood.origin?.foodCode || '';
      const snapshotPayload = this._normalizeFoodForWrite({
        ...sourceFood,
        ...foodData,
        isPhotoAiRecognized: foodData.isPhotoAiRecognized === true,
        isSystem: false,
        babyUid,
        sharedBabyUids: [babyUid],
        sourceType: 'user_override',
        ownerType: 'baby',
        isSystemSnapshot: true,
        sourceSystemFoodId: sourceFood._id,
        sourceFoodCode,
        snapshotOf: {
          collection: 'food_catalog',
          id: sourceFood._id,
          sourceFoodCode
        },
        snapshotCreatedAt: db.serverDate(),
        nutritionSource: 'user_override',
        createdBy: foodData.createdBy || (getApp()?.globalData?.openid) || wx.getStorageSync?.('openid') || ''
      });
      delete snapshotPayload._id;
      delete snapshotPayload.aliasText;

      const existing = await this.collection
        .where({
          sourceSystemFoodId: sourceFood._id,
          babyUid: _.eq(babyUid)
        })
        .limit(1)
        .get();

      if (existing.data && existing.data.length > 0) {
        const existingId = existing.data[0]._id;
        const { createdAt, createdBy, ...updatePayload } = snapshotPayload;
        await this.updateFood(existingId, { ...updatePayload, expectedVersion: Number(existing.data[0].version || 0) }, babyUid);
        return existingId;
      }

      const res = await this.collection.add({
        data: {
          ...snapshotPayload,
          _id: stableHash('food-source:' + babyUid + ':' + sourceFood._id),
          version: 1,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      this.markCatalogDirty(babyUid);
      return res._id;
    } catch (error) {
      console.error('创建系统食物快照失败:', error);
      throw error;
    }
  }

  /**
   * 删除自定义食物
   * @param {string} foodId
   * @param {string} babyUid
   */
  async deleteFood(foodId, babyUid) {
    if (!foodId) {
      throw new Error('缺少食物ID');
    }
    if (!babyUid) {
      throw new Error('缺少宝宝信息，无法删除食物');
    }

    try {
      const res = await this.collection
        .where({
          _id: foodId,
          babyUid: _.eq(babyUid)
        })
        .remove();

      const removed = res?.stats?.removed || 0;
      if (removed === 0) {
        throw new Error('未找到可删除的自定义食物');
      }
      this.markCatalogDirty(babyUid);
      return true;
    } catch (error) {
      console.error('删除食物失败:', error);
      throw error;
    }
  }

  /**
   * 更新自定义食物
   * @param {string} foodId
   * @param {Object} foodData
   * @param {string} babyUid
   */
  async updateFood(foodId, foodData, babyUid) {
    if (!foodId) {
      throw new Error('缺少食物ID');
    }
    if (!babyUid) {
      throw new Error('缺少宝宝信息，无法更新食物');
    }
    if (!foodData) {
      throw new Error('缺少食物数据');
    }

    try {
      const payload = this._normalizeFoodForWrite(foodData);
      payload.updatedAt = db.serverDate();
      const currentRes = await this.collection.doc(foodId).get();
      const current = currentRes.data;
      if (!current || current.isSystem || current.babyUid !== babyUid) throw new Error('未找到可更新的自定义食物');
      // 保存来源属于条目历史，普通编辑不能把拍照来源改成手动来源。
      if (typeof current.isPhotoAiRecognized === 'boolean') payload.isPhotoAiRecognized = current.isPhotoAiRecognized;
      else delete payload.isPhotoAiRecognized;
      const expectedVersion = foodData.expectedVersion;
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('缺少读取时的食物版本，请重新打开表单');
      delete payload.expectedVersion;
      if (Number(current.version || 0) !== expectedVersion) throw new Error('食物已被其他监护人修改，请重新打开表单');
      const basisChanged = payload.nutritionBasis && (payload.nutritionBasis.unit !== current.nutritionBasis?.unit ||
        payload.nutritionBasis.quantity !== current.nutritionBasis?.quantity);
      if (current.recognitionMeta && !basisChanged) {
        const before = current.nutritionPerBasis || {};
        const displayed = this._normalizeNutrition(before);
        const submitted = foodData.rawNutrition || foodData.nutritionPerBasis || foodData.nutritionPerUnit || {};
        const touched = foodData.touchedNutritionFields || [];
        // 表单显示的舍入值未被编辑时，保留数据库精度和原来源。
        Object.keys(displayed).forEach(field => {
          const value = submitted[field];
          if (!touched.includes(field) && current.recognitionMeta.fieldSources?.[field] &&
              value != null && String(value).trim() !== '' && before[field] != null &&
              Number.isFinite(Number(before[field])) && Number(value) === displayed[field]) {
            payload.nutritionPerBasis[field] = Number(before[field]);
          }
        });
      }
      if (current.recognitionMeta) payload.recognitionMeta = updateManualProvenance(current.recognitionMeta,
        current.nutritionPerBasis, payload.nutritionPerBasis, basisChanged, foodData.rawNutrition, foodData.touchedNutritionFields);
      payload.nutritionPerBasis = withMissingNutrition(payload.nutritionPerBasis, payload);
      if (basisChanged && payload.recognitionMeta) payload.recognitionMeta.finalBasis = {
        ...payload.nutritionBasis, material: 'food'
      };
      if (payload.recognitionMeta && payload.name && payload.name !== current.name) {
        payload.recognitionMeta.comparisonStatus = 'stale';
        payload.recognitionMeta.identityEdited = true;
      }
      payload.version = expectedVersion + 1;
      delete payload.sharedBabyUids;

      const res = await this.collection
        .where({
          _id: foodId,
          babyUid: _.eq(babyUid),
          version: expectedVersion === 0 ? _.or(_.eq(0), _.exists(false)) : _.eq(expectedVersion)
        })
        .update({
          data: {
            ...payload,
            sharedBabyUids: _.addToSet(babyUid)
          }
        });

      const updated = res?.stats?.updated || 0;
      if (updated === 0) {
        throw new Error('食物版本已变化，请重新打开表单');
      }
      this.markCatalogDirty(babyUid);
      return true;
    } catch (error) {
      console.error('更新食物失败:', error);
      throw error;
    }
  }

  /**
   * 将营养数据标准化为数字
   * @param {Object} nutrition
   * @returns {Object}
   */
  _normalizeNutrition(nutrition = {}) {
    return {
      calories: this._roundNumber(Number(nutrition.calories) || 0),
      protein: this._roundNumber(Number(nutrition.protein) || 0),
      carbs: this._roundNumber(Number(nutrition.carbs) || 0),
      fat: this._roundNumber(Number(nutrition.fat) || 0),
      fiber: this._roundNumber(Number(nutrition.fiber) || 0),
      sodium: this._roundNumber(Number(nutrition.sodium) || 0)
    };
  }

  /**
   * 舍入助手，避免浮点噪音
   */
  _roundNumber(num, precision = 2) {
    if (isNaN(num)) return 0;
    const multiplier = Math.pow(10, precision);
    return Math.round(num * multiplier) / multiplier;
  }

  _formatProteinText(num) {
    return this._roundNumber(num, 2).toFixed(2);
  }

  _normalizeNutritionBasis(food = {}) {
    const basis = food.nutritionBasis || food.servingBasis || {};
    return {
      quantity: Number(basis.quantity || food.baseQuantity) || 100,
      unit: (basis.unit || food.baseUnit || (food.isLiquid ? 'ml' : 'g')).toString().trim() || 'g'
    };
  }

  _normalizeNutritionPerBasis(food = {}) {
    const nutrition = food.nutritionPerBasis || food.nutritionPer100g || food.nutritionPerUnit || {};
    return withMissingNutrition(this._normalizeNutrition(nutrition), nutrition, food);
  }

  _getDefaultSourceType(food = {}) {
    if (food.sourceType) return food.sourceType;
    if (food.isSystem) return 'system';
    if (food.ownerType === 'system') return 'system';
    if (food.isSystemSnapshot || food.sourceSystemFoodId) return 'user_override';
    return 'user_custom';
  }

  _normalizeFoodForWrite(foodData = {}) {
    const images = this._normalizeFoodImages(foodData);
    const nutritionBasis = this._normalizeNutritionBasis(foodData);
    const rawNutrition = foodData.rawNutrition || foodData.nutritionPerBasis || foodData.nutritionPer100g || foodData.nutritionPerUnit || {};
    const nutritionPerBasis = withMissingNutrition(this._normalizeNutrition(rawNutrition), rawNutrition);
    const sourceType = this._getDefaultSourceType(foodData);
    const isSystem = sourceType === 'system' || foodData.ownerType === 'system' || foodData.isSystem === true;

    const payload = {
      ...foodData,
      schemaVersion: Number(foodData.schemaVersion) || 2,
      recordType: foodData.recordType || 'food_catalog_item',
      status: foodData.status || 'active',
      sourceType,
      ownerType: foodData.ownerType || (isSystem ? 'system' : 'baby'),
      isSystem,
      image: foodData.image ? String(foodData.image).trim() : images[0] || '',
      images,
      nutritionBasis,
      nutritionPerBasis,
      nutritionExtra: foodData.nutritionExtra || {},
      updatedAt: foodData.updatedAt
    };

    delete payload.nutritionPerUnit;
    delete payload.nutritionPer100g;
    delete payload.baseQuantity;
    delete payload.baseUnit;
    delete payload.aliasText;
    delete payload.rawNutrition;
    delete payload.touchedNutritionFields;
    delete payload.expectedVersion;
    delete payload.imageUrl;
    delete payload.imageUrls;

    return payload;
  }

  _normalizeFoodImages(food = {}) {
    const images = (Array.isArray(food.images) ? food.images : [])
      .filter(image => typeof image === 'string' && image.trim()).map(image => image.trim());
    if (typeof food.image === 'string' && food.image.trim() && !images.includes(food.image.trim())) images.unshift(food.image.trim());
    return [...new Set(images)];
  }

  buildFoodSnapshot(food = {}) {
    const formatted = this._formatFoodDoc(food);
    return {
      name: formatted.name || '',
      category: formatted.category || '',
      categoryLevel1: formatted.categoryLevel1 || formatted.category || '',
      categoryLevel2: formatted.categoryLevel2 || '',
      ...(formatted.recognitionMeta ? { recognitionMeta: JSON.parse(JSON.stringify(formatted.recognitionMeta)) } : {}),
      ...(typeof formatted.isPhotoAiRecognized === 'boolean' ? { isPhotoAiRecognized: formatted.isPhotoAiRecognized } : {}),
      ...(formatted.nutrientStates ? { nutrientStates: JSON.parse(JSON.stringify(formatted.nutrientStates)) } : {}),
      nutritionBasis: formatted.nutritionBasis,
      nutritionPerBasis: formatted.nutritionPerBasis,
      proteinSource: formatted.proteinSource || 'natural',
      proteinSplit: formatted.proteinSplit || null,
      proteinQuality: formatted.proteinQuality || '',
      sourceType: formatted.sourceType || '',
      libraryScope: formatted.libraryScope || (formatted.isSystem ? 'system' : 'mine'),
      sourceSystemFoodId: formatted.sourceSystemFoodId || '',
      sourceFoodCode: formatted.sourceFoodCode || formatted.origin?.foodCode || ''
    };
  }

  _formatSystemFoodDoc(food) {
    if (!food) return null;
    const category = food.categoryLevel1 || food.category || '婴幼儿辅食';
    const baseQuantity = Number(food.baseQuantity) || 100;
    return {
      ...food,
      _id: food._id || `system_${food.name}_${category}`,
      category,
      categoryLevel1: category,
      categoryLevel2: food.categoryLevel2 || '',
      baseUnit: food.baseUnit || 'g',
      baseQuantity,
      nutritionPerUnit: this._normalizeNutrition(food.nutritionPerUnit || {}),
      proteinSource: food.proteinSource || 'natural',
      proteinQuality: food.proteinQuality || '',
      nutritionSource: food.nutritionSource || 'system',
      source: food.source || '',
      isSystem: true,
      isLiquid: !!food.isLiquid,
      image: food.image || '',
      images: this._normalizeFoodImages(food),
      aliasText: Array.isArray(food.alias) ? food.alias.join(' / ') : (food.alias || '')
    };
  }

  _formatFoodDoc(food) {
    if (!food) return null;
    const category = food.categoryLevel1 || food.category || '婴幼儿辅食';
    const nutritionBasis = this._normalizeNutritionBasis(food);
    const nutritionPerBasis = this._normalizeNutritionPerBasis(food);
    const sourceType = this._getDefaultSourceType(food);
    const isSystem = sourceType === 'system' || food.ownerType === 'system' || food.isSystem === true;
    const aliasText = food.aliasText || (Array.isArray(food.alias) ? food.alias.join(' / ') : (food.alias || ''));

    return {
      ...food,
      category,
      categoryLevel1: category,
      categoryLevel2: food.categoryLevel2 || '',
      schemaVersion: Number(food.schemaVersion) || 2,
      recordType: food.recordType || 'food_catalog_item',
      status: food.status || 'active',
      sourceType,
      ownerType: food.ownerType || (isSystem ? 'system' : 'baby'),
      nutritionBasis,
      nutritionPerBasis,
      nutritionExtra: food.nutritionExtra || {},
      baseUnit: nutritionBasis.unit,
      baseQuantity: nutritionBasis.quantity,
      nutritionPerUnit: nutritionPerBasis,
      missingNutrition: Object.fromEntries(['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'].map(field =>
        [field, (food.recognitionMeta?.missingFields || []).includes(field)])),
      proteinSource: food.proteinSource || 'natural',
      proteinQuality: food.proteinQuality || '',
      nutritionSource: food.nutritionSource || (isSystem ? 'system' : 'manual'),
      isSystem,
      isCustom: !isSystem,
      libraryScope: isSystem ? 'system' : 'mine',
      image: food.image || this._normalizeFoodImages(food)[0] || '',
      images: this._normalizeFoodImages(food),
      isLiquid: nutritionBasis.unit.toLowerCase() === 'ml' || !!food.isLiquid,
      aliasText
    };
  }
}

module.exports = new FoodModel();
