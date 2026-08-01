const FoodModel = require('../../models/food');
const {
  DIFFICULTY_OPTIONS,
  validatePublishPayload,
  formatRecipeWallAuthorLabel
} = require('../../utils/recipeWallUtils');
const {
  buildIngredientNutrition,
  summarizeRecipeNutrition,
  emptyNutrition
} = require('../../utils/recipeNutritionUtils');

const RECIPE_INGREDIENT_PICKER_SELECTION_KEY = 'recipe_ingredient_picker_selection';
const RECIPE_WALL_DRAFT_KEY = 'recipe_wall_publish_draft';

function displayNameCacheKey(babyUid, role) {
  return babyUid && role ? `personal_display_name_${babyUid}_${role}` : '';
}

function formatPreviewNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return digits === 0 ? '0' : '0.00';
  if (digits === 0) return String(Math.round(num));
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(digits);
}

function isWeightUnit(unit) {
  const normalized = String(unit || '').toLowerCase();
  return normalized === 'g' || normalized === 'ml';
}

function buildNutritionSummary(ingredients = []) {
  const prepared = (ingredients || []).map((item) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const source = item.food || item.foodSnapshot || {};
    return {
      quantity,
      unit: item.unit || 'g',
      food: item.food || null,
      foodSnapshot: item.foodSnapshot || null,
      nutrition: quantity > 0
        ? buildIngredientNutrition(source, quantity)
        : emptyNutrition()
    };
  });
  const yieldWeightG = Math.round(
    prepared.reduce((sum, item) => {
      if (!(item.quantity > 0) || !isWeightUnit(item.unit)) return sum;
      return sum + item.quantity;
    }, 0) * 100
  ) / 100;
  const summary = summarizeRecipeNutrition(prepared, yieldWeightG);
  const nutrition = summary.totalNutrition || emptyNutrition();
  return {
    totalNutrition: {
      calories: Number(nutrition.calories) || 0,
      protein: Number(nutrition.protein) || 0,
      carbs: Number(nutrition.carbs) || 0,
      fat: Number(nutrition.fat) || 0
    },
    caloriesText: formatPreviewNumber(nutrition.calories, 0),
    proteinText: formatPreviewNumber(nutrition.protein, 2),
    carbsText: formatPreviewNumber(nutrition.carbs, 2),
    fatText: formatPreviewNumber(nutrition.fat, 2)
  };
}

Page({
  data: {
    title: '',
    description: '',
    coverFileId: '',
    coverTempPath: '',
    ingredients: [],
    steps: [{ text: '', imageFileId: '', imageTempPath: '' }],
    showAdvanced: false,
    cookingMinutes: '',
    difficulty: '',
    difficultyOptions: DIFFICULTY_OPTIONS,
    showAdjustSheet: false,
    babyUid: '',
    babyName: '',
    authorDisplayName: '',
    authorAvatar: '',
    tipText: '',
    nutritionPreview: {
      caloriesText: '0',
      proteinText: '0.00',
      carbsText: '0.00',
      fatText: '0.00'
    }
  },

  foodById: null,

  onLoad() {
    this.foodById = new Map();
  },

  onShow() {
    this.loadAuthorContext();
    this.consumeIngredientSelection();
  },

  loadAuthorContext() {
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || '';
    const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
    const babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
    const babyName = (babyInfo.name || '').trim();
    const cacheKey = displayNameCacheKey(babyUid, userRole);
    const authorDisplayName = String((cacheKey ? wx.getStorageSync(cacheKey) : '') || '').trim();
    const authorAvatar = app.globalData.userInfo?.avatarUrl || '';
    const previewAuthorLabel = formatRecipeWallAuthorLabel({ babyName, authorDisplayName });

    this.setData({
      babyUid,
      babyName,
      authorDisplayName,
      authorAvatar,
      tipText: previewAuthorLabel
        ? `发布后将展示为「${previewAuthorLabel}」`
        : '请先完善宝宝昵称与个人展示名称后再发布'
    });
  },

  async ensureFoodCatalog() {
    if (this.foodById && this.foodById.size) return;
    const foods = await FoodModel.getAvailableFoods(this.data.babyUid || getApp().globalData.babyUid);
    this.foodById = new Map((foods || []).map((food) => [food._id, food]));
  },

  hydrateIngredient(ingredient = {}, index = 0) {
    const food = this.foodById.get(ingredient.foodId) || ingredient.food || null;
    const snapshot = ingredient.foodSnapshot || (food ? FoodModel.buildFoodSnapshot(food) : {});
    const unit = food?.baseUnit || ingredient.unit || snapshot.nutritionBasis?.unit || 'g';
    const quantityNum = Math.max(0, Number(ingredient.quantity) || 0);
    const quantity = quantityNum > 0 ? String(quantityNum) : '';
    return {
      foodId: ingredient.foodId || food?._id || '',
      foodName: food?.name || ingredient.foodName || snapshot.name || '未知食物',
      unit,
      quantity,
      sortOrder: index,
      foodSnapshot: snapshot,
      food: food || null
    };
  },

  refreshNutrition(ingredients = this.data.ingredients) {
    const nutritionPreview = buildNutritionSummary(ingredients);
    this.setData({ nutritionPreview });
    return nutritionPreview;
  },

  async consumeIngredientSelection() {
    let selection = null;
    try {
      selection = wx.getStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);
    } catch (error) {
      return;
    }
    if (!selection || !Array.isArray(selection.foodIds) || !selection.foodIds.length) return;
    wx.removeStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);

    await this.ensureFoodCatalog();
    const existingIds = new Set((this.data.ingredients || []).map((item) => item.foodId).filter(Boolean));
    const added = selection.foodIds
      .filter((id) => id && !existingIds.has(id))
      .map((id) => {
        const food = this.foodById.get(id);
        if (!food) return null;
        return this.hydrateIngredient({
          foodId: food._id,
          foodName: food.name,
          unit: food.baseUnit || 'g',
          quantity: 0,
          foodSnapshot: FoodModel.buildFoodSnapshot(food),
          food
        }, (this.data.ingredients || []).length);
      })
      .filter(Boolean);

    if (!added.length) return;
    const ingredients = [...(this.data.ingredients || []), ...added]
      .map((item, index) => ({ ...item, sortOrder: index }));
    this.setData({ ingredients });
    this.refreshNutrition(ingredients);
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value || '' });
  },

  onDescriptionInput(e) {
    this.setData({ description: e.detail.value || '' });
  },

  onCookingMinutesInput(e) {
    this.setData({ cookingMinutes: e.detail.value || '' });
  },

  onSelectDifficulty(e) {
    const value = e.currentTarget.dataset.value || '';
    this.setData({ difficulty: this.data.difficulty === value ? '' : value });
  },

  toggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced });
  },

  async chooseCover() {
    const uploaded = await this.chooseAndUploadImage('cover');
    if (!uploaded) return;
    this.setData({ coverFileId: uploaded.fileID, coverTempPath: uploaded.tempPath });
  },

  addIngredients() {
    const selectedIds = (this.data.ingredients || [])
      .map((item) => item.foodId)
      .filter(Boolean);
    wx.setStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY, {
      schemaVersion: 1,
      foodIds: selectedIds
    });
    wx.navigateTo({
      url: '/pkg-records/food-picker/index?from=recipe-wall'
    });
  },

  onQuantityInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    const raw = e.detail.value;
    if (!this._quantityDrafts) this._quantityDrafts = {};
    this._quantityDrafts[index] = raw;
    const previewIngredients = (this.data.ingredients || []).map((item, itemIndex) => (
      itemIndex === index ? { ...item, quantity: raw } : item
    ));
    this.refreshNutrition(previewIngredients);
  },

  onQuantityBlur(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredients = [...(this.data.ingredients || [])];
    if (!ingredients[index]) return;
    const draft = this._quantityDrafts ? this._quantityDrafts[index] : undefined;
    const raw = draft === undefined ? e.detail.value : draft;
    if (this._quantityDrafts) delete this._quantityDrafts[index];
    const quantityNum = Math.max(0, Number(raw) || 0);
    const quantity = quantityNum > 0 ? String(quantityNum) : '';
    ingredients[index] = { ...ingredients[index], quantity };
    this.setData({ [`ingredients[${index}].quantity`]: quantity });
    this.refreshNutrition(ingredients);
  },

  openAdjustSheet() {
    if (!(this.data.ingredients || []).length) {
      wx.showToast({ title: '请先添加用料', icon: 'none' });
      return;
    }
    this.setData({ showAdjustSheet: true });
  },

  closeAdjustSheet() {
    this.setData({ showAdjustSheet: false });
  },

  moveIngredient(e) {
    const index = Number(e.currentTarget.dataset.index);
    const offset = Number(e.currentTarget.dataset.offset);
    const list = [...(this.data.ingredients || [])];
    const target = index + offset;
    if (index < 0 || target < 0 || target >= list.length) return;
    const temp = list[index];
    list[index] = list[target];
    list[target] = temp;
    const ingredients = list.map((item, i) => ({ ...item, sortOrder: i }));
    this.setData({ ingredients });
    this.refreshNutrition(ingredients);
  },

  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredients = (this.data.ingredients || [])
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, sortOrder: i }));
    this.setData({ ingredients });
    this.refreshNutrition(ingredients);
  },

  onStepInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`steps[${index}].text`]: e.detail.value || '' });
  },

  addStep() {
    this.setData({
      steps: this.data.steps.concat([{ text: '', imageFileId: '', imageTempPath: '' }])
    });
  },

  removeStep(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.steps.length <= 1) return;
    this.setData({
      steps: this.data.steps.filter((_, i) => i !== index)
    });
  },

  async chooseStepImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    const uploaded = await this.chooseAndUploadImage(`step-${index}`);
    if (!uploaded) return;
    this.setData({
      [`steps[${index}].imageFileId`]: uploaded.fileID,
      [`steps[${index}].imageTempPath`]: uploaded.tempPath
    });
  },

  clearStepImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({
      [`steps[${index}].imageFileId`]: '',
      [`steps[${index}].imageTempPath`]: ''
    });
  },

  chooseAndUploadImage(prefix) {
    return new Promise((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: async (res) => {
          const file = (res.tempFiles || [])[0];
          if (!file?.tempFilePath) {
            resolve(null);
            return;
          }
          try {
            wx.showLoading({ title: '上传中', mask: true });
            const ext = (file.tempFilePath.split('.').pop() || 'jpg').toLowerCase();
            const cloudPath = `recipe-wall/${Date.now()}-${prefix}.${ext}`;
            const uploadRes = await wx.cloud.uploadFile({
              cloudPath,
              filePath: file.tempFilePath
            });
            resolve({ fileID: uploadRes.fileID, tempPath: file.tempFilePath });
          } catch (error) {
            console.error('upload image failed', error);
            wx.showToast({ title: '上传失败', icon: 'none' });
            resolve(null);
          } finally {
            wx.hideLoading();
          }
        },
        fail: () => resolve(null)
      });
    });
  },

  buildDraftPayload() {
    const nutrition = this.refreshNutrition(this.data.ingredients);
    return {
      title: this.data.title,
      description: this.data.description,
      coverFileId: this.data.coverFileId,
      coverTempPath: this.data.coverTempPath,
      ingredients: (this.data.ingredients || []).map((item) => ({
        foodId: item.foodId,
        foodName: item.foodName,
        quantity: Number(item.quantity) || 0,
        unit: item.unit || 'g',
        foodSnapshot: item.foodSnapshot || null,
        nutrition: buildIngredientNutrition(item.food || item.foodSnapshot || {}, Number(item.quantity) || 0)
      })),
      steps: this.data.steps,
      cookingMinutes: this.data.cookingMinutes,
      difficulty: this.data.difficulty,
      totalNutrition: nutrition.totalNutrition,
      babyUid: this.data.babyUid,
      babyName: this.data.babyName,
      authorDisplayName: this.data.authorDisplayName,
      authorAvatar: this.data.authorAvatar,
      nutritionPreview: {
        caloriesText: nutrition.caloriesText,
        proteinText: nutrition.proteinText,
        carbsText: nutrition.carbsText,
        fatText: nutrition.fatText
      }
    };
  },

  onPreview() {
    if (!this.data.babyName || !this.data.authorDisplayName) {
      wx.showModal({
        title: '请先完善资料',
        content: '发布需要宝宝昵称和个人展示名称（如妈妈/爸爸）',
        showCancel: false
      });
      return;
    }

    const draft = this.buildDraftPayload();
    const checked = validatePublishPayload(draft);
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }

    wx.setStorageSync(RECIPE_WALL_DRAFT_KEY, {
      ...draft,
      validated: checked.data
    });
    wx.navigateTo({ url: '/pkg-recipe-wall/preview/index' });
  }
});
