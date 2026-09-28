// 一次性数据导入：把来源宝宝的库数据复制到目标宝宝。
// 复制完成后两边数据完全隔离、互不影响（区别于已废弃的 linkedBabyUids 实时共享）。
// 幂等设计：按业务 key 去重——食物看 sourceSystemFoodId 或 名称+分类，
// 食谱看名称，分类看 normalizedName，奶粉看 id/sourceSystemPowderId/名称；
// 中途失败或重复执行不会产生重复数据。

const IMPORT_TYPE_LABELS = {
  foods: '食物库',
  recipes: '食谱',
  powders: '奶粉档案',
  categories: '食物分类',
  nutrition: '配奶营养参数'
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
  return { imported: 0, skipped: 0, failed: 0 };
}

// 导入食物库，返回 { ...counts, idMap }；idMap 供食谱重连 ingredient.foodId 使用
async function importFoods(db, sourceBabyUid, targetBabyUid) {
  const FoodModel = require('../models/food');
  const counts = emptyCounts();
  const sourceFoods = await fetchAllByBabyUid('food_catalog', sourceBabyUid);
  const targetFoods = await fetchAllByBabyUid('food_catalog', targetBabyUid);
  const targetKeys = new Set(targetFoods.map(foodDedupKey));
  const idMap = new Map();

  for (const food of sourceFoods) {
    const key = foodDedupKey(food);
    if (targetKeys.has(key)) {
      counts.skipped += 1;
      const existing = targetFoods.find((item) => foodDedupKey(item) === key);
      if (existing?._id && food._id) idMap.set(food._id, existing._id);
      continue;
    }
    try {
      const { _id, _openid, createdAt, updatedAt, ...fields } = food;
      const newId = await FoodModel.createFood({
        ...fields,
        babyUid: targetBabyUid,
        sharedBabyUids: [targetBabyUid]
      });
      targetKeys.add(key);
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

async function importRecipes(db, sourceBabyUid, targetBabyUid, foodIdMap) {
  const RecipeModel = require('../pkg-records/models/recipe');
  const counts = emptyCounts();
  const sourceRecipes = await fetchAllByBabyUid('recipe_catalog', sourceBabyUid);
  const targetRecipes = await fetchAllByBabyUid('recipe_catalog', targetBabyUid);
  const targetNames = new Set(targetRecipes.map((recipe) => String(recipe.name || '').trim()));

  for (const recipe of sourceRecipes) {
    const name = String(recipe.name || '').trim();
    // 归档/删除的食谱不导入；同名食谱视为重复跳过
    if ((recipe.status || 'active') !== 'active' || !name || targetNames.has(name)) {
      counts.skipped += 1;
      continue;
    }
    try {
      const ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map((ingredient) => {
        // 原料营养在 foodSnapshot 快照里，foodId 仅作溯源引用；
        // 能映射到目标宝宝新食物就重连，否则置空避免悬空引用
        const mappedId = ingredient.foodId ? (foodIdMap.get(ingredient.foodId) || '') : '';
        return { ...ingredient, foodId: mappedId };
      });
      // RecipeModel.create 失败时返回 { success: false } 而不是抛异常，必须检查返回值
      const result = await RecipeModel.create({
        ...recipe,
        babyUid: targetBabyUid,
        ingredients
      });
      if (!result || result.success === false) {
        throw new Error((result && result.message) || '创建食谱失败');
      }
      targetNames.add(name);
      counts.imported += 1;
    } catch (error) {
      console.warn(`导入食谱失败（${name}）:`, error);
      counts.failed += 1;
    }
  }
  return counts;
}

async function importCategories(db, sourceBabyUid, targetBabyUid) {
  const FoodCategoryModel = require('../pkg-milk/models/foodCategory');
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
async function importNutritionProfile(sourceBabyUid, targetBabyUid, { includePowders, includeNutrition }) {
  const MilkNutritionProfileModel = require('../models/nutritionProfile');
  const counts = { powders: emptyCounts(), nutrition: { imported: 0 } };

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
    const targetIds = new Set(targetPowders.map((item) => item.id));
    const targetSources = new Set(targetPowders.map((item) => String(item.sourceSystemPowderId || '').trim()).filter(Boolean));
    const targetNames = new Set(targetPowders.map((item) => String(item.name || '').trim()).filter(Boolean));
    const sourcePowders = (Array.isArray(sourceSettings.formulaPowders) ? sourceSettings.formulaPowders : [])
      .filter((powder) => powder.status !== 'archived');

    for (const powder of sourcePowders) {
      const sourceId = String(powder.sourceSystemPowderId || '').trim();
      const name = String(powder.name || '').trim();
      if ((powder.id && targetIds.has(powder.id)) || (sourceId && targetSources.has(sourceId)) || (name && targetNames.has(name))) {
        counts.powders.skipped += 1;
        continue;
      }
      // 新 id 避免与目标档案内既有粉末主键冲突
      const id = `powder_import_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      targetPowders.push({ ...powder, id });
      targetIds.add(id);
      if (sourceId) targetSources.add(sourceId);
      if (name) targetNames.add(name);
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
 * @returns {Promise<Object>} 各类型 { imported, skipped, failed } 统计
 */
async function importBabyData(sourceBabyUid, targetBabyUid, types = {}) {
  if (!sourceBabyUid || !targetBabyUid || sourceBabyUid === targetBabyUid) {
    throw new Error('导入来源或目标宝宝无效');
  }
  const enabled = (key) => types[key] !== undefined ? !!types[key] : DEFAULT_IMPORT_TYPES.includes(key);
  const summary = {};
  const db = getDb();

  let foodIdMap = null;
  if (enabled('foods')) {
    const result = await importFoods(db, sourceBabyUid, targetBabyUid);
    foodIdMap = result.idMap;
    summary.foods = { imported: result.imported, skipped: result.skipped, failed: result.failed };
  }
  if (enabled('recipes')) {
    if (!foodIdMap) {
      foodIdMap = await buildFoodIdMapByKey(sourceBabyUid, targetBabyUid);
    }
    summary.recipes = await importRecipes(db, sourceBabyUid, targetBabyUid, foodIdMap);
  }
  if (enabled('categories')) {
    summary.categories = await importCategories(db, sourceBabyUid, targetBabyUid);
  }
  if (enabled('powders') || enabled('nutrition')) {
    const result = await importNutritionProfile(sourceBabyUid, targetBabyUid, {
      includePowders: enabled('powders'),
      includeNutrition: enabled('nutrition')
    });
    if (enabled('powders')) summary.powders = result.powders;
    if (enabled('nutrition')) summary.nutrition = result.nutrition;
  }
  return summary;
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
    const segments = [`${label} ${counts.imported} 项`];
    if (counts.skipped) segments.push(`跳过重复 ${counts.skipped}`);
    if (counts.failed) segments.push(`失败 ${counts.failed}`);
    parts.push(segments.join('，'));
  });
  return parts.join('；') || '没有需要导入的数据';
}

module.exports = {
  IMPORT_TYPE_LABELS,
  DEFAULT_IMPORT_TYPES,
  importBabyData,
  formatImportSummary,
  // 导出供单元测试
  foodDedupKey,
  fetchAllByBabyUid
};
