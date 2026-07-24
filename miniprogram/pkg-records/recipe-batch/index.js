const RecipeModel = require('../../models/recipe');
const FoodModel = require('../../models/food');
const { getBabyUid } = require('../../utils/index');
const {
  buildIngredientNutrition,
  summarizeBatchFromIngredients,
  resolveBatchIntake,
  emptyNutrition
} = require('../../utils/recipeNutritionUtils');

const RECIPE_PICKER_SELECTION_KEY = 'meal_recipe_picker_selection';

function formatNumber(value, digits = 2) {
  const number = Number(value) || 0;
  return number.toFixed(digits);
}

function slimFoodSnapshot(snapshot = {}) {
  const basis = snapshot.nutritionBasis || {};
  return {
    name: snapshot.name || '',
    category: snapshot.category || '',
    nutritionBasis: {
      quantity: Number(basis.quantity) || 100,
      unit: basis.unit || 'g'
    },
    nutritionPerBasis: snapshot.nutritionPerBasis || {},
    proteinSource: snapshot.proteinSource || 'natural',
    proteinSplit: snapshot.proteinSplit || null
  };
}

function formatNutritionLine(nutrition = {}, compact = false) {
  const calories = formatNumber(nutrition.calories, 0);
  const protein = formatNumber(nutrition.protein);
  const carbs = formatNumber(nutrition.carbs, 0);
  const fat = formatNumber(nutrition.fat, 0);
  if (compact) {
    return `${calories}kcal · 蛋白${protein}g · 碳水${carbs}g · 脂肪${fat}g`;
  }
  return `热量 ${calories}kcal · 蛋白 ${protein}g · 碳水 ${carbs}g · 脂肪 ${fat}g`;
}

function resolveReferenceUnit(source = {}, fallbackUnit = 'g') {
  const unit = String(
    source.baseUnit
    || source.nutritionBasis?.unit
    || fallbackUnit
    || 'g'
  ).toLowerCase();
  if (unit === 'ml' || unit === 'g') return unit;
  return unit || 'g';
}

function buildPer100Display(source = {}, fallbackUnit = 'g') {
  const unit = resolveReferenceUnit(source, fallbackUnit);
  const nutrition = buildIngredientNutrition(source, 100);
  return {
    per100Label: `100${unit}`,
    per100Text: formatNutritionLine(nutrition, true)
  };
}

function buildCurrentNutritionDisplay(nutrition = {}, quantity) {
  const amount = Number(quantity) || 0;
  if (!(amount > 0)) {
    return {
      hasCurrentNutrition: false,
      currentText: ''
    };
  }
  return {
    hasCurrentNutrition: true,
    currentText: `本次 ${formatNutritionLine(nutrition, true)}`
  };
}

Page({
  data: {
    loading: true,
    recipeId: '',
    recipeName: '',
    draftIngredients: [],
    intakeMode: 'grams',
    intakeValue: '',
    batchPreview: {
      totalWeightG: 0,
      totalProtein: '0.00',
      totalCalories: '0',
      totalCarbs: '0',
      totalFat: '0',
      canUseGramsIntake: true
    },
    intakePreview: {
      visible: false,
      tip: '',
      calories: '0',
      protein: '0.00',
      carbs: '0',
      fat: '0',
      eatenGText: ''
    }
  },

  async onLoad(options = {}) {
    const recipeId = decodeURIComponent(options.recipeId || '');
    this.foodById = new Map();
    this._recipe = null;
    this._quantityDrafts = {};
    this._intakeDraft = '';

    if (!recipeId) {
      wx.showToast({ title: '缺少食谱信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }

    this.setData({ loading: true, recipeId });
    await this.loadFoodCatalog();
    await this.loadRecipe(recipeId);
  },

  getIngredientSource(ingredient = {}) {
    return this.foodById.get(ingredient.foodId)
      || ingredient.foodSnapshot
      || null;
  },

  async loadFoodCatalog() {
    const foods = await FoodModel.getAvailableFoods(getBabyUid(), {
      preferLocalSystemIndex: true
    });
    this.foodById = new Map((foods || []).map((food) => [food._id, food]));
  },

  async loadRecipe(recipeId) {
    const babyUid = getBabyUid();
    let recipe = null;

    const fetched = await RecipeModel.getById(recipeId);
    if (fetched.success && fetched.data) {
      recipe = fetched.data;
    } else {
      const listed = await RecipeModel.listActiveByBaby(babyUid);
      recipe = (listed.data || []).find((item) => item._id === recipeId) || null;
    }

    if (!recipe) {
      this.setData({ loading: false });
      wx.showModal({
        title: '无法打开食谱',
        content: '该食谱不存在或当前账号不可读，请返回重选。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }

    if (babyUid && recipe.babyUid && recipe.babyUid !== babyUid) {
      this.setData({ loading: false });
      wx.showToast({ title: '无权使用该食谱', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }

    this._recipe = recipe;
    const draftIngredients = (recipe.ingredients || []).map((item, index) => {
      const food = this.foodById.get(item.foodId) || null;
      const snapshot = slimFoodSnapshot(
        item.foodSnapshot && item.foodSnapshot.name
          ? item.foodSnapshot
          : (food ? FoodModel.buildFoodSnapshot(food) : (item.foodSnapshot || {}))
      );
      const unit = food?.baseUnit || item.unit || snapshot.nutritionBasis?.unit || 'g';
      const source = food || snapshot;
      const per100 = buildPer100Display(source, unit);
      const current = buildCurrentNutritionDisplay(emptyNutrition(), 0);
      return {
        foodId: item.foodId || '',
        foodName: food?.name || item.foodName || snapshot.name || `原料${index + 1}`,
        unit,
        quantity: '',
        foodSnapshot: snapshot,
        nutrition: emptyNutrition(),
        per100Label: per100.per100Label,
        per100Text: per100.per100Text,
        hasCurrentNutrition: current.hasCurrentNutrition,
        currentText: current.currentText
      };
    });

    const unitPreview = summarizeBatchFromIngredients(draftIngredients);
    const canUseGramsIntake = !!unitPreview.canUseGramsIntake;
    this.setData({
      loading: false,
      recipeId: recipe._id,
      recipeName: recipe.name || '未命名食谱',
      draftIngredients,
      // 默认按克数；含非克单位时回退百分比
      intakeMode: canUseGramsIntake ? 'grams' : 'percent',
      intakeValue: '',
      batchPreview: {
        totalWeightG: 0,
        totalProtein: '0.00',
        totalCalories: '0',
        totalCarbs: '0',
        totalFat: '0',
        canUseGramsIntake
      }
    });
  },

  onIngredientQuantityInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    if (!this._quantityDrafts) this._quantityDrafts = {};
    this._quantityDrafts[index] = e.detail.value;
  },

  onIngredientQuantityBlur(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredient = this.data.draftIngredients[index];
    if (!ingredient) return;
    const draft = this._quantityDrafts ? this._quantityDrafts[index] : undefined;
    const quantity = draft === undefined ? e.detail.value : draft;
    if (this._quantityDrafts) delete this._quantityDrafts[index];

    const source = this.getIngredientSource(ingredient);
    const nutrition = buildIngredientNutrition(source, Number(quantity) || 0);
    const current = buildCurrentNutritionDisplay(nutrition, quantity);
    this.setData({
      [`draftIngredients[${index}].quantity`]: quantity,
      [`draftIngredients[${index}].nutrition`]: nutrition,
      [`draftIngredients[${index}].hasCurrentNutrition`]: current.hasCurrentNutrition,
      [`draftIngredients[${index}].currentText`]: current.currentText
    }, () => this.refreshBatchPreview());
  },

  switchIntakeMode(e) {
    const mode = e.currentTarget.dataset.mode === 'grams' ? 'grams' : 'percent';
    if (mode === 'grams' && !this.data.batchPreview.canUseGramsIntake) {
      wx.showToast({ title: '含非克单位时请用百分比', icon: 'none' });
      return;
    }
    this._intakeDraft = '';
    this.setData({
      intakeMode: mode,
      intakeValue: ''
    }, () => this.refreshIntakePreview());
  },

  onIntakeValueInput(e) {
    const intakeValue = e.detail.value;
    this._intakeDraft = intakeValue;
    this.setData({ intakeValue }, () => this.refreshIntakePreview());
  },

  onIntakeValueBlur(e) {
    const intakeValue = this._intakeDraft === undefined ? e.detail.value : this._intakeDraft;
    this._intakeDraft = undefined;
    this.setData({ intakeValue }, () => this.refreshIntakePreview());
  },

  flushDrafts() {
    const draftIngredients = (this.data.draftIngredients || []).map((item, index) => {
      const draft = this._quantityDrafts ? this._quantityDrafts[index] : undefined;
      const quantity = draft === undefined ? item.quantity : draft;
      const source = this.getIngredientSource(item);
      const nutrition = buildIngredientNutrition(source, Number(quantity) || 0);
      const current = buildCurrentNutritionDisplay(nutrition, quantity);
      return {
        ...item,
        foodId: item.foodId || '',
        foodName: item.foodName || '',
        unit: item.unit || 'g',
        foodSnapshot: item.foodSnapshot || {},
        quantity,
        nutrition,
        hasCurrentNutrition: current.hasCurrentNutrition,
        currentText: current.currentText
      };
    });
    const intakeValue = this._intakeDraft === undefined
      ? this.data.intakeValue
      : this._intakeDraft;
    this._quantityDrafts = {};
    this._intakeDraft = undefined;
    this.setData({ draftIngredients, intakeValue });
    this.refreshBatchPreview();
    return { draftIngredients, intakeValue };
  },

  refreshBatchPreview() {
    const prepared = (this.data.draftIngredients || []).map((item) => ({
      ...item,
      quantity: Number(item.quantity) || 0
    }));
    const summary = summarizeBatchFromIngredients(prepared);
    const nextMode = (!summary.canUseGramsIntake && this.data.intakeMode === 'grams')
      ? 'percent'
      : this.data.intakeMode;
    const nextIntakeValue = nextMode !== this.data.intakeMode ? '' : this.data.intakeValue;
    this.setData({
      intakeMode: nextMode,
      intakeValue: nextIntakeValue,
      batchPreview: {
        totalWeightG: summary.totalWeightG,
        totalProtein: formatNumber(summary.totalNutrition.protein),
        totalCalories: formatNumber(summary.totalNutrition.calories, 0),
        totalCarbs: formatNumber(summary.totalNutrition.carbs, 0),
        totalFat: formatNumber(summary.totalNutrition.fat, 0),
        canUseGramsIntake: summary.canUseGramsIntake
      }
    }, () => this.refreshIntakePreview());
  },

  refreshIntakePreview() {
    const emptyPreview = {
      visible: false,
      tip: '',
      calories: '0',
      protein: '0.00',
      carbs: '0',
      fat: '0',
      eatenGText: ''
    };

    const intakeValue = this._intakeDraft === undefined
      ? this.data.intakeValue
      : this._intakeDraft;
    const value = Number(intakeValue);
    if (!Number.isFinite(value) || value <= 0) {
      this.setData({ intakePreview: emptyPreview });
      return;
    }

    const prepared = (this.data.draftIngredients || []).map((item, index) => {
      const draft = this._quantityDrafts ? this._quantityDrafts[index] : undefined;
      const quantity = draft === undefined ? item.quantity : draft;
      const source = this.getIngredientSource(item);
      return {
        ...item,
        quantity: Number(quantity) || 0,
        nutrition: buildIngredientNutrition(source, Number(quantity) || 0)
      };
    });
    if (!prepared.some((item) => item.quantity > 0)) {
      this.setData({
        intakePreview: {
          ...emptyPreview,
          tip: '请先填写原料用量'
        }
      });
      return;
    }

    const summary = summarizeBatchFromIngredients(prepared);
    try {
      const intake = resolveBatchIntake(
        summary.totalNutrition,
        summary.totalWeightG,
        this.data.intakeMode,
        intakeValue
      );
      this.setData({
        intakePreview: {
          visible: true,
          tip: '',
          calories: formatNumber(intake.nutrition.calories, 0),
          protein: formatNumber(intake.nutrition.protein),
          carbs: formatNumber(intake.nutrition.carbs, 0),
          fat: formatNumber(intake.nutrition.fat, 0),
          eatenGText: intake.eatenG > 0 ? `${formatNumber(intake.eatenG, 1)}g` : ''
        }
      });
    } catch (error) {
      this.setData({
        intakePreview: {
          ...emptyPreview,
          tip: error.message || '请检查摄入量'
        }
      });
    }
  },

  confirmSelection() {
    const recipe = this._recipe;
    if (!recipe || !recipe._id) {
      wx.showToast({ title: '请重新选择食谱', icon: 'none' });
      return;
    }

    const { draftIngredients, intakeValue } = this.flushDrafts();
    if (!draftIngredients.length) {
      wx.showToast({ title: '该食谱没有原料', icon: 'none' });
      return;
    }
    if (draftIngredients.some((item) => !(Number(item.quantity) > 0))) {
      wx.showToast({ title: '请填写各原料本次用量', icon: 'none' });
      return;
    }

    const batch = summarizeBatchFromIngredients(draftIngredients);
    let intake;
    try {
      intake = resolveBatchIntake(
        batch.totalNutrition,
        batch.totalWeightG,
        this.data.intakeMode,
        intakeValue
      );
    } catch (error) {
      wx.showToast({ title: error.message || '请检查摄入量', icon: 'none' });
      return;
    }

    if (intake.intakeMode === 'grams' && !batch.canUseGramsIntake) {
      wx.showToast({ title: '含非克单位原料时请用百分比', icon: 'none' });
      return;
    }

    const ingredientsSnapshot = draftIngredients.map((item, index) => ({
      foodId: item.foodId,
      foodName: item.foodName,
      quantity: Number(item.quantity) || 0,
      unit: item.unit || 'g',
      sortOrder: index,
      nutrition: item.nutrition || emptyNutrition()
    }));

    const quantity = intake.eatenG > 0
      ? intake.eatenG
      : (intake.intakeMode === 'percent' ? intake.intakePercent : 0);

    wx.setStorageSync(RECIPE_PICKER_SELECTION_KEY, {
      items: [{
        localId: `meal_recipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        recipeId: recipe._id,
        recipeName: recipe.name,
        quantity,
        unit: 'g',
        intakeMode: intake.intakeMode,
        intakePercent: intake.intakePercent,
        batchWeightG: batch.totalWeightG,
        batchNutrition: batch.totalNutrition,
        nutritionPer100g: batch.nutritionPer100g,
        nutrition: intake.nutrition,
        proteinSource: batch.proteinSource,
        yieldWeightG: batch.totalWeightG,
        ingredientsSnapshot,
        sourceType: 'recipe'
      }]
    });

    // 返回记本顿页：跳过选择食谱页
    wx.navigateBack({ delta: 2 });
  }
});
