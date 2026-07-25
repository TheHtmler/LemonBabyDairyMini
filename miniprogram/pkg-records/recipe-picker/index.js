const RecipeModel = require('../models/recipe');
const { matchRecipeBySearch } = require('../../utils/recipeNutritionUtils');
const { readRecipeCache } = RecipeModel;

function getBabyUid() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return app?.globalData?.babyUid || wx.getStorageSync('baby_uid') || '';
}

function mapRecipeListItem(recipe = {}, index = 0) {
  const ingredientTags = (recipe.ingredients || [])
    .map((item) => item.foodName)
    .filter(Boolean);
  const name = recipe.name || '未命名食谱';
  return {
    _id: recipe._id,
    name,
    nameInitial: name.slice(0, 1) || '菜',
    notes: recipe.notes || '',
    ingredients: recipe.ingredients || [],
    ingredientCount: ingredientTags.length,
    ingredientLine: ingredientTags.length
      ? ingredientTags.join(' · ')
      : '还没加原料',
    ingredientNames: ingredientTags.join('、'),
    tone: ['tone-a', 'tone-b', 'tone-c'][index % 3]
  };
}

Page({
  data: {
    loading: true,
    searchQuery: '',
    recipes: [],
    filteredRecipes: [],
    recipeCount: 0,
    filteredCount: 0,
    emptyHint: ''
  },

  async onShow() {
    await this.loadRecipes();
  },

  applyRecipesToView(recipeDocs = [], emptyHint = '') {
    const recipes = (recipeDocs || []).map((recipe, index) => mapRecipeListItem(recipe, index));
    this.setData({
      loading: false,
      recipes,
      recipeCount: recipes.length,
      emptyHint: emptyHint || (recipes.length ? '' : '先建一道常做的菜，回来就能直接选用。')
    }, () => this.applyRecipeSearch());
  },

  async loadRecipes() {
    const babyUid = getBabyUid();
    console.log('[recipe-picker] loadRecipes start', { babyUid });
    if (!babyUid) {
      this.setData({
        loading: false,
        recipes: [],
        filteredRecipes: [],
        recipeCount: 0,
        filteredCount: 0,
        emptyHint: '未找到宝宝信息，请先完成角色/宝宝初始化'
      });
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    // 有本地缓存时先秒开，再后台对齐云端
    const cached = typeof readRecipeCache === 'function' ? readRecipeCache(babyUid) : [];
    if (cached.length) {
      this.applyRecipesToView(cached);
    } else {
      this.setData({ loading: true });
    }

    const result = await RecipeModel.listActiveByBaby(babyUid);
    console.log('[recipe-picker] listActiveByBaby result', {
      success: result.success,
      message: result.message || '',
      fromCache: !!result.fromCache,
      count: (result.data || []).length,
      names: (result.data || []).map((item) => item.name),
      ids: (result.data || []).map((item) => item._id)
    });
    if (!result.success) {
      if (!(this.data.recipeCount > 0)) {
        this.setData({
          loading: false,
          recipes: [],
          filteredRecipes: [],
          recipeCount: 0,
          filteredCount: 0,
          emptyHint: result.message || '加载失败'
        });
      } else {
        this.setData({ loading: false });
      }
      wx.showModal({
        title: '加载食谱失败',
        content: result.message || '请检查云库 recipe_catalog 集合是否已创建',
        showCancel: false
      });
      return;
    }

    if (!result.data?.length) {
      console.warn('[recipe-picker] empty catalog', {
        babyUid,
        hint: '若控制台已有记录，请核对 babyUid 与读权限'
      });
    }

    this.applyRecipesToView(result.data || []);
    console.log('[recipe-picker] setData done', {
      recipeCount: this.data.recipeCount,
      firstName: this.data.recipes?.[0]?.name || '',
      fromCache: !!result.fromCache
    });
  },

  goToRecipeManagement(e) {
    const forceCreate = e?.currentTarget?.dataset?.mode === 'create';
    // 列表为空时直接进新建，避免先落到空管理页再点一次
    const openCreate = forceCreate || !(this.data.recipeCount > 0);
    wx.navigateTo({
      url: openCreate
        ? '/pkg-records/recipe-management/index?mode=create'
        : '/pkg-records/recipe-management/index'
    });
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

  selectRecipe(e) {
    const recipeId = e.currentTarget.dataset.id || '';
    if (!recipeId) return;
    wx.navigateTo({
      url: `/pkg-records/recipe-batch/index?recipeId=${encodeURIComponent(recipeId)}`
    });
  }
});
