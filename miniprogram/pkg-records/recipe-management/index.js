const RecipeModel = require('../../models/recipe');
const FoodModel = require('../../models/food');

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
      ingredients: [],
      steps: [],
      coverImageFileId: '',
      prepTimeSec: null
    }
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
    const babyUid = getBabyUid();
    console.log('[recipe-management] loadRecipes start', { babyUid });
    if (!babyUid) {
      console.warn('[recipe-management] loadRecipes abort: no babyUid');
      this.hasLoadedPage = true;
      this.setData({ mode: 'list', recipes: [], loading: false });
      wx.setNavigationBarTitle({ title: '食谱管理' });
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const result = await RecipeModel.listActiveByBaby(babyUid);
    console.log('[recipe-management] listActiveByBaby result', {
      success: result.success,
      message: result.message || '',
      fromCache: !!result.fromCache,
      count: (result.data || []).length,
      names: (result.data || []).map((item) => item.name),
      ids: (result.data || []).map((item) => item._id)
    });
    if (!result.success) {
      this.hasLoadedPage = true;
      this.setData({ mode: 'list', recipes: [], loading: false });
      wx.setNavigationBarTitle({ title: '食谱管理' });
      wx.showModal({
        title: '加载食谱失败',
        content: result.message || '请检查云库 recipe_catalog 集合是否已创建',
        showCancel: false
      });
      return;
    }

    const recipes = (result.data || [])
      .sort((a, b) => {
        const usedDiff = toTimestamp(b.lastUsedAt) - toTimestamp(a.lastUsedAt);
        if (usedDiff) return usedDiff;
        return Number(b.usageCount || 0) - Number(a.usageCount || 0);
      })
      .map(recipe => ({
        _id: recipe._id,
        name: recipe.name || '',
        ingredientCount: (recipe.ingredients || []).length,
        ingredientNames: (recipe.ingredients || []).map(item => item.foodName).filter(Boolean).join('、'),
        lastUsedText: formatLastUsedAt(recipe.lastUsedAt)
      }));
    console.log('[recipe-management] setData recipes', {
      count: recipes.length,
      names: recipes.map((item) => item.name)
    });
    this.hasLoadedPage = true;
    this.setData({
      mode: 'list',
      recipes,
      loading: false
    });
    wx.setNavigationBarTitle({ title: '食谱管理' });
  },

  createEmptyForm() {
    return {
      name: '',
      notes: '',
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
      form: this.createEmptyForm()
    });
    wx.setNavigationBarTitle({ title: '新建食谱' });
  },

  onRecipeTap(e) {
    this.openRecipe(e.currentTarget.dataset.id, 'detail');
  },

  hydrateIngredient(ingredient = {}, index = 0) {
    const food = this.foodById.get(ingredient.foodId) || null;
    const snapshot = ingredient.foodSnapshot || {};
    return {
      foodId: ingredient.foodId || food?._id || '',
      foodName: food?.name || ingredient.foodName || snapshot.name || '未知食物',
      unit: food?.baseUnit || ingredient.unit || snapshot.nutritionBasis?.unit || 'g',
      sortOrder: index,
      foodSnapshot: snapshot.name ? snapshot : (food ? FoodModel.buildFoodSnapshot(food) : snapshot),
      food: food || null,
      unavailable: !food,
      unavailableText: !food ? '原食物已不可用，将按快照记录' : ''
    };
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
        ingredientNames: ingredients.map(item => item.foodName).join('、')
      },
      form
    });
    wx.setNavigationBarTitle({ title: mode === 'edit' ? '编辑食谱' : '食谱详情' });
    if (unavailableCount > 0) {
      wx.showToast({ title: '部分原食物已不可用，将按快照', icon: 'none' });
    }
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

  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredients = this.data.form.ingredients
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }));
    this.setData({ 'form.ingredients': ingredients });
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
    if (this.data.mode !== 'edit') return;
    let selection = null;
    try {
      selection = wx.getStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);
    } catch (error) {
      return;
    }
    if (!selection || !Array.isArray(selection.foodIds) || !selection.foodIds.length) return;
    wx.removeStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);

    const existingIds = new Set(
      (this.data.form.ingredients || []).map(item => item.foodId).filter(Boolean)
    );
    const missingIds = [];
    const added = selection.foodIds
      .filter(id => id && !existingIds.has(id))
      .map((id) => {
        const food = this.foodById?.get(id);
        if (!food) {
          missingIds.push(id);
          return null;
        }
        return this.hydrateIngredient({
          foodId: food._id,
          foodName: food.name,
          unit: food.baseUnit || 'g',
          foodSnapshot: FoodModel.buildFoodSnapshot(food),
          food
        }, (this.data.form.ingredients || []).length);
      })
      .filter(Boolean)
      .map((item, index) => ({
        ...item,
        sortOrder: (this.data.form.ingredients || []).length + index
      }));

    if (!added.length) {
      if (missingIds.length) {
        wx.showToast({ title: '部分食物加载失败，请重试', icon: 'none' });
      }
      return;
    }

    this.setData({
      mode: 'edit',
      'form.ingredients': [...(this.data.form.ingredients || []), ...added]
    });
  },

  buildSavePayload() {
    const form = this.data.form;
    const ingredients = (form.ingredients || []).map((item, index) => ({
      foodId: item.foodId,
      foodName: item.foodName,
      unit: item.unit,
      sortOrder: index,
      food: item.unavailable ? null : (item.food || this.foodById.get(item.foodId)),
      foodSnapshot: item.foodSnapshot
    }));
    return {
      babyUid: getBabyUid(),
      name: String(form.name || '').trim(),
      notes: String(form.notes || '').trim(),
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

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...', mask: true });
    const app = typeof getApp === 'function' ? getApp() : null;
    const savePayload = {
      ...payload,
      operatorOpenid: app?.globalData?.openid || wx.getStorageSync('openid') || ''
    };
    console.log('[recipe-management] saveRecipe', {
      mode: this.data.recipeId ? 'update' : 'create',
      recipeId: this.data.recipeId || '',
      babyUid: savePayload.babyUid,
      name: savePayload.name,
      ingredientCount: (savePayload.ingredients || []).length
    });
    const result = this.data.recipeId
      ? await RecipeModel.update(this.data.recipeId, savePayload, getBabyUid())
      : await RecipeModel.create(savePayload);
    console.log('[recipe-management] saveRecipe result', {
      success: result.success,
      message: result.message || '',
      readable: result.readable,
      newId: result.data?._id || result.recipe?._id || ''
    });
    wx.hideLoading();
    this.setData({ saving: false });
    if (!result.success) {
      wx.showToast({ title: result.message || '保存失败', icon: 'none' });
      return;
    }
    if (!this.data.recipeId && result.readable === false) {
      wx.showModal({
        title: '已保存但读回失败',
        content: `请到云开发控制台检查 recipe_catalog 权限（建议与 food_catalog 一致），并确认记录 babyUid=${payload.babyUid || ''}`,
        showCancel: false
      });
    } else {
      wx.showToast({ title: '保存成功', icon: 'success' });
    }
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
