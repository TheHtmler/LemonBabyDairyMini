const ReportModel = require('../models/report');

function hasReportValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function readReportNumber(value) {
  if (!hasReportValue(value) || !['number', 'string'].includes(typeof value)) return null;
  const text = String(value).trim().replace(/^\((-?\d+(?:\.\d+)?)\)$/, '$1');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function formatReportValue(value) {
  if (!hasReportValue(value)) return '—';
  const text = String(value).trim();
  // 仅移除十进制小数末尾的零，不经数值转换，保留原始有效位和特殊结果。
  return /^[+-]?\d+\.\d+$/.test(text) ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function formatReportRange(minRange, maxRange) {
  const min = hasReportValue(minRange) ? formatReportValue(minRange) : '';
  const max = hasReportValue(maxRange) ? formatReportValue(maxRange) : '';
  if (min && max) return min + '–' + max;
  if (min) return '≥' + min;
  if (max) return '≤' + max;
  return '';
}

function buildIndicatorDisplay(config, indicator = {}) {
  const value = indicator.value;
  const hasValue = hasReportValue(value);
  const numericValue = readReportNumber(value);
  const min = readReportNumber(indicator.minRange);
  const max = readReportNumber(indicator.maxRange);
  const rangeText = formatReportRange(indicator.minRange, indicator.maxRange);
  let status = hasValue ? 'unknown' : 'empty';
  // 状态重新派生，避免清空后残留旧状态；不扩大原有双边阈值算法。
  if (numericValue !== null && min !== null && max !== null && min <= max) {
    status = ReportModel.calculateIndicatorStatus(numericValue, min, max);
  }
  const statusText = {
    high: '偏高', low: '偏低', normal: '范围内', empty: '未录入',
    unknown: rangeText ? '状态待核对' : '待补参考范围'
  }[status];
  const name = ReportModel.getIndicatorDisplayName(config) || config.name || config.key;
  const secondaryText = [config.abbr && config.abbr !== name ? config.abbr : '', config.unit]
    .filter(Boolean).join(' · ');
  return {
    key: config.key,
    name, secondaryText,
    abbr: config.abbr || '', unit: config.unit || '',
    hasValue, numericValue, valueText: formatReportValue(value), rangeText,
    optimalRangeText: indicator.optimalRange
      ? formatReportRange(indicator.optimalRange.min, indicator.optimalRange.max) : '',
    status, statusText, statusClass: status,
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
