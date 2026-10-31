// 反馈的身份、未读数量和导航红点统一维护，避免各页面各算一份。
const CACHE_MS = 30000;
const { isElderMode } = require('./elderMode');
const listeners = new Set();
let identity = '';
let generation = 0;
let revision = 0;
let count = 0;
let adminPendingCount = 0;
let known = false;
let refreshedAt = 0;
let pending = null;
let readReceipts = new Map();

function currentIdentity() {
  const app = getApp();
  const global = app && app.globalData;
  if (!global || wx.getStorageSync('account_logged_out') === true) return '';
  // 角色重新选择会清除退出标记，但旧代码未必同步恢复 isLoggedIn。
  if (global.isLoggedIn === false && !global.userRole) return '';
  return global.openid || '';
}

function snapshot() {
  return { identity, generation, revision, count, adminPendingCount, known };
}

function syncTabBar() {
  if (isElderMode()) return;
  const method = count > 0 || adminPendingCount > 0 ? wx.showTabBarRedDot : wx.hideTabBarRedDot;
  if (typeof method !== 'function') return;
  // 在分包页或导航尚未显示时允许失败，下次导航页 onShow 会重新同步。
  method.call(wx, { index: 3, fail() {} });
}

function publish() {
  syncTabBar();
  const value = snapshot();
  listeners.forEach(listener => {
    try { listener(value); } catch (error) { console.warn('反馈提醒更新失败:', error); }
  });
}

function resetFeedbackState() {
  identity = '';
  generation += 1;
  revision += 1;
  count = 0;
  adminPendingCount = 0;
  known = false;
  refreshedAt = 0;
  pending = null;
  readReceipts = new Map();
  publish();
}

function syncIdentity() {
  const current = currentIdentity();
  if (current !== identity) {
    resetFeedbackState();
    identity = current;
    publish();
  }
  return identity;
}

async function readyIdentity() {
  const app = getApp();
  if (!currentIdentity() && app?.initReady) await app.initReady;
  const value = syncIdentity();
  if (!value) {
    const error = new Error('请先登录后查看反馈');
    error.code = 'UNAUTHENTICATED';
    throw error;
  }
  return value;
}

async function callFeedback(action, data = {}) {
  const owner = await readyIdentity();
  const session = generation;
  const response = await wx.cloud.callFunction({ name: 'feedbackManager', data: { ...data, action } });
  if (syncIdentity() !== owner || session !== generation) {
    const error = new Error('用户身份已变化，请重新进入页面');
    error.code = 'STALE_SESSION';
    throw error;
  }
  const result = response?.result;
  if (!result?.ok) {
    const error = new Error(result?.message || '反馈服务暂时不可用，请稍后重试');
    error.code = result?.code || 'SERVICE_ERROR';
    throw error;
  }
  return result;
}

function getUnreadState() {
  syncIdentity();
  return snapshot();
}

function subscribeUnread(listener) {
  syncIdentity();
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

function invalidateUnread() {
  syncIdentity();
  revision += 1;
  refreshedAt = 0;
  pending = null;
  publish();
}

async function refreshUnread({ force = false } = {}) {
  const owner = await readyIdentity();
  syncTabBar();
  if (!force && known && Date.now() - refreshedAt < CACHE_MS) return snapshot();
  if (pending) return pending;
  const requestRevision = revision;
  const session = generation;
  const request = callFeedback('getUnreadCount').then(result => {
    // 已读写入或切换身份后，写入之前发出的统计不能覆盖新状态。
    if (syncIdentity() === owner && session === generation && revision === requestRevision) {
      count = Math.max(0, Number(result.count) || 0);
      adminPendingCount = Math.max(0, Number(result.adminPendingCount) || 0);
      known = true;
      refreshedAt = Date.now();
      publish();
    }
    return snapshot();
  }).finally(() => {
    if (pending === request) pending = null;
  });
  pending = request;
  return request;
}

function refreshUnreadSilently(options) {
  return refreshUnread(options).catch(error => {
    if (!['UNAUTHENTICATED', 'STALE_SESSION'].includes(error.code)) {
      console.warn('暂时无法刷新反馈提醒:', error.message);
    }
    return snapshot();
  });
}

async function acknowledgeReply(id, seenReplyVersion) {
  const result = await callFeedback('markReplyRead', { id, seenReplyVersion });
  const receipt = result.data;
  // 先阻断旧统计，再发布条目已读结果；总数由云端重新确认，避免和并发统计重复扣减。
  revision += 1;
  refreshedAt = 0;
  pending = null;
  readReceipts.set(id, Math.max(readReceipts.get(id) || 0, receipt.readReplyVersion));
  publish();
  refreshUnreadSilently({ force: true });
  return receipt;
}

function resolveDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value?.$date || value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatTime(value) {
  const date = resolveDate(value);
  if (!date) return '';
  const pad = value => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeFeedback(item = {}) {
  const replyVersion = Number(item.replyVersion) || 0;
  const readReplyVersion = Math.max(Number(item.readReplyVersion) || 0, readReceipts.get(item._id) || 0);
  return {
    ...item,
    replyContent: typeof item.replyContent === 'string' ? item.replyContent : '',
    replyVersion,
    readReplyVersion,
    hasUnreadReply: replyVersion > readReplyVersion,
    statusText: item.status === 'processed' ? '已处理' : '未处理',
    displayTime: formatTime(item.createdAt || item.clientCreatedAt),
    replyTimeText: formatTime(item.repliedAt),
    replyTimeLabel: '回复于',
    lastMessageTime: formatTime(item.lastMessageAt),
    followUpCount: Math.max(0, Number(item.followUpCount) || 0),
    conversationVersion: Math.max(0, Number(item.conversationVersion) || 0)
  };
}

function normalizeFeedbackEntry(entry, item, adminView) {
  const role = entry.role === 'admin' ? 'admin' : 'user';
  return {
    ...entry, role,
    displayTime: formatTime(entry.createdAt),
    fromMe: adminView ? role === 'admin' : role === 'user',
    authorLabel: role === 'admin' ? '管理员回复' : adminView ? '用户补充' : '我的补充',
    isLatestReply: role === 'admin' && entry.replyVersion === item.replyVersion
  };
}

function createReplyRequestId() {
  return `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

module.exports = {
  callFeedback, readyIdentity, getUnreadState, refreshUnread, refreshUnreadSilently,
  subscribeUnread, resetFeedbackState, invalidateUnread, acknowledgeReply,
  normalizeFeedback, normalizeFeedbackEntry, createReplyRequestId
};
