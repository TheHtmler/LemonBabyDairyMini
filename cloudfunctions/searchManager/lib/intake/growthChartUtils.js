const CARRY_FORWARD_GROWTH_SOURCES = new Set([
  'daily_record_v2_carry_forward',
  'carry_forward_backfill'
]);

const BODY_LENGTH_SNAPSHOT_SOURCES = new Set([]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function hasMeasurementValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function parseMeasurementValue(value) {
  if (!hasMeasurementValue(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'string') {
    const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matched) {
      return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateKey(value) {
  const date = parseDateInput(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addCalendarMonths(date, months) {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(date.getDate(), daysInMonth(targetYear, targetMonth));
  return new Date(targetYear, targetMonth, day);
}

function diffDays(start, end) {
  const startNoon = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
  const endNoon = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12);
  return Math.round((endNoon.getTime() - startNoon.getTime()) / MS_PER_DAY);
}

function roundMonthPosition(value) {
  return Math.round(value * 10000) / 10000;
}

function calculateAgeMonthsPosition(birthdayValue, recordDateValue) {
  const birthday = parseDateInput(birthdayValue);
  const recordDate = parseDateInput(recordDateValue);
  if (!birthday || !recordDate || recordDate < birthday) {
    return { monthAge: null, xMonth: null };
  }

  let monthAge = (recordDate.getFullYear() - birthday.getFullYear()) * 12;
  monthAge += recordDate.getMonth() - birthday.getMonth();

  let anniversary = addCalendarMonths(birthday, monthAge);
  if (anniversary > recordDate) {
    monthAge -= 1;
    anniversary = addCalendarMonths(birthday, monthAge);
  }

  const nextAnniversary = addCalendarMonths(birthday, monthAge + 1);
  const spanDays = Math.max(1, diffDays(anniversary, nextAnniversary));
  const elapsedDays = Math.max(0, diffDays(anniversary, recordDate));
  const xMonth = roundMonthPosition(monthAge + elapsedDays / spanDays);

  return {
    monthAge: Math.max(0, monthAge),
    xMonth: Math.max(0, xMonth)
  };
}

function buildPosition(recordDate, babyInfo = {}, fallbackMonthAge = null) {
  if (babyInfo.birthday && recordDate) {
    const position = calculateAgeMonthsPosition(babyInfo.birthday, recordDate);
    if (position.monthAge !== null && position.xMonth !== null) {
      return position;
    }
  }

  const parsedMonthAge = Number(fallbackMonthAge);
  if (Number.isFinite(parsedMonthAge) && parsedMonthAge >= 0) {
    return {
      monthAge: Math.floor(parsedMonthAge),
      xMonth: parsedMonthAge
    };
  }

  return { monthAge: null, xMonth: null };
}

function normalizeLegacyGrowthRecord(record = {}, babyInfo = {}) {
  const recordDate = formatDateKey(record.recordDate || record.date);
  const position = buildPosition(recordDate, babyInfo, record.monthAge);
  const normalized = {
    ...record,
    recordDate: record.recordDate || record.date || '',
    recordDateText: recordDate,
    monthAge: position.monthAge,
    xMonth: position.xMonth,
    weight: parseMeasurementValue(record.weight),
    length: parseMeasurementValue(record.length ?? record.height),
    head: parseMeasurementValue(record.head ?? record.headCircumference),
    source: record.source || 'growth_records'
  };

  return hasMeasurementValue(normalized.weight)
    || hasMeasurementValue(normalized.length)
    || hasMeasurementValue(normalized.head)
    ? normalized
    : null;
}

function normalizeV2GrowthRecord(record = {}, babyInfo = {}) {
  if ((record.status || 'active') !== 'active') return null;
  if (CARRY_FORWARD_GROWTH_SOURCES.has(record.source)) return null;

  const recordDate = formatDateKey(record.date || record.recordDate);
  const position = buildPosition(recordDate, babyInfo, record.monthAge);
  const shouldUseLength = !BODY_LENGTH_SNAPSHOT_SOURCES.has(record.source);
  const normalized = {
    ...record,
    recordDate: record.date || record.recordDate || '',
    recordDateText: recordDate,
    monthAge: position.monthAge,
    xMonth: position.xMonth,
    weight: parseMeasurementValue(record.weight),
    length: shouldUseLength ? parseMeasurementValue(record.height ?? record.length) : null,
    head: shouldUseLength ? parseMeasurementValue(record.headCircumference ?? record.head) : null,
    source: record.source || 'data_records_v2',
    _fromV2: true
  };

  return hasMeasurementValue(normalized.weight)
    || hasMeasurementValue(normalized.length)
    || hasMeasurementValue(normalized.head)
    ? normalized
    : null;
}

function normalizeGrowthRecordsForChart({
  babyInfo = {},
  legacyRecords = [],
  v2Records = []
} = {}) {
  const normalizedV2Records = (Array.isArray(v2Records) ? v2Records : [])
    .map(record => normalizeV2GrowthRecord(record, babyInfo))
    .filter(Boolean);
  const v2RecordDates = new Set(
    normalizedV2Records
      .map(record => record.recordDateText)
      .filter(Boolean)
  );
  const normalizedLegacyRecords = (Array.isArray(legacyRecords) ? legacyRecords : [])
    .map(record => normalizeLegacyGrowthRecord(record, babyInfo))
    .filter(Boolean)
    .filter(record => !record.recordDateText || !v2RecordDates.has(record.recordDateText));

  return [
    ...normalizedLegacyRecords,
    ...normalizedV2Records
  ]
    .filter(record => record.monthAge !== null && record.xMonth !== null)
    .sort((left, right) => {
      if (left.xMonth !== right.xMonth) return left.xMonth - right.xMonth;
      return String(left.recordDateText || '').localeCompare(String(right.recordDateText || ''));
    });
}

function buildActualMeasurementSeries(records = [], maxMonth = 36) {
  const lengthData = new Array(maxMonth + 1).fill(null);
  const weightData = new Array(maxMonth + 1).fill(null);
  const lengthPoints = [];
  const weightPoints = [];
  let lastLength = null;
  let lastWeight = null;

  (Array.isArray(records) ? records : []).forEach((record) => {
    const x = Number(record.xMonth ?? record.monthAge);
    if (!Number.isFinite(x) || x < 0 || x > maxMonth) return;
    const bucket = Math.max(0, Math.min(maxMonth, Math.floor(x)));

    if (record.length !== null && record.length !== undefined) {
      const value = Number(record.length);
      if (Number.isFinite(value) && value !== lastLength) {
        lengthPoints.push({ x, value });
        lengthData[bucket] = value;
        lastLength = value;
      }
    }

    if (record.weight !== null && record.weight !== undefined) {
      const value = Number(record.weight);
      if (Number.isFinite(value) && value !== lastWeight) {
        weightPoints.push({ x, value });
        weightData[bucket] = value;
        lastWeight = value;
      }
    }
  });

  return {
    lengthData,
    weightData,
    lengthPoints,
    weightPoints
  };
}

module.exports = {
  BODY_LENGTH_SNAPSHOT_SOURCES,
  CARRY_FORWARD_GROWTH_SOURCES,
  buildActualMeasurementSeries,
  calculateAgeMonthsPosition,
  formatDateKey,
  normalizeGrowthRecordsForChart
};
