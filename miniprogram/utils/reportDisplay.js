const ReportModel = require('../models/report');
const { normalizeReportDetectionValue, toExactReportNumber } = require('./reportNumeric');

function hasReportValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function readReportNumber(value) {
  const number = toExactReportNumber(value);
  return Number.isFinite(number) ? number : null;
}

function formatReportValue(value) {
  if (!hasReportValue(value)) return '—';
  return normalizeReportDetectionValue(value) || String(value).trim();
}

function formatReportRange(minRange, maxRange) {
  const min = hasReportValue(minRange) ? formatReportValue(minRange) : '';
  const max = hasReportValue(maxRange) ? formatReportValue(maxRange) : '';
  if (min && max) return min + '–' + max;
  if (min) return '≥' + min;
  if (max) return '≤' + max;
  return '';
}

function getResultKind(value, numericValue) {
  if (!hasReportValue(value)) return 'empty';
  if (numericValue !== null) return 'numeric';
  return /^(?:[<>＜＞≤≥≦≧]|小于|大于|低于|高于|不高于|不低于|不超过|不少于)/.test(String(value).trim())
    ? 'qualified' : 'text';
}

function getUnknownReason(resultKind, indicator, min, max) {
  if (resultKind === 'qualified') {
    return { code: 'qualified_result', label: '限定符结果待核对', text: '结果含限定符，暂不自动判断范围状态' };
  }
  if (resultKind === 'text') {
    return { code: 'non_numeric', label: '非数值结果待核对', text: '已录入非数值结果，请按原报告核对' };
  }
  const hasMin = hasReportValue(indicator.minRange);
  const hasMax = hasReportValue(indicator.maxRange);
  if (!hasMin && !hasMax) {
    return { code: 'missing_range', label: '缺参考范围', text: '未录入参考范围，暂不能判断范围状态' };
  }
  if ((hasMin && min === null) || (hasMax && max === null) || (min !== null && max !== null && min > max)) {
    return { code: 'invalid_range', label: '参考范围无效', text: '参考范围不是有效数值区间，请核对原报告' };
  }
  return { code: 'single_sided_range', label: '单侧范围待核对', text: '单侧参考范围暂未自动判断' };
}

function buildIndicatorDisplay(config = {}, indicator = {}) {
  const value = indicator.value;
  const hasValue = hasReportValue(value);
  const numericValue = readReportNumber(value);
  const resultKind = getResultKind(value, numericValue);
  const min = readReportNumber(indicator.minRange);
  const max = readReportNumber(indicator.maxRange);
  const rangeText = formatReportRange(indicator.minRange, indicator.maxRange);
  let status = hasValue ? 'unknown' : 'empty';
  // 状态重新派生，避免清空后残留旧状态；不扩大原有双边阈值算法。
  if (numericValue !== null && min !== null && max !== null && min <= max) {
    status = ReportModel.calculateIndicatorStatus(numericValue, min, max);
  }
  const unknown = status === 'unknown' ? getUnknownReason(resultKind, indicator, min, max) : null;
  const statusText = {
    high: '偏高', low: '偏低', normal: '范围内', empty: '未录入',
    unknown: unknown?.label || '状态待核对'
  }[status];
  const originalUnit = typeof indicator.unit === 'string' ? indicator.unit.trim() : '';
  const configuredUnit = typeof config.unit === 'string' ? config.unit.trim() : '';
  // 优先展示已保存的原单位，不能把另一尺度的原值配上配置单位。
  const dimensionless = (!!config.isRatio || config.key === 'ph') && !originalUnit && !configuredUnit;
  const unit = originalUnit || configuredUnit;
  const unitSource = originalUnit ? 'report' : configuredUnit ? 'configured'
    : dimensionless ? 'dimensionless' : 'missing';
  const optimalRangeText = indicator.optimalRange
    ? formatReportRange(indicator.optimalRange.min, indicator.optimalRange.max) : '';
  const rangeWithUnitText = rangeText ? [rangeText, unit].filter(Boolean).join(' ') : '';
  const optimalRangeWithUnitText = optimalRangeText ? [optimalRangeText, unit].filter(Boolean).join(' ') : '';
  const name = ReportModel.getIndicatorDisplayName(config) || config.name || config.key;
  const secondaryText = [config.abbr && config.abbr !== name ? config.abbr : '', unit]
    .filter(Boolean).join(' · ');
  return {
    key: config.key,
    name, secondaryText,
    abbr: config.abbr || '', unit, unitText: unit, unitSource,
    hasValue, numericValue, resultKind, valueText: formatReportValue(value), rangeText, rangeWithUnitText,
    rangeSource: rangeText ? 'report' : 'missing',
    optimalRangeText, optimalRangeWithUnitText,
    status, statusText, statusClass: status, unknownReason: unknown?.text || '', unknownReasonCode: unknown?.code || '',
    abnormal: status === 'high' || status === 'low',
    marker: status === 'high' ? '↑' : status === 'low' ? '↓' : ''
  };
}

function buildReportDisplay(report = {}) {
  const rows = ReportModel.getIndicators(report.reportType).map(config => (
    buildIndicatorDisplay(config, report.indicators?.[config.key] || {})
  ));
  const summary = {
    totalCount: rows.length,
    filledCount: rows.filter(row => row.hasValue).length,
    abnormalCount: rows.filter(row => row.abnormal).length,
    normalCount: rows.filter(row => row.status === 'normal').length,
    unknownCount: rows.filter(row => row.status === 'unknown').length,
    missingCount: rows.filter(row => !row.hasValue).length
  };
  summary.statusText = summary.abnormalCount ? summary.abnormalCount + ' 项超范围'
    : !summary.filledCount ? '未录入指标'
      : summary.unknownCount ? summary.unknownCount + ' 项待核对' : '已录入项在范围内';
  summary.statusClass = summary.abnormalCount ? 'warn' : summary.unknownCount || !summary.filledCount ? 'unknown' : 'ok';
  return { rows, summary };
}

module.exports = { hasReportValue, readReportNumber, formatReportValue, formatReportRange, buildIndicatorDisplay, buildReportDisplay };
