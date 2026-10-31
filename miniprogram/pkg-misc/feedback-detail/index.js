const feedback = require('../../utils/feedback');

function conversationTime(displayTime) {
  if (!displayTime) return '';
  const [day, time] = displayTime.split(' ');
  const [year, month, date] = day.split('-').map(Number);
  const now = new Date();
  if (year === now.getFullYear() && month === now.getMonth() + 1 && date === now.getDate()) return time;
  return `${year === now.getFullYear() ? '' : `${year}年`}${month}月${date}日 ${time}`;
}

function detailItem(data) {
  const item = feedback.normalizeFeedback(data);
  return { ...item, conversationTime: conversationTime(item.displayTime) };
}

function conversationEntries(entries, item, adminView) {
  let previous = { role: 'user', createdAt: item.createdAt || item.clientCreatedAt, displayTime: item.displayTime };
  return entries.map(entry => {
    const normalized = feedback.normalizeFeedbackEntry(entry, item, adminView);
    const timestamp = new Date(entry.createdAt?.$date || entry.createdAt).getTime();
    const previousTimestamp = new Date(previous.createdAt?.$date || previous.createdAt).getTime();
    // 连续消息共用时间和对方身份，跨五分钟或跨日期时再显示时间。
    const showTime = !Number.isFinite(timestamp) || !Number.isFinite(previousTimestamp)
      || timestamp - previousTimestamp >= 5 * 60 * 1000
      || normalized.displayTime.slice(0, 10) !== previous.displayTime.slice(0, 10);
    const showAuthor = !normalized.fromMe && (previous.role !== normalized.role || showTime);
    previous = normalized;
    return { ...normalized, showTime, showAuthor, conversationTime: conversationTime(normalized.displayTime) };
  });
}

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
    saveError: '',
    scrollTarget: '',
    scrollAnimated: false,
    keyboardHeight: 0,
    inputFocused: false,
    showMetadata: false,
    refreshing: false,
    processAfterSend: false,
    retryMode: '',
    statusOptions: ['待处理', '已处理'],
    statusSaving: false
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
          saving: false, loading: false, statusSaving: false, keyboardHeight: 0, inputFocused: false, processAfterSend: false, retryMode: '',
          errorText: '用户身份已变化，请返回后重新进入' });
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
    if (this._ready && !this.data.loading && !this.data.saving && !this.data.statusSaving) this.loadDetail({ preserveDraft: true });
  },

  onHide() {
    this._visible = false;
    this.stopObservingReply();
    this.setData({ keyboardHeight: 0, inputFocused: false });
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
    // 同时限制在滚动区与页面内，避免被顶部信息或底部输入栏遮住时提前清除未读。
    this._observer = this.createIntersectionObserver({ thresholds: [0, 0.1] });
    this._observer.relativeTo('.conversation-scroll').relativeToViewport().observe('.latest-reply', result => {
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
    if (!this._alive || this.data.saving || this.data.statusSaving) return;
    const request = ++this._loadSeq;
    this._historySeq += 1;
    this.stopObservingReply();
    this.setData({ loading: true, historyLoading: false, errorText: '' });
    try {
      const result = await feedback.callFeedback('getDetail', { id: this._id, view: this._view });
      if (!this._alive || request !== this._loadSeq) return;
      const firstLoad = !this._ready;
      const item = detailItem(result.data);
      const draft = preserveDraft ? this.data.draft : '';
      if (this.data.conflict || !preserveDraft) this._pendingAppend = null;
      const retryMode = this._pendingAppend && this._submissionUncertain ? this._pendingAppend.mode : '';
      this._ready = true;
      this.setData({ item, canReply: result.canReply === true, draft,
        quote: preserveDraft ? this.data.quote : null,
        entries: conversationEntries(result.entries || [], item, result.canReply),
        retryMode, processAfterSend: retryMode === 'process' || (item.status !== 'processed' && this.data.processAfterSend),
        nextCursor: result.nextCursor, historyLoading: false, historyError: '',
        dirty: !!draft.trim(), conflict: false,
        loading: false, hasNewerReply: false, readError: '', saveError: '' }, () => {
        if (firstLoad) {
          const unread = !result.canReply && this.data.entries.find(entry => entry.role === 'admin'
            && entry.replyVersion > item.readReplyVersion);
          this.scrollToAnchor(unread ? `message-${unread.sequence}` : 'conversation-end');
        }
        this.observeReply();
      });
      wx.setNavigationBarTitle({ title: result.canReply ? '处理反馈' : '反馈沟通' });
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
      if (this.data.saving || this.data.statusSaving) return;
      await this.retryLoad();
      feedback.refreshUnreadSilently({ force: true });
    } finally { wx.stopPullDownRefresh(); }
  },

  async refreshConversation() {
    if (this.data.refreshing || this.data.loading || this.data.saving || this.data.statusSaving) return;
    this.setData({ refreshing: true });
    try { await this.onPullDownRefresh(); }
    finally { if (this._alive) this.setData({ refreshing: false }); }
  },

  scrollToAnchor(anchor, animated = false) {
    if (!this._alive) return;
    // 清空旧锚点后再设置，同一位置的连续发送、键盘展开也能触发定位。
    this.setData({ scrollTarget: '', scrollAnimated: animated }, () => {
      if (this._alive) this.setData({ scrollTarget: anchor });
    });
  },

  scrollToLatest() {
    this.scrollToAnchor('conversation-end', true);
  },

  onKeyboardHeightChange(event) {
    if (!this._alive || !this.data.item) return;
    const height = Math.max(0, Number(event.detail.height) || 0);
    if (height === this.data.keyboardHeight) return;
    this.setData({ keyboardHeight: height }, () => {
      if (height > 0) this.scrollToLatest();
    });
  },

  onDraftFocus() {
    this.setData({ inputFocused: true });
  },

  onDraftBlur() {
    this.setData({ inputFocused: false, keyboardHeight: 0 });
  },

  toggleMetadata() {
    this.setData({ showMetadata: !this.data.showMetadata });
  },

  onProcessChange(event) {
    if (!this.data.canReply || this.data.saving || this.data.statusSaving || this.data.retryMode || this.data.item?.status === 'processed') return;
    this.setData({ processAfterSend: event.detail.value.includes('process') });
  },

  async onStatusChange(event) {
    if (!this._alive || !this._ready || !this.data.canReply || !this.data.item
      || this.data.loading || this.data.saving || this.data.statusSaving || this.data.conflict || this.data.retryMode) return;
    const status = ['new', 'processed'][Number(event.detail.value)];
    if (!status || status === this.data.item.status) return;
    if (status === 'processed' && !this.data.item.replyContent) {
      wx.showToast({ title: '请先回复用户，再标记已处理', icon: 'none' });
      this.setData({ inputFocused: true });
      return;
    }
    const baseConversationVersion = this.data.item.conversationVersion;
    this._historySeq += 1;
    this.setData({ statusSaving: true, historyLoading: false });
    this.updateLeaveAlert();
    let reload = false;
    try {
      await feedback.callFeedback('updateStatus', { id: this._id, status, baseConversationVersion });
      feedback.invalidateUnread();
      feedback.refreshUnreadSilently({ force: true });
      if (!this._alive || !this.data.canReply || !this.data.item) return;
      this._pendingAppend = null;
      this._submissionUncertain = false;
      this.setData({ 'item.status': status, 'item.statusText': status === 'processed' ? '已处理' : '未处理',
        processAfterSend: false });
      reload = true;
      wx.showToast({ title: status === 'processed' ? '已标记处理' : '已恢复待处理', icon: 'success' });
    } catch (error) {
      if (!this._alive || error.code === 'STALE_SESSION') return;
      // 回包超时也可能已经写入，刷新成功前禁止依据旧状态继续操作。
      reload = true;
      this._pendingAppend = null;
      this.setData({ conflict: true, saveError: '状态尚未确认，请刷新后继续，草稿会保留。' });
      feedback.invalidateUnread();
      feedback.refreshUnreadSilently({ force: true });
      wx.showToast({ title: error.code === 'CONFLICT' ? '有新沟通内容，请刷新后重新切换' : error.message || '状态更新失败，请重试', icon: 'none' });
    } finally {
      if (this._alive) {
        this.setData({ statusSaving: false });
        this.updateLeaveAlert();
      }
    }
    // 状态操作后重新读取服务端记录，同时保留正在编辑的内容和引用。
    if (reload && this._alive) await this.loadDetail({ preserveDraft: true });
  },

  refreshConflict() {
    return this.loadDetail({ preserveDraft: true });
  },

  async loadEarlier() {
    if (!this.data.nextCursor || this.data.historyLoading || this.data.loading || this.data.saving || this.data.statusSaving) return;
    const request = ++this._historySeq;
    this.setData({ historyLoading: true, historyError: '' });
    try {
      const result = await feedback.callFeedback('listEntries', {
        id: this._id, view: this._view, before: this.data.nextCursor
      });
      if (!this._alive || request !== this._historySeq) return;
      const anchor = this.data.entries.length ? `message-${this.data.entries[0].sequence}` : 'original-message';
      const ids = new Set(this.data.entries.map(entry => entry._id));
      const earlier = (result.entries || []).filter(entry => !ids.has(entry._id));
      this.setData({
        entries: conversationEntries([...earlier, ...this.data.entries], this.data.item, this.data.canReply),
        nextCursor: result.nextCursor
      }, () => {
        this.scrollToAnchor(anchor);
        this.observeReply();
      });
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
    this.setData({ quote: { id: entry._id, content: entry.content.slice(0, 160) },
      inputFocused: true, saveError: '', retryMode: '' });
  },

  cancelQuote() {
    if (this.data.saving) return;
    this._pendingAppend = null;
    this.setData({ quote: null, retryMode: '' });
  },

  onDraftInput(event) {
    if (this.data.saving || !this.data.item) return;
    const draft = event.detail.value || '';
    this._pendingAppend = null;
    this.setData({ draft, dirty: !!draft.trim(), saveError: '', retryMode: '' });
    this.updateLeaveAlert();
  },

  updateLeaveAlert() {
    if (this.data.dirty || this.data.saving || this.data.statusSaving) {
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({
        message: this.data.statusSaving ? '反馈状态正在更新，请稍后返回。' : '内容尚未发送，返回后将丢失本次编辑。', fail() {}
      });
    } else if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload({ fail() {} });
    }
  },

  async submitEntry(event) {
    if (!this._ready || !this.data.item || this.data.loading || this.data.saving || this.data.statusSaving || this.data.conflict) return;
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
      const item = detailItem(result.data);
      this._pendingAppend = null;
      this._submissionUncertain = false;
      this._historySeq += 1;
      this.setData({ item, entries: conversationEntries(result.entries || [], item, this.data.canReply),
        nextCursor: result.nextCursor, draft: '', quote: null, dirty: false, conflict: false,
        processAfterSend: false, retryMode: '',
        historyLoading: false, historyError: '' }, () => {
        this.scrollToLatest();
        this.observeReply();
      });
      wx.showToast({ title: mode === 'process' ? '已回复并处理' : '已发送', icon: 'success' });
    } catch (error) {
      if (this._alive && error.code !== 'STALE_SESSION') {
        this._submissionUncertain = !['INVALID_ARGUMENT', 'CONFLICT', 'CONTENT_REJECTED', 'SECURITY_CHECK_FAILED',
          'RATE_LIMITED', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'].includes(error.code);
        if (error.code === 'CONFLICT') this._pendingAppend = null;
        this.setData({ conflict: error.code === 'CONFLICT', saveError: error.message,
          retryMode: this._submissionUncertain && this._pendingAppend ? this._pendingAppend.mode : '' });
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
