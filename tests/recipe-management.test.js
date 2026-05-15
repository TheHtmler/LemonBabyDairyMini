const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadRecipeModel(options = {}) {
  const modelPath = require.resolve('../miniprogram/models/recipe.js');
  delete require.cache[modelPath];

  const previousWx = global.wx;
  const writes = [];
  const updates = [];
  const lists = options.listData || [];

  global.wx = {
    cloud: {
      database() {
        return {
          command: {
            eq: (value) => ({ $eq: value }),
            neq: (value) => ({ $neq: value }),
            inc: (value) => ({ $inc: value })
          },
          serverDate() {
            return '__server_date__';
          },
          collection() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      get: async () => ({ data: lists })
                    };
                  },
                  limit() {
                    return {
                      get: async () => ({ data: lists.slice(0, 1) })
                    };
                  },
                  get: async () => ({ data: lists })
                };
              },
              add: async ({ data }) => {
                writes.push(data);
                return { _id: 'recipe_created' };
              },
              doc(id) {
                return {
                  update: async ({ data }) => {
                    updates.push({ id, data });
                    return { stats: { updated: 1 } };
                  }
                };
              }
            };
          }
        };
      }
    }
  };

  const model = require(modelPath);
  global.wx = previousWx;

  return {
    model,
    writes,
    updates
  };
}

function loadRecipeManagementPage(options = {}) {
  const pagePath = require.resolve('../miniprogram/pages/recipe-management/index.js');
  const recipeModelPath = require.resolve('../miniprogram/models/recipe.js');
  const foodModelPath = require.resolve('../miniprogram/models/food.js');
  const utilsPath = require.resolve('../miniprogram/utils/index.js');

  delete require.cache[pagePath];
  delete require.cache[recipeModelPath];
  delete require.cache[foodModelPath];
  delete require.cache[utilsPath];

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  let pageConfig = null;

  global.wx = {
    showToast() {},
    showModal() {},
    showLoading() {},
    hideLoading() {},
    navigateBack() {},
    cloud: {
      database() {
        return {
          command: {
            eq: (value) => ({ $eq: value }),
            neq: (value) => ({ $neq: value }),
            inc: (value) => ({ $inc: value })
          },
          serverDate() {
            return '__server_date__';
          },
          collection() {
            return {};
          }
        };
      }
    }
  };
  global.getApp = () => ({ globalData: {} });
  global.Page = (config) => {
    pageConfig = config;
  };

  const recipeModel = require(recipeModelPath);
  const foodModel = require(foodModelPath);
  const utilsModule = require(utilsPath);

  const previousListRecipes = recipeModel.listRecipes;
  const previousCreateRecipe = recipeModel.createRecipe;
  const previousUpdateRecipe = recipeModel.updateRecipe;
  const previousDeleteRecipe = recipeModel.deleteRecipe;
  const previousFoods = foodModel.getAvailableFoods;
  const previousResolveFoods = foodModel.resolveFoodImageUrls;
  const previousWait = utilsModule.waitForAppInitialization;
  const previousGetBabyUid = utilsModule.getBabyUid;

  recipeModel.listRecipes = options.listRecipes || (async () => []);
  recipeModel.createRecipe = options.createRecipe || (async () => 'recipe_created');
  recipeModel.updateRecipe = options.updateRecipe || (async () => true);
  recipeModel.deleteRecipe = options.deleteRecipe || (async () => true);
  foodModel.getAvailableFoods = options.getAvailableFoods || (async () => []);
  foodModel.resolveFoodImageUrls = options.resolveFoodImageUrls || (async (foods) => foods);
  utilsModule.waitForAppInitialization = options.waitForAppInitialization || (async () => true);
  utilsModule.getBabyUid = options.getBabyUid || (() => 'baby_1');

  require(pagePath);
  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;

  return {
    pageConfig,
    cleanup() {
      recipeModel.listRecipes = previousListRecipes;
      recipeModel.createRecipe = previousCreateRecipe;
      recipeModel.updateRecipe = previousUpdateRecipe;
      recipeModel.deleteRecipe = previousDeleteRecipe;
      foodModel.getAvailableFoods = previousFoods;
      foodModel.resolveFoodImageUrls = previousResolveFoods;
      utilsModule.waitForAppInitialization = previousWait;
      utilsModule.getBabyUid = previousGetBabyUid;
    }
  };
}

function createPageInstance(page) {
  return {
    ...page,
    data: JSON.parse(JSON.stringify(page.data)),
    setData(patch, callback) {
      const nextData = { ...this.data };
      Object.keys(patch || {}).forEach((key) => {
        const segments = key.split('.');
        let cursor = nextData;
        while (segments.length > 1) {
          const segment = segments.shift();
          cursor[segment] = cursor[segment] || {};
          cursor = cursor[segment];
        }
        cursor[segments[0]] = patch[key];
      });
      this.data = nextData;
      if (callback) callback();
    }
  };
}

test('recipe management route and files are registered', () => {
  const appJson = fs.readFileSync('miniprogram/app.json', 'utf8');
  const pageJson = fs.readFileSync('miniprogram/pages/recipe-management/index.json', 'utf8');

  assert.match(appJson, /"pages\/recipe-management\/index"/);
  assert.ok(fs.existsSync('miniprogram/pages/recipe-management/index.js'));
  assert.ok(fs.existsSync('miniprogram/pages/recipe-management/index.wxml'));
  assert.ok(fs.existsSync('miniprogram/pages/recipe-management/index.wxss'));
  assert.ok(fs.existsSync('miniprogram/pages/recipe-management/index.json'));
  assert.match(pageJson, /"navigationBarTitleText": "食谱管理"/);
});

test('recipe model exposes CRUD helpers and normalizes create payload', async () => {
  const { model, writes } = loadRecipeModel();

  assert.equal(typeof model.listRecipes, 'function');
  assert.equal(typeof model.createRecipe, 'function');
  assert.equal(typeof model.updateRecipe, 'function');
  assert.equal(typeof model.deleteRecipe, 'function');
  assert.equal(typeof model.touchRecipeUsage, 'function');

  const recipeId = await model.createRecipe({
    babyUid: 'baby_1',
    name: '早餐模板',
    note: '常用早餐',
    items: [{ foodId: 'A', baseQuantity: 10 }],
    createdFrom: { mealBatchId: 'meal_1' }
  });

  assert.equal(recipeId, 'recipe_created');
  assert.deepEqual(writes[0], {
    babyUid: 'baby_1',
    name: '早餐模板',
    note: '常用早餐',
    items: [{
      foodId: 'A',
      nameSnapshot: '',
      category: '',
      unit: 'g',
      baseQuantity: 10,
      nutritionSnapshot: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sodium: 0
      },
      proteinSource: 'natural',
      proteinQuality: '',
      naturalProtein: 0,
      specialProtein: 0
    }],
    createdFrom: { mealBatchId: 'meal_1' },
    useCount: 0,
    status: 'active',
    createdAt: '__server_date__',
    updatedAt: '__server_date__'
  });
});

test('recipe management page loads recipes and food catalog into editor state', async () => {
  const { pageConfig, cleanup } = loadRecipeManagementPage({
    listRecipes: async () => [{ _id: 'recipe_1', name: '早餐模板', items: [] }],
    getAvailableFoods: async () => [{ _id: 'food_1', name: '米粉', baseUnit: 'g', baseQuantity: 100 }]
  });
  const instance = createPageInstance(pageConfig);

  await instance.onLoad();

  assert.equal(instance.data.babyUid, 'baby_1');
  assert.equal(instance.data.recipes.length, 1);
  assert.equal(instance.data.recipes[0].name, '早餐模板');
  assert.equal(instance.data.foodCatalog.length, 1);
  assert.equal(instance.data.foodCatalog[0].name, '米粉');

  cleanup();
});

test('recipe management page source includes list, empty state, editor form, and food item controls', () => {
  const source = fs.readFileSync('miniprogram/pages/recipe-management/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/recipe-management/index.wxml', 'utf8');

  assert.match(source, /loadRecipes\(/);
  assert.match(source, /loadFoodCatalog\(/);
  assert.match(source, /openCreateRecipe\(/);
  assert.match(source, /addFoodToDraft\(/);
  assert.match(source, /removeDraftItem\(/);
  assert.match(source, /saveRecipe\(/);

  assert.match(wxml, /recipe-list/);
  assert.match(wxml, /recipe-empty/);
  assert.match(wxml, /recipe-editor/);
  assert.match(wxml, /placeholder="请输入食谱名称"/);
  assert.match(wxml, /placeholder="可选，记录这个食谱的说明"/);
  assert.match(wxml, /draft-item-list/);
  assert.match(wxml, /food-option-list/);
  assert.match(wxml, /bindtap="addFoodToDraft"/);
  assert.match(wxml, /bindtap="removeDraftItem"/);
});
