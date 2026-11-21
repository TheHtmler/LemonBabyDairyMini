const { waitForAppInitialization } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');
const { applyReleaseNoticeUpdate, formatReleaseNoticeDate, formatReleaseNoticeTime } = require('../../utils/releaseNotice');

function noticeDate(entry) {
  const publishedAt = entry.publishedAt === undefined ? entry.updatedAt : entry.publishedAt;
  return entry.date || formatReleaseNoticeTime(publishedAt).slice(0, 10);
}

Page({
  data: {
    hasAccess: true,
    ready: false,
    canManage: false,
    loading: true,
    loadingMore: false,
    savingVisibility: false,
    savingNotice: false,
    deletingId: '',
    visible: true,
    draft: null,
    versionConflict: false,
    checkingVersion: false,
    latestEntry: null,
    noticeGroups: [],
    nextCursor: '',
    loadError: '',
    historyError: '',
    visibilityError: '',
    saveError: ''
  },

  async onLoad() {
    this.setData({ loading: true, loadError: '', ready: false, canManage: false });
    try {
      await waitForAppInitialization();
      const app = getApp();
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';

      if (!isDeveloperOpenid(openid)) {
        this.setData({ hasAccess: false });
        return;
      }

      const notice = await this.callManager({ action: 'getHomeReleaseNoticeConfig' });
      this.applyNotice(notice);
      this.setData({ ready: true });
    } catch (error) {
      this.setData({ loadError: error.message || '加载公告失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async callManager(data) {
    const readOnly = data.action === 'getHomeReleaseNoticeConfig';
    if (!readOnly && !this.data.canManage) throw new Error('更新公告云函数后可管理公告');

    const res = await wx.cloud.callFunction({ name: 'featureFlagManager', data });
    const result = res?.result;
    if (!result?.ok) {
      throw Object.assign(new Error(result?.message || '公告操作失败，请重试'), { code: result?.code });
    }
    const notice = result.notice;
    if (!notice || typeof notice !== 'object' || Array.isArray(notice)) {
      throw new Error('公告配置数据无效，请重新加载');
    }
    const hasHistory = Array.isArray(notice.entries);
    const canManage = notice.entrySchemaVersion === 2 && hasHistory;
    // 旧版配置可以读取，写入仍可能覆盖原公告。
    this.setData({ canManage });
    if (!readOnly && !canManage) throw new Error('更新公告云函数后可管理公告');
    if (hasHistory) return notice;

    const text = typeof notice.text === 'string' ? notice.text.trim() : '';
    return {
      ...notice,
      entries: text ? [{ id: 'legacy', text, publishedAt: notice.updatedAt }] : [],
      hasMore: false,
      nextCursor: ''
    };
  },

  applyNotice(notice, append = false) {
    const entries = append ? new Map((this._entries || []).map(item => [item.id, item])) : new Map();
    for (const entry of notice.entries) {
      if (!entries.has(entry.id)) entries.set(entry.id, entry);
    }
    this._entries = [...entries.values()];

    const groups = new Map();
    for (const entry of this._entries) {
      const date = noticeDate(entry);
      if (!groups.has(date)) {
        groups.set(date, { key: date || 'undated', label: formatReleaseNoticeDate(date) || '日期未记录', entries: [] });
      }
      groups.get(date).entries.push({ ...entry, displayTitle: entry.title || '公告与更新' });
    }
    this.setData({
      visible: notice.visible !== false,
      noticeGroups: [...groups.values()],
      nextCursor: notice.hasMore ? notice.nextCursor || '' : '',
      historyError: ''
    });
  },

  async refreshHistory() {
    if (this.data.loading || this.data.loadingMore || this.data.deletingId || this.data.savingVisibility) return;
    this.setData({ loadingMore: true, historyError: '' });
    try {
      const notice = await this.callManager({ action: 'getHomeReleaseNoticeConfig' });
      this.applyNotice(notice);
    } catch (error) {
      this.setData({ historyError: error.message || '刷新公告失败，请重试' });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  async onVisibleChange(e) {
    const { ready, canManage, draft, savingVisibility, loadingMore, deletingId, visible } = this.data;
    const nextVisible = !!e.detail.value;
    if (!ready || !canManage || draft || savingVisibility || loadingMore || deletingId || nextVisible === visible) return;
    this.setData({ visible: nextVisible, savingVisibility: true, visibilityError: '' });
    try {
      const notice = await this.callManager({ action: 'updateHomeReleaseNotice', visible: nextVisible });
      this.applyNotice(notice);
      applyReleaseNoticeUpdate(notice);
    } catch (error) {
      this.setData({ visible, visibilityError: error.message || '切换失败，请重试' });
    } finally {
      this.setData({ savingVisibility: false });
    }
  },

  openDraft(e) {
    const { ready, canManage, draft, savingVisibility, loadingMore, deletingId } = this.data;
    if (!ready || !canManage || draft || savingVisibility || loadingMore || deletingId) return;
    const { id } = e.currentTarget.dataset;
    const entry = id && this._entries?.find(item => item.id === id);
    if (id && !entry) return;
    this._publishAttempt = null;
    this.setData({
      draft: entry
        ? { id, title: entry.title || '', date: noticeDate(entry), text: entry.text, revision: entry.revision ?? 0 }
        : { id: '', title: '', date: formatReleaseNoticeTime(new Date()).slice(0, 10), text: '' },
      saveError: '',
      versionConflict: false,
      latestEntry: null
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  closeDraft() {
    if (this.data.savingNotice || this.data.checkingVersion) return;
    this.setData({ draft: null, saveError: '', versionConflict: false, latestEntry: null });
  },

  onDraftInput(e) {
    if (!this.data.draft || this.data.savingNotice) return;
    const { field } = e.currentTarget.dataset;
    if (!['date', 'title', 'text'].includes(field)) return;
    this.setData({
      [`draft.${field}`]: e.detail.value,
      ...(!this.data.versionConflict ? { saveError: '' } : {})
    });
  },

  async saveNotice() {
    const { ready, canManage, draft, savingNotice, versionConflict } = this.data;
    if (!ready || !canManage || !draft || savingNotice || versionConflict) return;
    const { id, date, revision } = draft;
    const title = draft.title.trim();
    const text = draft.text.trim();
    let issue = '';
    if (!date) issue = '请选择公告日期';
    else if (!title) issue = '请填写公告标题';
    else if (!text) issue = '请填写公告内容';
    else if (title.length > 40 || text.length > 2000) issue = '标题最多 40 字，正文最多 2000 字';
    if (issue) {
      this.setData({ saveError: issue });
      return;
    }

    const fields = { date, title, text };
    let request = { action: 'editHomeReleaseNotice', id, expectedRevision: revision, ...fields };
    if (!id) {
      const fingerprint = JSON.stringify(fields);
      const previous = this._publishAttempt;
      const requestId = previous?.fingerprint === fingerprint ? previous.requestId
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      this._publishAttempt = { fingerprint, requestId };
      request = { action: 'publishHomeReleaseNotice', requestId, ...fields };
    }

    this.setData({ savingNotice: true, saveError: '' });
    try {
      const notice = await this.callManager(request);
      this.applyNotice(notice);
      applyReleaseNoticeUpdate(notice);
      this._publishAttempt = null;
      this.setData({ draft: null, latestEntry: null });
      wx.showToast({ title: id ? '已保存修改' : '已发布', icon: 'success' });
    } catch (error) {
      const conflicted = !!id && error.code === 'CONFIG_CONFLICT';
      this.setData({
        versionConflict: conflicted,
        saveError: conflicted ? '这条公告已变更，草稿已保留。' : error.message || '保存失败，草稿已保留'
      });
    } finally {
      this.setData({ savingNotice: false });
    }
  },

  async checkLatestVersion() {
    const { draft, versionConflict, checkingVersion, latestEntry } = this.data;
    if (!draft?.id || !versionConflict || checkingVersion || latestEntry) return;
    this.setData({ checkingVersion: true });
    try {
      let cursor = '';
      do {
        const notice = await this.callManager({ action: 'getHomeReleaseNoticeConfig', ...(cursor ? { cursor } : {}) });
        const entry = notice.entries.find(item => item.id === draft.id);
        if (entry) {
          this.setData({
            latestEntry: { ...entry, displayDate: formatReleaseNoticeDate(noticeDate(entry)) || '日期未记录' },
            saveError: '请核对最新公告，再决定是否保存当前草稿。'
          });
          return;
        }
        cursor = notice.hasMore ? notice.nextCursor : '';
      } while (cursor);
      this.setData({ saveError: '这条公告已删除。当前草稿仍可复制。' });
    } catch (error) {
      this.setData({ saveError: error.message || '无法读取最新公告，请重试' });
    } finally {
      this.setData({ checkingVersion: false });
    }
  },

  useLatestRevision() {
    const { draft, latestEntry } = this.data;
    if (!draft || !latestEntry || latestEntry.id !== draft.id) return;
    this.setData({ 'draft.revision': latestEntry.revision ?? 0, versionConflict: false, latestEntry: null, saveError: '' });
  },

  async requestDelete(e) {
    const { ready, canManage, draft, savingVisibility, loadingMore, deletingId } = this.data;
    if (!ready || !canManage || draft || savingVisibility || loadingMore || deletingId) return;
    const { id } = e.currentTarget.dataset;
    const entry = this._entries?.find(item => item.id === id);
    if (!entry) return;
    this.setData({ deletingId: id, historyError: '' });
    try {
      const answer = await wx.showModal({
        title: '删除公告',
        content: `删除《${entry.title || '公告与更新'}》后，用户将在消息中心看不到这条公告。`,
        confirmText: '删除',
        cancelText: '取消',
        confirmColor: '#a6392b'
      });
      if (!answer.confirm) return;
      const notice = await this.callManager({ action: 'deleteHomeReleaseNotice', id, expectedRevision: entry.revision ?? 0 });
      this.applyNotice(notice);
      applyReleaseNoticeUpdate(notice);
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (error) {
      this.setData({ historyError: error.code === 'CONFIG_CONFLICT'
        ? '这条公告已变更，请刷新列表后再操作。'
        : error.message || '删除失败，请重试' });
    } finally {
      this.setData({ deletingId: '' });
    }
  },

  async loadMore() {
    const { ready, draft, savingVisibility, loadingMore, deletingId, nextCursor } = this.data;
    if (!ready || draft || !nextCursor || savingVisibility || loadingMore || deletingId) return;
    this.setData({ loadingMore: true, historyError: '' });
    try {
      const notice = await this.callManager({ action: 'getHomeReleaseNoticeConfig', cursor: nextCursor });
      this.applyNotice(notice, true);
    } catch (error) {
      this.setData({ historyError: error.message || '历史公告加载失败，请重试' });
    } finally {
      this.setData({ loadingMore: false });
    }
  }
});
