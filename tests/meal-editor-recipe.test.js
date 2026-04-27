const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadMealEditorPage(options = {}) {
  const pagePath = require.resolve('../miniprogram/pages/meal-editor/index.js');
  const foodModelPath = require.resolve('../miniprogram/models/food.js');
  const recipeModelPath = require.resolve('../miniprogram/models/recipe.js');
  const storePath = require.resolve('../miniprogram/utils/feedingRecordStore.js');
  const utilsPath = require.resolve('../miniprogram/utils/index.js');

  delete require.cache[pagePath];
  delete require.cache[foodModelPath];
  delete require.cache[recipeModelPath];
  delete require.cache[storePath];
  delete require.cache[utilsPath];

  let pageConfig = null;
  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;

  global.wx = {
    cloud: {
      database() {
        return {
          command: {
            gte: (value) => ({ $gte: value }),
            lt: (value) => ({ $lt: value })
          },
          collection() {
            return {
              where() {
                return {
                  get: async () => ({ data: [] }),
                  orderBy() {
                    return {
                      limit() {
                        return {
                          get: async () => ({ data: [] })
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    },
    showToast() {},
    showModal() {},
    showLoading() {},
    hideLoading() {},
    navigateTo() {},
    navigateBack() {},
    previewImage() {},
    getStorageSync() {
      return '';
    }
  };
  global.getApp = () => ({ globalData: {} });
  global.Page = (config) => {
    pageConfig = config;
  };

  const FoodModel = require(foodModelPath);
  const RecipeModel = require(recipeModelPath);
  const storeModule = require(storePath);
  const utilsModule = require(utilsPath);

  const previousFoods = FoodModel.getAvailableFoods;
  const previousResolveFoods = FoodModel.resolveFoodImageUrls;
  const previousRecipes = RecipeModel.listRecipes;
  const previousFindOrCreate = storeModule.findOrCreateDailyRecord;
  const previousGetBabyUid = utilsModule.getBabyUid;

  FoodModel.getAvailableFoods = options.getAvailableFoods || (async () => []);
  FoodModel.resolveFoodImageUrls = options.resolveFoodImageUrls || (async (foods) => foods);
  RecipeModel.listRecipes = options.listRecipes || (async () => []);
  storeModule.findOrCreateDailyRecord = options.findOrCreateDailyRecord || (async () => ({ recordId: 'record_1' }));
  utilsModule.getBabyUid = options.getBabyUid || (() => 'baby_1');

  require(pagePath);

  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;

  return {
    pageConfig,
    cleanup() {
      FoodModel.getAvailableFoods = previousFoods;
      FoodModel.resolveFoodImageUrls = previousResolveFoods;
      RecipeModel.listRecipes = previousRecipes;
      storeModule.findOrCreateDailyRecord = previousFindOrCreate;
      utilsModule.getBabyUid = previousGetBabyUid;
    }
  };
}

function createPageInstance(page, overrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data)),
      ...overrides
    },
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

test('meal-editor source includes recipe entry, management link, and consumed ratio state', () => {
  const source = fs.readFileSync('miniprogram/pages/meal-editor/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/meal-editor/index.wxml', 'utf8');

  assert.match(source, /recipeCatalog:\s*\[\]/);
  assert.match(source, /showRecipePicker:\s*false/);
  assert.match(source, /selectedRecipeId:\s*''/);
  assert.match(source, /recipeConsumedRatioInput:\s*'100'/);
  assert.match(source, /loadRecipeCatalog\(/);
  assert.match(source, /openRecipePicker\(/);
  assert.match(source, /navigateToRecipeManagement\(/);
  assert.match(source, /applyRecipeToMeal\(/);

  assert.match(wxml, /从食谱添加/);
  assert.match(wxml, /bindtap="openRecipePicker"/);
  assert.match(wxml, /bindtap="navigateToRecipeManagement"/);
  assert.match(wxml, /recipeConsumedRatioInput/);
});

test('meal-editor applies a recipe into mealDraft items using the consumed ratio', () => {
  const { pageConfig, cleanup } = loadMealEditorPage();
  const instance = createPageInstance(pageConfig, {
    foodCatalog: [
      { _id: 'food_a', name: '食物A', category: '主食', baseUnit: 'g', proteinSource: 'natural', proteinQuality: 'premium' }
    ],
    mealDraft: {
      mealTime: '08:00',
      mealLabel: '早餐',
      mealNote: '',
      items: []
    }
  });

  instance.applyRecipeToMeal({
    _id: 'recipe_1',
    name: '早餐模板',
    items: [
      {
        foodId: 'food_a',
        nameSnapshot: '食物A',
        category: '主食',
        unit: 'g',
        baseQuantity: 10,
        nutritionSnapshot: { calories: 100, protein: 2, carbs: 5, fat: 1, fiber: 0.3, sodium: 2 },
        proteinSource: 'natural',
        proteinQuality: 'premium',
        naturalProtein: 2,
        specialProtein: 0
      }
    ]
  }, 0.7);

  assert.equal(instance.data.mealDraft.items.length, 1);
  assert.equal(instance.data.mealDraft.items[0].quantity, 7);
  assert.equal(instance.data.mealDraft.items[0].recipeBaseQuantity, 10);
  assert.equal(instance.data.mealDraft.items[0].nutrition.calories, 70);
  assert.equal(instance.data.mealDraft.items[0].naturalProtein, 1.4);
  assert.equal(instance.data.mealDraft.recipeContext.recipeId, 'recipe_1');
  assert.equal(instance.data.mealDraft.recipeContext.recipeNameSnapshot, '早餐模板');
  assert.equal(instance.data.mealDraft.recipeContext.consumedRatio, 0.7);
  assert.equal(instance.data.recipeConsumedRatioInput, '70');

  cleanup();
});
