// 食物数据模型，支持自定义食物库与营养计算
const db = wx.cloud.database();
const _ = db.command;
const { DEFAULT_FOODS } = require('../constants/defaultFoods');

class FoodModel {
  constructor() {
    this.collection = db.collection('food_catalog');
    this._systemFoodsEnsured = false;
  }

  async _ensureSystemFoods() {
    if (this._systemFoodsEnsured) return;
    this._systemFoodsEnsured = true;

    try {
      if (!Array.isArray(DEFAULT_FOODS) || DEFAULT_FOODS.length === 0) {
        return;
      }

      const systemIds = DEFAULT_FOODS.map(item => item._id).filter(Boolean);
      let existingIds = new Set();
      if (systemIds.length > 0) {
        const res = await this.collection
          .where({ _id: _.in(systemIds) })
          .field({ _id: true })
          .get();
        existingIds = new Set((res.data || []).map(item => item._id));
      }

      for (const food of DEFAULT_FOODS) {
        const baseDoc = {
          ...food,
          _id: food._id,
          category: food.categoryLevel1 || food.category,
          categoryLevel1: food.categoryLevel1 || food.category,
          categoryLevel2: food.categoryLevel2 || '',
          baseUnit: food.baseUnit || 'g',
          baseQuantity: Number(food.baseQuantity) || 100,
          defaultQuantity: Number(food.defaultQuantity || food.baseQuantity || 100),
          nutritionPerUnit: this._normalizeNutrition(food.nutritionPerUnit),
          proteinSource: food.proteinSource || 'natural',
          nutritionSource: food.nutritionSource || 'system',
          source: food.source || '',
          isSystem: true,
          isLiquid: !!food.isLiquid,
          image: food.image || ''
        };

        if (existingIds.has(food._id)) {
          await this.collection.doc(food._id).update({
            data: {
              name: baseDoc.name,
              category: baseDoc.category,
              categoryLevel1: baseDoc.categoryLevel1,
              categoryLevel2: baseDoc.categoryLevel2,
              baseUnit: baseDoc.baseUnit,
              baseQuantity: baseDoc.baseQuantity,
              defaultQuantity: baseDoc.defaultQuantity,
              nutritionPerUnit: baseDoc.nutritionPerUnit,
              proteinSource: baseDoc.proteinSource,
              nutritionSource: baseDoc.nutritionSource,
              source: baseDoc.source,
              isLiquid: baseDoc.isLiquid,
              image: baseDoc.image,
              isSystem: true,
              babyUid: _.remove(),
              updatedAt: db.serverDate()
            }
          });
        } else {
          await this.collection.add({
            data: {
              ...baseDoc,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
        }
      }
    } catch (error) {
      console.error('同步系统默认食物失败:', error);
      this._systemFoodsEnsured = false;
    }
  }

  /**
   * 获取可用的食物列表（系统默认 + 当前宝宝自定义）
   * @param {string} babyUid
   * @returns {Promise<Array>}
   */
  async getAvailableFoods(babyUid) {
    try {
      await this._ensureSystemFoods();

      const conditions = [{ babyUid: _.exists(false) }, { babyUid: _.eq(null) }];
      if (babyUid) {
        conditions.push({ babyUid });
      }

      const allFoods = [];
      const pageSize = 100; // Mini Program Cloud DB allows up to 100 documents per request
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const res = await this.collection
          .where(_.or(conditions))
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
    } catch (error) {
      console.error('获取食物列表失败:', error);
      return [];
    }
  }

  /**
   * 计算指定数量食物的营养值
   * @param {Object} food 食物对象
   * @param {number} quantity 输入数量（与 baseUnit 相同）
   * @returns {Object} 营养数值
   */
  calculateNutrition(food, quantity) {
    if (!food || !food.nutritionPerUnit) {
      return {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sodium: 0
      };
    }

    const baseQuantity = Number(food.baseQuantity) || 100; // 默认以 100g/ml 为基准
    const factor = quantity / baseQuantity;
    const perUnit = food.nutritionPerUnit || {};

    const result = {
      calories: this._roundNumber((perUnit.calories || 0) * factor, 2),
      protein: this._roundNumber((perUnit.protein || 0) * factor, 2),
      carbs: this._roundNumber((perUnit.carbs || 0) * factor, 2),
      fat: this._roundNumber((perUnit.fat || 0) * factor, 2),
      fiber: this._roundNumber((perUnit.fiber || 0) * factor, 2),
      sodium: this._roundNumber((perUnit.sodium || 0) * factor, 2)
    };

    return result;
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
      const payload = {
        ...foodData,
        image: foodData.image ? String(foodData.image).trim() : '',
        baseQuantity: Number(foodData.baseQuantity) || 100,
        nutritionPerUnit: this._normalizeNutrition(foodData.nutritionPerUnit),
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      };

      const res = await this.collection.add({
        data: payload
      });

      return res._id;
    } catch (error) {
      console.error('创建食物失败:', error);
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
      const payload = {
        ...foodData,
        image: foodData.image ? String(foodData.image).trim() : '',
        baseQuantity: Number(foodData.baseQuantity) || 100,
        nutritionPerUnit: this._normalizeNutrition(foodData.nutritionPerUnit),
        updatedAt: db.serverDate()
      };

      const res = await this.collection
        .where({
          _id: foodId,
          babyUid: _.eq(babyUid)
        })
        .update({
          data: payload
        });

      const updated = res?.stats?.updated || 0;
      if (updated === 0) {
        throw new Error('未找到可更新的自定义食物');
      }
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
}

module.exports = new FoodModel();
