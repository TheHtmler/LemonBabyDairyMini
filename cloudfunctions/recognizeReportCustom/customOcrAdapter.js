'use strict';
const { parseRefRange } = require('./refRangeParser');
const { resolveReportIndicator, getReportRecognitionRules } = require('./lib/report/reportRecognitionRules');
const { REPORT_MAX_PHOTOS, REPORT_RECOGNITION_VERSION, REPORT_OCR_PIPELINE_VERSION } = require('./lib/config/reportTypes');
const { normalizeReportDetectionValue, summarizeReportValues } = require('./lib/report/reportNumeric');

const MAX_ROWS_PER_SEGMENT = 100;
const MAX_ROWS_PER_PHOTO = 1200;
const SOURCE_FIELDS = { n: 120, v: 128, r: 160, u: 80, f: 20 };
const ROW_ERROR_MESSAGES = {
  INVALID_JSON: '识别服务返回的数据格式无法解析',
  ROOT_SHAPE_INVALID: '识别服务返回的数据结构不符合要求',
  ROOT_FIELDS_INVALID: '识别结果包含约定之外的原表字段',
  FINISH_REASON_INVALID: '识别结果未完整返回',
  CONTENT_MISSING: '识别服务没有返回可读取的内容',
  ROWS_MISSING: '识别结果缺少原表行列表',
  ROW_LIMIT: '识别原表行数超过处理上限',
  ROW_SHAPE_INVALID: '识别结果的原行结构不符合要求',
  ROW_FIELDS_MISSING: '识别原行缺少名称或结果字段',
  ROW_FIELDS_INVALID: '识别原行包含约定之外的字段',
  ROW_FIELD_TYPE_INVALID: '识别原行的字段未按原文文本返回',
  ROW_ID_INVALID: '识别结果的原行引用格式无效',
  DUPLICATE_ROW_ID: '识别结果包含重复的原行编号',
  SOURCE_BATCH_INVALID: '识别图片批次不完整',
  MATCHES_MISSING: '指标分类结果缺少原行对应关系',
  MAPPING_FIELDS_INVALID: '指标分类返回了约定之外的数据',
  MATCH_LIMIT: '指标分类引用数量超过原表行数',
  MAPPING_SHAPE_INVALID: '指标分类对应关系的格式无效',
  MAPPING_ROW_MISSING: '指标分类引用了不存在的原行',
  MAPPING_KEY_INVALID: '指标分类返回了不支持的目标字段',
  MAPPING_CONFLICT: '指标分类将同一原行指向多个目标'
};

function invalidModelResult(message, validationReason, field, details = {}) {
  // 诊断不记录模型原文、项目名称或检验值。
  throw Object.assign(new Error(message), { code: 'INVALID_MODEL_RESULT',
    diagnostic: { validationReason, ...(field ? { field } : {}), ...details } });
}

function invalidRowResult(reason, field) {
  invalidModelResult((ROW_ERROR_MESSAGES[reason] || '识别结果未通过原行校验') + '，请重试', reason, field);
}

function sourceRowId(value) {
  if (typeof value !== 'string' || !value || value.length > 80 || value !== value.trim()) invalidRowResult('ROW_ID_INVALID');
  return value;
}

function parseModelResult(response) {
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw Object.assign(new Error('模型输出达到上限，报告识别结果未返回完整'), { code: 'MODEL_OUTPUT_TRUNCATED',
      diagnostic: { validationReason: 'OUTPUT_TRUNCATED' } });
  }
  if (choice?.finish_reason !== 'stop') invalidRowResult('FINISH_REASON_INVALID');
  if (typeof choice.message?.content !== 'string') invalidRowResult('CONTENT_MISSING');
  const text = choice.message.content.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i, '$1');
  let raw;
  try { raw = JSON.parse(text); }
  catch (_) { invalidRowResult('INVALID_JSON'); }
  // JSON数组也是完整的结构化结果，具体行/映射结构由各阶段分别校验。
  if (!raw || typeof raw !== 'object') {
    const rootType = raw === null ? 'null' : typeof raw;
    invalidModelResult('识别服务返回的数据结构不符合要求，请重试', 'ROOT_SHAPE_INVALID', undefined, { rootType });
  }
  return raw;
}

// 原行结构只约束通用表格字段，不接收报告类型或业务指标。
function validateSourceRows(rows, maxRows = MAX_ROWS_PER_PHOTO * REPORT_MAX_PHOTOS) {
  if (!Array.isArray(rows)) invalidRowResult('ROWS_MISSING');
  if (rows.length > maxRows) invalidRowResult('ROW_LIMIT');
  const ids = new Set();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 6) invalidRowResult('ROW_SHAPE_INVALID');
    const id = sourceRowId(row[0]);
    if (ids.has(id)) invalidRowResult('DUPLICATE_ROW_ID');
    ids.add(id);
    Object.entries(SOURCE_FIELDS).forEach(([field, limit], index) => {
      const value = row[index + 1];
      if (value !== null && typeof value !== 'string') invalidRowResult('ROW_FIELD_TYPE_INVALID', field);
      if (typeof value === 'string' && value.length > limit) {
        invalidModelResult('检测字段过长，请重试', 'FIELD_LENGTH_INVALID', field);
      }
    });
  }
}

function readReportSourceRows(response) {
  const raw = parseModelResult(response);
  const sourceRows = Array.isArray(raw) ? raw : raw.rows;
  if (!Array.isArray(sourceRows)) invalidRowResult('ROWS_MISSING');
  if (!Array.isArray(raw) && Object.keys(raw).some(key => key !== 'rows')) invalidRowResult('ROOT_FIELDS_INVALID');
  if (sourceRows.length > MAX_ROWS_PER_SEGMENT) invalidRowResult('ROW_LIMIT');
  const rows = sourceRows.map((row, index) => {
    const id = 'r' + (index + 1);
    if (Array.isArray(row)) {
      // 紧凑行严格保留五列，缺少字段必须显式为null，不能左移后错配数值或单位。
      if (row.length !== 5) invalidRowResult('ROW_SHAPE_INVALID');
      return [id, ...row];
    }
    if (!row || typeof row !== 'object') invalidRowResult('ROW_SHAPE_INVALID');
    if (!Object.prototype.hasOwnProperty.call(row, 'n') || !Object.prototype.hasOwnProperty.call(row, 'v')) invalidRowResult('ROW_FIELDS_MISSING');
    if (Object.keys(row).some(field => !Object.prototype.hasOwnProperty.call(SOURCE_FIELDS, field))) invalidRowResult('ROW_FIELDS_INVALID');
    // 只有可选字段缺失可转为空；不能把非法字段类型当成空值，更不能补0。
    return [id, row.n, row.v, row.r === undefined ? null : row.r,
      row.u === undefined ? null : row.u, row.f === undefined ? null : row.f];
  });
  validateSourceRows(rows, MAX_ROWS_PER_SEGMENT);
  return rows;
}

function combineReportSourceRows(chunks) {
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > REPORT_MAX_PHOTOS) invalidRowResult('SOURCE_BATCH_INVALID');
  chunks.forEach(rows => validateSourceRows(rows, MAX_ROWS_PER_PHOTO));
  // 逐图编号保留全部原行；不按名称、数值或照片完成顺序去重。
  const rows = chunks.flatMap((chunk, photoIndex) =>
    chunk.map((row, rowIndex) => ['p' + (photoIndex + 1) + 'r' + (rowIndex + 1), ...row.slice(1)]));
  validateSourceRows(rows);
  return rows;
}

function readReportMappingMatches(rows, response, reportType) {
  validateSourceRows(rows);
  const raw = rows.length === 0 && response === undefined ? { matches: [] } : parseModelResult(response);
  const matches = Array.isArray(raw) ? raw : raw.matches;
  if (!Array.isArray(matches)) invalidRowResult('MATCHES_MISSING');
  if (!Array.isArray(raw) && Object.keys(raw).some(key => key !== 'matches')) invalidRowResult('MAPPING_FIELDS_INVALID');
  validateReportMatches(rows, matches, reportType);
  return matches;
}

function validateReportMatches(rows, matches, reportType) {
  if (matches.length > rows.length) invalidRowResult('MATCH_LIMIT');
  const sources = new Map(rows.map(row => [row[0], row]));
  const targets = new Set(getReportRecognitionRules(reportType).map(rule => rule.key));
  const mapped = new Map();
  for (const match of matches) {
    if (!Array.isArray(match) || match.length !== 2) invalidRowResult('MAPPING_SHAPE_INVALID');
    const [key, rawId] = match;
    const id = sourceRowId(rawId);
    if (!sources.has(id)) invalidRowResult('MAPPING_ROW_MISSING');
    if (key !== null && !targets.has(key)) invalidRowResult('MAPPING_KEY_INVALID');
    if (mapped.has(id) && mapped.get(id) !== key) invalidRowResult('MAPPING_CONFLICT');
    mapped.set(id, key);
  }
  return mapped;
}

function normalizeReportMappings(rows, matches, reportType) {
  validateSourceRows(rows);
  const mapped = validateReportMatches(rows, matches, reportType);
  const structuredItems = [];
  for (const row of rows) {
    const id = row[0];
    const key = mapped.get(id);
    if (key == null) continue;
    const name = row[1]?.trim();
    const value = normalizeReportDetectionValue(row[2]);
    if (!name || !value) continue;
    const resolved = resolveReportIndicator({ name, indicator_key: key, unit: row[4] }, reportType);
    if (!resolved) continue;
    const refRange = row[3]?.trim() || null;
    structuredItems.push({ name, value, rawValue: row[2], refRange, ...parseRefRange(refRange),
      unit: row[4]?.trim() || null, flag: row[5]?.trim() || null,
      confidence: null, source: 'qwen-ocr', sourceRowId: id,
      indicatorKey: resolved.key, matchScore: resolved.matchScore, mappingSource: resolved.mappingSource,
      needsReview: resolved.needsReview, reviewReason: resolved.reviewReason,
      recognitionStatus: resolved.needsReview ? 'needs_review' : 'accepted',
      confirmationBlocked: resolved.needsReview });
  }
  const filteredCount = rows.length - structuredItems.length;
  return { mode: 'format-report', reportType, protocolVersion: REPORT_RECOGNITION_VERSION,
    structuredItems, items: [], lines: [], rawText: '',
    statistics: { extractedCount: rows.length,
      acceptedCount: structuredItems.filter(item => !item.needsReview).length,
      needsReviewCount: structuredItems.filter(item => item.needsReview).length,
      sourceValues: summarizeReportValues(rows.map(row => row[2])),
      resultValues: summarizeReportValues(structuredItems.map(item => item.value)), filteredCount },
    warnings: filteredCount ? [{ code: 'UNRECOGNIZED_ROWS', count: filteredCount }] : [],
    parserVersion: REPORT_OCR_PIPELINE_VERSION };
}

module.exports = { readReportSourceRows, combineReportSourceRows, readReportMappingMatches, normalizeReportMappings };
