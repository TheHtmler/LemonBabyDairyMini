const { isDeveloperOpenid } = require('../../config/developer');
const { formatRecipeWallAuthorLabel } = require('../../utils/recipeWallUtils');

Page({
  data: {
    loading: true,
    posts: [],
    empty: false
  },

  onShow() {
    const app = getApp();
    const openid = app.globalData.openid || wx.getStorageSync('openid') || '';
    if (!isDeveloperOpenid(openid)) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/index' }) }), 400);
      return;
    }
    this.loadAdminList();
  },

  onPullDownRefresh() {
    this.loadAdminList().finally(() => wx.stopPullDownRefresh());
  },

  async loadAdminList() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'adminList', page: 1, pageSize: 50 }
      });
      const result = res.result || {};
      if (!result.ok) throw new Error(result.message || '加载失败');

      const posts = (result.list || []).map((post) => ({
        id: post._id,
        title: post.title || '',
        coverFileId: post.coverFileId || '',
        authorLabel: formatRecipeWallAuthorLabel(post),
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

  onTakeDown(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '下架食谱',
      content: '确认下架该食谱？下架后普通用户不可见。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await wx.cloud.callFunction({
            name: 'recipeWallManager',
            data: { action: 'takeDown', postId: id }
          });
          if (!result.result?.ok) throw new Error(result.result?.message || '下架失败');
          wx.showToast({ title: '已下架', icon: 'success' });
          this.loadAdminList();
        } catch (error) {
          wx.showToast({ title: error.message || '下架失败', icon: 'none' });
        }
      }
    });
  }
});
