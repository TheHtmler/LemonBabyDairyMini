const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
    '../miniprogram/models/medicationRecord.js',
    '../miniprogram/models/treatmentRecord.js'
  ].forEach(clearModule);

  const { createDataRecordsPageConfig } = require('../miniprogram/pages/data-records/index.js');
  const FeedingRecordV2Model = require('../miniprogram/models/feedingRecordV2.js');
  const FoodIntakeRecordModel = require('../miniprogram/models/foodIntakeRecord.js');
  const DailySummaryV2Model = require('../miniprogram/models/dailySummaryV2.js');
  const MedicationRecordModel = require('../miniprogram/models/medicationRecord.js');
  const TreatmentRecordModel = require('../miniprogram/models/treatmentRecord.js');

  return {
    page: createDataRecordsPageConfig({ recordSource: 'v2' }),
    wxCalls,
    models: {
      FeedingRecordV2Model,
      FoodIntakeRecordModel,
      DailySummaryV2Model,
      MedicationRecordModel,
      TreatmentRecordModel
    },
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

  assert.ok(appJson.pages.includes('pages/meal-editor-v2/index'));
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
