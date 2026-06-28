const {
  BODY_LENGTH_SNAPSHOT_SOURCES,
  CARRY_FORWARD_GROWTH_SOURCES,
  calculateAgeMonthsPosition,
  formatDateKey
} = require('./growthChartUtils');

function hasValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

function parseValue(value) {
  if (!hasValue(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPoint({
  record,
  metric,
  value
}) {
  return {
    babyUid: record.babyUid,
    date: formatDateKey(record.date || record.recordDate),
    metric,
    value,
    sourceRecordId: record._id || record.id || '',
    source: record.source || 'data_records_v2',
    status: 'active',
    schemaVersion: 1
  };
}

function buildGrowthCurvePointsForRecord(record = {}) {
  if (!record.babyUid) return [];
  if ((record.status || 'active') !== 'active') return [];
  if (CARRY_FORWARD_GROWTH_SOURCES.has(record.source)) return [];

  const date = formatDateKey(record.date || record.recordDate);
  if (!date) return [];

  const points = [];
  const weight = parseValue(record.weight);
  if (weight !== null) {
    points.push(buildPoint({ record: { ...record, date }, metric: 'weight', value: weight }));
  }

  if (!BODY_LENGTH_SNAPSHOT_SOURCES.has(record.source)) {
    const height = parseValue(record.height ?? record.length);
    if (height !== null) {
      points.push(buildPoint({ record: { ...record, date }, metric: 'height', value: height }));
    }
  }

  return points;
}

function normalizeGrowthCurvePoint(point = {}, babyInfo = {}) {
  if ((point.status || 'active') !== 'active') return null;
  const date = formatDateKey(point.date);
  if (!date) return null;

  const value = parseValue(point.value);
  if (value === null) return null;

  const position = babyInfo.birthday
    ? calculateAgeMonthsPosition(babyInfo.birthday, date)
    : { monthAge: null, xMonth: null };

  if (position.monthAge === null || position.xMonth === null) return null;

  if (point.metric === 'weight') {
    return {
      ...point,
      recordDate: point.date,
      recordDateText: date,
      monthAge: position.monthAge,
      xMonth: position.xMonth,
      weight: value,
      length: null,
      head: null,
      source: point.source || 'growth_curve_points',
      _fromCurvePoint: true
    };
  }

  if (point.metric === 'height' || point.metric === 'length') {
    return {
      ...point,
      recordDate: point.date,
      recordDateText: date,
      monthAge: position.monthAge,
      xMonth: position.xMonth,
      weight: null,
      length: value,
      head: null,
      source: point.source || 'growth_curve_points',
      _fromCurvePoint: true
    };
  }

  return null;
}

function normalizeGrowthCurvePointsForChart({
  babyInfo = {},
  points = []
} = {}) {
  const metricOrder = { weight: 0, height: 1, length: 1 };
  return (Array.isArray(points) ? points : [])
    .map(point => normalizeGrowthCurvePoint(point, babyInfo))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.xMonth !== right.xMonth) return left.xMonth - right.xMonth;
      const leftOrder = metricOrder[left.metric] ?? 99;
      const rightOrder = metricOrder[right.metric] ?? 99;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.recordDateText || '').localeCompare(String(right.recordDateText || ''));
    });
}

module.exports = {
  buildGrowthCurvePointsForRecord,
  normalizeGrowthCurvePointsForChart
};
