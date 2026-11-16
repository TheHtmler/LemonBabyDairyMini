const ReportModel = require('./reportModel');
const { normalizeReportUnit, areReportUnitsEquivalent } = require('./reportUnits');

const rulesByType = new Map();

// 目标字段是表单配置，不参与图片转录，也不作为原名称改写规则。
function getReportRecognitionRules(reportType) {
  if (!rulesByType.has(reportType)) {
    rulesByType.set(reportType, ReportModel.getIndicators(reportType)
      .filter(config => !config.isRatio || config.allowRangeInput)
      .map(config => ({ key: config.key, name: config.name, abbr: config.abbr || '', unit: config.unit || '' })));
  }
  return rulesByType.get(reportType);
}

// 模型负责名称语义归属；程序只校验目标配置和单位，不按固定指标词典改名、纠号或补值。
function resolveReportIndicator(item = {}, reportType) {
  if (typeof item.name !== 'string' || !item.name.trim()) return null;
  if (item.indicatorKey === null || item.indicator_key === null
    || item.needsReview === true || item.needs_review === true) return null;
  const key = item.indicatorKey ?? item.indicator_key;
  const target = getReportRecognitionRules(reportType).find(rule => rule.key === key);
  if (!target) return null;
  const originalUnit = normalizeReportUnit(item.unit);
  const expectedUnit = normalizeReportUnit(target.unit);
  const reviewReason = !expectedUnit ? '' : !originalUnit ? 'UNIT_MISSING'
    : areReportUnitsEquivalent(originalUnit, expectedUnit) ? '' : 'UNIT_MISMATCH';
  return { key: target.key, matchScore: 2, mappingSource: 'model',
    needsReview: Boolean(reviewReason), reviewReason };
}

module.exports = { getReportRecognitionRules, resolveReportIndicator, normalizeReportUnit, areReportUnitsEquivalent };
