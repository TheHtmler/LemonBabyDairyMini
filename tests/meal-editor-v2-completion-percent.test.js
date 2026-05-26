const test = require('node:test');
const assert = require('node:assert/strict');

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
  const db = {
    command: {
      eq(value) {
        return { $eq: value };
      },
      in(value) {
        return { $in: value };
      },
      or(value) {
        return { $or: value };
      },
      gte(value) {
        return {
          and(next) {
            return { $gte: value, $and: next };
          }
        };
      },
      lt(value) {
        return { $lt: value };
      }
    },
    serverDate() {
      return '__server_date__';
    },
    collection() {
      return {
        where() {
          return this;
        },
        orderBy() {
          return this;
        },
        limit() {
          return this;
        },
        skip() {
          return this;
        },
        async get() {
          return { data: [] };
        },
        doc() {
          return {
            async update() {
              return {};
            },
            async remove() {
              return {};
            }
          };
        },
        async add() {
          return { _id: 'new-id' };
        }
      };
    }
  };
  return db;
}

function installWx(db) {
  const calls = {
    toasts: [],
    loading: [],
    hideLoading: 0,
    navigateBack: 0
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

function loadMealEditorPage(db = createDbMock()) {
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
  global.getCurrentPages = () => [];
  global.setTimeout = (callback) => {
    callback();
    return 0;
  };

  [
    '../miniprogram/pages/meal-editor-v2/index.js',
    '../miniprogram/models/food.js',
    '../miniprogram/models/foodIntakeRecord.js',
    '../miniprogram/models/dailySummaryV2.js'
  ].forEach(clearModule);

  require('../miniprogram/pages/meal-editor-v2/index.js');
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

function buildMealItem(overrides = {}) {
  const plannedNutrition = overrides.plannedNutrition || {
    calories: 72.33,
    protein: 1.47,
    naturalProtein: 1.1,
    specialProtein: 0.37,
    carbs: 16.11,
    fat: 0.23,
    fiber: 0.42,
    sodium: 2.55
  };

  return {
    localId: overrides.localId || 'local-food-1',
    originalIntakeId: overrides.originalIntakeId || '',
    foodId: overrides.foodId || 'food-1',
    food: {
      _id: overrides.foodId || 'food-1',
      name: overrides.nameSnapshot || '米粉',
      category: 'grain',
      baseUnit: 'g',
      proteinSource: 'mixed',
      nutritionPer100g: {
        calories: 361.65,
        protein: 7.35,
        carbs: 80.55,
        fat: 1.15,
        fiber: 2.1
      }
    },
    nameSnapshot: overrides.nameSnapshot || '米粉',
    category: 'grain',
    unit: 'g',
    quantity: overrides.quantity ?? 20,
    plannedQuantity: overrides.plannedQuantity,
    nutrition: overrides.nutrition || plannedNutrition,
    plannedNutrition: overrides.itemPlannedNutrition,
    proteinSource: 'mixed',
    proteinQuality: '',
    naturalProtein: overrides.naturalProtein ?? plannedNutrition.naturalProtein,
    specialProtein: overrides.specialProtein ?? plannedNutrition.specialProtein,
    notes: overrides.notes || ''
  };
}

function buildStoredIntake(overrides = {}) {
  const plannedNutrition = overrides.plannedNutrition || {
    calories: 72.33,
    protein: 1.47,
    naturalProtein: 1.1,
    specialProtein: 0.37,
    carbs: 16.11,
    fat: 0.23,
    fiber: 0.42,
    sodium: 2.55
  };
  const nutrition = overrides.nutrition || {
    calories: 36.17,
    protein: 0.74,
    naturalProtein: 0.55,
    specialProtein: 0.19,
    carbs: 8.06,
    fat: 0.12,
    fiber: 0.21
  };

  return {
    _id: overrides._id || 'food-intake-1',
    babyUid: 'baby-1',
    date: '2026-05-25',
    mealBatchId: 'meal-1',
    time: overrides.time || '12:30',
    recordedAt: new Date(`2026-05-25T${overrides.time || '12:30'}:00.000Z`),
    foodId: overrides.foodId || 'food-1',
    foodName: overrides.foodName || '米粉',
    foodSnapshot: {
      name: overrides.foodName || '米粉',
      category: 'grain',
      proteinSource: 'mixed',
      nutritionPer100g: {}
    },
    quantity: overrides.quantity ?? 10,
    unit: 'g',
    nutrition,
    plannedQuantity: overrides.plannedQuantity,
    plannedNutrition: overrides.includePlanned === false ? undefined : plannedNutrition,
    completionPercent: overrides.completionPercent,
    mealCombinationSource: overrides.mealCombinationSource,
    notes: overrides.notes || '',
    mealLabel: '午餐',
    mealNote: '午餐备注'
  };
}

async function saveMealWithItems({
  completionPercent = 100,
  items = [buildMealItem()],
  selectedDate = '2026-05-25'
} = {}) {
  const { page, wxCalls, FoodIntakeRecordModel, DailySummaryV2Model, cleanup } = loadMealEditorPage();
  const created = [];
  const dirtyDays = [];
  FoodIntakeRecordModel.findByDate = async () => [];
  FoodIntakeRecordModel.createFoodIntake = async (payload) => {
    created.push(payload);
    return { _id: `food-intake-${created.length}` };
  };
  DailySummaryV2Model.markDirty = async (babyUid, date) => {
    dirtyDays.push({ babyUid, date });
    return true;
  };

  const instance = createPageInstance(page, {
    selectedDate,
    completionPercent,
    mealDraft: {
      mealTime: '12:30',
      mealLabel: '午餐',
      mealNote: '午餐备注',
      items
    }
  });

  await page.saveMeal.call(instance);
  return { created, dirtyDays, wxCalls, cleanup, instance };
}

test('new meal-editor-v2 defaults completion percent to 100', () => {
  const { page, cleanup } = loadMealEditorPage();

  try {
    assert.equal(page.data.completionPercent, 100);
    assert.deepEqual(page.data.completionPercentOptions, [100, 75, 50]);
  } finally {
    cleanup();
  }
});

test('saving 100 percent stores planned quantity and nutrition equal to actual values', async () => {
  const { created, cleanup } = await saveMealWithItems({ completionPercent: 100 });

  try {
    assert.equal(created.length, 1);
    assert.equal(created[0].quantity, 20);
    assert.equal(created[0].plannedQuantity, 20);
    assert.deepEqual(created[0].plannedNutrition, created[0].nutrition);
    assert.equal(created[0].completionPercent, 100);
    assert.equal(created[0].source, 'meal_editor_v2');
  } finally {
    cleanup();
  }
});

test('saving 50 percent stores scaled actual values while preserving planned fields', async () => {
  const { created, cleanup } = await saveMealWithItems({ completionPercent: 50 });

  try {
    assert.equal(created[0].quantity, 10);
    assert.equal(created[0].plannedQuantity, 20);
    assert.deepEqual(created[0].plannedNutrition, {
      calories: 72.33,
      protein: 1.47,
      naturalProtein: 1.1,
      specialProtein: 0.37,
      carbs: 16.11,
      fat: 0.23,
      fiber: 0.42,
      sodium: 2.55
    });
    assert.deepEqual(created[0].nutrition, {
      calories: 36.17,
      protein: 0.74,
      naturalProtein: 0.55,
      specialProtein: 0.19,
      fat: 0.12,
      carbs: 8.06,
      fiber: 0.21,
      sodium: 1.28
    });
    assert.equal(created[0].completionPercent, 50);
  } finally {
    cleanup();
  }
});

test('saving 50 percent keeps top-level protein split consistent with actual nutrition', async () => {
  const { page, FoodIntakeRecordModel, DailySummaryV2Model, cleanup } = loadMealEditorPage();
  FoodIntakeRecordModel.findByDate = async () => [];
  FoodIntakeRecordModel.createFoodIntake = async () => ({ _id: 'food-intake-1' });
  DailySummaryV2Model.markDirty = async () => true;

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25',
      completionPercent: 50,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: [buildMealItem()]
      }
    });

    const [intake] = page.buildMealIntakes.call(instance, 'meal-1');

    assert.equal(intake.naturalProtein, 0.55);
    assert.equal(intake.specialProtein, 0.19);
    assert.equal(intake.naturalProtein, intake.nutrition.naturalProtein);
    assert.equal(intake.specialProtein, intake.nutrition.specialProtein);
  } finally {
    cleanup();
  }
});

test('saving 75 percent preserves fractional actual calories with 2 decimals', async () => {
  const { created, cleanup } = await saveMealWithItems({
    completionPercent: 75,
    items: [
      buildMealItem({
        quantity: 10,
        plannedNutrition: {
          calories: 101.11,
          protein: 1,
          naturalProtein: 1,
          specialProtein: 0,
          carbs: 2,
          fat: 0.5,
          fiber: 0.25,
          sodium: 1
        }
      })
    ]
  });

  try {
    assert.equal(created[0].nutrition.calories, 75.83);
    assert.equal(created[0].plannedNutrition.calories, 101.11);
  } finally {
    cleanup();
  }
});

test('saving multiple foods preserves per-item fractional calories before any summary rounding', async () => {
  const { created, cleanup } = await saveMealWithItems({
    completionPercent: 50,
    items: [
      buildMealItem({
        localId: 'item-1',
        foodId: 'food-1',
        quantity: 10,
        plannedNutrition: {
          calories: 7.77,
          protein: 0.2,
          naturalProtein: 0.2,
          specialProtein: 0,
          carbs: 1,
          fat: 0.1,
          fiber: 0,
          sodium: 0
        }
      }),
      buildMealItem({
        localId: 'item-2',
        foodId: 'food-2',
        nameSnapshot: '土豆泥',
        quantity: 10,
        plannedNutrition: {
          calories: 11.11,
          protein: 0.4,
          naturalProtein: 0,
          specialProtein: 0.4,
          carbs: 2,
          fat: 0.2,
          fiber: 0,
          sodium: 0
        }
      })
    ]
  });

  try {
    assert.deepEqual(created.map(record => record.nutrition.calories), [3.89, 5.56]);
  } finally {
    cleanup();
  }
});

test('invalid completion percent blocks save and shows toast', async () => {
  const { created, wxCalls, cleanup } = await saveMealWithItems({ completionPercent: '' });

  try {
    assert.equal(created.length, 0);
    assert.equal(wxCalls.toasts.at(-1).title, '请输入 1-100 的吃完比例');
  } finally {
    cleanup();
  }
});

test('invalid completion percent input clears actual summary instead of showing fallback values', async () => {
  const { page, cleanup } = loadMealEditorPage();
  const emptySummary = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sodium: 0
  };

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25',
      completionPercent: 100,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: [buildMealItem()]
      }
    });

    page.refreshMealSummaries.call(instance, instance.data.mealDraft.items, 100);
    assert.equal(instance.data.actualMealSummary.calories, 72.33);

    page.onCompletionPercentInput.call(instance, { detail: { value: '' } });
    assert.deepEqual(instance.data.actualMealSummary, emptySummary);

    page.onCompletionPercentInput.call(instance, { detail: { value: '0' } });
    assert.deepEqual(instance.data.actualMealSummary, emptySummary);
  } finally {
    cleanup();
  }
});

test('invalid zero completion percent blocks save and shows toast', async () => {
  const { created, wxCalls, cleanup } = await saveMealWithItems({ completionPercent: '0' });

  try {
    assert.equal(created.length, 0);
    assert.equal(wxCalls.toasts.at(-1).title, '请输入 1-100 的吃完比例');
  } finally {
    cleanup();
  }
});

test('editing a v2 meal with planned fields restores completion percent and planned items', async () => {
  const { page, FoodIntakeRecordModel, cleanup } = loadMealEditorPage();
  FoodIntakeRecordModel.findByDate = async () => [
    buildStoredIntake({
      _id: 'food-intake-1',
      quantity: 10,
      plannedQuantity: 20,
      completionPercent: 50
    })
  ];

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-25',
      foodCatalog: []
    });

    await page.loadExistingV2Meal.call(instance, 'meal-1', 'baby-1');

    assert.equal(instance.data.completionPercent, 50);
    assert.equal(instance.data.mealDraft.items[0].quantity, 20);
    assert.equal(instance.data.mealDraft.items[0].plannedQuantity, 20);
    assert.deepEqual(instance.data.mealDraft.items[0].nutrition, buildStoredIntake().plannedNutrition);
  } finally {
    cleanup();
  }
});

test('editing an old v2 meal without planned fields ignores stored completion percent and avoids rescaling', async () => {
  const oldRecord = buildStoredIntake({
      _id: 'food-intake-1',
      quantity: 10,
      includePlanned: false,
      completionPercent: 50
    });
  const { page, FoodIntakeRecordModel, DailySummaryV2Model, cleanup } = loadMealEditorPage();
  const updates = [];
  FoodIntakeRecordModel.findByDate = async () => [oldRecord];
  FoodIntakeRecordModel.updateFoodIntake = async (id, payload) => {
    updates.push({ id, payload });
    return true;
  };
  DailySummaryV2Model.markDirty = async () => true;

  try {
    const instance = createPageInstance(page, {
      mode: 'edit',
      selectedDate: '2026-05-25',
      editMealBatchId: 'meal-1',
      foodCatalog: []
    });

    await page.loadExistingV2Meal.call(instance, 'meal-1', 'baby-1');

    assert.equal(instance.data.completionPercent, 100);
    assert.equal(instance.data.mealDraft.items[0].quantity, 10);
    assert.equal(instance.data.mealDraft.items[0].plannedQuantity, 10);
    assert.deepEqual(instance.data.mealDraft.items[0].plannedNutrition, buildStoredIntake().nutrition);

    await page.saveMeal.call(instance);

    assert.equal(updates.length, 1);
    assert.equal(updates[0].payload.completionPercent, 100);
    assert.equal(updates[0].payload.quantity, 10);
    assert.equal(updates[0].payload.plannedQuantity, 10);
    assert.equal(updates[0].payload.nutrition.calories, oldRecord.nutrition.calories);
    assert.equal(updates[0].payload.nutrition.protein, oldRecord.nutrition.protein);
    assert.equal(updates[0].payload.nutrition.naturalProtein, oldRecord.nutrition.naturalProtein);
    assert.equal(updates[0].payload.nutrition.specialProtein, oldRecord.nutrition.specialProtein);
  } finally {
    cleanup();
  }
});

test('editing a v2 meal preserves meal combination source on draft and save', async () => {
  const mealCombinationSource = {
    combinationId: 'combo-1',
    combinationName: '午餐组合'
  };
  const { page, FoodIntakeRecordModel, DailySummaryV2Model, cleanup } = loadMealEditorPage();
  const updates = [];
  FoodIntakeRecordModel.findByDate = async () => [
    buildStoredIntake({
      _id: 'food-intake-1',
      quantity: 10,
      plannedQuantity: 20,
      completionPercent: 50,
      mealCombinationSource
    })
  ];
  FoodIntakeRecordModel.updateFoodIntake = async (id, payload) => {
    updates.push({ id, payload });
    return true;
  };
  DailySummaryV2Model.markDirty = async () => true;

  try {
    const instance = createPageInstance(page, {
      mode: 'edit',
      selectedDate: '2026-05-25',
      editMealBatchId: 'meal-1',
      foodCatalog: []
    });

    await page.loadExistingV2Meal.call(instance, 'meal-1', 'baby-1');

    assert.deepEqual(instance.data.mealDraft.items[0].mealCombinationSource, mealCombinationSource);

    await page.saveMeal.call(instance);

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].payload.mealCombinationSource, mealCombinationSource);
  } finally {
    cleanup();
  }
});

test('inconsistent stored completion percents restore the first valid value and resave a unified value', async () => {
  const storedRecords = [
    buildStoredIntake({
      _id: 'food-intake-1',
      foodId: 'food-1',
      time: '12:30',
      plannedQuantity: 20,
      completionPercent: 75
    }),
    buildStoredIntake({
      _id: 'food-intake-2',
      foodId: 'food-2',
      foodName: '土豆泥',
      time: '12:31',
      plannedQuantity: 30,
      completionPercent: 50
    })
  ];
  const { page, FoodIntakeRecordModel, DailySummaryV2Model, cleanup } = loadMealEditorPage();
  const updates = [];
  FoodIntakeRecordModel.findByDate = async () => storedRecords;
  FoodIntakeRecordModel.updateFoodIntake = async (id, payload) => {
    updates.push({ id, payload });
    return true;
  };
  DailySummaryV2Model.markDirty = async () => true;

  try {
    const instance = createPageInstance(page, {
      mode: 'edit',
      selectedDate: '2026-05-25',
      editMealBatchId: 'meal-1',
      foodCatalog: []
    });

    await page.loadExistingV2Meal.call(instance, 'meal-1', 'baby-1');
    assert.equal(instance.data.completionPercent, 75);

    instance.setData({ completionPercent: 50 });
    await page.saveMeal.call(instance);

    assert.equal(updates.length, 2);
    assert.deepEqual(updates.map(update => update.payload.completionPercent), [50, 50]);
  } finally {
    cleanup();
  }
});
