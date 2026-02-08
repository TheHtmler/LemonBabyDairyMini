const FoodModel = require('../../models/food');
const FoodCategoryModel = require('../../models/foodCategory');
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

const createEmptyFormData = (category = DEFAULT_CATEGORY_SUGGESTIONS[0] || '主食及谷薯') => ({
  name: '',
  category,
  categoryLevel2: '',
  unit: 'g',
  baseQuantity: '100',
  defaultQuantity: '100',
  calories: '',
  image: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sodium: '',
  proteinSourceIndex: 0
});

const app = getApp();

Page({
  data: {
    loading: false,
    foods: [],
    groupedFoods: [],
    showAddModal: false,
    formData: createEmptyFormData(),
    proteinSourceOptions: [
      { label: '天然蛋白', value: 'natural' },
      { label: '特殊蛋白', value: 'special' }
    ],
    categorySuggestions: [...DEFAULT_CATEGORY_SUGGESTIONS],
    customCategories: [],
    customCategoryInput: '',
    unitSuggestions: ['g', 'ml', '袋', '勺', '份'],
    babyUid: '',
    editingFoodId: '',
    editingFoodName: ''
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      const babyUid = getBabyUid();

      this.setData({
        babyUid: babyUid || ''
      });

      await this.loadCustomCategories();
      await this.loadFoods();
    } catch (error) {
      handleError(error, { title: '加载食物失败' });
    }
  },

  async onShow() {
    await this.loadCustomCategories();
  },

  async loadFoods() {
    try {
      await waitForAppInitialization();
      this.setData({ loading: true });
      const babyUid = this.data.babyUid || getBabyUid();
      this.setData({ babyUid: babyUid || '' });
      const foodsFromDb = await FoodModel.getAvailableFoods(babyUid);

      const mergedFoods = (foodsFromDb || [])
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
            defaultQuantity: Number(food.defaultQuantity || food.baseQuantity || 100),
            image: food.image || '',
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

      const groupedFoods = this.groupFoodsByCategory(mergedFoods);

      const existingCategories = Array.from(
        new Set(
          mergedFoods.map(item => item.category || (DEFAULT_CATEGORY_SUGGESTIONS[0] || '主食及谷薯'))
        )
      );

      this.setData({
        foods: mergedFoods,
        groupedFoods,
        categorySuggestions: this.mergeCategorySuggestions(existingCategories)
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

  async loadCustomCategories() {
    try {
      const babyUid = this.data.babyUid || getBabyUid();
      if (!babyUid) {
        this.setData({
          customCategories: [],
          categorySuggestions: [...DEFAULT_CATEGORY_SUGGESTIONS]
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
        categorySuggestions: suggestions
      });
    } catch (error) {
      console.warn('加载自定义分类失败:', error);
      this.setData({
        customCategories: [],
        categorySuggestions: [...DEFAULT_CATEGORY_SUGGESTIONS]
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
      .map(category => ({
        category,
        items: groups[category].sort((a, b) => a.name.localeCompare(b.name))
      }));
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
    return (
      this.data.categorySuggestions?.[0] ||
      DEFAULT_CATEGORY_SUGGESTIONS[0] ||
      '主食及谷薯'
    );
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

  getProteinSourceValue(index) {
    return this.data.proteinSourceOptions?.[index]?.value || 'natural';
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
    const baseUnit = (formData.unit || '').trim() || 'g';
    const baseQuantity = this.parseNumber(formData.baseQuantity) || 100;
    const defaultQuantityParsed = this.parseNumber(formData.defaultQuantity);
    const defaultQuantity =
      defaultQuantityParsed !== null && defaultQuantityParsed > 0
        ? defaultQuantityParsed
        : baseQuantity;

    return {
      name: trimmedName,
      category: normalizedCategory,
      categoryLevel1: normalizedCategory,
      categoryLevel2: formData.categoryLevel2 || '',
      baseUnit,
      baseQuantity: baseQuantity,
      defaultQuantity,
      nutritionPerUnit: this.buildNutritionPayload(formData),
      proteinSource: this.getProteinSourceValue(formData.proteinSourceIndex),
      foodType: 'food',
      image: formData.image ? formData.image.trim() : '',
      isLiquid: baseUnit.toLowerCase() === 'ml',
      babyUid,
      isSystem: false,
      createdBy: app.globalData.openid || wx.getStorageSync('openid') || '',
      nutritionSource: 'manual'
    };
  },

  buildFormDataFromFood(food) {
    if (!food) {
      return createEmptyFormData(this.getDefaultCategory());
    }

    const nutrition = food.nutritionPerUnit || {};
    const proteinSourceValue = food.proteinSource || 'natural';
    const sourceIndex =
      this.data.proteinSourceOptions.findIndex(item => item.value === proteinSourceValue) || 0;

    return {
      name: food.name || '',
      category: this.normalizeCategoryValue(food.category),
      categoryLevel2: food.categoryLevel2 || '',
      unit: food.baseUnit || 'g',
      baseQuantity: String(food.baseQuantity != null ? food.baseQuantity : 100),
      defaultQuantity: String(
        food.defaultQuantity != null ? food.defaultQuantity : food.baseQuantity || 100
      ),
      calories: nutrition.calories != null ? String(nutrition.calories) : '',
      image: food.image || '',
      protein: nutrition.protein != null ? String(nutrition.protein) : '',
      carbs: nutrition.carbs != null ? String(nutrition.carbs) : '',
      fat: nutrition.fat != null ? String(nutrition.fat) : '',
      fiber: nutrition.fiber != null ? String(nutrition.fiber) : '',
      sodium: nutrition.sodium != null ? String(nutrition.sodium) : '',
      proteinSourceIndex: sourceIndex >= 0 ? sourceIndex : 0
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
      customCategoryInput: '',
      editingFoodId: '',
      editingFoodName: '',
      formData: createEmptyFormData(this.getDefaultCategory())
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
      customCategoryInput: '',
      formData
    });
  },

  hideAddModal() {
    this.setData({
      showAddModal: false,
      editingFoodId: '',
      editingFoodName: '',
      customCategoryInput: '',
      formData: createEmptyFormData(this.getDefaultCategory())
    });
  },

  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({
      [`formData.${field}`]: e.detail.value
    });
  },

  selectCategorySuggestion(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({
      'formData.category': this.normalizeCategoryValue(value)
    });
  },

  selectUnitSuggestion(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({
      'formData.unit': value
    });
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
      this.setData({ customCategoryInput: '', 'formData.category': normalizedValue });
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
        createdBy: app.globalData.openid || wx.getStorageSync('openid') || ''
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
      'formData.category': normalizedValue
    });

    wx.showToast({ title: '分类已添加', icon: 'success' });
  },

  onProteinSourceChange(e) {
    this.setData({
      'formData.proteinSourceIndex': Number(e.detail.value)
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

    const baseQty = this.parseNumber(formData.baseQuantity);
    if (baseQty === null || baseQty <= 0) {
      wx.showToast({ title: '基础份量必须大于0', icon: 'none' });
      return false;
    }
    const defaultQty = this.parseNumber(formData.defaultQuantity);
    if (defaultQty !== null && defaultQty <= 0) {
      wx.showToast({ title: '默认份量必须大于0', icon: 'none' });
      return false;
    }

    const caloriesVal = this.parseNumber(formData.calories);
    if (caloriesVal === null || caloriesVal < 0) {
      wx.showToast({ title: '请填写热量', icon: 'none' });
      return false;
    }

    const optionalNumbers = [
      { label: '蛋白质', value: formData.protein },
      { label: '碳水', value: formData.carbs },
      { label: '脂肪', value: formData.fat },
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

      if (editingId) {
        const { createdBy, babyUid: payloadBabyUid, ...updatePayload } = newFood;
        await FoodModel.updateFood(editingId, updatePayload, babyUid);
      } else {
        await FoodModel.createFood(newFood);
      }

      try {
        await FoodCategoryModel.addCategory(newFood.category, {
          babyUid,
          createdBy: app.globalData.openid || wx.getStorageSync('openid') || ''
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
          await FoodModel.deleteFood(id, babyUid);
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
