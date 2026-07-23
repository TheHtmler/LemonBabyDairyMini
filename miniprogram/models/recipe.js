/**
 * 食谱目录数据模型
 * 管理 recipe_catalog 集合的 CRUD；不参与 daily_summary_v2 失效
 */

const FoodModel = require('./food');
const {
  buildCreateAuditFields,
  buildUpdateAuditFields,
  resolveOperatorOpenid,
  stripProtectedAuditFields
} = require('../utils/auditFields');
const {
  summarizeRecipeNutrition,
  buildIngredientNutrition,
  emptyNutrition
} = require('../utils/recipeNutritionUtils');

const db = wx.cloud.database();

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeNutrition(nutrition = {}) {
  return {
    calories: toNumber(nutrition.calories),
    protein: toNumber(nutrition.protein),
    naturalProtein: toNumber(nutrition.naturalProtein),
    specialProtein: toNumber(nutrition.specialProtein),
    fat: toNumber(nutrition.fat),
    carbs: toNumber(nutrition.carbs),
    fiber: toNumber(nutrition.fiber),
    sodium: toNumber(nutrition.sodium)
  };
}

function normalizeIngredient(ingredient = {}, index = 0) {
  return {
    foodId: ingredient.foodId || '',
    foodName: ingredient.foodName || ingredient.foodSnapshot?.name || '',
    quantity: toNumber(ingredient.quantity),
    unit: ingredient.unit || 'g',
    sortOrder: Number.isFinite(Number(ingredient.sortOrder))
      ? Number(ingredient.sortOrder)
      : index,
    foodSnapshot: ingredient.foodSnapshot || {},
    nutrition: normalizeNutrition(ingredient.nutrition)
  };
}

function normalizeRecipe(doc = {}) {
  return {
    ...doc,
    schemaVersion: doc.schemaVersion || 1,
    recordType: doc.recordType || 'recipe',
    status: doc.status || 'active',
    babyUid: doc.babyUid || '',
    name: doc.name || '',
    notes: doc.notes || '',
    yieldWeightG: toNumber(doc.yieldWeightG),
    steps: Array.isArray(doc.steps) ? doc.steps : [],
    coverImageFileId: doc.coverImageFileId || '',
    prepTimeSec: doc.prepTimeSec === undefined ? null : doc.prepTimeSec,
    ingredients: (doc.ingredients || []).map((item, index) => normalizeIngredient(item, index)),
    totalNutrition: normalizeNutrition(doc.totalNutrition || emptyNutrition()),
    nutritionPer100g: normalizeNutrition(doc.nutritionPer100g || emptyNutrition()),
    proteinSource: doc.proteinSource || 'natural',
    usageCount: toNumber(doc.usageCount, 0),
    lastUsedAt: doc.lastUsedAt === undefined ? null : doc.lastUsedAt
  };
}

function resolveBabyUid(source = {}) {
  const app = typeof getApp === 'function' ? getApp() : null;
  return source.babyUid
    || app?.globalData?.babyUid
    || wx.getStorageSync('baby_uid')
    || '';
}

class RecipeModel {
  constructor() {
    this.db = db;
    this.collection = db.collection('recipe_catalog');
  }

  normalizeRecipe(doc = {}) {
    return normalizeRecipe(doc);
  }

  prepareIngredients(ingredients = []) {
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      throw new Error('请至少添加一种原料');
    }

    return ingredients.map((item, index) => {
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('原料份量必须大于 0');
      }

      const food = item.food || item.foodDoc || null;
      const foodName = item.foodName || food?.name || item.foodSnapshot?.name || '';
      let foodSnapshot = item.foodSnapshot;
      let nutrition = item.nutrition;

      if (food) {
        foodSnapshot = FoodModel.buildFoodSnapshot(food);
        nutrition = buildIngredientNutrition(food, quantity);
      } else if (!foodSnapshot || !nutrition) {
        throw new Error(`缺少原料「${foodName || index + 1}」的食物信息`);
      }

      return normalizeIngredient({
        foodId: item.foodId || food?._id || '',
        foodName: foodName || foodSnapshot?.name || '',
        quantity,
        unit: item.unit || 'g',
        sortOrder: item.sortOrder,
        foodSnapshot,
        nutrition
      }, index);
    });
  }

  buildRecipePayload(recipe = {}, previous = {}) {
    const merged = {
      ...previous,
      ...stripProtectedAuditFields(recipe)
    };
    const name = String(merged.name || '').trim();
    if (!name) {
      throw new Error('请输入食谱名称');
    }

    const yieldWeightG = Number(merged.yieldWeightG);
    if (!Number.isFinite(yieldWeightG) || yieldWeightG <= 0) {
      throw new Error('成品总重必须大于 0');
    }

    const ingredients = this.prepareIngredients(merged.ingredients);
    const nutritionSummary = summarizeRecipeNutrition(ingredients, yieldWeightG);

    return normalizeRecipe({
      ...merged,
      name,
      yieldWeightG,
      ingredients,
      totalNutrition: nutritionSummary.totalNutrition,
      nutritionPer100g: nutritionSummary.nutritionPer100g,
      proteinSource: nutritionSummary.proteinSource,
      steps: merged.steps,
      coverImageFileId: merged.coverImageFileId,
      prepTimeSec: merged.prepTimeSec,
      notes: merged.notes || ''
    });
  }

  async getById(id) {
    try {
      const res = await this.collection.doc(id).get();
      return { success: true, data: res?.data ? normalizeRecipe(res.data) : null };
    } catch (error) {
      return { success: false, message: error.message || '查询失败', data: null };
    }
  }

  assertRecipeOwnership(doc, babyUid) {
    const expectedBabyUid = resolveBabyUid({ babyUid });
    if (!expectedBabyUid) {
      throw new Error('未找到宝宝信息');
    }
    if (!doc) {
      throw new Error('食谱不存在');
    }
    if (doc.babyUid !== expectedBabyUid) {
      throw new Error('无权修改该食谱');
    }
    return expectedBabyUid;
  }

  async getOwnedRecipe(id, babyUid) {
    const result = await this.getById(id);
    if (!result.success) {
      throw new Error(result.message || '查询食谱失败');
    }
    const expectedBabyUid = this.assertRecipeOwnership(result.data, babyUid);
    return {
      record: result.data,
      babyUid: expectedBabyUid
    };
  }

  async create(recipe = {}) {
    try {
      const babyUid = resolveBabyUid(recipe);
      if (!babyUid) {
        throw new Error('未找到宝宝信息');
      }

      const operatorOpenid = resolveOperatorOpenid(recipe);
      const timestamp = db.serverDate();
      const payload = this.buildRecipePayload({
        ...recipe,
        babyUid,
        usageCount: 0,
        lastUsedAt: null
      });

      const result = await this.collection.add({
        data: {
          ...payload,
          ...buildCreateAuditFields({
            timestamp,
            operatorOpenid,
            recordType: 'recipe',
            schemaVersion: payload.schemaVersion
          })
        }
      });

      return { success: true, data: result };
    } catch (error) {
      console.error('创建食谱失败:', error);
      return { success: false, message: error.message || '创建失败' };
    }
  }

  async update(id, patch = {}, babyUid) {
    try {
      const ownedRecipe = await this.getOwnedRecipe(id, babyUid);
      const previousRecord = ownedRecipe.record;
      const expectedBabyUid = ownedRecipe.babyUid;

      const operatorOpenid = resolveOperatorOpenid(patch);
      const timestamp = db.serverDate();
      const payload = this.buildRecipePayload({
        ...previousRecord,
        ...patch,
        babyUid: expectedBabyUid,
        usageCount: previousRecord.usageCount,
        lastUsedAt: previousRecord.lastUsedAt
      });

      const result = await this.collection.doc(id).update({
        data: {
          ...payload,
          ...buildUpdateAuditFields({
            timestamp,
            operatorOpenid
          })
        }
      });

      return { success: true, data: result };
    } catch (error) {
      console.error('更新食谱失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }

  async softDelete(id, babyUid) {
    try {
      const ownedRecipe = await this.getOwnedRecipe(id, babyUid);
      const expectedBabyUid = ownedRecipe.babyUid;
      const operatorOpenid = resolveOperatorOpenid({ babyUid: expectedBabyUid });
      const timestamp = db.serverDate();
      const result = await this.collection.doc(id).update({
        data: {
          status: 'deleted',
          deletedAt: timestamp,
          ...(operatorOpenid ? { deletedBy: operatorOpenid } : {}),
          ...buildUpdateAuditFields({
            timestamp,
            operatorOpenid
          })
        }
      });
      return { success: true, data: result };
    } catch (error) {
      console.error('删除食谱失败:', error);
      return { success: false, message: error.message || '删除失败' };
    }
  }

  async listActiveByBaby(babyUid) {
    try {
      if (!babyUid) {
        return { success: true, data: [] };
      }

      const result = await this.collection
        .where({
          babyUid,
          status: 'active'
        })
        .orderBy('updatedAt', 'desc')
        .get();

      return {
        success: true,
        data: (result.data || [])
          .filter((item) => item.status === 'active')
          .map((item) => normalizeRecipe(item))
      };
    } catch (error) {
      console.error('查询食谱列表失败:', error);
      return { success: false, message: error.message || '查询失败', data: [] };
    }
  }

  async touchUsage(id, babyUid) {
    try {
      const ownedRecipe = await this.getOwnedRecipe(id, babyUid);
      const expectedBabyUid = ownedRecipe.babyUid;
      const operatorOpenid = resolveOperatorOpenid({ babyUid: expectedBabyUid });
      const timestamp = db.serverDate();
      const result = await this.collection.doc(id).update({
        data: {
          usageCount: db.command.inc(1),
          lastUsedAt: timestamp,
          ...buildUpdateAuditFields({
            timestamp,
            operatorOpenid
          })
        }
      });
      return { success: true, data: result };
    } catch (error) {
      console.error('更新食谱使用统计失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }
}

module.exports = new RecipeModel();
module.exports.normalizeRecipe = normalizeRecipe;
