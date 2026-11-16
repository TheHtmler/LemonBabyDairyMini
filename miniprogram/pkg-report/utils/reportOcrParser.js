// 云端已固定原行并完成分类；前端只校验协议、保留原值和处理通用范围格式。
const { getReportRecognitionRules } = require('./reportRecognitionRules');
const { REPORT_RECOGNITION_VERSION, REPORT_MAX_PHOTOS } = require('../../constants/reportTypes');
const { normalizeReportDetectionValue } = require('../../utils/reportNumeric');
const { parseRefRange } = require('../../utils/reportReferenceRange');

function parseStructuredReportCandidates({ structuredItems, reportType, protocolVersion } = {}) {
  const fail = () => { throw new Error('报告识别结果版本或来源无效，请更新识别服务后重试'); };
  if (protocolVersion !== REPORT_RECOGNITION_VERSION || !Array.isArray(structuredItems)
    || structuredItems.length > 300 * REPORT_MAX_PHOTOS) fail();
  const keys = new Set(getReportRecognitionRules(reportType).map(rule => rule.key));
  return structuredItems.map(item => {
    if (!item || Array.isArray(item) || typeof item !== 'object') fail();
    const key = item.indicatorKey;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const value = normalizeReportDetectionValue(item.value);
    if (!keys.has(key) || typeof item.value !== 'string' || !value || !name
      || !['accepted', 'needs_review'].includes(item.recognitionStatus)) fail();
    if ((item.recognitionStatus === 'needs_review') !== (item.needsReview === true)
      || item.confirmationBlocked === true && item.needsReview !== true) fail();
    if (typeof item.sourceRowId !== 'string' || !item.sourceRowId) fail();
    for (const field of ['unit', 'refRange', 'minRange', 'maxRange', 'rawValue']) {
      if (item[field] != null && typeof item[field] !== 'string') fail();
    }
    const sourceRowIds = item.sourceRowIds;
    if (sourceRowIds != null && (!Array.isArray(sourceRowIds) || !sourceRowIds.every(id => typeof id === 'string'))) fail();
    return { key, value, ...parseRefRange(item.refRange || ''),
      unit: item.unit?.trim() || '', refRange: item.refRange?.trim() || '',
      sourceText: name, sourceRowId: item.sourceRowId,
      ...(sourceRowIds ? { sourceRowIds: [...sourceRowIds] } : {}),
      flag: item.flag || null, confidence: null, matchScore: 2, mappingSource: 'model',
      needsReview: item.needsReview === true, reviewReason: item.reviewReason || '',
      rawValue: item.rawValue ?? item.value, confirmationBlocked: item.confirmationBlocked === true,
      recognitionStatus: item.recognitionStatus };
  });
}

module.exports = { parseStructuredReportCandidates, parseRefRange };
