const { mapPostForCard } = require('../../utils/recipeWallUtils');

const PAGE_SIZE = 10;
const COVER_HEIGHTS = [280, 340, 300, 380];
const FILTER_OPTIONS = [
  { name: '全部', value: 'all' },
  { name: '我赞过的', value: 'liked' },
  { name: '我发布的', value: 'mine' }
];

function normalizeFilter(value) {
  if (value === 'liked' || value === 'mine') return value;
  return 'all';
}

function statusTextOf(status) {
  if (status === 'draft') return '草稿';
  if (status === 'taken_down') return '已下架';
  return '已发布';
}

function withCoverHeight(card, index) {
  return {
    ...card,
    coverHeight: COVER_HEIGHTS[index % COVER_HEIGHTS.length],
    statusText: statusTextOf(card.status)
  };
}

/** 微信小程序对 column-count 支持差，用双列 flex 做栅格 */
function splitWaterfallColumns(posts = []) {
  const leftPosts = [];
  const rightPosts = [];
  let leftH = 0;
  let rightH = 0;
  (posts || []).forEach((post) => {
    const weight = (Number(post.coverHeight) || 300) + 120;
    if (leftH <= rightH) {
      leftPosts.push(post);
      leftH += weight;
    } else {
      rightPosts.push(post);
      rightH += weight;
    }
  });
  return { leftPosts, rightPosts };
}

Page({
  data: {
    loading: true,
    refreshing: false,
    loadingMore: false,
    posts: [],
    leftPosts: [],
    rightPosts: [],
    page: 1,
    hasMore: true,
    empty: false,
    keywordInput: '',
    keyword: '',
    filter: 'all',
    filterOptions: FILTER_OPTIONS
  },

  onLoad(options = {}) {
    const filter = normalizeFilter(options.filter);
    if (filter !== this.data.filter) {
      this.setData({ filter });
    }
    this.loadList({ reset: true });
  },

  onShow() {
    if (this._needsRefresh) {
      this._needsRefresh = false;
      this.loadList({ reset: true });
    }
  },

  onPullDownRefresh() {
    this.loadList({ reset: true, fromPull: true });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadList({ reset: false });
  },

  onKeywordInput(e) {
    this.setData({ keywordInput: e.detail.value || '' });
  },

  onSearchConfirm() {
    const keyword = String(this.data.keywordInput || '').trim();
    this.setData({ keyword });
    this.loadList({ reset: true });
  },

  onClearSearch() {
    if (!this.data.keyword && !this.data.keywordInput) return;
    this.setData({ keyword: '', keywordInput: '' });
    this.loadList({ reset: true });
  },

  onSelectFilter(e) {
    const value = normalizeFilter(e.currentTarget.dataset.value);
    if (value === this.data.filter) return;
    // 切换筛选时清空搜索，避免「全部有结果、我发布的被关键词滤空」
    this.setData({
      filter: value,
      keyword: '',
      keywordInput: ''
    });
    this.loadList({ reset: true });
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
        data: {
          action: 'list',
          page,
          pageSize: PAGE_SIZE,
          keyword: this.data.keyword || '',
          filter: this.data.filter || 'all'
        }
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
      const columns = splitWaterfallColumns(posts);
      this.setData({
        posts,
        ...columns,
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

  applyPosts(posts) {
    const columns = splitWaterfallColumns(posts);
    this.setData({
      posts,
      ...columns,
      empty: posts.length === 0
    });
  },

  patchPostById(id, patch = {}) {
    const posts = (this.data.posts || []).map((item) => (
      item.id === id ? { ...item, ...patch } : item
    ));
    this.applyPosts(posts);
  },

  goPublish() {
    this._needsRefresh = true;
    wx.navigateTo({ url: '/pkg-recipe-wall/publish/index' });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const post = this.data.posts.find((item) => item.id === id);
    if (this.data.filter === 'mine' && post?.status === 'draft') {
      this._needsRefresh = true;
      wx.navigateTo({ url: `/pkg-recipe-wall/publish/index?id=${id}` });
      return;
    }
    wx.navigateTo({ url: `/pkg-recipe-wall/detail/index?id=${id}` });
  },

  goEdit(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this._needsRefresh = true;
    wx.navigateTo({ url: `/pkg-recipe-wall/publish/index?id=${id}` });
  },

  onDeleteOwn(e) {
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
          this.applyPosts(this.data.posts.filter((item) => item.id !== id));
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败', icon: 'none' });
        }
      }
    });
  },

  async onToggleLike(e) {
    const id = e.currentTarget.dataset.id;
    const post = (this.data.posts || []).find((item) => item.id === id);
    if (!post) return;

    const prevLiked = post.liked;
    const prevCount = post.likeCount;
    const nextLiked = !prevLiked;

    // 在「我赞过的」里取消赞：直接从列表移除
    if (this.data.filter === 'liked' && prevLiked && !nextLiked) {
      this.applyPosts(this.data.posts.filter((item) => item.id !== id));
    } else {
      this.patchPostById(id, {
        liked: nextLiked,
        likeCount: Math.max(0, prevCount + (nextLiked ? 1 : -1))
      });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'toggleLike', postId: id }
      });
      if (!res.result?.ok) throw new Error(res.result?.message || '点赞失败');
      if (!(this.data.filter === 'liked' && !res.result.liked)) {
        this.patchPostById(id, {
          liked: res.result.liked,
          likeCount: res.result.likeCount
        });
      }
    } catch (error) {
      if (this.data.filter === 'liked' && prevLiked) {
        this.loadList({ reset: true });
      } else {
        this.patchPostById(id, { liked: prevLiked, likeCount: prevCount });
      }
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});
