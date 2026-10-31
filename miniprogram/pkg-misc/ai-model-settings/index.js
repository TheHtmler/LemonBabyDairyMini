const { waitForAppInitialization } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');
const { buildSettingsPresentation, timeText } = require('../../utils/aiModelSettingsPresentation');

function accountKey() { return getApp().globalData.openid || wx.getStorageSync('openid') || ''; }
const REASONS = {
  FREE_QUOTA_EXHAUSTED: '上个模型免费额度已用完或到期', MODEL_TIMEOUT: '上个模型响应超时',
  MODEL_RATE_LIMIT: '上个模型触发限流', MODEL_UNAVAILABLE: '上个模型暂时不可用',
  CONFIG_OR_ELIGIBILITY_CHANGED: '配置顺序或模型可用资格发生变化'
};

Page({
  data: {
    hasAccess: false, loading: true, busy: false, ready: false, dirty: false,
    scene: 'search', enabled: false, rows: [], errorText: '',
    queryConfigured: false, renewalConfigured: false, actual: '', actualTime: '', switchReason: '',
    operation: '', detailsExpanded: false, summary: {}, quotaFeedback: {}, saveBlocked: false, saveHint: '', summaryLabel: ''
  },

  async onLoad() {
    this._unloaded = false;
    this._requestEpoch = 0;
    try {
      await waitForAppInitialization();
      if (this._unloaded) return;
      this._account = accountKey();
      const hasAccess = isDeveloperOpenid(this._account);
      this.setData({ hasAccess, loading: false });
      if (hasAccess) await this.loadConfig();
    } catch (_) {
      if (!this._unloaded) this.setData({ loading: false, errorText: '账号信息加载失败，请返回重试' });
    }
  },

  onShow() {
    if (this._account && this._account !== accountKey()) {
      this.setData({ hasAccess: false, ready: false, busy: false, loading: false }); return;
    }
    this.stopPolling();
    this._poll = setInterval(() => {
      if (this.isCurrentAccount() && this.data.ready && !this.data.busy && !this.data.loading) this.loadConfig(true);
    }, 60000);
  },
  onHide() { this.stopPolling(); },
  onUnload() { this._unloaded = true; this.stopPolling(); },
  stopPolling() { if (this._poll) clearInterval(this._poll); this._poll = null; },
  isCurrentAccount() { return !this._unloaded && this.data.hasAccess && this._account === accountKey(); },

  async callApi(action, data = {}) {
    let response;
    try { response = await wx.cloud.callFunction({ name: 'featureFlagManager', data: { action, ...data } }); }
    catch (error) {
      const detail = String(error.errMsg || error.message || '');
      const message = /timeout|timed out|超时/i.test(detail) ? '云函数调用超时，请确认 featureFlagManager 的超时配置至少为 35 秒' :
        /function.*not.*found|FUNCTION_NOT_FOUND|函数.*不存在/i.test(detail) ? '未找到 featureFlagManager，请先部署云函数' :
          '云函数调用失败，请检查网络和 featureFlagManager 的运行日志';
      throw Object.assign(new Error(message), { code: 'CLOUD_INVOKE_FAILED' });
    }
    const result = response && response.result;
    if (!result || !result.ok) {
      const code = result && result.code || 'REQUEST_FAILED';
      const message = code === 'UNKNOWN_ACTION' ? '云函数版本较旧，请更新 featureFlagManager 后重试' :
        code === 'MISSING_OPENID' ? '登录信息已失效，请重新进入小程序' : result && result.message || '操作失败，请重试';
      throw Object.assign(new Error(message), { code });
    }
    return result;
  },

  applyView(view, keepDraft = false) {
    if (!view || !view.config || !view.quota || !view.pools || !view.config.pools ||
        !Number.isSafeInteger(view.config.version) || !['search', 'scan'].every(scene =>
          Array.isArray(view.config.pools[scene]) && Array.isArray(view.pools[scene]))) {
      throw new Error('模型配置返回格式无效，请更新云函数后重试');
    }
    if (this._view && view.config.version < this._view.config.version) {
      throw new Error('收到较旧的配置版本，已保留当前设置，请重新加载');
    }
    this._view = view;
    this._clockOffset = (view.serverNow || Date.now()) - Date.now();
    if (!keepDraft || !this._draft) {
      this._draft = JSON.parse(JSON.stringify({ enabled: view.config.enabled, pools: view.config.pools }));
      this._version = view.config.version;
      this.setData({ dirty: false, errorText: '' });
    } else if (view.config.version !== this._version) {
      this.setData({ errorText: '云端配置已有更新；当前修改仍保留，保存前请重新加载并调整' });
    }
    this.setData({ ready: true, queryConfigured: view.queryConfigured, renewalConfigured: view.renewalConfigured });
    this.renderView();
  },

  renderView() {
    if (!this._view || !this._draft) return;
    const scene = this.data.scene;
    const now = Date.now() + this._clockOffset;
    const presentation = buildSettingsPresentation(this._view, this._draft, scene, now, this.data.dirty);
    const runtime = (this._view.runtime || {})[scene];
    this.setData({ ...presentation, enabled: this._draft.enabled,
      actual: runtime && runtime.model || '暂无运行记录', actualTime: runtime ? timeText(runtime.lastUsedAt) : '',
      switchReason: runtime && REASONS[runtime.switchReason] || '',
      configured: this._view.config.configured });
  },

  async loadConfig(quiet = false, discard = false) {
    if (!this.isCurrentAccount() || this.data.busy || this._loading) return;
    this._loading = true;
    const epoch = ++this._requestEpoch;
    if (!quiet) this.setData({ loading: true, errorText: '' });
    try {
      const result = await this.callApi('getAiModelConfig');
      if (this.isCurrentAccount() && epoch === this._requestEpoch) this.applyView(result.view, !discard && this.data.dirty);
    } catch (error) {
      if (this.isCurrentAccount() && epoch === this._requestEpoch) {
        if (error.code === 'NO_PERMISSION') this.setData({ hasAccess: false, ready: false });
        else this.setData({ errorText: error.message || '配置加载失败，请重试' });
      }
    } finally {
      this._loading = false;
      if (this.isCurrentAccount() && epoch === this._requestEpoch) this.setData({ loading: false });
    }
  },
  onReload() { return this.loadConfig(false, true); },
  onSceneTap(event) {
    const scene = event.currentTarget.dataset.scene;
    if (!['search', 'scan'].includes(scene) || this.data.busy) return;
    this.setData({ scene }); this.renderView();
  },
  canEdit() { return this.isCurrentAccount() && this.data.ready && !this.data.busy && !this.data.loading; },
  onToggleDetails() { this.setData({ detailsExpanded: !this.data.detailsExpanded }); },
  onEnabledChange(event) {
    if (!this.canEdit()) return;
    this._draft.enabled = event.detail.value;
    this.setData({ dirty: true }); this.renderView();
  },
  async onModelToggle(event) {
    if (!this.canEdit()) return;
    const { model } = event.currentTarget.dataset;
    const scene = this.data.scene;
    let entry = this._draft.pools[scene].find(row => row.model === model);
    if (!entry) return;
    if (!entry.enabled && !entry.verified) {
      // 合并启用与核验操作；只有管理员明确确认才记录新模型已核验。
      ++this._requestEpoch;
      this.setData({ busy: true, operation: 'verify', errorText: '' });
      let confirmed = false;
      try {
        confirmed = await new Promise((resolve, reject) => wx.showModal({ title: '确认模型效果',
          content: '启用前，请确认该模型的准确性、输出格式和响应时间满足当前业务要求。本操作不会执行模型测试。',
          // 微信原生弹窗的按钮文案最多四个字符。
          confirmText: '确认启用', cancelText: '暂不启用',
          success: result => resolve(result.confirm), fail: reject }));
      } catch (_) {
        if (this.isCurrentAccount()) {
          this.setData({ errorText: '启用确认框打开失败，请重试' });
          wx.showToast({ title: '确认框打开失败，请重试', icon: 'none' });
        }
        return;
      } finally {
        if (this.isCurrentAccount()) this.setData({ busy: false, operation: '' });
      }
      if (!this.isCurrentAccount() || !confirmed) return;
      entry = this._draft.pools[scene].find(row => row.model === model);
      if (!entry) return;
      entry.verified = true;
    }
    entry.enabled = !entry.enabled;
    this.setData({ dirty: true }); this.renderView();
  },
  onMove(event) {
    if (!this.canEdit()) return;
    const rows = this._draft.pools[this.data.scene];
    const index = rows.findIndex(row => row.model === event.currentTarget.dataset.model);
    const offset = Number(event.currentTarget.dataset.offset);
    if (![-1, 1].includes(offset) || index < 0 || index + offset < 0 || index + offset >= rows.length) return;
    [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]];
    this.setData({ dirty: true }); this.renderView();
  },

  async onRefreshQuota() {
    if (!this.canEdit()) return;
    // 主动操作使旧轮询失效，避免保存完成后被迟到的响应覆盖。
    const epoch = ++this._requestEpoch;
    this.setData({ busy: true, operation: 'refresh', errorText: '' });
    try {
      const result = await this.callApi('refreshAiModelQuota');
      if (!this.isCurrentAccount() || epoch !== this._requestEpoch) return;
      this.applyView(result.view, this.data.dirty);
      const sync = result.sync || {};
      const accepted = ['success', 'cached', 'syncing', 'superseded'].includes(sync.status);
      if (!accepted) this.setData({ errorText: sync.message || result.view.quota.syncError || '额度刷新失败，请检查云端查询配置' });
      wx.showToast({ title: sync.refreshed ? '额度已同步' : accepted ? sync.status === 'syncing' ? '额度同步中' : '已读取最近状态' : '额度刷新失败', icon: 'none' });
    } catch (error) {
      if (this.isCurrentAccount() && epoch === this._requestEpoch) {
        if (error.code === 'NO_PERMISSION') this.setData({ hasAccess: false, ready: false });
        else this.setData({ errorText: error.message || '额度同步失败' });
      }
    } finally { if (this.isCurrentAccount() && epoch === this._requestEpoch) this.setData({ busy: false, operation: '' }); }
  },

  async onSave() {
    if (!this.canEdit() || !this.data.dirty || this.data.saveBlocked) return;
    const epoch = ++this._requestEpoch;
    this.setData({ busy: true, operation: 'save', errorText: '' });
    try {
      const result = await this.callApi('updateAiModelConfig', { config: this._draft, expectedVersion: this._version });
      if (!this.isCurrentAccount() || epoch !== this._requestEpoch) return;
      this.applyView(result.view);
      wx.showToast({ title: '配置已保存', icon: 'success' });
    } catch (error) {
      if (this.isCurrentAccount() && epoch === this._requestEpoch) {
        if (error.code === 'NO_PERMISSION') this.setData({ hasAccess: false, ready: false });
        else this.setData({ errorText: error.message || '保存失败，请重试' });
      }
    } finally { if (this.isCurrentAccount() && epoch === this._requestEpoch) this.setData({ busy: false, operation: '' }); }
  }
});
