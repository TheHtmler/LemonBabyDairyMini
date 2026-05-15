const RecipeModel = require('../../models/recipe');
const FoodModel = require('../../models/food');
const { waitForAppInitialization, getBabyUid, handleError } = require('../../utils/index');

function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}

function createEmptyFormData() {
  return {
    name: '',
    note: '',
    items: []
  };
}

function buildDraftItemFromFood(food = {}) {
  return {
    foodId: food._id || '',
    food: food || null,
    nameSnapshot: food.name || '',
    category: food.category || '',
    unit: food.baseUnit || 'g',
    quantity: String(food.baseQuantity != null ? food.baseQuantity : ''),
    nutritionSnapshot: FoodModel.calculateNutrition(food, Number(food.baseQuantity) || 0),
    proteinSource: food.proteinSource || 'natural',
    proteinQuality: food.proteinQuality || '',
    naturalProtein: 0,
    specialProtein: 0
  };
}

Page({
  data: {
    loading: false,
    saving: false,
    babyUid: '',
    recipes: [],
    foodCatalog: [],
    showEditor: false,
    editingRecipeId: '',
    formData: createEmptyFormData()
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      const babyUid = getBabyUid();
      this.setData({ babyUid: babyUid || '' });
      await Promise.all([
        this.loadRecipes(),
        this.loadFoodCatalog()
      ]);
    } catch (error) {
      handleError(error, { title: '加载食谱失败' });
    }
  },

  async loadRecipes() {
    const babyUid = this.data.babyUid || getBabyUid();
    if (!babyUid) {
      this.setData({ recipes: [] });
      return;
    }

    const recipes = await RecipeModel.listRecipes(babyUid);
    this.setData({ recipes: recipes || [] });
  },

  async loadFoodCatalog() {
    const babyUid = this.data.babyUid || getBabyUid();
    const foods = await FoodModel.getAvailableFoods(babyUid);
    const foodsWithImageUrls = await FoodModel.resolveFoodImageUrls(foods || []);
    this.setData({
      foodCatalog: (foodsWithImageUrls || []).map((food) => ({
        ...food,
        category: food.category || '',
        baseUnit: food.baseUnit || 'g',
        baseQuantity: Number(food.baseQuantity) || 100
      }))
    });
  },

  openCreateRecipe() {
    this.setData({
      showEditor: true,
      editingRecipeId: '',
      formData: createEmptyFormData()
    });
  },

  openEditRecipe(e) {
    const recipeId = e?.currentTarget?.dataset?.id || '';
    if (!recipeId) return;
    const recipe = (this.data.recipes || []).find((item) => item._id === recipeId);
    if (!recipe) return;

    const foodMap = new Map((this.data.foodCatalog || []).map((food) => [food._id, food]));
    const items = (recipe.items || []).map((item) => ({
      ...item,
      quantity: String(item.baseQuantity != null ? item.baseQuantity : ''),
      food: foodMap.get(item.foodId) || null
    }));

    this.setData({
      showEditor: true,
      editingRecipeId: recipeId,
      formData: {
        name: recipe.name || '',
        note: recipe.note || '',
        items
      }
    });
  },

  closeEditor() {
    this.setData({
      showEditor: false,
      editingRecipeId: '',
      formData: createEmptyFormData()
    });
  },

  onRecipeNameInput(e) {
    this.setData({
      'formData.name': e.detail.value || ''
    });
  },

  onRecipeNoteInput(e) {
    this.setData({
      'formData.note': e.detail.value || ''
    });
  },

  addFoodToDraft(e) {
    const foodId = e?.currentTarget?.dataset?.id || '';
    if (!foodId) return;

    const food = (this.data.foodCatalog || []).find((item) => item._id === foodId);
    if (!food) return;

    const existing = (this.data.formData.items || []).some((item) => item.foodId === foodId);
    if (existing) {
      wx.showToast({ title: '该食物已加入食谱', icon: 'none' });
      return;
    }

    const nutrition = FoodModel.calculateNutrition(food, Number(food.baseQuantity) || 0);
    const protein = Number(nutrition.protein) || 0;
    const proteinSource = food.proteinSource || 'natural';
    const naturalProtein = proteinSource === 'special' ? 0 : protein;
    const specialProtein = proteinSource === 'special' ? protein : 0;

    const nextItem = {
      ...buildDraftItemFromFood(food),
      nutritionSnapshot: {
        calories: roundCalories(Number(nutrition.calories) || 0),
        protein: roundNumber(Number(nutrition.protein) || 0, 2),
        carbs: roundNumber(Number(nutrition.carbs) || 0, 2),
        fat: roundNumber(Number(nutrition.fat) || 0, 2),
        fiber: roundNumber(Number(nutrition.fiber) || 0, 2),
        sodium: roundNumber(Number(nutrition.sodium) || 0, 2)
      },
      naturalProtein: roundNumber(naturalProtein, 2),
      specialProtein: roundNumber(specialProtein, 2)
    };

    this.setData({
      'formData.items': [...(this.data.formData.items || []), nextItem]
    });
  },

  onDraftItemQuantityInput(e) {
    const index = Number(e?.currentTarget?.dataset?.index);
    const value = e?.detail?.value || '';
    if (!Number.isInteger(index) || index < 0) return;

    const items = [...(this.data.formData.items || [])];
    const target = items[index];
    if (!target) return;

    const food = target.food || null;
    const quantity = Number(value);
    const nutrition = food && Number.isFinite(quantity) && quantity > 0
      ? FoodModel.calculateNutrition(food, quantity)
      : target.nutritionSnapshot || {};
    const protein = Number(nutrition.protein) || 0;
    const proteinSource = target.proteinSource || 'natural';

    items[index] = {
      ...target,
      quantity: value,
      nutritionSnapshot: {
        calories: roundCalories(Number(nutrition.calories) || 0),
        protein: roundNumber(Number(nutrition.protein) || 0, 2),
        carbs: roundNumber(Number(nutrition.carbs) || 0, 2),
        fat: roundNumber(Number(nutrition.fat) || 0, 2),
        fiber: roundNumber(Number(nutrition.fiber) || 0, 2),
        sodium: roundNumber(Number(nutrition.sodium) || 0, 2)
      },
      naturalProtein: roundNumber(proteinSource === 'special' ? 0 : protein, 2),
      specialProtein: roundNumber(proteinSource === 'special' ? protein : 0, 2)
    };

    this.setData({
      'formData.items': items
    });
  },

  removeDraftItem(e) {
    const index = Number(e?.currentTarget?.dataset?.index);
    if (!Number.isInteger(index) || index < 0) return;

    const items = [...(this.data.formData.items || [])];
    items.splice(index, 1);
    this.setData({
      'formData.items': items
    });
  },

  buildRecipePayload() {
    const items = (this.data.formData.items || [])
      .map((item) => ({
        foodId: item.foodId || '',
        nameSnapshot: item.nameSnapshot || '',
        category: item.category || '',
        unit: item.unit || 'g',
        baseQuantity: roundNumber(Number(item.quantity) || 0, 2),
        nutritionSnapshot: {
          calories: roundCalories(Number(item?.nutritionSnapshot?.calories) || 0),
          protein: roundNumber(Number(item?.nutritionSnapshot?.protein) || 0, 2),
          carbs: roundNumber(Number(item?.nutritionSnapshot?.carbs) || 0, 2),
          fat: roundNumber(Number(item?.nutritionSnapshot?.fat) || 0, 2),
          fiber: roundNumber(Number(item?.nutritionSnapshot?.fiber) || 0, 2),
          sodium: roundNumber(Number(item?.nutritionSnapshot?.sodium) || 0, 2)
        },
        proteinSource: item.proteinSource || 'natural',
        proteinQuality: item.proteinQuality || '',
        naturalProtein: roundNumber(Number(item.naturalProtein) || 0, 2),
        specialProtein: roundNumber(Number(item.specialProtein) || 0, 2)
      }))
      .filter((item) => item.foodId && item.baseQuantity > 0);

    return {
      name: String(this.data.formData.name || '').trim(),
      note: String(this.data.formData.note || '').trim(),
      items
    };
  },

  async saveRecipe() {
    if (this.data.saving) return;

    const babyUid = this.data.babyUid || getBabyUid();
    const payload = this.buildRecipePayload();

    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }
    if (!payload.name) {
      wx.showToast({ title: '请输入食谱名称', icon: 'none' });
      return;
    }
    if (!payload.items.length) {
      wx.showToast({ title: '请至少添加一种食物', icon: 'none' });
      return;
    }

    try {
      this.setData({ saving: true });
      wx.showLoading({ title: '保存中...' });

      if (this.data.editingRecipeId) {
        await RecipeModel.updateRecipe(this.data.editingRecipeId, payload, babyUid);
      } else {
        await RecipeModel.createRecipe({
          babyUid,
          ...payload
        });
      }

      await this.loadRecipes();
      wx.hideLoading();
      wx.showToast({ title: '食谱已保存', icon: 'success' });
      this.closeEditor();
    } catch (error) {
      handleError(error, { title: '保存食谱失败' });
    } finally {
      this.setData({ saving: false });
    }
  },

  deleteRecipe(e) {
    const recipeId = e?.currentTarget?.dataset?.id || '';
    if (!recipeId) return;

    wx.showModal({
      title: '确认删除',
      content: '删除后不会影响已经保存的历史记录，确认继续吗？',
      success: async (res) => {
        if (!res.confirm) return;

        try {
          wx.showLoading({ title: '删除中...' });
          await RecipeModel.deleteRecipe(recipeId, this.data.babyUid || getBabyUid());
          await this.loadRecipes();
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          if (this.data.editingRecipeId === recipeId) {
            this.closeEditor();
          }
        } catch (error) {
          handleError(error, { title: '删除食谱失败' });
        }
      }
    });
  }
});
