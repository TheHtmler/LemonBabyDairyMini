const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const FOOD_PICKER_SELECTION_KEY = 'meal_food_picker_selection';
const FOOD_PICKER_TARGET_CONTEXT_KEY = 'meal_food_picker_target_context';

function installWxMock(storage = {}) {
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    navigateTo(options) {
      storage.__navigateTo = options.url;
    },
    navigateBack() {
      storage.__navigateBack = true;
    },
    showToast() {},
    previewImage() {},
    cloud: {
      database() {
        return {
          command: {},
          collection() {
            return {};
          },
          serverDate() {
            return new Date('2026-06-13T00:00:00.000Z');
          }
        };
      }
    }
  };
  global.getApp = () => ({ globalData: { babyUid: 'baby-1' } });
  return () => {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  };
}

function loadPage(relativePath) {
  const pagePath = require.resolve(relativePath);
  [
    pagePath,
    require.resolve('../miniprogram/models/food.js'),
    require.resolve('../miniprogram/models/dailySummaryV2.js'),
    require.resolve('../miniprogram/utils/dailyRecordV2Service.js'),
    require.resolve('../miniprogram/utils/index.js'),
    require.resolve('../miniprogram/utils/feedingRecordStore.js'),
    require.resolve('../miniprogram/utils/nutritionTargetPreferences.js'),
    require.resolve('../miniprogram/utils/nutritionTargetPreview.js')
  ].forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  let pageConfig = null;
  const previousPage = global.Page;
  const previousGetApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  global.Page = previousPage;
  global.getApp = previousGetApp;

  return pageConfig;
}

function createPageInstance(page, data = {}) {
  return {
    ...page,
    data: {
      ...page.data,
      ...data
    },
    setData(updates, callback) {
      Object.entries(updates).forEach(([path, value]) => {
        const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
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

const systemFood = {
  _id: 'sys-1',
  name: '小麦',
  category: '谷类及制品',
  libraryScope: 'system',
  isSystem: true,
  baseUnit: 'g',
  baseQuantity: 100,
  nutritionBasis: { quantity: 100, unit: 'g' },
  nutritionPerBasis: { calories: 338, protein: 11.9, carbs: 75.2, fat: 1.3, fiber: 10.8, sodium: 0 },
  nutritionPerUnit: { calories: 338, protein: 11.9, carbs: 75.2, fat: 1.3, fiber: 10.8, sodium: 0 },
  sourceLabel: '系统'
};

const mineFood = {
  _id: 'mine-1',
  name: '家庭米糊',
  category: '婴幼儿辅食',
  libraryScope: 'mine',
  isSystem: false,
  baseUnit: 'g',
  baseQuantity: 100,
  nutritionBasis: { quantity: 100, unit: 'g' },
  nutritionPerBasis: { calories: 80, protein: 2, carbs: 12, fat: 1, fiber: 0, sodium: 3 },
  nutritionPerUnit: { calories: 80, protein: 2, carbs: 12, fat: 1, fiber: 0, sodium: 3 },
  sourceLabel: '我的'
};

test('food picker supports system and mine library tabs with cart selection', async () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const instance = createPageInstance(page, {
      foodCatalog: [systemFood, mineFood],
      activeLibraryScope: 'mine',
      activeCategory: '婴幼儿辅食'
    });
    instance.setData({
      foodCategories: instance.buildFoodCategories([systemFood, mineFood], 'mine')
    });

    assert.equal(page.data.activeLibraryScope, 'mine');
    assert.deepEqual(page.data.libraryTabs.map(item => item.scope), ['mine', 'system']);
    assert.deepEqual(instance.data.foodCategories.map(item => item.value), ['recent', '婴幼儿辅食']);
    instance.filterFoodOptions('');
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['mine-1']);
    assert.equal(instance.data.filteredFoodCount, 1);

    instance.onFoodOptionTap({ currentTarget: { dataset: { id: 'mine-1' } } });
    assert.deepEqual(instance.data.selectedFoodCart.map(item => item._id), []);
    assert.deepEqual(instance.data.pendingFoodIds, ['mine-1']);
    assert.equal(instance.data.visibleFoodOptions[0].selectedInCart, true);
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.deepEqual(instance.data.selectedFoodCart.map(item => item._id), ['mine-1']);
    assert.deepEqual(instance.data.pendingFoodIds, []);
    assert.equal(instance.data.cartExpanded, false);
    assert.equal(instance.data.visibleFoodOptions[0].selectedInCart, true);
    instance.toggleCartExpanded();
    assert.equal(instance.data.cartExpanded, true);
    instance.removeFoodFromSelectionCart({ currentTarget: { dataset: { id: 'mine-1' } } });
    assert.deepEqual(instance.data.selectedFoodCart, []);
    assert.equal(instance.data.cartExpanded, false);
    assert.equal(instance.data.visibleFoodOptions[0].selectedInCart, false);

    instance.switchLibraryScope({ currentTarget: { dataset: { scope: 'system' } } });
    assert.equal(instance.data.activeLibraryScope, 'system');
    assert.equal(instance.data.activeCategory, 'recent');
    assert.deepEqual(instance.data.foodCategories.map(item => item.value), ['recent', '谷类及制品']);
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), []);
    assert.equal(instance.data.filteredFoodCount, 0);
  } finally {
    restoreWx();
  }
});

test('food picker recent category filters recent foods inside each library tab', () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const instance = createPageInstance(page, {
      foodCatalog: [systemFood, mineFood],
      activeLibraryScope: 'mine',
      activeCategory: 'recent',
      recentFoodOptionsByScope: {
        mine: [mineFood],
        system: [systemFood]
      }
    });
    instance.setData({
      foodCategories: instance.buildFoodCategories([systemFood, mineFood], 'mine')
    });

    instance.filterFoodOptions('');
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['mine-1']);
    assert.equal(instance.data.filteredFoodCount, 1);

    instance.switchLibraryScope({ currentTarget: { dataset: { scope: 'system' } } });
    assert.equal(instance.data.activeCategory, 'recent');
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['sys-1']);
    assert.equal(instance.data.filteredFoodCount, 1);
  } finally {
    restoreWx();
  }
});

test('food picker search filters category tabs and items together', () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const vegetableFood = {
      ...mineFood,
      _id: 'mine-veg',
      name: '胡萝卜泥',
      category: '蔬菜类'
    };
    const fruitFood = {
      ...mineFood,
      _id: 'mine-fruit',
      name: '苹果泥',
      category: '水果类'
    };
    const instance = createPageInstance(page, {
      foodCatalog: [vegetableFood, fruitFood],
      activeLibraryScope: 'mine',
      activeCategory: 'recent'
    });
    instance.setData({
      foodCategories: instance.buildFoodCategories([vegetableFood, fruitFood], 'mine')
    });

    instance.onFoodSearchInput({ detail: { value: '泥' } });
    assert.deepEqual(instance.data.foodCategories.map(item => item.value), ['水果类', '蔬菜类']);
    assert.equal(instance.data.activeCategory, '水果类');
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['mine-fruit']);

    instance.onCategoryTap({ currentTarget: { dataset: { category: '蔬菜类' } } });
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['mine-veg']);

    instance.onFoodSearchInput({ detail: { value: '苹果' } });
    assert.deepEqual(instance.data.foodCategories.map(item => item.value), ['水果类']);
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['mine-fruit']);
  } finally {
    restoreWx();
  }
});

test('food picker virtualizes visible food rows while keeping the full filtered result', () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    global.wx.getWindowInfo = () => ({ windowHeight: 700, windowWidth: 375 });
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const foods = Array.from({ length: 120 }, (_, index) => ({
      ...mineFood,
      _id: `mine-${index}`,
      name: `我的食物${index}`,
      category: '婴幼儿辅食'
    }));
    const instance = createPageInstance(page, {
      foodCatalog: foods,
      activeLibraryScope: 'mine',
      activeCategory: '婴幼儿辅食'
    });

    instance.filterFoodOptions('');

    assert.equal(instance.data.filteredFoodCount, 120);
    assert.ok(instance.data.visibleFoodOptions.length < 120);
    assert.deepEqual(
      instance.data.visibleFoodOptions.slice(0, 3).map(item => item._id),
      ['mine-0', 'mine-1', 'mine-2']
    );
    assert.equal(instance.data.virtualTopSpacerHeight, 0);
    assert.ok(instance.data.virtualBottomSpacerHeight > 0);

    instance.updateVisibleFoodOptions(3000, { force: true });

    assert.ok(instance.data.visibleFoodOptions[0]._id !== 'mine-0');
    assert.ok(instance.data.virtualTopSpacerHeight > 0);
    assert.equal(instance.data.filteredFoodCount, 120);
  } finally {
    restoreWx();
  }
});

test('food picker adds to cart only after fly animation finishes', async () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const instance = createPageInstance(page, {
      foodCatalog: [mineFood],
      activeLibraryScope: 'mine',
      activeCategory: '婴幼儿辅食'
    });
    global.wx.getWindowInfo = () => ({ windowHeight: 800 });
    global.wx.createSelectorQuery = () => ({
      select() {
        return this;
      },
      boundingClientRect(callback) {
        callback({ left: 16, top: 720, width: 64, height: 64 });
        return this;
      },
      exec() {}
    });

    instance.addFoodToSelectionCart(mineFood, {
      touches: [{ clientX: 320, clientY: 180 }]
    });

    assert.deepEqual(instance.data.selectedFoodCart, []);
    assert.equal(instance.data.cartFlyer.visible, true);
    assert.match(instance.data.cartFlyer.outerStyle, /translate3d\(0, 0, 0\)/);

    await new Promise(resolve => setTimeout(resolve, 120));
    assert.deepEqual(instance.data.selectedFoodCart, []);
    assert.match(instance.data.cartFlyer.outerStyle, /translate3d\(-272px, 0, 0\)/);
    assert.match(instance.data.cartFlyer.innerStyle, /translate3d\(0, 572px, 0\)/);

    await new Promise(resolve => setTimeout(resolve, 490));
    assert.deepEqual(instance.data.selectedFoodCart.map(item => item._id), ['mine-1']);
    assert.equal(instance.data.cartFlyer.visible, false);
  } finally {
    restoreWx();
  }
});

test('food picker clears the cart and cancels pending fly-to-cart additions', async () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const instance = createPageInstance(page, {
      foodCatalog: [mineFood],
      activeLibraryScope: 'mine',
      activeCategory: '婴幼儿辅食'
    });
    global.wx.getWindowInfo = () => ({ windowHeight: 800 });

    instance.filterFoodOptions('');
    instance.addFoodToSelectionCart(mineFood, {
      touches: [{ clientX: 0, clientY: 0 }]
    });
    assert.deepEqual(instance.data.pendingFoodIds, ['mine-1']);
    assert.equal(instance.data.visibleFoodOptions[0].selectedInCart, true);

    instance.clearSelectionCart();

    assert.deepEqual(instance.data.selectedFoodCart, []);
    assert.deepEqual(instance.data.pendingFoodIds, []);
    assert.equal(instance.data.cartExpanded, false);
    assert.equal(instance.data.visibleFoodOptions[0].selectedInCart, false);
    assert.equal(instance.data.cartFlyer.visible, false);

    await new Promise(resolve => setTimeout(resolve, 230));
    assert.deepEqual(instance.data.selectedFoodCart, []);
    assert.deepEqual(instance.data.pendingFoodIds, []);
  } finally {
    restoreWx();
  }
});

test('food picker builds separate recent lists for mine and system foods', async () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const systemFoods = Array.from({ length: 12 }, (_, index) => ({
      ...systemFood,
      _id: `sys-${index}`,
      name: `系统食物${index}`
    }));
    const myFoods = [
      { ...mineFood, _id: 'mine-a', name: '我的食物A' },
      { ...mineFood, _id: 'mine-b', name: '我的食物B' }
    ];
    const instance = createPageInstance(page, {
      foodCatalog: [...systemFoods, ...myFoods]
    });
    const records = [
      {
        intakes: [
          ...systemFoods.map(food => ({ type: 'food', foodId: food._id })),
          { type: 'food', foodId: 'mine-a' },
          { type: 'food', foodId: 'mine-b' }
        ]
      }
    ];
    global.wx.cloud.database = () => ({
      collection: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              get: async () => ({ data: records })
            })
          })
        })
      })
    });

    await instance.loadRecentFoodOptions();

    assert.deepEqual(instance.data.recentFoodOptionsByScope.system.map(item => item._id), systemFoods.slice(0, 10).map(item => item._id));
    assert.deepEqual(instance.data.recentFoodOptionsByScope.mine.map(item => item._id), ['mine-a', 'mine-b']);
  } finally {
    restoreWx();
  }
});

test('food picker keeps loading while cached catalog waits for recent foods', async () => {
  const storage = {
    meal_food_picker_catalog_cache: {
      cachedAt: Date.now(),
      catalog: [mineFood]
    }
  };
  const restoreWx = installWxMock(storage);
  try {
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const instance = createPageInstance(page);
    let releaseRecent;
    const recentLoaded = new Promise(resolve => {
      releaseRecent = resolve;
    });
    instance.loadRecentFoodOptions = async () => {
      assert.equal(instance.data.loading, true);
      await recentLoaded;
      instance.setData({
        recentFoodOptionsByScope: {
          mine: [mineFood],
          system: []
        }
      });
    };

    const loadingPromise = instance.loadCachedFoodCatalog();
    assert.equal(instance.data.loading, true);
    releaseRecent();
    const hasCache = await loadingPromise;

    assert.equal(hasCache, true);
    assert.equal(instance.data.loading, false);
    assert.deepEqual(instance.data.visibleFoodOptions.map(item => item._id), ['mine-1']);
    assert.equal(instance.data.filteredFoodCount, 1);
  } finally {
    restoreWx();
  }
});

test('food picker confirms quantities in place and meal editor adds them directly', () => {
  const storage = {};
  let restoreWx = installWxMock(storage);
  try {
    const pickerPage = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const picker = createPageInstance(pickerPage, {
      selectedFoodCart: [systemFood, mineFood]
    });

    picker.confirmSelection();
    assert.equal(storage.__navigateBack, undefined);
    assert.equal(picker.data.quantityDrawerVisible, true);
    assert.deepEqual(picker.data.quantityDrafts.map(item => item.foodId), ['sys-1', 'mine-1']);
    assert.deepEqual(picker.data.quantityDrafts.map(item => Object.prototype.hasOwnProperty.call(item, 'notes')), [false, false]);
    picker.onQuantityDraftInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '50' } });
    picker.onQuantityDraftInput({ currentTarget: { dataset: { index: 1 } }, detail: { value: '25' } });
    assert.deepEqual(picker.data.quantityDrafts.map(item => item.quantity), ['', '']);
    assert.deepEqual(picker.quantityDraftValues, { 0: '50', 1: '25' });
    assert.deepEqual(picker.data.quantityDrafts.map(item => item.nutritionPreview.protein), [5.95, 0.5]);
    picker.submitQuantityDrafts();
    assert.equal(storage.__navigateBack, true);
    assert.deepEqual(storage[FOOD_PICKER_SELECTION_KEY], {
      schemaVersion: 3,
      items: [
        { foodId: 'sys-1', quantity: 50 },
        { foodId: 'mine-1', quantity: 25 }
      ]
    });
  } finally {
    restoreWx();
  }

  restoreWx = installWxMock(storage);
  try {
    const mealPage = loadPage('../miniprogram/pkg-records/meal-editor/index.js');
    const meal = createPageInstance(mealPage, {
      foodCatalog: [systemFood, mineFood],
      mealDraft: {
        mealTime: '08:30',
        mealLabel: '早餐',
        mealNote: '',
        items: []
      }
    });

    meal.handleFoodPickerSelection();
    assert.equal(meal.data.drawerVisible, false);
    assert.deepEqual(meal.data.batchFoodDrafts, []);
    assert.equal(storage[FOOD_PICKER_SELECTION_KEY], undefined);

    meal.onMealNoteInput({ detail: { value: '午餐整体备注' } });

    assert.deepEqual(meal.data.mealDraft.items.map(item => item.nameSnapshot), ['小麦', '家庭米糊']);
    assert.deepEqual(meal.data.mealDraft.items.map(item => item.quantity), [50, 25]);
    assert.deepEqual(meal.data.mealDraft.items.map(item => item.libraryScope), ['system', 'mine']);
    assert.deepEqual(meal.data.mealDraft.items.map(item => item.sourceLabel), ['系统', '我的']);
    assert.deepEqual(meal.data.mealDraft.items.map(item => item.foodSnapshot.libraryScope), ['system', 'mine']);
    assert.deepEqual(meal.data.mealDraft.items.map(item => Object.prototype.hasOwnProperty.call(item, 'notes')), [false, false]);
    assert.equal(meal.data.mealDraft.mealNote, '午餐整体备注');
    const mealIntakes = meal.buildMealIntakes('meal-test');
    assert.deepEqual(mealIntakes.map(item => item.notes), ['', '']);
    assert.deepEqual(mealIntakes.map(item => item.mealNote), ['午餐整体备注', '午餐整体备注']);
    assert.equal(meal.data.mealSummary.calories, 189);
  } finally {
    restoreWx();
  }
});

test('existing meal foods are preselected and updated when continuing to add foods', async () => {
  const storage = {};
  let restoreWx = installWxMock(storage);
  try {
    const mealPage = loadPage('../miniprogram/pkg-records/meal-editor/index.js');
    const existingItem = {
      localId: 'existing-mine',
      foodId: 'mine-1',
      food: mineFood,
      foodSnapshot: {},
      nameSnapshot: '家庭米糊',
      quantity: 30,
      unit: 'g',
      nutrition: { calories: 24, protein: 0.6, carbs: 3.6, fat: 0.3 },
      proteinSource: 'natural',
      naturalProtein: 0.6,
      specialProtein: 0,
      libraryScope: 'mine',
      sourceLabel: '我的'
    };
    const meal = createPageInstance(mealPage, {
      mealDraft: {
        mealTime: '08:30',
        mealLabel: '早餐',
        mealNote: '',
        items: [existingItem]
      },
      mealSummary: { calories: 24, protein: 0.6, carbs: 3.6, fat: 0.3, fiber: 0, sodium: 0 }
    });

    meal.openFoodDrawer();

    assert.deepEqual(storage[FOOD_PICKER_SELECTION_KEY], {
      schemaVersion: 3,
      items: [
        { foodId: 'mine-1', quantity: 30 }
      ]
    });
  } finally {
    restoreWx();
  }

  restoreWx = installWxMock(storage);
  try {
    const pickerPage = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const picker = createPageInstance(pickerPage, {
      foodCatalog: [systemFood, mineFood]
    });

    picker.pendingSelectedFoodIds = ['mine-1'];
    picker.pendingSelectedFoodQuantities = new Map([['mine-1', 30]]);
    picker.restoreSelectedFoodCartFromIds();

    assert.deepEqual(picker.data.selectedFoodCart.map(item => item._id), ['mine-1']);
    picker.confirmSelection();
    assert.equal(picker.data.quantityDrafts[0].initialQuantity, 30);
    assert.equal(picker.data.quantityDrafts[0].placeholder, '当前 30');
    assert.equal(picker.data.quantityDrafts[0].nutritionPreview.protein, 0.6);
    assert.deepEqual(picker.quantityDraftValues, { 0: '30' });

    picker.onQuantityDraftInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '45' } });
    assert.equal(picker.data.quantityDrafts[0].nutritionPreview.protein, 0.9);
    picker.submitQuantityDrafts();
    assert.deepEqual(storage[FOOD_PICKER_SELECTION_KEY], {
      schemaVersion: 3,
      items: [
        { foodId: 'mine-1', quantity: 45 }
      ]
    });
  } finally {
    restoreWx();
  }

  restoreWx = installWxMock(storage);
  try {
    const mealPage = loadPage('../miniprogram/pkg-records/meal-editor/index.js');
    const existingItem = {
      localId: 'existing-mine',
      foodId: 'mine-1',
      food: mineFood,
      foodSnapshot: {},
      nameSnapshot: '家庭米糊',
      quantity: 30,
      unit: 'g',
      nutrition: { calories: 24, protein: 0.6, carbs: 3.6, fat: 0.3 },
      proteinSource: 'natural',
      naturalProtein: 0.6,
      specialProtein: 0,
      libraryScope: 'mine',
      sourceLabel: '我的'
    };
    const meal = createPageInstance(mealPage, {
      foodCatalog: [mineFood],
      mealDraft: {
        mealTime: '08:30',
        mealLabel: '早餐',
        mealNote: '',
        items: [existingItem]
      }
    });

    meal.handleFoodPickerSelection();

    assert.equal(meal.data.mealDraft.items.length, 1);
    assert.equal(meal.data.mealDraft.items[0].localId, 'existing-mine');
    assert.equal(meal.data.mealDraft.items[0].quantity, 45);
    assert.equal(meal.data.mealDraft.items[0].nutrition.protein, 0.9);
  } finally {
    restoreWx();
  }
});

test('food picker quantity drawer previews protein target without category subtitle', () => {
  const storage = {
    [FOOD_PICKER_TARGET_CONTEXT_KEY]: {
      schemaVersion: 1,
      currentSummary: {
        calories: 100,
        protein: 3,
        naturalProtein: 3,
        specialProtein: 0
      },
      previousSummary: {},
      baseMealSummary: {},
      weight: 5,
      targetPreferences: {
        naturalProteinCoefficient: 1,
        specialProteinCoefficient: 0.5
      }
    }
  };
  const restoreWx = installWxMock(storage);
  try {
    const pickerPage = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const picker = createPageInstance(pickerPage, {
      selectedFoodCart: [systemFood, mineFood]
    });

    picker.loadFoodPickerTargetContext();
    picker.confirmSelection();

    assert.equal(picker.data.quantityDrawerVisible, true);
    assert.equal(picker.data.quantityDrafts[0].category, undefined);
    assert.equal(picker.data.quantityTargetPreview.proteinRows[0].actual, 3);
    assert.equal(picker.data.quantityTargetPreview.proteinRows[0].targetText, '5g');

    picker.onQuantityDraftInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '50' } });

    assert.equal(picker.data.quantityDrafts[0].quantity, '');
    assert.equal(picker.data.quantityDrafts[0].nutritionPreview.protein, 5.95);
    assert.equal(picker.data.quantityTargetPreview.proteinRows[0].actual, 9);
    assert.equal(picker.data.quantityTargetPreview.proteinRows[0].status, 'over');
  } finally {
    restoreWx();
  }
});

test('meal editor still supports legacy food picker id-only selections', () => {
  const storage = {
    [FOOD_PICKER_SELECTION_KEY]: {
      schemaVersion: 2,
      foodIds: ['sys-1', 'mine-1']
    }
  };
  const restoreWx = installWxMock(storage);
  try {
    const mealPage = loadPage('../miniprogram/pkg-records/meal-editor/index.js');
    const meal = createPageInstance(mealPage, {
      foodCatalog: [systemFood, mineFood],
      mealDraft: {
        mealTime: '08:30',
        mealLabel: '早餐',
        mealNote: '',
        items: []
      }
    });

    meal.handleFoodPickerSelection();

    assert.equal(meal.data.drawerVisible, true);
    assert.equal(meal.data.drawerStep, 'batch');
    assert.deepEqual(meal.data.batchFoodDrafts.map(item => item.foodId), ['sys-1', 'mine-1']);
    assert.deepEqual(meal.data.batchFoodDrafts.map(item => Object.prototype.hasOwnProperty.call(item, 'notes')), [false, false]);
    assert.equal(storage[FOOD_PICKER_SELECTION_KEY], undefined);
  } finally {
    restoreWx();
  }
});

test('legacy batch quantity drawer shows protein target at the top', () => {
  const storage = {
    [FOOD_PICKER_SELECTION_KEY]: {
      schemaVersion: 2,
      foodIds: ['sys-1']
    }
  };
  const restoreWx = installWxMock(storage);
  try {
    const mealPage = loadPage('../miniprogram/pkg-records/meal-editor/index.js');
    const meal = createPageInstance(mealPage, {
      foodCatalog: [systemFood],
      mealDraft: {
        mealTime: '08:30',
        mealLabel: '早餐',
        mealNote: '',
        items: []
      },
      targetContext: {
        currentSummary: { calories: 100, protein: 3, naturalProtein: 3, specialProtein: 0 },
        weight: 5,
        targetPreferences: {
          naturalProteinCoefficient: 1,
          specialProteinCoefficient: 0.5
        }
      }
    });

    meal.handleFoodPickerSelection();

    assert.equal(meal.data.drawerVisible, true);
    assert.equal(meal.data.batchTargetPreview.proteinRows[0].actual, 3);
    assert.equal(meal.data.batchTargetPreview.proteinRows[0].targetText, '5g');

    meal.onBatchQuantityInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '50' } });

    assert.equal(meal.data.batchFoodDrafts[0].nutritionPreview.protein, 5.95);
    assert.equal(meal.data.batchTargetPreview.proteinRows[0].actual, 9);
    assert.equal(meal.data.batchTargetPreview.proteinRows[0].status, 'over');
  } finally {
    restoreWx();
  }
});

test('meal editor writes target context before opening food picker', () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const mealPage = loadPage('../miniprogram/pkg-records/meal-editor/index.js');
    const existingItem = {
      foodId: 'mine-1',
      food: mineFood,
      nutrition: { calories: 40, protein: 1, carbs: 6, fat: 0.5 },
      proteinSource: 'natural',
      naturalProtein: 1,
      specialProtein: 0
    };
    const meal = createPageInstance(mealPage, {
      mode: 'edit',
      originalMealSummary: { calories: 20, protein: 0.5, naturalProtein: 0.5, specialProtein: 0 },
      mealDraft: {
        mealTime: '08:30',
        mealLabel: '早餐',
        mealNote: '',
        items: [existingItem]
      },
      targetContext: {
        currentSummary: { calories: 100, protein: 3, naturalProtein: 3, specialProtein: 0 },
        weight: 5,
        targetPreferences: {
          naturalProteinCoefficient: 1,
          specialProteinCoefficient: 0.5
        }
      }
    });

    meal.openFoodDrawer();

    assert.equal(storage.__navigateTo, '/pkg-records/food-picker/index');
    assert.deepEqual(storage[FOOD_PICKER_TARGET_CONTEXT_KEY], {
      schemaVersion: 1,
      currentSummary: { calories: 100, protein: 3, naturalProtein: 3, specialProtein: 0, carbs: 0, fat: 0 },
      previousSummary: { calories: 20, protein: 0.5, naturalProtein: 0.5, specialProtein: 0, carbs: 0, fat: 0 },
      baseMealSummary: { calories: 40, protein: 1, naturalProtein: 1, specialProtein: 0, carbs: 6, fat: 0.5 },
      weight: 5,
      targetPreferences: {
        naturalProteinCoefficient: 1,
        specialProteinCoefficient: 0.5
      }
    });
  } finally {
    restoreWx();
  }
});

test('food picker selection storage keeps only compact id and quantity items', () => {
  const largeFood = {
    ...systemFood,
    _id: 'sys-large',
    name: '超大系统食物',
    aliases: Array.from({ length: 300 }, (_, index) => `alias-${index}`),
    rawPayload: 'x'.repeat(300000)
  };
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    const pickerPage = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const picker = createPageInstance(pickerPage, {
      selectedFoodCart: [largeFood, mineFood]
    });

    picker.confirmSelection();
    assert.equal(picker.data.quantityDrawerVisible, true);
    assert.equal(JSON.stringify(picker.data.quantityDrafts).includes('rawPayload'), false);
    picker.onQuantityDraftInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '12' } });
    picker.onQuantityDraftInput({ currentTarget: { dataset: { index: 1 } }, detail: { value: '34' } });
    picker.submitQuantityDrafts();

    assert.deepEqual(storage[FOOD_PICKER_SELECTION_KEY], {
      schemaVersion: 3,
      items: [
        { foodId: 'sys-large', quantity: 12 },
        { foodId: 'mine-1', quantity: 34 }
      ]
    });
    assert.equal(JSON.stringify(storage[FOOD_PICKER_SELECTION_KEY]).includes('rawPayload'), false);
  } finally {
    restoreWx();
  }
});

test('food picker catalog cache failure does not break catalog loading', async () => {
  const storage = {};
  const restoreWx = installWxMock(storage);
  try {
    global.wx.setStorageSync = (key, value) => {
      if (key === 'meal_food_picker_catalog_cache') {
        throw new Error('exceed storage item max length');
      }
      storage[key] = value;
    };
    let removedKey = '';
    global.wx.removeStorageSync = key => {
      removedKey = key;
      delete storage[key];
    };
    const page = loadPage('../miniprogram/pkg-records/food-picker/index.js');
    const instance = createPageInstance(page);
    instance.loadRecentFoodOptions = async () => {};
    instance.resolveCatalogImageUrls = async () => {};

    await instance.loadFoodCatalog();

    assert.equal(instance.data.loading, false);
    assert.equal(removedKey, 'meal_food_picker_catalog_cache');
  } finally {
    restoreWx();
  }
});

test('meal editor navigates to full page food picker and food picker is registered', () => {
  const appJson = fs.readFileSync(require.resolve('../miniprogram/app.json'), 'utf8');
  const mealWxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/meal-editor/index.wxml'),
    'utf8'
  );
  const mealJs = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/meal-editor/index.js'),
    'utf8'
  );
  const mealWxss = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/meal-editor/index.wxss'),
    'utf8'
  );
  const pickerWxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/food-picker/index.wxml'),
    'utf8'
  );
  const pickerJs = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/food-picker/index.js'),
    'utf8'
  );
  const pickerWxss = fs.readFileSync(
    require.resolve('../miniprogram/pkg-records/food-picker/index.wxss'),
    'utf8'
  );

  assert.match(appJson, /"food-picker\/index"/);
  assert.doesNotMatch(mealWxml, /food-library-tabs/);
  assert.doesNotMatch(mealWxml, /selectedFoodCart/);
  assert.match(mealWxml, /batchFoodDrafts/);
  assert.match(mealWxml, /mealDraft\.mealNote/);
  assert.doesNotMatch(mealWxml, /onBatchNotesInput/);
  assert.doesNotMatch(mealWxml, /onDraftNotesInput/);
  assert.doesNotMatch(mealWxml, /batch-notes/);
  assert.doesNotMatch(mealWxml, /item\.notes/);
  assert.doesNotMatch(mealWxml, /currentFoodDraft\.notes/);
  assert.match(mealWxml, /batchTargetPreview/);
  assert.match(mealWxml, /title="蛋白目标"/);
  assert.match(mealJs, /refreshBatchTargetPreview/);
  assert.doesNotMatch(mealJs, /onBatchNotesInput/);
  assert.doesNotMatch(mealJs, /onDraftNotesInput/);
  assert.doesNotMatch(mealJs, /currentFoodDraft\.notes/);
  assert.doesNotMatch(mealWxss, /batch-notes/);
  assert.doesNotMatch(mealWxss, /meal-item-note/);
  assert.match(pickerWxml, /library-tabs/);
  assert.match(pickerJs, /系统食物/);
  assert.match(pickerJs, /我的食物/);
  assert.match(pickerWxml, /confirmSelection/);
  assert.match(pickerWxml, /quantityDrawerVisible/);
    assert.match(pickerWxml, /onQuantityDraftInput/);
    assert.match(pickerWxml, /submitQuantityDrafts/);
    assert.match(pickerWxml, />填写份量</);
    assert.match(pickerWxml, />加入本顿</);
    assert.match(pickerWxml, /nutrition-target-preview/);
    assert.match(pickerWxml, /title="蛋白目标"/);
    assert.doesNotMatch(pickerWxml, /quantity-draft-sub/);
    assert.match(pickerJs, /FOOD_PICKER_TARGET_CONTEXT_KEY/);
    assert.match(pickerJs, /refreshQuantityTargetPreview/);
    assert.match(mealJs, /writeFoodPickerTargetContext/);
  assert.doesNotMatch(pickerWxml, /value="\{\{item\.quantity\}\}"/);
  assert.match(pickerWxml, /nutritionPreview/);
  assert.match(pickerWxml, /蛋白 \{\{item\.nutritionPreview\.protein/);
  assert.match(pickerWxml, /输入份量后计算蛋白/);
  assert.match(pickerWxml, /没有想要的食物？/);
  assert.match(pickerWxml, /去添加/);
  assert.match(pickerWxml, /已选食物/);
  assert.match(pickerWxml, /点击食物右侧的 \+ 添加到这里/);
  assert.match(pickerWxml, /cart-detail-panel/);
  assert.match(pickerWxml, /cart-flyer/);
  assert.match(pickerWxml, /cart-flyer-dot/);
  assert.match(pickerWxml, /cartFlyer\.outerStyle/);
  assert.match(pickerWxml, /cartFlyer\.innerStyle/);
  assert.match(pickerWxml, /clearSelectionCart/);
  assert.match(pickerWxml, />清空</);
  assert.match(pickerWxml, /toggleCartExpanded/);
  assert.match(pickerWxml, /collapseCart/);
  assert.match(pickerWxml, /id="cartIcon"/);
  assert.match(pickerWxml, /cart-plate-icon/);
  assert.doesNotMatch(pickerWxml, />篮</);
  assert.match(pickerJs, /playAddToCartAnimation/);
  assert.match(pickerJs, /clearSelectionCart/);
  assert.match(pickerJs, /cartFlyerToken/);
  assert.match(pickerJs, /cartFlyer\.outerStyle/);
  assert.match(pickerJs, /cartFlyer\.innerStyle/);
  assert.match(pickerJs, /pendingFoodIds/);
  assert.match(pickerJs, /writeFoodSelectionItems/);
  assert.match(pickerJs, /schemaVersion:\s*3/);
  assert.match(pickerJs, /quantityDraftValues/);
  assert.match(pickerJs, /refreshQuantityPreview/);
  assert.doesNotMatch(pickerJs, /\[`quantityDrafts\[\$\{draftIndex\}\]\.quantity`\]/);
  assert.match(mealJs, /readFoodSelectionItems/);
  assert.match(mealJs, /addSelectedFoodItemsToMeal/);
  assert.doesNotMatch(pickerWxss, /transition-property:\s*left,\s*top/);
  assert.match(pickerWxss, /\.cart-flyer-dot/);
  assert.match(pickerWxss, /transition:\s*transform 0\.52s linear/);
  assert.match(pickerWxss, /cubic-bezier\(0\.18,\s*0\.86,\s*0\.42,\s*1\)/);
  assert.match(pickerWxss, /display:\s*flex;\s*[\s\S]*?justify-content:\s*center;/);
  assert.match(pickerWxss, /\.quantity-drawer\s*\{[\s\S]*?height:\s*82vh;/);
  assert.match(pickerWxss, /\.quantity-draft-list\s*\{[\s\S]*?height:\s*0;/);
  assert.match(pickerWxss, /\.quantity-actions\s*\{[\s\S]*?box-shadow:/);
  assert.match(pickerWxss, /\.quantity-actions\s*\{[\s\S]*?z-index:\s*2;/);
  assert.match(pickerJs, /cartExpanded:\s*false/);
  assert.match(pickerJs, /loading:\s*true/);
  assert.match(pickerWxml, /wx:for="\{\{visibleFoodOptions\}\}"/);
  assert.match(pickerWxml, /bindscroll="onFoodListScroll"/);
  assert.match(pickerWxml, /enhanced="\{\{true\}\}"/);
  assert.match(pickerWxml, /fast-deceleration="\{\{true\}\}"/);
  assert.match(pickerWxml, /lazy-load="\{\{true\}\}"/);
  assert.match(pickerWxml, /wx:if="\{\{!loading && filteredFoodCount === 0\}\}"/);
  assert.match(pickerJs, /visibleFoodOptions/);
  assert.match(pickerJs, /buildVisibleFoodWindow/);
  assert.match(pickerJs, /FOOD_VIRTUAL_ROW_HEIGHT_RPX/);
});
