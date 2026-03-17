const { waitForAppInitialization, handleError } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'new', label: '未处理' },
  { value: 'processed', label: '已处理' }
];

const AUTO_REFRESH_MS = 30000;

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

  autoRefreshTimer: null,
  hasInitialized: false,

  async onLoad() {
    try {
      await waitForAppInitialization();
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
      await this.loadFeedbacks();
      this.startAutoRefresh();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载反馈列表失败' });
    }
  },

  onShow() {
    if (!this.hasInitialized || !this.data.hasAccess) {
      return;
    }
    this.loadFeedbacks({ silent: true });
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  onPullDownRefresh() {
    if (!this.data.hasAccess) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadFeedbacks({ silent: true });
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.autoRefreshTimer = setInterval(() => {
      this.loadFeedbacks({ silent: true });
    }, AUTO_REFRESH_MS);
  },

  stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  },

  async loadFeedbacks({ silent = false } = {}) {
    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'feedbackManager',
        data: {
          action: 'list',
          statusFilter: this.data.statusFilter
        }
      });

      if (!res?.result?.ok) {
        throw new Error(res?.result?.message || '获取反馈列表失败');
      }

      const feedbackItems = (res.result.data || []).map(item => this.normalizeFeedbackItem(item));

      this.setData({
        feedbackItems,
        loading: false,
        lastUpdatedText: this.formatUpdateTime(new Date()),
        emptyText: this.getEmptyText(this.data.statusFilter)
      });
    } catch (error) {
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
    const createdAt = this.resolveCreatedAt(item);
    const status = item.status === 'processed' ? 'processed' : 'new';
    const systemInfoText = this.formatSystemInfo(item.systemInfo);
    const miniProgramText = this.formatMiniProgramInfo(item.miniProgramInfo);

    return {
      ...item,
      displayTime: this.formatDateTime(createdAt),
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

  resolveCreatedAt(item = {}) {
    if (item.createdAt instanceof Date) {
      return item.createdAt;
    }

    if (item.createdAt && typeof item.createdAt === 'object' && item.createdAt.$date) {
      return new Date(item.createdAt.$date);
    }

    if (item.clientCreatedAt) {
      const clientDate = new Date(item.clientCreatedAt);
      if (!Number.isNaN(clientDate.getTime())) {
        return clientDate;
      }
    }

    return new Date();
  },

  formatDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');

    return `${year}-${month}-${day} ${hour}:${minute}`;
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

    try {
      wx.showLoading({
        title: nextStatus === 'processed' ? '标记处理中...' : '恢复中...',
        mask: true
      });

      const res = await wx.cloud.callFunction({
        name: 'feedbackManager',
        data: {
          action: 'updateStatus',
          id,
          status: nextStatus
        }
      });

      if (!res?.result?.ok) {
        throw new Error(res?.result?.message || '更新反馈状态失败');
      }

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

  deleteFeedback(e) {
    const { id = '', content = '' } = e.currentTarget.dataset || {};
    if (!id) {
      return;
    }

    const previewText = (content || '').trim().slice(0, 30);

    wx.showModal({
      title: '删除反馈',
      content: previewText ? `确定删除这条反馈？\n\n${previewText}` : '确定删除这条反馈？',
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

          const result = await wx.cloud.callFunction({
            name: 'feedbackManager',
            data: {
              action: 'delete',
              id
            }
          });

          if (!result?.result?.ok) {
            throw new Error(result?.result?.message || '删除反馈失败');
          }

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
