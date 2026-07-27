const RecipeModel = require('../models/recipe');
const FoodModel = require('../../models/food');
const { getBabyUid } = require('../../utils/index');
const {
  buildIngredientNutrition,
  summarizeBatchFromIngredients,
  summarizePremiumProteinFromIngredients,
  scalePremiumProteinSummary,
  combinePremiumProteinWithDay,
  resolveBatchIntake,
  emptyNutrition
} = require('../../utils/recipeNutritionUtils');
const {
  getNutritionTargetPreferences
} = require('../../utils/nutritionTargetPreferences');
const {
  buildEntryTargetPreview,
  normalizeSummary,
  addSummaries
} = require('../../utils/nutritionTargetPreview');
const {
  saveLastBatchQuantities,
  readLastBatchQuantities
} = require('../utils/recipeBatchQuantityMemory');

const RECIPE_PICKER_SELECTION_KEY = 'meal_recipe_picker_selection';
const RECIPE_DAY_PROTEIN_CONTEXT_KEY = 'meal_recipe_day_protein_context';

function readRecipeBatchTargetContext() {
  const empty = {
    currentSummary: normalizeSummary(),
    previousSummary: normalizeSummary(),
    baseMealSummary: normalizeSummary(),
    weight: '',
    targetPreferences: {},
    dayNaturalProtein: 0,
    dayPremiumProtein: 0
  };
  try {
    const context = wx.getStorageSync(RECIPE_DAY_PROTEIN_CONTEXT_KEY);
    if (!context || (context.schemaVersion !== 1 && context.schemaVersion !== 2)) {
      return empty;
    }
    // schemaVersion 1: 仅优质蛋白基底；2: 完整目标预览上下文
    return {
      currentSummary: normalizeSummary(context.currentSummary || {}),
      previousSummary: normalizeSummary(context.previousSummary || {}),
      baseMealSummary: normalizeSummary(context.baseMealSummary || {}),
      weight: context.weight || '',
      targetPreferences: context.targetPreferences || {},
      dayNaturalProtein: Number(
        context.dayNaturalProtein !== undefined
          ? context.dayNaturalProtein
          : context.naturalProtein
      ) || 0,
      dayPremiumProtein: Number(
        context.dayPremiumProtein !== undefined
          ? context.dayPremiumProtein
          : context.premiumProtein
      ) || 0
    };
  } catch (error) {
    return empty;
  }
}

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
    proteinSplit: snapshot.proteinSplit || null,
    proteinQuality: snapshot.proteinQuality || ''
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
    liveCurrentByIndex: [],
    hasDefaultQuantities: false,
    hasLastQuantities: false,
    showQtyActions: false,
    focusedQuantityIndex: -1,
    focusedIntake: false,
    intakeValueMissing: false,
    intakeMode: 'grams',
    intakeValue: '',
    batchPreview: {
      totalWeightG: 0,
      totalProtein: '0.00',
      totalCalories: '0',
      totalCarbs: '0',
      totalFat: '0',
      premiumProteinText: '0.00',
      premiumRatio: 0,
      showPremiumProtein: false,
      canUseGramsIntake: true
    },
    intakePreview: {
      visible: false,
      tip: '',
      calories: '0',
      protein: '0.00',
      naturalProtein: '0.00',
      specialProtein: '0.00',
      carbs: '0',
      fat: '0',
      eatenGText: '',
      showPremium: false,
      premiumValue: '0.00',
      showDayPremiumRatio: false,
      dayPremiumRatio: 0
    },
    intakeTargetPreview: null
  },

  async onLoad(options = {}) {
    const recipeId = decodeURIComponent(options.recipeId || '');
    this.foodById = new Map();
    this._recipe = null;
    this._quantityDrafts = {};
    this._intakeDraft = '';
    this._targetContext = readRecipeBatchTargetContext();
    this._dayProteinContext = {
      naturalProtein: this._targetContext.dayNaturalProtein,
      premiumProtein: this._targetContext.dayPremiumProtein
    };

    if (!recipeId) {
      wx.showToast({ title: '缺少食谱信息', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 300);
      return;
    }

    this.setData({ loading: true, recipeId });
    this.refreshIntakeTargetPreview();
    await this.loadFoodCatalog();
    await this.loadRecipe(recipeId);
  },

  buildIntakeDraftSummary(nutrition = null) {
    const context = this._targetContext || {};
    const intakeSummary = nutrition
      ? normalizeSummary({
        calories: nutrition.calories,
        protein: nutrition.protein,
        naturalProtein: nutrition.naturalProtein,
        specialProtein: nutrition.specialProtein,
        premiumProtein: nutrition.premiumProtein,
        carbs: nutrition.carbs,
        fat: nutrition.fat
      })
      : normalizeSummary();
    return addSummaries(context.baseMealSummary || {}, intakeSummary);
  },

  buildIntakeTargetPreview(nutrition = null) {
    const context = this._targetContext;
    if (!context) return null;
    return buildEntryTargetPreview({
      currentSummary: context.currentSummary || {},
      draftSummary: this.buildIntakeDraftSummary(nutrition),
      previousSummary: context.previousSummary || {},
      weight: context.weight,
      targetPreferences: context.targetPreferences || {},
      includeCalories: true
    });
  },

  refreshIntakeTargetPreview(nutrition = null) {
    const intakeTargetPreview = this.buildIntakeTargetPreview(nutrition);
    this.setData({ intakeTargetPreview });
    return intakeTargetPreview;
  },

  async handleNutritionTargetsSaved() {
    const context = this._targetContext;
    if (!context) return;
    const babyUid = getBabyUid();
    if (!babyUid) {
      this.refreshIntakePreview();
      return;
    }
    try {
      const preferences = await getNutritionTargetPreferences(babyUid);
      this._targetContext = {
        ...context,
        targetPreferences: {
          naturalProteinCoefficient: preferences.naturalProteinCoefficient || '',
          specialProteinCoefficient: preferences.specialProteinCoefficient || '',
          calorieCoefficient: preferences.calorieCoefficient || ''
        }
      };
    } catch (error) {
      console.warn('刷新食谱页目标系数失败:', error);
    }
    this.refreshIntakePreview();
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
      const defaultQuantity = Number(item.quantity) > 0 ? String(Number(item.quantity)) : '';
      const nutrition = defaultQuantity
        ? buildIngredientNutrition(source, Number(defaultQuantity) || 0)
        : emptyNutrition();
      const current = buildCurrentNutritionDisplay(nutrition, defaultQuantity);
      return {
        foodId: item.foodId || '',
        foodName: food?.name || item.foodName || snapshot.name || `原料${index + 1}`,
        unit,
        quantity: defaultQuantity,
        proteinQuality: item.proteinQuality
          || food?.proteinQuality
          || snapshot.proteinQuality
          || '',
        foodSnapshot: snapshot,
        nutrition,
        per100Label: per100.per100Label,
        per100Text: per100.per100Text,
        hasCurrentNutrition: current.hasCurrentNutrition,
        currentText: current.currentText
      };
    });

    const unitPreview = summarizeBatchFromIngredients(draftIngredients);
    const canUseGramsIntake = !!unitPreview.canUseGramsIntake;
    const hasDefaultQuantities = (recipe.ingredients || []).some(
      (item) => Number(item.quantity) > 0
    );
    const lastIngredients = readLastBatchQuantities(getBabyUid(), recipe._id);
    const lastFoodIds = new Set(lastIngredients.map((item) => item.foodId));
    const hasLastQuantities = lastIngredients.length > 0
      && draftIngredients.some((item) => lastFoodIds.has(String(item.foodId || '').trim()));
    const liveCurrentByIndex = draftIngredients.map((item) => ({
      hasCurrentNutrition: !!item.hasCurrentNutrition,
      currentText: item.currentText || ''
    }));
    this.setData({
      loading: false,
      recipeId: recipe._id,
      recipeName: recipe.name || '未命名食谱',
      draftIngredients,
      liveCurrentByIndex,
      hasDefaultQuantities,
      hasLastQuantities,
      showQtyActions: hasDefaultQuantities || hasLastQuantities || draftIngredients.length > 0,
      // 默认按克数；含非克单位时回退百分比
      intakeMode: canUseGramsIntake ? 'grams' : 'percent',
      intakeValue: '',
      batchPreview: {
        totalWeightG: 0,
        totalProtein: '0.00',
        totalCalories: '0',
        totalCarbs: '0',
        totalFat: '0',
        premiumProteinText: '0.00',
        premiumRatio: 0,
        showPremiumProtein: false,
        canUseGramsIntake
      }
    }, () => this.refreshBatchPreview());
  },

  applyIngredientQuantities(resolveQuantity) {
    this._quantityDrafts = {};
    const liveCurrentByIndex = [];
    const draftIngredients = (this.data.draftIngredients || []).map((item, index) => {
      const quantityNum = Math.max(0, Number(resolveQuantity(item, index)) || 0);
      const quantity = quantityNum > 0 ? String(quantityNum) : '';
      const live = this.buildLiveCurrentEntry(item, quantity);
      liveCurrentByIndex[index] = {
        hasCurrentNutrition: live.hasCurrentNutrition,
        currentText: live.currentText
      };
      return {
        ...item,
        quantity,
        nutrition: live.nutrition,
        hasCurrentNutrition: live.hasCurrentNutrition,
        currentText: live.currentText,
        quantityMissing: quantity ? false : !!item.quantityMissing
      };
    });
    this.setData({
      draftIngredients,
      liveCurrentByIndex,
      focusedQuantityIndex: -1
    }, () => this.refreshBatchPreview());
  },

  clearAllQuantities() {
    this.applyIngredientQuantities(() => 0);
  },

  applyDefaultQuantities() {
    const recipeIngredients = this._recipe?.ingredients || [];
    const byFoodId = new Map();
    recipeIngredients.forEach((item = {}) => {
      const foodId = String(item.foodId || '').trim();
      const quantity = Math.max(0, Number(item.quantity) || 0);
      if (foodId && quantity > 0) byFoodId.set(foodId, quantity);
    });
    const hasDefault = byFoodId.size > 0
      || recipeIngredients.some((item) => Number(item.quantity) > 0);
    if (!hasDefault) {
      wx.showToast({ title: '还没设默认份量', icon: 'none' });
      return;
    }
    this.applyIngredientQuantities((item, index) => {
      const foodId = String(item.foodId || '').trim();
      if (foodId && byFoodId.has(foodId)) return byFoodId.get(foodId);
      return recipeIngredients[index]?.quantity;
    });
    wx.showToast({ title: '已填入默认份量', icon: 'none' });
  },

  applyLastQuantities() {
    const recipeId = this.data.recipeId || this._recipe?._id || '';
    const lastIngredients = readLastBatchQuantities(getBabyUid(), recipeId);
    if (!lastIngredients.length) {
      wx.showToast({ title: '还没有上次用量', icon: 'none' });
      return;
    }
    const byFoodId = new Map(
      lastIngredients.map((item) => [item.foodId, item.quantity])
    );
    const matched = (this.data.draftIngredients || []).some((item) => (
      byFoodId.has(String(item.foodId || '').trim())
    ));
    if (!matched) {
      wx.showToast({ title: '上次用量对不上当前原料', icon: 'none' });
      return;
    }
    this.applyIngredientQuantities((item) => {
      const foodId = String(item.foodId || '').trim();
      return byFoodId.has(foodId) ? byFoodId.get(foodId) : 0;
    });
    wx.showToast({ title: '已填入上次份量', icon: 'none' });
  },

  buildLiveCurrentEntry(ingredient = {}, quantityRaw = '') {
    const source = this.getIngredientSource(ingredient);
    const quantityNum = Math.max(0, Number(quantityRaw) || 0);
    const nutrition = quantityNum > 0
      ? buildIngredientNutrition(source, quantityNum)
      : emptyNutrition();
    const current = buildCurrentNutritionDisplay(nutrition, quantityRaw);
    return {
      nutrition,
      hasCurrentNutrition: current.hasCurrentNutrition,
      currentText: current.currentText
    };
  },

  onIngredientQuantityInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    const raw = e.detail.value;
    if (!this._quantityDrafts) this._quantityDrafts = {};
    this._quantityDrafts[index] = raw;

    const ingredient = this.data.draftIngredients[index];
    if (!ingredient) {
      this.refreshBatchPreview();
      return;
    }
    const live = this.buildLiveCurrentEntry(ingredient, raw);
    // 行内「本次」走独立字段，避免改 draftIngredients 把受控输入顶回旧值
    this.setData({
      [`liveCurrentByIndex[${index}]`]: {
        hasCurrentNutrition: live.hasCurrentNutrition,
        currentText: live.currentText
      }
    }, () => this.refreshBatchPreview());
  },

  onIngredientQuantityBlur(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredient = this.data.draftIngredients[index];
    if (!ingredient) return;
    const draft = this._quantityDrafts ? this._quantityDrafts[index] : undefined;
    const quantity = draft === undefined ? e.detail.value : draft;
    if (this._quantityDrafts) delete this._quantityDrafts[index];

    const live = this.buildLiveCurrentEntry(ingredient, quantity);
    const updates = {
      focusedQuantityIndex: -1,
      [`draftIngredients[${index}].quantity`]: quantity,
      [`draftIngredients[${index}].nutrition`]: live.nutrition,
      [`draftIngredients[${index}].hasCurrentNutrition`]: live.hasCurrentNutrition,
      [`draftIngredients[${index}].currentText`]: live.currentText,
      [`draftIngredients[${index}].quantityMissing`]: !(Number(quantity) > 0) && !!ingredient.quantityMissing,
      [`liveCurrentByIndex[${index}]`]: {
        hasCurrentNutrition: live.hasCurrentNutrition,
        currentText: live.currentText
      }
    };
    this.setData(updates, () => this.refreshBatchPreview());
  },

  focusMissingIngredientQuantity(index) {
    if (!Number.isFinite(index) || index < 0) return;
    const scrollToTarget = () => {
      if (typeof wx.createSelectorQuery !== 'function' || typeof wx.pageScrollTo !== 'function') {
        return;
      }
      wx.createSelectorQuery()
        .select(`#ingredient-block-${index}`)
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec((res = []) => {
          const rect = res[0];
          const viewport = res[1];
          if (!rect || !viewport) return;
          wx.pageScrollTo({
            scrollTop: Math.max((viewport.scrollTop || 0) + rect.top - 120, 0),
            duration: 220
          });
        });
    };

    // focus 需先置 false 再 true，才能重复聚焦
    this.setData({ focusedQuantityIndex: -1 }, () => {
      this.setData({ focusedQuantityIndex: index }, () => {
        setTimeout(scrollToTarget, 40);
      });
    });
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
      intakeValue: '',
      intakeValueMissing: false,
      focusedIntake: false
    }, () => this.refreshIntakePreview());
  },

  onIntakeValueInput(e) {
    const intakeValue = e.detail.value;
    this._intakeDraft = intakeValue;
    const updates = { intakeValue };
    if (this.data.intakeValueMissing && Number(intakeValue) > 0) {
      updates.intakeValueMissing = false;
    }
    this.setData(updates, () => this.refreshIntakePreview());
  },

  onIntakeValueBlur(e) {
    const intakeValue = this._intakeDraft === undefined ? e.detail.value : this._intakeDraft;
    this._intakeDraft = undefined;
    this.setData({
      intakeValue,
      focusedIntake: false,
      intakeValueMissing: this.data.intakeValueMissing && !(Number(intakeValue) > 0)
    }, () => this.refreshIntakePreview());
  },

  focusIntakeValueInput() {
    const scrollToTarget = () => {
      if (typeof wx.createSelectorQuery !== 'function' || typeof wx.pageScrollTo !== 'function') {
        return;
      }
      wx.createSelectorQuery()
        .select('#intake-value-row')
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec((res = []) => {
          const rect = res[0];
          const viewport = res[1];
          if (!rect || !viewport) return;
          wx.pageScrollTo({
            scrollTop: Math.max((viewport.scrollTop || 0) + rect.top - 120, 0),
            duration: 220
          });
        });
    };

    this.setData({ focusedIntake: false }, () => {
      this.setData({ focusedIntake: true }, () => {
        setTimeout(scrollToTarget, 40);
      });
    });
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

  buildLiveIngredients() {
    return (this.data.draftIngredients || []).map((item, index) => {
      const draft = this._quantityDrafts ? this._quantityDrafts[index] : undefined;
      const quantityRaw = draft === undefined ? item.quantity : draft;
      const quantity = Math.max(0, Number(quantityRaw) || 0);
      const source = this.getIngredientSource(item);
      const nutrition = quantity > 0
        ? buildIngredientNutrition(source, quantity)
        : emptyNutrition();
      return {
        ...item,
        quantity,
        nutrition
      };
    });
  },

  refreshBatchPreview() {
    const prepared = this.buildLiveIngredients();
    const summary = summarizeBatchFromIngredients(prepared);
    const premium = summarizePremiumProteinFromIngredients(prepared);
    const premiumProtein = Number(premium.premiumProtein) || 0;
    const premiumRatio = Number(premium.premiumRatio) || 0;
    const nextMode = (!summary.canUseGramsIntake && this.data.intakeMode === 'grams')
      ? 'percent'
      : this.data.intakeMode;
    const modeChanged = nextMode !== this.data.intakeMode;
    if (modeChanged) {
      this._intakeDraft = '';
    }
    const nextIntakeValue = modeChanged ? '' : this.data.intakeValue;
    this.setData({
      intakeMode: nextMode,
      intakeValue: nextIntakeValue,
      batchPreview: {
        totalWeightG: summary.totalWeightG,
        totalProtein: formatNumber(summary.totalNutrition.protein),
        totalCalories: formatNumber(summary.totalNutrition.calories, 0),
        totalCarbs: formatNumber(summary.totalNutrition.carbs, 0),
        totalFat: formatNumber(summary.totalNutrition.fat, 0),
        premiumProteinText: formatNumber(premiumProtein),
        premiumRatio,
        showPremiumProtein: premiumProtein > 0,
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
      naturalProtein: '0.00',
      specialProtein: '0.00',
      carbs: '0',
      fat: '0',
      eatenGText: '',
      showPremium: false,
      premiumValue: '0.00',
      premiumRatio: 0,
      showDayPremiumRatio: false,
      dayPremiumRatio: 0
    };

    const intakeValue = this._intakeDraft === undefined
      ? this.data.intakeValue
      : this._intakeDraft;
    const value = Number(intakeValue);
    if (!Number.isFinite(value) || value <= 0) {
      this.setData({
        intakePreview: emptyPreview,
        intakeTargetPreview: this.buildIntakeTargetPreview(null)
      });
      return;
    }

    const prepared = this.buildLiveIngredients();
    if (!prepared.some((item) => item.quantity > 0)) {
      this.setData({
        intakePreview: {
          ...emptyPreview,
          tip: '请先填写原料用量'
        },
        intakeTargetPreview: this.buildIntakeTargetPreview(null)
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
      const premiumSummary = scalePremiumProteinSummary(
        summarizePremiumProteinFromIngredients(prepared),
        (Number(intake.intakePercent) || 0) / 100
      );
      const naturalProtein = Number(intake.nutrition.naturalProtein) || 0;
      const dayCombined = combinePremiumProteinWithDay(
        this._dayProteinContext || { naturalProtein: 0, premiumProtein: 0 },
        premiumSummary.premiumProtein,
        naturalProtein
      );
      this.setData({
        intakePreview: {
          visible: true,
          tip: '',
          calories: formatNumber(intake.nutrition.calories, 0),
          protein: formatNumber(intake.nutrition.protein),
          naturalProtein: formatNumber(intake.nutrition.naturalProtein),
          specialProtein: formatNumber(intake.nutrition.specialProtein),
          carbs: formatNumber(intake.nutrition.carbs, 0),
          fat: formatNumber(intake.nutrition.fat, 0),
          eatenGText: intake.eatenG > 0 ? `${formatNumber(intake.eatenG, 1)}g` : '',
          showPremium: naturalProtein > 0 || premiumSummary.premiumProtein > 0,
          premiumValue: formatNumber(premiumSummary.premiumProtein),
          premiumRatio: Number(premiumSummary.premiumRatio) || 0,
          showDayPremiumRatio: dayCombined.naturalProtein > 0,
          dayPremiumRatio: dayCombined.premiumRatio
        },
        intakeTargetPreview: this.buildIntakeTargetPreview({
          ...intake.nutrition,
          premiumProtein: premiumSummary.premiumProtein
        })
      });
    } catch (error) {
      this.setData({
        intakePreview: {
          ...emptyPreview,
          tip: error.message || '请检查摄入量'
        },
        intakeTargetPreview: this.buildIntakeTargetPreview(null)
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
    const missingIndex = draftIngredients.findIndex((item) => !(Number(item.quantity) > 0));
    if (missingIndex >= 0) {
      const markedIngredients = draftIngredients.map((item, index) => ({
        ...item,
        quantityMissing: !(Number(item.quantity) > 0)
      }));
      this.setData({ draftIngredients: markedIngredients });
      this.focusMissingIngredientQuantity(missingIndex);
      const missingName = draftIngredients[missingIndex].foodName || '原料';
      wx.showToast({ title: `请填写${missingName}用量`, icon: 'none' });
      return;
    }

    const batch = summarizeBatchFromIngredients(draftIngredients);
    if (!(Number(intakeValue) > 0)) {
      this.setData({ intakeValueMissing: true });
      this.focusIntakeValueInput();
      wx.showToast({
        title: this.data.intakeMode === 'percent' ? '请填写摄入百分比' : '请填写实际克数',
        icon: 'none'
      });
      return;
    }

    let intake;
    try {
      intake = resolveBatchIntake(
        batch.totalNutrition,
        batch.totalWeightG,
        this.data.intakeMode,
        intakeValue
      );
    } catch (error) {
      this.setData({ intakeValueMissing: true });
      this.focusIntakeValueInput();
      wx.showToast({ title: error.message || '请检查摄入量', icon: 'none' });
      return;
    }

    if (intake.intakeMode === 'grams' && !batch.canUseGramsIntake) {
      this.setData({ intakeValueMissing: true });
      this.focusIntakeValueInput();
      wx.showToast({ title: '含非克单位原料时请用百分比', icon: 'none' });
      return;
    }

    this.setData({ intakeValueMissing: false, focusedIntake: false });

    const ingredientsSnapshot = draftIngredients.map((item, index) => {
      const source = this.getIngredientSource(item) || {};
      return {
        foodId: item.foodId,
        foodName: item.foodName,
        quantity: Number(item.quantity) || 0,
        unit: item.unit || 'g',
        sortOrder: index,
        nutrition: item.nutrition || emptyNutrition(),
        proteinQuality: source.proteinQuality
          || item.foodSnapshot?.proteinQuality
          || item.proteinQuality
          || '',
        foodSnapshot: item.foodSnapshot || slimFoodSnapshot(source)
      };
    });

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

    saveLastBatchQuantities(getBabyUid(), recipe._id, ingredientsSnapshot);

    // 返回记本顿页：跳过选择食谱页
    wx.navigateBack({ delta: 2 });
  }
});
