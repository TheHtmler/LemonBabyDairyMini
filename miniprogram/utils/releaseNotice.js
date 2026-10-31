// 公告内容由云端统一配置，阅读状态按账号与正文隔离。
const DEFAULT_RELEASE_NOTICE_TEXT = '看板已升级：聚焦今日营养达成、喂养进度与用药打卡，明细请到「数据记录」查看。';

let notice = { loaded: false, visible: false, text: '' };
let pending = null;

function noticeReadKey(text, accountKey) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  // 沿用首页原有键名，保留已读记录。
  return 'home_notice_read:' + accountKey + ':' + (hash >>> 0).toString(16);
}

function getReleaseNoticeState(accountKey) {
  let read = false;
  if (accountKey && notice.visible && notice.text) {
    try {
      read = !!wx.getStorageSync(noticeReadKey(notice.text, accountKey));
    } catch (error) {
      // 本地存储暂不可用时保留提醒，不阻断首页和其他消息。
      console.warn('暂时无法读取公告阅读状态:', error);
    }
  }
  return {
    ...notice,
    unread: !!(accountKey && notice.visible && notice.text && !read)
  };
}

function loadReleaseNotice() {
  // 首页初始化与 onShow 可能同时取数，只发送一次请求。
  if (pending) return pending;
  const request = Promise.resolve().then(() => wx.cloud.callFunction({
    name: 'featureFlagManager',
    data: { action: 'getHomeReleaseNotice' }
  })).then(response => {
    const result = response && response.result;
    if (!result || !result.ok || !result.notice) throw new Error('公告暂时无法加载');
    notice = {
      loaded: true,
      visible: result.notice.visible !== false,
      text: typeof result.notice.text === 'string' && result.notice.text.trim()
        ? result.notice.text.trim() : DEFAULT_RELEASE_NOTICE_TEXT
    };
    return notice;
  }).finally(() => {
    if (pending === request) pending = null;
  });
  pending = request;
  return request;
}

function markReleaseNoticeRead(text, accountKey) {
  if (text && accountKey) wx.setStorageSync(noticeReadKey(text, accountKey), true);
}

module.exports = { getReleaseNoticeState, loadReleaseNotice, markReleaseNoticeRead };
