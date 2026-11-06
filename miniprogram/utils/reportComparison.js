const ReportModel = require('../models/report');
const { buildIndicatorDisplay, readReportNumber } = require('./reportDisplay');
const {
  buildReportComparePickerOptions, buildReportNutritionWindow, resolveWeekBeforeReport,
  KEY_METRICS_BY_REPORT_TYPE
} = require('./reportWorkbench');

const reportIdOf = report => report._id || report.id || report.reportId;

// 默认取最近两份；展示按时间正序，保留同日多份报告及用户指定的对照。
function resolveMultiReportSelection(reports, reportType, reportIds = [], baselineId = '') {
  const options = buildReportComparePickerOptions(reports, reportType);
  const validIds = new Set(options.map(option => option.reportId));
  let selectedIds = [...new Set(reportIds)].filter(id => validIds.has(id));
  if (!selectedIds.length) selectedIds = options.slice(0, 2).map(option => option.reportId);
  const selected = options.filter(option => selectedIds.includes(option.reportId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.reportId.localeCompare(b.reportId));
  return {
    options, selected, reportIds: selected.map(option => option.reportId),
    baselineId: selectedIds.includes(baselineId) ? baselineId : selected[0]?.reportId || ''
  };
}

function referenceKey(indicator = {}) {
  return [indicator.minRange, indicator.maxRange].map(value => {
    const number = readReportNumber(value);
    return number === null ? String(value ?? '').trim() : String(number);
  }).join('|');
}

function buildMultiNutritionSeries(columns, reportsById, summaries, nutritionSettings) {
  const windows = columns.map(column => ({
    ...buildReportNutritionWindow(reportsById.get(column.reportId), [], nutritionSettings, 0, summaries),
    column
  }));
  return (windows[0]?.coefficientSeries || []).map(config => {
    const groups = windows.map(window => ({
      window, points: window.coefficientSeries.find(series => series.key === config.key)?.points || []
    }));
    const ceiling = groups.reduce((max, group) => group.points.reduce(
      (value, point) => Number.isFinite(point.raw) ? Math.max(value, point.raw) : value, max), 0) || 1;
    return {
      key: config.key, label: config.label, unit: config.unit,
      sides: groups.map(({ window, points }) => {
        const valid = points.filter(point => Number.isFinite(point.raw));
        const average = valid.length ? valid.reduce((sum, point) => sum + point.raw, 0) / valid.length : null;
        return {
          reportId: window.column.reportId, label: window.column.date,
          isBaseline: window.column.isBaseline, labName: window.column.labName,
          sameDayLabel: window.column.sameDayLabel, fullDateRange: window.fullDateRange,
          coverageText: valid.length + '/7 天',
          averageText: average === null ? '—' : String(Number(average.toFixed(config.key === 'calorieCoefficient' ? 1 : 2))),
          points: points.map(point => ({
            ...point, heightRpx: Number.isFinite(point.raw) ? Math.max(2, Math.round(point.raw / ceiling * 68)) : 0
          }))
        };
      })
    };
  });
}

function buildMultiReportComparison({
  reports = [], reportType = '', reportIds = [], baselineId = '', selectedMetricKeys = [],
  includeNutrition = false, dailySummaries = [], nutritionSettings = {}
} = {}) {
  const selection = resolveMultiReportSelection(reports, reportType, reportIds, baselineId);
  const reportsById = new Map(reports.filter(report => report.reportType === reportType).map(report => [reportIdOf(report), report]));
  const columns = selection.selected.map(column => ({ ...column, isBaseline: column.reportId === selection.baselineId }));
  const baseline = reportsById.get(selection.baselineId);
  const primaryKeys = KEY_METRICS_BY_REPORT_TYPE[reportType] || [];
  const allRows = ReportModel.getIndicators(reportType).map(config => {
    const base = buildIndicatorDisplay(config, baseline?.indicators?.[config.key] || {});
    const rawIndicators = columns.map(column => reportsById.get(column.reportId)?.indicators?.[config.key] || {});
    const cells = columns.map((column, index) => {
      const display = buildIndicatorDisplay(config, rawIndicators[index]);
      const comparable = base.numericValue !== null && display.numericValue !== null;
      const difference = comparable ? Number((display.numericValue - base.numericValue).toPrecision(12)) : null;
      return {
        reportId: column.reportId, isBaseline: column.isBaseline, hasValue: display.hasValue,
        valueText: display.valueText, status: display.status, marker: display.marker,
        rangeText: display.rangeText, abnormal: display.abnormal,
        deltaText: !comparable ? '缺数值' : !Number.isFinite(difference) ? '无法计算'
          : (difference > 0 ? '+' : '') + String(difference)
      };
    });
    return {
      key: config.key, name: base.name, secondaryText: base.secondaryText, cells,
      abnormal: cells.some(cell => cell.abnormal), hasValue: cells.some(cell => cell.hasValue),
      sharedRange: rawIndicators.every(item => referenceKey(item) === referenceKey(rawIndicators[0])),
      rangeText: cells[0]?.rangeText || '',
      isPrimary: primaryKeys.includes(config.key)
    };
  }).filter(row => row.hasValue);
  const activeKeys = new Set(selectedMetricKeys);
  const hasValidSelection = allRows.some(row => activeKeys.has(row.key));
  const metricOptions = allRows.map(row => ({
    key: row.key, name: row.name, selected: !hasValidSelection || activeKeys.has(row.key)
  }));
  const focusRows = allRows.filter(row => row.abnormal || row.isPrimary);
  const canCompare = columns.length >= 2;
  const nutritionCompareSeries = includeNutrition && canCompare
    ? buildMultiNutritionSeries(columns, reportsById, dailySummaries, nutritionSettings) : [];
  return {
    columns, baselineId: selection.baselineId, canCompare, metricOptions,
    compareRows: allRows.filter(row => !hasValidSelection || activeKeys.has(row.key)),
    focusMetricKeys: (focusRows.length ? focusRows : allRows.slice(0, 4)).map(row => row.key),
    tableWidthRpx: 200 + columns.length * 244,
    nutritionCompareSeries,
    hasNutritionData: nutritionCompareSeries.some(series => series.sides.some(side => side.points.some(point => !point.missing)))
  };
}

function resolveMultiNutritionWindows(columns = []) {
  const ranges = new Map();
  columns.forEach(column => {
    if (column.date) {
      const window = resolveWeekBeforeReport(column.date);
      ranges.set(window.startDate + '_' + window.endDate, window);
    }
  });
  return [...ranges.values()];
}

module.exports = { resolveMultiReportSelection, buildMultiReportComparison, resolveMultiNutritionWindows };
