const FoodModel = require('../../models/food');
const FoodIntakeRecordModel = require('../../models/foodIntakeRecord');
const { getBabyUid } = require('../../utils/index');
const { getNutritionTargetPreferences, hasTargetCoefficient } = require('../../utils/nutritionTargetPreferences');
const {
  buildEntryTargetPreview,
  summarizeFoodItems,
  normalizeSummary,
  addSummaries
} = require('../../utils/nutritionTargetPreview');

const FOOD_PICKER_SELECTION_KEY = 'meal_food_picker_selection';
const RECIPE_INGREDIENT_PICKER_SELECTION_KEY = 'recipe_ingredient_picker_selection';
const FOOD_PICKER_TARGET_CONTEXT_KEY = 'meal_food_picker_target_context';
const FOOD_PICKER_LAST_LIBRARY_SCOPE_KEY = 'meal_food_picker_last_library_scope';
const FOOD_PLACEHOLDER_IMAGE = '/images/LemonLogo.png';
const MAX_RECENT_FOODS = 10;
const RECENT_FOOD_DAYS = 14;
const RECENT_FOOD_FETCH_LIMIT = 120;
const RECENT_CATEGORY = 'recent';
const FOOD_VIRTUAL_ROW_HEIGHT_RPX = 190;
const FOOD_VIRTUAL_BUFFER = 6;
const FOOD_VIRTUAL_MIN_WINDOW = 18;
const FOOD_CART_FLY_DURATION = 520;
const FOOD_CART_FLY_START_DELAY = 24;
const FOOD_LIBRARY_TABS = [
  { scope: 'mine', label: '我的食物' },
  { scope: 'system', label: '系统食物' }
];
let cachedWindowInfo = null;

function normalizeSearchText(value = '') {
  return value.toString().trim().toLowerCase().replace(/\s+/g, '');
}

function fuzzyIncludes(text = '', query = '') {
  const source = normalizeSearchText(text);
  const keyword = normalizeSearchText(query);
  if (!keyword) return true;
  if (!source) return false;
  if (source.includes(keyword)) return true;

  let queryIndex = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === keyword[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === keyword.length) {
        return true;
      }
    }
  }
  return false;
}

function readFoodSelectionIds(value) {
  if (Array.isArray(value)) {
    return value.map(item => (typeof item === 'string' ? item : item?._id)).filter(Boolean);
  }
  if (Array.isArray(value?.items)) {
    return value.items.map(item => item?.foodId || item?._id).filter(Boolean);
  }
  if (Array.isArray(value?.foodIds)) {
    return value.foodIds.filter(Boolean);
  }
  return [];
}

function readFoodSelectionItems(value) {
  if (Array.isArray(value?.items)) {
    return value.items
      .map(item => ({
        foodId: item?.foodId || item?._id || '',
        quantity: item?.quantity
      }))
      .filter(item => item.foodId);
  }
  return [];
}

function writeFoodSelectionIds(foodIds = [], storageKey = FOOD_PICKER_SELECTION_KEY) {
  wx.setStorageSync(storageKey, {
    schemaVersion: 2,
    foodIds: (foodIds || []).filter(Boolean)
  });
}

function writeFoodSelectionItems(items = []) {
  wx.setStorageSync(FOOD_PICKER_SELECTION_KEY, {
    schemaVersion: 3,
    items: (items || [])
      .map(item => ({
        foodId: item.foodId,
        quantity: item.quantity
      }))
      .filter(item => item.foodId && item.quantity)
  });
}

function getCachedWindowInfo() {
  if (cachedWindowInfo) return cachedWindowInfo;
  let info = {};
  if (typeof wx.getWindowInfo === 'function') {
    try {
      info = wx.getWindowInfo() || {};
    } catch (error) {
      info = {};
    }
  }
  cachedWindowInfo = {
    windowWidth: Number(info.windowWidth) || 375,
    windowHeight: Number(info.windowHeight) || 720
  };
  return cachedWindowInfo;
}

function safeRemoveStorageSync(key, options = {}) {
  try {
    wx.removeStorageSync(key);
  } catch (error) {
    if (!options.silent) {
      console.warn('清理本地缓存失败:', key, error);
    }
  }
}

function safeSetStorageSync(key, value, options = {}) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    if (!options.silent) {
      console.warn('写入本地缓存失败，已跳过缓存:', key, error);
    }
    safeRemoveStorageSync(key, options);
    return false;
  }
}

Page({
  data: {
    loading: true,
    foodCatalog: [],
    libraryTabs: FOOD_LIBRARY_TABS,
    activeLibraryScope: 'mine',
    foodCategories: [],
    activeCategory: '',
    recentFoodOptionsByScope: {
      mine: [],
      system: []
    },
    foodSearchQuery: '',
    filteredFoodCount: 0,
    visibleFoodOptions: [],
    virtualTopSpacerHeight: 0,
    virtualBottomSpacerHeight: 0,
    foodListScrollTop: 0,
    selectedFoodCart: [],
    pendingFoodIds: [],
    cartExpanded: false,
    cartBumping: false,
    cartFlyer: {
      visible: false,
      outerStyle: '',
      innerStyle: ''
    },
    quantityDrawerVisible: false,
    quantityDrafts: [],
    quantityDraftScrollIntoView: '',
    quantityDraftInvalidIndex: -1,
    quantityTargetContext: null,
    quantityTargetPreview: null,
    isRecipeIngredientPicker: false,
    cartConfirmText: '确定'
  },

  async onLoad(options = {}) {
    const from = String(options.from || '').trim();
    this.pickerSource = from === 'recipe-management' ? 'recipe-management' : 'meal';
    const isRecipeIngredientPicker = this.pickerSource === 'recipe-management';
    this.setData({
      isRecipeIngredientPicker,
      cartConfirmText: isRecipeIngredientPicker ? '添加到食谱' : '确定'
    });
    this.loadFoodPickerTargetContext();
    this.restoreLastLibraryScope();
    const selectionKey = isRecipeIngredientPicker
      ? RECIPE_INGREDIENT_PICKER_SELECTION_KEY
      : FOOD_PICKER_SELECTION_KEY;
    const previousSelection = wx.getStorageSync(selectionKey);
    this.pendingSelectedFoodIds = readFoodSelectionIds(previousSelection);
    this.pendingSelectedFoodQuantities = new Map(
      readFoodSelectionItems(previousSelection).map(item => [item.foodId, item.quantity])
    );
    await this.loadFoodCatalog();
  },

  async onShow() {
    await this.refreshQuantityTargetPreferences();
  },

  onUnload() {
    if (this.quantityTargetPreviewTimer) {
      clearTimeout(this.quantityTargetPreviewTimer);
      this.quantityTargetPreviewTimer = null;
    }
    if (this.cartFlyerStartTimer) {
      clearTimeout(this.cartFlyerStartTimer);
      this.cartFlyerStartTimer = null;
    }
    if (this.cartFlyerFinishTimer) {
      clearTimeout(this.cartFlyerFinishTimer);
      this.cartFlyerFinishTimer = null;
    }
    try {
      wx.removeStorageSync(FOOD_PICKER_TARGET_CONTEXT_KEY);
    } catch (error) {
      console.warn('清理食物选择目标上下文失败:', error);
    }
  },

  loadFoodPickerTargetContext() {
    const context = wx.getStorageSync(FOOD_PICKER_TARGET_CONTEXT_KEY);
    if (!context || context.schemaVersion !== 1) {
      this.setData({
        quantityTargetContext: null,
        quantityTargetPreview: null
      });
      return;
    }

    this.setData({
      quantityTargetContext: {
        currentSummary: normalizeSummary(context.currentSummary || {}),
        previousSummary: normalizeSummary(context.previousSummary || {}),
        baseMealSummary: normalizeSummary(context.baseMealSummary || {}),
        weight: context.weight || '',
        targetPreferences: context.targetPreferences || {}
      }
    });
  },

  isValidLibraryScope(scope = '') {
    return FOOD_LIBRARY_TABS.some(item => item.scope === scope);
  },

  restoreLastLibraryScope() {
    const scope = wx.getStorageSync(FOOD_PICKER_LAST_LIBRARY_SCOPE_KEY);
    if (!this.isValidLibraryScope(scope) || scope === this.data.activeLibraryScope) return;
    this.setData({ activeLibraryScope: scope });
  },

  rememberLibraryScope(scope = '') {
    if (!this.isValidLibraryScope(scope)) return;
    safeSetStorageSync(FOOD_PICKER_LAST_LIBRARY_SCOPE_KEY, scope, { silent: true });
  },

  async loadFoodCatalog(options = {}) {
    const babyUid = getBabyUid();
    if (!options.silent) {
      this.setData({ loading: true });
    }
    try {
      const foods = await FoodModel.getAvailableFoods(babyUid, {
        preferLocalSystemIndex: true
      });
      const catalog = this.formatFoodCatalog(foods || []);
      this.setFoodCatalog(catalog);
      const foodCategories = this.buildFoodCategories(catalog, this.data.activeLibraryScope);
      this.setData({
        foodCategories,
        activeCategory: this.getNextActiveFoodCategory(foodCategories, this.data.activeCategory)
      }, async () => {
        this.restoreSelectedFoodCartFromIds();
        await this.loadRecentFoodOptions();
        this.filterFoodOptions();
        this.resolveCatalogImageUrls(catalog);
        if (!options.silent) {
          this.setData({ loading: false });
        }
      });
    } catch (error) {
      console.error('加载食物库失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setFoodCatalog([]);
      this.setData({
        foodCatalog: [],
        foodCategories: [],
        activeCategory: '',
        recentFoodOptionsByScope: {
          mine: [],
          system: []
        },
        filteredFoodCount: 0,
        visibleFoodOptions: [],
        virtualTopSpacerHeight: 0,
        virtualBottomSpacerHeight: 0
      });
      if (!options.silent) {
        this.setData({ loading: false });
      }
    }
  },

  formatFoodCatalog(foods = []) {
    return [...(foods || [])]
      .map(food => ({
        ...food,
        displayImage: food.imageUrl || food.image || FOOD_PLACEHOLDER_IMAGE,
        sourceLabel: this.getFoodSourceLabel(food),
        libraryScope: this.getFoodLibraryScope(food)
      }))
      .sort((a, b) => {
        const categoryA = (a.category || '').toString();
        const categoryB = (b.category || '').toString();
        if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);
        return (a.name || '').localeCompare(b.name || '');
      });
  },

  getFoodCatalog() {
    return Array.isArray(this._foodCatalog) ? this._foodCatalog : (this.data.foodCatalog || []);
  },

  setFoodCatalog(catalog = []) {
    const list = Array.isArray(catalog) ? catalog : [];
    this._foodCatalog = list;
    this._foodCatalogById = new Map(list.map(food => [food._id, food]));
  },

  getFoodById(foodId) {
    if (!foodId) return null;
    if (this._foodCatalogById && this._foodCatalogById.has(foodId)) {
      return this._foodCatalogById.get(foodId);
    }
    return this.getFoodCatalog().find(food => food._id === foodId) || null;
  },

  findFoodForRecentIntake(intake = {}) {
    const byId = this.getFoodById(intake.foodId);
    if (byId) return byId;

    const snapshot = intake.foodSnapshot || {};
    const desiredScope = intake.libraryScope || snapshot.libraryScope ||
      ((intake.sourceType || snapshot.sourceType) === 'system' ? 'system' : '');
    const matchesDesiredScope = food => !desiredScope || this.getFoodLibraryScope(food) === desiredScope;
    const sourceSystemFoodId = snapshot.sourceSystemFoodId || intake.sourceSystemFoodId || '';
    const bySourceSystemId = this.getFoodById(sourceSystemFoodId);
    if (bySourceSystemId) return bySourceSystemId;

    const sourceFoodCode = snapshot.sourceFoodCode || intake.sourceFoodCode || '';
    if (sourceFoodCode) {
      const byCode = this.getFoodCatalog().find(food =>
        matchesDesiredScope(food) &&
        (food.sourceFoodCode === sourceFoodCode || food.origin?.foodCode === sourceFoodCode)
      );
      if (byCode) return byCode;
    }

    const snapshotName = snapshot.name || intake.foodName || intake.nameSnapshot || '';
    const snapshotCategory = snapshot.category || intake.category || '';
    if (snapshotName) {
      const byName = this.getFoodCatalog().find(food =>
        matchesDesiredScope(food) &&
        food.name === snapshotName &&
        (!snapshotCategory || food.category === snapshotCategory || food.categoryLevel1 === snapshotCategory)
      );
      if (byName || desiredScope) return byName || null;
      return this.getFoodCatalog().find(food =>
        food.name === snapshotName &&
        (!snapshotCategory || food.category === snapshotCategory || food.categoryLevel1 === snapshotCategory)
      ) || null;
    }

    return null;
  },

  async resolveCatalogImageUrls(catalog = this.getFoodCatalog()) {
    const cloudImageFoods = (catalog || []).filter(food =>
      (food?.image || '').toString().trim().startsWith('cloud://')
    );
    if (!cloudImageFoods.length) return;
    try {
      const resolvedFoods = await FoodModel.resolveFoodImageUrls(catalog || []);
      const resolvedCatalog = this.formatFoodCatalog(resolvedFoods || []);
      const foodCategories = this.buildFoodCategories(
        resolvedCatalog,
        this.data.activeLibraryScope,
        this.data.foodSearchQuery || ''
      );
      this.setFoodCatalog(resolvedCatalog);
      this.setData({
        foodCategories,
        activeCategory: this.getNextActiveFoodCategory(foodCategories, this.data.activeCategory)
      }, () => {
        this.restoreSelectedFoodCartFromIds();
        this.filterFoodOptions(this.data.foodSearchQuery || '');
      });
    } catch (error) {
      console.warn('解析食物图片失败:', error);
    }
  },

  getFoodSourceLabel(food = {}) {
    if (food.isSystem) return '系统';
    if (food.isSystemSnapshot || food.sourceType === 'user_override') return '系统修订';
    return '我的';
  },

  getFoodLibraryScope(food = {}) {
    return food.libraryScope || (food.isSystem ? 'system' : 'mine');
  },

  buildFoodCategories(
    catalog = this.getFoodCatalog(),
    scope = this.data.activeLibraryScope || 'mine',
    query = this.data.foodSearchQuery || ''
  ) {
    const normalized = normalizeSearchText(query);
    const scopedFoods = (catalog || []).filter(food => {
      if (this.getFoodLibraryScope(food) !== scope) return false;
      if (!normalized) return true;
      return this.matchesFoodSearch(food, normalized);
    });
    const categories = Array.from(
      new Set(scopedFoods.map(food => (food.category || '').toString().trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    if (normalized) {
      return categories.map(category => ({ value: category, label: category }));
    }

    return [
      { value: RECENT_CATEGORY, label: '最近' },
      ...categories.map(category => ({ value: category, label: category }))
    ];
  },

  getNextActiveFoodCategory(categories = [], preferredCategory = '') {
    if (!categories.length) return '';
    const matched = categories.find(item => item.value === preferredCategory);
    return matched ? matched.value : categories[0].value;
  },

  restoreSelectedFoodCartFromIds() {
    const ids = Array.isArray(this.pendingSelectedFoodIds) ? this.pendingSelectedFoodIds : [];
    if (!ids.length) return;
    const selectedFoodCart = ids.map(id => this.getFoodById(id)).filter(Boolean);
    this.setData({ selectedFoodCart }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  async loadRecentFoodOptions() {
    const babyUid = getBabyUid();
    if (!babyUid) {
      this.setData({
        recentFoodOptionsByScope: {
          mine: [],
          system: []
        }
      });
      return;
    }
    try {
      const recentRecords = await FoodIntakeRecordModel.findRecentFoodIntakes(babyUid, {
        days: RECENT_FOOD_DAYS,
        limit: RECENT_FOOD_FETCH_LIMIT,
        fetchLimit: RECENT_FOOD_FETCH_LIMIT
      });
      const recentByScope = {
        mine: [],
        system: []
      };
      const seenByScope = {
        mine: new Set(),
        system: new Set()
      };
      for (const intake of recentRecords || []) {
        if (!intake) continue;
        const food = this.findFoodForRecentIntake(intake);
        if (!food) continue;
        const scope = this.getFoodLibraryScope(food);
        if (!recentByScope[scope] || recentByScope[scope].length >= MAX_RECENT_FOODS) continue;
        if (seenByScope[scope].has(food._id)) continue;
        seenByScope[scope].add(food._id);
        recentByScope[scope].push(food);
        if (recentByScope.mine.length >= MAX_RECENT_FOODS && recentByScope.system.length >= MAX_RECENT_FOODS) {
          break;
        }
      }
      this.setData({ recentFoodOptionsByScope: recentByScope });
    } catch (error) {
      console.error('加载最近食物失败:', error);
      this.setData({
        recentFoodOptionsByScope: {
          mine: [],
          system: []
        }
      });
    }
  },

  getRecentFoodOptionsForScope(scope = this.data.activeLibraryScope || 'mine') {
    const recentByScope = this.data.recentFoodOptionsByScope || {};
    const scopedRecent = recentByScope[scope];
    if (Array.isArray(scopedRecent)) return scopedRecent;
    return [];
  },

  matchesFoodSearch(food = {}, normalizedQuery = '') {
    if (!normalizedQuery) return true;
    const searchText = [
      food.name || '',
      food.category || '',
      food.categoryLevel2 || '',
      food.aliasText || ''
    ].join(' ');
    return fuzzyIncludes(searchText, normalizedQuery);
  },

  filterFoodOptions(query = this.data.foodSearchQuery || '') {
    const normalized = normalizeSearchText(query);
    const activeCategory = this.data.activeCategory || '';
    const activeLibraryScope = this.data.activeLibraryScope || 'mine';
    let baseList = this.getFoodCatalog().filter(food =>
      this.getFoodLibraryScope(food) === activeLibraryScope
    );

    if (normalized) {
      baseList = baseList.filter(food => this.matchesFoodSearch(food, normalized));
      if (activeCategory && activeCategory !== RECENT_CATEGORY) {
        baseList = baseList.filter(food => (food.category || '').toString().trim() === activeCategory);
      }
    } else if (activeCategory === RECENT_CATEGORY) {
      const recentList = this.getRecentFoodOptionsForScope(activeLibraryScope);
      baseList = recentList;
    } else if (activeCategory) {
      baseList = baseList.filter(food => (food.category || '').toString().trim() === activeCategory);
    }

    const selectedIds = new Set([
      ...(this.data.selectedFoodCart || []).map(item => item._id),
      ...(this.data.pendingFoodIds || [])
    ]);

    this.filteredFoodOptions = baseList.map(food => ({
      ...food,
      selectedInCart: selectedIds.has(food._id)
    }));
    if (this.virtualScrollUpdateTimer) {
      clearTimeout(this.virtualScrollUpdateTimer);
      this.virtualScrollUpdateTimer = null;
    }
    this.rebuildFilteredFoodIndex();
    this.updateVisibleFoodOptions(0, {
      resetScroll: true,
      force: true
    });
  },

  rebuildFilteredFoodIndex() {
    this.filteredFoodOptionIndexById = new Map(
      (this.filteredFoodOptions || []).map((food, index) => [food._id, index])
    );
  },

  getVirtualWindowSize() {
    if (this.virtualWindowSize) return this.virtualWindowSize;
    const windowHeight = getCachedWindowInfo().windowHeight;
    const itemHeight = this.getFoodVirtualItemHeight();
    this.virtualWindowSize = Math.max(
      FOOD_VIRTUAL_MIN_WINDOW,
      Math.ceil(windowHeight / itemHeight) + FOOD_VIRTUAL_BUFFER * 2
    );
    return this.virtualWindowSize;
  },

  getFoodVirtualItemHeight() {
    if (this.foodVirtualItemHeight) return this.foodVirtualItemHeight;
    const windowWidth = getCachedWindowInfo().windowWidth;
    this.foodVirtualItemHeight = Math.max(1, Math.round(FOOD_VIRTUAL_ROW_HEIGHT_RPX * windowWidth / 750));
    return this.foodVirtualItemHeight;
  },

  buildVisibleFoodWindow(scrollTop = 0) {
    const list = this.filteredFoodOptions || [];
    const itemHeight = this.getFoodVirtualItemHeight();
    const firstVisibleIndex = Math.max(0, Math.floor(scrollTop / itemHeight));
    const start = Math.max(0, firstVisibleIndex - FOOD_VIRTUAL_BUFFER);
    const end = Math.min(list.length, start + this.getVirtualWindowSize());
    return {
      start,
      end,
      visibleFoodOptions: list.slice(start, end),
      virtualTopSpacerHeight: start * itemHeight,
      virtualBottomSpacerHeight: Math.max(0, (list.length - end) * itemHeight)
    };
  },

  updateVisibleFoodOptions(scrollTop = this.virtualScrollTop || 0, options = {}) {
    const normalizedScrollTop = Math.max(0, Number(scrollTop) || 0);
    const windowState = this.buildVisibleFoodWindow(normalizedScrollTop);
    if (
      !options.force &&
      windowState.start === this.visibleFoodStart &&
      windowState.end === this.visibleFoodEnd
    ) {
      return;
    }

    this.virtualScrollTop = normalizedScrollTop;
    this.visibleFoodStart = windowState.start;
    this.visibleFoodEnd = windowState.end;

    const nextData = {
      filteredFoodCount: (this.filteredFoodOptions || []).length,
      visibleFoodOptions: windowState.visibleFoodOptions,
      virtualTopSpacerHeight: windowState.virtualTopSpacerHeight,
      virtualBottomSpacerHeight: windowState.virtualBottomSpacerHeight
    };

    if (options.resetScroll) {
      nextData.foodListScrollTop = this.data.foodListScrollTop === 0 ? 1 : 0;
    }

    this.setData(nextData, () => {
      if (options.resetScroll) {
        this.setData({ foodListScrollTop: 0 });
      }
    });
  },

  onFoodListScroll(e) {
    const scrollTop = Number(e?.detail?.scrollTop) || 0;
    this.virtualScrollTop = scrollTop;
    const itemHeight = this.getFoodVirtualItemHeight();
    const nextStart = Math.max(
      0,
      Math.floor(scrollTop / itemHeight) - FOOD_VIRTUAL_BUFFER
    );
    if (nextStart === this.visibleFoodStart || this.virtualScrollUpdateTimer) return;
    this.virtualScrollUpdateTimer = setTimeout(() => {
      this.virtualScrollUpdateTimer = null;
      this.updateVisibleFoodOptions(this.virtualScrollTop || 0);
    }, 16);
  },

  switchLibraryScope(e) {
    const { scope } = e.currentTarget.dataset || {};
    if (!scope || scope === this.data.activeLibraryScope) return;
    this.rememberLibraryScope(scope);
    const foodCategories = this.buildFoodCategories(this.getFoodCatalog(), scope);
    this.setData({
      activeLibraryScope: scope,
      foodCategories,
      activeCategory: this.getNextActiveFoodCategory(foodCategories, ''),
      foodSearchQuery: ''
    }, () => {
      this.filterFoodOptions('');
    });
  },

  onCategoryTap(e) {
    const { category } = e.currentTarget.dataset || {};
    if (!category) return;
    this.setData({ activeCategory: category }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  onFoodSearchInput(e) {
    const query = e.detail.value || '';
    const foodCategories = this.buildFoodCategories(
      this.getFoodCatalog(),
      this.data.activeLibraryScope,
      query
    );
    this.setData({
      foodSearchQuery: query,
      foodCategories,
      activeCategory: this.getNextActiveFoodCategory(foodCategories, this.data.activeCategory)
    }, () => {
      this.filterFoodOptions(query);
    });
  },

  clearSearch() {
    const foodCategories = this.buildFoodCategories(
      this.getFoodCatalog(),
      this.data.activeLibraryScope,
      ''
    );
    this.setData({
      foodSearchQuery: '',
      foodCategories,
      activeCategory: this.getNextActiveFoodCategory(foodCategories, this.data.activeCategory)
    }, () => {
      this.filterFoodOptions('');
    });
  },

  onFoodOptionTap(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    const visibleIndex = this.findVisibleFoodIndex(id);
    const food = visibleIndex >= 0
      ? this.data.visibleFoodOptions[visibleIndex]
      : this.findFilteredFoodOption(id) || this.getFoodById(id);
    if (!food) return;
    this.addFoodToSelectionCart(food, e);
  },

  findFilteredFoodOption(foodId) {
    const index = this.filteredFoodOptionIndexById?.get(foodId);
    return typeof index === 'number' ? (this.filteredFoodOptions || [])[index] : null;
  },

  findVisibleFoodIndex(foodId) {
    return (this.data.visibleFoodOptions || []).findIndex(item => item._id === foodId);
  },

  setVisibleFoodSelectedState(foodId, selected) {
    const update = this.getVisibleFoodSelectedStateUpdate(foodId, selected);
    if (!Object.keys(update).length) return;
    this.setData(update);
  },

  getVisibleFoodSelectedStateUpdate(foodId, selected) {
    const filteredIndex = this.filteredFoodOptionIndexById?.get(foodId);
    if (typeof filteredIndex === 'number' && this.filteredFoodOptions?.[filteredIndex]) {
      this.filteredFoodOptions[filteredIndex] = {
        ...this.filteredFoodOptions[filteredIndex],
        selectedInCart: selected
      };
    }
    const index = this.findVisibleFoodIndex(foodId);
    return index >= 0 ? {
      [`visibleFoodOptions[${index}].selectedInCart`]: selected
    } : {};
  },

  addFoodToSelectionCart(food, e) {
    if (!food?._id) return;
    const exists = (this.data.selectedFoodCart || []).some(item => item._id === food._id);
    if (exists) {
      wx.showToast({ title: '已在待添加列表', icon: 'none' });
      return;
    }

    this.setData({
      selectedFoodCart: [...(this.data.selectedFoodCart || []), food],
      ...this.getVisibleFoodSelectedStateUpdate(food._id, true)
    });
    this.playAddToCartAnimation(e);
  },

  clearSelectionCart() {
    const selectedIds = new Set([
      ...(this.data.selectedFoodCart || []).map(item => item._id),
      ...(this.data.pendingFoodIds || [])
    ]);
    if (!selectedIds.size) return;

    this.pendingCartFoodIds = new Set();
    this.quantityDraftValues = {};
    this.quantityDraftValuesByFoodId = new Map();
    this.cartFlyerToken = (this.cartFlyerToken || 0) + 1;

    if (this.filteredFoodOptions?.length) {
      this.filteredFoodOptions = this.filteredFoodOptions.map(food => (
        selectedIds.has(food._id) ? { ...food, selectedInCart: false } : food
      ));
    }

    this.setData({
      selectedFoodCart: [],
      pendingFoodIds: [],
      cartExpanded: false,
      visibleFoodOptions: (this.data.visibleFoodOptions || []).map(food => (
        selectedIds.has(food._id) ? { ...food, selectedInCart: false } : food
      )),
      cartFlyer: {
        visible: false,
        outerStyle: '',
        innerStyle: ''
      }
    });
  },

  removeFoodFromSelectionCart(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    this.persistQuantityDraftValues();
    this.quantityDraftValuesByFoodId?.delete(id);
    const nextCart = (this.data.selectedFoodCart || []).filter(item => item._id !== id);
    this.setData({
      selectedFoodCart: nextCart,
      cartExpanded: nextCart.length > 0 ? this.data.cartExpanded : false,
      ...this.getVisibleFoodSelectedStateUpdate(id, false)
    });
  },

  toggleCartExpanded() {
    if ((this.data.selectedFoodCart || []).length === 0) return;
    this.setData({ cartExpanded: !this.data.cartExpanded });
  },

  collapseCart() {
    if (!this.data.cartExpanded) return;
    this.setData({ cartExpanded: false });
  },

  getQuantityDraftValue(draft = {}, index) {
    if (Object.prototype.hasOwnProperty.call(this.quantityDraftValues || {}, index)) {
      return this.quantityDraftValues[index] || '';
    }
    return draft.quantity || draft.initialQuantity || '';
  },

  persistQuantityDraftValues() {
    const nextValues = new Map(this.quantityDraftValuesByFoodId || []);
    (this.data.quantityDrafts || []).forEach((draft = {}, index) => {
      if (!draft.foodId) return;
      const value = this.getQuantityDraftValue(draft, index);
      if (value !== undefined && value !== null && value !== '') {
        nextValues.set(draft.foodId, String(value));
      } else {
        nextValues.delete(draft.foodId);
      }
    });
    this.quantityDraftValuesByFoodId = nextValues;
  },

  openQuantityDrawer() {
    if (this.pickerSource === 'recipe-management' || this.data.isRecipeIngredientPicker) {
      // 食谱原料份量在食谱页填写
      this.confirmSelection();
      return;
    }
    const selectedFoods = this.data.selectedFoodCart || [];
    if (!selectedFoods.length) {
      wx.showToast({ title: '请先选择食物', icon: 'none' });
      return;
    }
    this.persistQuantityDraftValues();
    this.quantityDraftValues = {};
    const initialQuantities = this.pendingSelectedFoodQuantities || new Map();
    const preservedQuantities = this.quantityDraftValuesByFoodId || new Map();
    this.setData({
      quantityDrawerVisible: true,
      cartExpanded: false,
      quantityDraftScrollIntoView: '',
      quantityDraftInvalidIndex: -1,
      quantityDrafts: selectedFoods.map((food, index) => {
        const initialQuantity = preservedQuantities.get(food._id) ?? initialQuantities.get(food._id);
        const quantity = parseFloat(initialQuantity || '');
        const quantityText = !isNaN(quantity) && quantity > 0 ? String(initialQuantity) : '';
        if (!isNaN(quantity) && quantity > 0) {
          this.quantityDraftValues[index] = quantityText;
        }
        return {
          foodId: food._id,
          name: food.name,
          sourceLabel: food.sourceLabel,
          quantity: quantityText,
          initialQuantity: !isNaN(quantity) && quantity > 0 ? quantity : '',
          placeholder: !isNaN(quantity) && quantity > 0 ? `当前 ${quantity}` : '请输入',
          unit: food.baseUnit || 'g',
          nutritionPreview: !isNaN(quantity) && quantity > 0
            ? FoodModel.calculateNutrition(food, quantity)
            : null
        };
      })
    }, () => {
      this.refreshQuantityTargetPreview();
    });
  },

  closeQuantityDrawer() {
    if (this.quantityTargetPreviewTimer) {
      clearTimeout(this.quantityTargetPreviewTimer);
      this.quantityTargetPreviewTimer = null;
    }
    this.persistQuantityDraftValues();
    this.setData({
      quantityDrawerVisible: false,
      quantityDraftScrollIntoView: '',
      quantityDraftInvalidIndex: -1,
      quantityTargetPreview: null
    });
  },

  onQuantityDraftInput(e) {
    const { index } = e.currentTarget.dataset || {};
    const draftIndex = Number(index);
    if (!Number.isInteger(draftIndex) || draftIndex < 0) return;
    this.quantityDraftValues = this.quantityDraftValues || {};
    this.quantityDraftValues[draftIndex] = e.detail.value || '';
    this.setData({
      [`quantityDrafts[${draftIndex}].quantity`]: e.detail.value || ''
    }, () => {
      this.persistQuantityDraftValues();
      this.refreshQuantityPreview(draftIndex);
    });
  },

  scrollToQuantityDraft(index) {
    const draftIndex = Number(index);
    if (!Number.isInteger(draftIndex) || draftIndex < 0) return;
    const targetId = `quantityDraftItem${draftIndex}`;
    this.setData({
      quantityDraftScrollIntoView: '',
      quantityDraftInvalidIndex: draftIndex
    }, () => {
      this.setData({ quantityDraftScrollIntoView: targetId });
    });
  },

  findSelectedCartFood(foodId) {
    if (!foodId) return null;
    return (this.data.selectedFoodCart || []).find(food => food._id === foodId)
      || this.getFoodById(foodId)
      || null;
  },

  refreshQuantityPreview(targetIndex) {
    const drafts = this.data.quantityDrafts || [];
    const updates = {};
    const shouldUpdateAll = !Number.isInteger(targetIndex) || targetIndex < 0;
    const startIndex = shouldUpdateAll ? 0 : targetIndex;
    const endIndex = shouldUpdateAll ? drafts.length : targetIndex + 1;
    for (let index = startIndex; index < endIndex; index += 1) {
      const draft = drafts[index];
      if (!draft) continue;
      const quantity = parseFloat(this.getQuantityDraftValue(draft, index));
      const food = this.findSelectedCartFood(draft.foodId);
      updates[`quantityDrafts[${index}].nutritionPreview`] = !food || isNaN(quantity) || quantity <= 0
        ? null
        : FoodModel.calculateNutrition(food, quantity);
      if (index === this.data.quantityDraftInvalidIndex && !isNaN(quantity) && quantity > 0) {
        updates.quantityDraftInvalidIndex = -1;
        updates.quantityDraftScrollIntoView = '';
      }
    }
    if (this.data.quantityTargetContext) {
      const context = this.data.quantityTargetContext;
      const draftSummary = addSummaries(
        context.baseMealSummary || {},
        this.buildQuantityDraftSummary()
      );
      updates.quantityTargetPreview = buildEntryTargetPreview({
        currentSummary: context.currentSummary || {},
        draftSummary,
        previousSummary: context.previousSummary || {},
        weight: context.weight,
        targetPreferences: context.targetPreferences || {},
        includeCalories: true
      });
    }
    this.setData(updates);
  },

  buildQuantityDraftSummary() {
    const drafts = this.data.quantityDrafts || [];
    const items = [];
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      const quantity = parseFloat(this.getQuantityDraftValue(draft, index));
      if (isNaN(quantity) || quantity <= 0) continue;

      const food = this.findSelectedCartFood(draft.foodId);
      if (!food) continue;
      const nutrition = FoodModel.calculateNutrition(food, quantity);
      const protein = Number(nutrition.protein) || 0;
      const proteinSource = food.proteinSource || 'natural';
      let naturalProtein = protein;
      let specialProtein = 0;

      if (proteinSource === 'special') {
        naturalProtein = 0;
        specialProtein = protein;
      } else if (proteinSource === 'mixed' && food.proteinSplit) {
        const naturalRatio = Number(food.proteinSplit.natural) || 0;
        const specialRatio = Number(food.proteinSplit.special) || 0;
        const total = naturalRatio + specialRatio || 1;
        naturalProtein = protein * (naturalRatio / total);
        specialProtein = protein * (specialRatio / total);
      }

      items.push({
        nutrition,
        proteinSource,
        naturalProtein,
        specialProtein
      });
    }
    return summarizeFoodItems(items);
  },

  refreshQuantityTargetPreview() {
    const context = this.data.quantityTargetContext;
    if (!context) {
      this.setData({ quantityTargetPreview: null });
      return;
    }
    const draftSummary = addSummaries(
      context.baseMealSummary || {},
      this.buildQuantityDraftSummary()
    );
    const quantityTargetPreview = buildEntryTargetPreview({
      currentSummary: context.currentSummary || {},
      draftSummary,
      previousSummary: context.previousSummary || {},
      weight: context.weight,
      targetPreferences: context.targetPreferences || {},
      includeCalories: true
    });
    this.setData({ quantityTargetPreview });
  },

  async refreshQuantityTargetPreferences() {
    const context = this.data.quantityTargetContext;
    if (!context) return;
    const babyUid = getBabyUid();
    if (!babyUid) {
      this.refreshQuantityTargetPreview();
      return;
    }

    try {
      const targetPreferences = await getNutritionTargetPreferences(babyUid);
      if (!hasTargetCoefficient(targetPreferences)) {
        this.refreshQuantityTargetPreview();
        return;
      }
      this.setData({
        'quantityTargetContext.targetPreferences': targetPreferences
      }, () => {
        this.refreshQuantityTargetPreview();
      });
    } catch (error) {
      console.warn('刷新食物选择目标系数失败:', error);
      this.refreshQuantityTargetPreview();
    }
  },

  async handleNutritionTargetsSaved() {
    await this.refreshQuantityTargetPreferences();
  },

  submitQuantityDrafts() {
    const drafts = this.data.quantityDrafts || [];
    if (!drafts.length) {
      wx.showToast({ title: '请先选择食物', icon: 'none' });
      return;
    }
    const items = [];
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      const quantity = parseFloat(this.getQuantityDraftValue(draft, index));
      if (isNaN(quantity) || quantity <= 0) {
        this.scrollToQuantityDraft(index);
        wx.showToast({ title: `请填写${draft.name || '食物'}的有效份量`, icon: 'none' });
        return;
      }
      items.push({
        foodId: draft.foodId,
        quantity
      });
    }
    writeFoodSelectionItems(items);
    wx.navigateBack();
  },

  playAddToCartAnimation(e, onDone) {
    const touch = e?.touches?.[0] || e?.changedTouches?.[0] || {};
    const startX = Number(touch.clientX);
    const startY = Number(touch.clientY);
    if (!Number.isFinite(startX) || !Number.isFinite(startY)) {
      setTimeout(() => {
        if (typeof onDone === 'function') onDone();
        this.triggerCartBump();
      }, 180);
      return;
    }

    const runAnimation = rect => {
      const fallbackWindowHeight = getCachedWindowInfo().windowHeight;
      const targetX = rect ? rect.left + rect.width / 2 : 56;
      const targetY = rect ? rect.top + rect.height / 2 : fallbackWindowHeight - 48;
      const deltaX = Math.round(targetX - startX);
      const deltaY = Math.round(targetY - startY);
      const arcHeight = Math.max(
        36,
        Math.min(80, Math.round(Math.abs(deltaX) * 0.08 + Math.max(0, deltaY) * 0.035))
      );
      const startLeft = Math.round(startX - 12);
      const startTop = Math.round(startY - 12);
      const token = (this.cartFlyerToken || 0) + 1;
      this.cartFlyerToken = token;

      if (this.cartFlyerStartTimer) {
        clearTimeout(this.cartFlyerStartTimer);
        this.cartFlyerStartTimer = null;
      }
      if (this.cartFlyerFinishTimer) {
        clearTimeout(this.cartFlyerFinishTimer);
        this.cartFlyerFinishTimer = null;
      }

      const showFlyer = () => {
        if (this.cartFlyerToken !== token) return;
        this.setData({
          cartFlyer: {
            visible: true,
            outerStyle: [
              `left: ${startLeft}px`,
              `top: ${startTop}px`,
              `--fly-x: ${deltaX}px`,
              `animation: cartFlyerX ${FOOD_CART_FLY_DURATION}ms linear both`
            ].join('; '),
            innerStyle: [
              `--fly-y: ${deltaY}px`,
              `--fly-peak-y: ${-arcHeight}px`,
              `animation: cartFlyerGravity ${FOOD_CART_FLY_DURATION}ms both`
            ].join('; ')
          }
        });
      };

      const restartDelay = this.data.cartFlyer?.visible ? FOOD_CART_FLY_START_DELAY : 0;
      if (restartDelay > 0) {
        this.setData({
          cartFlyer: {
            visible: false,
            outerStyle: '',
            innerStyle: ''
          }
        });
        this.cartFlyerStartTimer = setTimeout(showFlyer, restartDelay);
      } else {
        showFlyer();
      }

      this.cartFlyerFinishTimer = setTimeout(() => {
        if (this.cartFlyerToken === token) {
          this.setData({
            cartFlyer: {
              visible: false,
              outerStyle: '',
              innerStyle: ''
            }
          });
        }
        if (typeof onDone === 'function') onDone();
        this.triggerCartBump();
      }, FOOD_CART_FLY_DURATION + restartDelay + 40);
    };

    if (typeof wx.createSelectorQuery !== 'function') {
      runAnimation(null);
      return;
    }

    wx.createSelectorQuery()
      .select('#cartIcon')
      .boundingClientRect(rect => {
        runAnimation(rect);
      })
      .exec();
  },

  triggerCartBump() {
    this.setData({ cartBumping: true });
    setTimeout(() => {
      this.setData({ cartBumping: false });
    }, 260);
  },

  previewFoodOptionImage(e) {
    const { url } = e.currentTarget.dataset || {};
    const current = (url || '').toString().trim();
    if (!current) return;
    wx.previewImage({
      current,
      urls: [current]
    });
  },

  navigateToFoodManagement() {
    wx.navigateTo({
      url: '/pkg-milk/food-management/index?openAdd=1&from=food-picker'
    });
  },

  confirmSelection() {
    const selectedFoods = this.data.selectedFoodCart || [];
    if (!selectedFoods.length) {
      wx.showToast({ title: '请先选择食物', icon: 'none' });
      return;
    }
    // 食谱原料：只回传所选食物，份量在食谱新增/编辑页填写，不打开本顿份量抽屉
    if (this.pickerSource === 'recipe-management' || this.data.isRecipeIngredientPicker) {
      writeFoodSelectionIds(
        selectedFoods.map(food => food._id),
        RECIPE_INGREDIENT_PICKER_SELECTION_KEY
      );
      wx.navigateBack();
      return;
    }
    this.openQuantityDrawer();
  }
});
