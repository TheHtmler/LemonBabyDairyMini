const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createDbMock() {
  return {
    command: {
      eq: (value) => ({ $eq: value }),
      in: (value) => ({ $in: value }),
      or: (value) => ({ $or: value }),
      addToSet: (value) => ({ $addToSet: value }),
      remove: () => ({ $remove: true }),
      inc: (value) => ({ $inc: value })
    },
    collection() {
      return {
        where() { return this; },
        orderBy() { return this; },
        skip() { return this; },
        limit() { return this; },
        async get() { return { data: [] }; },
        doc() {
          return {
            async update() { return {}; }
          };
        },
        async add() { return { _id: 'new-id' }; }
      };
    },
    serverDate() {
      return new Date();
    }
  };
}

function loadFoodManagementPage(db = createDbMock()) {
  const modules = [
    '../miniprogram/pages/food-management/index.js',
    '../miniprogram/models/food.js',
    '../miniprogram/models/foodCategory.js',
    '../miniprogram/models/mealCombination.js',
    '../miniprogram/utils/index.js'
  ];
  modules.forEach((modulePath) => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  });

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  let pageConfig = null;
  const calls = {
    toasts: [],
    modals: []
  };

  global.wx = {
    cloud: {
      database() {
        return db;
      }
    },
    getStorageSync(key) {
      if (key === 'baby_uid') return 'baby-1';
      return '';
    },
    showToast(payload) {
      calls.toasts.push(payload);
    },
    showLoading() {},
    hideLoading() {},
    showModal(payload) {
      calls.modals.push(payload);
      if (payload && typeof payload.success === 'function') {
        payload.success({ confirm: true });
      }
    }
  };
  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1',
      isInitialized: true
    }
  });
  global.Page = (config) => {
    pageConfig = config;
  };

  require('../miniprogram/pages/food-management/index.js');
  const FoodModel = require('../miniprogram/models/food.js');
  const FoodCategoryModel = require('../miniprogram/models/foodCategory.js');
  const MealCombinationModel = require('../miniprogram/models/mealCombination.js');

  return {
    page: pageConfig,
    FoodModel,
    FoodCategoryModel,
    MealCombinationModel,
    calls,
    cleanup() {
      global.Page = previousPage;
      global.wx = previousWx;
      global.getApp = previousGetApp;
    }
  };
}

function createPageInstance(page, data = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data || {})),
      ...data
    },
    setData(updates, callback) {
      Object.entries(updates || {}).forEach(([path, value]) => {
        const parts = path.split('.');
        let target = this.data;
        while (parts.length > 1) {
          const key = parts.shift();
          target[key] = target[key] || {};
          target = target[key];
        }
        target[parts[0]] = value;
      });
      if (callback) callback();
    }
  };
}

function buildCombination(overrides = {}) {
  return {
    _id: overrides._id || 'combo-1',
    name: overrides.name || '午餐组合',
    usageCount: overrides.usageCount ?? 3,
    items: overrides.items || [
      {
        foodId: 'food-1',
        foodName: '米粉',
        plannedQuantity: 20,
        unit: 'g',
        foodSnapshot: {
          name: '米粉',
          category: '主食',
          baseUnit: 'g',
          baseQuantity: 100,
          nutritionPerUnit: { calories: 360, protein: 7, carbs: 80, fat: 1, fiber: 2, sodium: 5 }
        },
        plannedNutrition: { calories: 72, protein: 1.4, naturalProtein: 1.4, specialProtein: 0, carbs: 16, fat: 0.2, fiber: 0.4, sodium: 1 }
      }
    ]
  };
}

test('food management exposes food catalog and meal combination tabs', () => {
  const wxml = fs.readFileSync('miniprogram/pages/food-management/index.wxml', 'utf8');

  assert.match(wxml, /食物库/);
  assert.match(wxml, /菜谱/);
  assert.match(wxml, /新增菜谱/);
  assert.match(wxml, /activeManageTab/);
  assert.match(wxml, /showCombinationEditModal/);
  assert.match(wxml, /showCreateCombinationModal/);
  assert.doesNotMatch(wxml, /empty-action/);
  assert.doesNotMatch(wxml, /现在新增/);
  assert.doesNotMatch(wxml, /onCombinationItemNotesInput/);
});

test('food management can open directly on the meal combination tab', async () => {
  const { page, FoodModel, FoodCategoryModel, MealCombinationModel, cleanup } = loadFoodManagementPage();
  FoodCategoryModel.getCategories = async () => [];
  FoodModel.getAvailableFoods = async () => [];
  FoodModel.resolveFoodImageUrls = async foods => foods;
  MealCombinationModel.findByBaby = async () => [];

  try {
    const instance = createPageInstance(page);
    await page.onLoad.call(instance, {
      tab: 'combination',
      from: 'meal-editor'
    });

    assert.equal(instance.data.activeManageTab, 'combination');
    assert.equal(instance.data.showAddModal, false);
  } finally {
    cleanup();
  }
});

test('food management top tabs follow nutrition settings segmented style', () => {
  const wxss = fs.readFileSync('miniprogram/pages/food-management/index.wxss', 'utf8');
  const tabsRule = wxss.match(/\.manage-tabs\s*\{([\s\S]*?)\}/)?.[1] || '';
  const tabRule = wxss.match(/\.manage-tab\s*\{([\s\S]*?)\}/)?.[1] || '';
  const activeRule = wxss.match(/\.manage-tab\.active\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(tabsRule, /margin:\s*0 32rpx 24rpx/);
  assert.match(tabsRule, /background:\s*#FFF3C2/);
  assert.match(tabsRule, /padding:\s*6rpx/);
  assert.match(tabsRule, /border-radius:\s*999rpx/);
  assert.match(tabsRule, /box-shadow:\s*inset 0 0 0 1rpx rgba\(255,\s*184,\s*0,\s*0\.3\)/);
  assert.doesNotMatch(tabsRule, /gap:/);
  assert.match(tabRule, /flex:\s*1/);
  assert.match(tabRule, /min-width:\s*0/);
  assert.match(tabRule, /height:\s*64rpx/);
  assert.match(tabRule, /border-radius:\s*999rpx/);
  assert.match(activeRule, /background:\s*#FFB800/);
  assert.match(activeRule, /color:\s*#2F2400/);
});

test('food management recipe cards use warm visual hierarchy', () => {
  const wxml = fs.readFileSync('miniprogram/pages/food-management/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/food-management/index.wxss', 'utf8');
  const cardRule = wxss.match(/\.combination-card\s*\{([\s\S]*?)\}/)?.[1] || '';
  const badgeRule = wxss.match(/\.combination-badge\s*\{([\s\S]*?)\}/)?.[1] || '';
  const summaryRule = wxss.match(/\.combination-summary\s*\{([\s\S]*?)\}/)?.[1] || '';
  const recipeActionRule = wxss.match(/\.combination-actions\s+\.recipe-action\s*\{([\s\S]*?)\}/)?.[1] || '';
  const foodChipRule = wxss.match(/\.combination-food\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(wxml, /combination-card-top/);
  assert.match(wxml, /combination-badge/);
  assert.match(wxml, /combination-summary/);
  assert.match(wxml, /combination-nutrition/);
  assert.match(wxml, /nutritionSummary.calories/);
  assert.match(wxml, /nutritionSummary.protein/);
  assert.match(wxml, /nutritionSummary.carbs/);
  assert.match(wxml, /nutritionSummary.fat/);
  assert.match(wxml, /recipe-action/);
  assert.match(wxml, /combination-food-name/);
  assert.match(wxml, /combination-food-quantity/);
  assert.match(wxml, /保存常用搭配和每种食物的默认份量/);
  assert.match(wxml, /combination-food-search/);
  assert.match(wxml, /combination-food-option/);
  assert.match(wxml, /switchCombinationFoodCategory/);
  assert.match(wxml, /combinationModalStep === 'select'/);
  assert.match(wxml, /pendingCombinationItems/);
  assert.match(wxml, /goToCombinationQuantityStep/);
  assert.match(wxml, /backToCombinationFoodSelect/);
  assert.doesNotMatch(wxml, /combination-food-picker/);
  assert.doesNotMatch(wxml, /下次记录可直接带出默认份量/);
  assert.doesNotMatch(wxml, /combination-stat/);
  assert.match(wxml, /默认搭配/);
  assert.match(cardRule, /linear-gradient\(180deg,\s*#fffdf4 0%,\s*#ffffff 58%\)/);
  assert.match(cardRule, /border:\s*1rpx solid rgba\(255,\s*184,\s*0,\s*0\.18\)/);
  assert.match(badgeRule, /background:\s*rgba\(255,\s*184,\s*0,\s*0\.16\)/);
  assert.match(summaryRule, /background:\s*transparent/);
  assert.doesNotMatch(summaryRule, /border-radius:\s*999rpx/);
  assert.match(wxss, /\.combination-nutrition\s*\{/);
  assert.match(wxss, /\.combination-nutrition-item\s*\{/);
  assert.match(recipeActionRule, /height:\s*48rpx/);
  assert.match(recipeActionRule, /font-size:\s*22rpx/);
  assert.match(foodChipRule, /display:\s*inline-flex/);
  assert.match(foodChipRule, /align-items:\s*center/);
  assert.match(foodChipRule, /min-height:\s*46rpx/);
});

test('food management recipe action buttons share food action button styles', () => {
  const wxss = fs.readFileSync('miniprogram/pages/food-management/index.wxss', 'utf8');
  const actionRule = wxss.match(/\.action-btn\s*\{([\s\S]*?)\}/)?.[1] || '';
  const editRule = wxss.match(/\.action-btn\.edit\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(actionRule, /height:\s*64rpx/);
  assert.match(actionRule, /border-radius:\s*32rpx/);
  assert.match(actionRule, /font-size:\s*26rpx/);
  assert.match(editRule, /background:\s*#f0f5ff/);
  assert.match(editRule, /color:\s*#3a7afe/);
  assert.doesNotMatch(wxss, /\.food-actions\s+\.action-btn\s*\{/);
  assert.doesNotMatch(wxss, /\.food-actions\s+\.action-btn\.edit\s*\{/);
});

test('food management loads meal combinations for the current baby', async () => {
  const { page, FoodModel, FoodCategoryModel, MealCombinationModel, cleanup } = loadFoodManagementPage();
  const findCalls = [];
  FoodCategoryModel.getCategories = async () => [];
  FoodModel.getAvailableFoods = async () => [];
  FoodModel.resolveFoodImageUrls = async (foods) => foods;
  MealCombinationModel.findByBaby = async (babyUid) => {
    findCalls.push(babyUid);
    return [buildCombination()];
  };

  try {
    const instance = createPageInstance(page);
    await page.onLoad.call(instance, {});

    assert.deepEqual(findCalls, ['baby-1']);
    assert.equal(instance.data.mealCombinations.length, 1);
    assert.equal(instance.data.mealCombinations[0].name, '午餐组合');
    assert.deepEqual(instance.data.mealCombinations[0].nutritionSummary, {
      calories: 72,
      protein: 1.4,
      carbs: 16,
      fat: 0.2
    });
  } finally {
    cleanup();
  }
});

test('food management can edit meal combination name and item quantities', async () => {
  const { page, MealCombinationModel, cleanup } = loadFoodManagementPage();
  const updates = [];
  MealCombinationModel.updateMealCombination = async (id, payload) => {
    updates.push({ id, payload });
    return true;
  };
  MealCombinationModel.findByBaby = async () => [buildCombination({ name: '更新后组合' })];

  try {
    const instance = createPageInstance(page, {
      babyUid: 'baby-1',
      mealCombinations: [buildCombination()]
    });

    page.showCombinationEditModal.call(instance, {
      currentTarget: { dataset: { id: 'combo-1' } }
    });
    page.onCombinationFormNameInput.call(instance, { detail: { value: '常用午餐' } });
    page.onCombinationItemQuantityInput.call(instance, {
      currentTarget: { dataset: { index: 0 } },
      detail: { value: '25' }
    });
    await page.saveMealCombinationEdit.call(instance);

    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, 'combo-1');
    assert.equal(updates[0].payload.name, '常用午餐');
    assert.equal(updates[0].payload.items[0].plannedQuantity, 25);
    assert.equal(instance.data.showCombinationModal, false);
  } finally {
    cleanup();
  }
});

test('food management can create a meal combination from visual catalog food cards', async () => {
  const { page, MealCombinationModel, cleanup } = loadFoodManagementPage();
  const creates = [];
  MealCombinationModel.createMealCombination = async (payload) => {
    creates.push(payload);
    return { _id: 'combo-new' };
  };
  MealCombinationModel.findByBaby = async () => [buildCombination({ _id: 'combo-new', name: '新组合' })];

  try {
    const instance = createPageInstance(page, {
      babyUid: 'baby-1',
      foods: [
        {
          _id: 'food-rice',
          name: '米粉',
          category: '主食',
          baseUnit: 'g',
          baseQuantity: 100,
          nutritionPerUnit: { calories: 360, protein: 7, carbs: 80, fat: 1, fiber: 2, sodium: 5 },
          proteinSource: 'natural'
        }
      ],
      combinationFoodPickerOptions: [
        {
          _id: 'food-rice',
          name: '米粉',
          category: '主食',
          baseUnit: 'g',
          baseQuantity: 100,
          nutritionPerUnit: { calories: 360, protein: 7, carbs: 80, fat: 1, fiber: 2, sodium: 5 },
          proteinSource: 'natural'
        }
      ]
    });

    page.showCreateCombinationModal.call(instance);
    page.onCombinationFormNameInput.call(instance, { detail: { value: '早餐组合' } });
    page.onCombinationFoodOptionTap.call(instance, {
      currentTarget: { dataset: { id: 'food-rice' } }
    });
    assert.equal(instance.data.pendingCombinationItems.length, 1);
    assert.equal(instance.data.combinationForm.items.length, 0);

    page.goToCombinationQuantityStep.call(instance);
    assert.equal(instance.data.combinationModalStep, 'quantity');
    assert.equal(instance.data.combinationForm.items.length, 1);

    page.onCombinationItemQuantityInput.call(instance, {
      currentTarget: { dataset: { index: 0 } },
      detail: { value: '25' }
    });
    await page.saveMealCombinationEdit.call(instance);

    assert.equal(creates.length, 1);
    assert.equal(creates[0].babyUid, 'baby-1');
    assert.equal(creates[0].name, '早餐组合');
    assert.equal(creates[0].items[0].foodId, 'food-rice');
    assert.equal(creates[0].items[0].plannedQuantity, 25);
    assert.equal(creates[0].items[0].plannedNutrition.calories, 90);
    assert.equal(creates[0].items[0].notes, undefined);
    assert.equal(instance.data.showCombinationModal, false);
  } finally {
    cleanup();
  }
});

test('food management prevents duplicate meal combination names for current baby', async () => {
  const { page, MealCombinationModel, calls, cleanup } = loadFoodManagementPage();
  let createCalled = false;
  MealCombinationModel.createMealCombination = async () => {
    createCalled = true;
    return { _id: 'should-not-create' };
  };

  try {
    const instance = createPageInstance(page, {
      babyUid: 'baby-1',
      mealCombinations: [
        buildCombination({ _id: 'combo-existing', name: '早餐组合' })
      ],
      combinationForm: {
        name: ' 早餐组合 ',
        items: [
          {
            foodId: 'food-rice',
            foodName: '米粉',
            foodSnapshot: {
              name: '米粉',
              baseUnit: 'g',
              baseQuantity: 100,
              nutritionPerUnit: { calories: 360, protein: 7, carbs: 80, fat: 1 }
            },
            quantityInput: '20',
            plannedQuantity: 20,
            unit: 'g',
            food: {
              _id: 'food-rice',
              name: '米粉',
              baseUnit: 'g',
              baseQuantity: 100,
              nutritionPerUnit: { calories: 360, protein: 7, carbs: 80, fat: 1 }
            }
          }
        ]
      }
    });

    await page.saveMealCombinationEdit.call(instance);

    assert.equal(createCalled, false);
    assert.equal(calls.toasts.at(-1).title, '同名菜谱已存在');
  } finally {
    cleanup();
  }
});

test('food management filters visual meal combination food choices', () => {
  const { page, cleanup } = loadFoodManagementPage();

  try {
    const instance = createPageInstance(page, {
      combinationFoodPickerOptions: [
        {
          _id: 'food-rice',
          name: '米粉',
          category: '主食',
          baseUnit: 'g',
          baseQuantity: 100,
          nutritionPerUnit: { calories: 360 }
        },
        {
          _id: 'food-pumpkin',
          name: '南瓜泥',
          category: '蔬菜',
          baseUnit: 'g',
          baseQuantity: 100,
          nutritionPerUnit: { calories: 22 }
        }
      ],
      pendingCombinationItems: [{ foodId: 'food-rice' }],
      combinationForm: {
        name: '',
        items: []
      }
    });

    page.updateCombinationFoodSelector.call(instance, {
      category: '蔬菜',
      searchQuery: '南瓜'
    });

    assert.deepEqual(instance.data.combinationFoodCategories, ['全部', '主食', '蔬菜']);
    assert.equal(instance.data.filteredCombinationFoodOptions.length, 1);
    assert.equal(instance.data.filteredCombinationFoodOptions[0].name, '南瓜泥');
    assert.equal(instance.data.filteredCombinationFoodOptions[0].isInCombination, false);

    page.updateCombinationFoodSelector.call(instance, {
      category: '全部',
      searchQuery: '米'
    });

    assert.equal(instance.data.filteredCombinationFoodOptions.length, 1);
    assert.equal(instance.data.filteredCombinationFoodOptions[0].isInCombination, true);
  } finally {
    cleanup();
  }
});
