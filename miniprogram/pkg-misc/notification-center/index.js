const { waitForAppInitialization } = require('../../utils/index');
const feedback = require('../../utils/feedback');
const releaseNotice = require('../../utils/releaseNotice');
const { isDeveloperOpenid } = require('../../config/developer');

const MESSAGE_TABS = [
  { id: 'all', label: '全部' },
  { id: 'notice', label: '公告更新' },
  { id: 'feedback', label: '反馈信息' }
];
const ADMIN_FEEDBACK_TAB = { id: 'admin-feedback', label: '反馈列表' };
const ADMIN_STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '未处理' },
  { value: 'processed', label: '已处理' }
];

Page({
  data: {
    activeTab: 'all',
    messageTabs: MESSAGE_TABS.map(tab => ({ ...tab, count: 0 })),
    isFeedbackAdmin: false,
    adminPendingCount: 0,
    adminStatusFilters: ADMIN_STATUS_FILTERS,
    adminStatusFilter: 'all',
    adminFeedbackItems: [],
    adminListLoading: false,
    adminListLoaded: false,
    adminListError: '',
    unreadCount: 0,
    feedbackUnreadCount: 0,
    feedbackKnown: false,
    feedbackLoading: true,
    feedbackError: '',
    noticeVisible: false,
    noticeText: '',
    noticeUnreadCount: 0,
    noticeGroups: [],
    latestNoticeId: '',
    expandedNoticeId: '',
    noticeHasMore: false,
    noticeMoreLoading: false,
    noticeMoreError: '',
    noticeLoading: true,
    noticeError: '',
    noticeLoaded: false,
    identityError: ''
  },

  onLoad() {
    this._alive = true;
    this._loadSeq = 0;
    this._adminListSeq = 0;
    this._unsubscribe = feedback.subscribeUnread(state => this.applyMessageState(state));
  },

  onShow() {
    this._visible = true;
    this.applyMessageState(feedback.getUnreadState(), true);
    this.loadMessages();
  },

  onHide() {
    this._visible = false;
  },

  onUnload() {
    this._alive = false;
    this._loadSeq += 1;
    this._adminListSeq += 1;
    if (this._unsubscribe) this._unsubscribe();
  },

  applyMessageState(state, readOnShow = false) {
    if (!this._alive) return;
    const notice = releaseNotice.getReleaseNoticeState(state.identity);
    const isFeedbackAdmin = isDeveloperOpenid(state.identity);
    const identityChanged = this._messageIdentity !== state.identity || this._messageGeneration !== state.generation;
    const latestNoticeId = notice.entries[0]?.id || '';
    const openLatest = !!latestNoticeId && (identityChanged || latestNoticeId !== this.data.latestNoticeId);
    const expandedNoticeId = openLatest ? latestNoticeId : this.data.expandedNoticeId;
    this._noticeEntries = notice.entries;
    this._messageIdentity = state.identity;
    this._messageGeneration = state.generation;
    // 账号变化或失去管理权限时立即清空管理数据，并阻断旧请求回写。
    const resetAdminList = identityChanged || !isFeedbackAdmin;
    if (resetAdminList) this._adminListSeq += 1;
    const tabs = isFeedbackAdmin ? [...MESSAGE_TABS, ADMIN_FEEDBACK_TAB] : MESSAGE_TABS;
    const unreadCount = state.count + notice.unreadCount;
    const adminPendingCount = isFeedbackAdmin ? state.adminPendingCount : 0;
    const counts = {
      all: unreadCount + adminPendingCount,
      notice: notice.unreadCount,
      feedback: state.count,
      'admin-feedback': adminPendingCount
    };
    this.setData({
      messageTabs: tabs.map(tab => ({ ...tab, count: counts[tab.id] })),
      isFeedbackAdmin,
      adminPendingCount: counts['admin-feedback'],
      activeTab: !isFeedbackAdmin && this.data.activeTab === ADMIN_FEEDBACK_TAB.id ? 'all' : this.data.activeTab,
      ...(resetAdminList ? {
        adminFeedbackItems: [], adminListLoading: false, adminListLoaded: false,
        adminListError: '', adminStatusFilter: 'all'
      } : {}),
      feedbackUnreadCount: state.count,
      feedbackKnown: state.known,
      noticeVisible: notice.visible,
      noticeText: notice.text,
      noticeUnreadCount: notice.unreadCount,
      noticeGroups: releaseNotice.groupReleaseNotices(notice.entries),
      latestNoticeId,
      noticeHasMore: notice.hasMore,
      expandedNoticeId: notice.entries.some(item => item.id === expandedNoticeId) ? expandedNoticeId : '',
      ...(identityChanged ? { noticeMoreLoading: false, noticeMoreError: '' } : {}),
      noticeLoaded: notice.loaded,
      unreadCount
    }, openLatest || readOnShow ? () => this.markExpandedNoticeRead() : undefined);
  },

  onTabTap(event) {
    const tab = event.currentTarget.dataset.tab;
    this.applyMessageState(feedback.getUnreadState());
    if (!this.data.messageTabs.some(item => item.id === tab) || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab }, tab === 'notice' ? () => this.markExpandedNoticeRead() : undefined);
    if (tab === ADMIN_FEEDBACK_TAB.id) this.retryAdminList();
  },

  async loadMessages({ force = false } = {}) {
    const request = ++this._loadSeq;
    const isCurrent = () => this._alive && request === this._loadSeq;
    this.setData({ noticeLoading: true, feedbackLoading: true, noticeMoreLoading: false,
      noticeError: '', noticeMoreError: '', feedbackError: '', identityError: '' });
    try {
      await waitForAppInitialization();
      await feedback.readyIdentity();
      if (!isCurrent()) return;
      const session = feedback.getUnreadState();
      const isSameSession = () => {
        if (!isCurrent()) return false;
        const current = feedback.getUnreadState();
        return current.identity === session.identity && current.generation === session.generation;
      };
      // 两种消息独立加载，某一侧失败时仍可查看另一侧。
      await Promise.all([
        releaseNotice.loadReleaseNotice().then(() => {
          if (isSameSession()) this.applyMessageState(feedback.getUnreadState());
        }).catch(() => {
          if (isSameSession()) this.setData({ noticeError: '公告暂时无法加载，请重试' });
        }),
        feedback.refreshUnread({ force: force || this.data.isFeedbackAdmin }).catch(() => {
          if (isSameSession()) this.setData({ feedbackError: '消息数量暂时无法更新，请重试' });
        }),
        this.data.activeTab === ADMIN_FEEDBACK_TAB.id ? this.loadAdminFeedbacks() : Promise.resolve()
      ]);
    } catch (error) {
      if (isCurrent()) this.setData({ identityError: error.message || '消息加载失败，请重试' });
    } finally {
      if (isCurrent()) this.setData({ noticeLoading: false, feedbackLoading: false });
    }
  },

  retryMessages() {
    return this.loadMessages({ force: true });
  },

  async onPullDownRefresh() {
    try {
      await this.loadMessages({ force: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async loadAdminFeedbacks() {
    if (!this._alive || !this.data.isFeedbackAdmin) return;
    const session = feedback.getUnreadState();
    if (!isDeveloperOpenid(session.identity)) return;
    const request = ++this._adminListSeq;
    const isCurrent = () => {
      if (!this._alive || request !== this._adminListSeq) return false;
      const current = feedback.getUnreadState();
      return current.identity === session.identity && current.generation === session.generation
        && isDeveloperOpenid(current.identity);
    };
    this.setData({ adminListLoading: true, adminListError: '' });
    try {
      // 接口根据微信上下文校验管理员身份，不依赖客户端传入的角色。
      const result = await feedback.callFeedback('list', { statusFilter: this.data.adminStatusFilter });
      if (!isCurrent()) return;
      this.setData({
        adminFeedbackItems: (result.data || []).map(item => ({
          ...feedback.normalizeFeedback(item),
          senderName: (item.userNickname || '').trim() || (item.babyName || '').trim() || '用户反馈'
        })),
        adminListLoaded: true
      });
    } catch (error) {
      if (isCurrent()) this.setData({ adminListError: error.message || '反馈列表加载失败，请重试' });
    } finally {
      if (isCurrent()) this.setData({ adminListLoading: false });
    }
  },

  retryAdminList() {
    const state = feedback.getUnreadState();
    if (!isDeveloperOpenid(state.identity) || !this.data.isFeedbackAdmin) return;
    feedback.refreshUnreadSilently({ force: true });
    return this.loadAdminFeedbacks();
  },

  onAdminFilterTap(event) {
    const value = event.currentTarget.dataset.value;
    if (!this.data.isFeedbackAdmin || !ADMIN_STATUS_FILTERS.some(item => item.value === value)
      || value === this.data.adminStatusFilter) return;
    this.setData({ adminStatusFilter: value, adminFeedbackItems: [], adminListLoaded: false });
    this.loadAdminFeedbacks();
  },

  openAdminFeedback(event) {
    const state = feedback.getUnreadState();
    if (!isDeveloperOpenid(state.identity) || !this.data.isFeedbackAdmin) return;
    const id = event.currentTarget.dataset.id;
    if (this.data.adminFeedbackItems.some(item => item._id === id)) {
      wx.navigateTo({ url: `/pkg-misc/feedback-detail/index?id=${encodeURIComponent(id)}&view=admin` });
    }
  },

  async loadMoreNotices() {
    if (!this.data.noticeHasMore || this.data.noticeLoading || this.data.noticeMoreLoading) return;
    const request = this._loadSeq;
    const session = feedback.getUnreadState();
    const isCurrent = () => {
      const current = feedback.getUnreadState();
      return this._alive && request === this._loadSeq
        && current.identity === session.identity && current.generation === session.generation;
    };
    this.setData({ noticeMoreLoading: true, noticeMoreError: '' });
    try {
      await releaseNotice.loadMoreReleaseNotices();
      if (isCurrent()) this.applyMessageState(feedback.getUnreadState());
    } catch (error) {
      if (isCurrent()) this.setData({ noticeMoreError: '更早的公告暂时无法加载' });
    } finally {
      if (isCurrent()) this.setData({ noticeMoreLoading: false });
    }
  },

  openNotice(event) {
    const { id } = event.currentTarget.dataset;
    if (!this.data.noticeVisible || !this._noticeEntries?.some(item => item.id === id)) return;
    const expandedNoticeId = this.data.expandedNoticeId === id ? '' : id;
    this.setData({ expandedNoticeId }, () => this.markExpandedNoticeRead());
  },

  markExpandedNoticeRead() {
    if (!this._alive || !this._visible || this.data.activeTab !== 'notice') return;
    const entry = this._noticeEntries?.find(item => item.id === this.data.expandedNoticeId && item.unread);
    if (!entry) return;
    const identity = this._messageIdentity;
    const generation = this._messageGeneration;
    const session = feedback.getUnreadState();
    if (!session.identity || session.identity !== identity || session.generation !== generation) return;
    try {
      releaseNotice.markReleaseNoticeRead(entry, session.identity);
      this.applyMessageState(session);
    } catch (error) {
      wx.showToast({ title: '阅读状态未保存，请重试', icon: 'none' });
    }
  },

  openFeedbackReplies() {
    wx.navigateTo({ url: '/pkg-misc/feedback/index?tab=mine' });
  },

  submitFeedback() {
    wx.navigateTo({ url: '/pkg-misc/feedback/index' });
  }
});
