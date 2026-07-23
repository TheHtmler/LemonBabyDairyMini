const RecipeModel = require('../../models/recipe');
const { getBabyUid } = require('../../utils/index');

const RECIPE_PICKER_SELECTION_KEY = 'meal_recipe_picker_selection';

function formatNutrition(value) {
  const number = Number(value) || 0;
  return Math.round(number * 100) / 100;
}

Page({
  data: {
    loading: true,
    recipes: [],
    selectedRecipeId: '',
    quantity: ''
  },

  async onLoad() {
    await this.loadRecipes();
  },

  async loadRecipes() {
    const babyUid = getBabyUid();
    if (!babyUid) {
      this.setData({ loading: false, recipes: [] });
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    const result = await RecipeModel.listActiveByBaby(babyUid);
    if (!result.success) {
      wx.showToast({ title: result.message || '加载食谱失败', icon: 'none' });
    }
    const recipes = (result.data || []).map(recipe => ({
      ...recipe,
      caloriesText: formatNutrition(recipe.nutritionPer100g?.calories),
      proteinText: formatNutrition(recipe.nutritionPer100g?.protein)
    }));
    this.setData({ loading: false, recipes });
  },

  selectRecipe(e) {
    const recipeId = e.currentTarget.dataset.id || '';
    this.setData({
      selectedRecipeId: recipeId,
      quantity: this.data.selectedRecipeId === recipeId ? this.data.quantity : ''
    });
  },

  onQuantityInput(e) {
    this.setData({ quantity: e.detail.value || '' });
  },

  confirmSelection() {
    const recipe = (this.data.recipes || []).find(item => item._id === this.data.selectedRecipeId);
    if (!recipe) {
      wx.showToast({ title: '请选择食谱', icon: 'none' });
      return;
    }
    const quantity = Number(this.data.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      wx.showToast({ title: '请输入有效的食用克数', icon: 'none' });
      return;
    }

    wx.setStorageSync(RECIPE_PICKER_SELECTION_KEY, {
      items: [{
        localId: `meal_recipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        recipeId: recipe._id,
        recipeName: recipe.name,
        quantity,
        unit: 'g',
        nutritionPer100g: recipe.nutritionPer100g || {},
        proteinSource: recipe.proteinSource || 'natural',
        yieldWeightG: Number(recipe.yieldWeightG) || 0,
        ingredientsSnapshot: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
        sourceType: 'recipe'
      }]
    });
    wx.navigateBack();
  }
});
