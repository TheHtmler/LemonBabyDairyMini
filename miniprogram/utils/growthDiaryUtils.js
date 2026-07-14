const { formatBabyAgeText } = require('./babyAgeDisplay');

const MAX_DIARY_PHOTOS = 3;
const MAX_AUTHOR_ROLE_LEN = 5;
const DIARY_ROLE_PRESETS = ['妈妈', '爸爸', '奶奶', '爷爷', '外婆', '外公'];

function normalizePhotos(photos = []) {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p) => ({
      originalFileId: String(p?.originalFileId || '').trim(),
      thumbFileId: String(p?.thumbFileId || '').trim(),
      width: p?.width == null ? null : Number(p.width),
      height: p?.height == null ? null : Number(p.height)
    }))
    .filter((p) => p.originalFileId && p.thumbFileId);
}

function normalizeAuthorDisplayName(value = '') {
  return String(value || '').trim().slice(0, MAX_AUTHOR_ROLE_LEN);
}

function validateAuthorDisplayName(value = '') {
  const name = normalizeAuthorDisplayName(value);
  if (!name) {
    return { isValid: false, errors: ['请选择或填写家庭角色'], normalized: '' };
  }
  if ([...String(value || '').trim()].length > MAX_AUTHOR_ROLE_LEN) {
    return { isValid: false, errors: [`角色最多 ${MAX_AUTHOR_ROLE_LEN} 个字`], normalized: name };
  }
  return { isValid: true, errors: [], normalized: name };
}

function hasAuthorDisplayName(value = '') {
  return Boolean(normalizeAuthorDisplayName(value));
}

function validateDiaryPayload(payload = {}) {
  const errors = [];
  const title = String(payload.title || '').trim();
  if (!title) errors.push('请输入里程碑标题');
  const eventDate = normalizeEventDateKey(payload.eventDate);
  if (!eventDate) errors.push('请选择发生日期');
  const photos = normalizePhotos(payload.photos);
  if ((payload.photos || []).length > MAX_DIARY_PHOTOS || photos.length > MAX_DIARY_PHOTOS) {
    errors.push(`最多上传 ${MAX_DIARY_PHOTOS} 张图片`);
  }
  const authorDisplayName = normalizeAuthorDisplayName(
    payload.authorDisplayName || payload.authorRole || ''
  );
  return {
    isValid: errors.length === 0,
    errors,
    normalized: {
      title,
      notes: String(payload.notes || '').trim(),
      eventDate,
      photos,
      authorDisplayName
    }
  };
}

function canEditDiaryEntry(entry = {}, actor = {}) {
  const openid = String(actor.openid || '').trim();
  if (!openid) return false;
  const author = String(entry.createdByOpenid || '').trim();
  if (author && author === openid) return true;
  if (entry.legacy && !author && actor.isCreator) return true;
  return false;
}

function mapMilestoneToDiary(milestone = {}) {
  const openid = String(milestone.userInfo?.openid || milestone._openid || '').trim();
  return {
    babyUid: milestone.babyUid,
    eventDate: normalizeEventDateKey(milestone.eventDate),
    title: String(milestone.title || '').trim(),
    notes: String(milestone.notes || '').trim(),
    photos: [],
    createdByOpenid: openid,
    authorDisplayName: '',
    userInfo: milestone.userInfo || {},
    migratedFromId: milestone._id || '',
    legacy: !openid,
    status: 'active',
    createdAt: milestone.createdAt || null,
    updatedAt: milestone.updatedAt || null
  };
}

function pad2(n) {
  return `${n}`.padStart(2, '0');
}

/** 统一解析云库 Date / 字符串 / {$date} / {seconds}，供排序与展示 */
function toDateValue(dateValue) {
  if (!dateValue && dateValue !== 0) return null;
  let raw = dateValue;
  if (raw && typeof raw === 'object') {
    if (typeof raw.toDate === 'function') {
      raw = raw.toDate();
    } else if (raw.$date) {
      raw = raw.$date;
    } else if (typeof raw.seconds === 'number') {
      raw = new Date(raw.seconds * 1000);
    } else if (typeof raw.getTime === 'function') {
      // Date-like，直接用
    } else {
      return null;
    }
  }
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const parts = raw.trim().split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * 发生日期统一为本地日历日 YYYY-MM-DD（不精确到时分）。
 * 写入、展示、同日分组都用这个 key。
 */
function normalizeEventDateKey(dateValue) {
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue.trim())) {
    return dateValue.trim().slice(0, 10);
  }
  const date = toDateValue(dateValue);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toComparableDateMs(dateValue) {
  const date = toDateValue(dateValue);
  return date ? date.getTime() : 0;
}

/**
 * 时光轴最优序：
 * 1) 按发生日期（天）倒序
 * 2) 同一天按发布时间 createdAt 倒序
 */
function sortDiaryEntriesByEventDateDesc(entries = []) {
  return [...entries].sort((left, right) => {
    const leftDay = normalizeEventDateKey(left.eventDate);
    const rightDay = normalizeEventDateKey(right.eventDate);
    if (leftDay !== rightDay) {
      // YYYY-MM-DD 字典序倒序 = 日期新→旧
      return rightDay > leftDay ? 1 : -1;
    }
    return toComparableDateMs(right.createdAt) - toComparableDateMs(left.createdAt);
  });
}

function formatPublishDateTime(dateValue) {
  const date = toDateValue(dateValue);
  if (!date) return '';
  return `${date.getFullYear()}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDiaryPublishMeta(entry = {}, options = {}) {
  const openid = String(entry.createdByOpenid || entry._openid || '').trim();
  const fromMap = openid && options.displayNameByOpenid
    ? options.displayNameByOpenid[openid]
    : '';
  const role = normalizeAuthorDisplayName(
    entry.authorDisplayName
    || entry.authorRole
    || entry.userInfo?.displayName
    || fromMap
    || options.fallbackDisplayName
    || ''
  ) || '家庭成员';
  const when = formatPublishDateTime(entry.createdAt || entry.updatedAt || entry.eventDate);
  if (!when) return `【${role}】发布`;
  return `【${role}】发布于${when}`;
}

/** 发生日对应的宝宝年龄文案；无生日或日期无效时返回空串 */
function formatDiaryEventAgeText(eventDate, birthday) {
  const day = normalizeEventDateKey(eventDate);
  if (!day || !birthday) return '';
  return formatBabyAgeText(birthday, day);
}

function formatDiaryForDisplay(entry = {}) {
  return {
    ...entry,
    canEdit: false,
    eventDateText: '',
    eventAgeText: '',
    thumbUrls: [],
    originalUrls: [],
    publishMetaText: formatDiaryPublishMeta(entry)
  };
}

module.exports = {
  MAX_DIARY_PHOTOS,
  MAX_AUTHOR_ROLE_LEN,
  DIARY_ROLE_PRESETS,
  normalizePhotos,
  normalizeAuthorDisplayName,
  validateAuthorDisplayName,
  hasAuthorDisplayName,
  validateDiaryPayload,
  canEditDiaryEntry,
  mapMilestoneToDiary,
  toDateValue,
  normalizeEventDateKey,
  toComparableDateMs,
  sortDiaryEntriesByEventDateDesc,
  formatPublishDateTime,
  formatDiaryPublishMeta,
  formatDiaryEventAgeText,
  formatDiaryForDisplay
};
