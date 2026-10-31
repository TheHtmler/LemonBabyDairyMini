const { waitForAppInitialization, handleError } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');
const feedback = require('../../utils/feedback');

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '未处理' },
  { value: 'processed', label: '已处理' }
];

Page({
  data: {
    statusFilters: STATUS_FILTERS,
    statusFilter: 'all',
    feedbackItems: [],
    loading: true,
    hasAccess: true,
    lastUpdatedText: '',
    emptyText: '还没有反馈数据'
  },

  hasInitialized: false,

  async onLoad() {
    this._alive = true;
    this._loadSeq = 0;
    try {
      await waitForAppInitialization();
      if (!this._alive) return;
      const app = getApp();
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';

      if (!isDeveloperOpenid(openid)) {
        this.setData({
          hasAccess: false,
          loading: false
        });
        return;
      }

      this.hasInitialized = true;
      const generation = feedback.getUnreadState().generation;
      this._unsubscribe = feedback.subscribeUnread(state => {
        if (!this._alive) return;
        if (state.generation !== generation) {
          this._loadSeq += 1;
          this.setData({ hasAccess: false, feedbackItems: [], loading: false });
          return;
        }
      });
      await this.loadFeedbacks();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载反馈列表失败' });
    }
  },

  onShow() {
    feedback.getUnreadState();
    if (!this.hasInitialized || !this.data.hasAccess) {
      return;
    }
    this.loadFeedbacks({ silent: true });
  },

  onUnload() {
    this._alive = false;
    this._loadSeq += 1;
    if (this._unsubscribe) this._unsubscribe();
  },

  onPullDownRefresh() {
    if (!this.data.hasAccess) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadFeedbacks({ silent: true });
  },

  async loadFeedbacks({ silent = false } = {}) {
    if (!this._alive || !this.data.hasAccess) return;
    feedback.refreshUnreadSilently({ force: true });
    const request = ++this._loadSeq;
    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const result = await feedback.callFeedback('list', { statusFilter: this.data.statusFilter });
      if (!this._alive || request !== this._loadSeq) return;
      const feedbackItems = (result.data || []).map(item => this.normalizeFeedbackItem(item));

      this.setData({
        feedbackItems,
        loading: false,
        lastUpdatedText: this.formatUpdateTime(new Date()),
        emptyText: this.getEmptyText(this.data.statusFilter)
      });
    } catch (error) {
      if (!this._alive || request !== this._loadSeq || error.code === 'STALE_SESSION') return;
      this.setData({ loading: false });
      handleError(error, {
        title: error?.message || '刷新反馈列表失败'
      });
    } finally {
      wx.hideNavigationBarLoading();
      wx.stopPullDownRefresh();
    }
  },

  normalizeFeedbackItem(item = {}) {
    const status = item.status === 'processed' ? 'processed' : 'new';
    const systemInfoText = this.formatSystemInfo(item.systemInfo);
    const miniProgramText = this.formatMiniProgramInfo(item.miniProgramInfo);

    return {
      ...feedback.normalizeFeedback(item),
      status,
      statusText: status === 'processed' ? '已处理' : '未处理',
      roleText: item.userRole === 'participant' ? '参与者' : '创建者',
      contactText: (item.contact || '').trim(),
      openidText: (item.openid || '').trim(),
      userNicknameText: (item.userNickname || '').trim(),
      babyNameText: (item.babyName || '').trim(),
      babyNameDisplay: (item.babyName || '').trim() || '未记录',
      babyUidText: (item.babyUid || '').trim(),
      submitRouteText: (item.submitRoute || '').trim(),
      systemInfoText,
      miniProgramText
    };
  },

  formatSystemInfo(systemInfo = {}) {
    const parts = [
      systemInfo.brand,
      systemInfo.model,
      systemInfo.platform,
      systemInfo.system
    ].filter(Boolean);

    const suffix = [
      systemInfo.version ? `微信 ${systemInfo.version}` : '',
      systemInfo.SDKVersion ? `基础库 ${systemInfo.SDKVersion}` : '',
      systemInfo.language ? `语言 ${systemInfo.language}` : ''
    ].filter(Boolean);

    return [...parts, ...suffix].join(' | ');
  },

  formatMiniProgramInfo(miniProgramInfo = {}) {
    const parts = [
      miniProgramInfo.version ? `版本 ${miniProgramInfo.version}` : '',
      miniProgramInfo.envVersion ? `环境 ${miniProgramInfo.envVersion}` : ''
    ].filter(Boolean);

    return parts.join(' | ');
  },

  formatUpdateTime(date) {
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${hour}:${minute}`;
  },

  getEmptyText(statusFilter) {
    if (statusFilter === 'new') {
      return '当前没有未处理反馈';
    }
    if (statusFilter === 'processed') {
      return '当前没有已处理反馈';
    }
    return '还没有反馈数据';
  },

  onFilterTap(e) {
    const { value } = e.currentTarget.dataset || {};
    if (!value || value === this.data.statusFilter) {
      return;
    }

    this.setData({
      statusFilter: value
    });
    wx.showNavigationBarLoading();
    this.loadFeedbacks({ silent: true });
  },

  async toggleStatus(e) {
    const { id, status } = e.currentTarget.dataset || {};
    if (!id) {
      return;
    }

    const nextStatus = status === 'processed' ? 'new' : 'processed';
    const item = this.data.feedbackItems.find(item => item._id === id);
    if (!item) return;
    if (nextStatus === 'processed' && !item?.replyContent) {
      wx.showToast({ title: '请先填写处理说明', icon: 'none' });
      this.openReply(e);
      return;
    }

    try {
      wx.showLoading({
        title: nextStatus === 'processed' ? '标记处理中...' : '恢复中...',
        mask: true
      });

      await feedback.callFeedback('updateStatus', {
        id, status: nextStatus, baseConversationVersion: item.conversationVersion
      });
      feedback.invalidateUnread();
      feedback.refreshUnreadSilently({ force: true });

      wx.hideLoading();
      wx.showToast({
        title: nextStatus === 'processed' ? '已标记处理' : '已恢复未处理',
        icon: 'success'
      });

      this.loadFeedbacks({ silent: true });
    } catch (error) {
      wx.hideLoading();
      handleError(error, {
        title: error?.message || '更新处理状态失败',
        hideLoading: false
      });
    }
  },

  openReply(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pkg-misc/feedback-detail/index?id=${encodeURIComponent(id)}&view=admin` });
  },

  deleteFeedback(e) {
    const { id = '', content = '' } = e.currentTarget.dataset || {};
    if (!id) {
      return;
    }

    const previewText = (content || '').trim().slice(0, 30);

    wx.showModal({
      title: '删除反馈',
      content: `删除后，该反馈及回复将从用户的“我的反馈”中移除。\n\n${previewText}`,
      confirmColor: '#D65B00',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        try {
          wx.showLoading({
            title: '删除中...',
            mask: true
          });

          await feedback.callFeedback('delete', { id });
          feedback.invalidateUnread();
          feedback.refreshUnreadSilently({ force: true });

          wx.hideLoading();
          wx.showToast({
            title: '已删除',
            icon: 'success'
          });

          this.loadFeedbacks({ silent: true });
        } catch (error) {
          wx.hideLoading();
          handleError(error, {
            title: error?.message || '删除反馈失败',
            hideLoading: false
          });
        }
      }
    });
  },

  copyValue(e) {
    const { value = '', successText = '已复制' } = e.currentTarget.dataset || {};
    if (!value) {
      return;
    }

    wx.setClipboardData({
      data: value,
      success: () => {
        wx.showToast({
          title: successText,
          icon: 'success'
        });
      }
    });
  }
});
