const feedback = require('../../utils/feedback');

Page({
  data: {
    loading: true,
    errorText: '',
    item: null,
    canReply: false,
    replyDraft: '',
    saving: false,
    dirty: false,
    conflict: false,
    hasNewerReply: false,
    readError: '',
    saveError: ''
  },

  async onLoad(options = {}) {
    this._alive = true;
    this._loadSeq = 0;
    this._id = options.id || '';
    this._view = options.view === 'admin' ? 'admin' : 'mine';
    await this.initializeDetail();
  },

  async initializeDetail() {
    if (this._initializing) return;
    this._initializing = true;
    try {
      await feedback.readyIdentity();
      if (!this._alive) return;
      this._generation = feedback.getUnreadState().generation;
      if (this._unsubscribe) this._unsubscribe();
      this._unsubscribe = feedback.subscribeUnread(state => {
        if (!this._alive || state.generation === this._generation) return;
        this._loadSeq += 1;
        this.stopObservingReply();
        this.setData({ item: null, canReply: false, replyDraft: '', dirty: false,
          saving: false, loading: false, errorText: '用户身份已变化，请返回后重新进入' });
        this.updateLeaveAlert();
      });
      await this.loadDetail();
    } catch (error) {
      if (this._alive) this.setData({ loading: false, errorText: error.message });
    } finally { this._initializing = false; }
  },

  onShow() {
    this._visible = true;
    feedback.getUnreadState();
    if (this.data.item) this.observeReply();
  },

  onHide() {
    this._visible = false;
    this.stopObservingReply();
  },

  onUnload() {
    this._alive = false;
    this._visible = false;
    this._loadSeq += 1;
    this.stopObservingReply();
    if (this._unsubscribe) this._unsubscribe();
  },

  stopObservingReply() {
    if (this._observer) this._observer.disconnect();
    this._observer = null;
    this._replyVisible = false;
  },

  observeReply() {
    this.stopObservingReply();
    const item = this.data.item;
    if (!this._visible || this.data.canReply || !item?.replyContent || !item.hasUnreadReply) return;
    const shownVersion = item.replyVersion;
    // 回复区域真正进入可视范围后，才确认这一版已读；长问题下方的回复不会被提前清除。
    this._observer = this.createIntersectionObserver({ thresholds: [0, 0.1] });
    this._observer.relativeToViewport().observe('.reply-card', result => {
      this._replyVisible = result.intersectionRatio > 0;
      if (this._replyVisible) this.markShownReply(shownVersion);
    });
  },

  async markShownReply(shownVersion = this.data.item?.replyVersion) {
    if (!this._alive || !this._visible || !this._replyVisible || this.data.canReply
      || !this.data.item?.hasUnreadReply || shownVersion !== this.data.item.replyVersion || this._marking) return;
    this._marking = true;
    try {
      const receipt = await feedback.acknowledgeReply(this._id, shownVersion);
      if (!this._alive || this.data.item?.replyVersion !== shownVersion) return;
      this.setData({
        'item.readReplyVersion': receipt.readReplyVersion,
        'item.hasUnreadReply': false,
        hasNewerReply: receipt.hasUnreadReply,
        readError: ''
      });
      this.stopObservingReply();
    } catch (error) {
      if (this._alive && error.code !== 'STALE_SESSION') {
        this.setData({ readError: '阅读状态未同步，点击重试' });
      }
    } finally {
      this._marking = false;
      // 旧版本确认期间可能刷新了新回复，重新观察当前正文，补上被并发锁挡住的确认。
      if (this._alive && this._visible && this.data.item?.hasUnreadReply
        && this.data.item.replyVersion !== shownVersion) this.observeReply();
    }
  },

  retryRead() {
    this.markShownReply(this.data.item?.replyVersion);
  },

  async loadDetail({ preserveDraft = false } = {}) {
    if (!this._alive || this.data.saving) return;
    const request = ++this._loadSeq;
    this.stopObservingReply();
    this.setData({ loading: true, errorText: '' });
    try {
      const result = await feedback.callFeedback('getDetail', { id: this._id, view: this._view });
      if (!this._alive || request !== this._loadSeq) return;
      const item = feedback.normalizeFeedback(result.data);
      const replyDraft = preserveDraft ? this.data.replyDraft : item.replyContent;
      this._pendingSave = null;
      this.setData({ item, canReply: result.canReply === true, replyDraft,
        dirty: replyDraft.trim() !== item.replyContent, conflict: false,
        loading: false, hasNewerReply: false, readError: '', saveError: '' }, () => this.observeReply());
      wx.setNavigationBarTitle({ title: result.canReply ? '处理反馈' : '反馈详情' });
      this.updateLeaveAlert();
    } catch (error) {
      if (this._alive && request === this._loadSeq && error.code !== 'STALE_SESSION') {
        const unavailable = ['NOT_FOUND', 'FORBIDDEN'].includes(error.code);
        this.setData({ loading: false, errorText: error.message,
          ...(unavailable ? { item: null, canReply: false } : {}) });
      }
    }
  },

  retryLoad() {
    const state = feedback.getUnreadState();
    if (!this._unsubscribe || state.generation !== this._generation) return this.initializeDetail();
    return this.loadDetail({ preserveDraft: this.data.dirty });
  },

  async onPullDownRefresh() {
    try {
      if (this.data.saving) return;
      await this.retryLoad();
      feedback.refreshUnreadSilently({ force: true });
    } finally { wx.stopPullDownRefresh(); }
  },

  refreshConflict() {
    return this.loadDetail({ preserveDraft: true });
  },

  onReplyInput(event) {
    if (this.data.saving || !this.data.canReply || !this.data.item) return;
    const replyDraft = event.detail.value || '';
    this._pendingSave = null;
    this.setData({ replyDraft, dirty: replyDraft.trim() !== this.data.item.replyContent, saveError: '' });
    this.updateLeaveAlert();
  },

  updateLeaveAlert() {
    if (this.data.dirty || this.data.saving) {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({
        message: '回复尚未保存，返回后将丢失本次修改。', fail() {}
      });
    } else if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload({ fail() {} });
    }
  },

  async saveReply(event) {
    if (!this.data.canReply || !this.data.item || this.data.loading || this.data.saving || this.data.conflict) return;
    const replyContent = this.data.replyDraft.trim();
    if (!replyContent || replyContent.length > 1000) {
      wx.showToast({ title: '请填写 1–1000 字的回复', icon: 'none' });
      return;
    }
    const mode = event.currentTarget.dataset.mode;
    if (!['reply', 'process'].includes(mode)) return;
    // 网络超时后同一内容、模式和基础版本复用请求标识。
    if (!this._pendingSave || this._pendingSave.replyContent !== replyContent || this._pendingSave.mode !== mode) {
      this._pendingSave = { id: this._id, replyContent, mode,
        baseReplyVersion: this.data.item.replyVersion, requestId: feedback.createReplyRequestId() };
    }
    this.setData({ saving: true, saveError: '' });
    this.updateLeaveAlert();
    try {
      const result = await feedback.callFeedback('saveReply', this._pendingSave);
      feedback.invalidateUnread();
      feedback.refreshUnreadSilently({ force: true });
      if (!this._alive) return;
      const item = feedback.normalizeFeedback(result.data);
      this._pendingSave = null;
      this.setData({ item, replyDraft: item.replyContent, dirty: false, conflict: false });
      wx.showToast({ title: '回复已保存', icon: 'success' });
    } catch (error) {
      if (this._alive && error.code !== 'STALE_SESSION') {
        this.setData({ conflict: error.code === 'CONFLICT', saveError: error.message });
      }
    } finally {
      if (this._alive) {
        this.setData({ saving: false });
        this.updateLeaveAlert();
      }
    }
  },

  backToList() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pkg-misc/feedback/index?tab=mine' });
  }
});
