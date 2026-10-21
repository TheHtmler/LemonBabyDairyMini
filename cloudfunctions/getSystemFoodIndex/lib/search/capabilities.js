'use strict';

const PROTOCOL_VERSION = 2;
const CAPABILITY_VERSION = 'search-2.0.0';
const BUILD_VERSION = '20261019-search-performance';
const CATALOG_DOMAINS = ['food', 'powder', 'recipe', 'medication'];
const CAPABILITIES = {
  'catalog.search': { label: '查找资料', domains: ['catalog', ...CATALOG_DOMAINS], result: 'list' },
  'catalog.read': { label: '读取资料属性', domains: CATALOG_DOMAINS, result: 'list' },
  'records.list': { label: '查看记录', domains: ['diet', 'milk', 'medication', 'water'], result: 'list' },
  'records.aggregate': { label: '统计记录', domains: ['diet', 'milk', 'medication', 'water', 'intake'], result: 'scalar' },
  'metrics.series': { label: '查看实际摄入系数', domains: ['intake'], result: 'series' },
  'metrics.aggregate': { label: '统计实际摄入系数', domains: ['intake'], result: 'scalar' },
  'metrics.compare': { label: '比较两段时间', domains: ['intake', 'medication', 'milk', 'water', 'diet'], result: 'comparison' },
  'feature.open': { label: '打开功能', domains: ['feature'], result: 'feature' }
};
const MEASURES = {};
function register(key, label, unit, domains, operations, aggregations, extra = {}) {
  MEASURES[key] = { label, unit, domains, operations, aggregations, ...extra };
}
for (const [field, label] of Object.entries({ frequency: '已设置频率', dosage: '已设置单次剂量', concentration: '已设置浓度', notes: '备注' }))
  register('medication.' + field, label, '', ['medication'], ['catalog.read'], [], { field });
for (const [field, label] of Object.entries({ calories: '能量', protein: '蛋白质', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' }))
  register('nutrition.' + field, label, field === 'calories' ? 'kcal' : field === 'sodium' ? 'mg' : 'g', ['food', 'powder'], ['catalog.read'], [], { field });
register('recipe.ingredients', '配料', '', ['recipe'], ['catalog.read'], []);
register('records.count', '已记录次数', '次', ['medication', 'diet', 'milk', 'water'], ['records.aggregate', 'metrics.compare'], ['count']);
register('medication.amount', '已记录服用量', '', ['medication'], ['records.aggregate', 'metrics.compare'], ['sum', 'mean_daily']);
register('milk.recorded_volume', '已记录奶量', 'ml', ['milk'], ['records.aggregate', 'metrics.compare'], ['sum', 'mean_daily']);
register('milk.consumed_volume', '实际成品奶量', 'ml', ['milk'], ['records.aggregate', 'metrics.compare'], ['sum', 'mean_daily']);
register('milk.components', '本次使用的奶粉', '', ['milk'], ['records.list'], []);
register('water.volume', '已记录饮水量', 'ml', ['water'], ['records.aggregate', 'metrics.compare'], ['sum', 'mean_daily']);
for (const [field, label] of Object.entries({ natural_protein: '天然蛋白摄入', special_protein: '特殊蛋白摄入', protein: '总蛋白摄入', calories: '热量摄入', fat: '脂肪摄入', carbs: '碳水摄入' }))
  register('intake.' + field, label, field === 'calories' ? 'kcal' : 'g', ['intake', 'diet'], ['records.aggregate', 'metrics.compare'], ['sum', 'mean_daily'], { field: field.replace(/_([a-z])/g, (_, x) => x.toUpperCase()) });
for (const [field, label] of Object.entries({ natural_protein: '天然蛋白摄入系数', special_protein: '特殊蛋白摄入系数', total_protein: '总蛋白摄入系数', calorie: '热量摄入系数' }))
  register('metrics.' + field + '_coefficient', label, field === 'calorie' ? 'kcal/kg/d' : 'g/kg/d', ['intake'], ['metrics.series', 'metrics.aggregate', 'metrics.compare'], ['latest', 'mean_daily', 'min', 'max'], { field: field.replace(/_([a-z])/g, (_, x) => x.toUpperCase()) + 'Coefficient', precision: field === 'calorie' ? 1 : 2 });
const RESULT_STATES = ['ready', 'needs_clarification', 'no_match', 'no_records', 'missing_data', 'partial', 'unsupported', 'unavailable'];
const FEATURE_IDS = ['food', 'powder', 'recipe', 'medication', 'meal', 'milk', 'water', 'records', 'nutrition', 'goals', 'baby'];
function own(object, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key); }
module.exports = { PROTOCOL_VERSION, CAPABILITY_VERSION, BUILD_VERSION, CATALOG_DOMAINS, CAPABILITIES, MEASURES, RESULT_STATES, FEATURE_IDS, own };
