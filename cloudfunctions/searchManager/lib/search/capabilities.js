'use strict';

const PROTOCOL_VERSION = 2;
const CAPABILITY_VERSION = 'search-2.2.0';
const BUILD_VERSION = '20261031-search-scan-ai-fixes';
const DOMAIN_DESCRIPTIONS = {
  catalog: '具体名称没有明确查询方向时，综合查找相关资料和最近记录；类别名不属于具体对象名称。',
  food: '系统或宝宝私有的食物资料与营养属性，不是实际饮食记录。',
  powder: '系统或宝宝私有的奶粉资料与营养属性，区分干粉和冲调液。',
  recipe: '宝宝创建的食谱和配料，没有官方系统食谱。',
  medication: '药物已保存属性或实际服用记录，由操作区分配置与实际事件。',
  diet: '宝宝实际饮食，记录明细按餐次展示；可以匹配餐内食物。',
  milk: '实际喂奶记录及奶量，记录奶量与成品实际入口体积是不同指标。',
  water: '实际饮水记录及饮水量。',
  growth: '真实体重、身高、头围测量；自动沿用历史数值不是新测量。',
  sleep: '实际睡眠记录与时长，未结束记录不能当完整睡眠。',
  bowel: '实际尿布记录及排便排尿次数，不提供尿液体积。',
  intake: '按日汇总的整体营养摄入和按体重计算的摄入系数，不支持按食物名称筛整日统计。',
  feature: '功能导航，不查询或计算记录。'
};
const CATALOG_DOMAINS = ['food', 'powder', 'recipe', 'medication'];
const BROWSE_GROUPS = [
  { id: 'food', label: '食物资料', domain: 'food', operation: 'catalog.search' },
  { id: 'powder', label: '奶粉资料', domain: 'powder', operation: 'catalog.search' },
  { id: 'recipe', label: '相关食谱', domain: 'recipe', operation: 'catalog.search' },
  { id: 'medication', label: '药物资料', domain: 'medication', operation: 'catalog.search' },
  { id: 'diet-records', label: '最近饮食记录', domain: 'diet', operation: 'records.list' },
  { id: 'milk-records', label: '最近喂奶记录', domain: 'milk', operation: 'records.list' },
  { id: 'medication-records', label: '最近服药记录', domain: 'medication', operation: 'records.list' }
];
const CAPABILITIES = {
  'catalog.browse': { label: '综合查找资料与最近记录', domains: ['catalog'], result: 'list' },
  'catalog.search': { label: '查找资料', domains: ['catalog', ...CATALOG_DOMAINS], result: 'list' },
  'catalog.read': { label: '读取资料属性', domains: CATALOG_DOMAINS, result: 'list' },
  'records.list': { label: '查看记录', domains: ['diet', 'milk', 'medication', 'water', 'growth', 'sleep', 'bowel'], result: 'list' },
  'records.aggregate': { label: '统计记录', domains: ['diet', 'milk', 'medication', 'water', 'intake', 'sleep', 'bowel'], result: 'scalar' },
  'metrics.series': { label: '查看指标变化', domains: ['intake', 'diet', 'milk', 'water', 'medication', 'growth', 'sleep', 'bowel'], result: 'series' },
  'metrics.aggregate': { label: '统计指标', domains: ['intake', 'growth', 'sleep', 'bowel'], result: 'scalar' },
  'metrics.compare': { label: '比较两段时间', domains: ['intake', 'medication', 'milk', 'water', 'diet', 'growth', 'sleep', 'bowel'], result: 'comparison' },
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
register('records.count', '已记录次数', '次', ['medication', 'diet', 'milk', 'water', 'sleep', 'bowel'], ['records.aggregate', 'metrics.series', 'metrics.aggregate', 'metrics.compare'], ['count', 'mean_daily', 'latest']);
register('medication.amount', '已记录服用量', '', ['medication'], ['records.aggregate', 'metrics.series', 'metrics.compare'], ['sum', 'mean_daily']);
register('milk.recorded_volume', '已记录奶量', 'ml', ['milk'], ['records.aggregate', 'metrics.series', 'metrics.compare'], ['sum', 'mean_daily'], { description: '沿用当日统计口径；未明确强调成品实际入口体积时使用，不等同于成品实际喝入量。' });
register('milk.consumed_volume', '实际成品奶量', 'ml', ['milk'], ['records.aggregate', 'metrics.series', 'metrics.compare'], ['sum', 'mean_daily'], { description: '仅在明确查询实际成品入口体积时使用，依赖成品体积和剩奶等记录，不能由配奶水量代替。' });
register('milk.components', '本次使用的奶粉', '', ['milk'], ['records.list'], []);
register('water.volume', '已记录饮水量', 'ml', ['water'], ['records.aggregate', 'metrics.series', 'metrics.compare'], ['sum', 'mean_daily']);
for (const [field, label, unit] of [['weight', '体重', 'kg'], ['height', '身高', 'cm'], ['head_circumference', '头围', 'cm']])
  register('growth.' + field, label, unit, ['growth'], ['records.list', 'metrics.series', 'metrics.aggregate', 'metrics.compare'], ['latest', 'mean_daily', 'min', 'max', 'change'], { field: field === 'head_circumference' ? 'headCircumference' : field });
register('sleep.duration', '已记录睡眠时长', '分钟', ['sleep'], ['records.aggregate', 'metrics.series', 'metrics.aggregate', 'metrics.compare'], ['sum', 'mean_daily', 'min', 'max', 'latest']);
for (const [field, label] of Object.entries({ natural_protein: '天然蛋白摄入', special_protein: '特殊蛋白摄入', protein: '总蛋白摄入', calories: '热量摄入', fat: '脂肪摄入', carbs: '碳水摄入' }))
  register('intake.' + field, label, field === 'calories' ? 'kcal' : 'g', ['intake', 'diet'], ['records.aggregate', 'metrics.series', 'metrics.compare'], ['sum', 'mean_daily'], { field: field.replace(/_([a-z])/g, (_, x) => x.toUpperCase()) });
for (const [field, label] of Object.entries({ natural_protein: '天然蛋白摄入系数', special_protein: '特殊蛋白摄入系数', total_protein: '总蛋白摄入系数', calorie: '热量摄入系数' }))
  register('metrics.' + field + '_coefficient', label, field === 'calorie' ? 'kcal/kg/d' : 'g/kg/d', ['intake'], ['metrics.series', 'metrics.aggregate', 'metrics.compare'], ['latest', 'mean_daily', 'min', 'max'], { field: field.replace(/_([a-z])/g, (_, x) => x.toUpperCase()) + 'Coefficient', precision: field === 'calorie' ? 1 : 2 });
const RESULT_STATES = ['ready', 'needs_clarification', 'no_match', 'no_records', 'missing_data', 'partial', 'unsupported', 'unavailable'];
const FEATURE_IDS = ['food', 'powder', 'recipe', 'medication', 'meal', 'milk', 'water', 'records', 'nutrition', 'goals', 'baby'];
function own(object, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key); }
module.exports = { PROTOCOL_VERSION, CAPABILITY_VERSION, BUILD_VERSION, DOMAIN_DESCRIPTIONS, CATALOG_DOMAINS, BROWSE_GROUPS, CAPABILITIES, MEASURES, RESULT_STATES, FEATURE_IDS, own };
