const { getBabyUid } = require('../../utils/index');
const {
  normalizeReminderStatus,
  resolveCandidateReminderStatus
} = require('../../utils/feedingReminderSubscription');
const {
  buildUpcomingReminderCandidates,
  formatDateTime
} = require('../../utils/upcomingReminderCandidates');
const {
  requestCandidateReminderSubscription
} = require('../../utils/reminderSubscriptionPrompt');

const app = getApp();

// 微信一次性订阅消息：1 次授权 = 1 次发送配额。这里只做「逐条选时间提醒」，
// 不做「始终提醒」（无法真正永久全自动，且会浪费配额）。
const REMINDER_CATEGORY_CONFIG = [
  {
    type: 'milk',
    title: '喂奶提醒',
    label: '喂奶',
    hint: '提前保存未来的喂奶记录，再逐条选择要提醒的时间点；每条授权一次、到点提醒一次。'
  },
  {
    type: 'food',
    title: '食物提醒',
    label: '食物',
    hint: '提前保存未来的辅食餐次，再逐条选择要提醒的时间点；同一餐次合并成一条提醒。'
  },
  {
    type: 'medication',
    title: '用药提醒',
    label: '用药',
    hint: '提前保存未来的用药记录（带时间），再逐条选择要提醒的时间点；用药建议优先授权。'
  }
];
const TYPE_LABELS = {
  milk: '奶',
  food: '食物',
  medication: '药物'
};
// 状态筛选：纯本地过滤，不增加任何云调用。
const STATUS_FILTERS = [
  { key: 'all', label: '全部', countKey: 'totalCount' },
  { key: 'unsubscribed', label: '未提醒', countKey: 'unsubscribedCount' },
  { key: 'subscribed', label: '已订阅', countKey: 'subscribedCount' },
  { key: 'failed', label: '失败', countKey: 'failedCount' }
];
// 同一页 onLoad + onShow 会连续触发；短时间内复用缓存，避免重复云查询。
const RELOAD_TTL_MS = 30 * 1000;
const FOREGROUND_TRIGGER_BUFFER_MS = 1000;
const MAX_FOREGROUND_TRIGGER_DELAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object' && typeof value.getTime === 'function') {
    const date = new Date(value.getTime());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function flattenCandidates(candidates = {}) {
  return [
    ...(candidates.milkList || []),
    ...(candidates.foodList || []),
    ...(candidates.medicationList || [])
  ].sort((a, b) => a.dueAtMs - b.dueAtMs);
}

function pickReminderForCandidate(reminders = [], sourceKey = '') {
  const matched = (reminders || []).filter((reminder) => reminder.sourceKey === sourceKey);
  if (!matched.length) return null;
  const priority = { pending: 1, failed: 2, sent: 3, stale: 4, cancelled: 5 };
  return matched.sort((a, b) => {
    const pa = priority[a.status] || 99;
    const pb = priority[b.status] || 99;
    if (pa !== pb) return pa - pb;
    return (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0);
  })[0];
}

function buildReminderCenterItem(candidate = {}, reminders = [], now = new Date()) {
  const reminder = pickReminderForCandidate(reminders, candidate.sourceKey);
  const statusMeta = resolveCandidateReminderStatus(reminder, candidate, now);
  const isActiveReminder = statusMeta.active;

  return {
    id: candidate.sourceKey,
    sourceKey: candidate.sourceKey,
    typeLabel: TYPE_LABELS[candidate.sourceType] || '提醒',
    title: candidate.title || '宝宝提醒',
    content: candidate.content || '该记录啦',
    note: candidate.note || '',
    timeText: candidate.timeText || formatDateTime(candidate.dueAt),
    statusKey: statusMeta.key,
    statusLabel: statusMeta.label,
    statusTone: statusMeta.tone,
    reminderId: reminder?._id || '',
    lastError: reminder?.lastError || '',
    canSubscribe: !isActiveReminder,
    canCancel: statusMeta.key === 'pending',
    canRetry: statusMeta.key === 'failed'
  };
}

function buildReminderCategorySections(candidates = {}, reminders = [], now = new Date(), activeReminderType = 'milk') {
  const grouped = {
    milk: candidates.milkList || [],
    food: candidates.foodList || [],
    medication: candidates.medicationList || []
  };

  return REMINDER_CATEGORY_CONFIG.map((config) => {
    const items = (grouped[config.type] || [])
      .map((candidate) => buildReminderCenterItem(candidate, reminders, now));
    const subscribedCount = items.filter((item) => ['pending', 'sent'].includes(item.statusKey)).length;
    const failedCount = items.filter((item) => item.statusKey === 'failed').length;
    const unsubscribedCount = items.filter((item) => item.canSubscribe).length;
    return {
      ...config,
      active: config.type === activeReminderType,
      items,
      hasItems: items.length > 0,
      totalCount: items.length,
      subscribedCount,
      failedCount,
      unsubscribedCount,
      summaryText: `未来${items.length}条 · 已提醒${subscribedCount}条 · 待授权${unsubscribedCount}条`
    };
  });
}

function matchStatusFilter(item = {}, filterKey = 'all') {
  if (filterKey === 'all') return true;
  if (filterKey === 'unsubscribed') return item.statusKey === 'unsubscribed';
  if (filterKey === 'subscribed') return item.statusKey === 'pending' || item.statusKey === 'sent';
  if (filterKey === 'failed') return item.statusKey === 'failed';
  return true;
}

function buildActiveReminderSection(sections = [], activeReminderType = 'milk', statusFilter = 'all') {
  const section = sections.find((s) => s.type === activeReminderType) || sections[0] || null;
  if (!section) return null;
  const statusFilters = STATUS_FILTERS.map((filter) => ({
    key: filter.key,
    label: filter.label,
    count: section[filter.countKey] || 0,
    active: filter.key === statusFilter
  }));
  const visibleItems = (section.items || []).filter((item) => matchStatusFilter(item, statusFilter));
  return {
    ...section,
    statusFilter,
    statusFilters,
    visibleItems,
    hasVisibleItems: visibleItems.length > 0
  };
}

Page({
  data: {
    loading: true,
    activeReminderType: 'milk',
    statusFilter: 'all',
    reminderSections: [],
    activeReminderSection: null,
    hasReminderItems: false,
    subscribingKey: '',
    cancellingKey: ''
  },

  onLoad() {
    this._hasLoadedOnce = false;
    this.loadReminders();
  },

  onShow() {
    // onLoad 已发起首次加载；首次 onShow 不重复查询（命中 TTL 缓存即可）。
    // 之后每次返回本页（如从「快捷添加」编辑器返回）都强制刷新，确保看到新记录。
    if (!this._hasLoadedOnce) {
      this._hasLoadedOnce = true;
      this.loadReminders();
      return;
    }
    this.loadReminders({ force: true });
  },

  onHide() {
    this.clearForegroundReminderCheck();
  },

  onUnload() {
    this.clearForegroundReminderCheck();
  },

  async loadFutureRecordCandidates(babyUid) {
    if (!babyUid || !wx.cloud) return buildUpcomingReminderCandidates();
    const db = wx.cloud.database();
    const _ = db.command;
    const now = new Date();
    const today = todayKey();
    const [milkRes, foodRes, medicationRes] = await Promise.all([
      db.collection('feeding_records_v2')
        .where({ babyUid, startDateTime: _.gte(now) })
        .orderBy('startDateTime', 'asc')
        .limit(50)
        .get(),
      db.collection('food_intake_records')
        .where({ babyUid, status: 'active', date: _.gte(today) })
        .orderBy('date', 'asc')
        .limit(100)
        .get(),
      db.collection('medication_records')
        .where({ babyUid, actualDateTime: _.gte(now) })
        .orderBy('actualDateTime', 'asc')
        .limit(50)
        .get()
    ]);

    return buildUpcomingReminderCandidates({
      milkRecords: milkRes.data || [],
      foodIntakeRecords: foodRes.data || [],
      medicationRecords: medicationRes.data || [],
      now
    });
  },

  getCurrentOpenid() {
    return (app.globalData && app.globalData.openid) || wx.getStorageSync('openid') || '';
  },

  async loadReminderRecords(babyUid, sourceKeys = [], openid = '') {
    // 订阅消息按 openid 发送，这里只查当前用户自己的提醒；
    // 多成员共享同一宝宝时，彼此看不到对方的订阅状态，避免“已订阅”歧义。
    if (!babyUid || !openid || !wx.cloud || !sourceKeys.length) return [];
    const db = wx.cloud.database();
    const _ = db.command;
    const where = {
      type: 'feedingReminder',
      babyUid,
      openid
    };
    if (sourceKeys.length <= 20) {
      where.sourceKey = _.in(sourceKeys);
    }
    const res = await db.collection('feeding_reminders')
      .where(where)
      .orderBy('dueAt', 'asc')
      .limit(100)
      .get();
    return res.data || [];
  },

  rebuildSectionsFromCache() {
    const sections = buildReminderCategorySections(
      this._lastCandidates || {},
      this._lastReminderRecords || [],
      new Date(),
      this.data.activeReminderType
    );
    this.setData({
      loading: false,
      reminderSections: sections,
      activeReminderSection: buildActiveReminderSection(sections, this.data.activeReminderType, this.data.statusFilter),
      hasReminderItems: flattenCandidates(this._lastCandidates || {}).length > 0
    });
  },

  async loadReminders(options = {}) {
    const force = !!options.force;
    if (this._loading) return;

    const cacheFresh = this._lastLoadedAt && (Date.now() - this._lastLoadedAt) < RELOAD_TTL_MS;
    if (!force && cacheFresh && this._lastCandidates) {
      this.rebuildSectionsFromCache();
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid || !wx.cloud) {
      const reminderSections = buildReminderCategorySections(
        {},
        [],
        new Date(),
        this.data.activeReminderType
      );
      this.setData({
        loading: false,
        reminderSections,
        activeReminderSection: buildActiveReminderSection(reminderSections, this.data.activeReminderType, this.data.statusFilter),
        hasReminderItems: false
      });
      this.clearForegroundReminderCheck();
      return;
    }

    this._loading = true;
    this.setData({ loading: true });
    try {
      const now = new Date();
      const candidates = await this.loadFutureRecordCandidates(babyUid);
      const flatCandidates = flattenCandidates(candidates);
      const sourceKeys = flatCandidates.map((candidate) => candidate.sourceKey).filter(Boolean);
      const reminderRecords = await this.loadReminderRecords(babyUid, sourceKeys, this.getCurrentOpenid());
      this._candidateBySourceKey = {};
      flatCandidates.forEach((candidate) => {
        this._candidateBySourceKey[candidate.sourceKey] = candidate;
      });
      this._lastCandidates = candidates;
      this._lastReminderRecords = reminderRecords;
      this._lastLoadedAt = Date.now();
      const reminderSections = buildReminderCategorySections(
        candidates,
        reminderRecords,
        now,
        this.data.activeReminderType
      );
      this.setData({
        loading: false,
        reminderSections,
        activeReminderSection: buildActiveReminderSection(reminderSections, this.data.activeReminderType, this.data.statusFilter),
        hasReminderItems: flatCandidates.length > 0
      });
      this.scheduleForegroundReminderCheck();
    } catch (error) {
      console.error('加载未来提醒失败:', error);
      this.setData({ loading: false });
      wx.showToast({ title: '加载提醒失败', icon: 'none' });
    } finally {
      this._loading = false;
    }
  },

  switchReminderTab(e = {}) {
    const type = e.currentTarget?.dataset?.type || '';
    if (!type || type === this.data.activeReminderType) return;
    // 切分类时重置筛选，避免停留在某个空筛选上造成困惑。
    this.setData({ activeReminderType: type, statusFilter: 'all' }, () => {
      this.rebuildSectionsFromCache();
    });
  },

  setStatusFilter(e = {}) {
    const filter = e.currentTarget?.dataset?.filter || 'all';
    if (filter === this.data.statusFilter) return;
    this.setData({ statusFilter: filter }, () => {
      this.rebuildSectionsFromCache();
    });
  },

  async subscribeReminder(e = {}) {
    if (this.data.subscribingKey || this.data.cancellingKey) return;
    const sourceKey = e.currentTarget?.dataset?.sourceKey || '';
    const candidate = this._candidateBySourceKey?.[sourceKey];
    const babyUid = getBabyUid();
    if (!candidate || !babyUid) return;

    // 注意：setData 是同步调用，不会引入 await，requestSubscribeMessage 仍在本次
    // 点击手势的同一调用栈内触发，不会破坏“user TAP gesture”要求。
    this.setData({ subscribingKey: sourceKey });
    try {
      const saved = await requestCandidateReminderSubscription({
        candidate,
        babyUid,
        openid: this.getCurrentOpenid(),
        successText: '提醒已订阅'
      });
      // 订阅只影响这一条：直接用返回的记录本地更新并重建，不整页重查云端。
      if (saved) this.applyLocalReminder(saved);
    } finally {
      this.setData({ subscribingKey: '' });
    }
  },

  // 把刚订阅成功的提醒记录并入本地缓存（按 sourceKey+openid 去重），再本地重建分区。
  applyLocalReminder(record = {}) {
    if (!record.sourceKey) return;
    const openid = record.openid || '';
    const list = (this._lastReminderRecords || []).filter(
      (item) => !(item.sourceKey === record.sourceKey && (item.openid || '') === openid)
    );
    list.push(record);
    this._lastReminderRecords = list;
    this.rebuildSectionsFromCache();
    this.scheduleForegroundReminderCheck();
  },

  clearForegroundReminderCheck() {
    if (this._foregroundReminderTimer) {
      clearTimeout(this._foregroundReminderTimer);
      this._foregroundReminderTimer = null;
    }
  },

  scheduleForegroundReminderCheck() {
    this.clearForegroundReminderCheck();
    if (!wx.cloud) return;
    const now = Date.now();
    const next = (this._lastReminderRecords || [])
      .filter((item) => item.status === 'pending' && item.used !== true)
      .map((item) => ({ ...item, dueAtMs: toDate(item.dueAt)?.getTime() || 0 }))
      .filter((item) => item.dueAtMs > 0)
      .sort((a, b) => a.dueAtMs - b.dueAtMs)[0];
    if (!next) return;
    const delay = Math.max(0, next.dueAtMs - now + FOREGROUND_TRIGGER_BUFFER_MS);
    if (delay > MAX_FOREGROUND_TRIGGER_DELAY_MS) return;
    this._foregroundReminderTimer = setTimeout(() => {
      this.runForegroundReminderCheck();
    }, delay);
  },

  async runForegroundReminderCheck() {
    if (!wx.cloud || this._foregroundReminderRunning) return;
    this._foregroundReminderRunning = true;
    try {
      await wx.cloud.callFunction({
        name: 'sendFeedingReminders',
        data: { limit: 20, source: 'future-reminders-foreground' }
      });
      await this.loadReminders({ force: true });
    } catch (error) {
      console.warn('前台触发提醒检查失败，将等待定时器兜底:', error);
    } finally {
      this._foregroundReminderRunning = false;
    }
  },

  async cancelReminder(e = {}) {
    if (this.data.subscribingKey || this.data.cancellingKey) return;
    const sourceKey = e.currentTarget?.dataset?.sourceKey || '';
    const babyUid = getBabyUid();
    const openid = this.getCurrentOpenid();
    if (!sourceKey || !babyUid || !openid || !wx.cloud) return;

    this.setData({ cancellingKey: sourceKey });
    const now = new Date();
    try {
      await wx.cloud.database().collection('feeding_reminders')
        .where({
          type: 'feedingReminder',
          babyUid,
          openid,
          sourceKey,
          status: 'pending'
        })
        .update({
          data: {
            status: 'cancelled',
            used: false,
            invalidReason: 'userCancelled',
            cancelledAt: now,
            updatedAt: now
          }
        });
      const current = (this._lastReminderRecords || []).find(
        (item) => item.sourceKey === sourceKey && (item.openid || '') === openid
      );
      this.applyLocalReminder({
        ...(current || {}),
        sourceKey,
        openid,
        status: 'cancelled',
        used: false,
        invalidReason: 'userCancelled',
        cancelledAt: now,
        updatedAt: now
      });
      wx.showToast({ title: '已取消提醒', icon: 'success' });
    } catch (error) {
      console.error('取消未来提醒失败:', error);
      wx.showToast({ title: '取消失败', icon: 'none' });
    } finally {
      this.setData({ cancellingKey: '' });
    }
  },

  // 快捷添加未来记录：奶/食物有独立编辑页，直接跳；用药记录弹窗在首页 tab 内，
  // 改为打标记 + 切回首页，由首页 onShow 消费标记自动弹出用药记录弹窗。
  goAddRecord(e = {}) {
    const type = e.currentTarget?.dataset?.type || '';
    const date = todayKey();
    if (type === 'milk') {
      wx.navigateTo({ url: `/pkg-milk/milk-feeding-editor-v2/index?mode=create&source=daily&date=${date}` });
    } else if (type === 'food') {
      wx.navigateTo({ url: `/pkg-records/meal-editor/index?date=${date}&from=daily` });
    } else if (type === 'medication') {
      if (app && app.globalData) app.globalData.pendingOpenMedicationModal = true;
      wx.switchTab({ url: '/pages/daily-feeding/index' });
    }
  },

  async retryReminder(e = {}) {
    const reminderId = e.currentTarget?.dataset?.id || '';
    if (!reminderId || !wx.cloud) return;

    try {
      wx.showLoading({ title: '重试中...' });
      await wx.cloud.database().collection('feeding_reminders').doc(reminderId).update({
        data: {
          status: 'pending',
          used: false,
          lastError: '',
          updatedAt: new Date()
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '已重新加入提醒队列', icon: 'success' });
      await this.loadReminders({ force: true });
    } catch (error) {
      wx.hideLoading();
      console.error('重试未来提醒失败:', error);
      wx.showToast({ title: '重试失败', icon: 'none' });
    }
  }
});
