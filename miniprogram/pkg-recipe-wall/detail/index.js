const { formatRecipeWallAuthorLabel } = require('../../utils/recipeWallUtils');

Page({
  data: {
    postId: '',
    loading: true,
    unavailable: false,
    message: '',
    post: null,
    authorLabel: '',
    liked: false,
    likeCount: 0
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
      this.setData({
        loading: false,
        unavailable: false,
        post,
        authorLabel: formatRecipeWallAuthorLabel(post),
        liked: !!result.liked,
        likeCount: Number(post.likeCount) || 0
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
