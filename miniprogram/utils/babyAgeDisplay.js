function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(date, monthOffset) {
  const targetMonthIndex = date.getMonth() + monthOffset;
  const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const day = Math.min(date.getDate(), lastDayOfMonth(targetYear, normalizedMonth));
  return new Date(targetYear, normalizedMonth, day);
}

function diffDays(fromDate, toDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay);
}

function calculateBabyAgeParts(birthday, referenceDate = new Date()) {
  const birthDate = parseLocalDate(birthday);
  const refDate = parseLocalDate(referenceDate);
  if (!birthDate || !refDate || refDate < birthDate) return null;

  let totalMonths = (refDate.getFullYear() - birthDate.getFullYear()) * 12
    + (refDate.getMonth() - birthDate.getMonth());
  if (refDate.getDate() < birthDate.getDate()) {
    totalMonths -= 1;
  }
  totalMonths = Math.max(0, totalMonths);

  const anchor = addMonthsClamped(birthDate, totalMonths);
  const totalDays = diffDays(birthDate, refDate);
  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days: Math.max(0, diffDays(anchor, refDate)),
    totalMonths,
    totalDays: Math.max(0, totalDays)
  };
}

function formatBabyAgeText(birthday, referenceDate = new Date()) {
  const age = calculateBabyAgeParts(birthday, referenceDate);
  if (!age) return '';
  const { years, months, days, totalDays } = age;

  if (totalDays === 0) return '出生当天';

  if (years >= 1) {
    if (months > 0 && days > 0) return `${years}岁${months}个月零${days}天`;
    if (months > 0) return `${years}岁${months}个月`;
    if (days > 0) return `${years}岁零${days}天`;
    return `${years}岁`;
  }

  const weekText = totalDays < 84 && totalDays >= 7
    ? `（约${Math.floor(totalDays / 7)}周）`
    : '';
  if (months > 0 && days > 0) return `${months}个月零${days}天${weekText}`;
  if (months > 0) return `${months}个月${weekText}`;
  return `${days}天${weekText}`;
}

module.exports = {
  parseLocalDate,
  calculateBabyAgeParts,
  formatBabyAgeText
};
