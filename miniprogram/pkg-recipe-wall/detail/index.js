const {
  formatRecipeWallAuthorLabel,
  formatDifficultyLabel
} = require('../../utils/recipeWallUtils');

function formatNutri(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return digits === 0 ? '0' : '0.00';
  if (digits === 0) return String(Math.round(num));
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(digits);
}

Page({
  data: {
    postId: '',
    loading: true,
    unavailable: false,
    message: '',
    post: null,
    authorLabel: '',
    liked: false,
    likeCount: 0,
    isOwner: false,
    canEdit: false,
    difficultyLabel: '',
    cookingText: '',
    nutrition: null
  },

  onLoad(query = {}) {
    const postId = String(query.id || '').trim();
    this.setData({ postId });
    if (!postId) {
      this.setData({ loading: false, unavailable: true, message: '内容不可用' });
      return;
    }
    this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'detail', postId: this.data.postId }
      });
      const result = res.result || {};
      if (!result.ok) {
        this.setData({
          loading: false,
          unavailable: true,
          message: result.message || '内容不可用'
        });
        return;
      }

      const post = result.post || {};
      const total = post.totalNutrition || {};
      const cookingMinutes = post.cookingMinutes;
      const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
      const isOwner = !!(openid && (post.authorOpenid === openid || post._openid === openid));
      const canEdit = isOwner && ['draft', 'published', 'taken_down'].includes(post.status);
      this.setData({
        loading: false,
        unavailable: false,
        post,
        authorLabel: formatRecipeWallAuthorLabel(post),
        liked: !!result.liked,
        likeCount: Number(post.likeCount) || 0,
        isOwner,
        canEdit,
        difficultyLabel: formatDifficultyLabel(post.difficulty),
        cookingText: cookingMinutes ? `${cookingMinutes} 分钟` : '',
        nutrition: {
          caloriesText: formatNutri(total.calories, 0),
          proteinText: formatNutri(total.protein, 2),
          carbsText: formatNutri(total.carbs, 2),
          fatText: formatNutri(total.fat, 2)
        }
      });
    } catch (error) {
      console.error('load recipe detail failed', error);
      this.setData({
        loading: false,
        unavailable: true,
        message: '内容不可用'
      });
    }
  },

  goEdit() {
    if (!this.data.canEdit || !this.data.postId) return;
    // 用 redirect 替换详情，避免 详情→编辑→预览 栈过深
    wx.redirectTo({ url: `/pkg-recipe-wall/publish/index?id=${this.data.postId}` });
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url || !this.data.post) return;
    const urls = [
      this.data.post.coverFileId,
      ...(this.data.post.steps || []).map((step) => step.imageFileId).filter(Boolean)
    ];
    wx.previewImage({ current: url, urls });
  },

  async onToggleLike() {
    if (this.data.unavailable || !this.data.postId) return;

    const prevLiked = this.data.liked;
    const prevCount = this.data.likeCount;
    const nextLiked = !prevLiked;
    this.setData({
      liked: nextLiked,
      likeCount: Math.max(0, prevCount + (nextLiked ? 1 : -1))
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'toggleLike', postId: this.data.postId }
      });
      if (!res.result?.ok) throw new Error(res.result?.message || '点赞失败');
      this.setData({
        liked: res.result.liked,
        likeCount: res.result.likeCount
      });
    } catch (error) {
      this.setData({ liked: prevLiked, likeCount: prevCount });
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});
