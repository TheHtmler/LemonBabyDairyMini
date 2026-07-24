/**
 * 食谱目录数据模型
 * 管理 recipe_catalog：只维护原料组合模板；用量与营养在记本顿时计算
 * 不参与 daily_summary_v2 失效
 */

const FoodModel = require('./food');
const {
  buildCreateAuditFields,
  buildUpdateAuditFields,
  resolveOperatorOpenid,
  stripProtectedAuditFields
} = require('../utils/auditFields');
const { emptyNutrition } = require('../utils/recipeNutritionUtils');

function getDb() {
  return wx.cloud.database();
}

function getCollection() {
  return getDb().collection('recipe_catalog');
}

function cacheKey(babyUid) {
  return `recipe_catalog_cache_${babyUid}`;
}

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

function sanitizeFoodSnapshot(snapshot = {}) {
  const basis = snapshot.nutritionBasis || {};
  const perBasis = snapshot.nutritionPerBasis || {};
  return {
    name: snapshot.name || '',
    category: snapshot.category || '',
    categoryLevel1: snapshot.categoryLevel1 || snapshot.category || '',
    categoryLevel2: snapshot.categoryLevel2 || '',
    nutritionBasis: {
      quantity: toNumber(basis.quantity, 100),
      unit: basis.unit || 'g'
    },
    nutritionPerBasis: normalizeNutrition(perBasis),
    proteinSource: snapshot.proteinSource || 'natural',
    proteinSplit: snapshot.proteinSplit || null,
    proteinQuality: snapshot.proteinQuality || '',
    sourceType: snapshot.sourceType || '',
    libraryScope: snapshot.libraryScope || '',
    sourceSystemFoodId: snapshot.sourceSystemFoodId || '',
    sourceFoodCode: snapshot.sourceFoodCode || ''
  };
}

function normalizeIngredient(ingredient = {}, index = 0) {
  return {
    foodId: ingredient.foodId || '',
    foodName: ingredient.foodName || ingredient.foodSnapshot?.name || '',
    // 模板阶段不存配方用量；兼容旧数据可读 quantity
    quantity: toNumber(ingredient.quantity, 0),
    unit: ingredient.unit || ingredient.foodSnapshot?.nutritionBasis?.unit || 'g',
    sortOrder: Number.isFinite(Number(ingredient.sortOrder))
      ? Number(ingredient.sortOrder)
      : index,
    foodSnapshot: sanitizeFoodSnapshot(ingredient.foodSnapshot || {}),
    nutrition: normalizeNutrition(ingredient.nutrition || emptyNutrition())
  };
}

function normalizeRecipe(doc = {}) {
  // 不使用 ...doc：云文档里的 undefined / 多余字段会导致 setData 失败，列表表现为一直为空
  return {
    _id: doc._id || '',
    schemaVersion: doc.schemaVersion || 1,
    recordType: doc.recordType || 'recipe',
    status: doc.status || 'active',
    babyUid: doc.babyUid || '',
    name: doc.name || '',
    notes: doc.notes || '',
    yieldWeightG: toNumber(doc.yieldWeightG, 0),
    steps: Array.isArray(doc.steps) ? doc.steps : [],
    coverImageFileId: doc.coverImageFileId || '',
    prepTimeSec: doc.prepTimeSec === undefined || doc.prepTimeSec === null
      ? null
      : doc.prepTimeSec,
    ingredients: (doc.ingredients || []).map((item, index) => normalizeIngredient(item, index)),
    totalNutrition: normalizeNutrition(doc.totalNutrition || emptyNutrition()),
    nutritionPer100g: normalizeNutrition(doc.nutritionPer100g || emptyNutrition()),
    proteinSource: doc.proteinSource || 'natural',
    usageCount: toNumber(doc.usageCount, 0),
    lastUsedAt: doc.lastUsedAt === undefined ? null : doc.lastUsedAt,
    updatedAt: doc.updatedAt || null,
    createdAt: doc.createdAt || null
  };
}

function resolveBabyUid(source = {}) {
  const app = typeof getApp === 'function' ? getApp() : null;
  return source.babyUid
    || app?.globalData?.babyUid
    || wx.getStorageSync('baby_uid')
    || '';
}

function readRecipeCache(babyUid) {
  if (!babyUid) return [];
  try {
    const raw = wx.getStorageSync(cacheKey(babyUid));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && item._id && (!item.status || item.status === 'active'))
      .map((item) => normalizeRecipe(item));
  } catch (error) {
    console.warn('读取食谱本地缓存失败:', error);
    return [];
  }
}

function writeRecipeCache(babyUid, recipes = []) {
  if (!babyUid) return;
  try {
    const slim = (recipes || [])
      .filter((item) => item && item._id && (!item.status || item.status === 'active'))
      .map((item) => normalizeRecipe(item));
    wx.setStorageSync(cacheKey(babyUid), slim);
  } catch (error) {
    console.warn('写入食谱本地缓存失败:', error);
  }
}

function upsertRecipeCache(babyUid, recipe) {
  if (!babyUid || !recipe || !recipe._id) return;
  const current = readRecipeCache(babyUid);
  const next = normalizeRecipe(recipe);
  const index = current.findIndex((item) => item._id === next._id);
  if (index >= 0) {
    current[index] = next;
  } else {
    current.unshift(next);
  }
  writeRecipeCache(babyUid, current);
}

function removeRecipeCache(babyUid, recipeId) {
  if (!babyUid || !recipeId) return;
  writeRecipeCache(
    babyUid,
    readRecipeCache(babyUid).filter((item) => item._id !== recipeId)
  );
}

function mergeRecipeLists(remote = [], cached = []) {
  const map = new Map();
  cached.forEach((item) => {
    if (item && item._id) map.set(item._id, item);
  });
  // 远端优先
  remote.forEach((item) => {
    if (item && item._id) map.set(item._id, item);
  });
  return Array.from(map.values());
}

class RecipeModel {
  constructor() {
    // collection 改为按次获取，避免模块加载早于 cloud.init
  }

  get collection() {
    return getCollection();
  }

  get db() {
    return getDb();
  }

  normalizeRecipe(doc = {}) {
    return normalizeRecipe(doc);
  }

  prepareIngredients(ingredients = []) {
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      throw new Error('请至少添加一种原料');
    }

    return ingredients.map((item, index) => {
      const food = item.food || item.foodDoc || null;
      const foodName = item.foodName || food?.name || item.foodSnapshot?.name || '';
      let foodSnapshot = item.foodSnapshot;

      if (food) {
        foodSnapshot = FoodModel.buildFoodSnapshot(food);
      } else if (!foodSnapshot || !foodSnapshot.name) {
        throw new Error(`缺少原料「${foodName || index + 1}」的食物信息`);
      }

      return normalizeIngredient({
        foodId: item.foodId || food?._id || '',
        foodName: foodName || foodSnapshot?.name || '',
        quantity: 0,
        unit: item.unit || food?.baseUnit || foodSnapshot?.nutritionBasis?.unit || 'g',
        sortOrder: item.sortOrder,
        foodSnapshot,
        nutrition: emptyNutrition()
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

    const ingredients = this.prepareIngredients(merged.ingredients);
    const normalized = normalizeRecipe({
      ...merged,
      name,
      yieldWeightG: 0,
      ingredients,
      totalNutrition: emptyNutrition(),
      nutritionPer100g: emptyNutrition(),
      proteinSource: 'natural',
      steps: merged.steps,
      coverImageFileId: merged.coverImageFileId,
      prepTimeSec: merged.prepTimeSec,
      notes: merged.notes || ''
    });

    // 只写白名单字段，避免 ...doc 带入不可序列化/多余字段导致 add 失败或读回异常
    return {
      schemaVersion: normalized.schemaVersion || 1,
      recordType: 'recipe',
      status: normalized.status || 'active',
      babyUid: normalized.babyUid || '',
      name: normalized.name,
      notes: normalized.notes || '',
      yieldWeightG: 0,
      steps: Array.isArray(normalized.steps) ? normalized.steps : [],
      coverImageFileId: normalized.coverImageFileId || '',
      prepTimeSec: normalized.prepTimeSec === undefined ? null : normalized.prepTimeSec,
      ingredients: normalized.ingredients,
      totalNutrition: emptyNutrition(),
      nutritionPer100g: emptyNutrition(),
      proteinSource: 'natural',
      usageCount: toNumber(normalized.usageCount, 0),
      lastUsedAt: normalized.lastUsedAt === undefined ? null : normalized.lastUsedAt
    };
  }

  async getById(id) {
    try {
      if (!id) {
        return { success: false, message: '缺少食谱ID', data: null };
      }
      const res = await this.collection.doc(id).get();
      return { success: true, data: res?.data ? normalizeRecipe(res.data) : null };
    } catch (error) {
      return { success: false, message: error.errMsg || error.message || '查询失败', data: null };
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

      const app = typeof getApp === 'function' ? getApp() : null;
      const operatorOpenid = resolveOperatorOpenid({
        ...recipe,
        operatorOpenid: recipe.operatorOpenid
          || recipe.openid
          || app?.globalData?.openid
          || wx.getStorageSync('openid')
          || ''
      });
      const timestamp = this.db.serverDate();
      const payload = this.buildRecipePayload({
        ...recipe,
        babyUid,
        usageCount: 0,
        lastUsedAt: null
      });

      console.log('[recipe] create start', {
        babyUid,
        name: payload.name,
        ingredientCount: (payload.ingredients || []).length,
        hasOpenid: !!operatorOpenid
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

      const newId = result._id || result.id || '';
      console.log('[recipe] create add ok', { newId, errMsg: result.errMsg });
      let saved = null;
      let readable = false;
      if (newId) {
        const fetched = await this.getById(newId);
        console.log('[recipe] create getById after add', {
          success: fetched.success,
          message: fetched.message || '',
          hasData: !!fetched.data,
          dataBabyUid: fetched.data?.babyUid || '',
          dataName: fetched.data?.name || ''
        });
        if (fetched.success && fetched.data) {
          saved = fetched.data;
          readable = true;
        } else {
          // 写成功但读失败（常见于权限只开了写/控制台可见）：本地缓存兜底供选择页使用
          saved = normalizeRecipe({
            ...payload,
            _id: newId,
            status: 'active'
          });
          readable = false;
        }
        upsertRecipeCache(babyUid, saved);
        console.log('[recipe] create cache upsert', {
          babyUid,
          recipeId: saved._id,
          readable,
          cacheSize: readRecipeCache(babyUid).length
        });
      }

      return {
        success: true,
        data: result,
        recipe: saved,
        readable
      };
    } catch (error) {
      console.error('[recipe] create failed', error);
      const errMsg = error.errMsg || error.message || '创建失败';
      const message = /COLLECTION_NOT_EXIST|not exist/i.test(errMsg)
        ? '请先在云开发控制台创建 recipe_catalog 集合'
        : errMsg;
      return { success: false, message };
    }
  }

  async update(id, patch = {}, babyUid) {
    try {
      const ownedRecipe = await this.getOwnedRecipe(id, babyUid);
      const previousRecord = ownedRecipe.record;
      const expectedBabyUid = ownedRecipe.babyUid;

      const app = typeof getApp === 'function' ? getApp() : null;
      const operatorOpenid = resolveOperatorOpenid({
        ...patch,
        operatorOpenid: patch.operatorOpenid
          || app?.globalData?.openid
          || wx.getStorageSync('openid')
          || ''
      });
      const timestamp = this.db.serverDate();
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

      upsertRecipeCache(expectedBabyUid, {
        ...payload,
        _id: id,
        updatedAt: previousRecord.updatedAt
      });

      return { success: true, data: result };
    } catch (error) {
      console.error('更新食谱失败:', error);
      return { success: false, message: error.errMsg || error.message || '更新失败' };
    }
  }

  async softDelete(id, babyUid) {
    try {
      const ownedRecipe = await this.getOwnedRecipe(id, babyUid);
      const expectedBabyUid = ownedRecipe.babyUid;
      const app = typeof getApp === 'function' ? getApp() : null;
      const operatorOpenid = resolveOperatorOpenid({
        babyUid: expectedBabyUid,
        operatorOpenid: app?.globalData?.openid || wx.getStorageSync('openid') || ''
      });
      const timestamp = this.db.serverDate();
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
      removeRecipeCache(expectedBabyUid, id);
      return { success: true, data: result };
    } catch (error) {
      console.error('删除食谱失败:', error);
      return { success: false, message: error.errMsg || error.message || '删除失败' };
    }
  }

  async listActiveByBaby(babyUid) {
    const app = typeof getApp === 'function' ? getApp() : null;
    console.log('[recipe] listActiveByBaby start', {
      babyUid,
      babyUidType: typeof babyUid,
      globalBabyUid: app?.globalData?.babyUid || '',
      storageBabyUid: wx.getStorageSync('baby_uid') || '',
      cloudEnvId: app?.globalData?.cloudEnvId || ''
    });

    try {
      if (!babyUid) {
        console.warn('[recipe] listActiveByBaby skip: empty babyUid');
        return { success: true, data: [], fromCache: false };
      }

      const cached = readRecipeCache(babyUid);
      console.log('[recipe] listActiveByBaby cache', {
        size: cached.length,
        ids: cached.map((item) => item._id),
        names: cached.map((item) => item.name)
      });

      let remote = [];
      let remoteError = null;
      let rawRowCount = 0;

      try {
        // 只按 babyUid 查：多字段 where / orderBy 在新集合上常因缺复合索引直接失败
        const pageSize = 20;
        let skip = 0;
        let hasMore = true;
        const rows = [];
        const _ = this.db.command;
        while (hasMore) {
          console.log('[recipe] listActiveByBaby query page', { skip, pageSize, babyUid });
          const result = await this.collection
            .where({ babyUid: _.eq(babyUid) })
            .skip(skip)
            .limit(pageSize)
            .get();
          const batch = result.data || [];
          console.log('[recipe] listActiveByBaby query page result', {
            skip,
            batchSize: batch.length,
            errMsg: result.errMsg || '',
            sample: batch.slice(0, 3).map((item) => ({
              _id: item._id,
              name: item.name,
              babyUid: item.babyUid,
              status: item.status,
              babyUidMatch: item.babyUid === babyUid
            }))
          });
          rows.push(...batch);
          hasMore = batch.length === pageSize;
          skip += batch.length;
        }

        rawRowCount = rows.length;
        const inactiveCount = rows.filter((item) => item.status && item.status !== 'active').length;
        remote = rows
          .filter((item) => !item.status || item.status === 'active')
          .map((item) => normalizeRecipe(item));
        console.log('[recipe] listActiveByBaby remote normalized', {
          rawRowCount,
          inactiveCount,
          activeCount: remote.length,
          ids: remote.map((item) => item._id),
          names: remote.map((item) => item.name)
        });
      } catch (error) {
        remoteError = error;
        console.error('[recipe] listActiveByBaby remote query error', {
          errMsg: error.errMsg || '',
          message: error.message || '',
          errCode: error.errCode,
          error
        });
      }

      if (remote.length) {
        writeRecipeCache(babyUid, remote);
        console.log('[recipe] listActiveByBaby return remote', { count: remote.length });
        return { success: true, data: remote, fromCache: false };
      }

      // 云查询成功但为空，或查询失败：用本地缓存兜底，避免「控制台有、选择页无」
      const merged = mergeRecipeLists(remote, cached);
      if (merged.length) {
        console.warn('[recipe] listActiveByBaby return cache fallback', {
          count: merged.length,
          rawRowCount,
          remoteError: remoteError ? (remoteError.errMsg || remoteError.message) : ''
        });
        return {
          success: true,
          data: merged,
          fromCache: true,
          message: remoteError
            ? (remoteError.errMsg || remoteError.message || '云查询失败，已使用本地缓存')
            : ''
        };
      }

      if (remoteError) {
        const errMsg = remoteError.errMsg || remoteError.message || '查询失败';
        const hint = /COLLECTION_NOT_EXIST|not exist/i.test(errMsg)
          ? '请先在云开发控制台创建 recipe_catalog 集合'
          : errMsg;
        console.error('[recipe] listActiveByBaby fail', { hint });
        return { success: false, message: hint, data: [], fromCache: false };
      }

      console.warn('[recipe] listActiveByBaby empty', {
        babyUid,
        rawRowCount,
        cacheSize: cached.length
      });
      return { success: true, data: [], fromCache: false };
    } catch (error) {
      console.error('[recipe] listActiveByBaby unexpected error', error);
      const cached = readRecipeCache(babyUid);
      if (cached.length) {
        console.warn('[recipe] listActiveByBaby unexpected -> cache', { count: cached.length });
        return {
          success: true,
          data: cached,
          fromCache: true,
          message: error.errMsg || error.message || '云查询失败，已使用本地缓存'
        };
      }
      const errMsg = error.errMsg || error.message || '查询失败';
      const hint = /COLLECTION_NOT_EXIST|not exist/i.test(errMsg)
        ? '请先在云开发控制台创建 recipe_catalog 集合'
        : errMsg;
      return { success: false, message: hint, data: [], fromCache: false };
    }
  }

  async touchUsage(id, babyUid) {
    try {
      const ownedRecipe = await this.getOwnedRecipe(id, babyUid);
      const expectedBabyUid = ownedRecipe.babyUid;
      const app = typeof getApp === 'function' ? getApp() : null;
      const operatorOpenid = resolveOperatorOpenid({
        babyUid: expectedBabyUid,
        operatorOpenid: app?.globalData?.openid || wx.getStorageSync('openid') || ''
      });
      const timestamp = this.db.serverDate();
      const result = await this.collection.doc(id).update({
        data: {
          usageCount: this.db.command.inc(1),
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
      return { success: false, message: error.errMsg || error.message || '更新失败' };
    }
  }
}

module.exports = new RecipeModel();
module.exports.normalizeRecipe = normalizeRecipe;
module.exports.readRecipeCache = readRecipeCache;
module.exports.upsertRecipeCache = upsertRecipeCache;
