const { waitForAppInitialization } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');

function accountKey() {
  return getApp().globalData.openid || wx.getStorageSync('openid') || '';
}

function parseLimit(value) {
  const text = String(value).trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const limit = Number(text);
  return limit <= 10000 ? limit : null;
}

Page({
  data: {
    hasAccess: false, loading: true, saving: false, ready: false,
    limitInput: '', currentLimit: 0, configured: false, version: 0,
    canSave: false, fieldError: '', errorText: '', canReload: false
  },

  async onLoad() {
    this._unloaded = false;
    try {
      await waitForAppInitialization();
      if (this._unloaded) return;
      this._account = accountKey();
      const hasAccess = isDeveloperOpenid(this._account);
      this.setData({ hasAccess, loading: false });
      if (hasAccess) await this.loadConfig();
    } catch (error) {
      if (!this._unloaded) this.setData({ loading: false, errorText: '账号信息加载失败，请返回后重试' });
    }
  },

  onShow() {
    if (this._account && accountKey() !== this._account) {
      this.setData({ hasAccess: false, loading: false, saving: false, ready: false });
    }
  },

  onUnload() { this._unloaded = true; },

  isCurrentAccount() {
    return !this._unloaded && this.data.hasAccess && this._account === accountKey();
  },

  async callConfig(name, data) {
    const response = await wx.cloud.callFunction({ name, data });
    const result = response && response.result;
    if (!result || !result.ok) {
      throw Object.assign(new Error(result && result.message || '配置操作失败，请重试'), {
        code: result && result.code || 'REQUEST_FAILED'
      });
    }
    return result.config;
  },

  applyConfig(config) {
    if (!config || !Number.isInteger(config.dailyLimit) || config.dailyLimit < 0 || config.dailyLimit > 10000 ||
        !Number.isSafeInteger(config.version) || config.version < 0 || typeof config.configured !== 'boolean') {
      throw new Error('配置返回格式无效，请更新云函数后重试');
    }
    this.setData({
      ready: true, currentLimit: config.dailyLimit, limitInput: String(config.dailyLimit),
      configured: config.configured, version: config.version, canSave: !config.configured,
      fieldError: '', errorText: '', canReload: false
    });
  },

  async loadConfig() {
    if (this._loading || this.data.saving || !this.isCurrentAccount()) return;
    this._loading = true;
    this.setData({ loading: true, ready: false, canSave: false, errorText: '', canReload: false });
    try {
      // 从实际执行识别的云函数读取，保证首次显示值包含该函数现有的环境配置。
      const config = await this.callConfig('recognizeNutritionLabel', { action: 'getDailyLimit' });
      if (this.isCurrentAccount()) this.applyConfig(config);
    } catch (error) {
      if (this.isCurrentAccount()) this.setData({ errorText: error.message || '加载失败，请重试', canReload: true });
    } finally {
      this._loading = false;
      if (this.isCurrentAccount()) this.setData({ loading: false });
    }
  },

  onLimitInput(event) {
    if (!this.isCurrentAccount() || this.data.loading || this.data.saving) return;
    const value = event.detail.value;
    const limit = parseLimit(value);
    this.setData({
      limitInput: value,
      fieldError: limit === null ? '请输入 0～10000 的整数' : '',
      canSave: this.data.ready && limit !== null && (!this.data.configured || limit !== this.data.currentLimit)
    });
  },

  async onSaveConfig() {
    if (!this.isCurrentAccount() || !this.data.ready || this.data.loading || this.data.saving || !this.data.canSave) return;
    const dailyLimit = parseLimit(this.data.limitInput);
    if (dailyLimit === null) {
      this.setData({ fieldError: '请输入 0～10000 的整数', canSave: false }); return;
    }
    this.setData({ saving: true, errorText: '', canReload: false });
    try {
      const config = await this.callConfig('featureFlagManager', {
        action: 'updateNutritionQuota', dailyLimit, expectedVersion: this.data.version
      });
      if (!this.isCurrentAccount()) return;
      this.applyConfig(config);
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      if (!this.isCurrentAccount()) return;
      if (error.code === 'NO_PERMISSION') this.setData({ hasAccess: false, ready: false });
      else this.setData({ errorText: error.message || '保存失败，请重试', canReload: error.code === 'CONFIG_CONFLICT' });
    } finally {
      if (!this._unloaded && this._account === accountKey()) this.setData({ saving: false });
    }
  }
});
