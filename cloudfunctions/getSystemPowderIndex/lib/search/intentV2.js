'use strict';
const { fail, keys, validatePeriod, FIELDS, UNITS } = require('./contracts');
const { CAPABILITIES, MEASURES, FEATURE_IDS, own } = require('./capabilities');
const SLOTS = ['entity', 'subjectMode', 'period', 'aggregation', 'powderBasis', 'threshold', 'excludedIngredientScope'];
function validateFilter(input) {
  keys(input, ['field', 'operator', 'value', 'unit', 'basisQuantity', 'basisUnit', 'entityMention']);
  if (input.field === 'recipe.ingredients' && input.operator === 'excludes') {
    if (typeof input.entityMention !== 'string' || !input.entityMention.trim() || input.entityMention.length > 100 || Object.keys(input).some(x => !['field', 'operator', 'entityMention'].includes(x))) fail('INVALID_QUERY', '排除配料条件无效');
    return { field: input.field, operator: input.operator, entityMention: input.entityMention.trim() };
  }
  const field = typeof input.field === 'string' ? input.field.replace(/^nutrition\./, '') : '';
  if (!FIELDS.includes(field) || !['lt', 'lte', 'eq', 'gte', 'gt'].includes(input.operator) || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.unit !== UNITS[field] ||
    !(typeof input.basisQuantity === 'number' && Number.isFinite(input.basisQuantity) && input.basisQuantity > 0) || !['g', 'ml', 'portion'].includes(input.basisUnit) || input.entityMention !== undefined) fail('INVALID_QUERY', '营养条件或计量基准无效');
  return { field: 'nutrition.' + field, operator: input.operator, value: input.value, unit: input.unit, basisQuantity: input.basisQuantity, basisUnit: input.basisUnit };
}
function validateIntentDraft(input) {
  keys(input, ['schemaVersion', 'status', 'operation', 'domain', 'entityMentions', 'measure', 'measures', 'subjectMode', 'periods', 'aggregation', 'groupBy', 'filters', 'source', 'powderBasis', 'basisQuantity', 'basisUnit', 'featureId', 'unresolved', 'reasonCode']);
  if (input.schemaVersion !== 2 || !['ready', 'needs_clarification', 'unsupported'].includes(input.status)) fail('INVALID_QUERY', '搜索理解结果版本无效');
  if (!own(CAPABILITIES, input.operation) || !CAPABILITIES[input.operation].domains.includes(input.domain)) fail('INVALID_QUERY', '该查询操作或分类不受支持');
  const mentions = input.entityMentions || [];
  if (!Array.isArray(mentions) || mentions.length > 3 || mentions.some(x => typeof x !== 'string' || !x.trim() || x.length > 100)) fail('INVALID_QUERY', '对象名称无效');
  const periods = input.periods || [];
  if (!Array.isArray(periods) || periods.length > 2) fail('INVALID_QUERY', '最多比较两段日期');
  const filters = input.filters || [];
  if (!Array.isArray(filters) || filters.length > 6) fail('INVALID_QUERY', '最多支持六条同时满足的条件');
  const unresolved = input.unresolved || [];
  if (!Array.isArray(unresolved) || unresolved.some(x => !SLOTS.includes(x))) fail('INVALID_QUERY', '待补条件不支持');
  const measure = input.measure || null;
  const measures = input.measures || (measure ? [measure] : []);
  if (!Array.isArray(measures) || measures.length > 6 || new Set(measures).size !== measures.length || (input.operation !== 'catalog.read' && measures.length > 1) ||
    measures.some(key => !own(MEASURES, key) || !MEASURES[key].domains.includes(input.domain) || !(MEASURES[key].operations.includes(input.operation) || input.operation === 'catalog.search' && key.startsWith('nutrition.') && unresolved.includes('threshold')))) fail('INVALID_QUERY', '查询指标与操作不匹配');
  if (measure && !measures.includes(measure)) fail('INVALID_QUERY', '查询指标不一致');
  const aggregation = input.aggregation || null;
  if (aggregation && !['count', 'sum', 'mean_daily', 'min', 'max', 'latest'].includes(aggregation)) fail('INVALID_QUERY', '统计方式不支持');
  if (aggregation && measure && input.operation !== 'records.list' && !MEASURES[measure].aggregations.includes(aggregation)) fail('INVALID_QUERY', '此指标不支持这种统计');
  if (input.operation === 'records.list' && aggregation && aggregation !== 'latest') fail('INVALID_QUERY', '明细不支持这种统计');
  const result = { schemaVersion: 2, status: input.status, operation: input.operation, domain: input.domain, entityMentions: [...new Set(mentions.map(x => x.trim()))],
    measure, measures: [...measures], subjectMode: input.subjectMode || (input.operation.startsWith('catalog') ? 'configured' : 'observed'), periods: periods.map(validatePeriod), aggregation,
    groupBy: input.groupBy || 'none', filters: filters.map(validateFilter), source: input.source || 'all', powderBasis: input.powderBasis || null,
    basisQuantity: input.basisQuantity === undefined ? 100 : input.basisQuantity, basisUnit: input.basisUnit || 'g', unresolved: [...new Set(unresolved)], reasonCode: input.reasonCode || '' };
  if (!['configured', 'observed'].includes(result.subjectMode) || !['none', 'day', 'entity', 'unit'].includes(result.groupBy) || !['all', 'system', 'mine'].includes(result.source) || ![null, 'dry', 'prepared'].includes(result.powderBasis) ||
    typeof result.basisQuantity !== 'number' || !Number.isFinite(result.basisQuantity) || result.basisQuantity <= 0 || !['g', 'ml', 'portion'].includes(result.basisUnit) || typeof result.reasonCode !== 'string' || result.reasonCode.length > 80) fail('INVALID_QUERY', '搜索条件无效');
  if (input.featureId !== undefined) { if (!FEATURE_IDS.includes(input.featureId) || result.operation !== 'feature.open') fail('INVALID_QUERY', '功能入口无效'); result.featureId = input.featureId; }
  return result;
}
module.exports = { validateIntentDraft, validateFilter, SLOTS };
