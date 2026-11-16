const ReportModel = require('../models/report');
const { buildIndicatorDisplay, readReportNumber } = require('./reportDisplay');
const { areReportUnitsComparable } = require('./reportUnits');
const { resolveDayPremiumProteinBase } = require('./search-core/recipeProtein');
const {
  buildReportComparePickerOptions, resolveWeekBeforeReport, toDateKey,
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

function buildCellDifference(base, current) {
  let reasonCode = '';
  let reason = '';
  if (!base.hasValue || !current.hasValue) {
    reasonCode = 'missing_value';
    reason = !base.hasValue && !current.hasValue ? '两份报告均未录入该指标'
      : !base.hasValue ? '对照报告未录入该指标' : '该份报告未录入该指标';
  } else if (base.resultKind === 'qualified' || current.resultKind === 'qualified') {
    reasonCode = 'qualified_result';
    reason = '含限定符结果，暂不计算差值';
  } else if (base.numericValue === null || current.numericValue === null) {
    reasonCode = 'non_numeric';
    reason = '非数值结果，无法直接计算差值';
  } else if (!areReportUnitsComparable(base.unit, current.unit, { key: current.key,
    isRatio: ['c3_c0', 'c3_c2'].includes(current.key) })) {
    reasonCode = 'unit_mismatch';
    reason = '单位不同，未计算差值';
  }
  if (reasonCode) {
    return {
      delta: null, deltaComparable: false, deltaText: reasonCode === 'missing_value' ? '未录入' : '暂不计算',
      deltaReasonCode: reasonCode, deltaReason: reason, deltaHint: reason
    };
  }
  const difference = Number((current.numericValue - base.numericValue).toPrecision(12));
  if (!Number.isFinite(difference)) {
    return { delta: null, deltaComparable: false, deltaText: '无法计算',
      deltaReasonCode: 'invalid_difference', deltaReason: '差值超出可计算范围', deltaHint: '差值超出可计算范围' };
  }
  return {
    delta: difference, deltaComparable: true,
    deltaText: (difference > 0 ? '+' : '') + String(difference),
    deltaReasonCode: '', deltaReason: '', deltaHint: ''
  };
}

const NUTRITION_SUMMARY_METRICS = [
  { key: 'calories', label: '热量', unit: 'kcal/d', coefficientUnit: 'kcal/kg/d', precision: 1 },
  { key: 'protein', label: '总蛋白', unit: 'g/d', coefficientUnit: 'g/kg/d', precision: 2 },
  { key: 'naturalProtein', label: '天然蛋白', unit: 'g/d', coefficientUnit: 'g/kg/d', precision: 2 },
  { key: 'specialProtein', label: '特殊蛋白', unit: 'g/d', coefficientUnit: 'g/kg/d', precision: 2 },
  { key: 'premiumProteinRatio', label: '优质占比', valueKind: 'ratio', unit: '%', deltaUnit: '个百分点', precision: 1 }
];

function readNutritionAmount(value) {
  const number = readReportNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function hasNutritionRecord(summary) {
  const counts = summary.recordCounts || {};
  // 空日汇总也含零值及顺延体重，不能仅凭这些字段认定当天有摄入记录。
  return Number(counts.milk) > 0 || Number(counts.food) > 0
    || NUTRITION_SUMMARY_METRICS.some(config => readNutritionAmount(summary.macroSummary?.[config.key]) > 0);
}

function nutritionAverage(values) {
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value / values.length, 0);
  return Number.isFinite(average) ? average : null;
}

function formatNutritionAmount(value, precision) {
  return value === null ? '—' : String(Number(value.toFixed(precision)));
}

function nutritionDifference(base, current, valueKey, daysKey, unit, precision) {
  if (current.isBaseline) return { value: null, comparable: false, text: '', reason: '' };
  if (!base || base[daysKey] !== 7 || current[daysKey] !== 7) {
    return { value: null, comparable: false, text: '', reason: daysKey === 'coefficientDays'
      ? '两份报告均需有7天摄入及同期体重数据才计算差值' : '两份报告均需有7天该项摄入数据才计算差值' };
  }
  const difference = base[valueKey] === null || current[valueKey] === null
    ? null : current[valueKey] - base[valueKey];
  if (!Number.isFinite(difference)) {
    return { value: null, comparable: false, text: '', reason: '该项数据暂无法计算差值' };
  }
  const value = Number(difference.toFixed(precision));
  return { value, comparable: true, text: '较对照 ' + (value > 0 ? '+' : '') + value + ' ' + unit, reason: '' };
}

function buildPremiumProteinRatioCell(column, records) {
  let premiumTotal = 0;
  let naturalTotal = 0;
  let validDays = 0;
  let estimated = false;
  records.forEach(summary => {
    // 沿用饮食模块的分类：奶类天然蛋白和食物优质蛋白共同构成优质蛋白。
    const base = resolveDayPremiumProteinBase(summary);
    const natural = readNutritionAmount(base.naturalProtein);
    const premium = readNutritionAmount(base.premiumProtein);
    if (!(natural > 0) || premium === null || premium > natural) return;
    naturalTotal += natural;
    premiumTotal += premium;
    validDays += 1;
    estimated = estimated || !!base.premiumProteinEstimated;
  });
  // 汇总占比按摄入总量加权，避免把摄入量不同的每日百分比直接平均。
  const average = naturalTotal > 0 ? premiumTotal / naturalTotal * 100 : null;
  return {
    reportId: column.reportId, isBaseline: column.isBaseline, validDays, estimated,
    average, averageText: (average !== null && estimated ? '约' : '') + formatNutritionAmount(average, 1), unit: '%',
    coefficientAverage: null, coefficientText: '', coefficientUnit: '', coefficientDays: 0
  };
}

function buildMultiNutritionSummary(columns, dailySummaries) {
  const dailyByDate = new Map();
  (Array.isArray(dailySummaries) ? dailySummaries : []).forEach(summary => {
    const date = toDateKey(summary?.date);
    if (date && hasNutritionRecord(summary)) dailyByDate.set(date, summary);
  });
  const windows = columns.map(column => {
    const { startDate, endDate } = resolveWeekBeforeReport(column.date);
    const records = [...dailyByDate.entries()]
      .filter(([date]) => date >= startDate && date <= endDate)
      .map(([, summary]) => summary);
    return {
      column: { ...column, fullDateRange: startDate + ' 至 ' + endDate,
        dateRangeShort: startDate.slice(5).replace('-', '/') + '–' + endDate.slice(5).replace('-', '/'),
        recordedDays: records.length, totalDays: 7 },
      records
    };
  });
  const rows = NUTRITION_SUMMARY_METRICS.map(config => {
    const cells = windows.map(({ column, records }) => {
      if (config.valueKind === 'ratio') return buildPremiumProteinRatioCell(column, records);
      const amounts = [];
      const coefficients = [];
      records.forEach(summary => {
        const amount = readNutritionAmount(summary.macroSummary?.[config.key]);
        if (amount === null) return;
        amounts.push(amount);
        // 逐日换算后再求均值；不得用当前体重或平均体重反推历史系数。
        const weight = readNutritionAmount(summary.basicInfo?.weight);
        if (weight > 0 && Number.isFinite(amount / weight)) coefficients.push(amount / weight);
      });
      const average = nutritionAverage(amounts);
      const coefficientAverage = nutritionAverage(coefficients);
      const validDays = amounts.length;
      const coefficientDays = coefficients.length;
      return {
        reportId: column.reportId, isBaseline: column.isBaseline,
        average, averageText: formatNutritionAmount(average, config.precision), unit: config.unit,
        coefficientAverage, coefficientText: formatNutritionAmount(coefficientAverage, config.precision),
        coefficientUnit: config.coefficientUnit, validDays, coefficientDays
      };
    });
    const baseline = cells.find(cell => cell.isBaseline);
    return { key: config.key, label: config.label, valueKind: config.valueKind || 'amount', cells: cells.map(cell => {
      const delta = nutritionDifference(baseline, cell, 'average', 'validDays', config.deltaUnit || config.unit, config.precision);
      if (config.valueKind === 'ratio' && delta.comparable && (cell.estimated || baseline?.estimated)) {
        delta.text = delta.text.replace('较对照 ', '较对照约 ');
      }
      const coefficientDelta = config.valueKind === 'ratio'
        ? { value: null, comparable: false, text: '', reason: '' }
        : nutritionDifference(baseline, cell, 'coefficientAverage', 'coefficientDays', config.coefficientUnit, config.precision);
      return { ...cell, delta: delta.value, deltaText: delta.text, deltaComparable: delta.comparable,
        deltaReason: delta.reason, coefficientDelta: coefficientDelta.value,
        coefficientDeltaText: coefficientDelta.text, coefficientDeltaComparable: coefficientDelta.comparable,
        coefficientDeltaReason: coefficientDelta.reason };
    }) };
  });
  return {
    columns: windows.map(window => window.column), rows,
    hasData: rows.some(row => row.cells.some(cell => cell.average !== null))
  };
}

function buildMultiReportComparison({
  reports = [], reportType = '', reportIds = [], baselineId = '', selectedMetricKeys = [],
  metricMode = 'all', includeNutrition = false, dailySummaries = []
} = {}) {
  const selection = resolveMultiReportSelection(reports, reportType, reportIds, baselineId);
  const reportsById = new Map(reports.filter(report => report.reportType === reportType).map(report => [reportIdOf(report), report]));
  const columns = selection.selected.map(column => ({
    ...column, isBaseline: column.reportId === selection.baselineId,
    roleLabel: column.reportId === selection.baselineId ? '对照报告' : '对比报告',
    columnLabel: [column.date, column.labName, column.sameDayLabel].filter(Boolean).join(' · ')
  }));
  const baselineColumn = columns.find(column => column.isBaseline) || null;
  const baselineLabel = baselineColumn?.columnLabel || '';
  const baseline = reportsById.get(selection.baselineId);
  const primaryKeys = KEY_METRICS_BY_REPORT_TYPE[reportType] || [];
  const allRows = ReportModel.getIndicators(reportType).map(config => {
    const base = buildIndicatorDisplay(config, baseline?.indicators?.[config.key] || {});
    const rawIndicators = columns.map(column => reportsById.get(column.reportId)?.indicators?.[config.key] || {});
    const cells = columns.map((column, index) => {
      const display = buildIndicatorDisplay(config, rawIndicators[index]);
      return {
        reportId: column.reportId, isBaseline: column.isBaseline, hasValue: display.hasValue,
        valueText: display.valueText, numericValue: display.numericValue, resultKind: display.resultKind,
        status: display.status, statusText: display.statusText, marker: display.marker,
        unknownReason: display.unknownReason, unknownReasonCode: display.unknownReasonCode,
        unit: display.unit, unitText: display.unitText, unitSource: display.unitSource,
        rangeText: display.rangeText, rangeWithUnitText: display.rangeWithUnitText,
        rangeSource: display.rangeSource, abnormal: display.abnormal,
        ...buildCellDifference(base, display)
      };
    });
    const unitKeys = cells.map(cell => cell.unit);
    const unitMismatch = new Set(unitKeys.filter(Boolean)).size > 1;
    const sharedUnit = unitKeys.every(key => key === unitKeys[0]);
    const unitText = [...new Set(unitKeys.filter(Boolean))].join(' / ');
    // 数值边界相同但单位不同，也不能合并成一个参考范围。
    const sharedRange = sharedUnit && rawIndicators.every(item => referenceKey(item) === referenceKey(rawIndicators[0]));
    return {
      key: config.key, name: base.name, abbr: base.abbr,
      secondaryText: [base.abbr && base.abbr !== base.name ? base.abbr : '', unitText].filter(Boolean).join(' · '),
      unitText,
      unitMismatch, sharedUnit, cells,
      abnormal: cells.some(cell => cell.abnormal), hasValue: cells.some(cell => cell.hasValue),
      pending: cells.some(cell => cell.status === 'unknown'),
      sharedRange, rangeMismatch: !sharedRange,
      rangeText: cells[0]?.rangeText || '',
      rangeWithUnitText: cells[0]?.rangeWithUnitText || '',
      isPrimary: primaryKeys.includes(config.key)
    };
  }).filter(row => row.hasValue);
  const activeKeys = new Set(selectedMetricKeys);
  const mode = ['all', 'focus', 'abnormal', 'pending', 'custom'].includes(metricMode) ? metricMode : 'all';
  const focusRows = allRows.filter(row => row.abnormal || row.isPrimary);
  const compareRows = allRows.filter(row => {
    if (mode === 'focus') return row.abnormal || row.isPrimary;
    if (mode === 'abnormal') return row.abnormal;
    if (mode === 'pending') return row.pending;
    if (mode === 'custom') return activeKeys.has(row.key);
    return true;
  });
  const visibleKeys = new Set(compareRows.map(row => row.key));
  const metricOptions = allRows.map(row => ({
    key: row.key, name: row.name, selected: visibleKeys.has(row.key),
    abnormal: row.abnormal, pending: row.pending
  }));
  const canCompare = columns.length >= 2;
  const columnWidthRpx = columns.length === 1 ? 502 : columns.length === 2 ? 251 : 226;
  const nutritionSummary = includeNutrition && columns.length >= 1
    ? buildMultiNutritionSummary(columns, dailySummaries) : { columns: [], rows: [], hasData: false };
  return {
    columns, baselineId: selection.baselineId, baselineColumn, baselineLabel, canCompare, metricOptions,
    metricMode: mode, compareRows,
    focusMetricKeys: focusRows.map(row => row.key),
    summary: {
      totalCount: allRows.length, abnormalCount: allRows.filter(row => row.abnormal).length,
      pendingCount: allRows.filter(row => row.pending).length, visibleCount: compareRows.length,
      rangeMismatchCount: allRows.filter(row => row.rangeMismatch).length,
      unitMismatchCount: allRows.filter(row => row.unitMismatch).length
    },
    columnWidthRpx, tableWidthRpx: 200 + columns.length * columnWidthRpx,
    nutritionSummary, hasNutritionData: nutritionSummary.hasData
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

module.exports = {
  resolveMultiReportSelection, buildMultiReportComparison, resolveMultiNutritionWindows, buildMultiNutritionSummary
};
