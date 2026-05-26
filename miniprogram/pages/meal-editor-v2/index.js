const FoodModel = require('../../models/food');
const FoodIntakeRecordModel = require('../../models/foodIntakeRecord');
const DailySummaryV2Model = require('../../models/dailySummaryV2');
const MealCombinationModel = require('../../models/mealCombination');
const { getBabyUid } = require('../../utils/index');
const { findOrCreateDailyRecord } = require('../../utils/feedingRecordStore');
const {
  validateCompletionPercent,
  createEmptyMealSummary: createUtilityEmptyMealSummary,
  calculateMealSummary: calculateUtilityMealSummary,
  calculateActualMealItems,
  buildMealCombinationFromDraft,
  buildMealItemsFromCombination
} = require('../../utils/mealCombinationUtils');

const app = getApp();
const MAX_RECENT_FOODS = 10;
const MEAL_LABELS = ['早餐', '午餐', '晚餐', '加餐'];
const FOOD_PLACEHOLDER_IMAGE = '/images/LemonLogo.png';

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
  return createUtilityEmptyMealSummary();
}

function calculateMealSummary(items = []) {
  return calculateUtilityMealSummary(items);
}

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

Page({
  data: {
    mode: 'create',
    recordSource: 'v2',
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
    completionPercent: 100,
    completionPercentOptions: [100, 75, 50],
    mealSummary: createEmptyMealSummary(),
    plannedMealSummary: createEmptyMealSummary(),
    actualMealSummary: createEmptyMealSummary(),
    foodCatalog: [],
    foodCategories: [],
    activeCategory: 'recent',
    recentFoodOptions: [],
    filteredFoodOptions: [],
    foodSearchQuery: '',
    mealCombinations: [],
    combinationPanelVisible: false,
    combinationNameInputVisible: false,
    combinationDraftName: '',
    combinationLoading: false,
    combinationApplying: false,
    combinationSaving: false,
    drawerVisible: false,
    drawerActiveTab: 'food',
    drawerStep: 'select',
    pendingMealItems: [],
    currentFoodDraft: {
      foodId: '',
      food: null,
      quantity: '',
      unit: 'g',
      nutritionPreview: null,
      notes: ''
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
      recordSource: 'v2',
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
      completionPercent: 100,
      mealSummary: createEmptyMealSummary(),
      plannedMealSummary: createEmptyMealSummary(),
      actualMealSummary: createEmptyMealSummary()
    });
    await this.loadFoodCatalog();
    await this.loadMealCombinations();
    if (editMealBatchId) {
      await this.loadExistingMeal(editMealBatchId);
    }
    this.hasLoadedCatalog = true;
  },

  isV2RecordSource() {
    return this.data.recordSource === 'v2';
  },

  async onShow() {
    if (!this.hasLoadedCatalog) {
      return;
    }
    await this.loadFoodCatalog();
  },

  async loadFoodCatalog() {
    const babyUid = getBabyUid();
    try {
      const foods = await FoodModel.getAvailableFoods(babyUid);
      const foodsWithImageUrls = await FoodModel.resolveFoodImageUrls(foods || []);
      const catalog = [...(foodsWithImageUrls || [])]
        .map(food => ({
          ...food,
          displayImage: food.imageUrl || food.image || FOOD_PLACEHOLDER_IMAGE
        }))
        .sort((a, b) => {
        const categoryA = (a.category || '').toString();
        const categoryB = (b.category || '').toString();
        if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);
        return (a.name || '').localeCompare(b.name || '');
        });
      const categories = Array.from(new Set(catalog.map(food => (food.category || '').toString().trim()).filter(Boolean)));
      this.setData({
        foodCatalog: catalog,
        foodCategories: [{ value: 'recent', label: '最近' }, ...categories.map(category => ({ value: category, label: category }))]
      });
      await this.loadRecentFoodOptions();
      this.filterFoodOptions('');
    } catch (error) {
      console.error('加载食物库失败:', error);
      this.setData({
        foodCatalog: [],
        foodCategories: [{ value: 'recent', label: '最近' }],
        recentFoodOptions: [],
        filteredFoodOptions: []
      });
    }
  },

  async loadRecentFoodOptions() {
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || getBabyUid();
    if (!babyUid) return;
    try {
      const db = wx.cloud.database();
      const result = await db.collection('feeding_records')
        .where({ babyUid })
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      const foodMap = new Map((this.data.foodCatalog || []).map(food => [food._id, food]));
      const recent = [];
      const seen = new Set();
      for (const record of result.data || []) {
        for (const intake of record?.intakes || []) {
          if (!intake || intake.type === 'milk') continue;
          if (!intake.foodId || seen.has(intake.foodId)) continue;
          const food = foodMap.get(intake.foodId);
          if (!food) continue;
          seen.add(intake.foodId);
          recent.push(food);
          if (recent.length >= MAX_RECENT_FOODS) break;
        }
        if (recent.length >= MAX_RECENT_FOODS) break;
      }
      this.setData({ recentFoodOptions: recent });
    } catch (error) {
      console.error('加载最近食物失败:', error);
      this.setData({ recentFoodOptions: [] });
    }
  },

  async loadMealCombinations(options = {}) {
    const { showToast = true, throwOnError = false } = options;
    const babyUid = getBabyUid();
    if (!babyUid) {
      this.setData({
        mealCombinations: [],
        combinationLoading: false
      });
      return [];
    }

    this.setData({ combinationLoading: true });
    try {
      const combinations = await MealCombinationModel.findByBaby(babyUid);
      this.setData({
        mealCombinations: combinations || [],
        combinationLoading: false
      });
      return combinations || [];
    } catch (error) {
      this.setData({
        mealCombinations: [],
        combinationLoading: false
      });
      if (showToast) {
        wx.showToast({ title: '菜谱加载失败', icon: 'none' });
      }
      if (throwOnError) {
        throw error;
      }
      return [];
    }
  },

  toggleCombinationPanel() {
    this.setData({
      combinationPanelVisible: !this.data.combinationPanelVisible
    });
  },

  onDrawerTabTap(e) {
    const { tab } = e.currentTarget.dataset || {};
    if (!['food', 'combination'].includes(tab)) return;
    this.setData({ drawerActiveTab: tab });
  },

  async applyMealCombination(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    if (this.data.combinationApplying) return;

    const combination = (this.data.mealCombinations || []).find(item => (item._id || item.id) === id);
    if (!combination) {
      wx.showToast({ title: '未找到菜谱', icon: 'none' });
      return;
    }

    const combinationItems = buildMealItemsFromCombination(combination, this.data.foodCatalog || []);
    if (!combinationItems.length) {
      wx.showToast({ title: '菜谱里还没有食物', icon: 'none' });
      return;
    }

    this.setData({ combinationApplying: true });
    const source = {
      combinationId: combination._id || combination.id || '',
      combinationName: combination.name || ''
    };
    const sourcedItems = combinationItems.map(item => ({
      ...item,
      mealCombinationSource: source
    }));

    if (this.data.drawerVisible && this.data.drawerStep === 'select') {
      const pendingFromCombination = sourcedItems.map((item, index) => (
        this.buildPendingMealItemFromMealItem(item, source, index)
      ));
      this.setData({
        pendingMealItems: [
          ...(this.data.pendingMealItems || []),
          ...pendingFromCombination
        ],
        drawerStep: 'batchQuantity'
      });

      try {
        await MealCombinationModel.incrementUsage(source.combinationId);
        this.setData({
          mealCombinations: (this.data.mealCombinations || []).map(item => {
            if ((item._id || item.id) !== source.combinationId) return item;
            return {
              ...item,
              usageCount: (Number(item.usageCount) || 0) + 1
            };
          })
        });
        wx.showToast({ title: '已加入待设置', icon: 'success' });
      } catch (error) {
        wx.showToast({ title: '已加入待设置，次数稍后同步', icon: 'none' });
      } finally {
        this.setData({ combinationApplying: false });
      }
      return;
    }

    const nextItems = [
      ...(this.data.mealDraft.items || []),
      ...sourcedItems
    ];

    this.setData({
      'mealDraft.items': nextItems,
      drawerVisible: false,
      drawerActiveTab: 'food',
      ...this.buildMealSummaryData(nextItems, this.data.completionPercent)
    });

    try {
      await MealCombinationModel.incrementUsage(source.combinationId);
      this.setData({
        mealCombinations: (this.data.mealCombinations || []).map(item => {
          if ((item._id || item.id) !== source.combinationId) return item;
          return {
            ...item,
            usageCount: (Number(item.usageCount) || 0) + 1
          };
        })
      });
      wx.showToast({ title: '已加入菜谱', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '已加入，使用次数稍后同步', icon: 'none' });
    } finally {
      this.setData({ combinationApplying: false });
    }
  },

  showSaveCombinationInput() {
    this.setData({
      combinationNameInputVisible: true
    });
  },

  hideSaveCombinationInput() {
    this.setData({
      combinationNameInputVisible: false,
      combinationDraftName: ''
    });
  },

  onCombinationNameInput(e) {
    this.setData({
      combinationDraftName: e.detail.value || ''
    });
  },

  async saveCurrentMealAsCombination() {
    if (this.data.combinationSaving) return;

    const name = String(this.data.combinationDraftName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入菜谱名称', icon: 'none' });
      return;
    }

    const currentItems = this.data.mealDraft.items || [];
    if (!currentItems.length) {
      wx.showToast({ title: '请先添加食物', icon: 'none' });
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const plannedItems = this.normalizePlannedMealItems(currentItems).map(item => ({
      ...item,
      quantity: item.plannedQuantity,
      nutrition: { ...(item.plannedNutrition || item.nutrition || {}) }
    }));
    const payload = {
      ...buildMealCombinationFromDraft({
        ...this.data.mealDraft,
        items: plannedItems
      }, name),
      babyUid,
      name
    };

    try {
      this.setData({
        combinationLoading: true,
        combinationSaving: true
      });
      await MealCombinationModel.createMealCombination(payload);
      try {
        await this.loadMealCombinations({ showToast: false, throwOnError: true });
      } catch (refreshError) {
        this.setData({
          combinationLoading: false,
          combinationSaving: false
        });
        wx.showToast({ title: '菜谱已保存，刷新列表失败', icon: 'none' });
        return;
      }
      this.setData({
        combinationDraftName: '',
        combinationNameInputVisible: false,
        combinationPanelVisible: true,
        combinationLoading: false,
        combinationSaving: false
      });
      wx.showToast({ title: '已保存菜谱', icon: 'success' });
    } catch (error) {
      console.error('保存菜谱失败:', error);
      this.setData({
        combinationLoading: false,
        combinationSaving: false
      });
      wx.showToast({ title: '保存菜谱失败', icon: 'none' });
    }
  },

  filterFoodOptions(query = this.data.foodSearchQuery || '') {
    const normalized = normalizeSearchText(query);
    const activeCategory = this.data.activeCategory || 'recent';
    let baseList = [];

    if (activeCategory === 'recent' && !normalized) {
      baseList = this.data.recentFoodOptions || [];
      if (!baseList.length) {
        baseList = this.data.foodCatalog || [];
      }
    } else if (activeCategory === 'recent') {
      baseList = this.data.foodCatalog || [];
    } else {
      baseList = (this.data.foodCatalog || []).filter(food => (food.category || '').toString().trim() === activeCategory);
    }

    const filtered = normalized
      ? baseList.filter(food => {
          const searchText = [
            food.name || '',
            food.category || '',
            food.aliasText || ''
          ].join(' ');
          return fuzzyIncludes(searchText, normalized);
        })
      : baseList;

    this.setData({ filteredFoodOptions: this.decorateFoodOptions(filtered) });
  },

  decorateFoodOptions(options = []) {
    const selectedIds = new Set((this.data.pendingMealItems || []).map(item => item.foodId).filter(Boolean));
    return (options || []).map(food => ({
      ...food,
      isPendingSelected: selectedIds.has(food._id || food.id)
    }));
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

  onCompletionPercentTap(e) {
    const percent = Number(e.currentTarget.dataset.percent);
    if (!Number.isFinite(percent)) return;
    this.setData({ completionPercent: percent });
    this.refreshMealSummaries(this.data.mealDraft.items, percent);
  },

  onCompletionPercentInput(e) {
    const value = e.detail.value || '';
    this.setData({ completionPercent: value });
    this.refreshMealSummaries(this.data.mealDraft.items, value);
  },

  buildMealSummaryData(items = this.data.mealDraft.items || [], completionPercent = this.data.completionPercent) {
    const plannedItems = this.normalizePlannedMealItems(items);
    const plannedMealSummary = calculateMealSummary(plannedItems);
    const completionResult = validateCompletionPercent(completionPercent);
    const actualMealSummary = completionResult.valid
      ? calculateMealSummary(calculateActualMealItems(plannedItems, completionResult.value))
      : createEmptyMealSummary();
    return {
      mealSummary: plannedMealSummary,
      plannedMealSummary,
      actualMealSummary
    };
  },

  refreshMealSummaries(items = this.data.mealDraft.items || [], completionPercent = this.data.completionPercent) {
    this.setData(this.buildMealSummaryData(items, completionPercent));
  },

  normalizePlannedMealItems(items = []) {
    return (items || []).map(item => {
      const plannedNutrition = {
        ...(item.plannedNutrition || item.nutrition || {})
      };
      if (plannedNutrition.naturalProtein === undefined) {
        plannedNutrition.naturalProtein = item.naturalProtein || 0;
      }
      if (plannedNutrition.specialProtein === undefined) {
        plannedNutrition.specialProtein = item.specialProtein || 0;
      }

      return {
        ...item,
        plannedQuantity: item.plannedQuantity !== undefined ? item.plannedQuantity : item.quantity,
        plannedNutrition,
        nutrition: plannedNutrition
      };
    });
  },

  onFoodSearchInput(e) {
    const query = e.detail.value || '';
    this.setData({ foodSearchQuery: query });
    this.filterFoodOptions(query);
  },

  resetCurrentFoodDraft() {
    this.setData({
      currentFoodDraft: {
        foodId: '',
        food: null,
        quantity: '',
        unit: 'g',
        nutritionPreview: null,
        notes: ''
      },
      editingItemId: '',
      drawerStep: 'select',
      drawerActiveTab: 'food',
      foodSearchQuery: '',
      pendingMealItems: []
    }, () => {
      this.filterFoodOptions('');
    });
  },

  openFoodDrawer() {
    this.setData({
      drawerVisible: true,
      drawerStep: this.data.currentFoodDraft.food ? 'edit' : 'select',
      drawerActiveTab: this.data.currentFoodDraft.food ? this.data.drawerActiveTab : 'food',
      pendingMealItems: this.data.currentFoodDraft.food ? this.data.pendingMealItems : []
    }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  navigateToFoodManagement() {
    wx.navigateTo({
      url: '/pages/food-management/index?openAdd=1&from=meal-editor'
    });
  },

  closeFoodDrawer() {
    this.setData({
      drawerVisible: false
    });
    this.resetCurrentFoodDraft();
  },

  onCategoryTap(e) {
    const { category } = e.currentTarget.dataset;
    if (!category) return;
    this.setData({ activeCategory: category }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  onFoodOptionTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    const food = (this.data.foodCatalog || []).find(item => item._id === id);
    if (!food) return;

    const existingIndex = (this.data.pendingMealItems || []).findIndex(item => item.foodId === food._id);
    const pendingMealItems = [...(this.data.pendingMealItems || [])];
    if (existingIndex >= 0) {
      pendingMealItems.splice(existingIndex, 1);
    } else {
      pendingMealItems.push(this.buildPendingMealItemFromFood(food));
    }

    this.setData({
      pendingMealItems,
      drawerStep: 'select'
    }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  buildPendingMealItemFromFood(food = {}) {
    return {
      pendingId: food._id || food.id || `pending_food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      foodId: food._id || food.id || '',
      food,
      foodSnapshot: null,
      nameSnapshot: food.name || '',
      category: (food.category || '').toString().trim() || '辅食',
      unit: food.baseUnit || 'g',
      quantity: '',
      plannedQuantity: null,
      plannedNutrition: null,
      nutritionPreview: null,
      mealCombinationSource: null
    };
  },

  buildPendingMealItemFromMealItem(item = {}, source = {}, index = 0) {
    const pendingId = `${source.combinationId || 'combo'}_${item.foodId || index}_${index}`;
    return {
      pendingId,
      foodId: item.foodId || '',
      food: item.food || null,
      foodSnapshot: item.foodSnapshot || null,
      nameSnapshot: item.nameSnapshot || item.foodName || item.foodSnapshot?.name || '',
      category: item.category || item.foodSnapshot?.category || '辅食',
      unit: item.unit || item.food?.baseUnit || item.foodSnapshot?.baseUnit || 'g',
      quantity: item.quantity !== undefined ? String(item.quantity) : '',
      plannedQuantity: item.plannedQuantity !== undefined ? Number(item.plannedQuantity) : Number(item.quantity) || null,
      plannedNutrition: item.plannedNutrition || item.nutrition || null,
      nutritionPreview: item.nutrition || item.plannedNutrition || null,
      mealCombinationSource: source
    };
  },

  goToBatchQuantityStep() {
    if (!(this.data.pendingMealItems || []).length) {
      wx.showToast({ title: '请先选择食物', icon: 'none' });
      return;
    }
    this.setData({ drawerStep: 'batchQuantity' });
  },

  backToBatchSelect() {
    this.setData({ drawerStep: 'select' }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  onPendingQuantityInput(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    const quantity = e.detail.value || '';
    const pendingMealItems = (this.data.pendingMealItems || []).map(item => {
      if (item.pendingId !== id && item.foodId !== id) return item;
      const updated = { ...item, quantity };
      return {
        ...updated,
        nutritionPreview: this.calculatePendingNutritionPreview(updated)
      };
    });
    this.setData({ pendingMealItems });
  },

  removePendingMealItem(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    this.setData({
      pendingMealItems: (this.data.pendingMealItems || []).filter(item => item.pendingId !== id && item.foodId !== id)
    }, () => {
      this.filterFoodOptions(this.data.foodSearchQuery || '');
    });
  },

  calculatePendingNutritionPreview(item = {}) {
    const quantity = parseFloat(item.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      return null;
    }

    if (item.food) {
      return FoodModel.calculateNutrition(item.food, quantity);
    }

    const baseNutrition = item.plannedNutrition || item.nutritionPreview || {};
    const plannedQuantity = Number(item.plannedQuantity);
    const factor = plannedQuantity > 0 ? quantity / plannedQuantity : 1;
    const fields = ['calories', 'protein', 'naturalProtein', 'specialProtein', 'carbs', 'fat', 'fiber', 'sodium'];
    return fields.reduce((nutrition, field) => {
      nutrition[field] = roundNumber((Number(baseNutrition[field]) || 0) * factor, 2);
      return nutrition;
    }, {});
  },

  previewFoodOptionImage(e) {
    const { url } = e.currentTarget.dataset || {};
    const current = (url || '').toString().trim();
    if (!current) {
      return;
    }

    wx.previewImage({
      current,
      urls: [current]
    });
  },

  backToFoodSelect() {
    this.setData({
      drawerStep: 'select',
      drawerActiveTab: 'food'
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

  updateCurrentFoodDraftPreview() {
    const { food, quantity } = this.data.currentFoodDraft;
    if (!food || !quantity) {
      this.setData({ 'currentFoodDraft.nutritionPreview': null });
      return;
    }
    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      this.setData({ 'currentFoodDraft.nutritionPreview': null });
      return;
    }
    this.setData({
      'currentFoodDraft.nutritionPreview': FoodModel.calculateNutrition(food, numQuantity)
    });
  },

  buildProteinAwareNutrition(food = {}, nutrition = {}) {
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
    } else if (nutrition.naturalProtein !== undefined || nutrition.specialProtein !== undefined) {
      naturalProtein = Number(nutrition.naturalProtein) || 0;
      specialProtein = Number(nutrition.specialProtein) || 0;
    }

    return {
      calories: roundNumber(Number(nutrition.calories) || 0, 2),
      protein: roundNumber(protein, 2),
      naturalProtein: roundNumber(naturalProtein, 2),
      specialProtein: roundNumber(specialProtein, 2),
      carbs: roundNumber(Number(nutrition.carbs) || 0, 2),
      fat: roundNumber(Number(nutrition.fat) || 0, 2),
      fiber: roundNumber(Number(nutrition.fiber) || 0, 2),
      sodium: roundNumber(Number(nutrition.sodium) || 0, 2)
    };
  },

  buildMealItemFromDraft(showToast = true) {
    const { foodId, food, quantity, nutritionPreview, notes } = this.data.currentFoodDraft;
    if (!foodId || !food) {
      if (showToast) wx.showToast({ title: '请选择食物', icon: 'none' });
      return null;
    }

    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      if (showToast) wx.showToast({ title: '请输入有效的份量', icon: 'none' });
      return null;
    }

    const nutrition = this.buildProteinAwareNutrition(
      food,
      nutritionPreview || FoodModel.calculateNutrition(food, numQuantity)
    );
    const proteinSource = food.proteinSource || 'natural';

    const originalItem = this.data.editingItemId
      ? (this.data.mealDraft.items || []).find(item => item.localId === this.data.editingItemId)
      : null;

    return {
      localId: this.data.editingItemId || `meal_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      originalIntakeId: originalItem?.originalIntakeId || '',
      createdAt: originalItem?.createdAt || null,
      createdBy: originalItem?.createdBy || '',
      foodId,
      food,
      nameSnapshot: food.name,
      category: (food.category || '').toString().trim() || '辅食',
      unit: food.baseUnit || 'g',
      quantity: numQuantity,
      nutrition,
      proteinSource,
      proteinQuality: food.proteinQuality || '',
      naturalProtein: nutrition.naturalProtein,
      specialProtein: nutrition.specialProtein,
      milkType: food.milkType || '',
      notes: String(notes || '').trim()
    };
  },

  buildMealItemFromPendingItem(item = {}, index = 0) {
    const quantity = parseFloat(item.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      return null;
    }

    const nutritionSource = item.nutritionPreview || this.calculatePendingNutritionPreview(item) || {};
    const food = item.food || item.foodSnapshot || {};
    const nutrition = this.buildProteinAwareNutrition(food, nutritionSource);
    const proteinSource = food.proteinSource || item.proteinSource || '';

    return {
      localId: `meal_item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      originalIntakeId: '',
      createdAt: null,
      createdBy: '',
      foodId: item.foodId || food._id || food.id || '',
      food: item.food || null,
      foodSnapshot: item.foodSnapshot || null,
      nameSnapshot: item.nameSnapshot || food.name || '',
      category: item.category || food.category || '辅食',
      unit: item.unit || food.baseUnit || 'g',
      quantity,
      plannedQuantity: quantity,
      plannedNutrition: { ...nutrition },
      nutrition,
      proteinSource,
      proteinQuality: food.proteinQuality || '',
      naturalProtein: nutrition.naturalProtein,
      specialProtein: nutrition.specialProtein,
      milkType: food.milkType || '',
      mealCombinationSource: item.mealCombinationSource || null,
      notes: ''
    };
  },

  addPendingItemsToMeal() {
    const nextItems = (this.data.pendingMealItems || [])
      .map((item, index) => this.buildMealItemFromPendingItem(item, index))
      .filter(Boolean);

    if (!nextItems.length || nextItems.length !== (this.data.pendingMealItems || []).length) {
      wx.showToast({ title: '请为每种食物填写有效份量', icon: 'none' });
      return;
    }

    const items = [
      ...(this.data.mealDraft.items || []),
      ...nextItems
    ];
    this.setData({
      'mealDraft.items': items,
      ...this.buildMealSummaryData(items),
      drawerVisible: false,
      pendingMealItems: []
    }, () => {
      this.resetCurrentFoodDraft();
    });
    wx.showToast({ title: `已加入 ${nextItems.length} 种食物`, icon: 'success' });
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
      ...this.buildMealSummaryData(items),
      drawerVisible: false
    }, () => {
      this.resetCurrentFoodDraft();
    });

    wx.showToast({
      title: existingIndex >= 0 ? '已更新食物' : '已加入本顿',
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
        nutritionPreview: target.nutrition || null,
        notes: target.notes || ''
      }
    });
  },

  removeMealItem(e) {
    const { id } = e.currentTarget.dataset;
    const nextItems = (this.data.mealDraft.items || []).filter(item => item.localId !== id);
    const shouldResetDraft = this.data.editingItemId === id;
    this.setData({
      'mealDraft.items': nextItems,
      ...this.buildMealSummaryData(nextItems),
      ...(shouldResetDraft ? {
        editingItemId: '',
        currentFoodDraft: {
          foodId: '',
          food: null,
          quantity: '',
          unit: 'g',
          nutritionPreview: null,
          notes: ''
        }
      } : {})
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
      if (this.isV2RecordSource()) {
        await this.loadExistingV2Meal(mealBatchId, babyUid);
        return;
      }
      const mergedRecord = await this.getMergedDayRecord(this.data.selectedDate, babyUid);
      const targetIntakes = (mergedRecord?.intakes || [])
        .filter(item => item && item.mealBatchId === mealBatchId)
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
        const fallbackFood = {
          _id: intake.foodId || `legacy_food_${index}`,
          name: intake.nameSnapshot || '食物',
          category: intake.category || '辅食',
          baseUnit: intake.unit || 'g',
          milkType: intake.milkType || '',
          proteinSource: intake.proteinSource || 'natural',
          proteinQuality: intake.proteinQuality || ''
        };

        return {
          localId: intake._id || `meal_item_${index}`,
          originalIntakeId: intake._id || '',
          createdAt: intake.createdAt || null,
          createdBy: intake.createdBy || '',
          foodId: intake.foodId || '',
          food: catalogFood || fallbackFood,
          nameSnapshot: intake.nameSnapshot || fallbackFood.name,
          category: intake.category || fallbackFood.category,
          unit: intake.unit || fallbackFood.baseUnit || 'g',
          quantity: Number(intake.quantity) || 0,
          nutrition: intake.nutrition || {},
          proteinSource: intake.proteinSource || fallbackFood.proteinSource || 'natural',
          proteinQuality: intake.proteinQuality || (catalogFood?.proteinQuality) || '',
          naturalProtein: typeof intake.naturalProtein === 'number' ? intake.naturalProtein : 0,
          specialProtein: typeof intake.specialProtein === 'number' ? intake.specialProtein : 0,
          milkType: intake.milkType || '',
          notes: intake.notes || ''
        };
      });

      this.setData({
        editRecordId: mergedRecord?._id || '',
        mealDraft: {
          mealTime: firstIntake.mealTime || firstIntake.recordedAt || formatTime(new Date()),
          mealLabel: firstIntake.mealLabel || getDefaultMealLabel(firstIntake.mealTime || firstIntake.recordedAt || ''),
          mealNote: firstIntake.mealNote || '',
          items
        },
        ...this.buildMealSummaryData(items)
      });
      wx.hideLoading();
    } catch (error) {
      console.error('加载餐次失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
    }
  },

  async loadExistingV2Meal(mealBatchId, babyUid) {
    const records = await FoodIntakeRecordModel.findByDate(babyUid, this.data.selectedDate);
    const targetIntakes = (records || [])
      .filter(item => item && item.mealBatchId === mealBatchId)
      .sort((a, b) => {
        const timeA = String(a.time || a.recordedAt || '').replace(':', '');
        const timeB = String(b.time || b.recordedAt || '').replace(':', '');
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
    const hasPlannedFields = (intake = {}) => (
      intake.plannedQuantity !== undefined &&
      intake.plannedNutrition &&
      Object.keys(intake.plannedNutrition).length > 0
    );
    const canRestoreCompletionPercent = targetIntakes.every(hasPlannedFields);
    const restoredCompletionPercent = canRestoreCompletionPercent
      ? (targetIntakes.reduce((restored, intake) => {
          if (restored !== null) return restored;
          const result = validateCompletionPercent(intake.completionPercent);
          return result.valid ? result.value : null;
        }, null) || 100)
      : 100;
    const items = targetIntakes.map((intake, index) => {
      const foodSnapshot = intake.foodSnapshot || {};
      const catalogFood = catalogMap.get(intake.foodId);
      const fallbackFood = {
        _id: intake.foodId || `v2_food_${index}`,
        name: intake.foodName || foodSnapshot.name || '食物',
        category: foodSnapshot.category || '辅食',
        baseUnit: intake.unit || 'g',
        proteinSource: foodSnapshot.proteinSource || 'natural',
        nutritionPer100g: foodSnapshot.nutritionPer100g || {}
      };
      const nutrition = intake.nutrition || {};
      const hasPlannedNutrition = intake.plannedNutrition && Object.keys(intake.plannedNutrition).length > 0;
      const plannedQuantity = intake.plannedQuantity !== undefined
        ? Number(intake.plannedQuantity) || 0
        : Number(intake.quantity) || 0;
      const plannedNutrition = hasPlannedNutrition
        ? { ...intake.plannedNutrition }
        : { ...nutrition };

      return {
        localId: intake._id || `meal_item_${index}`,
        originalIntakeId: intake._id || '',
        createdAt: intake.createdAt || null,
        createdBy: intake.createdBy || '',
        foodId: intake.foodId || '',
        food: catalogFood || fallbackFood,
        nameSnapshot: intake.foodName || fallbackFood.name,
        category: fallbackFood.category,
        unit: intake.unit || fallbackFood.baseUnit || 'g',
        quantity: plannedQuantity,
        plannedQuantity,
        nutrition: plannedNutrition,
        plannedNutrition,
        proteinSource: fallbackFood.proteinSource || 'natural',
        proteinQuality: intake.proteinQuality || '',
        naturalProtein: typeof plannedNutrition.naturalProtein === 'number' ? plannedNutrition.naturalProtein : 0,
        specialProtein: typeof plannedNutrition.specialProtein === 'number' ? plannedNutrition.specialProtein : 0,
        ...(intake.mealCombinationSource ? { mealCombinationSource: intake.mealCombinationSource } : {}),
        milkType: '',
        notes: intake.notes || ''
      };
    });

    this.setData({
      editRecordId: '',
      mealDraft: {
        mealTime: firstIntake.time || formatTime(new Date()),
        mealLabel: firstIntake.mealLabel || getDefaultMealLabel(firstIntake.time || ''),
        mealNote: firstIntake.mealNote || '',
        items
      },
      completionPercent: restoredCompletionPercent,
      ...this.buildMealSummaryData(items, restoredCompletionPercent)
    });
    wx.hideLoading();
  },

  buildMealIntakes(mealBatchId) {
    const { mealTime, mealLabel, mealNote, items } = this.data.mealDraft;
    const completionPercent = Number(this.data.completionPercent);
    const actualItems = calculateActualMealItems(this.normalizePlannedMealItems(items), completionPercent);
    const now = new Date();
    return (actualItems || []).map((item, index) => ({
      _id: item.originalIntakeId || `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'food',
      foodType: 'food',
      category: item.category || '辅食',
      foodId: item.foodId,
      nameSnapshot: item.nameSnapshot,
      unit: item.unit || 'g',
      quantity: item.quantity,
      plannedQuantity: item.plannedQuantity,
      proteinSource: item.proteinSource || 'natural',
      proteinQuality: item.proteinQuality || '',
      nutrition: item.nutrition || {},
      plannedNutrition: item.plannedNutrition || {},
      naturalProtein: item.naturalProtein || 0,
      specialProtein: item.specialProtein || 0,
      completionPercent,
      ...(item.mealCombinationSource ? { mealCombinationSource: item.mealCombinationSource } : {}),
      milkType: item.milkType || '',
      notes: String(item.notes || '').trim(),
      recordedAt: mealTime,
      mealBatchId,
      mealTime,
      mealLabel,
      mealNote: String(mealNote || '').trim(),
      sortOrder: index,
      createdAt: item.createdAt || now,
      updatedAt: now,
      createdBy: item.createdBy || app.globalData.openid || wx.getStorageSync('openid') || ''
    }));
  },

  buildV2FoodIntakePayload(intake, babyUid) {
    const food = intake.food || {};
    const nutrition = intake.nutrition || {};
    const time = intake.mealTime || intake.recordedAt || formatTime(new Date());
    const [year, month, day] = this.data.selectedDate.split('-').map(Number);
    const [hours, minutes] = String(time || '00:00').split(':').map(Number);

    return {
      babyUid,
      date: this.data.selectedDate,
      mealBatchId: intake.mealBatchId,
      recordedAt: new Date(
        Number.isFinite(year) ? year : new Date().getFullYear(),
        Number.isFinite(month) ? month - 1 : 0,
        Number.isFinite(day) ? day : 1,
        Number.isFinite(hours) ? hours : 0,
        Number.isFinite(minutes) ? minutes : 0,
        0
      ),
      source: 'meal_editor_v2',
      time,
      foodId: intake.foodId || food._id || '',
      foodName: intake.nameSnapshot || food.name || '',
      foodSnapshot: {
        name: intake.nameSnapshot || food.name || '',
        category: intake.category || food.category || '辅食',
        proteinSource: intake.proteinSource || food.proteinSource || 'natural',
        nutritionPer100g: food.nutritionPer100g || {}
      },
      quantity: intake.quantity,
      plannedQuantity: intake.plannedQuantity,
      unit: intake.unit || food.baseUnit || 'g',
      nutrition: {
        calories: nutrition.calories || 0,
        protein: nutrition.protein || 0,
        naturalProtein: nutrition.naturalProtein || 0,
        specialProtein: nutrition.specialProtein || 0,
        fat: nutrition.fat || 0,
        carbs: nutrition.carbs || 0,
        fiber: nutrition.fiber || 0,
        sodium: nutrition.sodium || 0
      },
      plannedNutrition: intake.plannedNutrition || {},
      completionPercent: intake.completionPercent,
      ...(intake.mealCombinationSource ? { mealCombinationSource: intake.mealCombinationSource } : {}),
      notes: String(intake.notes || '').trim(),
      mealLabel: intake.mealLabel || '',
      mealNote: String(intake.mealNote || '').trim()
    };
  },

  async saveV2Meal(babyUid, mealBatchId, mealIntakes) {
    const existingRecords = this.data.mode === 'edit'
      ? (await FoodIntakeRecordModel.findByDate(babyUid, this.data.selectedDate))
        .filter(item => item.mealBatchId === mealBatchId)
      : [];
    const existingIds = new Set(existingRecords.map(item => item._id).filter(Boolean));
    const savedIds = new Set();

    await Promise.all((mealIntakes || []).map(async (intake) => {
      const payload = this.buildV2FoodIntakePayload(intake, babyUid);
      if (intake._id && existingIds.has(intake._id)) {
        savedIds.add(intake._id);
        await FoodIntakeRecordModel.updateFoodIntake(intake._id, payload);
        return;
      }
      const result = await FoodIntakeRecordModel.createFoodIntake(payload);
      if (result?._id) {
        savedIds.add(result._id);
      }
    }));

    const removedRecords = existingRecords.filter(record => record._id && !savedIds.has(record._id));
    if (removedRecords.length > 0) {
      await Promise.all(removedRecords.map(record => FoodIntakeRecordModel.deleteFoodIntake(record._id)));
    }
    await DailySummaryV2Model.markDirty(babyUid, this.data.selectedDate);
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
    if (this.data.currentFoodDraft.food) {
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

    const completionResult = validateCompletionPercent(this.data.completionPercent);
    if (!completionResult.valid) {
      wx.showToast({ title: completionResult.message, icon: 'none' });
      return;
    }
    if (completionResult.value !== this.data.completionPercent) {
      this.setData({ completionPercent: completionResult.value });
    }

    const mealBatchId = this.data.editMealBatchId || `meal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mealIntakes = this.buildMealIntakes(mealBatchId);

    this.setData({ isSaving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    try {
      if (this.isV2RecordSource()) {
        await this.saveV2Meal(babyUid, mealBatchId, mealIntakes);
        wx.hideLoading();
        wx.showToast({ title: this.data.mode === 'edit' ? '已更新本顿' : '已保存本顿', icon: 'success' });
        await this.notifyPreviousPageRefresh();
        setTimeout(() => {
          wx.navigateBack();
        }, 300);
        return;
      }

      const db = wx.cloud.database();
      const mergedRecord = await this.getMergedDayRecord(this.data.selectedDate, babyUid);
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const existingIntakes = dedupeIntakes([...(mergedRecord?.intakes || [])]);
      const remainingIntakes = this.data.mode === 'edit'
        ? existingIntakes.filter(item => item.mealBatchId !== mealBatchId)
        : existingIntakes;
      const updatedIntakes = [...mealIntakes, ...remainingIntakes];

      const targetId = mergedRecord?._id || (await findOrCreateDailyRecord(this.data.selectedDate, babyUid)).recordId;
      await db.collection('feeding_records').doc(targetId).update({
        data: {
          date: startOfDay,
          basicInfo: mergedRecord?.basicInfo || {},
          feedings: mergedRecord?.feedings || [],
          intakes: updatedIntakes,
          updatedAt: db.serverDate()
        }
      });

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
