const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function setPath(target, path, value) {
  const segments = path.split('.');
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

function applyPatch(target, patch) {
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key.includes('.')) {
      setPath(target, key, value);
      return;
    }
    target[key] = value;
  });
}

function createPageInstance(page, overrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data || {})),
      ...overrides
    },
    setData(patch, callback) {
      applyPatch(this.data, patch);
      if (callback) callback();
    }
  };
}

function createDefaultWx() {
  return {
    cloud: {
      database() {
        return {
          command: {
            gte: (value) => ({ $gte: value }),
            lte: (value) => ({ $lte: value }),
            lt: (value) => ({ $lt: value }),
            eq: (value) => ({ $eq: value }),
            in: (value) => ({ $in: value }),
            or: (value) => ({ $or: value }),
            push: (value) => value
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
                      limit() {
                        return {
                          get: async () => ({ data: [] })
                        };
                      }
                    };
                  },
                  get: async () => ({ data: [] })
                };
              },
              doc() {
                return {
                  update: async () => ({})
                };
              },
              add: async () => ({ _id: 'record-id' })
            };
          }
        };
      }
    },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    navigateTo() {},
    navigateBack() {},
    nextTick(callback) {
      if (callback) callback();
    },
    getStorageSync() {
      return '';
    }
  };
}

function loadPage(pageRelativePath, extraModules = []) {
  const pagePath = require.resolve(pageRelativePath);
  const modulePaths = [
    pagePath,
    require.resolve('../miniprogram/models/nutrition.js'),
    require.resolve('../miniprogram/models/medicationRecord.js'),
    require.resolve('../miniprogram/models/treatmentRecord.js'),
    require.resolve('../miniprogram/models/food.js'),
    require.resolve('../miniprogram/models/invitation.js'),
    require.resolve('../miniprogram/utils/feedingRecordStore.js'),
    require.resolve('../miniprogram/utils/index.js'),
    ...extraModules
  ];

  modulePaths.forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  let pageConfig = null;

  global.wx = createDefaultWx();
  global.getApp = () => ({ globalData: {} });
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;
  return pageConfig;
}

test('daily-feeding meal groups retain recipe provenance for grouped food cards', () => {
  const page = loadPage('../miniprogram/pages/daily-feeding/index.js');
  const instance = createPageInstance(page);
  instance._round = page._round;
  instance._roundCalories = page._roundCalories;

  const groups = page.buildFoodMealGroups.call(instance, [
    {
      type: 'food',
      mealBatchId: 'meal_1',
      mealLabel: '早餐',
      mealTime: '08:00',
      recipeId: 'recipe_1',
      recipeNameSnapshot: '早餐模板',
      recipeConsumedRatio: 0.7,
      nutrition: { calories: 70, protein: 1.4, carbs: 3.5, fat: 0.7 }
    }
  ]);

  assert.equal(groups[0].recipeId, 'recipe_1');
  assert.equal(groups[0].recipeNameSnapshot, '早餐模板');
  assert.equal(groups[0].recipeConsumedRatio, 0.7);
});

test('data-records meal groups retain recipe provenance for grouped food cards', () => {
  const page = loadPage('../miniprogram/pages/data-records/index.js');
  const instance = createPageInstance(page);

  const groups = page.buildFoodMealGroups.call(instance, [
    {
      type: 'food',
      mealBatchId: 'meal_1',
      mealLabel: '早餐',
      mealTime: '08:00',
      recipeId: 'recipe_1',
      recipeNameSnapshot: '早餐模板',
      recipeConsumedRatio: 0.7,
      nutrition: { calories: 70, protein: 1.4, carbs: 3.5, fat: 0.7 }
    }
  ]);

  assert.equal(groups[0].recipeId, 'recipe_1');
  assert.equal(groups[0].recipeNameSnapshot, '早餐模板');
  assert.equal(groups[0].recipeConsumedRatio, 0.7);
});

test('history views render recipe provenance labels in grouped meal cards', () => {
  const dailyWxml = fs.readFileSync('miniprogram/pages/daily-feeding/index.wxml', 'utf8');
  const dataRecordsWxml = fs.readFileSync('miniprogram/pages/data-records/index.wxml', 'utf8');

  assert.match(dailyWxml, /来自食谱/);
  assert.match(dailyWxml, /recipeConsumedRatioText/);

  assert.match(dataRecordsWxml, /来自食谱/);
  assert.match(dataRecordsWxml, /recipeConsumedRatioText/);
});
