const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function appConfigHasPage(appConfig, pagePath) {
  if ((appConfig.pages || []).includes(pagePath)) return true;
  return (appConfig.subPackages || appConfig.subpackages || []).some((pkg) => (
    (pkg.pages || []).some((page) => `${pkg.root}/${page}` === pagePath)
  ));
}

function createPageInstance(page, overrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data || {})),
      ...overrides
    },
    setData(update, callback) {
      Object.entries(update || {}).forEach(([key, value]) => {
        if (key.includes('.')) {
          const parts = key.split('.');
          let target = this.data;
          parts.slice(0, -1).forEach((part) => {
            target[part] = target[part] || {};
            target = target[part];
          });
          target[parts.at(-1)] = value;
        } else {
          this.data[key] = value;
        }
      });
      if (typeof callback === 'function') {
        callback();
      }
    }
  };
}

function createDbMock() {
  const calls = {
    collections: [],
    collectionReads: [],
    collectionData: {},
    legacyUpdates: []
  };
  const db = {
    command: {
      gte(value) {
        return {
          and(next) {
            return { $gte: value, $and: next };
          }
        };
      },
      lt: (value) => ({ $lt: value }),
      lte: (value) => ({ $lte: value })
    },
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      calls.collections.push(name);
      return {
        where() {
          return {
            orderBy() {
              return this;
            },
            limit() {
              return this;
            },
            get: async () => {
              calls.collectionReads.push(name);
              return { data: calls.collectionData[name] || [] };
            }
          };
        },
        doc(id) {
          return {
            update: async ({ data }) => {
              calls.legacyUpdates.push({ collection: name, id, data });
              return {};
            }
          };
        },
        add: async ({ data }) => {
          calls.legacyUpdates.push({ collection: name, data });
          return { _id: `${name}-new-id` };
        }
      };
    }
  };
  return { db, calls };
}

function installWx(db) {
  const calls = {
    toasts: [],
    navigateTo: [],
    navigateBack: 0,
    loading: [],
    hideLoading: 0
  };
  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1',
      openid: 'openid-1',
      isInitialized: true
    }
  });
  global.wx = {
    cloud: {
      init() {},
      database() {
        return db;
      }
    },
    getStorageSync(key) {
      if (key === 'baby_uid') return 'baby-1';
      if (key === 'openid') return 'openid-1';
      return '';
    },
    showLoading(payload) {
      calls.loading.push(payload);
    },
    hideLoading() {
      calls.hideLoading += 1;
    },
    showToast(payload) {
      calls.toasts.push(payload);
    },
    showModal({ success }) {
      success({ confirm: true });
    },
    navigateTo(payload) {
      calls.navigateTo.push(payload);
    },
    navigateBack() {
      calls.navigateBack += 1;
    }
  };
  return calls;
}

function clearModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
}

function loadMealEditorPage(db, pageModulePath = '../miniprogram/pages/meal-editor/index.js') {
  const previous = {
    wx: global.wx,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    Page: global.Page,
    setTimeout: global.setTimeout
  };
  const wxCalls = installWx(db);
  let capturedPage = null;
  global.Page = (config) => {
    capturedPage = config;
  };
  global.setTimeout = (callback) => {
    callback();
    return 0;
  };
  global.getCurrentPages = () => [];

  [
    pageModulePath,
    '../miniprogram/models/foodIntakeRecord.js',
    '../miniprogram/models/dailySummaryV2.js'
  ].forEach(clearModule);
  require(pageModulePath);
  const FoodIntakeRecordModel = require('../miniprogram/models/foodIntakeRecord.js');
  const DailySummaryV2Model = require('../miniprogram/models/dailySummaryV2.js');

  return {
    page: capturedPage,
    wxCalls,
    FoodIntakeRecordModel,
    DailySummaryV2Model,
    cleanup() {
      global.wx = previous.wx;
      global.getApp = previous.getApp;
      global.getCurrentPages = previous.getCurrentPages;
      global.Page = previous.Page;
      global.setTimeout = previous.setTimeout;
    }
  };
}

function loadDataRecordsPage(db) {
  const previous = {
    wx: global.wx,
    getApp: global.getApp,
    Page: global.Page,
    suppress: global.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__
  };
  const wxCalls = installWx(db);
  global.Page = () => {};
  global.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__ = true;

  [
    '../miniprogram/pages/data-records/index.js',
    '../miniprogram/models/feedingRecordV2.js',
    '../miniprogram/models/foodIntakeRecord.js',
    '../miniprogram/models/dailySummaryV2.js',
    '../miniprogram/utils/dailyRecordV2Service.js',
    '../miniprogram/models/medicationRecord.js',
    '../miniprogram/models/treatmentRecord.js'
  ].forEach(clearModule);

  const dataRecordsModule = require('../miniprogram/pages/data-records/index.js');
  const { createDataRecordsPageConfig } = dataRecordsModule;
  const FeedingRecordV2Model = require('../miniprogram/models/feedingRecordV2.js');
  const FoodIntakeRecordModel = require('../miniprogram/models/foodIntakeRecord.js');
  const DailySummaryV2Model = require('../miniprogram/models/dailySummaryV2.js');
  const dailyRecordV2Service = require('../miniprogram/utils/dailyRecordV2Service.js');
  const MedicationRecordModel = require('../miniprogram/models/medicationRecord.js');
  const TreatmentRecordModel = require('../miniprogram/models/treatmentRecord.js');

  return {
    page: createDataRecordsPageConfig({ recordSource: 'v2' }),
    helpers: dataRecordsModule,
    wxCalls,
    models: {
      FeedingRecordV2Model,
      FoodIntakeRecordModel,
      DailySummaryV2Model,
      MedicationRecordModel,
      TreatmentRecordModel
    },
    dailyRecordV2Service,
    cleanup() {
      global.wx = previous.wx;
      global.getApp = previous.getApp;
      global.Page = previous.Page;
      global.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__ = previous.suppress;
    }
  };
}

function buildMealItem() {
  return {
    localId: 'local-food-1',
    foodId: 'food-1',
    food: {
      _id: 'food-1',
      name: '米粉',
      category: 'grain',
      baseUnit: 'g',
      proteinSource: 'natural',
      nutritionPer100g: {
        calories: 360,
        protein: 7,
        fat: 1,
        carbs: 80,
        fiber: 2
      }
    },
    nameSnapshot: '米粉',
    category: 'grain',
    unit: 'g',
    quantity: 20,
    nutrition: {
      calories: 72,
      protein: 1.4,
      carbs: 16,
      fat: 0.2,
      fiber: 0.4
    },
    proteinSource: 'natural',
    naturalProtein: 1.4,
    specialProtein: 0,
    notes: '午餐'
  };
}

test('app registers standalone meal-editor-v2 page with full page files', () => {
  const appJson = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));

  assert.ok(appConfigHasPage(appJson, 'pages/meal-editor-v2/index'));
  assert.ok(fs.existsSync('miniprogram/pages/meal-editor-v2/index.js'));
  assert.ok(fs.existsSync('miniprogram/pages/meal-editor-v2/index.wxml'));
  assert.ok(fs.existsSync('miniprogram/pages/meal-editor-v2/index.wxss'));
  assert.ok(fs.existsSync('miniprogram/pages/meal-editor-v2/index.json'));
});

test('legacy meal-editor keeps v1 food logic isolated from v2 food models', () => {
  const legacyMealEditorJs = fs.readFileSync('miniprogram/pages/meal-editor/index.js', 'utf8');

  assert.doesNotMatch(legacyMealEditorJs, /foodIntakeRecord/);
  assert.doesNotMatch(legacyMealEditorJs, /dailySummaryV2/);
  assert.doesNotMatch(legacyMealEditorJs, /recordSource/);
});

test('standalone meal-editor-v2 writes food_intake_records instead of feeding_records', async () => {
  const { db, calls } = createDbMock();
  const { page, FoodIntakeRecordModel, DailySummaryV2Model, cleanup } = loadMealEditorPage(
    db,
    '../miniprogram/pages/meal-editor-v2/index.js'
  );
  const created = [];
  const dirtyDays = [];
  FoodIntakeRecordModel.createFoodIntake = async (record) => {
    created.push(record);
    return { _id: `food-intake-${created.length}` };
  };
  DailySummaryV2Model.markDirty = async (babyUid, date) => {
    dirtyDays.push({ babyUid, date });
    return true;
  };

  try {
    const instance = createPageInstance(page);
    instance.loadFoodCatalog = async function() {
      this.setData({ foodCatalog: [buildMealItem().food] });
    };
    await page.onLoad.call(instance, {
      date: '2026-05-25',
      from: 'records'
    });
    assert.equal(instance.data.recordSource, 'v2');
    instance.setData({
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '午餐备注',
        items: [buildMealItem()]
      }
    });

    await page.saveMeal.call(instance);

    assert.equal(created.length, 1);
    assert.equal(created[0].babyUid, 'baby-1');
    assert.equal(created[0].date, '2026-05-25');
    assert.equal(created[0].time, '12:30');
    assert.equal(created[0].foodName, '米粉');
    assert.equal(created[0].nutrition.naturalProtein, 1.4);
    assert.deepEqual(dirtyDays, [{ babyUid: 'baby-1', date: '2026-05-25' }]);
    assert.equal(calls.legacyUpdates.some((write) => write.collection === 'feeding_records'), false);
  } finally {
    cleanup();
  }
});

test('data-records-v2 meal navigation opens standalone meal-editor-v2 page', () => {
  const { db } = createDbMock();
  const { page, wxCalls, cleanup } = loadDataRecordsPage(db);

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25'
    });

    page.navigateToMealEditor.call(instance);
    page.navigateToMealGroupEditor.call(instance, {
      currentTarget: {
        dataset: {
          mealBatchId: 'meal-1'
        }
      }
    });

    assert.match(wxCalls.navigateTo[0].url, /^\/pages\/meal-editor-v2\/index\?/);
    assert.doesNotMatch(wxCalls.navigateTo[0].url, /recordSource=v2/);
    assert.match(wxCalls.navigateTo[1].url, /^\/pages\/meal-editor-v2\/index\?/);
    assert.doesNotMatch(wxCalls.navigateTo[1].url, /recordSource=v2/);
    assert.match(wxCalls.navigateTo[1].url, /mealBatchId=meal-1/);
  } finally {
    cleanup();
  }
});

test('data-records-v2 fetches food records from food_intake_records without reading feeding_records', async () => {
  const { db, calls } = createDbMock();
  const { page, models, cleanup } = loadDataRecordsPage(db);
  models.FeedingRecordV2Model.getRecordsByDate = async () => [];
  models.FeedingRecordV2Model.resolveBasicInfoSnapshot = async () => ({
    weight: '',
    height: '',
    naturalProteinCoefficient: '',
    specialProteinCoefficient: '',
    calorieCoefficient: '',
    source: 'empty'
  });
  models.FoodIntakeRecordModel.findByDate = async (babyUid, date) => [
    {
      _id: 'food-intake-1',
      babyUid,
      date,
      mealBatchId: 'meal-1',
      time: '12:30',
      foodId: 'food-1',
      foodName: '米粉',
      foodSnapshot: {
        name: '米粉',
        category: 'grain',
        proteinSource: 'natural'
      },
      quantity: 20,
      unit: 'g',
      nutrition: {
        calories: 72,
        protein: 1.4,
        naturalProtein: 1.4,
        specialProtein: 0,
        carbs: 16,
        fat: 0.2,
        fiber: 0.4
      }
    }
  ];
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25',
      nutritionSettings: {}
    });

    await page.fetchDailyRecords.call(instance, '2026-05-25', { silent: true });

    assert.equal(calls.collectionReads.includes('feeding_records'), false);
    assert.equal(instance.data.foodIntakes.length, 1);
    assert.equal(instance.data.foodIntakes[0]._id, 'food-intake-1');
    assert.equal(instance.data.foodIntakes[0].nameSnapshot, '米粉');
    assert.equal(instance.data.foodMealGroups.length, 1);
  } finally {
    cleanup();
  }
});

test('data-records-v2 meal groups preserve planned fields and expose completion display helpers', () => {
  const { db } = createDbMock();
  const { helpers, cleanup } = loadDataRecordsPage(db);

  try {
    const intakes = helpers.foodIntakeRecordsToLegacyIntakes([
      {
        _id: 'food-intake-1',
        mealBatchId: 'meal-1',
        mealLabel: '午餐',
        mealNote: '宝宝吃了一半',
        time: '12:30',
        foodId: 'food-1',
        foodName: '米粉',
        quantity: 10,
        plannedQuantity: 20,
        unit: 'g',
        nutrition: {
          calories: 36,
          protein: 0.7,
          naturalProtein: 0.7,
          specialProtein: 0,
          carbs: 8,
          fat: 0.1
        },
        plannedNutrition: {
          calories: 72,
          protein: 1.4,
          naturalProtein: 1.4,
          specialProtein: 0,
          carbs: 16,
          fat: 0.2
        },
        completionPercent: 50,
        mealCombinationSource: {
          combinationId: 'combo-1',
          combinationName: '午餐组合'
        }
      },
      {
        _id: 'food-intake-2',
        mealBatchId: 'meal-1',
        mealLabel: '午餐',
        time: '12:31',
        foodId: 'food-2',
        foodName: '土豆泥',
        quantity: 15,
        plannedQuantity: 30,
        unit: 'g',
        nutrition: {
          calories: 15,
          protein: 0.3,
          naturalProtein: 0.3,
          specialProtein: 0,
          carbs: 3,
          fat: 0.05
        },
        plannedNutrition: {
          calories: 30,
          protein: 0.6,
          naturalProtein: 0.6,
          specialProtein: 0,
          carbs: 6,
          fat: 0.1
        },
        completionPercent: 50,
        mealCombinationSource: {
          combinationId: 'combo-1',
          combinationName: '午餐组合'
        }
      },
      {
        _id: 'food-intake-old',
        mealBatchId: 'meal-old',
        mealLabel: '晚餐',
        time: '18:00',
        foodName: '旧记录米糊',
        quantity: 8,
        unit: 'g',
        nutrition: {
          calories: 20,
          protein: 0.5,
          naturalProtein: 0.5,
          specialProtein: 0,
          carbs: 4,
          fat: 0.1
        }
      }
    ]);

    const lunch = helpers.groupFoodIntakesByMeal(intakes).find(group => group.mealBatchId === 'meal-1');
    assert.ok(lunch);
    assert.equal(lunch.completionPercent, 50);
    assert.equal(lunch.completionPercentText, '吃完 50%');
    assert.equal(lunch.hasCompletionDisplay, true);
    assert.equal(lunch.hasPartialCompletion, true);
    assert.equal(lunch.hasPlannedDifference, true);
    assert.equal(lunch.mealCombinationSourceText, '来自菜谱：午餐组合');
    assert.equal(lunch.summary.calories, 51);

    const firstItem = lunch.items.find(item => item._id === 'food-intake-1');
    assert.equal(firstItem.quantity, 10);
    assert.equal(firstItem.plannedQuantity, 20);
    assert.deepEqual(firstItem.plannedNutrition, {
      calories: 72,
      protein: 1.4,
      carbs: 16,
      fat: 0.2,
      fiber: 0,
      sodium: 0,
      naturalProtein: 1.4,
      specialProtein: 0
    });
    assert.equal(firstItem.completionPercent, 50);
    assert.equal(firstItem.hasCompletionDisplay, true);
    assert.equal(firstItem.displayQuantity, '10g');
    assert.equal(firstItem.plannedDisplayQuantity, '20g');
    assert.equal(firstItem.hasPlannedDifference, true);
    assert.equal(firstItem.plannedActualText, '准备 20g / 实际 10g');
    assert.deepEqual(firstItem.mealCombinationSource, {
      combinationId: 'combo-1',
      combinationName: '午餐组合'
    });

    const oldGroup = helpers.groupFoodIntakesByMeal(intakes).find(group => group.mealBatchId === 'meal-old');
    assert.equal(oldGroup.completionPercent, 100);
    assert.equal(oldGroup.completionPercentText, '');
    assert.equal(oldGroup.hasCompletionDisplay, false);
    assert.equal(oldGroup.hasPartialCompletion, false);
    assert.equal(oldGroup.hasPlannedDifference, false);
    assert.equal(oldGroup.items[0].completionPercent, 100);
    assert.equal(oldGroup.items[0].hasCompletionDisplay, false);
    assert.equal(oldGroup.items[0].hasPlannedQuantity, false);
    assert.equal(oldGroup.items[0].plannedDisplayQuantity, '');
    assert.equal(oldGroup.items[0].hasPlannedDifference, false);
    assert.equal(Object.prototype.hasOwnProperty.call(oldGroup.items[0], 'plannedQuantity'), false);
  } finally {
    cleanup();
  }
});

test('data-records-v2 loads the whole day through dailyRecordV2Service', async () => {
  const { db, calls } = createDbMock();
  const { page, models, dailyRecordV2Service, cleanup } = loadDataRecordsPage(db);
  let serviceArgs = null;

  dailyRecordV2Service.getDailyRecordV2 = async (babyUid, date) => {
    serviceArgs = { babyUid, date };
    return {
      babyUid,
      date,
      basicInfo: {
        weight: 5.2,
        height: 58,
        naturalProteinCoefficient: '1.2',
        specialProteinCoefficient: '0.8'
      },
      summary: {
        macroSummary: {
          calories: 123,
          protein: 4.5,
          naturalProtein: 2.2,
          specialProtein: 2.3,
          carbs: 18,
          fat: 4
        }
      },
      milkRecords: [
        {
          _id: 'milk-v2-1',
          id: 'milk-v2-1',
          babyUid,
          date,
          startTime: '08:30',
          formulaComponents: [
            { kind: 'breast_milk', volume: 60 }
          ],
          nutritionSummary: {
            totalVolume: 60,
            calories: 40,
            protein: 0.66,
            naturalProtein: 0.66,
            specialProtein: 0,
            carbs: 4,
            fat: 2
          }
        }
      ],
      foodIntakeRecords: [
        {
          _id: 'food-intake-1',
          babyUid,
          date,
          mealBatchId: 'meal-1',
          time: '12:30',
          foodName: '米粉',
          quantity: 20,
          unit: 'g',
          foodSnapshot: {
            name: '米粉',
            category: 'grain',
            proteinSource: 'natural'
          },
          nutrition: {
            calories: 72,
            protein: 1.4,
            naturalProtein: 1.4,
            specialProtein: 0,
            carbs: 16,
            fat: 0.2
          }
        }
      ],
      medicationRecords: [{ _id: 'med-1', medicineName: '左卡尼汀' }],
      treatmentRecords: [],
      bowelRecords: []
    };
  };
  models.FeedingRecordV2Model.getRecordsByDate = async () => {
    throw new Error('data-records-v2 should load through dailyRecordV2Service');
  };
  models.FoodIntakeRecordModel.findByDate = async () => {
    throw new Error('data-records-v2 should load food through dailyRecordV2Service');
  };

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25',
      nutritionSettings: {}
    });

    await page.fetchDailyRecords.call(instance, '2026-05-25', { silent: true });

    assert.deepEqual(serviceArgs, { babyUid: 'baby-1', date: '2026-05-25' });
    assert.equal(calls.collectionReads.includes('feeding_records'), false);
    assert.equal(instance.data.feedings.length, 1);
    assert.equal(instance.data.foodIntakes.length, 1);
    assert.equal(instance.data.foodIntakes[0].nameSnapshot, '米粉');
    assert.equal(instance.data.macroSummary.calories, 123);
    assert.deepEqual(instance.data.medicationRecords, [{ _id: 'med-1', medicineName: '左卡尼汀' }]);
  } finally {
    cleanup();
  }
});

test('data-records-v2 invalid completion percent falls back without implying completion was recorded', () => {
  const { db } = createDbMock();
  const { helpers, cleanup } = loadDataRecordsPage(db);

  try {
    const intakes = helpers.foodIntakeRecordsToLegacyIntakes([
      {
        _id: 'food-invalid-high',
        mealBatchId: 'meal-invalid',
        mealLabel: '午餐',
        time: '12:30',
        foodName: '米粉',
        quantity: 10,
        unit: 'g',
        nutrition: { calories: 20, protein: 1, carbs: 4, fat: 0.2 },
        completionPercent: 120
      },
      {
        _id: 'food-invalid-zero',
        mealBatchId: 'meal-invalid',
        mealLabel: '午餐',
        time: '12:31',
        foodName: '土豆泥',
        quantity: 10,
        unit: 'g',
        nutrition: { calories: 15, protein: 0.5, carbs: 3, fat: 0.1 },
        completionPercent: 0
      }
    ]);

    const group = helpers.groupFoodIntakesByMeal(intakes)[0];
    assert.equal(group.completionPercent, 100);
    assert.equal(group.completionPercentText, '');
    assert.equal(group.hasCompletionDisplay, false);
    assert.equal(group.hasPartialCompletion, false);
    assert.equal(group.hasPlannedDifference, false);
    assert.deepEqual(group.items.map(item => item.completionPercent), [100, 100]);
    assert.deepEqual(group.items.map(item => item.hasCompletionDisplay), [false, false]);
    assert.deepEqual(group.items.map(item => item.hasPlannedDifference), [false, false]);
  } finally {
    cleanup();
  }
});

test('data-records-v2 planned records without valid completion keep planned difference without completion display', () => {
  const { db } = createDbMock();
  const { helpers, cleanup } = loadDataRecordsPage(db);

  try {
    const intakes = helpers.foodIntakeRecordsToLegacyIntakes([
      {
        _id: 'food-planned-missing-percent',
        mealBatchId: 'meal-planned-invalid',
        mealLabel: '午餐',
        time: '12:30',
        foodName: '米粉',
        quantity: 10,
        plannedQuantity: 20,
        unit: 'g',
        nutrition: { calories: 20, protein: 1, carbs: 4, fat: 0.2 },
        plannedNutrition: { calories: 40, protein: 2, carbs: 8, fat: 0.4 }
      },
      {
        _id: 'food-planned-invalid-percent',
        mealBatchId: 'meal-planned-invalid',
        mealLabel: '午餐',
        time: '12:31',
        foodName: '土豆泥',
        quantity: 5,
        plannedQuantity: 10,
        unit: 'g',
        nutrition: { calories: 10, protein: 0.4, carbs: 2, fat: 0.1 },
        plannedNutrition: { calories: 20, protein: 0.8, carbs: 4, fat: 0.2 },
        completionPercent: 150
      },
      {
        _id: 'food-planned-valid-full',
        mealBatchId: 'meal-planned-valid-full',
        mealLabel: '晚餐',
        time: '18:00',
        foodName: '苹果泥',
        quantity: 12,
        plannedQuantity: 12,
        unit: 'g',
        nutrition: { calories: 12, protein: 0.1, carbs: 3, fat: 0 },
        plannedNutrition: { calories: 12, protein: 0.1, carbs: 3, fat: 0 },
        completionPercent: 100
      }
    ]);

    const groups = helpers.groupFoodIntakesByMeal(intakes);
    const invalidGroup = groups.find(group => group.mealBatchId === 'meal-planned-invalid');
    assert.equal(invalidGroup.completionPercent, 100);
    assert.equal(invalidGroup.completionPercentText, '');
    assert.equal(invalidGroup.hasCompletionDisplay, false);
    assert.equal(invalidGroup.hasPartialCompletion, false);
    assert.equal(invalidGroup.hasPlannedDifference, true);

    const missingPercentItem = invalidGroup.items.find(item => item._id === 'food-planned-missing-percent');
    assert.equal(missingPercentItem.completionPercent, 100);
    assert.equal(missingPercentItem.hasCompletionDisplay, false);
    assert.equal(missingPercentItem.plannedDisplayQuantity, '20g');
    assert.equal(missingPercentItem.hasPlannedDifference, true);
    assert.equal(missingPercentItem.plannedActualText, '准备 20g / 实际 10g');

    const invalidPercentItem = invalidGroup.items.find(item => item._id === 'food-planned-invalid-percent');
    assert.equal(invalidPercentItem.completionPercent, 100);
    assert.equal(invalidPercentItem.hasCompletionDisplay, false);
    assert.equal(invalidPercentItem.plannedDisplayQuantity, '10g');
    assert.equal(invalidPercentItem.hasPlannedDifference, true);
    assert.equal(invalidPercentItem.plannedActualText, '准备 10g / 实际 5g');

    const validFullGroup = groups.find(group => group.mealBatchId === 'meal-planned-valid-full');
    assert.equal(validFullGroup.completionPercent, 100);
    assert.equal(validFullGroup.completionPercentText, '吃完 100%');
    assert.equal(validFullGroup.hasCompletionDisplay, true);
    assert.equal(validFullGroup.hasPartialCompletion, false);
  } finally {
    cleanup();
  }
});

test('data-records-v2 inconsistent planned completion percents use first valid display value', () => {
  const { db } = createDbMock();
  const { helpers, cleanup } = loadDataRecordsPage(db);

  try {
    const intakes = helpers.foodIntakeRecordsToLegacyIntakes([
      {
        _id: 'food-first-valid',
        mealBatchId: 'meal-mixed-percent',
        mealLabel: '早餐',
        time: '08:32',
        foodName: '米粉',
        quantity: 15,
        plannedQuantity: 20,
        unit: 'g',
        nutrition: { calories: 30, protein: 1, carbs: 6, fat: 0.2 },
        plannedNutrition: { calories: 40, protein: 1.4, carbs: 8, fat: 0.3 },
        completionPercent: 75
      },
      {
        _id: 'food-second-different',
        mealBatchId: 'meal-mixed-percent',
        mealLabel: '早餐',
        time: '08:31',
        foodName: '南瓜泥',
        quantity: 10,
        plannedQuantity: 20,
        unit: 'g',
        nutrition: { calories: 10, protein: 0.3, carbs: 2, fat: 0.1 },
        plannedNutrition: { calories: 20, protein: 0.6, carbs: 4, fat: 0.2 },
        completionPercent: 50
      },
      {
        _id: 'food-invalid-ignored',
        mealBatchId: 'meal-mixed-percent',
        mealLabel: '早餐',
        time: '08:30',
        foodName: '苹果泥',
        quantity: 5,
        plannedQuantity: 5,
        unit: 'g',
        nutrition: { calories: 5, protein: 0.1, carbs: 1, fat: 0 },
        plannedNutrition: { calories: 5, protein: 0.1, carbs: 1, fat: 0 },
        completionPercent: 150
      }
    ]);

    const group = helpers.groupFoodIntakesByMeal(intakes)[0];
    assert.equal(group.completionPercent, 75);
    assert.equal(group.completionPercentText, '吃完 75%');
    assert.equal(group.hasCompletionDisplay, true);
    assert.equal(group.hasPartialCompletion, true);
    assert.equal(group.hasPlannedDifference, true);
    assert.equal(group.items.find(item => item._id === 'food-first-valid').plannedActualText, '准备 20g / 实际 15g');
    assert.equal(group.items.find(item => item._id === 'food-second-different').plannedActualText, '准备 20g / 实际 10g');
    assert.equal(group.items.find(item => item._id === 'food-invalid-ignored').completionPercent, 100);
  } finally {
    cleanup();
  }
});

test('data-records-v2 food meal WXML exposes planned-vs-actual and meal combination hints', () => {
  const wxml = fs.readFileSync('miniprogram/pages/data-records/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/data-records/index.wxss', 'utf8');

  assert.match(wxml, /吃完/);
  assert.match(wxml, /hasCompletionDisplay/);
  assert.doesNotMatch(wxml, /wx:if="\{\{item\.completionPercentText\}\}"/);
  assert.match(wxml, /准备/);
  assert.match(wxml, /实际/);
  assert.match(wxml, /mealCombinationSourceText/);
  assert.match(wxml, /plannedActualText/);
  assert.match(wxss, /\.meal-group-completion/);
  assert.match(wxss, /\.food-planned-actual/);
  assert.match(wxss, /\.meal-combination-source/);
});

test('data-records-v2 deleting a food intake hard deletes food_intake_records and marks summary dirty', async () => {
  const { db, calls } = createDbMock();
  const { page, models, cleanup } = loadDataRecordsPage(db);
  const deletedIds = [];
  const dirtyDays = [];
  models.FoodIntakeRecordModel.deleteFoodIntake = async (id) => {
    deletedIds.push(id);
    return true;
  };
  models.DailySummaryV2Model.markDirty = async (babyUid, date) => {
    dirtyDays.push({ babyUid, date });
    return true;
  };

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25',
      recordId: 'legacy-record-1',
      intakes: [
        {
          _id: 'food-intake-1',
          type: 'food',
          mealBatchId: 'meal-1',
          nameSnapshot: '米粉'
        }
      ],
      foodIntakes: [
        {
          _id: 'food-intake-1',
          type: 'food',
          mealBatchId: 'meal-1',
          nameSnapshot: '米粉'
        }
      ],
      feedings: [],
      nutritionSettings: {},
      treatmentRecords: []
    });

    await page.deleteFoodIntake.call(instance, {
      currentTarget: {
        dataset: {
          id: 'food-intake-1'
        }
      }
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(deletedIds, ['food-intake-1']);
    assert.deepEqual(dirtyDays, [{ babyUid: 'baby-1', date: '2026-05-25' }]);
    assert.equal(calls.legacyUpdates.some((write) => write.collection === 'feeding_records'), false);
  } finally {
    cleanup();
  }
});
