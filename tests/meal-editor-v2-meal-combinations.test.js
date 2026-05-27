const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageJsPath = path.join(__dirname, '../miniprogram/pages/meal-editor-v2/index.js');
const pageWxmlPath = path.join(__dirname, '../miniprogram/pages/meal-editor-v2/index.wxml');

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
  const collectionCalls = [];
  const db = {
    collectionCalls,
    command: {
      inc(value) {
        return { $inc: value };
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
    collection(name) {
      collectionCalls.push(name);
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
            }
          };
        },
        async add() {
          return { _id: 'new-combination-id' };
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
    showModal: 0,
    navigateTo: []
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
    showModal() {
      calls.showModal += 1;
      throw new Error('meal-editor-v2 must use custom in-page input instead of wx.showModal');
    },
    navigateTo(payload) {
      calls.navigateTo.push(payload);
    },
    navigateBack() {}
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
    '../miniprogram/models/dailySummaryV2.js',
    '../miniprogram/models/mealCombination.js',
    '../miniprogram/utils/mealCombinationUtils.js'
  ].forEach(clearModule);

  require('../miniprogram/pages/meal-editor-v2/index.js');
  const FoodModel = require('../miniprogram/models/food.js');
  const MealCombinationModel = require('../miniprogram/models/mealCombination.js');

  return {
    page: capturedPage,
    wxCalls,
    db,
    FoodModel,
    MealCombinationModel,
    cleanup() {
      global.wx = previous.wx;
      global.getApp = previous.getApp;
      global.getCurrentPages = previous.getCurrentPages;
      global.Page = previous.Page;
      global.setTimeout = previous.setTimeout;
    }
  };
}

function buildCatalogFood(overrides = {}) {
  return {
    _id: overrides._id || 'food-1',
    name: overrides.name || '新鲜米粉',
    category: overrides.category || '主食',
    baseQuantity: overrides.baseQuantity ?? 100,
    baseUnit: overrides.baseUnit || 'g',
    proteinSource: overrides.proteinSource || 'natural',
    nutritionPerUnit: overrides.nutritionPerUnit || {
      calories: 100,
      protein: 4,
      carbs: 20,
      fat: 1,
      fiber: 2,
      sodium: 5
    },
    proteinQuality: overrides.proteinQuality || '',
    milkType: overrides.milkType || ''
  };
}

function buildCombination(overrides = {}) {
  return {
    _id: overrides._id || 'combo-1',
    name: overrides.name || '午餐小组合',
    usageCount: overrides.usageCount ?? 2,
    items: overrides.items || [
      {
        foodId: 'food-1',
        foodName: '旧米粉',
        foodSnapshot: {
          name: '旧米粉',
          category: '旧分类',
          proteinSource: 'natural',
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 200,
            protein: 8,
            carbs: 40,
            fat: 2,
            fiber: 1,
            sodium: 9
          }
        },
        plannedQuantity: 10,
        unit: 'g',
        sortOrder: 0,
        notes: '慢慢喂'
      }
    ]
  };
}

function buildManualMealItem() {
  return {
    localId: 'manual-1',
    foodId: 'manual-food',
    food: buildCatalogFood({
      _id: 'manual-food',
      name: '手动添加',
      nutritionPerUnit: {
        calories: 200,
        protein: 2,
        carbs: 20,
        fat: 1,
        fiber: 0,
        sodium: 0
      }
    }),
    nameSnapshot: '手动添加',
    category: '主食',
    unit: 'g',
    quantity: 10,
    plannedQuantity: 10,
    nutrition: {
      calories: 20,
      protein: 0.2,
      naturalProtein: 0.2,
      specialProtein: 0,
      carbs: 2,
      fat: 0.1,
      fiber: 0,
      sodium: 0
    },
    plannedNutrition: {
      calories: 20,
      protein: 0.2,
      naturalProtein: 0.2,
      specialProtein: 0,
      carbs: 2,
      fat: 0.1,
      fiber: 0,
      sodium: 0
    },
    proteinSource: 'natural',
    naturalProtein: 0.2,
    specialProtein: 0,
    notes: ''
  };
}

test('onLoad loads meal combinations by babyUid without legacy fallback collections', async () => {
  const { page, db, FoodModel, MealCombinationModel, cleanup } = loadMealEditorPage();
  const findCalls = [];
  FoodModel.getAvailableFoods = async () => [];
  FoodModel.resolveFoodImageUrls = async (foods) => foods;
  MealCombinationModel.findByBaby = async (babyUid) => {
    findCalls.push(babyUid);
    return [buildCombination()];
  };

  try {
    const instance = createPageInstance(page);
    instance.loadRecentFoodOptions = async () => {};
    await page.onLoad.call(instance, { date: '2026-05-26' });

    assert.deepEqual(findCalls, ['baby-1']);
    assert.equal(instance.data.mealCombinations.length, 1);
    assert.equal(instance.data.mealCombinations[0].name, '午餐小组合');
    assert.equal(db.collectionCalls.includes('feeding_records'), false);
  } finally {
    cleanup();
  }
});

test('food drawer exposes food and meal combination tabs with friendly combination empty state', () => {
  const { page, cleanup } = loadMealEditorPage();

  try {
    const instance = createPageInstance(page);
    assert.equal(instance.data.drawerActiveTab, 'food');

    page.openFoodDrawer.call(instance);
    assert.equal(instance.data.drawerVisible, true);
    assert.equal(instance.data.drawerActiveTab, 'food');

    page.onDrawerTabTap.call(instance, {
      currentTarget: { dataset: { tab: 'combination' } }
    });
    assert.equal(instance.data.drawerActiveTab, 'combination');

    const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
    assert.match(wxml, /drawer-tab[\s\S]*食物/);
    assert.match(wxml, /drawer-tab[\s\S]*菜谱/);
    assert.match(wxml, /drawer-combination-panel/);
    assert.match(wxml, /还没有菜谱|暂无菜谱|常用菜谱/);
    assert.match(wxml, /去添加菜谱/);
    assert.match(wxml, /navigateToCombinationManagement/);
    assert.match(wxml, /bindinput="onCombinationNameInput"/);
    assert.doesNotMatch(wxml, /section-card combination-card/);
    assert.doesNotMatch(wxml, /onPendingNotesInput/);
    assert.doesNotMatch(wxml, /onDraftNotesInput/);
    assert.doesNotMatch(wxml, /meal-item-note/);
  } finally {
    cleanup();
  }
});

test('combination management entry opens food management on the recipe tab', () => {
  const { page, wxCalls, cleanup } = loadMealEditorPage();

  try {
    const instance = createPageInstance(page);
    page.navigateToCombinationManagement.call(instance);

    assert.equal(wxCalls.navigateTo.length, 1);
    assert.equal(wxCalls.navigateTo[0].url, '/pages/food-management/index?tab=combination&from=meal-editor');
  } finally {
    cleanup();
  }
});

test('food drawer lets users select multiple foods before entering quantities', () => {
  const { page, cleanup } = loadMealEditorPage();
  const rice = buildCatalogFood({ _id: 'food-rice', name: '米粉' });
  const pumpkin = buildCatalogFood({ _id: 'food-pumpkin', name: '南瓜泥' });

  try {
    const instance = createPageInstance(page, {
      drawerVisible: true,
      drawerStep: 'select',
      drawerActiveTab: 'food',
      foodCatalog: [rice, pumpkin],
      filteredFoodOptions: [rice, pumpkin],
      pendingMealItems: []
    });

    page.onFoodOptionTap.call(instance, {
      currentTarget: { dataset: { id: 'food-rice' } }
    });
    page.onFoodOptionTap.call(instance, {
      currentTarget: { dataset: { id: 'food-pumpkin' } }
    });

    assert.equal(instance.data.drawerStep, 'select');
    assert.equal(instance.data.pendingMealItems.length, 2);
    assert.deepEqual(instance.data.pendingMealItems.map(item => item.foodId), ['food-rice', 'food-pumpkin']);
    assert.equal(instance.data.filteredFoodOptions.find(item => item._id === 'food-rice').isPendingSelected, true);

    page.goToBatchQuantityStep.call(instance);

    assert.equal(instance.data.drawerStep, 'batchQuantity');
  } finally {
    cleanup();
  }
});

test('batch quantity step adds selected foods to the meal in one action', () => {
  const { page, cleanup } = loadMealEditorPage();
  const rice = buildCatalogFood({
    _id: 'food-rice',
    name: '米粉',
    nutritionPerUnit: {
      calories: 363.5,
      protein: 7,
      carbs: 80,
      fat: 1,
      fiber: 2,
      sodium: 5
    }
  });
  const pumpkin = buildCatalogFood({
    _id: 'food-pumpkin',
    name: '南瓜泥',
    nutritionPerUnit: {
      calories: 80,
      protein: 2,
      carbs: 12,
      fat: 0.5,
      fiber: 3,
      sodium: 4
    }
  });

  try {
    const instance = createPageInstance(page, {
      drawerVisible: true,
      drawerStep: 'batchQuantity',
      pendingMealItems: [
        page.buildPendingMealItemFromFood.call({ data: { pendingMealItems: [] } }, rice),
        page.buildPendingMealItemFromFood.call({ data: { pendingMealItems: [] } }, pumpkin)
      ],
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: []
      }
    });

    page.onPendingQuantityInput.call(instance, {
      currentTarget: { dataset: { id: 'food-rice' } },
      detail: { value: '20' }
    });
    page.onPendingQuantityInput.call(instance, {
      currentTarget: { dataset: { id: 'food-pumpkin' } },
      detail: { value: '30' }
    });
    page.addPendingItemsToMeal.call(instance);

    assert.equal(instance.data.mealDraft.items.length, 2);
    assert.equal(instance.data.mealDraft.items[0].quantity, 20);
    assert.equal(instance.data.mealDraft.items[0].nutrition.calories, 72.7);
    assert.deepEqual(instance.data.mealDraft.items[0].displayNutrition, {
      calories: 73,
      protein: 1.4,
      carbs: 16,
      fat: 0.2
    });
    assert.equal(instance.data.displayPlannedMealSummary.calories, 97);
    assert.equal(instance.data.displayPlannedMealSummary.carbs, 19.6);
    assert.equal(instance.data.displayPlannedMealSummary.fat, 0.35);
    assert.equal(instance.data.displayActualMealSummary.calories, 97);
    assert.equal(instance.data.mealDraft.items[1].quantity, 30);
    assert.equal(instance.data.drawerVisible, false);
    assert.equal(instance.data.pendingMealItems.length, 0);
  } finally {
    cleanup();
  }
});

test('meal summary separates prepared and actual values while food item keeps compact nutrition', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');

  assert.match(wxml, /meal-summary-macro-grid/);
  assert.match(wxml, /meal-summary-macro-amounts/);
  assert.match(wxml, /meal-summary-macro-amount-label">准备/);
  assert.match(wxml, /meal-summary-macro-amount-label">实际/);
  assert.match(wxml, /displayPlannedMealSummary\.calories/);
  assert.match(wxml, /displayActualMealSummary\.calories/);
  assert.match(wxml, /displayPlannedMealSummary\.protein/);
  assert.match(wxml, /displayActualMealSummary\.protein/);
  assert.match(wxml, /displayPlannedMealSummary\.carbs/);
  assert.match(wxml, /displayActualMealSummary\.carbs/);
  assert.match(wxml, /displayPlannedMealSummary\.fat/);
  assert.match(wxml, /displayActualMealSummary\.fat/);
  assert.match(wxml, /热量/);
  assert.match(wxml, /蛋白/);
  assert.match(wxml, /碳水/);
  assert.match(wxml, /脂肪/);
  assert.match(wxml, /\{\{foodItem\.nameSnapshot\}\} · \{\{foodItem\.quantity\}\}\{\{foodItem\.unit\}\}/);
  assert.match(wxml, /meal-item-nutrition-row/);
  assert.match(wxml, /displayNutrition\.calories/);
  assert.match(wxml, /displayNutrition\.protein/);
  assert.match(wxml, /displayNutrition\.carbs/);
  assert.match(wxml, /displayNutrition\.fat/);
  assert.doesNotMatch(wxml, /→/);
});

test('applying a combination from the add drawer stages items for quantity editing first', async () => {
  const { page, MealCombinationModel, cleanup } = loadMealEditorPage();
  MealCombinationModel.incrementUsage = async () => true;

  try {
    const instance = createPageInstance(page, {
      drawerVisible: true,
      drawerStep: 'select',
      drawerActiveTab: 'combination',
      foodCatalog: [buildCatalogFood()],
      mealCombinations: [buildCombination()],
      pendingMealItems: [],
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: []
      }
    });

    await page.applyMealCombination.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });

    assert.equal(instance.data.mealDraft.items.length, 0);
    assert.equal(instance.data.pendingMealItems.length, 1);
    assert.equal(instance.data.drawerStep, 'batchQuantity');
    assert.equal(instance.data.pendingMealItems[0].quantity, '10');
    assert.equal(instance.data.pendingMealItems[0].mealCombinationSource.combinationId, 'combo-1');
    assert.equal(instance.data.pendingMealItems[0].mealCombinationSource.combinationName, '午餐小组合');
    assert.match(instance.data.pendingMealItems[0].mealCombinationSource.sourceGroupId, /^combo-1_/);
  } finally {
    cleanup();
  }
});

test('save current meal as combination action lives with current meal items instead of add drawer', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
  const itemsCardIndex = wxml.indexOf('section-card items-card');
  const saveActionIndex = wxml.indexOf('保存当前为菜谱');
  const drawerIndex = wxml.indexOf('food-drawer');

  assert.ok(itemsCardIndex > -1);
  assert.ok(saveActionIndex > itemsCardIndex);
  assert.ok(saveActionIndex < drawerIndex);
  assert.match(wxml, /combination-save-btn compact \{\{mealDraft\.items\.length === 0 \? 'disabled' : ''\}\}/);
});

test('save current meal as combination is unavailable before adding foods', () => {
  const { page, wxCalls, cleanup } = loadMealEditorPage();

  try {
    const instance = createPageInstance(page, {
      combinationNameInputVisible: false,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: []
      }
    });

    page.showSaveCombinationInput.call(instance);

    assert.equal(instance.data.combinationNameInputVisible, false);
    assert.equal(wxCalls.toasts.length, 0);
  } finally {
    cleanup();
  }
});

test('meal completion copy uses easy to understand wording', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');

  assert.match(wxml, /吃了多少/);
  assert.match(wxml, /按吃了多少计入实际营养/);
  assert.doesNotMatch(wxml, /吃完比例/);
});

test('applying a combination prefers current catalog food and appends sourced planned items', async () => {
  const { page, MealCombinationModel, wxCalls, cleanup } = loadMealEditorPage();
  const combination = buildCombination();
  const originalCombination = JSON.parse(JSON.stringify(combination));
  const incrementCalls = [];
  MealCombinationModel.incrementUsage = async (combinationId) => {
    incrementCalls.push(combinationId);
    return true;
  };

  try {
    const catalogFood = buildCatalogFood({ name: '新鲜米粉' });
    const instance = createPageInstance(page, {
      completionPercent: 50,
      foodCatalog: [catalogFood],
      mealCombinations: [combination],
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: [buildManualMealItem()]
      }
    });

    await page.applyMealCombination.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });

    assert.equal(instance.data.mealDraft.items.length, 2);
    assert.equal(instance.data.mealDraft.items[0].localId, 'manual-1');
    const appliedItem = instance.data.mealDraft.items[1];
    assert.equal(appliedItem.nameSnapshot, '新鲜米粉');
    assert.deepEqual(appliedItem.food, catalogFood);
    assert.equal(appliedItem.plannedNutrition.calories, 10);
    assert.equal(appliedItem.sourceType, 'meal_combination');
    assert.equal(appliedItem.mealCombinationSource.combinationId, 'combo-1');
    assert.equal(appliedItem.mealCombinationSource.combinationName, '午餐小组合');
    assert.match(appliedItem.mealCombinationSource.sourceGroupId, /^combo-1_/);
    assert.equal(instance.data.mealDisplayGroups.length, 2);
    assert.equal(instance.data.mealDisplayGroups[0].type, 'meal_combination');
    assert.equal(instance.data.mealDisplayGroups[0].title, '午餐小组合');
    assert.equal(instance.data.mealDisplayGroups[1].type, 'manual_food');
    assert.notEqual(appliedItem.localId, combination.items[0].localId);
    assert.deepEqual(combination, originalCombination);
    assert.equal(instance.data.completionPercent, 50);
    assert.equal(instance.data.plannedMealSummary.calories, 30);
    assert.equal(instance.data.actualMealSummary.calories, 15);
    assert.deepEqual(incrementCalls, ['combo-1']);
    assert.equal(wxCalls.toasts.at(-1).title, '已加入菜谱');
  } finally {
    cleanup();
  }
});

test('meal editor renders grouped recipe and manual food sections', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');

  assert.match(wxml, /meal-display-group/);
  assert.match(wxml, /meal-combination-group/);
  assert.match(wxml, /manual-food-group/);
  assert.match(wxml, /toggleMealDisplayGroup/);
  assert.match(wxml, /group\.expanded/);
  assert.match(wxml, /group\.items/);
  assert.match(wxml, /食谱/);
  assert.match(wxml, /单独添加/);
});

test('applying a combination falls back to foodSnapshot when catalog food is missing', async () => {
  const { page, MealCombinationModel, cleanup } = loadMealEditorPage();
  const combination = buildCombination({
    items: [
      {
        foodId: 'missing-food',
        foodName: '快照南瓜泥',
        foodSnapshot: {
          name: '快照南瓜泥',
          category: '蔬菜',
          proteinSource: 'natural',
          baseQuantity: 100,
          baseUnit: 'g',
          nutritionPerUnit: {
            calories: 80,
            protein: 2,
            carbs: 12,
            fat: 0.5,
            fiber: 3,
            sodium: 4
          }
        },
        plannedQuantity: 25,
        unit: 'g',
        sortOrder: 0
      }
    ]
  });
  MealCombinationModel.incrementUsage = async () => true;

  try {
    const instance = createPageInstance(page, {
      foodCatalog: [],
      mealCombinations: [combination],
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: []
      }
    });

    await page.applyMealCombination.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });

    const [appliedItem] = instance.data.mealDraft.items;
    assert.equal(appliedItem.nameSnapshot, '快照南瓜泥');
    assert.equal(appliedItem.food, null);
    assert.equal(appliedItem.foodSnapshot.name, '快照南瓜泥');
    assert.equal(appliedItem.plannedNutrition.calories, 20);
  } finally {
    cleanup();
  }
});

test('usage increment failure does not block applying a combination', async () => {
  const { page, MealCombinationModel, wxCalls, cleanup } = loadMealEditorPage();
  MealCombinationModel.incrementUsage = async () => {
    throw new Error('network failed');
  };

  try {
    const instance = createPageInstance(page, {
      foodCatalog: [buildCatalogFood()],
      mealCombinations: [buildCombination()],
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: []
      }
    });

    await page.applyMealCombination.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });

    assert.equal(instance.data.mealDraft.items.length, 1);
    assert.match(wxCalls.toasts.at(-1).title, /使用次数/);
  } finally {
    cleanup();
  }
});

test('applying a combination ignores duplicate taps while usage update is in flight', async () => {
  const { page, MealCombinationModel, cleanup } = loadMealEditorPage();
  let resolveIncrement;
  const incrementCalls = [];
  MealCombinationModel.incrementUsage = async (combinationId) => {
    incrementCalls.push(combinationId);
    return new Promise((resolve) => {
      resolveIncrement = resolve;
    });
  };

  try {
    const instance = createPageInstance(page, {
      foodCatalog: [buildCatalogFood()],
      mealCombinations: [buildCombination()],
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: []
      }
    });

    const firstApply = page.applyMealCombination.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });
    const secondApply = page.applyMealCombination.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });

    assert.equal(instance.data.mealDraft.items.length, 1);
    assert.deepEqual(incrementCalls, ['combo-1']);

    resolveIncrement(true);
    await Promise.all([firstApply, secondApply]);

    assert.equal(instance.data.mealDraft.items.length, 1);
  } finally {
    cleanup();
  }
});

test('empty combination name shows toast and does not create or show modal', async () => {
  const { page, MealCombinationModel, wxCalls, cleanup } = loadMealEditorPage();
  let createCalled = false;
  MealCombinationModel.createMealCombination = async () => {
    createCalled = true;
  };

  try {
    const instance = createPageInstance(page, {
      combinationDraftName: '   ',
      combinationNameInputVisible: true,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: [buildManualMealItem()]
      }
    });

    await page.saveCurrentMealAsCombination.call(instance);

    assert.equal(createCalled, false);
    assert.equal(wxCalls.showModal, 0);
    assert.equal(wxCalls.toasts.at(-1).title, '请输入菜谱名称');
  } finally {
    cleanup();
  }
});

test('saving current meal creates combination from planned items and refreshes list', async () => {
  const { page, MealCombinationModel, wxCalls, cleanup } = loadMealEditorPage();
  const createdPayloads = [];
  const findCalls = [];
  MealCombinationModel.createMealCombination = async (payload) => {
    createdPayloads.push(payload);
    return { _id: 'new-combo' };
  };
  MealCombinationModel.findByBaby = async (babyUid) => {
    findCalls.push(babyUid);
    return [buildCombination({ _id: 'new-combo', name: '保存好的午餐' })];
  };

  try {
    const instance = createPageInstance(page, {
      combinationDraftName: '  保存好的午餐  ',
      combinationNameInputVisible: true,
      completionPercent: 50,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '宝宝喜欢',
        items: [
          buildManualMealItem()
        ]
      }
    });

    await page.saveCurrentMealAsCombination.call(instance);

    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0].babyUid, 'baby-1');
    assert.equal(createdPayloads[0].name, '保存好的午餐');
    assert.equal(createdPayloads[0].notes, '宝宝喜欢');
    assert.equal(createdPayloads[0].items.length, 1);
    assert.equal(createdPayloads[0].items[0].plannedQuantity, 10);
    assert.deepEqual(createdPayloads[0].items[0].plannedNutrition, buildManualMealItem().plannedNutrition);
    assert.deepEqual(findCalls, ['baby-1']);
    assert.equal(instance.data.mealCombinations[0].name, '保存好的午餐');
    assert.equal(instance.data.combinationDraftName, '');
    assert.equal(instance.data.combinationNameInputVisible, false);
    assert.equal(wxCalls.showModal, 0);
    assert.equal(wxCalls.toasts.at(-1).title, '已保存菜谱');
  } finally {
    cleanup();
  }
});

test('saving current meal ignores duplicate taps while create is in flight', async () => {
  const { page, MealCombinationModel, cleanup } = loadMealEditorPage();
  let resolveCreate;
  const createdPayloads = [];
  MealCombinationModel.createMealCombination = async (payload) => {
    createdPayloads.push(payload);
    return new Promise((resolve) => {
      resolveCreate = () => resolve({ _id: 'new-combo' });
    });
  };
  MealCombinationModel.findByBaby = async () => [buildCombination({ _id: 'new-combo' })];

  try {
    const instance = createPageInstance(page, {
      combinationDraftName: '常用午餐',
      combinationNameInputVisible: true,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: [buildManualMealItem()]
      }
    });

    const firstSave = page.saveCurrentMealAsCombination.call(instance);
    const secondSave = page.saveCurrentMealAsCombination.call(instance);

    assert.equal(createdPayloads.length, 1);

    resolveCreate();
    await Promise.all([firstSave, secondSave]);

    assert.equal(createdPayloads.length, 1);
  } finally {
    cleanup();
  }
});

test('saving current meal does not show success when refresh after create fails', async () => {
  const { page, MealCombinationModel, wxCalls, cleanup } = loadMealEditorPage();
  MealCombinationModel.createMealCombination = async () => ({ _id: 'new-combo' });
  MealCombinationModel.findByBaby = async () => {
    throw new Error('refresh failed');
  };

  try {
    const instance = createPageInstance(page, {
      combinationDraftName: '刷新失败午餐',
      combinationNameInputVisible: true,
      mealDraft: {
        mealTime: '12:30',
        mealLabel: '午餐',
        mealNote: '',
        items: [buildManualMealItem()]
      }
    });

    await page.saveCurrentMealAsCombination.call(instance);

    assert.equal(wxCalls.toasts.some(toast => toast.title === '已保存菜谱'), false);
    assert.equal(wxCalls.toasts.at(-1).icon, 'none');
    assert.match(wxCalls.toasts.at(-1).title, /刷新|保存菜谱失败/);
    assert.equal(instance.data.combinationNameInputVisible, true);
    assert.equal(instance.data.combinationDraftName, '刷新失败午餐');
    assert.equal(instance.data.combinationLoading, false);
  } finally {
    cleanup();
  }
});

test('meal-editor-v2 implementation does not use wx.showModal for saving combinations', () => {
  const pageJs = fs.readFileSync(pageJsPath, 'utf8');
  assert.equal(pageJs.includes('wx.showModal'), false);
});
