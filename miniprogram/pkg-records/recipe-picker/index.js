const RecipeModel = require('../../models/recipe');

function getBabyUid() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return app?.globalData?.babyUid || wx.getStorageSync('baby_uid') || '';
}

Page({
  data: {
    loading: true,
    recipes: [],
    recipeCount: 0,
    emptyHint: ''
  },

  async onShow() {
    await this.loadRecipes();
  },

  async loadRecipes() {
    const babyUid = getBabyUid();
    console.log('[recipe-picker] loadRecipes start', { babyUid });
    if (!babyUid) {
      this.setData({
        loading: false,
        recipes: [],
        recipeCount: 0,
        emptyHint: '未找到宝宝信息，请先完成角色/宝宝初始化'
      });
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
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
      this.setData({
        loading: false,
        recipes: [],
        recipeCount: 0,
        emptyHint: result.message || '加载失败'
      });
      wx.showModal({
        title: '加载食谱失败',
        content: result.message || '请检查云库 recipe_catalog 集合是否已创建',
        showCancel: false
      });
      return;
    }

    const recipes = (result.data || []).map((recipe) => ({
      _id: recipe._id,
      name: recipe.name || '未命名食谱',
      ingredientCount: (recipe.ingredients || []).length,
      ingredientNames: (recipe.ingredients || []).map((item) => item.foodName).filter(Boolean).join('、')
    }));
    const emptyHint = recipes.length
      ? ''
      : `当前宝宝 ${babyUid} 下没有可读食谱。请到「我的→食谱管理」新建；若控制台已有记录，请核对该记录的 babyUid 是否一致，权限是否允许客户端读。`;

    this.setData({
      loading: false,
      recipes,
      recipeCount: recipes.length,
      emptyHint
    }, () => {
      console.log('[recipe-picker] setData done', {
        recipeCount: this.data.recipeCount,
        firstName: this.data.recipes?.[0]?.name || ''
      });
    });
  },

  selectRecipe(e) {
    const recipeId = e.currentTarget.dataset.id || '';
    if (!recipeId) return;
    wx.navigateTo({
      url: `/pkg-records/recipe-batch/index?recipeId=${encodeURIComponent(recipeId)}`
    });
  }
});
