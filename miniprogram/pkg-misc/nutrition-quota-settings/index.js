const { waitForAppInitialization } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');

const QUOTA_FIELDS = [
  { key: 'scan', title: '食物与包装识别', description: '食物、包装和单独发起的 AI 估算共用次数。',
    cloudFunction: 'recognizeNutritionLabel', updateAction: 'updateNutritionQuota' },
  { key: 'report', title: '报告识别', description: '报告单独计数，同一份报告的1至6张图片合并计一次识别。',
    cloudFunction: 'recognizeReportCustom', updateAction: 'updateReportQuota' }
];

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
    hasAccess: false, loading: true, errorText: '',
    quotas: QUOTA_FIELDS.map(field => ({ key: field.key, title: field.title, description: field.description,
      loading: false, saving: false, ready: false, limitInput: '', currentLimit: 0,
      configured: false, version: 0, canSave: false, fieldError: '', errorText: '', canReload: false }))
  },

  async onLoad() {
    this._unloaded = false;
    try {
      await waitForAppInitialization();
      if (this._unloaded) return;
      this._account = accountKey();
      const hasAccess = isDeveloperOpenid(this._account);
      this.setData({ hasAccess, loading: false });
      if (hasAccess) await Promise.all(QUOTA_FIELDS.map(field => this.loadConfig(field.key)));
    } catch (error) {
      if (!this._unloaded) this.setData({ loading: false, errorText: '账号信息加载失败，请返回后重试' });
    }
  },

  onShow() {
    if (this._account && accountKey() !== this._account) this.setData({ hasAccess: false, loading: false });
  },

  onUnload() { this._unloaded = true; },

  isCurrentAccount() {
    return !this._unloaded && this.data.hasAccess && this._account === accountKey();
  },

  updateField(key, patch) {
    if (this._unloaded) return;
    this.setData({ quotas: this.data.quotas.map(field => field.key === key ? { ...field, ...patch } : field) });
  },

  async callConfig(name, data) {
    const cloudEnvId = getApp().globalData.cloudEnvId;
    const response = await wx.cloud.callFunction({ name, data, ...(cloudEnvId ? { config: { env: cloudEnvId } } : {}) });
    const result = response && response.result;
    if (!result || !result.ok) {
      throw Object.assign(new Error(result && result.message || '配置操作失败，请重试'), {
        code: result && result.code || 'REQUEST_FAILED'
      });
    }
    return result.config;
  },

  applyConfig(key, config) {
    if (!config || !Number.isInteger(config.dailyLimit) || config.dailyLimit < 0 || config.dailyLimit > 10000 ||
        !Number.isSafeInteger(config.version) || config.version < 0 || typeof config.configured !== 'boolean') {
      throw new Error('配置返回格式无效，请更新云函数后重试');
    }
    this.updateField(key, {
      ready: true, currentLimit: config.dailyLimit, limitInput: String(config.dailyLimit),
      configured: config.configured, version: config.version, canSave: !config.configured,
      fieldError: '', errorText: '', canReload: false
    });
  },

  async loadConfig(key) {
    const definition = QUOTA_FIELDS.find(field => field.key === key);
    const field = this.data.quotas.find(item => item.key === key);
    if (!definition || !field || field.loading || field.saving || !this.isCurrentAccount()) return;
    this.updateField(key, { loading: true, ready: false, canSave: false, errorText: '', canReload: false });
    try {
      // 从实际识别函数分别读取，未配置时展示各自云函数真实的兜底值。
      const config = await this.callConfig(definition.cloudFunction, { action: 'getDailyLimit' });
      if (this.isCurrentAccount()) this.applyConfig(key, config);
    } catch (error) {
      if (this.isCurrentAccount()) this.updateField(key, { errorText: error.message || '加载失败，请重试', canReload: true });
    } finally {
      if (this.isCurrentAccount()) this.updateField(key, { loading: false });
    }
  },

  reloadConfig(event) {
    return this.loadConfig(event.currentTarget.dataset.key);
  },

  onLimitInput(event) {
    const key = event.currentTarget.dataset.key;
    const field = this.data.quotas.find(item => item.key === key);
    if (!this.isCurrentAccount() || !field || field.loading || field.saving || !field.ready) return;
    const value = event.detail.value;
    const limit = parseLimit(value);
    this.updateField(key, {
      limitInput: value,
      fieldError: limit === null ? '请输入 0～10000 的整数' : '',
      canSave: limit !== null && (!field.configured || limit !== field.currentLimit)
    });
  },

  async onSaveConfig(event) {
    const key = event.currentTarget.dataset.key;
    const definition = QUOTA_FIELDS.find(field => field.key === key);
    const field = this.data.quotas.find(item => item.key === key);
    if (!this.isCurrentAccount() || !definition || !field || !field.ready || field.loading || field.saving || !field.canSave) return;
    const dailyLimit = parseLimit(field.limitInput);
    if (dailyLimit === null) {
      this.updateField(key, { fieldError: '请输入 0～10000 的整数', canSave: false }); return;
    }
    this.updateField(key, { saving: true, errorText: '', canReload: false });
    try {
      const config = await this.callConfig('featureFlagManager', {
        action: definition.updateAction, dailyLimit, expectedVersion: field.version
      });
      if (!this.isCurrentAccount()) return;
      this.applyConfig(key, config);
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      if (!this.isCurrentAccount()) return;
      if (error.code === 'NO_PERMISSION') this.setData({ hasAccess: false });
      else this.updateField(key, { errorText: error.message || '保存失败，请重试', canReload: error.code === 'CONFIG_CONFLICT' });
    } finally {
      if (this.isCurrentAccount()) this.updateField(key, { saving: false });
    }
  }
});
