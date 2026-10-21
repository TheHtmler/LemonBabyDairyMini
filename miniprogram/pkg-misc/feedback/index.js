const { waitForAppInitialization, getBabyUid, handleError } = require('../../utils/index');
const feedback = require('../../utils/feedback');

const FEEDBACK_TYPES = ['功能建议', '问题反馈', '体验吐槽', '其他'];

Page({
  data: {
    feedbackTypes: FEEDBACK_TYPES,
    selectedType: FEEDBACK_TYPES[0],
    content: '',
    contact: '',
    submitting: false,
    activeTab: 'submit',
    feedbackItems: [],
    unreadCount: 0,
    listLoading: false,
    listLoaded: false,
    listError: '',
    nextCursor: null
  },

  async onLoad(options = {}) {
    this._alive = true;
    this._listSeq = 0;
    this._scrolls = { submit: 0, mine: 0 };
    this.setData({ activeTab: options.tab === 'mine' ? 'mine' : 'submit' });
    await this.initializeFeedback();
  },

  async initializeFeedback() {
    if (this._initializing) return;
    this._initializing = true;
    try {
      await waitForAppInitialization();
      await feedback.readyIdentity();
      if (!this._alive) return;
      const state = feedback.getUnreadState();
      this._generation = state.generation;
      this._ready = true;
      if (this._unsubscribe) this._unsubscribe();
      this._unsubscribe = feedback.subscribeUnread(state => {
        if (!this._alive) return;
        if (state.generation !== this._generation) {
          this._listSeq += 1;
          this._ready = false;
          this.setData({ content: '', contact: '', feedbackItems: [], unreadCount: 0,
            listLoaded: false, listLoading: false, submitting: false, nextCursor: null,
            listError: '用户身份已变化，请重新加载' });
          return;
        }
        this.setData({ unreadCount: state.count,
          feedbackItems: this.data.feedbackItems.map(feedback.normalizeFeedback) });
      });
      feedback.refreshUnreadSilently();
      if (this.data.activeTab === 'mine') await this.loadMine();
    } catch (error) {
      if (!this._alive) return;
      this._ready = false;
      this.setData({ listError: '初始化失败，请下拉重试' });
      handleError(error, { title: '初始化失败' });
    } finally { this._initializing = false; }
  },

  onShow() {
    feedback.getUnreadState();
    if (!this._ready) {
      this.initializeFeedback();
      return;
    }
    feedback.refreshUnreadSilently();
    if (this.data.activeTab === 'mine') this.loadMine({ preserveLoaded: true });
  },

  onUnload() {
    this._alive = false;
    this._listSeq += 1;
    if (this._unsubscribe) this._unsubscribe();
  },

  onPageScroll(event) {
    this._scrolls[this.data.activeTab] = event.scrollTop;
  },

  onTabTap(event) {
    const tab = event.currentTarget.dataset.tab;
    if (!['submit', 'mine'].includes(tab) || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab }, () => {
      wx.pageScrollTo({ scrollTop: this._scrolls[tab] || 0, duration: 0 });
    });
    if (tab === 'mine') this.loadMine({ preserveLoaded: true });
  },

  goToSubmit() {
    this.setData({ activeTab: 'submit' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  async onPullDownRefresh() {
    try {
      if (!this._ready) await this.initializeFeedback();
      else {
        await Promise.all([
          feedback.refreshUnreadSilently({ force: true }),
          this.data.activeTab === 'mine' ? this.loadMine() : Promise.resolve()
        ]);
      }
    } finally { wx.stopPullDownRefresh(); }
  },

  onReachBottom() {
    if (this.data.activeTab === 'mine' && this.data.nextCursor && !this.data.listLoading) {
      this.loadMine({ more: true });
    }
  },

  retryList() {
    if (!this._ready) return this.initializeFeedback();
    return this.loadMine(this._lastLoadOptions);
  },

  async loadMine({ more = false, preserveLoaded = false } = {}) {
    if (!this._ready || (more && (this.data.listLoading || !this.data.nextCursor))) return;
    const request = ++this._listSeq;
    this._lastLoadOptions = { more, preserveLoaded };
    let cursor = more ? this.data.nextCursor : null;
    const targetLength = !more && preserveLoaded ? Math.max(20, this.data.feedbackItems.length) : 20;
    this.setData({ listLoading: true, listError: '' });
    try {
      const items = [];
      // 返回详情或切回标签时刷新已加载范围，避免长列表突然收缩为第一页。
      do {
        const result = await feedback.callFeedback('listMine', { cursor });
        if (!this._alive || request !== this._listSeq) return;
        items.push(...(result.data || []));
        cursor = result.nextCursor;
      } while (!more && cursor && items.length < targetLength);
      const existing = more ? this.data.feedbackItems : [];
      const ids = new Set(existing.map(item => item._id));
      const uniqueItems = items.filter(item => {
        if (ids.has(item._id)) return false;
        ids.add(item._id);
        return true;
      });
      // 所有分页到齐后再合并最新阅读回执，避免较早返回的页面恢复已读红点。
      this.setData({ feedbackItems: [...existing, ...uniqueItems].map(feedback.normalizeFeedback),
        nextCursor: cursor, listLoaded: true });
    } catch (error) {
      if (this._alive && request === this._listSeq && error.code !== 'STALE_SESSION') {
        this.setData({ listError: error.message || '加载失败，请重试' });
      }
    } finally {
      if (this._alive && request === this._listSeq) this.setData({ listLoading: false });
    }
  },

  openFeedback(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pkg-misc/feedback-detail/index?id=${encodeURIComponent(id)}` });
  },

  onTypeTap(e) {
    const { type } = e.currentTarget.dataset || {};
    if (!type) return;
    this.setData({ selectedType: type });
  },

  onContentInput(e) {
    this.setData({
      content: e.detail.value || ''
    });
  },

  onContactInput(e) {
    this.setData({
      contact: e.detail.value || ''
    });
  },

  async submitFeedback() {
    if (!this._ready) {
      await this.initializeFeedback();
      if (!this._alive || !this._ready) return;
    }
    const content = (this.data.content || '').trim();
    const contact = (this.data.contact || '').trim();

    if (!content) {
      wx.showToast({ title: '请先填写反馈内容', icon: 'none' });
      return;
    }

    if (content.length < 5) {
      wx.showToast({ title: '反馈内容至少 5 个字', icon: 'none' });
      return;
    }
    if (content.length > 500) {
      wx.showToast({ title: '反馈内容不能超过 500 字', icon: 'none' });
      return;
    }

    if (this.data.submitting) {
      return;
    }

    try {
      this.setData({ submitting: true });
      wx.showLoading({ title: '提交中...', mask: true });

      const app = getApp();
      const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
      const babyUid = getBabyUid() || '';
      const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
      const babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
      const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
      const pages = getCurrentPages ? getCurrentPages() : [];
      const currentPage = pages.length ? pages[pages.length - 1] : null;

      await feedback.callFeedback('submit', {
          type: this.data.selectedType,
          content,
          contact,
          babyUid,
          userRole,
          appVersion: '1.0.0',
          source: 'miniprogram',
          userNickname: userInfo.nickName || '',
          babyName: babyInfo.name || '',
          submitRoute: currentPage?.route || '',
          systemInfo: {
            brand: systemInfo.brand || '',
            model: systemInfo.model || '',
            platform: systemInfo.platform || '',
            system: systemInfo.system || '',
            language: systemInfo.language || '',
            version: systemInfo.version || '',
            SDKVersion: systemInfo.SDKVersion || ''
          },
          miniProgramInfo: {
            envVersion: accountInfo?.miniProgram?.envVersion || '',
            version: accountInfo?.miniProgram?.version || ''
          }
      });
      feedback.invalidateUnread();
      feedback.refreshUnreadSilently({ force: true });

      wx.hideLoading();
      if (!this._alive) return;
      wx.showToast({ title: '反馈已提交', icon: 'success' });
      this.setData({
        submitting: false,
        content: '',
        contact: '',
        activeTab: 'mine'
      });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      await this.loadMine();
    } catch (error) {
      wx.hideLoading();
      if (!this._alive || error.code === 'STALE_SESSION') return;
      this.setData({ submitting: false });
      handleError(error, {
        title: error?.message || '提交失败',
        hideLoading: false
      });
    }
  }
});
