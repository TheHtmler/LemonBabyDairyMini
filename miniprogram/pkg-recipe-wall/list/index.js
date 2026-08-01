const { mapPostForCard } = require('../../utils/recipeWallUtils');

const PAGE_SIZE = 10;
const COVER_HEIGHTS = [280, 340, 300, 380];

function withCoverHeight(card, index) {
  return {
    ...card,
    coverHeight: COVER_HEIGHTS[index % COVER_HEIGHTS.length]
  };
}


Page({
  data: {
    loading: true,
    refreshing: false,
    loadingMore: false,
    posts: [],
    page: 1,
    hasMore: true,
    empty: false
  },

  onLoad() {
    this.loadList({ reset: true });
  },

  onPullDownRefresh() {
    this.loadList({ reset: true, fromPull: true });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadList({ reset: false });
  },

  async loadList({ reset = false, fromPull = false } = {}) {
    if (reset) {
      this.setData({
        loading: !fromPull,
        refreshing: fromPull,
        page: 1,
        hasMore: true
      });
    } else {
      this.setData({ loadingMore: true });
    }

    const page = reset ? 1 : this.data.page;

    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'list', page, pageSize: PAGE_SIZE }
      });
      const result = res.result || {};
      if (!result.ok) {
        throw new Error(result.message || '加载失败');
      }

      const likedPostIds = (result.list || [])
        .filter((item) => item.liked)
        .map((item) => item._id);
      const baseOffset = reset ? 0 : this.data.posts.length;
      const cards = (result.list || []).map((post, index) => withCoverHeight(
        mapPostForCard(post, { likedPostIds }),
        baseOffset + index
      ));

      const posts = reset ? cards : this.data.posts.concat(cards);
      this.setData({
        posts,
        page: page + 1,
        hasMore: !!result.hasMore,
        empty: posts.length === 0,
        loading: false,
        refreshing: false,
        loadingMore: false
      });
    } catch (error) {
      console.error('load recipe wall list failed', error);
      this.setData({ loading: false, refreshing: false, loadingMore: false });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      if (fromPull) wx.stopPullDownRefresh();
    }
  },

  goPublish() {
    wx.navigateTo({ url: '/pkg-recipe-wall/publish/index' });
  },

  goMine() {
    wx.navigateTo({ url: '/pkg-recipe-wall/mine/index' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pkg-recipe-wall/detail/index?id=${id}` });
  },

  async onToggleLike(e) {
    const id = e.currentTarget.dataset.id;
    const index = this.data.posts.findIndex((item) => item.id === id);
    if (index < 0) return;

    const post = this.data.posts[index];
    const prevLiked = post.liked;
    const prevCount = post.likeCount;
    const nextLiked = !prevLiked;
    const keyLiked = `posts[${index}].liked`;
    const keyCount = `posts[${index}].likeCount`;

    this.setData({
      [keyLiked]: nextLiked,
      [keyCount]: Math.max(0, prevCount + (nextLiked ? 1 : -1))
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'toggleLike', postId: id }
      });
      if (!res.result?.ok) throw new Error(res.result?.message || '点赞失败');
      this.setData({
        [keyLiked]: res.result.liked,
        [keyCount]: res.result.likeCount
      });
    } catch (error) {
      this.setData({ [keyLiked]: prevLiked, [keyCount]: prevCount });
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});
