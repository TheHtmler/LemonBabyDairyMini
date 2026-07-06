const { waitForAppInitialization, handleError } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');

function splitOpenids(text = '') {
  return Array.from(new Set(
    String(text || '')
      .split(/[\n,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function formatOpenids(openids = []) {
  return splitOpenids(openids).join('\n');
}

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
    scope: 'whitelist',
    allowOpenidsText: '',
    message: '拍照识别功能调试中，仅对白名单用户开放',
    currentOpenid: '',
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

      this.setData({ currentOpenid: openid });
      await this.loadConfig();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载 OCR 配置失败' });
    }
  },

  async callManager(data = {}) {
    const res = await wx.cloud.callFunction({
      name: 'featureFlagManager',
      data
    });
    if (!res?.result?.ok) {
      throw new Error(res?.result?.message || 'OCR 配置操作失败');
    }
    return res.result;
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const result = await this.callManager({
        action: 'getReportOcrAccessConfig'
      });
      this.applyConfig(result.config || {});
    } finally {
      this.setData({ loading: false });
    }
  },

  applyConfig(config = {}) {
    this.setData({
      scope: config.scope === 'all' ? 'all' : 'whitelist',
      allowOpenidsText: formatOpenids(config.allowOpenids || []),
      message: config.message || this.data.message,
      updatedAtText: formatDateTime(config.updatedAt),
      updatedByText: config.updatedBy || ''
    });
  },

  onScopeTap(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope !== 'all' && scope !== 'whitelist') return;
    this.setData({ scope });
  },

  onOpenidsInput(e) {
    this.setData({ allowOpenidsText: e.detail.value });
  },

  onMessageInput(e) {
    this.setData({ message: e.detail.value });
  },

  onAddCurrentOpenid() {
    const openids = splitOpenids(this.data.allowOpenidsText);
    if (this.data.currentOpenid && !openids.includes(this.data.currentOpenid)) {
      openids.push(this.data.currentOpenid);
    }
    this.setData({ allowOpenidsText: formatOpenids(openids) });
  },

  async onSaveConfig() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const result = await this.callManager({
        action: 'updateReportOcrAccessConfig',
        scope: this.data.scope,
        allowOpenids: splitOpenids(this.data.allowOpenidsText),
        message: this.data.message
      });
      this.applyConfig(result.config || {});
      wx.showToast({
        title: '已保存',
        icon: 'success'
      });
    } catch (error) {
      handleError(error, { title: error?.message || '保存 OCR 配置失败' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
