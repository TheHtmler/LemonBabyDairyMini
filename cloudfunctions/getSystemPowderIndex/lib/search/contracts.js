'use strict';
const { ANSWER_FIELDS } = require('./answerFields');

const FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'];
const UNITS = { calories: 'kcal', protein: 'g', fat: 'g', carbs: 'g', fiber: 'g', sodium: 'mg' };
const INTENTS = ['navigate_feature', 'search_catalog', 'search_diet_records', 'find_consumed_foods'];
const SCOPES = ['feature', 'food', 'powder', 'recipe', 'medication'];
const REASONS = ['threshold_required', 'period_required', 'powder_basis_required', 'unsupported_logic', 'unsupported_scope', 'recipe_density_unsupported', 'ambiguous'];

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_QUERY', '搜索条件包含不支持的字段');
}
function string(value, max, name) {
  if (typeof value !== 'string' || value.length > max) fail('INVALID_QUERY', name + '格式或长度无效');
  return value.trim();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validatePeriod(input) {
  const value = input || { kind: 'all' };
  keys(value, ['kind', 'days', 'startDate', 'endDateExclusive']);
  if (!['today', 'yesterday', 'current_calendar_week', 'previous_calendar_week', 'last_n_days', 'current_month', 'previous_calendar_month', 'range', 'all'].includes(value.kind)) fail('INVALID_QUERY', '日期条件不支持');
  const expected = value.kind === 'range' ? ['kind', 'startDate', 'endDateExclusive'] : value.kind === 'last_n_days' ? ['kind', 'days'] : ['kind'];
  keys(value, expected);
  if (value.kind === 'last_n_days' && (!Number.isInteger(value.days) || value.days < 1 || value.days > 36600)) fail('INVALID_QUERY', '天数无效');
  if (value.kind === 'range' && (!date(value.startDate) || !date(value.endDateExclusive) || value.startDate >= value.endDateExclusive)) fail('INVALID_QUERY', '日期范围无效');
  return { ...value };
}
function validateQueryPlan(input) {
  keys(input, ['schemaVersion', 'status', 'intent', 'scope', 'keyword', 'source', 'period', 'conditions', 'powderBasis', 'sort', 'reasonCode', 'requiredFields', 'answerFields']);
  if (input.schemaVersion !== 1 || !['ready', 'needs_clarification', 'unsupported'].includes(input.status)) fail('INVALID_QUERY', '搜索协议版本或状态无效');
  if (!INTENTS.includes(input.intent) || !Array.isArray(input.scope) || !input.scope.length || input.scope.length > SCOPES.length || input.scope.some(x => !SCOPES.includes(x)) || new Set(input.scope).size !== input.scope.length) fail('INVALID_QUERY', '搜索范围无效');
  if ((input.intent === 'navigate_feature') !== (input.scope.length === 1 && input.scope[0] === 'feature')) fail('INVALID_QUERY', '功能与资料查询不能混用');
  const source = input.source === undefined ? 'all' : input.source;
  if (!['all', 'system', 'mine'].includes(source)) fail('INVALID_QUERY', '资料来源无效');
  const conditions = input.conditions === undefined ? [] : input.conditions;
  const answerFields = input.answerFields;
  if (answerFields !== undefined && (!Array.isArray(answerFields) || !answerFields.length || answerFields.length > 6 || new Set(answerFields).size !== answerFields.length ||
    input.intent !== 'search_catalog' || answerFields.some(field => typeof field !== 'string' || !Object.prototype.hasOwnProperty.call(ANSWER_FIELDS, field) || input.scope.some(scope => !ANSWER_FIELDS[field].scopes.includes(scope))))) fail('INVALID_QUERY', '当前资料不支持查询这些字段');
  if (!Array.isArray(conditions) || conditions.length > 6) fail('INVALID_QUERY', '最多支持六个同时满足的营养条件');
  conditions.forEach(c => {
    keys(c, ['field', 'operator', 'value', 'unit', 'basisQuantity', 'basisUnit']);
    if (!FIELDS.includes(c.field) || !['lt', 'lte', 'eq', 'gte', 'gt'].includes(c.operator) || typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0 || c.unit !== UNITS[c.field] || typeof c.basisQuantity !== 'number' || !Number.isFinite(c.basisQuantity) || c.basisQuantity <= 0 || !['g', 'ml', 'portion'].includes(c.basisUnit)) fail('INVALID_QUERY', '营养比较条件或单位无效');
  });
  const powderBasis = input.powderBasis === undefined ? null : input.powderBasis;
  if (![null, 'dry', 'prepared'].includes(powderBasis)) fail('INVALID_QUERY', '奶粉基准无效');
  const history = ['search_diet_records', 'find_consumed_foods'].includes(input.intent);
  if (history && input.scope.includes('medication')) fail('INVALID_QUERY', '饮食记录不包含药物，请在药物分类查找');
  const sort = input.sort || (history ? 'latest_consumption' : 'relevance');
  if (sort !== (history ? 'latest_consumption' : 'relevance')) fail('INVALID_QUERY', '排序与搜索类型不匹配');
  const result = { schemaVersion: 1, status: input.status, intent: input.intent, scope: [...input.scope], keyword: string(input.keyword === undefined ? '' : input.keyword, 100, '关键词'), source,
    period: validatePeriod(input.period || (history || answerFields && answerFields.includes('intakeCount') ? { kind: 'last_n_days', days: 30 } : { kind: 'all' })), conditions: conditions.map(c => ({ ...c })), powderBasis, sort,
    ...(answerFields ? { answerFields: [...answerFields] } : {}) };
  if (input.status !== 'ready') {
    if (!REASONS.includes(input.reasonCode) || !Array.isArray(input.requiredFields) || input.requiredFields.some(x => !['conditions', 'period', 'powderBasis', 'scope', 'keyword'].includes(x))) fail('INVALID_QUERY', '待补充条件无效');
    return { ...result, reasonCode: input.reasonCode, requiredFields: [...new Set(input.requiredFields)] };
  }
  if (input.reasonCode !== undefined || input.requiredFields !== undefined) fail('INVALID_QUERY', '明确查询不能携带待补充状态');
  if (conditions.length && input.scope.length === 1 && input.scope[0] === 'medication') return { ...result, status: 'unsupported', reasonCode: 'unsupported_scope', requiredFields: ['scope', 'conditions'] };
  if (conditions.length && input.scope.length === 1 && input.scope[0] === 'recipe') return { ...result, status: 'unsupported', reasonCode: 'recipe_density_unsupported', requiredFields: ['scope', 'conditions'] };
  if ((conditions.length || answerFields && answerFields.some(field => FIELDS.includes(field))) && input.scope.includes('powder') && !powderBasis) return { ...result, status: 'needs_clarification', reasonCode: 'powder_basis_required', requiredFields: ['powderBasis'] };
  if (input.intent === 'navigate_feature' && conditions.length) fail('INVALID_QUERY', '功能入口不支持营养筛选');
  return result;
}
module.exports = { FIELDS, UNITS, INTENTS, SCOPES, REASONS, fail, keys, string, date, validatePeriod, validateQueryPlan };
