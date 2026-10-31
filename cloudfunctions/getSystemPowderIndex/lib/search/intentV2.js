'use strict';
const { fail, keys, omitNullOptionals, validatePeriod, FIELDS, UNITS } = require('./contracts');
const { CAPABILITIES, MEASURES, FEATURE_IDS, BROWSE_GROUPS, own } = require('./capabilities');
const SLOTS = ['entity', 'subjectMode', 'period', 'aggregation', 'powderBasis', 'threshold', 'excludedIngredientScope', 'queryDirection'];
const BOWEL_FILTERS = {
  'bowel.type': ['stool', 'urine', 'mixed'],
  'bowel.consistency': ['liquid', 'loose', 'soft', 'normal', 'hard'],
  'bowel.color': ['yellow', 'green', 'brown', 'white', 'red', 'black']
};
function validateFilter(input) {
  keys(input, ['field', 'operator', 'value', 'unit', 'basisQuantity', 'basisUnit', 'entityMention']);
  input = omitNullOptionals(input, ['field', 'operator']);
  if (typeof input.field === 'string' && Object.prototype.hasOwnProperty.call(BOWEL_FILTERS, input.field)) {
    if (input.operator !== 'eq' || !BOWEL_FILTERS[input.field].includes(input.value) || Object.keys(input).some(key => !['field', 'operator', 'value'].includes(key))) fail('INVALID_QUERY', '尿布筛选条件无效');
    return { field: input.field, operator: 'eq', value: input.value };
  }
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
  keys(input, ['schemaVersion', 'status', 'operation', 'domain', 'entityMentions', 'measure', 'measures', 'subjectMode', 'periods', 'aggregation', 'groupBy', 'filters', 'threshold', 'source', 'powderBasis', 'basisQuantity', 'basisUnit', 'featureId', 'browseGroup', 'unresolved', 'reasonCode']);
  input = omitNullOptionals(input, ['schemaVersion', 'status', 'operation', 'domain']);
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
  let threshold;
  if (unresolved.includes('threshold')) {
    keys(input.threshold, ['field', 'operator', 'unit', 'basisQuantity', 'basisUnit']);
    const { value, ...condition } = validateFilter({ ...input.threshold, value: 0 });
    if (input.operation !== 'catalog.search' || !condition.field.startsWith('nutrition.') ||
        !own(MEASURES, condition.field) || input.domain !== 'catalog' && !MEASURES[condition.field].domains.includes(input.domain) || filters.length >= 6) {
      fail('INVALID_QUERY', '待补阈值必须保留适用的营养指标、比较方向和计量基准，最多六个条件');
    }
    threshold = condition;
  } else if (input.threshold !== undefined) fail('INVALID_QUERY', '只有缺少数值时才能提供待补阈值条件');
  const measure = input.measure || null;
  const measures = input.measures || (measure ? [measure] : []);
  if (measure !== null && typeof measure !== 'string') fail('INVALID_QUERY', 'measure 必须是单个指标标识字符串；不适用时省略或填 null');
  if (!Array.isArray(measures) || measures.some(key => typeof key !== 'string')) fail('INVALID_QUERY', 'measures 必须是指标标识字符串数组，不能包含对象；筛选比较条件请放入 filters');
  if (measures.length > 6 || new Set(measures).size !== measures.length || (input.operation !== 'catalog.read' && measures.length > 1) ||
    measures.some(key => !own(MEASURES, key) || !(MEASURES[key].domains.includes(input.domain) || threshold && input.domain === 'catalog' && key === threshold.field) || !(MEASURES[key].operations.includes(input.operation) || input.operation === 'catalog.search' && threshold && key === threshold.field))) fail('INVALID_QUERY', input.operation === 'catalog.search' ? 'catalog.search 的比较条件应放入 filters，缺少数值时用 threshold 保留完整条件' : '查询指标与操作不匹配，请按指标注册表选择领域和操作');
  if (measure && !measures.includes(measure)) fail('INVALID_QUERY', '查询指标不一致');
  if (threshold && measures.some(key => key !== threshold.field)) fail('INVALID_QUERY', '待补阈值与营养指标不一致');
  const aggregation = input.aggregation || null;
  if (aggregation && !['count', 'sum', 'mean_daily', 'min', 'max', 'latest', 'change'].includes(aggregation)) fail('INVALID_QUERY', '统计方式不支持');
  if (aggregation && measure && input.operation !== 'records.list' && !MEASURES[measure].aggregations.includes(aggregation)) fail('INVALID_QUERY', '此指标不支持这种统计');
  if (input.operation === 'records.list' && aggregation && aggregation !== 'latest') fail('INVALID_QUERY', '明细不支持这种统计');
  const result = { schemaVersion: 2, status: input.status, operation: input.operation, domain: input.domain, entityMentions: [...new Set(mentions.map(x => x.trim()))],
    measure, measures: [...measures], subjectMode: input.subjectMode || (input.operation.startsWith('catalog') ? 'configured' : 'observed'), periods: periods.map(validatePeriod), aggregation,
    groupBy: input.groupBy || 'none', filters: filters.map(validateFilter), source: input.source || 'all', powderBasis: input.powderBasis || null,
    basisQuantity: input.basisQuantity === undefined ? 100 : input.basisQuantity, basisUnit: input.basisUnit || 'g', unresolved: [...new Set(unresolved)], reasonCode: input.reasonCode || '',
    ...(threshold ? { threshold } : {}) };
  if (!['configured', 'observed'].includes(result.subjectMode) || !['none', 'day', 'entity', 'unit'].includes(result.groupBy) || !['all', 'system', 'mine'].includes(result.source) || ![null, 'dry', 'prepared'].includes(result.powderBasis) ||
    typeof result.basisQuantity !== 'number' || !Number.isFinite(result.basisQuantity) || result.basisQuantity <= 0 || !['g', 'ml', 'portion'].includes(result.basisUnit) || typeof result.reasonCode !== 'string' || result.reasonCode.length > 80) fail('INVALID_QUERY', '搜索条件无效');
  if (input.featureId !== undefined) { if (!FEATURE_IDS.includes(input.featureId) || result.operation !== 'feature.open') fail('INVALID_QUERY', '功能入口无效'); result.featureId = input.featureId; }
  if (input.browseGroup !== undefined) {
    const group = BROWSE_GROUPS.find(group => group.id === input.browseGroup);
    if (result.operation !== 'catalog.browse' || !group || result.source !== 'all' && group.operation === 'records.list') fail('INVALID_QUERY', '搜索结果分组无效');
    result.browseGroup = input.browseGroup;
  }
  return result;
}
module.exports = { validateIntentDraft, validateFilter, SLOTS };
