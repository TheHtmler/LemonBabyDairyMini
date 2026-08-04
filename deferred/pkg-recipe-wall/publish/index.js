const FoodModel = require('../../models/food');
const {
  DIFFICULTY_OPTIONS,
  RECIPE_WALL_TAG_SUGGESTIONS,
  RECIPE_WALL_TAG_MAX_COUNT,
  RECIPE_WALL_TAG_MAX_LEN,
  normalizeTagItem,
  normalizeDraftPayload,
  validatePublishPayload,
  formatRecipeWallAuthorLabel
} = require('../../utils/recipeWallUtils');
const { compressRecipeWallImage } = require('../utils/recipeWallImage');
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

function defaultDisplayName(role) {
  if (role === 'creator') return '创建者';
  if (role === 'participant') return '参与者';
  return '';
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
    postId: '',
    editingStatus: '', // '' | draft | published | taken_down
    canSaveDraft: true,
    submitBtnText: '发布',
    submitting: false,
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
    tagSuggestions: RECIPE_WALL_TAG_SUGGESTIONS,
    selectedTags: [],
    selectedTagSet: {},
    customTagInput: '',
    tagMaxCount: RECIPE_WALL_TAG_MAX_COUNT,
    tagMaxLen: RECIPE_WALL_TAG_MAX_LEN,
    showAdjustSheet: false,
    babyUid: '',
    babyName: '',
    authorDisplayName: '',
    authorAvatar: '',
    tipText: '',
    authorReady: false,
    savingDraft: false,
    focusedStepIndex: -1,
    nutritionPreview: {
      caloriesText: '0',
      proteinText: '0.00',
      carbsText: '0.00',
      fatText: '0.00'
    }
  },

  foodById: null,

  onLoad(options = {}) {
    this.foodById = new Map();
    const postId = String(options.id || '').trim();
    if (postId) {
      this.setData({ postId });
      this.loadOwnDraft(postId);
    }
  },

  onShow() {
    this.loadAuthorContext();
    this.consumeIngredientSelection();
  },

  async loadRelationDisplayName(userRole, babyUid) {
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    if (!openid || !babyUid || !userRole) return '';

    const collectionName = userRole === 'creator'
      ? 'baby_creators'
      : (userRole === 'participant' ? 'baby_participants' : '');
    if (!collectionName) return '';

    try {
      const db = wx.cloud.database();
      const res = await db.collection(collectionName).where({
        _openid: openid,
        babyUid
      }).limit(1).get();
      const relation = (res.data && res.data[0]) || null;
      return String(relation?.displayName || '').trim();
    } catch (error) {
      console.error('读取食谱墙作者展示名失败:', error);
      return '';
    }
  },

  async loadAuthorContext() {
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || '';
    const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
    let babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};

    if (babyUid && app.getBabyInfo) {
      babyInfo = await app.getBabyInfo({ refreshAvatar: false }).catch(() => babyInfo);
    }

    const babyName = String(babyInfo?.name || '').trim();
    const cacheKey = displayNameCacheKey(babyUid, userRole);
    const cachedDisplayName = String((cacheKey ? wx.getStorageSync(cacheKey) : '') || '').trim();
    const relationDisplayName = await this.loadRelationDisplayName(userRole, babyUid);
    const creatorInfoName = userRole === 'creator'
      ? String(babyInfo?.creatorInfo?.displayName || '').trim()
      : '';

    let authorDisplayName = relationDisplayName
      || cachedDisplayName
      || creatorInfoName
      || defaultDisplayName(userRole);

    if (relationDisplayName && cacheKey) {
      try {
        wx.setStorageSync(cacheKey, relationDisplayName);
      } catch (error) {}
    }

    const authorAvatar = app.globalData.userInfo?.avatarUrl || '';
    const authorReady = !!(babyUid && babyName && authorDisplayName);

    this.setData({
      babyUid,
      babyName,
      authorDisplayName,
      authorAvatar,
      authorReady,
      tipText: this.buildTipText(authorReady, this.data.editingStatus)
    });
  },

  buildTipText(authorReady, editingStatus = '') {
    if (!authorReady) return '请先完善宝宝昵称与个人展示名称后再发布';
    if (editingStatus === 'published' || editingStatus === 'taken_down') {
      return '已发布内容请直接保存；不会再进入草稿箱';
    }
    return '';
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

  syncSelectedTags(selected = []) {
    const selectedTagSet = {};
    selected.forEach((name) => { selectedTagSet[name] = true; });
    this.setData({ selectedTags: selected, selectedTagSet });
  },

  onToggleTag(e) {
    const tag = normalizeTagItem(e.currentTarget.dataset.tag || '');
    if (!tag) return;
    const selected = [...(this.data.selectedTags || [])];
    const index = selected.indexOf(tag);
    if (index >= 0) {
      selected.splice(index, 1);
    } else if (selected.length >= RECIPE_WALL_TAG_MAX_COUNT) {
      wx.showToast({ title: `最多 ${RECIPE_WALL_TAG_MAX_COUNT} 个标签`, icon: 'none' });
      return;
    } else {
      selected.push(tag);
    }
    this.syncSelectedTags(selected);
  },

  onCustomTagInput(e) {
    this.setData({ customTagInput: e.detail.value || '' });
  },

  onAddCustomTag() {
    const tag = normalizeTagItem(this.data.customTagInput);
    if (!tag) {
      wx.showToast({ title: '请输入标签', icon: 'none' });
      return;
    }
    const selected = [...(this.data.selectedTags || [])];
    if (selected.includes(tag)) {
      this.setData({ customTagInput: '' });
      return;
    }
    if (selected.length >= RECIPE_WALL_TAG_MAX_COUNT) {
      wx.showToast({ title: `最多 ${RECIPE_WALL_TAG_MAX_COUNT} 个标签`, icon: 'none' });
      return;
    }
    selected.push(tag);
    this.syncSelectedTags(selected);
    this.setData({ customTagInput: '' });
  },

  onRemoveSelectedTag(e) {
    const tag = e.currentTarget.dataset.tag || '';
    const selected = (this.data.selectedTags || []).filter((item) => item !== tag);
    this.syncSelectedTags(selected);
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

  onStepFocus(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    const keyboardHeight = Number(e.detail?.height) || 0;
    this.setData({ focusedStepIndex: index });
    // 键盘弹起有动画，分两次滚动，保证输入区落在可视区域上方
    this.scrollStepIntoView(index, keyboardHeight);
    setTimeout(() => this.scrollStepIntoView(index, keyboardHeight), 280);
  },

  onStepBlur() {
    this.setData({ focusedStepIndex: -1 });
  },

  scrollStepIntoView(index, keyboardHeight = 0) {
    if (typeof wx.createSelectorQuery !== 'function' || typeof wx.pageScrollTo !== 'function') {
      return;
    }
    wx.createSelectorQuery()
      .select(`#step-block-${index}`)
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res = []) => {
        const rect = res[0];
        const viewport = res[1];
        if (!rect || !viewport) return;
        const winHeight = Number(viewport.height) || 0;
        const kb = Math.max(0, Number(keyboardHeight) || 0);
        // 目标：步骤块顶部停在可视区上方约 1/5，并预留键盘高度
        const visibleBottom = winHeight - kb;
        const desiredTop = Math.max(80, Math.round(visibleBottom * 0.18));
        const delta = rect.top - desiredTop;
        if (Math.abs(delta) < 24) return;
        wx.pageScrollTo({
          scrollTop: Math.max((viewport.scrollTop || 0) + delta, 0),
          duration: 180
        });
      });
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
            wx.showLoading({ title: '处理图片', mask: true });
            const compressed = await compressRecipeWallImage(file.tempFilePath, {
              initialSize: Number(file.size) || 0
            });
            if (!compressed.ok) {
              wx.showToast({
                title: compressed.message || '图片过大，请换一张',
                icon: 'none'
              });
              resolve(null);
              return;
            }

            wx.showLoading({ title: '上传中', mask: true });
            const localPath = compressed.path || file.tempFilePath;
            const ext = (localPath.split('.').pop() || 'jpg').toLowerCase();
            const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
            const cloudPath = `recipe-wall/${Date.now()}-${prefix}.${safeExt}`;
            const uploadRes = await wx.cloud.uploadFile({
              cloudPath,
              filePath: localPath
            });
            resolve({ fileID: uploadRes.fileID, tempPath: localPath });
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
      tags: this.data.selectedTags || [],
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

  async loadOwnDraft(postId) {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      await this.ensureFoodCatalog();
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'getOwn', postId }
      });
      const result = res.result || {};
      if (!result.ok || !result.post) {
        throw new Error(result.message || '加载失败');
      }
      const post = result.post;
      const status = post.status || '';
      if (!['draft', 'published', 'taken_down'].includes(status)) {
        wx.showToast({ title: '当前内容不可编辑', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => {} }), 500);
        return;
      }

      const ingredients = (post.ingredients || []).map((item, index) => this.hydrateIngredient(item, index));
      const steps = (post.steps || []).length
        ? post.steps.map((step) => ({
          text: step.text || '',
          imageFileId: step.imageFileId || '',
          imageTempPath: ''
        }))
        : [{ text: '', imageFileId: '', imageTempPath: '' }];
      const selectedTags = Array.isArray(post.tags) ? post.tags : [];
      const selectedTagSet = {};
      selectedTags.forEach((tag) => {
        selectedTagSet[tag] = true;
      });

      const canSaveDraft = status === 'draft';
      this.setData({
        postId,
        editingStatus: status,
        canSaveDraft,
        submitBtnText: status === 'draft' ? '发布' : '保存发布',
        tipText: this.buildTipText(this.data.authorReady, status),
        title: post.title || '',
        description: post.description || '',
        coverFileId: post.coverFileId || '',
        coverTempPath: '',
        ingredients,
        steps,
        selectedTags,
        selectedTagSet,
        cookingMinutes: post.cookingMinutes != null && post.cookingMinutes !== ''
          ? String(post.cookingMinutes)
          : '',
        difficulty: post.difficulty || '',
        showAdvanced: !!(post.cookingMinutes || post.difficulty)
      });
      this.refreshNutrition(ingredients);
      wx.setNavigationBarTitle({
        title: status === 'draft' ? '编辑草稿' : '编辑食谱'
      });
    } catch (error) {
      console.error('load own post for edit failed', error);
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async onSaveDraft() {
    if (this.data.savingDraft) return;
    if (!this.data.canSaveDraft) {
      wx.showToast({ title: '已发布内容请直接保存发布', icon: 'none' });
      return;
    }

    const draft = this.buildDraftPayload();
    const checked = normalizeDraftPayload(draft);
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }

    this.setData({ savingDraft: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: {
          action: 'saveDraft',
          postId: this.data.postId || '',
          ...checked.data
        }
      });
      const result = res.result || {};
      if (!result.ok) throw new Error(result.message || '保存失败');

      this.setData({ postId: result.postId || this.data.postId });
      wx.showToast({ title: '已存草稿', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pkg-recipe-wall/list/index?filter=mine' });
      }, 400);
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingDraft: false });
    }
  },

  buildPublishPayload(validated = {}) {
    return {
      title: validated.title || '',
      description: validated.description || '',
      coverFileId: validated.coverFileId || '',
      ingredients: (validated.ingredients || []).map((item) => ({
        foodId: item.foodId || '',
        foodName: item.foodName || item.name || '',
        name: item.foodName || item.name || '',
        quantity: Number(item.quantity) || 0,
        unit: item.unit || 'g',
        amount: item.amount || '',
        nutrition: item.nutrition
          ? {
            calories: Number(item.nutrition.calories) || 0,
            protein: Number(item.nutrition.protein) || 0,
            carbs: Number(item.nutrition.carbs) || 0,
            fat: Number(item.nutrition.fat) || 0,
            naturalProtein: Number(item.nutrition.naturalProtein) || 0,
            specialProtein: Number(item.nutrition.specialProtein) || 0,
            fiber: Number(item.nutrition.fiber) || 0,
            sodium: Number(item.nutrition.sodium) || 0
          }
          : null
      })),
      steps: (validated.steps || []).map((step) => ({
        text: step.text || '',
        imageFileId: step.imageFileId || ''
      })),
      tags: validated.tags || [],
      searchText: validated.searchText || '',
      cookingMinutes: validated.cookingMinutes == null ? null : validated.cookingMinutes,
      difficulty: validated.difficulty || '',
      totalNutrition: {
        calories: Number(validated.totalNutrition?.calories) || 0,
        protein: Number(validated.totalNutrition?.protein) || 0,
        carbs: Number(validated.totalNutrition?.carbs) || 0,
        fat: Number(validated.totalNutrition?.fat) || 0
      },
      babyName: validated.babyName || '',
      authorDisplayName: validated.authorDisplayName || '',
      babyUid: validated.babyUid || '',
      authorAvatar: validated.authorAvatar || ''
    };
  },

  showPublishError(error) {
    const raw = String(error.errMsg || error.message || '发布失败');
    console.error('publish failed', error);
    let content = raw;
    if (/FUNCTION_NOT_FOUND|-501000/i.test(raw)) {
      content = '未找到云函数 recipeWallManager，请在开发者工具上传并部署';
    } else if (/timeout|TIMED_OUT|-504002/i.test(raw)) {
      content = '云函数超时。请重新部署 recipeWallManager，并尽量压缩图片后重试';
    } else if (/cloud\.function|callFunction:fail/i.test(raw)) {
      content = `云函数调用失败：${raw.slice(0, 160)}`;
    }
    wx.showModal({
      title: '发布失败',
      content: content.slice(0, 300),
      showCancel: false
    });
  },

  async doPublish(validated) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '发布中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: {
          action: 'publish',
          postId: this.data.postId || '',
          ...this.buildPublishPayload(validated)
        }
      });
      const result = res.result;
      if (!result) {
        throw new Error('云函数无响应，请重新上传部署 recipeWallManager');
      }
      if (!result.ok) throw new Error(result.message || '发布失败');

      try {
        wx.removeStorageSync(RECIPE_WALL_DRAFT_KEY);
      } catch (e) {}

      const isEdit = !!this.data.postId && this.data.editingStatus !== 'draft';
      wx.showToast({ title: isEdit ? '已保存' : '发布成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: '/pkg-recipe-wall/list/index' });
      }, 400);
    } catch (error) {
      this.showPublishError(error);
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  async onPreview() {
    if (this.data.submitting || this.data.savingDraft) return;
    if (!this.data.authorReady) {
      await this.loadAuthorContext();
    }
    if (!this.data.babyUid || !this.data.babyName || !this.data.authorDisplayName) {
      wx.showModal({
        title: '请先完善资料',
        content: '发布需要宝宝昵称和个人展示名称（如妈妈/爸爸）',
        confirmText: '去完善',
        success: (res) => {
          if (!res.confirm) return;
          if (!this.data.babyName) {
            wx.navigateTo({ url: '/pkg-misc/baby-info/index?from=profile' });
          } else {
            wx.navigateTo({ url: '/pkg-misc/personal-info/index' });
          }
        }
      });
      return;
    }

    const draft = this.buildDraftPayload();
    const checked = validatePublishPayload(draft);
    if (!checked.ok) {
      wx.showToast({ title: checked.message, icon: 'none' });
      return;
    }

    const isEdit = !!this.data.postId && this.data.editingStatus !== 'draft';
    wx.showModal({
      title: isEdit ? '确认保存？' : '确认发布到食谱墙？',
      content: checked.data.title || '请确认内容无误',
      confirmText: isEdit ? '保存' : '发布',
      success: (res) => {
        if (!res.confirm) return;
        this.doPublish(checked.data);
      }
    });
  }
});

