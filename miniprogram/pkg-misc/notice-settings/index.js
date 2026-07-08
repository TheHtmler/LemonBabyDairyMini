const { waitForAppInitialization, handleError } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');

const DEFAULT_RELEASE_NOTICE_TEXT = '看板已升级：聚焦今日营养达成、喂养进度与用药打卡，明细请到「数据记录」查看。';

function formatDateTime(value) {
  if (!value) return '尚未保存';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未保存';
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    hasAccess: true,
    loading: true,
    saving: false,
    visible: true,
    text: DEFAULT_RELEASE_NOTICE_TEXT,
    updatedAtText: '尚未保存',
    updatedByText: ''
  },

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

      await this.loadConfig();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载公告配置失败' });
    }
  },

  async callManager(data = {}) {
    const res = await wx.cloud.callFunction({
      name: 'featureFlagManager',
      data
    });
    if (!res?.result?.ok) {
      throw new Error(res?.result?.message || '公告配置操作失败');
    }
    return res.result;
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const result = await this.callManager({
        action: 'getHomeReleaseNoticeConfig'
      });
      this.applyNotice(result.notice || {});
    } finally {
      this.setData({ loading: false });
    }
  },

  applyNotice(notice = {}) {
    this.setData({
      visible: notice.visible !== false,
      text: notice.text || DEFAULT_RELEASE_NOTICE_TEXT,
      updatedAtText: formatDateTime(notice.updatedAt),
      updatedByText: notice.updatedBy || ''
    });
  },

  onVisibleChange(e) {
    this.setData({ visible: !!e.detail.value });
  },

  onTextInput(e) {
    this.setData({ text: e.detail.value });
  },

  async onSaveConfig() {
    if (this.data.saving) return;
    const text = String(this.data.text || '').trim();
    if (this.data.visible && !text) {
      wx.showToast({
        title: '公告内容不能为空',
        icon: 'none'
      });
      return;
    }

    this.setData({ saving: true });
    try {
      const result = await this.callManager({
        action: 'updateHomeReleaseNotice',
        visible: this.data.visible,
        text: text || DEFAULT_RELEASE_NOTICE_TEXT
      });
      this.applyNotice(result.notice || {});
      wx.showToast({
        title: '已保存',
        icon: 'success'
      });
    } catch (error) {
      handleError(error, { title: error?.message || '保存公告配置失败' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
