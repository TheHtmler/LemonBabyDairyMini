const RecipeModel = require('../../models/recipe');
const FoodModel = require('../../models/food');
const {
  buildIngredientNutrition,
  buildIngredientNutritionPreservingSplit,
  summarizeRecipeNutrition,
  shouldWarnYieldMismatch,
  emptyNutrition
} = require('../../utils/recipeNutritionUtils');

const RECIPE_INGREDIENT_PICKER_SELECTION_KEY = 'recipe_ingredient_picker_selection';

function getBabyUid() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return app?.globalData?.babyUid || wx.getStorageSync('baby_uid') || '';
}

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value.$date) return new Date(value.$date).getTime() || 0;
  if (value.seconds) return Number(value.seconds) * 1000;
  return new Date(value).getTime() || 0;
}

function formatLastUsedAt(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return '未使用';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatNutrition(nutrition = emptyNutrition()) {
  const result = {};
  Object.keys(emptyNutrition()).forEach((field) => {
    result[field] = Number(nutrition[field] || 0).toFixed(2);
  });
  return result;
}

Page({
  data: {
    mode: 'list',
    loading: true,
    saving: false,
    recipes: [],
    recipeId: '',
    recipe: null,
    form: {
      name: '',
      notes: '',
      yieldWeightG: '',
      ingredients: [],
      steps: [],
      coverImageFileId: '',
      prepTimeSec: null
    },
    nutritionPreview: {
      totalNutrition: formatNutrition(),
      nutritionPer100g: formatNutrition()
    },
    yieldWarning: ''
  },

  async onLoad(options = {}) {
    this.foodCatalog = [];
    this.foodById = new Map();
    await this.loadFoodCatalog();
    if (options.id) {
      await this.openRecipe(options.id, options.mode === 'edit' ? 'edit' : 'detail');
      return;
    }
    await this.loadRecipes();
  },

  onShow() {
    if (!this.hasLoadedPage) return;
    this.consumeIngredientSelection();
  },

  async loadFoodCatalog() {
    const foods = await FoodModel.getAvailableFoods(getBabyUid(), {
      preferLocalSystemIndex: true
    });
    this.foodCatalog = foods || [];
    this.foodById = new Map(this.foodCatalog.map(food => [food._id, food]));
  },

  async loadRecipes() {
    this.setData({ loading: true });
    const result = await RecipeModel.listActiveByBaby(getBabyUid());
    const recipes = (result.data || [])
      .sort((a, b) => {
        const usedDiff = toTimestamp(b.lastUsedAt) - toTimestamp(a.lastUsedAt);
        if (usedDiff) return usedDiff;
        return Number(b.usageCount || 0) - Number(a.usageCount || 0);
      })
      .map(recipe => ({
        ...recipe,
        ingredientCount: (recipe.ingredients || []).length,
        lastUsedText: formatLastUsedAt(recipe.lastUsedAt),
        proteinText: Number(recipe.nutritionPer100g?.protein || 0).toFixed(2),
        caloriesText: Number(recipe.nutritionPer100g?.calories || 0).toFixed(0)
      }));
    this.hasLoadedPage = true;
    this.setData({
      mode: 'list',
      recipes,
      loading: false
    });
    wx.setNavigationBarTitle({ title: '食谱管理' });
    if (!result.success) {
      wx.showToast({ title: result.message || '加载食谱失败', icon: 'none' });
    }
  },

  createEmptyForm() {
    return {
      name: '',
      notes: '',
      yieldWeightG: '',
      ingredients: [],
      steps: [],
      coverImageFileId: '',
      prepTimeSec: null
    };
  },

  openCreate() {
    this.setData({
      mode: 'edit',
      recipeId: '',
      recipe: null,
      form: this.createEmptyForm(),
      yieldWarning: ''
    }, () => this.refreshNutritionPreview());
    wx.setNavigationBarTitle({ title: '新建食谱' });
  },

  onRecipeTap(e) {
    this.openRecipe(e.currentTarget.dataset.id, 'detail');
  },

  async openRecipe(id, mode = 'detail') {
    if (!id) return;
    this.setData({ loading: true });
    const result = await RecipeModel.getById(id);
    if (!result.success || !result.data) {
      this.setData({ loading: false });
      wx.showToast({ title: result.message || '食谱不存在', icon: 'none' });
      return;
    }
    const recipe = result.data;
    const ingredients = (recipe.ingredients || []).map((ingredient, index) =>
      this.hydrateIngredient(ingredient, index)
    );
    const unavailableCount = ingredients.filter(item => item.unavailable).length;
    const form = {
      name: recipe.name || '',
      notes: recipe.notes || '',
      yieldWeightG: recipe.yieldWeightG || '',
      ingredients,
      steps: recipe.steps || [],
      coverImageFileId: recipe.coverImageFileId || '',
      prepTimeSec: recipe.prepTimeSec === undefined ? null : recipe.prepTimeSec
    };
    this.hasLoadedPage = true;
    this.setData({
      mode,
      loading: false,
      recipeId: id,
      recipe: {
        ...recipe,
        ingredients,
        totalNutritionDisplay: formatNutrition(recipe.totalNutrition),
        nutritionPer100gDisplay: formatNutrition(recipe.nutritionPer100g)
      },
      form,
      yieldWarning: ''
    }, () => this.refreshNutritionPreview());
    wx.setNavigationBarTitle({ title: mode === 'edit' ? '编辑食谱' : '食谱详情' });
    if (unavailableCount > 0) {
      wx.showToast({ title: '部分原食物已不可用，营养按快照', icon: 'none' });
    }
  },

  hydrateIngredient(ingredient = {}, index = 0) {
    const food = this.foodById.get(ingredient.foodId) || null;
    const snapshot = ingredient.foodSnapshot || {};
    const quantity = Number(ingredient.quantity) || 0;
    const nutritionSource = food || snapshot;
    return {
      ...ingredient,
      foodId: ingredient.foodId || food?._id || '',
      foodName: food?.name || ingredient.foodName || snapshot.name || '未知食物',
      quantity: quantity ? String(quantity) : '',
      unit: food?.baseUnit || ingredient.unit || snapshot.nutritionBasis?.unit || 'g',
      sortOrder: index,
      foodSnapshot: snapshot,
      nutrition: food
        ? buildIngredientNutrition(food, quantity)
        : buildIngredientNutritionPreservingSplit(
          snapshot,
          quantity,
          ingredient.nutrition,
          quantity
        ),
      unavailable: !food,
      unavailableText: !food ? '原食物已不可用，营养按快照' : ''
    };
  },

  editRecipe() {
    if (!this.data.recipeId) return;
    this.setData({ mode: 'edit' });
    wx.setNavigationBarTitle({ title: '编辑食谱' });
  },

  async backToList() {
    await this.loadRecipes();
  },

  onNameInput(e) {
    this.setData({ 'form.name': e.detail.value });
  },

  onNotesInput(e) {
    this.setData({ 'form.notes': e.detail.value });
  },

  onYieldWeightInput(e) {
    this.setData({
      'form.yieldWeightG': e.detail.value,
      yieldWarning: ''
    }, () => this.refreshNutritionPreview());
  },

  onIngredientQuantityInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredient = this.data.form.ingredients[index];
    if (!ingredient) return;
    const quantity = e.detail.value;
    const nutritionSource = this.foodById.get(ingredient.foodId) || ingredient.foodSnapshot;
    const nutrition = ingredient.unavailable
      ? buildIngredientNutritionPreservingSplit(
        nutritionSource,
        Number(quantity) || 0,
        ingredient.nutrition,
        Number(ingredient.quantity) || 0
      )
      : buildIngredientNutrition(nutritionSource, Number(quantity) || 0);
    this.setData({
      [`form.ingredients[${index}].quantity`]: quantity,
      [`form.ingredients[${index}].nutrition`]: nutrition,
      yieldWarning: ''
    }, () => this.refreshNutritionPreview());
  },

  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredients = this.data.form.ingredients
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }));
    this.setData({
      'form.ingredients': ingredients,
      yieldWarning: ''
    }, () => this.refreshNutritionPreview());
  },

  addIngredients() {
    const selectedIds = this.data.form.ingredients
      .filter(item => !item.unavailable && item.foodId)
      .map(item => item.foodId);
    wx.setStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY, {
      schemaVersion: 1,
      foodIds: selectedIds
    });
    wx.navigateTo({
      url: '/pkg-records/food-picker/index?from=recipe-management'
    });
  },

  consumeIngredientSelection() {
    const selection = wx.getStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);
    if (!selection || !Array.isArray(selection.foodIds)) return;
    wx.removeStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);
    const existingIds = new Set(this.data.form.ingredients.map(item => item.foodId));
    const added = selection.foodIds
      .filter(id => !existingIds.has(id))
      .map(id => this.foodById.get(id))
      .filter(Boolean)
      .map((food, index) => this.hydrateIngredient({
        foodId: food._id,
        foodName: food.name,
        quantity: '',
        unit: food.baseUnit || 'g',
        foodSnapshot: FoodModel.buildFoodSnapshot(food)
      }, this.data.form.ingredients.length + index));
    if (!added.length) return;
    this.setData({
      'form.ingredients': [...this.data.form.ingredients, ...added]
    }, () => this.refreshNutritionPreview());
  },

  refreshNutritionPreview() {
    const ingredients = (this.data.form.ingredients || []).map(item => ({
      ...item,
      quantity: Number(item.quantity) || 0
    }));
    const summary = summarizeRecipeNutrition(
      ingredients,
      Number(this.data.form.yieldWeightG) || 0
    );
    this.setData({
      nutritionPreview: {
        totalNutrition: formatNutrition(summary.totalNutrition),
        nutritionPer100g: formatNutrition(summary.nutritionPer100g)
      }
    });
  },

  buildSavePayload() {
    const form = this.data.form;
    const ingredients = (form.ingredients || []).map((item, index) => ({
      foodId: item.foodId,
      foodName: item.foodName,
      quantity: Number(item.quantity),
      unit: item.unit,
      sortOrder: index,
      food: item.unavailable ? null : this.foodById.get(item.foodId),
      foodSnapshot: item.foodSnapshot,
      nutrition: item.nutrition
    }));
    return {
      babyUid: getBabyUid(),
      name: String(form.name || '').trim(),
      notes: String(form.notes || '').trim(),
      yieldWeightG: Number(form.yieldWeightG),
      ingredients,
      steps: form.steps || [],
      coverImageFileId: form.coverImageFileId || '',
      prepTimeSec: form.prepTimeSec === undefined ? null : form.prepTimeSec
    };
  },

  async saveRecipe() {
    if (this.data.saving) return;
    const payload = this.buildSavePayload();
    if (!payload.name) {
      wx.showToast({ title: '请输入食谱名称', icon: 'none' });
      return;
    }
    if (!payload.ingredients.length) {
      wx.showToast({ title: '请至少添加一种原料', icon: 'none' });
      return;
    }
    if (payload.ingredients.some(item => !(item.quantity > 0))) {
      wx.showToast({ title: '请填写有效的原料份量', icon: 'none' });
      return;
    }
    if (!(payload.yieldWeightG > 0)) {
      wx.showToast({ title: '请填写有效的成品总重', icon: 'none' });
      return;
    }

    if (shouldWarnYieldMismatch(payload.ingredients, payload.yieldWeightG)) {
      this.setData({ yieldWarning: '成品总重与原料克数差异较大，请确认是否包含失水或加水' });
      wx.showToast({ title: '成品重量与原料差异较大', icon: 'none' });
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...', mask: true });
    const result = this.data.recipeId
      ? await RecipeModel.update(this.data.recipeId, payload, getBabyUid())
      : await RecipeModel.create(payload);
    wx.hideLoading();
    this.setData({ saving: false });
    if (!result.success) {
      wx.showToast({ title: result.message || '保存失败', icon: 'none' });
      return;
    }
    wx.showToast({ title: '保存成功', icon: 'success' });
    await this.loadRecipes();
  },

  deleteRecipe() {
    const id = this.data.recipeId;
    if (!id) return;
    wx.showModal({
      title: '删除食谱？',
      content: '历史记录仍会保留当时的食谱快照。',
      confirmText: '删除',
      confirmColor: '#D85A43',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...', mask: true });
        const result = await RecipeModel.softDelete(id, getBabyUid());
        wx.hideLoading();
        if (!result.success) {
          wx.showToast({ title: result.message || '删除失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已删除', icon: 'success' });
        await this.loadRecipes();
      }
    });
  }
});
