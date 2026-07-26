// miniprogram/utils/sleepRecordUtils.js
function buildDateTime(dateKey, timeString = '00:00') {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  const [hours, minutes] = String(timeString || '00:00').split(':').map(Number);
  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(month) ? month - 1 : 0,
    Number.isFinite(day) ? day : 1,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
}

function resolveEndDateTime(dateKey, startTime, endTime) {
  const endStr = String(endTime || '').trim();
  if (!endStr) return null;
  const startDateTime = buildDateTime(dateKey, startTime);
  const sameDayEnd = buildDateTime(dateKey, endStr);
  // 同分钟：无效（避免滚到次日变成约 24h，挡住「立刻醒来」）
  if (sameDayEnd.getTime() === startDateTime.getTime()) return null;
  if (sameDayEnd > startDateTime) return sameDayEnd;
  // 结束钟点早于开始 → 跨午夜滚次日
  const next = new Date(startDateTime.getFullYear(), startDateTime.getMonth(), startDateTime.getDate() + 1);
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  const endDateTime = buildDateTime(nextKey, endStr);
  if (!(endDateTime > startDateTime)) return null;
  return endDateTime;
}

function computeDurationMinutes(startDateTime, endDateTime) {
  if (!(startDateTime instanceof Date) || !(endDateTime instanceof Date)) return null;
  const ms = endDateTime.getTime() - startDateTime.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

function isOngoingSleep(record = {}) {
  const endTime = record.endTime;
  const endDateTime = record.endDateTime;
  const hasEndTime = endTime != null && String(endTime).trim() !== '';
  const hasEndDateTime = endDateTime != null && endDateTime !== '';
  return !hasEndTime && !hasEndDateTime;
}

function formatDurationLabel(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h <= 0) return `${rem}分`;
  if (rem === 0) return `${h}小时`;
  return `${h}小时${rem}分`;
}

module.exports = {
  buildDateTime,
  resolveEndDateTime,
  computeDurationMinutes,
  isOngoingSleep,
  formatDurationLabel
};
