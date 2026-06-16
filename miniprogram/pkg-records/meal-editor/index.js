const FoodModel = require('../../models/food');
const FoodIntakeRecordModel = require('../../models/foodIntakeRecord');
const DailySummaryV2Model = require('../../models/dailySummaryV2');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { getBabyUid } = require('../../utils/index');
const {
  getNutritionTargetPreferences,
  pickCoefficient
} = require('../../utils/nutritionTargetPreferences');
const {
  buildEntryTargetPreview,
  summarizeFoodItems,
  normalizeSummary,
  addSummaries,
  subtractSummaries
} = require('../../utils/nutritionTargetPreview');

const app = getApp();
const MEAL_LABELS = ['早餐', '午餐', '晚餐', '加餐'];
const FOOD_PLACEHOLDER_IMAGE = '/images/LemonLogo.png';
const FOOD_PICKER_SELECTION_KEY = 'meal_food_picker_selection';
const FOOD_PICKER_TARGET_CONTEXT_KEY = 'meal_food_picker_target_context';

function canLoadDailyTargetContext() {
  try {
    const wxApi = typeof wx !== 'undefined' ? wx : null;
    const command = wxApi?.cloud?.database?.().command;
    return !!(command && typeof command.gte === 'function' && typeof command.lte === 'function');
  } catch (error) {
    return false;
  }
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(dateKey) {
  const [year, month, day] = (dateKey || '').split('-');
  if (!year || !month || !day) return '';
  return `${year}年${month}月${day}日`;
}

function formatTime(date = new Date()) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function roundNumber(value, precision = 2) {
  if (isNaN(value)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round(num);
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

function writeFoodSelectionIds(foodIds = []) {
  wx.setStorageSync(FOOD_PICKER_SELECTION_KEY, {
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

function writeFoodPickerTargetContext(context = {}) {
  wx.setStorageSync(FOOD_PICKER_TARGET_CONTEXT_KEY, {
    schemaVersion: 1,
    currentSummary: normalizeSummary(context.currentSummary || {}),
    previousSummary: normalizeSummary(context.previousSummary || {}),
    baseMealSummary: normalizeSummary(context.baseMealSummary || {}),
    weight: context.weight || '',
    targetPreferences: context.targetPreferences || {}
  });
}

function hasBasicInfoValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function mergeMissingBasicInfo(primary = {}, fallback = {}) {
  const merged = { ...(primary || {}) };
  ['weight', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient'].forEach(key => {
    if (!hasBasicInfoValue(merged[key]) && hasBasicInfoValue(fallback[key])) {
      merged[key] = fallback[key];
    }
  });
  return merged;
}

function readCachedBabyBasicInfo(babyUid = '') {
  try {
    const app = getApp();
    const cached = app?.globalData?.babyInfo || wx.getStorageSync('baby_info') || {};
    if (!cached || typeof cached !== 'object') return {};
    if (cached.babyUid && babyUid && cached.babyUid !== babyUid) return {};
    const targetPreferences = cached.nutritionTargetPreferences || {};
    return {
      weight: cached.weight || '',
      naturalProteinCoefficient: cached.naturalProteinCoefficient || targetPreferences.naturalProteinCoefficient || '',
      specialProteinCoefficient: cached.specialProteinCoefficient || targetPreferences.specialProteinCoefficient || '',
      calorieCoefficient: cached.calorieCoefficient || targetPreferences.calorieCoefficient || ''
    };
  } catch (error) {
    return {};
  }
}

function getDateTimestamp(value) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ts = date.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function getBasicInfoCompleteness(record = {}) {
  const basicInfo = record.basicInfo || {};
  let count = 0;
  ['weight', 'height', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient'].forEach(key => {
    const value = basicInfo[key];
    if (value !== '' && value !== null && value !== undefined) {
      count += 1;
    }
  });
  return count;
}

function scoreFeedingRecord(record = {}) {
  const feedingsCount = Array.isArray(record.feedings) ? record.feedings.length : 0;
  const intakesCount = Array.isArray(record.intakes) ? record.intakes.length : 0;
  const basicInfoCompleteness = getBasicInfoCompleteness(record);
  const updatedAtTs = getDateTimestamp(record.updatedAt);
  const createdAtTs = getDateTimestamp(record.createdAt);
  const dateTs = getDateTimestamp(record.date);

  return (
    feedingsCount * 1000000 +
    intakesCount * 1000000 +
    basicInfoCompleteness * 10 +
    Math.max(updatedAtTs, createdAtTs, dateTs) / 1000000000000
  );
}

function pickPrimaryFeedingRecord(records = []) {
  if (!Array.isArray(records) || records.length === 0) return null;
  return [...records].sort((a, b) => {
    const scoreDiff = scoreFeedingRecord(b) - scoreFeedingRecord(a);
    if (scoreDiff !== 0) return scoreDiff;
    return getDateTimestamp(b?.updatedAt) - getDateTimestamp(a?.updatedAt);
  })[0];
}

function mergeBasicInfoFromRecords(records = []) {
  if (!Array.isArray(records) || records.length === 0) return {};
  return [...records]
    .sort((a, b) => getDateTimestamp(b?.updatedAt) - getDateTimestamp(a?.updatedAt))
    .reduce((merged, record) => {
      const basicInfo = record?.basicInfo || {};
      Object.keys(basicInfo).forEach(key => {
        const value = basicInfo[key];
        if (value !== '' && value !== null && value !== undefined && merged[key] === undefined) {
          merged[key] = value;
        }
      });
      return merged;
    }, {});
}

function dedupeIntakes(intakes = []) {
  const seen = new Set();
  return (intakes || []).filter(item => {
    if (!item) return false;
    const key = item._id || `${item.foodId || item.nameSnapshot || ''}_${item.recordedAt || ''}_${item.quantity || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeFeedingRecords(records = []) {
  const primary = pickPrimaryFeedingRecord(records);
  if (!primary) return null;

  return {
    ...primary,
    basicInfo: mergeBasicInfoFromRecords(records),
    feedings: records.flatMap(record => Array.isArray(record?.feedings) ? record.feedings : []),
    intakes: dedupeIntakes(records.flatMap(record => Array.isArray(record?.intakes) ? record.intakes : []))
  };
}

function getDefaultMealLabel(timeValue = formatTime(new Date())) {
  const hour = Number((timeValue || '00:00').split(':')[0]);
  if (hour < 10) return '早餐';
  if (hour < 15) return '午餐';
  if (hour < 20) return '晚餐';
  return '加餐';
}

function isFutureDateKey(dateKey) {
  const target = dateKey || '';
  const today = formatDateKey(new Date());
  return !!target && target > today;
}

function createEmptyMealSummary() {
  return {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sodium: 0
  };
}

function calculateMealSummary(items = []) {
  const summary = (items || []).reduce((acc, item) => {
    const nutrition = item?.nutrition || {};
    acc.calories += Number(nutrition.calories) || 0;
    acc.protein += Number(nutrition.protein) || 0;
    acc.carbs += Number(nutrition.carbs) || 0;
    acc.fat += Number(nutrition.fat) || 0;
    acc.fiber += Number(nutrition.fiber) || 0;
    acc.sodium += Number(nutrition.sodium) || 0;
    return acc;
  }, createEmptyMealSummary());

  return {
    calories: roundCalories(summary.calories),
    protein: roundNumber(summary.protein, 2),
    carbs: roundNumber(summary.carbs, 2),
    fat: roundNumber(summary.fat, 2),
    fiber: roundNumber(summary.fiber, 2),
    sodium: roundNumber(summary.sodium, 2)
  };
}

Page({
  data: {
    mode: 'create',
    selectedDate: '',
    formattedSelectedDate: '',
    sourcePage: '',
    editMealBatchId: '',
    editRecordId: '',
    mealLabels: MEAL_LABELS,
    mealDraft: {
      mealTime: '',
      mealLabel: '',
      mealNote: '',
      items: []
    },
    mealSummary: createEmptyMealSummary(),
    mealTargetPreview: null,
    draftTargetPreview: null,
    batchTargetPreview: null,
    originalMealSummary: normalizeSummary(),
    targetContext: {
      currentSummary: normalizeSummary(),
      targetPreferences: {},
      weight: ''
    },
    targetContextLoaded: false,
    foodCatalog: [],
    drawerVisible: false,
    drawerStep: 'batch',
    batchFoodDrafts: [],
    currentFoodDraft: {
      foodId: '',
      food: null,
      quantity: '',
      unit: 'g',
      nutritionPreview: null
    },
    editingItemId: '',
    isSaving: false
  },

  async onLoad(options = {}) {
    const selectedDate = options.date || formatDateKey(new Date());
    const mealTime = formatTime(new Date());
    const editMealBatchId = options.mealBatchId ? decodeURIComponent(options.mealBatchId) : '';
    this.setData({
      mode: editMealBatchId ? 'edit' : 'create',
      selectedDate,
      formattedSelectedDate: formatDisplayDate(selectedDate),
      sourcePage: options.from || '',
      editMealBatchId,
      mealDraft: {
        mealTime,
        mealLabel: getDefaultMealLabel(mealTime),
        mealNote: '',
        items: []
      },
      mealSummary: createEmptyMealSummary()
    });
    const targetContextPromise = this.ensureTargetContextLoaded();
    await Promise.all([
      this.loadFoodCatalog(),
      targetContextPromise
    ]);
    if (editMealBatchId) {
      await this.loadExistingMeal(editMealBatchId);
    } else {
      this.refreshTargetPreviews();
    }
    this.hasLoadedCatalog = true;
  },

  async onShow() {
    if (!this.hasLoadedCatalog) {
      return;
    }
    const hasFoodPickerSelection = this.handleFoodPickerSelection();
    await this.reloadTargetContextAndPreviews();
    if (hasFoodPickerSelection) {
      return;
    }
    await this.loadFoodCatalog();
  },

  async loadTargetContext() {
    const babyUid = getBabyUid();
    if (!babyUid) return;
    let daily = null;
    if (canLoadDailyTargetContext()) {
      try {
        daily = await DailyRecordV2Service.getDailyRecordV2(babyUid, this.data.selectedDate);
      } catch (error) {
        console.warn('加载食物目标提醒每日汇总失败，将使用本地目标兜底:', error);
      }
    }
    const basicInfo = mergeMissingBasicInfo(
      daily?.basicInfo || daily?.summary?.basicInfo || {},
      readCachedBabyBasicInfo(babyUid)
    );
    let localTarget = {};
    try {
      localTarget = await getNutritionTargetPreferences(babyUid);
    } catch (error) {
      console.warn('加载本地目标系数失败:', error);
    }
    this.setData({
      targetContext: {
        currentSummary: normalizeSummary(daily?.summary?.macroSummary || daily?.overview?.macroSummary || {}),
        weight: basicInfo.weight || '',
        targetPreferences: {
          naturalProteinCoefficient: pickCoefficient(localTarget.naturalProteinCoefficient, basicInfo.naturalProteinCoefficient),
          specialProteinCoefficient: pickCoefficient(localTarget.specialProteinCoefficient, basicInfo.specialProteinCoefficient),
          calorieCoefficient: pickCoefficient(localTarget.calorieCoefficient, basicInfo.calorieCoefficient)
        }
      },
      targetContextLoaded: true
    });
  },

  ensureTargetContextLoaded() {
    if (this.data.targetContextLoaded) {
      return Promise.resolve();
    }
    if (!this.targetContextLoadPromise) {
      this.targetContextLoadPromise = this.loadTargetContext()
        .finally(() => {
          this.targetContextLoadPromise = null;
        });
    }
    return this.targetContextLoadPromise;
  },

  async reloadTargetContextAndPreviews() {
    await this.loadTargetContext();
    this.refreshTargetPreviews();
  },

  async handleNutritionTargetsSaved() {
    await this.reloadTargetContextAndPreviews();
  },

  refreshTargetPreviews() {
    this.refreshMealTargetPreview();
    this.refreshDraftTargetPreview();
    if ((this.data.batchFoodDrafts || []).length > 0) {
      this.refreshBatchTargetPreview();
    }
  },

  refreshMealTargetPreview() {
    const targetContext = this.data.targetContext || {};
    const mealSummary = summarizeFoodItems(this.data.mealDraft.items || []);
    const mealTargetPreview = buildEntryTargetPreview({
      currentSummary: targetContext.currentSummary || {},
      draftSummary: mealSummary,
      previousSummary: this.data.mode === 'edit' ? this.data.originalMealSummary : {},
      weight: targetContext.weight,
      targetPreferences: targetContext.targetPreferences || {},
      includeCalories: true
    });
    this.setData({ mealTargetPreview });
  },

  buildCurrentMealBaseSummaryForDraft() {
    const targetContext = this.data.targetContext || {};
    const currentWithoutOriginalMeal = this.data.mode === 'edit'
      ? subtractSummaries(targetContext.currentSummary || {}, this.data.originalMealSummary || {})
      : normalizeSummary(targetContext.currentSummary || {});
    return addSummaries(currentWithoutOriginalMeal, summarizeFoodItems(this.data.mealDraft.items || []));
  },

  refreshDraftTargetPreview() {
    const pendingItem = this.buildMealItemFromDraft(false);
    if (!pendingItem) {
      this.setData({ draftTargetPreview: null });
      return;
    }

    const previousItem = this.data.editingItemId
      ? (this.data.mealDraft.items || []).find(item => item.localId === this.data.editingItemId)
      : null;
    const targetContext = this.data.targetContext || {};
    const draftTargetPreview = buildEntryTargetPreview({
      currentSummary: this.buildCurrentMealBaseSummaryForDraft(),
      draftSummary: summarizeFoodItems([pendingItem]),
      previousSummary: previousItem ? summarizeFoodItems([previousItem]) : {},
      weight: targetContext.weight,
      targetPreferences: targetContext.targetPreferences || {},
      includeCalories: true
    });
    this.setData({ draftTargetPreview });
  },

  async loadFoodCatalog() {
    const babyUid = getBabyUid();
    try {
      const foods = await FoodModel.getAvailableFoods(babyUid, {
        preferLocalSystemIndex: true
      });
      const foodsWithImageUrls = await FoodModel.resolveFoodImageUrls(foods || []);
      const catalog = [...(foodsWithImageUrls || [])]
        .map(food => ({
          ...food,
          displayImage: food.imageUrl || food.image || FOOD_PLACEHOLDER_IMAGE,
          sourceLabel: this.getFoodSourceLabel(food)
        }))
        .sort((a, b) => {
        const categoryA = (a.category || '').toString();
        const categoryB = (b.category || '').toString();
        if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);
        return (a.name || '').localeCompare(b.name || '');
        });
      this.setData({
        foodCatalog: catalog
      });
    } catch (error) {
      console.error('加载食物库失败:', error);
      this.setData({
        foodCatalog: []
      });
    }
  },

  getFoodSourceLabel(food = {}) {
    if (food.isSystem) return '系统';
    if (food.isSystemSnapshot || food.sourceType === 'user_override') return '系统修订';
    return '我的';
  },

  getFoodLibraryScope(food = {}) {
    if (food.libraryScope) return food.libraryScope;
    if (food.foodSnapshot?.libraryScope) return food.foodSnapshot.libraryScope;
    return food.isSystem || food.sourceType === 'system' ? 'system' : 'mine';
  },

  onMealTimeChange(e) {
    const mealTime = e.detail.value;
    this.setData({
      'mealDraft.mealTime': mealTime,
      'mealDraft.mealLabel': this.data.mealDraft.mealLabel || getDefaultMealLabel(mealTime)
    });
  },

  onMealLabelTap(e) {
    const { label } = e.currentTarget.dataset;
    if (!label) return;
    this.setData({ 'mealDraft.mealLabel': label });
  },

  onMealNoteInput(e) {
    this.setData({ 'mealDraft.mealNote': e.detail.value || '' });
  },

  resetCurrentFoodDraft() {
    this.setData({
      currentFoodDraft: {
        foodId: '',
        food: null,
        quantity: '',
        unit: 'g',
        nutritionPreview: null
      },
      editingItemId: '',
      drawerStep: 'batch',
      batchFoodDrafts: [],
      draftTargetPreview: null,
      batchTargetPreview: null
    });
  },

  async openFoodDrawer() {
    await this.ensureTargetContextLoaded();
    const currentItems = (this.data.mealDraft.items || [])
      .map(item => ({
        foodId: item.foodId,
        quantity: item.quantity
      }))
      .filter(item => item.foodId && item.quantity);
    if (currentItems.length) {
      writeFoodSelectionItems(currentItems);
    } else {
      wx.removeStorageSync(FOOD_PICKER_SELECTION_KEY);
    }
    const targetContext = this.data.targetContext || {};
    writeFoodPickerTargetContext({
      currentSummary: targetContext.currentSummary || {},
      previousSummary: this.data.mode === 'edit' ? this.data.originalMealSummary : {},
      baseMealSummary: summarizeFoodItems(this.data.mealDraft.items || []),
      weight: targetContext.weight,
      targetPreferences: targetContext.targetPreferences || {}
    });
    wx.navigateTo({
      url: '/pkg-records/food-picker/index'
    });
  },

  navigateToFoodManagement() {
    wx.navigateTo({
      url: '/pkg-milk/food-management/index?openAdd=1&from=meal-editor'
    });
  },

  closeFoodDrawer() {
    this.setData({
      drawerVisible: false
    });
    this.resetCurrentFoodDraft();
  },

  openBatchFoodDrawer(selectedFoods = []) {
    if (!selectedFoods.length) {
      return;
    }

    this.setData({
      drawerVisible: true,
      drawerStep: 'batch',
      batchFoodDrafts: selectedFoods.map(food => ({
        foodId: food._id,
        food,
        quantity: '',
        unit: food.baseUnit || 'g',
        nutritionPreview: null
      })),
      draftTargetPreview: null,
      batchTargetPreview: null
    }, () => {
      this.refreshBatchTargetPreview();
    });
  },

  handleFoodPickerSelection() {
    const selection = wx.getStorageSync(FOOD_PICKER_SELECTION_KEY);
    const selectedItems = readFoodSelectionItems(selection);
    const selectedFoodIds = readFoodSelectionIds(selection);
    if (!selectedFoodIds.length) return false;
    wx.removeStorageSync(FOOD_PICKER_SELECTION_KEY);
    const catalogMap = new Map((this.data.foodCatalog || []).map(food => [food._id, food]));
    const selectedFoods = selectedFoodIds.map(id => catalogMap.get(id)).filter(Boolean);
    if (!selectedFoods.length) {
      wx.showToast({ title: '未找到所选食物，请重新选择', icon: 'none' });
      return false;
    }
    if (selectedItems.length) {
      const selectedFoodMap = new Map(selectedFoods.map(food => [food._id, food]));
      this.addSelectedFoodItemsToMeal(
        selectedItems
          .map(item => ({
            food: selectedFoodMap.get(item.foodId),
            quantity: item.quantity
          }))
          .filter(item => item.food)
      );
      return true;
    }
    this.openBatchFoodDrawer(selectedFoods);
    return true;
  },

  async backToFoodPicker() {
    const currentFoods = (this.data.batchFoodDrafts || [])
      .map(draft => draft.food)
      .filter(Boolean);
    if (currentFoods.length) {
      writeFoodSelectionIds(currentFoods.map(food => food._id));
    }
    this.setData({
      drawerVisible: false,
      batchFoodDrafts: []
    }, async () => {
      await this.ensureTargetContextLoaded();
      const targetContext = this.data.targetContext || {};
      writeFoodPickerTargetContext({
        currentSummary: targetContext.currentSummary || {},
        previousSummary: this.data.mode === 'edit' ? this.data.originalMealSummary : {},
        baseMealSummary: summarizeFoodItems(this.data.mealDraft.items || []),
        weight: targetContext.weight,
        targetPreferences: targetContext.targetPreferences || {}
      });
      wx.navigateTo({
        url: '/pkg-records/food-picker/index'
      });
    });
  },

  onDraftQuantityInput(e) {
    const quantity = e.detail.value || '';
    this.setData({
      'currentFoodDraft.quantity': quantity
    }, () => {
      this.updateCurrentFoodDraftPreview();
    });
  },

  onBatchQuantityInput(e) {
    const { index } = e.currentTarget.dataset || {};
    const draftIndex = Number(index);
    if (!Number.isInteger(draftIndex) || draftIndex < 0) return;
    const quantity = e.detail.value || '';
    this.setData({
      [`batchFoodDrafts.${draftIndex}.quantity`]: quantity
    }, () => {
      this.updateBatchFoodDraftPreview(draftIndex);
    });
  },

  updateCurrentFoodDraftPreview() {
    const { food, quantity } = this.data.currentFoodDraft;
    if (!food || !quantity) {
      this.setData({ 'currentFoodDraft.nutritionPreview': null, draftTargetPreview: null });
      return;
    }
    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      this.setData({ 'currentFoodDraft.nutritionPreview': null, draftTargetPreview: null });
      return;
    }
    this.setData({
      'currentFoodDraft.nutritionPreview': FoodModel.calculateNutrition(food, numQuantity)
    }, () => {
      this.refreshDraftTargetPreview();
    });
  },

  updateBatchFoodDraftPreview(index) {
    const draft = this.data.batchFoodDrafts?.[index];
    if (!draft || !draft.food || !draft.quantity) {
      this.setData({ [`batchFoodDrafts.${index}.nutritionPreview`]: null }, () => {
        this.refreshBatchTargetPreview();
      });
      return;
    }
    const numQuantity = parseFloat(draft.quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      this.setData({ [`batchFoodDrafts.${index}.nutritionPreview`]: null }, () => {
        this.refreshBatchTargetPreview();
      });
      return;
    }
    this.setData({
      [`batchFoodDrafts.${index}.nutritionPreview`]: FoodModel.calculateNutrition(draft.food, numQuantity)
    }, () => {
      this.refreshBatchTargetPreview();
    });
  },

  refreshBatchTargetPreview() {
    const targetContext = this.data.targetContext || {};
    const pendingItems = (this.data.batchFoodDrafts || [])
      .map(draft => this.buildMealItemFromFoodDraft(draft, false))
      .filter(Boolean);
    const batchTargetPreview = buildEntryTargetPreview({
      currentSummary: targetContext.currentSummary || {},
      draftSummary: addSummaries(
        summarizeFoodItems(this.data.mealDraft.items || []),
        summarizeFoodItems(pendingItems)
      ),
      previousSummary: this.data.mode === 'edit' ? this.data.originalMealSummary : {},
      weight: targetContext.weight,
      targetPreferences: targetContext.targetPreferences || {},
      includeCalories: true
    });
    this.setData({ batchTargetPreview });
  },

  buildMealItemFromFoodDraft(draft = {}, showToast = true, options = {}) {
    const { foodId, food, quantity, nutritionPreview } = draft;
    if (!foodId || !food) {
      if (showToast) wx.showToast({ title: '请选择食物', icon: 'none' });
      return null;
    }

    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      if (showToast) wx.showToast({ title: '请输入有效的份量', icon: 'none' });
      return null;
    }

    const nutrition = nutritionPreview || FoodModel.calculateNutrition(food, numQuantity);
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

    const editingItemId = options.editingItemId || '';
    const originalItem = editingItemId
      ? (this.data.mealDraft.items || []).find(item => item.localId === editingItemId)
      : null;
    const libraryScope = this.getFoodLibraryScope(food);
    const sourceLabel = this.getFoodSourceLabel(food);

    return {
      localId: editingItemId || `meal_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      originalIntakeId: originalItem?.originalIntakeId || '',
      createdAt: originalItem?.createdAt || null,
      createdBy: originalItem?.createdBy || '',
      foodId,
      food,
      foodSnapshot: FoodModel.buildFoodSnapshot(food),
      nameSnapshot: food.name,
      category: (food.category || '').toString().trim() || '辅食',
      unit: food.baseUnit || 'g',
      quantity: numQuantity,
      nutrition: {
        calories: roundCalories(Number(nutrition.calories) || 0),
        protein: roundNumber(Number(nutrition.protein) || 0, 2),
        carbs: roundNumber(Number(nutrition.carbs) || 0, 2),
        fat: roundNumber(Number(nutrition.fat) || 0, 2),
        fiber: roundNumber(Number(nutrition.fiber) || 0, 2),
        sodium: roundNumber(Number(nutrition.sodium) || 0, 2)
      },
      proteinSource,
      proteinQuality: food.proteinQuality || '',
      libraryScope,
      sourceLabel,
      sourceType: food.sourceType || (food.isSystem ? 'system' : 'user_custom'),
      naturalProtein: roundNumber(naturalProtein, 2),
      specialProtein: roundNumber(specialProtein, 2),
      milkType: food.milkType || ''
    };
  },

  buildMealItemFromDraft(showToast = true) {
    return this.buildMealItemFromFoodDraft(this.data.currentFoodDraft, showToast, {
      editingItemId: this.data.editingItemId
    });
  },

  addOrUpdateMealItem() {
    const nextItem = this.buildMealItemFromDraft();
    if (!nextItem) return;

    const items = [...(this.data.mealDraft.items || [])];
    const existingIndex = items.findIndex(item => item.localId === nextItem.localId);
    if (existingIndex >= 0) {
      items[existingIndex] = nextItem;
    } else {
      items.push(nextItem);
    }

    this.setData({
      'mealDraft.items': items,
      mealSummary: calculateMealSummary(items),
      drawerVisible: false
    }, () => {
      this.refreshMealTargetPreview();
      this.resetCurrentFoodDraft();
    });

    wx.showToast({
      title: existingIndex >= 0 ? '已更新食物' : '已加入本顿',
      icon: 'success'
    });
  },

  addSelectedFoodsToMeal() {
    const drafts = this.data.batchFoodDrafts || [];
    if (!drafts.length) {
      wx.showToast({ title: '请先选择食物', icon: 'none' });
      return;
    }

    const nextItems = [];
    for (let index = 0; index < drafts.length; index += 1) {
      const nextItem = this.buildMealItemFromFoodDraft(drafts[index], true);
      if (!nextItem) return;
      nextItems.push(nextItem);
    }

    const items = [...(this.data.mealDraft.items || []), ...nextItems];
    this.setData({
      'mealDraft.items': items,
      mealSummary: calculateMealSummary(items),
      drawerVisible: false
    }, () => {
      this.refreshMealTargetPreview();
      this.resetCurrentFoodDraft();
    });

    wx.showToast({
      title: `已加入 ${nextItems.length} 种食物`,
      icon: 'success'
    });
  },

  addSelectedFoodItemsToMeal(selectedItems = []) {
    if (!selectedItems.length) return;
    const items = [...(this.data.mealDraft.items || [])];
    let addedCount = 0;
    let updatedCount = 0;
    for (let index = 0; index < selectedItems.length; index += 1) {
      const { food, quantity } = selectedItems[index];
      const existingIndex = items.findIndex(item => item.foodId === food?._id);
      const nextItem = this.buildMealItemFromFoodDraft({
        foodId: food?._id,
        food,
        quantity,
        nutritionPreview: FoodModel.calculateNutrition(food, Number(quantity))
      }, true, {
        editingItemId: existingIndex >= 0 ? items[existingIndex].localId : ''
      });
      if (!nextItem) return;
      if (existingIndex >= 0) {
        items[existingIndex] = nextItem;
        updatedCount += 1;
      } else {
        items.push(nextItem);
        addedCount += 1;
      }
    }
    this.setData({
      'mealDraft.items': items,
      mealSummary: calculateMealSummary(items),
      drawerVisible: false,
      batchFoodDrafts: []
    }, () => {
      this.refreshMealTargetPreview();
      this.resetCurrentFoodDraft();
    });
    wx.showToast({
      title: addedCount > 0 ? `已加入 ${addedCount} 种食物` : `已更新 ${updatedCount} 种食物`,
      icon: 'success'
    });
  },

  editMealItem(e) {
    const { id } = e.currentTarget.dataset;
    const target = (this.data.mealDraft.items || []).find(item => item.localId === id);
    if (!target) return;
    this.setData({
      drawerVisible: true,
      drawerStep: 'edit',
      editingItemId: target.localId,
      currentFoodDraft: {
        foodId: target.foodId,
        food: target.food,
        quantity: String(target.quantity),
        unit: target.unit || 'g',
        nutritionPreview: target.nutrition || null
      }
    }, () => {
      this.refreshDraftTargetPreview();
    });
  },

  removeMealItem(e) {
    const { id } = e.currentTarget.dataset;
    const nextItems = (this.data.mealDraft.items || []).filter(item => item.localId !== id);
    const shouldResetDraft = this.data.editingItemId === id;
    this.setData({
      'mealDraft.items': nextItems,
      mealSummary: calculateMealSummary(nextItems),
      ...(shouldResetDraft ? {
        editingItemId: '',
        currentFoodDraft: {
          foodId: '',
          food: null,
          quantity: '',
          unit: 'g',
          nutritionPreview: null
        }
      } : {})
    }, () => {
      this.refreshTargetPreviews();
    });
  },

  async getMergedDayRecord(selectedDate, babyUid) {
    const db = wx.cloud.database();
    const _ = db.command;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day + 1, 0, 0, 0);

    const result = await db.collection('feeding_records').where({
      babyUid,
      date: _.gte(startOfDay).and(_.lt(endOfDay))
    }).get();

    if (result.data && result.data.length > 0) {
      return mergeFeedingRecords(result.data);
    }

    const legacyResult = await db.collection('feeding_records').where({
      babyUid,
      date: selectedDate
    }).get();

    return legacyResult.data && legacyResult.data.length > 0
      ? mergeFeedingRecords(legacyResult.data)
      : null;
  },

  async loadExistingMeal(mealBatchId) {
    const babyUid = getBabyUid();
    if (!babyUid || !mealBatchId) {
      wx.showToast({ title: '餐次信息缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }

    try {
      wx.showLoading({ title: '加载中...', mask: true });
      const targetIntakes = (await FoodIntakeRecordModel.findByMealBatch(babyUid, this.data.selectedDate, mealBatchId))
        .sort((a, b) => {
          const sortDiff = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
          if (sortDiff !== 0) return sortDiff;
          const timeA = String(a.recordedAt || '').replace(':', '');
          const timeB = String(b.recordedAt || '').replace(':', '');
          return timeA.localeCompare(timeB);
        });

      if (!targetIntakes.length) {
        wx.hideLoading();
        wx.showToast({ title: '未找到这顿食物', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 300);
        return;
      }

      const catalogMap = new Map((this.data.foodCatalog || []).map(food => [food._id, food]));
      const firstIntake = targetIntakes[0];
      const items = targetIntakes.map((intake, index) => {
        const catalogFood = catalogMap.get(intake.foodId);
        const snapshot = intake.foodSnapshot || {};
        const fallbackFood = {
          _id: intake.foodId || `legacy_food_${index}`,
          name: intake.foodName || intake.nameSnapshot || snapshot.name || '食物',
          category: snapshot.category || intake.category || '辅食',
          baseUnit: intake.unit || 'g',
          milkType: intake.milkType || '',
          proteinSource: snapshot.proteinSource || intake.proteinSource || 'natural',
          proteinQuality: snapshot.proteinQuality || intake.proteinQuality || '',
          sourceType: intake.sourceType || snapshot.sourceType || '',
          libraryScope: intake.libraryScope || snapshot.libraryScope || ''
        };
        const food = catalogFood || fallbackFood;
        const libraryScope = intake.libraryScope || snapshot.libraryScope || this.getFoodLibraryScope(food);

        return {
          localId: intake._id || `meal_item_${index}`,
          originalIntakeId: intake._id || '',
          createdAt: intake.createdAt || null,
          createdBy: intake.createdBy || '',
          foodId: intake.foodId || '',
          food,
          foodSnapshot: intake.foodSnapshot || FoodModel.buildFoodSnapshot(food),
          nameSnapshot: intake.foodName || intake.nameSnapshot || fallbackFood.name,
          category: intake.category || fallbackFood.category,
          unit: intake.unit || fallbackFood.baseUnit || 'g',
          quantity: Number(intake.quantity) || 0,
          nutrition: intake.nutrition || {},
          proteinSource: snapshot.proteinSource || intake.proteinSource || fallbackFood.proteinSource || 'natural',
          proteinQuality: intake.proteinQuality || (catalogFood?.proteinQuality) || '',
          libraryScope,
          sourceLabel: intake.sourceLabel || this.getFoodSourceLabel({
            ...food,
            libraryScope,
            isSystem: libraryScope === 'system'
          }),
          sourceType: intake.sourceType || snapshot.sourceType || food.sourceType || (libraryScope === 'system' ? 'system' : 'user_custom'),
          naturalProtein: typeof intake.nutrition?.naturalProtein === 'number'
            ? intake.nutrition.naturalProtein
            : (typeof intake.naturalProtein === 'number' ? intake.naturalProtein : 0),
          specialProtein: typeof intake.nutrition?.specialProtein === 'number'
            ? intake.nutrition.specialProtein
            : (typeof intake.specialProtein === 'number' ? intake.specialProtein : 0),
          milkType: intake.milkType || ''
        };
      });

      this.setData({
        editRecordId: '',
        mealDraft: {
          mealTime: firstIntake.mealTime || firstIntake.recordedAt || formatTime(new Date()),
          mealLabel: firstIntake.mealLabel || getDefaultMealLabel(firstIntake.mealTime || firstIntake.recordedAt || ''),
          mealNote: firstIntake.mealNote || '',
          items
        },
        mealSummary: calculateMealSummary(items),
        originalMealSummary: summarizeFoodItems(items)
      }, () => {
        this.refreshTargetPreviews();
      });
      wx.hideLoading();
    } catch (error) {
      console.error('加载餐次失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
    }
  },

  buildMealIntakes(mealBatchId) {
    const { mealTime, mealLabel, mealNote, items } = this.data.mealDraft;
    const now = new Date();
    return (items || []).map((item, index) => ({
      _id: item.originalIntakeId || `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'food',
      foodType: 'food',
      category: item.category || '辅食',
      foodId: item.foodId,
      foodSnapshot: item.foodSnapshot || FoodModel.buildFoodSnapshot(item.food || {}),
      nameSnapshot: item.nameSnapshot,
      unit: item.unit || 'g',
      quantity: item.quantity,
      proteinSource: item.proteinSource || 'natural',
      proteinQuality: item.proteinQuality || '',
      libraryScope: item.libraryScope || item.foodSnapshot?.libraryScope || this.getFoodLibraryScope(item.food || {}),
      sourceLabel: item.sourceLabel || this.getFoodSourceLabel({
        ...(item.food || {}),
        libraryScope: item.libraryScope || item.foodSnapshot?.libraryScope,
        isSystem: (item.libraryScope || item.foodSnapshot?.libraryScope) === 'system'
      }),
      sourceType: item.sourceType || item.foodSnapshot?.sourceType || 'manual_food',
      naturalProtein: item.naturalProtein || 0,
      specialProtein: item.specialProtein || 0,
      milkType: item.milkType || '',
      notes: '',
      recordedAt: mealTime,
      time: mealTime,
      mealBatchId,
      mealTime,
      mealLabel,
      mealNote: String(mealNote || '').trim(),
      sortOrder: index,
      createdAt: item.createdAt || now,
      updatedAt: now,
      createdBy: item.createdBy || app.globalData.openid || wx.getStorageSync('openid') || '',
      foodName: item.nameSnapshot || item.food?.name || '',
      nutrition: {
        ...(item.nutrition || {}),
        naturalProtein: item.naturalProtein || item.nutrition?.naturalProtein || 0,
        specialProtein: item.specialProtein || item.nutrition?.specialProtein || 0
      }
    }));
  },

  async notifyPreviousPageRefresh() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (!prevPage || prevPage.route !== 'pages/daily-feeding/index' || typeof prevPage.loadTodayData !== 'function') {
      return;
    }
    await prevPage.loadTodayData(true);
  },

  async saveMeal() {
    if (this.data.isSaving) return;
    if (isFutureDateKey(this.data.selectedDate)) {
      wx.showToast({ title: '暂不支持记录未来日期', icon: 'none' });
      return;
    }

    let items = [...(this.data.mealDraft.items || [])];
    if (this.data.drawerStep === 'edit' && this.data.currentFoodDraft.food) {
      const pendingItem = this.buildMealItemFromDraft();
      if (!pendingItem) return;
      const pendingIndex = items.findIndex(item => item.localId === pendingItem.localId);
      if (pendingIndex >= 0) {
        items[pendingIndex] = pendingItem;
      } else {
        items.push(pendingItem);
      }
      this.setData({ 'mealDraft.items': items });
    }

    if (!items.length) {
      wx.showToast({ title: '请先添加食物', icon: 'none' });
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const mealBatchId = this.data.editMealBatchId || `meal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mealIntakes = this.buildMealIntakes(mealBatchId);

    this.setData({ isSaving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    try {
      await FoodIntakeRecordModel.replaceMealBatch({
        babyUid,
        date: this.data.selectedDate,
        mealBatchId,
        records: mealIntakes,
        operatorOpenid: app.globalData.openid || wx.getStorageSync('openid') || ''
      });

      // 食物（天然蛋白来源之一）直接写库，需让当天 daily_summary_v2 失效，
      // 否则首页趋势/数据记录页的当日汇总会沿用旧缓存。
      try {
        await DailySummaryV2Model.markDirty(babyUid, this.data.selectedDate);
      } catch (markError) {
        console.error('标记当日汇总失效失败:', markError);
      }

      wx.hideLoading();
      wx.showToast({ title: this.data.mode === 'edit' ? '已更新本顿' : '已保存本顿', icon: 'success' });
      await this.notifyPreviousPageRefresh();
      setTimeout(() => {
        wx.navigateBack();
      }, 300);
    } catch (error) {
      console.error('保存餐次失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ isSaving: false });
    }
  },

  onCancel() {
    wx.navigateBack();
  }
});
