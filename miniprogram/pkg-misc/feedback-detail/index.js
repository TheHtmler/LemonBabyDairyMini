const feedback = require('../../utils/feedback');

Page({
  data: {
    loading: true,
    errorText: '',
    item: null,
    canReply: false,
    entries: [],
    nextCursor: null,
    historyLoading: false,
    historyError: '',
    draft: '',
    quote: null,
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
    this._historySeq = 0;
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
        this._historySeq += 1;
        this._ready = false;
        this._pendingAppend = null;
        this.stopObservingReply();
        this.setData({ item: null, entries: [], nextCursor: null, canReply: false, draft: '', quote: null, dirty: false,
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
    if (this._ready && !this.data.loading && !this.data.saving) this.loadDetail({ preserveDraft: true });
  },

  onHide() {
    this._visible = false;
    this.stopObservingReply();
  },

  onUnload() {
    this._alive = false;
    this._visible = false;
    this._loadSeq += 1;
    this._historySeq += 1;
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
    if (!this._visible || this.data.canReply || !item?.hasUnreadReply
      || !this.data.entries.some(entry => entry.isLatestReply)) return;
    const shownVersion = item.replyVersion;
    // 回复区域真正进入可视范围后，才确认这一版已读；长问题下方的回复不会被提前清除。
    this._observer = this.createIntersectionObserver({ thresholds: [0, 0.1] });
    this._observer.relativeToViewport().observe('.latest-reply', result => {
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

  async loadDetail({ preserveDraft = true } = {}) {
    if (!this._alive || this.data.saving) return;
    const request = ++this._loadSeq;
    this._historySeq += 1;
    this.stopObservingReply();
    this.setData({ loading: true, historyLoading: false, errorText: '' });
    try {
      const result = await feedback.callFeedback('getDetail', { id: this._id, view: this._view });
      if (!this._alive || request !== this._loadSeq) return;
      const item = feedback.normalizeFeedback(result.data);
      const draft = preserveDraft ? this.data.draft : '';
      if (this.data.conflict || !preserveDraft) this._pendingAppend = null;
      this._ready = true;
      this.setData({ item, canReply: result.canReply === true, draft,
        quote: preserveDraft ? this.data.quote : null,
        entries: (result.entries || []).map(entry => feedback.normalizeFeedbackEntry(entry, item, result.canReply)),
        nextCursor: result.nextCursor, historyLoading: false, historyError: '',
        dirty: !!draft.trim(), conflict: false,
        loading: false, hasNewerReply: false, readError: '', saveError: '' }, () => this.observeReply());
      wx.setNavigationBarTitle({ title: result.canReply ? '处理反馈' : '反馈详情' });
      this.updateLeaveAlert();
    } catch (error) {
      if (this._alive && request === this._loadSeq && error.code !== 'STALE_SESSION') {
        const unavailable = ['NOT_FOUND', 'FORBIDDEN'].includes(error.code);
        this.setData({ loading: false, errorText: error.message,
          ...(unavailable ? { item: null, entries: [], canReply: false } : {}) });
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

  async loadEarlier() {
    if (!this.data.nextCursor || this.data.historyLoading || this.data.loading || this.data.saving) return;
    const request = ++this._historySeq;
    this.setData({ historyLoading: true, historyError: '' });
    try {
      const result = await feedback.callFeedback('listEntries', {
        id: this._id, view: this._view, before: this.data.nextCursor
      });
      if (!this._alive || request !== this._historySeq) return;
      const ids = new Set(this.data.entries.map(entry => entry._id));
      const earlier = (result.entries || []).filter(entry => !ids.has(entry._id));
      this.setData({
        entries: [...earlier, ...this.data.entries].map(entry => feedback.normalizeFeedbackEntry(entry, this.data.item, this.data.canReply)),
        nextCursor: result.nextCursor
      }, () => this.observeReply());
    } catch (error) {
      if (this._alive && request === this._historySeq && error.code !== 'STALE_SESSION') {
        this.setData({ historyError: error.message || '更早记录加载失败，请重试' });
      }
    } finally {
      if (this._alive && request === this._historySeq) this.setData({ historyLoading: false });
    }
  },

  quoteReply(event) {
    if (this.data.canReply || this.data.saving || !this.data.item) return;
    const entry = this.data.entries.find(entry => entry._id === event.currentTarget.dataset.id && entry.role === 'admin');
    if (!entry) return;
    this._pendingAppend = null;
    this.setData({ quote: { id: entry._id, content: entry.content.slice(0, 160) }, saveError: '' });
    wx.pageScrollTo({ selector: '#follow-up-editor', duration: 200 });
  },

  cancelQuote() {
    if (this.data.saving) return;
    this._pendingAppend = null;
    this.setData({ quote: null });
  },

  onDraftInput(event) {
    if (this.data.saving || !this.data.item) return;
    const draft = event.detail.value || '';
    this._pendingAppend = null;
    this.setData({ draft, dirty: !!draft.trim(), saveError: '' });
    this.updateLeaveAlert();
  },

  updateLeaveAlert() {
    if (this.data.dirty || this.data.saving) {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({
        message: '补充内容尚未提交，返回后将丢失本次编辑。', fail() {}
      });
    } else if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload({ fail() {} });
    }
  },

  async submitEntry(event) {
    if (!this._ready || !this.data.item || this.data.loading || this.data.saving || this.data.conflict) return;
    const content = this.data.draft.trim();
    if (!content || content.length > 1000) {
      wx.showToast({ title: '请填写 1–1000 字的内容', icon: 'none' });
      return;
    }
    const mode = event.currentTarget.dataset.mode;
    if (!['reply', 'process'].includes(mode) || (!this.data.canReply && mode !== 'reply')) return;
    const replyToId = this.data.quote ? this.data.quote.id : '';
    if (this._pendingAppend && this._submissionUncertain && this._pendingAppend.mode !== mode
      && this._pendingAppend.content === content && this._pendingAppend.replyToId === replyToId) {
      wx.showToast({ title: '请先重试上次提交，确认处理结果', icon: 'none' });
      return;
    }
    // 网络重试沿用原提交标识和版本，即使先刷新记录也不会重复追加。
    if (!this._pendingAppend || this._pendingAppend.content !== content
      || this._pendingAppend.mode !== mode || this._pendingAppend.replyToId !== replyToId) {
      this._pendingAppend = { id: this._id, view: this._view, content, mode, replyToId,
        baseConversationVersion: this.data.item.conversationVersion, requestId: feedback.createReplyRequestId() };
      this._submissionUncertain = false;
    }
    this.setData({ saving: true, saveError: '' });
    this.updateLeaveAlert();
    try {
      const result = await feedback.callFeedback('appendEntry', this._pendingAppend);
      feedback.invalidateUnread();
      feedback.refreshUnreadSilently({ force: true });
      if (!this._alive) return;
      const item = feedback.normalizeFeedback(result.data);
      this._pendingAppend = null;
      this._submissionUncertain = false;
      this._historySeq += 1;
      this.setData({ item, entries: (result.entries || []).map(entry => feedback.normalizeFeedbackEntry(entry, item, this.data.canReply)),
        nextCursor: result.nextCursor, draft: '', quote: null, dirty: false, conflict: false,
        historyLoading: false, historyError: '' }, () => this.observeReply());
      wx.showToast({ title: this.data.canReply ? '回复已提交' : '补充已提交', icon: 'success' });
    } catch (error) {
      if (this._alive && error.code !== 'STALE_SESSION') {
        this._submissionUncertain = !['INVALID_ARGUMENT', 'CONFLICT', 'CONTENT_REJECTED', 'SECURITY_CHECK_FAILED',
          'RATE_LIMITED', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code);
        if (error.code === 'CONFLICT') this._pendingAppend = null;
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
    else wx.redirectTo({ url: this._view === 'admin' ? '/pkg-misc/feedback-list/index' : '/pkg-misc/feedback/index?tab=mine' });
  }
});
