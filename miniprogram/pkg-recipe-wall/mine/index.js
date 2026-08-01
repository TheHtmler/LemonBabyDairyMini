const { formatRecipeWallAuthorLabel } = require('../../utils/recipeWallUtils');

Page({
  data: {
    loading: true,
    posts: [],
    empty: false
  },

  onShow() {
    this.loadMine();
  },

  onPullDownRefresh() {
    this.loadMine().finally(() => wx.stopPullDownRefresh());
  },

  async loadMine() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'listMine', page: 1, pageSize: 50 }
      });
      const result = res.result || {};
      if (!result.ok) throw new Error(result.message || '加载失败');

      const posts = (result.list || []).map((post) => ({
        id: post._id,
        title: post.title || '',
        coverFileId: post.coverFileId || '',
        authorLabel: formatRecipeWallAuthorLabel(post),
        status: post.status || '',
        statusText: post.status === 'taken_down' ? '已下架' : '已发布',
        likeCount: Number(post.likeCount) || 0
      }));

      this.setData({
        posts,
        empty: posts.length === 0,
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pkg-recipe-wall/detail/index?id=${id}` });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '删除食谱',
      content: '删除后不可恢复，确认删除吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await wx.cloud.callFunction({
            name: 'recipeWallManager',
            data: { action: 'deleteOwn', postId: id }
          });
          if (!result.result?.ok) throw new Error(result.result?.message || '删除失败');
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadMine();
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' });
        }
      }
    });
  }
});
