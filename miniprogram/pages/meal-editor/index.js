const FoodModel = require('../../models/food');
const { getBabyUid } = require('../../utils/index');

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
    foodCatalog: [],
    foodCategories: [],
    activeCategory: 'recent',
    recentFoodOptions: [],
    filteredFoodOptions: [],
    foodSearchQuery: '',
    drawerVisible: false,
    drawerStep: 'select',
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
    await this.loadFoodCatalog();
    if (editMealBatchId) {
      await this.loadExistingMeal(editMealBatchId);
    }
    this.hasLoadedCatalog = true;
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

    this.setData({ filteredFoodOptions: filtered });
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
      foodSearchQuery: ''
    }, () => {
      this.filterFoodOptions('');
    });
  },

  openFoodDrawer() {
    this.setData({
      drawerVisible: true,
      drawerStep: this.data.currentFoodDraft.food ? 'edit' : 'select'
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

    this.setData({
      drawerStep: 'edit',
      currentFoodDraft: {
        foodId: food._id,
        food,
        quantity: '',
        unit: food.baseUnit || 'g',
        nutritionPreview: null,
        notes: ''
      }
    });
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
      drawerStep: 'select'
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

  onDraftNotesInput(e) {
    this.setData({
      'currentFoodDraft.notes': e.detail.value || ''
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
      naturalProtein: roundNumber(naturalProtein, 2),
      specialProtein: roundNumber(specialProtein, 2),
      milkType: food.milkType || '',
      notes: String(notes || '').trim()
    };
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
      mealSummary: calculateMealSummary(nextItems),
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
        mealSummary: calculateMealSummary(items)
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
      nameSnapshot: item.nameSnapshot,
      unit: item.unit || 'g',
      quantity: item.quantity,
      proteinSource: item.proteinSource || 'natural',
      proteinQuality: item.proteinQuality || '',
      nutrition: item.nutrition || {},
      naturalProtein: item.naturalProtein || 0,
      specialProtein: item.specialProtein || 0,
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

    const mealBatchId = this.data.editMealBatchId || `meal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mealIntakes = this.buildMealIntakes(mealBatchId);

    this.setData({ isSaving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    try {
      const db = wx.cloud.database();
      const mergedRecord = await this.getMergedDayRecord(this.data.selectedDate, babyUid);
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const existingIntakes = dedupeIntakes([...(mergedRecord?.intakes || [])]);
      const remainingIntakes = this.data.mode === 'edit'
        ? existingIntakes.filter(item => item.mealBatchId !== mealBatchId)
        : existingIntakes;
      const updatedIntakes = [...mealIntakes, ...remainingIntakes];

      if (mergedRecord?._id) {
        await db.collection('feeding_records').doc(mergedRecord._id).update({
          data: {
            date: startOfDay,
            basicInfo: mergedRecord.basicInfo || {},
            feedings: mergedRecord.feedings || [],
            intakes: updatedIntakes,
            updatedAt: db.serverDate()
          }
        });
      } else {
        await db.collection('feeding_records').add({
          data: {
            date: startOfDay,
            basicInfo: {},
            feedings: [],
            intakes: updatedIntakes,
            medicationRecords: [],
            summary: {},
            babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }

      wx.hideLoading();
      wx.showToast({ title: this.data.mode === 'edit' ? '已更新本顿' : '已保存本顿', icon: 'success' });
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
