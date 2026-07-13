const DAY_MARK_COLORS = require('../constants/dayMarkColors');

const ALLOWED_COLOR_VALUES = new Set(DAY_MARK_COLORS.map((item) => item.value.toUpperCase()));

function normalizeDateKey(dateInput = '') {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const matched = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
  }
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isAllowedMarkColor(color = '') {
  return ALLOWED_COLOR_VALUES.has(String(color || '').trim().toUpperCase());
}

function getColorName(color = '') {
  const normalized = String(color || '').trim().toUpperCase();
  const matched = DAY_MARK_COLORS.find((item) => item.value.toUpperCase() === normalized);
  return matched ? matched.name : '';
}

function buildCalendarMarksMap(records = []) {
  const map = {};
  (records || []).forEach((record) => {
    const date = normalizeDateKey(record.date);
    const color = String(record.color || '').trim();
    const label = String(record.label || '').trim();
    if (!date || !color || !label) return;
    if (!map[date]) map[date] = [];
    map[date].push({ color, label });
  });
  return map;
}

function buildCalendarDotsMap(records = []) {
  const marksMap = buildCalendarMarksMap(records);
  const map = {};
  Object.keys(marksMap).forEach((date) => {
    map[date] = marksMap[date].slice(0, 3).map((item) => item.color);
  });
  return map;
}

function attachMarksToCalendarDays(calendarDays = [], marksMap = {}) {
  return (calendarDays || []).map((day) => {
    const markItems = (marksMap[day.date] || []).slice(0, 3);
    return {
      ...day,
      markItems,
      markDots: markItems.map((item) => item.color)
    };
  });
}

function attachMarksToDateList(dateList = [], marksMap = {}) {
  return (dateList || []).map((item) => {
    const markItems = marksMap[item.date] || [];
    return {
      ...item,
      markDots: markItems.slice(0, 3).map((entry) => entry.color)
    };
  });
}

function attachDotsToCalendarDays(calendarDays = [], dotsMap = {}) {
  return (calendarDays || []).map((day) => ({
    ...day,
    markDots: dotsMap[day.date] || [],
    markItems: (dotsMap[day.date] || []).map((color) => ({ color, label: '' }))
  }));
}

function formatDayMarkForDisplay(record = {}) {
  const time = String(record.time || '').trim();
  return {
    id: record._id || '',
    label: String(record.label || '').trim(),
    color: String(record.color || '').trim(),
    note: String(record.note || '').trim(),
    time,
    timeText: time || '全天',
    presetKey: String(record.presetKey || '').trim(),
    colorName: getColorName(record.color)
  };
}

function buildDayMarkSummaryPills(records = []) {
  return (records || []).map((record) => formatDayMarkForDisplay(record));
}

function validateDayMarkPayload(payload = {}) {
  const label = String(payload.label || '').trim();
  const color = String(payload.color || '').trim();
  const errors = [];
  if (!label) errors.push('请填写记录事件');
  if (!color) errors.push('请选择标记颜色');
  else if (!isAllowedMarkColor(color)) errors.push('标记颜色无效');
  return {
    isValid: errors.length === 0,
    errors,
    normalized: {
      label,
      color,
      presetKey: String(payload.presetKey || '').trim(),
      note: String(payload.note || '').trim(),
      time: String(payload.time || '').trim()
    }
  };
}

function getCalendarVisibleDateRange(calendarDays = []) {
  const dates = (calendarDays || [])
    .map((day) => day.date)
    .filter(Boolean)
    .sort();
  if (!dates.length) return { startDate: '', endDate: '' };
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1]
  };
}

module.exports = {
  normalizeDateKey,
  isAllowedMarkColor,
  getColorName,
  buildCalendarMarksMap,
  buildCalendarDotsMap,
  attachMarksToCalendarDays,
  attachMarksToDateList,
  attachDotsToCalendarDays,
  formatDayMarkForDisplay,
  buildDayMarkSummaryPills,
  validateDayMarkPayload,
  getCalendarVisibleDateRange,
  DAY_MARK_COLORS
};
