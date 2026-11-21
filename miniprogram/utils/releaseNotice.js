// 公告由云端发布，阅读状态按账号和公告隔离。
const DEFAULT_RELEASE_NOTICE_TEXT = '看板已升级：聚焦今日营养达成、喂养进度与用药打卡，明细请到「数据记录」查看。';

let notice = { loaded: false, visible: false, text: '', entries: [], nextCursor: '', hasMore: false };
let pending = null;
let pendingMore = null;

function noticeReadKey(entry, accountKey) {
  if (!entry.legacy) return 'home_notice_entry_read:' + accountKey + ':' + entry.id;
  const { text } = entry;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  // 沿用首页原有键名，保留已读记录。
  return 'home_notice_read:' + accountKey + ':' + (hash >>> 0).toString(16);
}

function getReleaseNoticeState(accountKey) {
  const entries = notice.entries.map(entry => {
    if (!accountKey) return { ...entry, unread: false };
    try {
      return { ...entry, unread: !wx.getStorageSync(noticeReadKey(entry, accountKey)) };
    } catch (error) {
      // 本地存储暂不可用时保留提醒，不阻断首页和其他消息。
      return { ...entry, unread: true };
    }
  });
  const unreadCount = entries.filter(entry => entry.unread).length;
  return { ...notice, entries, unreadCount, unread: unreadCount > 0 };
}

function formatReleaseNoticeTime(value) {
  if (!value) return '';
  const time = new Date(value?.$date ?? value).getTime();
  return Number.isFinite(time)
    ? new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
    : '';
}

function releaseNoticeDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatReleaseNoticeTime(value).slice(0, 10);
}

function formatReleaseNoticeDate(value) {
  const date = releaseNoticeDate(value);
  if (!date) return '';
  const [year, month, day] = date.split('-');
  return `${Number(month)} 月 ${Number(day)} 日 · ${year}`;
}

function groupReleaseNotices(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const date = entry.date || '';
    if (!groups.has(date)) {
      groups.set(date, { date, dateText: formatReleaseNoticeDate(date) || '日期未记录', entries: [] });
    }
    groups.get(date).entries.push(entry);
  }
  return [...groups.values()];
}

function normalizeEntry(entry = {}) {
  const text = typeof entry.text === 'string' ? entry.text.trim() : '';
  if (!entry.id || !text) return null;
  const publishedAt = entry.publishedAt === undefined ? entry.updatedAt : entry.publishedAt;
  const date = releaseNoticeDate(entry.date || publishedAt);
  return {
    id: String(entry.id),
    title: String(entry.title || '').trim() || '公告与更新',
    text,
    date,
    dateText: formatReleaseNoticeDate(date),
    publishedAt: publishedAt || '',
    publishedAtText: formatReleaseNoticeTime(publishedAt),
    legacy: entry.legacy === true
  };
}

function normalizeNoticePage(page) {
  const visible = page.visible !== false;
  const hasHistory = Array.isArray(page.entries);
  const latestText = typeof page.text === 'string' ? page.text.trim() : '';
  const text = visible ? latestText || (hasHistory ? '' : DEFAULT_RELEASE_NOTICE_TEXT) : '';
  const rawEntries = hasHistory
    ? page.entries
    : [{ id: 'legacy-notice', text, publishedAt: page.updatedAt, legacy: true }];
  const entries = visible ? rawEntries.filter(Boolean).map(normalizeEntry).filter(Boolean) : [];
  const nextCursor = visible && page.hasMore && typeof page.nextCursor === 'string' ? page.nextCursor : '';
  return { loaded: true, visible, text, entries, nextCursor, hasMore: !!nextCursor };
}

function applyReleaseNoticeUpdate(page) {
  const updated = normalizeNoticePage(page);
  // 后台和消息中心共用同一份公开公告，作废变更前已发出的读取。
  pending = null;
  pendingMore = null;
  notice = updated.entries.length
    ? updated : { ...updated, visible: false, text: '', nextCursor: '', hasMore: false };
}

async function fetchNoticePage(cursor) {
  const response = await wx.cloud.callFunction({
    name: 'featureFlagManager',
    data: { action: 'getHomeReleaseNotice', ...(cursor ? { cursor } : {}) }
  });
  const result = response?.result;
  if (!result?.ok || !result.notice) throw new Error('公告暂时无法加载');
  return normalizeNoticePage(result.notice);
}

function loadReleaseNotice() {
  // 首页初始化与 onShow 可能同时取数，只发送一次请求。
  if (pending) return pending;
  pendingMore = null;
  const request = fetchNoticePage().then(page => {
    if (pending === request) notice = page;
    return notice;
  }, error => {
    if (pending === request) throw error;
    return notice;
  }).finally(() => {
    if (pending === request) pending = null;
  });
  pending = request;
  return request;
}

function loadMoreReleaseNotices() {
  if (pending) return pending.then(loadMoreReleaseNotices);
  if (!notice.nextCursor) return Promise.resolve(notice);
  if (pendingMore) return pendingMore;
  const previous = notice;
  const request = fetchNoticePage(previous.nextCursor).then(page => {
    if (pendingMore !== request || notice !== previous) return notice;
    const known = new Set(previous.entries.map(entry => entry.id));
    notice = page.visible ? {
      ...previous,
      entries: [...previous.entries, ...page.entries.filter(entry => !known.has(entry.id))],
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    } : page;
    return notice;
  }, error => {
    if (pendingMore === request) throw error;
    return notice;
  }).finally(() => {
    if (pendingMore === request) pendingMore = null;
  });
  pendingMore = request;
  return request;
}

function markReleaseNoticeRead(entry, accountKey) {
  if (entry?.id && accountKey) wx.setStorageSync(noticeReadKey(entry, accountKey), true);
}

module.exports = {
  getReleaseNoticeState, loadReleaseNotice, loadMoreReleaseNotices, markReleaseNoticeRead, applyReleaseNoticeUpdate,
  formatReleaseNoticeTime, formatReleaseNoticeDate, groupReleaseNotices
};
