const FoodModel = require('../../models/food');
const FoodCategoryModel = require('../../models/foodCategory');
const MealCombinationModel = require('../../models/mealCombination');
const { waitForAppInitialization, getBabyUid, handleError } = require('../../utils/index');
const DEFAULT_CATEGORY_SUGGESTIONS = [
  '主食及谷薯',
  '蔬菜类',
  '水果类',
  '肉禽类',
  '水产类',
  '乳类及制品',
  '蛋类',
  '豆制品',
  '婴幼儿辅食',
  '零食',
  '饮品',
  '甜品',
  '油脂及调味品'
];
const NUTRITION_NUMBER_FIELDS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sodium'];
const PREMIUM_PROTEIN_CATEGORY_KEYWORDS = ['肉', '禽', '鱼', '虾', '蟹', '贝', '水产', '蛋', '乳', '奶', '豆'];
const REGULAR_PROTEIN_CATEGORY_KEYWORDS = ['主食', '谷', '薯', '蔬菜', '水果', '辅食', '零食', '饮品', '甜品'];

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

const DEFAULT_UNIT_SUGGESTIONS = ['g', 'ml', '袋', '勺', '份'];
const FOOD_PLACEHOLDER_IMAGE = '/images/LemonLogo.png';

const createEmptyFormData = (category = '', unit = '') => ({
  name: '',
  category,
  categoryLevel2: '',
  unit,
  baseQuantity: '100',
  calories: '',
  image: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sodium: '',
  proteinTypeIndex: -1
});

const app = getApp();

function getOperatorOpenid() {
  return app.globalData.openid || wx.getStorageSync('openid') || '';
}

Page({
  data: {
    loading: false,
    activeManageTab: 'food',
    foods: [],
    groupedFoods: [],
    searchQuery: '',
    filteredFoodCount: 0,
    activeCategory: '',
    activeFoods: [],
    categoryNavScrollIntoView: '',
    foodPanelScrollTop: 0,
    showAddModal: false,
    formData: createEmptyFormData(),
    energyKjInput: '',
    foodImagePreviewUrl: '',
    uploadingFoodImage: false,
    categoryPickerIndex: 0,
    unitPickerIndex: 0,
    proteinTypeOptions: [
      { label: '天然蛋白（优质）', value: 'natural', quality: 'premium' },
      { label: '天然蛋白（普通）', value: 'natural', quality: 'regular' },
      { label: '特殊蛋白', value: 'special', quality: '' }
    ],
    categorySuggestions: [...DEFAULT_CATEGORY_SUGGESTIONS],
    customCategories: [],
    customCategoryInput: '',
    showCategoryCreator: false,
    unitSuggestions: [...DEFAULT_UNIT_SUGGESTIONS],
    customUnitInput: '',
    showUnitCreator: false,
    proteinTypeTouched: false,
    proteinTypeRecommendationText: '',
    babyUid: '',
    editingFoodId: '',
    editingFoodName: '',
    mealCombinations: [],
    combinationLoading: false,
    showCombinationModal: false,
    combinationModalStep: 'select',
    combinationEditingId: '',
    combinationForm: {
      name: '',
      items: []
    },
    pendingCombinationItems: [],
    combinationFoodPickerOptions: [],
    combinationFoodPickerIndex: 0,
    combinationFoodSearchQuery: '',
    combinationFoodCategory: '全部',
    combinationFoodCategories: ['全部'],
    filteredCombinationFoodOptions: [],
    foodPlaceholderImage: FOOD_PLACEHOLDER_IMAGE
  },

  async onLoad(options = {}) {
    try {
      this.shouldOpenAddModal = options.openAdd === '1';
      const initialTab = ['food', 'combination'].includes(options.tab) ? options.tab : 'food';
      await waitForAppInitialization();
      const babyUid = getBabyUid();

      this.setData({
        babyUid: babyUid || '',
        activeManageTab: initialTab
      });

      await this.loadCustomCategories();
      await this.loadFoods();
      await this.loadMealCombinations();
      if (this.shouldOpenAddModal) {
        this.shouldOpenAddModal = false;
        this.showAddModal();
      }
    } catch (error) {
      handleError(error, { title: '加载食物失败' });
    }
  },

  async onShow() {
    await this.loadCustomCategories();
    if (this.data.activeManageTab === 'combination') {
      await this.loadMealCombinations();
    }
  },

  switchManageTab(e) {
    const { tab } = e.currentTarget.dataset || {};
    if (!['food', 'combination'].includes(tab)) return;
    this.setData({ activeManageTab: tab });
    if (tab === 'combination') {
      this.loadMealCombinations();
    }
  },

  async loadFoods() {
    try {
      await waitForAppInitialization();
      this.setData({ loading: true });
      const babyUid = this.data.babyUid || getBabyUid();
      this.setData({ babyUid: babyUid || '' });
      const foodsFromDb = await FoodModel.getAvailableFoods(babyUid);
      const foodsWithImageUrls = await FoodModel.resolveFoodImageUrls(foodsFromDb || []);

      const mergedFoods = (foodsWithImageUrls || [])
        .filter(item => !!item && !!item._id)
        .map(food => {
          const normalizedCategory = this.normalizeCategoryValue(
            food.category || food.categoryLevel1
          );
          return {
            ...food,
            category: normalizedCategory,
            categoryLevel1: normalizedCategory,
            categoryLevel2: food.categoryLevel2 || '',
            isSystem: !!food.isSystem,
            isCustom: !food.isSystem,
            baseUnit: food.baseUnit || 'g',
            baseQuantity: Number(food.baseQuantity) || 100,
            image: food.image || '',
            displayImage: food.imageUrl || food.image || FOOD_PLACEHOLDER_IMAGE,
            nutritionPerUnit: food.nutritionPerUnit || {
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              fiber: 0,
              sodium: 0
            },
            proteinSource: food.proteinSource || 'natural'
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const existingCategories = Array.from(
        new Set(
          mergedFoods.map(item => item.category || (DEFAULT_CATEGORY_SUGGESTIONS[0] || '主食及谷薯'))
        )
      );
      const existingUnits = Array.from(
        new Set(
          mergedFoods.map(item => (item.baseUnit || '').toString().trim()).filter(Boolean)
        )
      );
      const categorySuggestions = this.mergeCategorySuggestions(existingCategories);
      const unitSuggestions = this.mergeUnitSuggestions(existingUnits);
      const combinationFoodCategories = this.buildCombinationFoodCategories(mergedFoods);
      const combinationFoodCategory = combinationFoodCategories.includes(this.data.combinationFoodCategory)
        ? this.data.combinationFoodCategory
        : '全部';

      this.setData({
        foods: mergedFoods,
        combinationFoodPickerOptions: mergedFoods,
        combinationFoodCategories,
        combinationFoodCategory,
        filteredCombinationFoodOptions: this.getFilteredCombinationFoodOptions(mergedFoods, {
          category: combinationFoodCategory,
          searchQuery: this.data.combinationFoodSearchQuery,
          selectedItems: this.data.pendingCombinationItems || this.data.combinationForm?.items || []
        }),
        categorySuggestions,
        categoryPickerIndex: this.getCategoryPickerIndex(
          this.data.formData?.category || '',
          categorySuggestions
        ),
        unitSuggestions,
        unitPickerIndex: this.getUnitPickerIndex(this.data.formData?.unit || '', unitSuggestions)
      });
      this.updateGroupedFoods(mergedFoods, {
        searchQuery: this.data.searchQuery
      });
    } catch (error) {
      console.error('加载食物数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMealCombinations() {
    const babyUid = this.data.babyUid || getBabyUid();
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
      const combinationsWithNutrition = (combinations || []).map(combination => ({
        ...combination,
        nutritionSummary: this.buildCombinationNutritionSummary(combination)
      }));
      this.setData({
        mealCombinations: combinationsWithNutrition,
        combinationLoading: false
      });
      return combinationsWithNutrition;
    } catch (error) {
      console.error('加载菜谱失败:', error);
      this.setData({
        mealCombinations: [],
        combinationLoading: false
      });
      wx.showToast({ title: '菜谱加载失败', icon: 'none' });
      return [];
    }
  },

  async loadCustomCategories() {
    try {
      const babyUid = this.data.babyUid || getBabyUid();
      if (!babyUid) {
        this.setData({
          customCategories: [],
          categorySuggestions: [...DEFAULT_CATEGORY_SUGGESTIONS],
          unitSuggestions: [...DEFAULT_UNIT_SUGGESTIONS],
          unitPickerIndex: this.getUnitPickerIndex(
            this.data.formData?.unit || '',
            [...DEFAULT_UNIT_SUGGESTIONS]
          )
        });
        return;
      }

      const categoriesFromDb = await FoodCategoryModel.getCategories(babyUid);
      const normalizedNames = Array.from(
        new Set(
          (categoriesFromDb || [])
            .map(item => this.normalizeCategoryValue(item?.name || ''))
            .filter(Boolean)
        )
      );

      const suggestions = this.mergeCategorySuggestions(normalizedNames, {
        customCategories: normalizedNames
      });

      this.setData({
        customCategories: normalizedNames,
        categorySuggestions: suggestions,
        categoryPickerIndex: this.getCategoryPickerIndex(this.data.formData?.category || '', suggestions)
      });
    } catch (error) {
      console.warn('加载自定义分类失败:', error);
      this.setData({
        customCategories: [],
        categorySuggestions: [...DEFAULT_CATEGORY_SUGGESTIONS],
        categoryPickerIndex: this.getCategoryPickerIndex(
          this.data.formData?.category || '',
          [...DEFAULT_CATEGORY_SUGGESTIONS]
        ),
        unitSuggestions: [...DEFAULT_UNIT_SUGGESTIONS],
        unitPickerIndex: this.getUnitPickerIndex(
          this.data.formData?.unit || '',
          [...DEFAULT_UNIT_SUGGESTIONS]
        )
      });
    }
  },

  groupFoodsByCategory(foods = []) {
    const groups = {};
    foods.forEach(food => {
      const category = this.normalizeCategoryValue(food.category);
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(food);
    });

    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map((category, index) => ({
        navId: `food-category-${index}`,
        category,
        items: groups[category].sort((a, b) => a.name.localeCompare(b.name))
      }));
  },

  buildFoodSearchText(food = {}) {
    return [
      food.name || '',
      food.category || '',
      food.categoryLevel1 || '',
      food.categoryLevel2 || '',
      food.aliasText || '',
      Array.isArray(food.alias) ? food.alias.join(' ') : (food.alias || '')
    ].join(' ');
  },

  matchesFoodSearch(food, query = '') {
    const normalized = normalizeSearchText(query);
    if (!normalized) return true;
    return fuzzyIncludes(this.buildFoodSearchText(food), normalized);
  },

  filterFoods(foods = [], query = '') {
    const normalized = normalizeSearchText(query);
    if (!normalized) {
      return foods;
    }

    return foods.filter(food => this.matchesFoodSearch(food, normalized));
  },

  buildCombinationFoodCategories(foods = []) {
    const categories = Array.from(
      new Set(
        (foods || [])
          .map(food => this.normalizeCategoryValue(food.category || food.categoryLevel1 || ''))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    return ['全部', ...categories];
  },

  getFilteredCombinationFoodOptions(foods = this.data.combinationFoodPickerOptions || [], options = {}) {
    const category = options.category !== undefined ? options.category : this.data.combinationFoodCategory;
    const searchQuery = options.searchQuery !== undefined ? options.searchQuery : this.data.combinationFoodSearchQuery;
    const selectedItems = options.selectedItems || this.data.pendingCombinationItems || this.data.combinationForm?.items || [];
    const selectedIds = new Set((selectedItems || []).map(item => item.foodId).filter(Boolean));
    const normalizedCategory = category && category !== '全部' ? this.normalizeCategoryValue(category) : '全部';
    const normalizedQuery = normalizeSearchText(searchQuery || '');

    return (foods || [])
      .filter(food => {
        const foodCategory = this.normalizeCategoryValue(food.category || food.categoryLevel1 || '');
        const categoryMatched = normalizedCategory === '全部' || foodCategory === normalizedCategory;
        const searchMatched = !normalizedQuery || this.matchesFoodSearch(food, normalizedQuery);
        return categoryMatched && searchMatched;
      })
      .map(food => ({
        ...food,
        isInCombination: selectedIds.has(food._id || food.id || '')
      }));
  },

  updateCombinationFoodSelector(options = {}) {
    const foods = this.data.combinationFoodPickerOptions || [];
    const categories = this.buildCombinationFoodCategories(foods);
    const requestedCategory =
      options.category !== undefined ? options.category : (this.data.combinationFoodCategory || '全部');
    const category = categories.includes(requestedCategory) ? requestedCategory : '全部';
    const searchQuery =
      options.searchQuery !== undefined ? options.searchQuery : (this.data.combinationFoodSearchQuery || '');

    this.setData({
      combinationFoodCategories: categories,
      combinationFoodCategory: category,
      combinationFoodSearchQuery: searchQuery,
      filteredCombinationFoodOptions: this.getFilteredCombinationFoodOptions(foods, {
        category,
        searchQuery,
        selectedItems: this.data.pendingCombinationItems || this.data.combinationForm?.items || []
      })
    });
  },

  getNextActiveCategory(groupedFoods = [], preferredCategory = '') {
    if (!groupedFoods.length) {
      return '';
    }

    const candidate = preferredCategory || this.data.activeCategory || '';
    const matchedGroup = groupedFoods.find(group => group.category === candidate);
    if (matchedGroup) {
      return matchedGroup.category;
    }

    return groupedFoods[0].category;
  },

  updateGroupedFoods(foods = this.data.foods || [], options = {}) {
    const searchQuery =
      options.searchQuery !== undefined ? options.searchQuery : (this.data.searchQuery || '');
    const filteredFoods = this.filterFoods(foods, searchQuery);
    const filteredGroups = this.groupFoodsByCategory(filteredFoods);
    const activeCategory = this.getNextActiveCategory(
      filteredGroups,
      options.activeCategory !== undefined ? options.activeCategory : this.data.activeCategory
    );
    const activeGroup = filteredGroups.find(group => group.category === activeCategory);

    this.setData({
      groupedFoods: filteredGroups,
      filteredFoodCount: filteredFoods.length,
      searchQuery,
      activeCategory,
      activeFoods: activeGroup ? activeGroup.items : [],
      categoryNavScrollIntoView: activeGroup ? activeGroup.navId : '',
      foodPanelScrollTop: 0
    });
  },

  normalizeCategoryValue(value) {
    const text = (value || '').toString().trim();
    if (!text) {
      return DEFAULT_CATEGORY_SUGGESTIONS[0] || '主食及谷薯';
    }
    const lower = text.toLowerCase();
    if (lower === 'milk' || text === '奶类') return '乳类及制品';
    if (lower === 'food') return DEFAULT_CATEGORY_SUGGESTIONS[0] || '主食及谷薯';
    if (text === '辅食') return '婴幼儿辅食';
    return text;
  },

  mergeCategorySuggestions(additionalCategories = [], options = {}) {
    const customCategories = Array.isArray(options.customCategories)
      ? options.customCategories
      : (this.data.customCategories || []);

    const suggestions = new Set([
      ...DEFAULT_CATEGORY_SUGGESTIONS.map(item => this.normalizeCategoryValue(item)),
      ...customCategories.map(item => this.normalizeCategoryValue(item))
    ]);

    (additionalCategories || []).forEach(cat => {
      if (cat) {
        suggestions.add(this.normalizeCategoryValue(cat));
      }
    });

    return Array.from(suggestions);
  },

  getDefaultCategory() {
    return '';
  },

  getCategoryPickerIndex(category = '', suggestions = this.data.categorySuggestions || []) {
    if (!category) return 0;
    const normalizedCategory = this.normalizeCategoryValue(category);
    const index = (suggestions || []).findIndex(
      item => this.normalizeCategoryValue(item) === normalizedCategory
    );
    return index >= 0 ? index : 0;
  },

  mergeUnitSuggestions(additionalUnits = []) {
    const suggestions = new Set(DEFAULT_UNIT_SUGGESTIONS);
    (additionalUnits || []).forEach(unit => {
      const normalizedUnit = (unit || '').toString().trim();
      if (normalizedUnit) {
        suggestions.add(normalizedUnit);
      }
    });
    return Array.from(suggestions);
  },

  getUnitPickerIndex(unit = '', suggestions = this.data.unitSuggestions || []) {
    if (!unit) return 0;
    const normalizedUnit = (unit || '').toString().trim();
    const index = (suggestions || []).findIndex(item => item === normalizedUnit);
    return index >= 0 ? index : 0;
  },

  parseNumber(value) {
    if (value === '' || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  },

  roundNumber(value, precision = 2) {
    if (!Number.isFinite(value)) return 0;
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  },

  buildCombinationNutritionSummary(combination = {}) {
    const summary = (combination.items || []).reduce((result, item) => {
      const nutrition = item.plannedNutrition || {};
      result.calories += Number(nutrition.calories) || 0;
      result.protein += Number(nutrition.protein) || 0;
      result.carbs += Number(nutrition.carbs) || 0;
      result.fat += Number(nutrition.fat) || 0;
      return result;
    }, {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    });
    return {
      calories: Math.round(summary.calories),
      protein: this.roundNumber(summary.protein, 2),
      carbs: this.roundNumber(summary.carbs, 2),
      fat: this.roundNumber(summary.fat, 2)
    };
  },

  getProteinTypeOption(index) {
    const option = this.data.proteinTypeOptions?.[index];
    return option || null;
  },

  getProteinTypeOptionIndex(value, quality) {
    return (this.data.proteinTypeOptions || []).findIndex(
      opt => opt.value === value && opt.quality === quality
    );
  },

  inferProteinTypeIndexByCategory(category = '') {
    const normalizedCategory = this.normalizeCategoryValue(category);
    const lower = normalizedCategory.toLowerCase();
    if (lower.includes('特殊') || lower.includes('特奶')) {
      const specialIndex = this.getProteinTypeOptionIndex('special', '');
      return specialIndex >= 0 ? specialIndex : -1;
    }
    if (PREMIUM_PROTEIN_CATEGORY_KEYWORDS.some(keyword => normalizedCategory.includes(keyword))) {
      const premiumIndex = this.getProteinTypeOptionIndex('natural', 'premium');
      return premiumIndex >= 0 ? premiumIndex : -1;
    }
    if (REGULAR_PROTEIN_CATEGORY_KEYWORDS.some(keyword => normalizedCategory.includes(keyword))) {
      const regularIndex = this.getProteinTypeOptionIndex('natural', 'regular');
      return regularIndex >= 0 ? regularIndex : -1;
    }
    return -1;
  },

  applyProteinTypeRecommendation(category = '') {
    if (this.data.proteinTypeTouched) {
      this.setData({ proteinTypeRecommendationText: '' });
      return;
    }
    const index = this.inferProteinTypeIndexByCategory(category);
    const option = this.getProteinTypeOption(index);
    this.setData({
      'formData.proteinTypeIndex': index,
      proteinTypeRecommendationText: option ? `已根据分类推荐：${option.label}` : ''
    });
  },

  buildNutritionPayload(formData) {
    const result = {};
    NUTRITION_NUMBER_FIELDS.forEach(field => {
      const parsed = this.parseNumber(formData[field]);
      result[field] = parsed !== null ? this.roundNumber(parsed, 2) : 0;
    });
    return result;
  },

  prepareFoodPayload(babyUid) {
    const formData = this.data.formData;
    const trimmedName = formData.name.trim();
    const normalizedCategory = this.normalizeCategoryValue(formData.category);
    const baseUnit = (formData.unit || '').trim();
    const baseQuantity = this.parseNumber(formData.baseQuantity) || 100;

    return {
      name: trimmedName,
      category: normalizedCategory,
      categoryLevel1: normalizedCategory,
      categoryLevel2: formData.categoryLevel2 || '',
      baseUnit,
      baseQuantity: baseQuantity,
      nutritionPerUnit: this.buildNutritionPayload(formData),
      proteinSource: this.getProteinTypeOption(formData.proteinTypeIndex).value,
      proteinQuality: this.getProteinTypeOption(formData.proteinTypeIndex).quality,
      foodType: 'food',
      image: formData.image ? formData.image.trim() : '',
      isLiquid: baseUnit.toLowerCase() === 'ml',
      babyUid,
      isSystem: false,
      createdBy: getOperatorOpenid(),
      nutritionSource: 'manual'
    };
  },

  buildFormDataFromFood(food) {
    if (!food) {
      return createEmptyFormData(this.getDefaultCategory(), '');
    }

    const nutrition = food.nutritionPerUnit || {};
    const proteinSource = food.proteinSource || 'natural';
    const proteinQuality = food.proteinQuality || '';
    const typeIndex = this.data.proteinTypeOptions.findIndex(
      opt => opt.value === proteinSource && opt.quality === proteinQuality
    );

    return {
      name: food.name || '',
      category: this.normalizeCategoryValue(food.category),
      categoryLevel2: food.categoryLevel2 || '',
      unit: food.baseUnit || '',
      baseQuantity: String(food.baseQuantity != null ? food.baseQuantity : 100),
      calories: nutrition.calories != null ? String(nutrition.calories) : '',
      image: food.image || '',
      protein: nutrition.protein != null ? String(nutrition.protein) : '',
      carbs: nutrition.carbs != null ? String(nutrition.carbs) : '',
      fat: nutrition.fat != null ? String(nutrition.fat) : '',
      fiber: nutrition.fiber != null ? String(nutrition.fiber) : '',
      sodium: nutrition.sodium != null ? String(nutrition.sodium) : '',
      proteinTypeIndex: typeIndex >= 0 ? typeIndex : -1
    };
  },

  showAddModal() {
    if (!this.data.babyUid) {
      wx.showToast({
        title: '请先完成宝宝信息',
        icon: 'none'
      });
      return;
    }

    this.setData({
      showAddModal: true,
      energyKjInput: '',
      foodImagePreviewUrl: '',
      customCategoryInput: '',
      customUnitInput: '',
      showCategoryCreator: false,
      showUnitCreator: false,
      editingFoodId: '',
      editingFoodName: '',
      categoryPickerIndex: 0,
      unitPickerIndex: 0,
      proteinTypeTouched: false,
      proteinTypeRecommendationText: '',
      formData: createEmptyFormData('', '')
    });
  },

  showEditModal(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;

    const target = (this.data.foods || []).find(item => item._id === id);
    if (!target) {
      wx.showToast({ title: '未找到食物', icon: 'none' });
      return;
    }
    if (target.isSystem) {
      wx.showToast({ title: '系统预设无法编辑', icon: 'none' });
      return;
    }

    const formData = this.buildFormDataFromFood(target);
    this.setData({
      showAddModal: true,
      editingFoodId: target._id,
      editingFoodName: target.name || '',
      energyKjInput: '',
      foodImagePreviewUrl: target.displayImage || target.image || '',
      customCategoryInput: '',
      customUnitInput: '',
      showCategoryCreator: false,
      showUnitCreator: false,
      categoryPickerIndex: this.getCategoryPickerIndex(formData.category),
      unitPickerIndex: this.getUnitPickerIndex(formData.unit),
      proteinTypeTouched: true,
      proteinTypeRecommendationText: '',
      formData
    });
  },

  hideAddModal() {
    this.setData({
      showAddModal: false,
      energyKjInput: '',
      foodImagePreviewUrl: '',
      uploadingFoodImage: false,
      editingFoodId: '',
      editingFoodName: '',
      customCategoryInput: '',
      customUnitInput: '',
      showCategoryCreator: false,
      showUnitCreator: false,
      categoryPickerIndex: 0,
      unitPickerIndex: 0,
      proteinTypeTouched: false,
      proteinTypeRecommendationText: '',
      formData: createEmptyFormData('', '')
    });
  },

  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({
      [`formData.${field}`]: e.detail.value
    });
  },

  onEnergyKjInput(e) {
    this.setData({
      energyKjInput: e.detail.value || ''
    });
  },

  applyKjToKcal() {
    const kjValue = this.parseNumber(this.data.energyKjInput);
    if (kjValue === null || kjValue < 0) {
      wx.showToast({ title: '请填写有效的 kJ 数值', icon: 'none' });
      return;
    }

    const kcalValue = this.roundNumber(kjValue / 4.184, 2);
    this.setData({
      'formData.calories': String(kcalValue)
    });
    wx.showToast({ title: '已换算为 kcal', icon: 'success' });
  },

  async chooseFoodImage() {
    if (this.data.uploadingFoodImage) {
      return;
    }

    try {
      const chooseRes = await new Promise((resolve, reject) => {
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject
        });
      });
      const tempFilePath = chooseRes?.tempFilePaths?.[0];
      if (!tempFilePath) {
        return;
      }

      await this.uploadFoodImageToCloud(tempFilePath);
    } catch (error) {
      if (error && /cancel/i.test(error.errMsg || '')) {
        return;
      }
      handleError(error, { title: '选择图片失败' });
    }
  },

  async uploadFoodImageToCloud(tempFilePath) {
    const babyUid = this.data.babyUid || getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '缺少宝宝信息，无法上传', icon: 'none' });
      return;
    }

    try {
      this.setData({
        uploadingFoodImage: true,
        foodImagePreviewUrl: tempFilePath,
        'formData.image': tempFilePath
      });
      wx.showLoading({ title: '上传中...', mask: true });

      const extMatch = (tempFilePath || '').match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '.jpg';
      const cloudPath = `food_images/${babyUid}_${Date.now()}${ext}`;
      const result = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        config: {
          env: app.globalData.cloudEnvId
        }
      });

      if (!result?.fileID) {
        throw new Error('图片上传失败');
      }

      wx.hideLoading();
      this.setData({
        uploadingFoodImage: false,
        foodImagePreviewUrl: tempFilePath,
        'formData.image': result.fileID
      });
      wx.showToast({ title: '图片已上传', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      this.setData({
        uploadingFoodImage: false,
        foodImagePreviewUrl: '',
        'formData.image': ''
      });
      handleError(error, { title: '图片上传失败', hideLoading: false });
    }
  },

  clearFoodImage() {
    this.setData({
      foodImagePreviewUrl: '',
      'formData.image': ''
    });
  },

  previewFoodImage(e) {
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

  onCategoryPickerChange(e) {
    const index = Number(e.detail.value);
    const value = this.data.categorySuggestions?.[index] || '';
    this.setData({
      categoryPickerIndex: index,
      'formData.category': value ? this.normalizeCategoryValue(value) : ''
    }, () => {
      this.applyProteinTypeRecommendation(this.data.formData.category);
    });
  },

  toggleCategoryCreator() {
    this.setData({
      showCategoryCreator: !this.data.showCategoryCreator
    });
  },

  onUnitPickerChange(e) {
    const index = Number(e.detail.value);
    const value = this.data.unitSuggestions?.[index] || '';
    this.setData({
      unitPickerIndex: index,
      'formData.unit': value
    });
  },

  toggleUnitCreator() {
    this.setData({
      showUnitCreator: !this.data.showUnitCreator
    });
  },

  onCustomUnitInput(e) {
    this.setData({
      customUnitInput: e.detail.value
    });
  },

  addCustomUnit() {
    const value = (this.data.customUnitInput || '').trim();
    if (!value) {
      wx.showToast({ title: '请输入单位名称', icon: 'none' });
      return;
    }

    const currentSuggestions = this.mergeUnitSuggestions(this.data.unitSuggestions || []);
    if (currentSuggestions.includes(value)) {
      this.setData({
        customUnitInput: '',
        showUnitCreator: false,
        unitPickerIndex: this.getUnitPickerIndex(value, currentSuggestions),
        'formData.unit': value,
        unitSuggestions: currentSuggestions
      });
      wx.showToast({ title: '单位已存在', icon: 'none' });
      return;
    }

    const nextSuggestions = this.mergeUnitSuggestions([...(this.data.unitSuggestions || []), value]);
    this.setData({
      unitSuggestions: nextSuggestions,
      customUnitInput: '',
      showUnitCreator: false,
      unitPickerIndex: this.getUnitPickerIndex(value, nextSuggestions),
      'formData.unit': value
    });
    wx.showToast({ title: '单位已添加', icon: 'success' });
  },

  onCustomCategoryInput(e) {
    this.setData({
      customCategoryInput: e.detail.value
    });
  },

  async addCustomCategory() {
    const value = (this.data.customCategoryInput || '').trim();
    if (!value) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' });
      return;
    }

    const normalizedValue = this.normalizeCategoryValue(value);

    const currentCustom = Array.isArray(this.data.customCategories)
      ? this.data.customCategories
      : [];
    if (currentCustom.includes(normalizedValue)) {
      wx.showToast({ title: '分类已存在', icon: 'none' });
      this.setData({
        customCategoryInput: '',
        showCategoryCreator: false,
        categoryPickerIndex: this.getCategoryPickerIndex(normalizedValue),
        'formData.category': normalizedValue
      }, () => {
        this.applyProteinTypeRecommendation(normalizedValue);
      });
      return;
    }

    const babyUid = this.data.babyUid || getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '缺少宝宝信息，无法添加', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '添加中...', mask: true });
      await FoodCategoryModel.addCategory(normalizedValue, {
        babyUid,
        createdBy: getOperatorOpenid()
      });
      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '保存分类失败' });
      return;
    }

    await this.loadCustomCategories();

    this.setData({
      customCategoryInput: '',
      showCategoryCreator: false,
      categoryPickerIndex: this.getCategoryPickerIndex(normalizedValue),
      'formData.category': normalizedValue
    }, () => {
      this.applyProteinTypeRecommendation(normalizedValue);
    });

    wx.showToast({ title: '分类已添加', icon: 'success' });
  },

  onProteinTypeChange(e) {
    this.setData({
      'formData.proteinTypeIndex': Number(e.detail.value),
      proteinTypeTouched: true,
      proteinTypeRecommendationText: ''
    });
  },

  validateForm() {
    const formData = this.data.formData;
    if (!formData.name.trim()) {
      wx.showToast({ title: '请填写食物名称', icon: 'none' });
      return false;
    }
    if (!formData.category.trim()) {
      wx.showToast({ title: '请填写分类', icon: 'none' });
      return false;
    }
    if (!formData.unit.trim()) {
      wx.showToast({ title: '请填写单位', icon: 'none' });
      return false;
    }
    if (!this.getProteinTypeOption(formData.proteinTypeIndex)) {
      wx.showToast({ title: '请选择蛋白来源，会影响蛋白占比统计', icon: 'none' });
      return false;
    }

    const baseQty = this.parseNumber(formData.baseQuantity);
    if (baseQty === null || baseQty <= 0) {
      wx.showToast({ title: '基础份量必须大于0', icon: 'none' });
      return false;
    }
    const caloriesVal = this.parseNumber(formData.calories);
    if (caloriesVal === null || caloriesVal < 0) {
      wx.showToast({ title: '请填写热量', icon: 'none' });
      return false;
    }

    const requiredNutritionNumbers = [
      { label: '蛋白质', value: formData.protein },
      { label: '脂肪', value: formData.fat },
      { label: '碳水', value: formData.carbs }
    ];

    for (const item of requiredNutritionNumbers) {
      const parsed = this.parseNumber(item.value);
      if (parsed === null || parsed < 0) {
        wx.showToast({ title: `请填写${item.label}`, icon: 'none' });
        return false;
      }
    }

    const optionalNumbers = [
      { label: '膳食纤维', value: formData.fiber },
      { label: '钠', value: formData.sodium }
    ];

    for (const item of optionalNumbers) {
      if (item.value !== '' && this.parseNumber(item.value) === null) {
        wx.showToast({ title: `请正确填写${item.label}`, icon: 'none' });
        return false;
      }
    }

    return true;
  },

  async saveFood() {
    if (!this.validateForm()) {
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const babyUid = this.data.babyUid || getBabyUid();
      if (!babyUid) {
        throw new Error('未找到宝宝信息，无法保存食物');
      }

      const newFood = this.prepareFoodPayload(babyUid);

      const editingId = this.data.editingFoodId;
      const operatorOpenid = getOperatorOpenid();

      if (editingId) {
        const { createdBy, babyUid: payloadBabyUid, ...updatePayload } = newFood;
        await FoodModel.updateFood(editingId, {
          ...updatePayload,
          operatorOpenid
        }, babyUid);
      } else {
        await FoodModel.createFood({
          ...newFood,
          operatorOpenid
        });
      }

      try {
        await FoodCategoryModel.addCategory(newFood.category, {
          babyUid,
          createdBy: operatorOpenid
        });
        await this.loadCustomCategories();
      } catch (categoryError) {
        console.warn('同步分类到云端失败:', categoryError);
      }

      wx.hideLoading();
      wx.showToast({
        title: editingId ? '更新成功' : '添加成功',
        icon: 'success'
      });

      this.hideAddModal();
      await this.loadFoods();
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '保存失败' });
    }
  },

  buildCombinationFormItem(item = {}) {
    return {
      ...item,
      foodName: item.foodName || item.nameSnapshot || item.foodSnapshot?.name || '',
      plannedQuantity: this.parseNumber(item.plannedQuantity) || 0,
      quantityInput: String(item.plannedQuantity !== undefined ? item.plannedQuantity : ''),
      unit: item.unit || item.foodSnapshot?.baseUnit || 'g',
      plannedNutrition: { ...(item.plannedNutrition || {}) },
      foodSnapshot: item.foodSnapshot || {},
      food: item.food || null
    };
  },

  buildCombinationFoodSnapshot(food = {}) {
    const snapshot = {
      name: food.name || '',
      category: food.category || food.categoryLevel1 || '',
      proteinSource: food.proteinSource || '',
      baseQuantity: Number(food.baseQuantity) || 100,
      baseUnit: food.baseUnit || 'g',
      nutritionPerUnit: { ...(food.nutritionPerUnit || {}) },
      proteinQuality: food.proteinQuality || '',
      milkType: food.milkType || ''
    };
    if (food.nutritionPer100g) {
      snapshot.nutritionPer100g = { ...food.nutritionPer100g };
    }
    if (food.proteinSplit) {
      snapshot.proteinSplit = { ...food.proteinSplit };
    }
    return snapshot;
  },

  buildCombinationFormItemFromFood(food = {}) {
    return this.buildCombinationFormItem({
      foodId: food._id || food.id || '',
      foodName: food.name || '',
      foodSnapshot: this.buildCombinationFoodSnapshot(food),
      plannedQuantity: '',
      unit: food.baseUnit || 'g',
      plannedNutrition: {},
      food
    });
  },

  showCreateCombinationModal() {
    this.setData({
      showCombinationModal: true,
      combinationModalStep: 'select',
      combinationEditingId: '',
      combinationFoodPickerIndex: 0,
      combinationFoodSearchQuery: '',
      combinationFoodCategory: '全部',
      pendingCombinationItems: [],
      combinationForm: {
        name: '',
        items: []
      }
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  showCombinationEditModal(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    const target = (this.data.mealCombinations || []).find(item => (item._id || item.id) === id);
    if (!target) {
      wx.showToast({ title: '未找到菜谱', icon: 'none' });
      return;
    }
    const existingItems = (target.items || []).map(item => this.buildCombinationFormItem(item));

    this.setData({
      showCombinationModal: true,
      combinationModalStep: 'quantity',
      combinationEditingId: target._id || target.id || '',
      combinationFoodSearchQuery: '',
      combinationFoodCategory: '全部',
      pendingCombinationItems: existingItems,
      combinationForm: {
        name: target.name || '',
        items: existingItems
      }
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  hideCombinationModal() {
    this.setData({
      showCombinationModal: false,
      combinationModalStep: 'select',
      combinationEditingId: '',
      combinationFoodSearchQuery: '',
      combinationFoodCategory: '全部',
      pendingCombinationItems: [],
      combinationForm: {
        name: '',
        items: []
      }
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  onCombinationFormNameInput(e) {
    this.setData({
      'combinationForm.name': e.detail.value || ''
    });
  },

  onCombinationItemQuantityInput(e) {
    const { index } = e.currentTarget.dataset || {};
    const itemIndex = Number(index);
    if (!Number.isInteger(itemIndex) || itemIndex < 0) return;
    const quantityInput = e.detail.value || '';
    const items = [...(this.data.combinationForm.items || [])];
    if (!items[itemIndex]) return;
    items[itemIndex] = {
      ...items[itemIndex],
      quantityInput
    };
    this.setData({
      'combinationForm.items': items,
      pendingCombinationItems: items
    });
  },

  onCombinationFoodPickerChange(e) {
    const pickerIndex = Number(e.detail.value);
    if (!Number.isInteger(pickerIndex) || pickerIndex < 0) return;
    const food = (this.data.combinationFoodPickerOptions || [])[pickerIndex];
    if (!food) return;

    const exists = (this.data.combinationForm.items || []).some(item => item.foodId === food._id);
    if (exists) {
      wx.showToast({ title: '这个食物已在菜谱里', icon: 'none' });
      return;
    }

    this.setData({
      combinationFoodPickerIndex: pickerIndex,
      pendingCombinationItems: [
        ...(this.data.pendingCombinationItems || []),
        this.buildCombinationFormItemFromFood(food)
      ]
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  onCombinationFoodSearchInput(e) {
    this.updateCombinationFoodSelector({
      searchQuery: e.detail.value || ''
    });
  },

  switchCombinationFoodCategory(e) {
    const { category } = e.currentTarget.dataset || {};
    if (!category) return;
    this.updateCombinationFoodSelector({ category });
  },

  onCombinationFoodOptionTap(e) {
    const { id } = e.currentTarget.dataset || {};
    if (!id) return;
    const food = (this.data.combinationFoodPickerOptions || []).find(item => (item._id || item.id) === id);
    if (!food) return;

    const pendingItems = [...(this.data.pendingCombinationItems || [])];
    const existingIndex = pendingItems.findIndex(item => item.foodId === id);
    const nextItems = existingIndex >= 0
      ? pendingItems.filter((_, index) => index !== existingIndex)
      : [...pendingItems, this.buildCombinationFormItemFromFood(food)];

    this.setData({
      pendingCombinationItems: nextItems
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  goToCombinationQuantityStep() {
    const pendingItems = this.data.pendingCombinationItems || [];
    if (!pendingItems.length) {
      wx.showToast({ title: '请先选择食物', icon: 'none' });
      return;
    }
    this.setData({
      combinationModalStep: 'quantity',
      'combinationForm.items': pendingItems
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  backToCombinationFoodSelect() {
    this.setData({
      combinationModalStep: 'select',
      pendingCombinationItems: this.data.combinationForm.items || []
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  removeCombinationFormItem(e) {
    const { index } = e.currentTarget.dataset || {};
    const itemIndex = Number(index);
    if (!Number.isInteger(itemIndex) || itemIndex < 0) return;
    const nextItems = (this.data.combinationForm.items || []).filter((_, currentIndex) => currentIndex !== itemIndex);
    this.setData({
      'combinationForm.items': nextItems,
      pendingCombinationItems: nextItems
    }, () => {
      this.updateCombinationFoodSelector();
    });
  },

  scaleCombinationNutrition(item = {}, quantity = 0) {
    if (item.food) {
      const nutrition = FoodModel.calculateNutrition(item.food, quantity);
      return this.addProteinSplitToNutrition(item.food, nutrition);
    }

    const oldQuantity = Number(item.plannedQuantity) || 0;
    const baseNutrition = item.plannedNutrition || {};
    const factor = oldQuantity > 0 ? quantity / oldQuantity : 1;
    return ['calories', 'protein', 'naturalProtein', 'specialProtein', 'carbs', 'fat', 'fiber', 'sodium']
      .reduce((nutrition, field) => {
        nutrition[field] = this.roundNumber((Number(baseNutrition[field]) || 0) * factor, 2);
        return nutrition;
      }, {});
  },

  addProteinSplitToNutrition(food = {}, nutrition = {}) {
    const protein = Number(nutrition.protein) || 0;
    const source = food.proteinSource || 'natural';
    let naturalProtein = protein;
    let specialProtein = 0;

    if (source === 'special') {
      naturalProtein = 0;
      specialProtein = protein;
    } else if (source === 'mixed' && food.proteinSplit) {
      const naturalWeight = Number(food.proteinSplit.natural) || 0;
      const specialWeight = Number(food.proteinSplit.special) || 0;
      const total = naturalWeight + specialWeight || 1;
      naturalProtein = protein * (naturalWeight / total);
      specialProtein = protein * (specialWeight / total);
    } else if (nutrition.naturalProtein !== undefined || nutrition.specialProtein !== undefined) {
      naturalProtein = Number(nutrition.naturalProtein) || 0;
      specialProtein = Number(nutrition.specialProtein) || 0;
    }

    return {
      calories: this.roundNumber(Number(nutrition.calories) || 0, 2),
      protein: this.roundNumber(protein, 2),
      naturalProtein: this.roundNumber(naturalProtein, 2),
      specialProtein: this.roundNumber(specialProtein, 2),
      carbs: this.roundNumber(Number(nutrition.carbs) || 0, 2),
      fat: this.roundNumber(Number(nutrition.fat) || 0, 2),
      fiber: this.roundNumber(Number(nutrition.fiber) || 0, 2),
      sodium: this.roundNumber(Number(nutrition.sodium) || 0, 2)
    };
  },

  buildCombinationSavePayload() {
    const name = String(this.data.combinationForm.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写菜谱名称', icon: 'none' });
      return null;
    }
    const items = (this.data.combinationForm.items || []).map((item, index) => {
      const plannedQuantity = this.parseNumber(item.quantityInput);
      if (plannedQuantity === null || plannedQuantity <= 0) {
        return null;
      }
      return {
        foodId: item.foodId || '',
        foodName: item.foodName || item.foodSnapshot?.name || '',
        foodSnapshot: item.foodSnapshot || {},
        plannedQuantity,
        plannedNutrition: this.scaleCombinationNutrition(item, plannedQuantity),
        unit: item.unit || item.foodSnapshot?.baseUnit || 'g',
        sortOrder: index
      };
    });

    if (!items.length || items.some(item => !item)) {
      wx.showToast({ title: '请填写每种食物的有效份量', icon: 'none' });
      return null;
    }

    return {
      name,
      items
    };
  },

  hasDuplicateMealCombinationName(name = '', editingId = '') {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return false;
    return (this.data.mealCombinations || []).some(item => {
      const currentId = item._id || item.id || '';
      if (editingId && currentId === editingId) return false;
      return String(item.name || '').trim() === normalizedName;
    });
  },

  async saveMealCombinationEdit() {
    const editingId = this.data.combinationEditingId;
    const payload = this.buildCombinationSavePayload();
    if (!payload) return;
    if (this.hasDuplicateMealCombinationName(payload.name, editingId)) {
      wx.showToast({ title: '同名菜谱已存在', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const operatorOpenid = getOperatorOpenid();
      if (editingId) {
        await MealCombinationModel.updateMealCombination(editingId, {
          ...payload,
          operatorOpenid
        });
      } else {
        const babyUid = this.data.babyUid || getBabyUid();
        if (!babyUid) {
          throw new Error('未找到宝宝信息，无法保存菜谱');
        }
        await MealCombinationModel.createMealCombination({
          ...payload,
          babyUid,
          operatorOpenid
        });
      }
      wx.hideLoading();
      wx.showToast({ title: editingId ? '菜谱已更新' : '菜谱已创建', icon: 'success' });
      this.hideCombinationModal();
      await this.loadMealCombinations();
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '保存菜谱失败' });
    }
  },

  onDeleteMealCombination(e) {
    const { id, name } = e.currentTarget.dataset || {};
    if (!id) return;
    wx.showModal({
      title: '删除菜谱',
      content: `确定要删除“${name || '该菜谱'}”吗？删除后不会影响已保存的本顿记录。`,
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: async res => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          await MealCombinationModel.deleteMealCombination(id, {
            babyUid: this.data.babyUid || getBabyUid(),
            operatorOpenid: getOperatorOpenid()
          });
          wx.hideLoading();
          wx.showToast({ title: '菜谱已删除', icon: 'success' });
          await this.loadMealCombinations();
        } catch (error) {
          wx.hideLoading();
          handleError(error, { title: '删除菜谱失败' });
        }
      }
    });
  },

  onSearchInput(e) {
    const query = e.detail.value || '';
    this.updateGroupedFoods(this.data.foods || [], {
      searchQuery: query
    });
  },

  clearSearch() {
    this.updateGroupedFoods(this.data.foods || [], {
      searchQuery: ''
    });
  },

  switchCategory(e) {
    const { category } = e.currentTarget.dataset || {};
    if (!category) return;
    const activeGroup = (this.data.groupedFoods || []).find(group => group.category === category);
    this.setData({
      activeCategory: category,
      activeFoods: activeGroup ? activeGroup.items : [],
      categoryNavScrollIntoView: activeGroup ? activeGroup.navId : '',
      foodPanelScrollTop: 0
    });
  },

  onDeleteFood(e) {
    const { id, name } = e.currentTarget.dataset || {};
    if (!id) {
      return;
    }

    wx.showModal({
      title: '删除食物',
      content: `确定要删除“${name || '该食物'}”吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: async res => {
        if (!res.confirm) return;

        try {
          wx.showLoading({ title: '删除中...' });
          const babyUid = this.data.babyUid || getBabyUid();
          await FoodModel.deleteFood(id, babyUid, {
            operatorOpenid: getOperatorOpenid()
          });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadFoods();
        } catch (error) {
          wx.hideLoading();
          handleError(error, { title: '删除失败' });
        }
      }
    });
  }
});
