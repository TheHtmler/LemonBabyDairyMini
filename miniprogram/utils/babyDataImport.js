// 一次性数据导入：把来源宝宝的库数据复制到目标宝宝。
// 复制完成后两边数据完全隔离、互不影响（区别于已废弃的 linkedBabyUids 实时共享）。
// 幂等设计：按业务 key 去重——食物看 sourceSystemFoodId 或 名称+分类，
// 食谱看名称，分类看 normalizedName，奶粉看 id/sourceSystemPowderId/名称；
// 中途失败或重复执行不会产生重复数据。

const IMPORT_TYPE_LABELS = {
  foods: '食物库',
  recipes: '食谱',
  powders: '奶粉库',
  categories: '食物分类',
  nutrition: '母乳成分参数'
};

const DEFAULT_IMPORT_TYPES = ['foods', 'recipes', 'powders', 'categories'];

function getAppSafe() {
  return typeof getApp === 'function' ? getApp() : null;
}

function getDb() {
  const app = getAppSafe();
  if (app?.globalData?.cloudEnvId && wx.cloud?.database) {
    return wx.cloud.database({ env: app.globalData.cloudEnvId });
  }
  return wx.cloud.database();
}

// 注意：本文件在主包，只能 require 主包模块——主包同步 require 分包模块
// 在真机上会报 module is not defined（即使 wx.loadSubpackage 已下载分包）。
// 因此 recipe / foodCategory 模型已迁至主包 models/ 目录。

// 客户端单次 get 最多 20 条，skip 分页拉全量
async function fetchAllByBabyUid(collectionName, babyUid) {
  if (!babyUid) return [];
  const db = getDb();
  const pageSize = 20;
  let offset = 0;
  const all = [];
  for (;;) {
    const res = await db.collection(collectionName)
      .where({ babyUid })
      .skip(offset)
      .limit(pageSize)
      .get();
    const batch = (res && res.data) || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }
  return all;
}

function foodDedupKey(food = {}) {
  const sourceId = String(food.sourceSystemFoodId || '').trim();
  if (sourceId) return `sys:${sourceId}`;
  return `name:${String(food.name || '').trim()}|${String(food.category || '').trim()}`;
}

function emptyCounts() {
  return { imported: 0, updated: 0, skipped: 0, failed: 0 };
}

// 导入食物库，返回 { ...counts, idMap }；idMap 供食谱重连 ingredient.foodId 使用。
// strategy='overwrite' 时命中已有条目则原地更新内容（保留目标 _id，
// 目标宝宝食谱里对该食物的 foodId 引用不会断）。
async function importFoods(db, sourceBabyUid, targetBabyUid, strategy = 'skip') {
  const FoodModel = require('../models/food');
  const counts = emptyCounts();
  const sourceFoods = await fetchAllByBabyUid('food_catalog', sourceBabyUid);
  const targetFoods = await fetchAllByBabyUid('food_catalog', targetBabyUid);
  const targetByKey = new Map();
  targetFoods.forEach((food) => targetByKey.set(foodDedupKey(food), food));
  const idMap = new Map();

  for (const food of sourceFoods) {
    const key = foodDedupKey(food);
    const existing = targetByKey.get(key);
    const { _id, _openid, createdAt, updatedAt, ...fields } = food;
    if (existing) {
      if (food._id && existing._id) idMap.set(food._id, existing._id);
      if (strategy === 'overwrite') {
        try {
          await FoodModel.updateFood(existing._id, { ...fields, babyUid: targetBabyUid }, targetBabyUid);
          counts.updated += 1;
        } catch (error) {
          console.warn(`更新食物失败（${food.name || food._id}）:`, error);
          counts.failed += 1;
        }
      } else {
        counts.skipped += 1;
      }
      continue;
    }
    try {
      const newId = await FoodModel.createFood({
        ...fields,
        babyUid: targetBabyUid,
        sharedBabyUids: [targetBabyUid]
      });
      // 防止来源库内存在同 key 重复条目时被重复创建
      targetByKey.set(key, { _id: newId });
      if (food._id && newId) idMap.set(food._id, newId);
      counts.imported += 1;
    } catch (error) {
      console.warn(`导入食物失败（${food.name || food._id}）:`, error);
      counts.failed += 1;
    }
  }
  return { ...counts, idMap };
}

// 未同批导入食物时，按业务 key 反查目标食物，尽量重连食谱原料的食物引用
async function buildFoodIdMapByKey(sourceBabyUid, targetBabyUid) {
  const sourceFoods = await fetchAllByBabyUid('food_catalog', sourceBabyUid);
  const targetFoods = await fetchAllByBabyUid('food_catalog', targetBabyUid);
  const targetIdByKey = new Map(targetFoods.map((food) => [foodDedupKey(food), food._id]));
  const idMap = new Map();
  sourceFoods.forEach((food) => {
    const targetId = targetIdByKey.get(foodDedupKey(food));
    if (food._id && targetId) idMap.set(food._id, targetId);
  });
  return idMap;
}

async function importRecipes(db, sourceBabyUid, targetBabyUid, foodIdMap, strategy = 'skip') {
  const RecipeModel = require('../models/recipe');
  const counts = emptyCounts();
  const sourceRecipes = await fetchAllByBabyUid('recipe_catalog', sourceBabyUid);
  const targetRecipes = await fetchAllByBabyUid('recipe_catalog', targetBabyUid);
  const targetByName = new Map();
  targetRecipes.forEach((recipe) => {
    const name = String(recipe.name || '').trim();
    if (name) targetByName.set(name, recipe);
  });

  for (const recipe of sourceRecipes) {
    const name = String(recipe.name || '').trim();
    // 归档/删除的食谱不导入
    if ((recipe.status || 'active') !== 'active' || !name) {
      counts.skipped += 1;
      continue;
    }
    const ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient) => {
      // 原料营养在 foodSnapshot 快照里，foodId 仅作溯源引用；
      // 能映射到目标宝宝新食物就重连，否则置空避免悬空引用
      const mappedId = ingredient.foodId ? (foodIdMap.get(ingredient.foodId) || '') : '';
      return { ...ingredient, foodId: mappedId };
    });
    const existing = targetByName.get(name);
    if (existing) {
      if (strategy === 'overwrite') {
        try {
          // update 内部会保留目标食谱的 _id / usageCount / lastUsedAt，只刷新内容
          const result = await RecipeModel.update(existing._id, { ...recipe, ingredients }, targetBabyUid);
          if (!result || result.success === false) {
            throw new Error((result && result.message) || '更新食谱失败');
          }
          counts.updated += 1;
        } catch (error) {
          console.warn(`更新食谱失败（${name}）:`, error);
          counts.failed += 1;
        }
      } else {
        counts.skipped += 1;
      }
      continue;
    }
    try {
      // RecipeModel.create 失败时返回 { success: false } 而不是抛异常，必须检查返回值
      const result = await RecipeModel.create({
        ...recipe,
        babyUid: targetBabyUid,
        ingredients
      });
      if (!result || result.success === false) {
        throw new Error((result && result.message) || '创建食谱失败');
      }
      targetByName.set(name, { _id: (result.data && result.data._id) || '' });
      counts.imported += 1;
    } catch (error) {
      console.warn(`导入食谱失败（${name}）:`, error);
      counts.failed += 1;
    }
  }
  return counts;
}

async function importCategories(db, sourceBabyUid, targetBabyUid) {
  const FoodCategoryModel = require('../models/foodCategory');
  const counts = emptyCounts();
  const sourceCategories = await fetchAllByBabyUid('food_categories', sourceBabyUid);
  const targetCategories = await fetchAllByBabyUid('food_categories', targetBabyUid);
  const targetKeys = new Set(targetCategories.map((item) => String(item.normalizedName || item.name || '').toLowerCase()));

  for (const category of sourceCategories) {
    const name = String(category.name || '').trim();
    const key = String(category.normalizedName || name).toLowerCase();
    if (!name || targetKeys.has(key)) {
      counts.skipped += 1;
      continue;
    }
    try {
      // addCategory 内部按 normalizedName upsert，天然幂等
      await FoodCategoryModel.addCategory(name, { babyUid: targetBabyUid, createdBy: category.createdBy || '' });
      targetKeys.add(key);
      counts.imported += 1;
    } catch (error) {
      console.warn(`导入食物分类失败（${name}）:`, error);
      counts.failed += 1;
    }
  }
  return counts;
}

// 奶粉档案与配奶营养参数同存于 milk_nutrition_profiles，合并为一次写入。
// 营养参数只复制母乳成分（natural_milk_*）；天然蛋白系数因宝宝个体而异（医嘱），不复制。
// strategy='overwrite' 时命中已有奶粉则更新其营养/冲配数据（保留目标档案内的 id）。
async function importNutritionProfile(sourceBabyUid, targetBabyUid, { includePowders, includeNutrition, strategy = 'skip' }) {
  const MilkNutritionProfileModel = require('../models/nutritionProfile');
  const counts = { powders: emptyCounts(), nutrition: { imported: 0, updated: 0 } };

  const sourceSettings = await MilkNutritionProfileModel.getNutritionProfileSettings(sourceBabyUid, {
    includeLegacyFallback: true,
    throwOnError: false
  });
  if (!sourceSettings) return counts;

  const targetSettings = await MilkNutritionProfileModel.ensureNutritionProfileSettings(targetBabyUid);
  const nextSettings = { ...(targetSettings || {}) };

  if (includeNutrition) {
    ['natural_milk_protein', 'natural_milk_calories', 'natural_milk_fat', 'natural_milk_carbs', 'natural_milk_fiber']
      .forEach((field) => {
        if (sourceSettings[field] !== '' && sourceSettings[field] !== undefined && sourceSettings[field] !== null) {
          nextSettings[field] = sourceSettings[field];
        }
      });
    counts.nutrition.imported = 1;
  }

  if (includePowders) {
    const targetPowders = Array.isArray(nextSettings.formulaPowders) ? [...nextSettings.formulaPowders] : [];
    const sourcePowders = (Array.isArray(sourceSettings.formulaPowders) ? sourceSettings.formulaPowders : [])
      .filter((powder) => powder.status !== 'archived');

    const matchIndex = (powder) => {
      const sourceId = String(powder.sourceSystemPowderId || '').trim();
      const name = String(powder.name || '').trim();
      return targetPowders.findIndex((item) => (
        (powder.id && item.id === powder.id)
        || (sourceId && String(item.sourceSystemPowderId || '').trim() === sourceId)
        || (name && String(item.name || '').trim() === name)
      ));
    };

    for (const powder of sourcePowders) {
      const index = matchIndex(powder);
      if (index >= 0) {
        if (strategy === 'overwrite') {
          // 保留目标档案内的 id，避免引用这罐奶粉的记录断链
          targetPowders[index] = { ...powder, id: targetPowders[index].id };
          counts.powders.updated += 1;
        } else {
          counts.powders.skipped += 1;
        }
        continue;
      }
      // 新 id 避免与目标档案内既有粉末主键冲突
      const id = `powder_import_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      targetPowders.push({ ...powder, id });
      counts.powders.imported += 1;
    }
    nextSettings.formulaPowders = targetPowders;
  }

  const success = await MilkNutritionProfileModel.updateNutritionProfileSettings(targetBabyUid, nextSettings);
  if (!success) {
    throw new Error('写入配奶档案失败');
  }
  return counts;
}

/**
 * 从来源宝宝导入数据到目标宝宝
 * @param {string} sourceBabyUid
 * @param {string} targetBabyUid
 * @param {Object} types 勾选的数据类型，缺省为 DEFAULT_IMPORT_TYPES 全开
 * @param {Object} options conflictStrategy: 'skip'（默认，已有条目不动）| 'overwrite'（以来源为准覆盖已有条目内容）
 * @returns {Promise<Object>} 各类型 { imported, updated, skipped, failed } 统计
 */
async function importBabyData(sourceBabyUid, targetBabyUid, types = {}, options = {}) {
  if (!sourceBabyUid || !targetBabyUid || sourceBabyUid === targetBabyUid) {
    throw new Error('导入来源或目标宝宝无效');
  }
  const strategy = options.conflictStrategy === 'overwrite' ? 'overwrite' : 'skip';
  const enabled = (key) => types[key] !== undefined ? !!types[key] : DEFAULT_IMPORT_TYPES.includes(key);
  const summary = {};
  const db = getDb();

  let foodIdMap = null;
  if (enabled('foods')) {
    const result = await importFoods(db, sourceBabyUid, targetBabyUid, strategy);
    foodIdMap = result.idMap;
    summary.foods = { imported: result.imported, updated: result.updated, skipped: result.skipped, failed: result.failed };
  }
  if (enabled('recipes')) {
    if (!foodIdMap) {
      foodIdMap = await buildFoodIdMapByKey(sourceBabyUid, targetBabyUid);
    }
    summary.recipes = await importRecipes(db, sourceBabyUid, targetBabyUid, foodIdMap, strategy);
  }
  if (enabled('categories')) {
    summary.categories = await importCategories(db, sourceBabyUid, targetBabyUid);
  }
  if (enabled('powders') || enabled('nutrition')) {
    const result = await importNutritionProfile(sourceBabyUid, targetBabyUid, {
      includePowders: enabled('powders'),
      includeNutrition: enabled('nutrition'),
      strategy
    });
    if (enabled('powders')) summary.powders = result.powders;
    if (enabled('nutrition')) summary.nutrition = result.nutrition;
  }
  recordLibraryImport(targetBabyUid, sourceBabyUid);
  return summary;
}

// ---- 更新提醒 ----
// 导入完成后在本地记录「上次从某来源导入的时间」；
// 之后进入库管理页时对比来源库最新记录的 updatedAt，有新变化则提示再同步。
// 只对「曾经导入过的来源」提醒：从未导入过的来源视为无意关联，不打扰。

function importLogKey(targetBabyUid) {
  return `baby_import_log_${targetBabyUid}`;
}

function recordLibraryImport(targetBabyUid, sourceBabyUid) {
  try {
    const log = wx.getStorageSync(importLogKey(targetBabyUid)) || {};
    log[sourceBabyUid] = Date.now();
    wx.setStorageSync(importLogKey(targetBabyUid), log);
  } catch (error) {
    console.warn('记录导入时间失败（已忽略）:', error);
  }
}

function toTimestamp(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (typeof value === 'number') return value;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * 检查指定库（集合）在「曾经导入过的来源宝宝」那里是否有更新
 * @param {string} targetBabyUid 当前宝宝
 * @param {string} collectionName 库对应集合（food_catalog / recipe_catalog / milk_nutrition_profiles）
 * @returns {Promise<Array>} 有更新的来源宝宝列表 [{ babyUid, name, latestUpdatedAt }]
 */
async function getLibraryUpdateHints(targetBabyUid, collectionName) {
  if (!targetBabyUid || !collectionName) return [];
  let log = {};
  try {
    log = wx.getStorageSync(importLogKey(targetBabyUid)) || {};
  } catch (error) {
    return [];
  }
  const loggedSourceUids = Object.keys(log).filter((uid) => uid && uid !== targetBabyUid);
  if (!loggedSourceUids.length) return [];

  try {
    const { listAccessibleBabies } = require('./babyAccount');
    const sources = (await listAccessibleBabies())
      .filter((baby) => loggedSourceUids.includes(baby.babyUid));
    const db = getDb();
    const hints = [];
    for (const source of sources) {
      try {
        const res = await db.collection(collectionName)
          .where({ babyUid: source.babyUid })
          .orderBy('updatedAt', 'desc')
          .limit(1)
          .get();
        const latestUpdatedAt = toTimestamp(res?.data?.[0]?.updatedAt);
        if (latestUpdatedAt && latestUpdatedAt > (log[source.babyUid] || 0)) {
          hints.push({
            babyUid: source.babyUid,
            name: source.name || '宝宝',
            latestUpdatedAt
          });
        }
      } catch (error) {
        console.warn(`检查来源宝宝库更新失败（${source.babyUid}）:`, error);
      }
    }
    return hints;
  } catch (error) {
    console.warn('检查库更新失败:', error);
    return [];
  }
}

// 把导入统计格式化成一行人类可读结果，供 toast / modal 展示
function formatImportSummary(summary = {}) {
  const parts = [];
  Object.keys(IMPORT_TYPE_LABELS).forEach((key) => {
    const counts = summary[key];
    if (!counts) return;
    const label = IMPORT_TYPE_LABELS[key];
    if (key === 'nutrition') {
      if (counts.imported) parts.push(`${label}已导入`);
      return;
    }
    const segments = [];
    if (counts.imported) segments.push(`新增 ${counts.imported}`);
    if (counts.updated) segments.push(`更新 ${counts.updated}`);
    if (counts.skipped) segments.push(`跳过重复 ${counts.skipped}`);
    if (counts.failed) segments.push(`失败 ${counts.failed}`);
    parts.push(`${label}：${segments.length ? segments.join('，') : '无变化'}`);
  });
  return parts.join('；') || '没有需要导入的数据';
}

module.exports = {
  IMPORT_TYPE_LABELS,
  DEFAULT_IMPORT_TYPES,
  importBabyData,
  formatImportSummary,
  getLibraryUpdateHints,
  recordLibraryImport,
  // 导出供单元测试
  foodDedupKey,
  fetchAllByBabyUid
};
