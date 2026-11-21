const RecipeModel = require('../../models/recipe');
const FoodModel = require('../../models/food');
const {
  matchRecipeBySearch,
  emptyNutrition,
  buildIngredientNutrition,
  summarizeRecipeNutrition,
  summarizePremiumProteinFromIngredients
} = require('../../utils/recipeNutritionUtils');

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

function buildDefaultPreview(ingredients = []) {
  const prepared = (ingredients || []).map((item) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const preserveMixedSnapshot = !!item.foodSnapshot?.nutritionPerBasis &&
      (item.foodSnapshot.proteinQuality === 'mixed' || item.food?.proteinQuality === 'mixed');
    const source = preserveMixedSnapshot ? item.foodSnapshot : item.food || item.foodSnapshot || {};
    return {
      quantity,
      unit: item.unit || 'g',
      proteinQuality: source.proteinQuality
        || item.proteinQuality
        || item.foodSnapshot?.proteinQuality
        || item.food?.proteinQuality
        || '',
      food: item.food || null,
      foodSnapshot: item.foodSnapshot || null,
      nutrition: quantity > 0
        ? buildIngredientNutrition(source, quantity)
        : emptyNutrition()
    };
  });
  const filledCount = prepared.filter((item) => item.quantity > 0).length;
  const yieldWeightG = Math.round(
    prepared.reduce((sum, item) => {
      if (!(item.quantity > 0) || !isWeightUnit(item.unit)) return sum;
      return sum + item.quantity;
    }, 0) * 100
  ) / 100;
  const summary = summarizeRecipeNutrition(prepared, yieldWeightG);
  const nutrition = summary.totalNutrition || emptyNutrition();
  const premium = summarizePremiumProteinFromIngredients(prepared);
  const premiumProtein = Number(premium.premiumProtein) || 0;
  const premiumRatio = Number(premium.premiumRatio) || 0;
  return {
    hasDefaults: filledCount > 0,
    filledCount,
    totalCount: prepared.length,
    totalWeightG: yieldWeightG,
    caloriesText: formatPreviewNumber(nutrition.calories, 0),
    proteinText: formatPreviewNumber(nutrition.protein, 2),
    carbsText: formatPreviewNumber(nutrition.carbs, 2),
    fatText: formatPreviewNumber(nutrition.fat, 2),
    premiumProteinText: (premium.premiumProteinEstimated ? '约' : '') + formatPreviewNumber(premiumProtein, 2),
    premiumRatio,
    showPremiumProtein: premiumProtein > 0 || !!premium.premiumProteinEstimated
  };
}

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

function mapRecipeListItem(recipe = {}) {
  const ingredientTags = (recipe.ingredients || [])
    .map((item) => item.foodName)
    .filter(Boolean);
  const name = recipe.name || '未命名食谱';
  const visibleTags = ingredientTags.slice(0, 4);
  return {
    _id: recipe._id,
    name,
    coverImageFileId: recipe.coverImageFileId || '',
    notes: recipe.notes || '',
    ingredients: recipe.ingredients || [],
    ingredientCount: ingredientTags.length,
    ingredientTags: visibleTags,
    moreIngredientCount: Math.max(ingredientTags.length - visibleTags.length, 0),
    ingredientLine: ingredientTags.length
      ? ingredientTags.join(' · ')
      : '还没加原料',
    ingredientNames: ingredientTags.join('、'),
    lastUsedText: formatLastUsedAt(recipe.lastUsedAt)
  };
}

Page({
  data: {
    mode: 'list',
    loading: true,
    saving: false,
    choosingCover: false,
    coverDraft: null,
    coverError: '',
    recentCover: null,
    searchQuery: '',
    recipes: [],
    filteredRecipes: [],
    recipeCount: 0,
    filteredCount: 0,
    // 曾经导入过的来源宝宝的食谱库更新提示（{ babyUid, name }），无则为 null
    libraryUpdateHint: null,
    recipeId: '',
    recipe: null,
    form: {
      name: '',
      notes: '',
      ingredients: [],
      steps: [],
      coverImageFileId: '',
      prepTimeSec: null
    },
    defaultPreview: buildDefaultPreview([])
  },

  async onLoad(options = {}) {
    this.foodCatalog = [];
    this.foodById = new Map();
    this._foodCatalogReady = false;
    this._foodCatalogPromise = null;
    // 食物库首次可能要拉系统索引（几十秒），不阻塞食谱列表/新建页
    this.ensureFoodCatalog();
    if (options.searchBabyUid && options.searchBabyUid !== getBabyUid()) { wx.showToast({ title: '宝宝已切换，请重新搜索', icon: 'none' }); return; }
    if (options.id) {
      await this.openRecipe(options.id, options.mode === 'edit' ? 'edit' : 'detail');
      return;
    }
    if (options.mode === 'create') {
      this.hasLoadedPage = true;
      this.setData({ loading: false });
      this.openCreate();
      return;
    }
    await this.loadRecipes();
  },

  onShow() {
    this.consumeIngredientSelection();
    this.loadLibraryUpdateHint();
  },

  onUnload() { this._unloaded = true; },

  // 曾经从其他宝宝导入过食谱时，检查来源宝宝的食谱库是否有新变化
  async loadLibraryUpdateHint() {
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const { getLibraryUpdateHints } = require('../../utils/babyDataImport');
      const hints = await getLibraryUpdateHints(babyUid, 'recipe_catalog');
      this.setData({ libraryUpdateHint: hints[0] || null });
    } catch (error) {
      this.setData({ libraryUpdateHint: null });
    }
  },

  onLibraryUpdateHintTap() {
    const hint = this.data.libraryUpdateHint;
    if (!hint || !hint.babyUid) return;
    wx.navigateTo({
      url: `/pkg-misc/baby-info/index?from=library&importFrom=${hint.babyUid}`
    });
  },

  async ensureFoodCatalog() {
    if (
      this._foodCatalogReady
      && this.foodById
      && this.foodById.size > 0
      && !FoodModel.hasCatalogChanged(this._seenCatalogGeneration)
    ) {
      return this.foodCatalog;
    }
    if (this._foodCatalogPromise) return this._foodCatalogPromise;
    this._foodCatalogPromise = this.loadFoodCatalog()
      .then((foods) => {
        this._foodCatalogReady = true;
        return foods;
      })
      .finally(() => {
        this._foodCatalogPromise = null;
      });
    return this._foodCatalogPromise;
  },

  async loadFoodCatalog() {
    const foods = await FoodModel.getAvailableFoods(getBabyUid(), {
      preferLocalSystemIndex: true
    });
    this.foodCatalog = foods || [];
    this.foodById = new Map(this.foodCatalog.map(food => [food._id, food]));
    this._seenCatalogGeneration = FoodModel.getCatalogGeneration();
    return this.foodCatalog;
  },

  async loadRecipes() {
    this.setData({ loading: true });
    const babyUid = getBabyUid();
    console.log('[recipe-management] loadRecipes start', { babyUid });
    if (!babyUid) {
      console.warn('[recipe-management] loadRecipes abort: no babyUid');
      this.hasLoadedPage = true;
      this.setData({
        mode: 'list',
        recipes: [],
        filteredRecipes: [],
        recipeCount: 0,
        filteredCount: 0,
        loading: false
      });
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
      this.setData({
        mode: 'list',
        recipes: [],
        filteredRecipes: [],
        recipeCount: 0,
        filteredCount: 0,
        loading: false
      });
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
      .map((recipe) => mapRecipeListItem(recipe));
    console.log('[recipe-management] setData recipes', {
      count: recipes.length,
      names: recipes.map((item) => item.name)
    });
    this.hasLoadedPage = true;
    this.setData({
      mode: 'list',
      recipes,
      recipeCount: recipes.length,
      loading: false
    }, () => this.applyRecipeSearch());
    wx.setNavigationBarTitle({ title: '食谱管理' });
  },

  applyRecipeSearch(query = this.data.searchQuery) {
    const keyword = String(query || '');
    const recipes = this.data.recipes || [];
    const filteredRecipes = recipes.filter((recipe) => matchRecipeBySearch(recipe, keyword));
    this.setData({
      searchQuery: keyword,
      filteredRecipes,
      filteredCount: filteredRecipes.length
    });
  },

  onSearchInput(e) {
    this.applyRecipeSearch(e.detail.value || '');
  },

  clearSearch() {
    this.applyRecipeSearch('');
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
    const form = this.createEmptyForm();
    this.setData({
      mode: 'edit',
      recipeId: '',
      recipe: null,
      form,
      coverDraft: null,
      coverError: '',
      defaultPreview: buildDefaultPreview(form.ingredients || [])
    });
    wx.setNavigationBarTitle({ title: '新建食谱' });
  },

  onRecipeTap(e) {
    this.openRecipe(e.currentTarget.dataset.id, 'detail');
  },

  onEditTap(e) {
    this.openRecipe(e.currentTarget.dataset.id || '', 'edit');
  },

  hydrateIngredient(ingredient = {}, index = 0) {
    const food = this.foodById.get(ingredient.foodId) || null;
    const snapshot = ingredient.foodSnapshot || {};
    const foodSnapshot = snapshot.name
      ? snapshot
      : (food ? FoodModel.buildFoodSnapshot(food) : snapshot);
    const unit = food?.baseUnit || ingredient.unit || foodSnapshot.nutritionBasis?.unit || 'g';
    const quantityNum = Math.max(0, Number(ingredient.quantity) || 0);
    const quantity = quantityNum > 0 ? String(quantityNum) : '';
    return {
      foodId: ingredient.foodId || food?._id || '',
      foodName: food?.name || ingredient.foodName || foodSnapshot.name || '未知食物',
      unit,
      quantity,
      quantityDisplay: quantity ? `${quantity}${unit}` : '',
      sortOrder: index,
      proteinQuality: ingredient.proteinQuality
        || food?.proteinQuality
        || foodSnapshot.proteinQuality
        || '',
      foodSnapshot,
      food: food || null,
      unavailable: !food,
      unavailableText: !food ? '原食物已不可用，将按快照记录' : ''
    };
  },

  refreshDefaultPreview(ingredients = this.data.form?.ingredients || []) {
    this.setData({
      defaultPreview: buildDefaultPreview(ingredients)
    });
  },

  async openRecipe(id, mode = 'detail') {
    if (!id) return;
    this.setData({ loading: true });
    await this.ensureFoodCatalog();
    const result = await RecipeModel.getById(id);
    if (!result.success || !result.data) {
      this.setData({ loading: false });
      wx.showToast({ title: result.message || '食谱不存在', icon: 'none' });
      return;
    }
    const recipe = result.data;
    if (recipe.babyUid !== getBabyUid() || recipe.status === 'deleted' || recipe.deletedAt) { this.setData({ loading: false }); wx.showToast({ title: '食谱已变化或无访问权限', icon: 'none' }); return; }
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
      form,
      coverDraft: null,
      coverError: '',
      defaultPreview: buildDefaultPreview(ingredients)
    });
    wx.setNavigationBarTitle({ title: mode === 'edit' ? '编辑食谱' : '食谱详情' });
    if (unavailableCount > 0) {
      wx.showToast({ title: '部分原食物已不可用，将按快照', icon: 'none' });
    }
  },

  editRecipe() {
    if (!this.data.recipeId) return;
    this.setData({
      mode: 'edit',
      defaultPreview: buildDefaultPreview(this.data.form?.ingredients || [])
    });
    wx.setNavigationBarTitle({ title: '编辑食谱' });
  },

  async backToList() {
    await this.loadRecipes();
  },

  onNameInput(e) {
    this.setData({ 'form.name': e.detail.value });
  },

  async onChooseCover() {
    if (this.data.saving || this.data.choosingCover) return;
    this.setData({ choosingCover: true });
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'],
        sourceType: ['album', 'camera'], sizeType: ['compressed'] });
      const photo = result.tempFiles?.[0];
      if (!photo?.tempFilePath) return;
      if (photo.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的封面图');
      const info = await wx.getImageInfo({ src: photo.tempFilePath });
      const type = String(info.type || '').toLowerCase().replace(/^jpeg$/, 'jpg');
      if (!['jpg', 'png', 'webp', 'gif'].includes(type)) throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片');
      if (!this._unloaded && this.data.mode === 'edit') {
        this.setData({ coverDraft: { path: photo.tempFilePath, type, fileId: '' }, coverError: '' });
      }
    } catch (error) {
      if (!this._unloaded && !/cancel/i.test(error.errMsg || '')) {
        this.setData({ coverError: error.message || '选取失败，请重新选择图片。' });
      }
    } finally {
      if (!this._unloaded) this.setData({ choosingCover: false });
    }
  },

  onRemoveCover() {
    if (this.data.saving || this.data.choosingCover) return;
    // 有待保存的新图时只撤销这次选图，恢复原封面。
    const updates = { coverDraft: null, coverError: '' };
    if (!this.data.coverDraft) updates['form.coverImageFileId'] = '';
    this.setData(updates);
  },

  onNotesInput(e) {
    this.setData({ 'form.notes': e.detail.value });
  },

  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredients = this.data.form.ingredients
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }));
    this.setData({
      'form.ingredients': ingredients,
      defaultPreview: buildDefaultPreview(ingredients)
    });
  },

  onDefaultQuantityInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    const raw = e.detail.value;
    if (!this._defaultQuantityDrafts) this._defaultQuantityDrafts = {};
    this._defaultQuantityDrafts[index] = raw;
    // 输入中只刷新营养预览，避免受控输入把光标顶掉
    const previewIngredients = (this.data.form.ingredients || []).map((item, itemIndex) => (
      itemIndex === index ? { ...item, quantity: raw } : item
    ));
    this.setData({
      defaultPreview: buildDefaultPreview(previewIngredients)
    });
  },

  onDefaultQuantityBlur(e) {
    const index = Number(e.currentTarget.dataset.index);
    const ingredients = [...(this.data.form.ingredients || [])];
    if (!ingredients[index]) return;
    const draft = this._defaultQuantityDrafts
      ? this._defaultQuantityDrafts[index]
      : undefined;
    const raw = draft === undefined ? e.detail.value : draft;
    if (this._defaultQuantityDrafts) delete this._defaultQuantityDrafts[index];
    const quantityNum = Math.max(0, Number(raw) || 0);
    const quantity = quantityNum > 0 ? String(quantityNum) : '';
    const unit = ingredients[index].unit || 'g';
    ingredients[index] = {
      ...ingredients[index],
      quantity,
      quantityDisplay: quantity ? `${quantity}${unit}` : ''
    };
    this.setData({
      [`form.ingredients[${index}].quantity`]: quantity,
      [`form.ingredients[${index}].quantityDisplay`]: quantity ? `${quantity}${unit}` : '',
      defaultPreview: buildDefaultPreview(ingredients)
    });
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

  async consumeIngredientSelection() {
    if (this.data.mode !== 'edit') return;
    let selection = null;
    try {
      selection = wx.getStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);
    } catch (error) {
      return;
    }
    if (!selection || !Array.isArray(selection.foodIds) || !selection.foodIds.length) return;
    wx.removeStorageSync(RECIPE_INGREDIENT_PICKER_SELECTION_KEY);

    await this.ensureFoodCatalog();

    const existingIds = new Set(
      (this.data.form.ingredients || []).map(item => item.foodId).filter(Boolean)
    );
    const resolveAddedIngredients = () => {
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
            quantity: 0,
            foodSnapshot: FoodModel.buildFoodSnapshot(food),
            food
          }, (this.data.form.ingredients || []).length);
        })
        .filter(Boolean)
        .map((item, index) => ({
          ...item,
          sortOrder: (this.data.form.ingredients || []).length + index
        }));
      return { added, missingIds };
    };

    let { added, missingIds } = resolveAddedIngredients();
    if (missingIds.length) {
      this._foodCatalogReady = false;
      await this.ensureFoodCatalog();
      ({ added, missingIds } = resolveAddedIngredients());
    }

    if (!added.length) {
      if (missingIds.length) {
        wx.showToast({ title: '部分食物加载失败，请重试', icon: 'none' });
      }
      return;
    }

    const nextIngredients = [...(this.data.form.ingredients || []), ...added];
    this.setData({
      mode: 'edit',
      'form.ingredients': nextIngredients,
      defaultPreview: buildDefaultPreview(nextIngredients)
    });
  },

  buildSavePayload() {
    const form = this.data.form;
    const ingredients = (form.ingredients || []).map((item, index) => {
      const food = item.unavailable ? null : (item.food || this.foodById.get(item.foodId));
      const foodSnapshot = item.foodSnapshot
        || (food ? FoodModel.buildFoodSnapshot(food) : {});
      return {
        foodId: item.foodId,
        foodName: item.foodName,
        quantity: Math.max(0, Number(item.quantity) || 0),
        unit: item.unit,
        sortOrder: index,
        proteinQuality: item.proteinQuality
          || food?.proteinQuality
          || foodSnapshot.proteinQuality
          || '',
        food,
        foodSnapshot
      };
    });
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
    if (this.data.saving || this.data.loading || this.data.choosingCover) return;
    const { recipeId, coverDraft } = this.data;
    const babyUid = getBabyUid();
    const app = getApp();
    const currentOperator = () => app.globalData.openid || wx.getStorageSync('openid') || '';
    const operatorOpenid = currentOperator();
    const isCurrent = () => !this._unloaded && this.data.mode === 'edit'
      && this.data.recipeId === recipeId && getBabyUid() === babyUid && currentOperator() === operatorOpenid;
    this.setData({ saving: true, coverError: '' });
    let loading = false;
    let uploadingCover = false;
    let result;
    let failure = '';
    try {
      await this.ensureFoodCatalog();
      if (!isCurrent()) return;
      const payload = { ...this.buildSavePayload(), operatorOpenid };
      if (!payload.name) throw new Error('请输入食谱名称');
      if (!payload.ingredients.length) throw new Error('请至少添加一种原料');
      if (!babyUid) throw new Error('未找到宝宝信息');

      let coverFileId = coverDraft?.fileId;
      if (coverDraft && !coverFileId) {
        wx.showLoading({ title: '正在上传封面', mask: true });
        loading = true;
        uploadingCover = true;
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${coverDraft.type}`;
        const cloudPath = `recipe_covers/${encodeURIComponent(babyUid)}/${encodeURIComponent(operatorOpenid || 'owner')}/${fileName}`;
        const { fileID } = await wx.cloud.uploadFile({ cloudPath, filePath: coverDraft.path });
        if (!fileID) throw new Error('封面上传失败，请重试');
        if (!isCurrent()) return;
        coverFileId = fileID;
        uploadingCover = false;
        // 保留本地预览，保存食谱失败时可复用已上传的文件。
        this.setData({ 'coverDraft.fileId': fileID });
      }
      if (coverFileId) payload.coverImageFileId = coverFileId;
      wx.showLoading({ title: '正在保存食谱', mask: true });
      loading = true;
      result = recipeId ? await RecipeModel.update(recipeId, payload, babyUid) : await RecipeModel.create(payload);
    } catch (error) {
      failure = uploadingCover ? '封面上传失败，可重试保存' : error.message || '保存失败，请重试';
    } finally {
      if (loading) wx.hideLoading();
      if (!this._unloaded) this.setData({ saving: false });
    }
    if (!isCurrent()) return;
    if (!result?.success) {
      if (uploadingCover) this.setData({ coverError: '封面上传失败，图片已保留。再次保存即可重试。' });
      wx.showToast({ title: failure || result?.message || '保存失败', icon: 'none' });
      return;
    }
    const savedCover = this.data.coverDraft;
    if (savedCover?.fileId) {
      this.setData({ recentCover: { fileId: savedCover.fileId, path: savedCover.path } });
    }
    if (!recipeId && result.readable === false) {
      wx.showModal({
        title: '已保存但读回失败',
        content: `请到云开发控制台检查 recipe_catalog 权限（建议与 food_catalog 一致），并确认记录 babyUid=${babyUid}`,
        showCancel: false
      });
    } else {
      wx.showToast({ title: '保存成功', icon: 'success' });
    }
    await this.loadRecipes();
  },

  onDeleteTap(e) {
    this.confirmDeleteRecipe(e.currentTarget.dataset.id || '');
  },

  deleteRecipe() {
    this.confirmDeleteRecipe(this.data.recipeId);
  },

  confirmDeleteRecipe(id) {
    if (!id) return;
    wx.showModal({
      title: '删除这道食谱？',
      content: '只会从食谱列表里去掉，不会改已保存的喂养记录。历史那几顿仍按当时快照显示名称和营养。',
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
