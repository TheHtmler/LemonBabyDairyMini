const {
  SUBSCRIBE_MESSAGE_TEMPLATE_IDS
} = require('../config/subscribeMessage');

const FEEDING_REMINDER_STORAGE_KEY = 'feeding_reminder_subscription';
const REMINDER_STATUSES = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  EXPIRED: 'expired',
  STALE: 'stale',
  CANCELLED: 'cancelled'
};

const REMINDER_STATUS_META = {
  pending: { key: 'pending', label: '已订阅', tone: 'pending' },
  sent: { key: 'sent', label: '已发送', tone: 'sent' },
  failed: { key: 'failed', label: '发送失败', tone: 'failed' },
  expired: { key: 'expired', label: '已过期', tone: 'expired' },
  stale: { key: 'stale', label: '已失效', tone: 'stale' },
  cancelled: { key: 'cancelled', label: '已失效', tone: 'stale' }
};

function getFeedingReminderTemplateId(templateIds = SUBSCRIBE_MESSAGE_TEMPLATE_IDS) {
  return String((templateIds && templateIds.feedingReminder) || '').trim();
}

function isFeedingReminderTemplateConfigured(templateId = getFeedingReminderTemplateId()) {
  const value = String(templateId || '').trim();
  if (!value) return false;
  return !/YOUR_|TEMPLATE_ID|待配置|示例/.test(value);
}

function resolveSubscribeStatus(result = {}, templateId = getFeedingReminderTemplateId()) {
  return result && result[templateId] ? result[templateId] : '';
}

function normalizeReminderStatus(reminder = {}, now = new Date()) {
  const rawStatus = reminder.status || REMINDER_STATUSES.PENDING;
  const dueAt = reminder.dueAt ? new Date(reminder.dueAt) : null;
  if (
    rawStatus === REMINDER_STATUSES.PENDING
    && dueAt
    && !Number.isNaN(dueAt.getTime())
    && dueAt.getTime() < now.getTime()
  ) {
    return REMINDER_STATUS_META.expired;
  }
  return REMINDER_STATUS_META[rawStatus] || REMINDER_STATUS_META.pending;
}

const UNSUBSCRIBED_STATUS = { key: 'unsubscribed', label: '未提醒', tone: 'unsubscribed' };

function toTimeMs(value) {
  if (!value && value !== 0) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

// 结合“一条未来候选记录”和它匹配到的提醒文档，判断当前应展示的提醒状态。
// 关键点：已发送(sent)的提醒只代表“当时那个时间点”。如果记录时间又被改到更晚的未来，
// 这就是一个全新的、从未提醒过的时间点，必须视为“未提醒”允许重新订阅，
// 而不是继续显示“已发送”误导用户以为还会被提醒。
function resolveCandidateReminderStatus(reminder, candidate = {}, now = new Date()) {
  if (!reminder) {
    return { ...UNSUBSCRIBED_STATUS, active: false };
  }
  const status = normalizeReminderStatus(reminder, now);
  const reminderDueMs = toTimeMs(reminder.dueAt);
  const candidateDueMs = candidate.dueAtMs || toTimeMs(candidate.dueAt);
  const sentButMovedToFuture = status.key === 'sent'
    && candidateDueMs > 0
    && candidateDueMs > reminderDueMs;
  const active = ['pending', 'failed', 'sent'].includes(status.key) && !sentButMovedToFuture;
  if (!active) {
    return { ...UNSUBSCRIBED_STATUS, active: false };
  }
  return { ...status, active: true };
}

function buildFeedingReminderSubscription({
  babyUid = '',
  openid = '',
  templateId = getFeedingReminderTemplateId(),
  candidate = {},
  subscribedAt = Date.now(),
  dueAt
} = {}) {
  const resolvedDueAt = dueAt || candidate.dueAt || null;
  const note = candidate.note || candidate.hintText || '';
  const record = {
    type: 'feedingReminder',
    babyUid,
    openid,
    templateId: String(templateId || '').trim(),
    status: 'accepted',
    used: false,
    subscribedAt,
    sourceType: candidate.sourceType || candidate.type || '',
    sourceRecordId: candidate.sourceRecordId || '',
    sourceKey: candidate.sourceKey || '',
    title: candidate.title || '宝宝提醒',
    content: candidate.content || '该记录啦',
    note,
    hintText: note || candidate.content || '未来记录提醒'
  };
  if (resolvedDueAt) record.dueAt = resolvedDueAt;
  return record;
}

module.exports = {
  FEEDING_REMINDER_STORAGE_KEY,
  REMINDER_STATUSES,
  buildFeedingReminderSubscription,
  getFeedingReminderTemplateId,
  isFeedingReminderTemplateConfigured,
  normalizeReminderStatus,
  resolveCandidateReminderStatus,
  resolveSubscribeStatus
};
