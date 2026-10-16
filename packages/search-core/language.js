'use strict';
const { validateQueryPlan, FIELDS, UNITS } = require('./contracts');
const { ANSWER_FIELDS } = require('./answerFields');

function chineseNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000 };
  let result = 0; let digit = 0;
  for (const char of text) {
    if (digits[char] !== undefined) digit = digits[char];
    else if (units[char]) { result += (digit || 1) * units[char]; digit = 0; }
    else return NaN;
  }
  return result + digit;
}

function parsePeriodPhrase(text) {
  const relative = text.match(/(?:最近|近|过去)(?:的)?([0-9零一二两三四五六七八九十百千]+)(?:个)?(星期|礼拜|周|天|日|月)(?:以内|内|以来|期间)?/);
  if (relative) {
    const count = chineseNumber(relative[1]);
    const days = count * ({ 星期: 7, 礼拜: 7, 周: 7, 天: 1, 日: 1, 月: 30 }[relative[2]]);
    if (days >= 1 && days <= 36600) return { period: { kind: 'last_n_days', days }, rest: text.replace(relative[0], ''), label: '近 ' + days + ' 天' };
  }
  const named = text.match(/今天|今日|昨天|昨日|上一周|上个星期|上周|这个星期|本周|这周|本月|这个月|全部历史/);
  if (!named) return null;
  return { period: { kind: { 今天: 'today', 今日: 'today', 昨天: 'yesterday', 昨日: 'yesterday', 上一周: 'previous_calendar_week', 上个星期: 'previous_calendar_week', 上周: 'previous_calendar_week', 这个星期: 'current_calendar_week', 本周: 'current_calendar_week', 这周: 'current_calendar_week', 本月: 'current_month', 这个月: 'current_month', 全部历史: 'all' }[named[0]] }, rest: text.replace(named[0], ''), label: named[0] };
}

// 解析“对象 + 属性”的常见问法；复杂表述交给同一字段协议的模型解析。
function parseAttributeQuery(input, options = {}) {
  let text = String(input || '').normalize('NFKC').replace(/\s+/g, '');
  const original = text;
  if (!text || text.length > 300 || /[<>≤≥]|低于|高于|超过|以下|以上|系数|目标|应该|建议|适合|能不能|可不可以|安全|副作用|加量|减量|或者|还是|平均|总量/.test(text)) return null;
  const temporal = parsePeriodPhrase(text);
  if (temporal) text = temporal.rest;
  const powder = text.match(/干粉|冲调液|冲调后|冲泡后/);
  const powderBasis = powder ? powder[0] === '干粉' ? 'dry' : 'prepared' : null;
  if (powder) text = text.replace(powder[0], '');
  const aliases = Object.entries(ANSWER_FIELDS).flatMap(([field, config]) => config.aliases.map(alias => ({ field, alias })));
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  const fields = [];
  for (const { field, alias } of aliases) {
    if (!fields.includes(field) && text.includes(alias)) {
      fields.push(field); const index = text.lastIndexOf(alias); text = text.slice(0, index) + text.slice(index + alias.length);
    }
  }
  if (!fields.length) return null;
  // “低蛋白米”等产品名包含营养词，只有明确询问属性时才提取这些词。
  if (fields.some(field => FIELDS.includes(field)) && !/的|含量|多少|查询|查一下|看看|查看|[?？]/.test(original)) return null;
  const type = text.match(/食物|食品|奶粉|配方粉|食谱|菜谱|药物|药品/);
  const scope = type ? ({ 食物: 'food', 食品: 'food', 奶粉: 'powder', 配方粉: 'powder', 食谱: 'recipe', 菜谱: 'recipe', 药物: 'medication', 药品: 'medication' })[type[0]]
    : fields.every(field => ANSWER_FIELDS[field].scopes.includes('medication')) ? 'medication'
      : fields.includes('ingredients') ? 'recipe' : ['food', 'powder'].includes(options.tab) ? options.tab : 'food';
  if (type) text = text.replace(type[0], '');
  if (fields.some(field => !ANSWER_FIELDS[field].scopes.includes(scope))) return null;
  const source = /我的/.test(text) ? 'mine' : /系统/.test(text) ? 'system' : 'all';
  text = text.replace(/^(?:请问|麻烦|请)?(?:帮我)?(?:查询一下|查询|搜索|查一下|查查|查找|看看|查看|查|告诉我|想知道|我想知道)*/, '').replace(/我的|系统/g, '')
    .replace(/(?:含量|是多少|是什么|怎么样|如何|多少|是什么时候|什么时候|是几次|吗|呢|啊|呀|[?？。！!])+$/g, '')
    .replace(/^[的，,、和及]+|[的，,、和及]+$/g, '');
  if (!text || text.length > 100 || /怎么|如何|是否|为什么|哪个|哪些|每天|每周|最近|上周|吃了|吃过|服用|摄入|什么时候|多少|几次|几天|和|以及|并且/.test(text)) return null;
  let answerFields = [...new Set(fields)];
  if (scope === 'medication' && temporal && answerFields.includes('frequency')) answerFields = [...new Set([...answerFields, 'intakeCount'])];
  return validateQueryPlan({ schemaVersion: 1, status: 'ready', intent: 'search_catalog', scope: [scope], keyword: text, source,
    answerFields, powderBasis, period: temporal ? temporal.period : answerFields.includes('intakeCount') ? { kind: 'last_n_days', days: 30 } : { kind: 'all' } });
}

function needsSemanticSearch(text) {
  if (/请问|告诉我|想知道|多长时间|服一次|吃一次|[吗呢呀]$/.test(text)) return true;
  return /[<>≤≥?？]|的|吃过|喝过|吃了|喝了|服用|摄入|用药|服药|频率|频次|次数|剂量|用量|浓度|备注|配料|多久|几次|几天|怎么|如何|为什么|什么时候|昨天|今天|前天|明天|上周|本周|本月|上月|今年|去年|本年|上年|最近|过去|期间|之前|之后|低于|高于|不高于|不低于|大于|小于|超过|以下|以上|适合|或者|以及|含量|多少|哪些|每\s*\d|\d{4}[-/]\d{1,2}|近[一二三四五六七八九十百0-9]+|[一二三四五六七八九十百0-9]+[年月日天周]/.test(text);
}

const FIELD_NAMES = { 能量: 'calories', 热量: 'calories', 热卡: 'calories', 蛋白质: 'protein', 蛋白: 'protein', 脂肪: 'fat', 碳水化合物: 'carbs', 碳水: 'carbs', 膳食纤维: 'fiber', 纤维: 'fiber', 钠: 'sodium' };
const OPERATORS = { 不高于: 'lte', 不超过: 'lte', 小于等于: 'lte', 不低于: 'gte', 不少于: 'gte', 大于等于: 'gte', 低于: 'lt', 小于: 'lt', 少于: 'lt', 高于: 'gt', 大于: 'gt', 超过: 'gt', 等于: 'eq', '<=': 'lte', '≤': 'lte', '>=': 'gte', '≥': 'gte', '<': 'lt', '>': 'gt', '=': 'eq' };
const TYPE_NAMES = { 食物: 'food', 食材: 'food', 食品: 'food', 辅食: 'food', 奶粉: 'powder', 配方粉: 'powder', 食谱: 'recipe', 菜谱: 'recipe', 药物: 'medication', 药品: 'medication' };
const UNIT_NAMES = { 克: 'g', 毫克: 'mg', 千卡: 'kcal', 大卡: 'kcal', 千焦: 'kj', 毫升: 'ml', 份: 'portion' };
function unitName(value) { const text = String(value || '').toLowerCase(); return UNIT_NAMES[text] || text; }
function numericValue(value, unit, field) {
  const match = String(value).trim().match(/^(\d*\.?\d+)\s*(mg|g|kcal|kj|毫克|克|千卡|大卡|千焦)?$/i);
  if (!match) return null;
  const suffix = unitName(match[2]); const given = unitName(unit);
  if (suffix && given && suffix !== given) return null;
  const actual = suffix || given || UNITS[field];
  let number = Number(match[1]);
  if (actual === UNITS[field]) return { value: number, unit: UNITS[field] };
  if (field === 'calories' && actual === 'kj') number /= 4.184;
  else if (field === 'sodium' && actual === 'g') number *= 1000;
  else if (field !== 'calories' && field !== 'sodium' && actual === 'mg') number /= 1000;
  else return null;
  return { value: Math.round(number * 1e6) / 1e6, unit: UNITS[field] };
}

// 常见条件先按明确语法生成统一查询；不吞掉不认识的比较或逻辑。
function parseCatalogQuery(input, options = {}) {
  let text = String(input || '').normalize('NFKC').replace(/\s+/g, '');
  if (!text || text.length > 300) return null;
  const temporal = parsePeriodPhrase(text);
  if (temporal) text = temporal.rest;
  text = text.replace(/^(?:帮我|请|搜索|查找|找一下|找|查一下|查看|看看|哪些|有哪些)+/, '');
  const history = !!temporal || /吃过|喝过|吃了|喝了|饮食记录|饮食明细/.test(text) || options.tab === 'history';
  const consumed = /吃过|喝过/.test(text);
  const noun = text.match(/(食物|食材|食品|辅食|奶粉|配方粉|食谱|菜谱|药物|药品)$/);
  let scope = [noun ? TYPE_NAMES[noun[1]] : ['food', 'powder', 'recipe', 'medication'].includes(options.tab) ? options.tab : 'food'];
  if (noun) text = text.slice(0, noun.index);
  const intent = history ? consumed ? 'find_consumed_foods' : 'search_diet_records' : 'search_catalog';
  const source = /^(?:我的|我家)/.test(text) ? 'mine' : /^系统/.test(text) ? 'system' : 'all';
  text = text.replace(/^(?:我的|我家|系统)/, '');
  const leading = !noun && text.match(/^(食物|食材|食品|辅食|奶粉|配方粉|食谱|菜谱|药物|药品)(?:的)?(?=每|干粉|冲调|蛋白|脂肪|热量|热卡|能量|碳水|膳食纤维|纤维|钠)/);
  if (leading) { scope = [TYPE_NAMES[leading[1]]]; text = text.slice(leading[0].length); }
  const basisMatch = text.match(/(?:每|\/)(\d*\.?\d+)?(毫升|ml|克|g|份)/i);
  const basisQuantity = basisMatch ? Number(basisMatch[1] || 1) : 100;
  const basisUnit = basisMatch ? unitName(basisMatch[2]) : 'g';
  if (basisMatch) text = text.replace(basisMatch[0], '');
  const powder = text.match(/干粉|冲调液|冲调后|冲泡后/);
  const powderBasis = powder ? powder[0] === '干粉' ? 'dry' : 'prepared' : null;
  if (powder) text = text.replace(powder[0], '');
  const conditions = [];
  const expression = /(碳水化合物|膳食纤维|蛋白质|蛋白|热量|热卡|能量|脂肪|碳水|纤维|钠)(?:含量)?(不高于|不超过|小于等于|不低于|不少于|大于等于|低于|小于|少于|高于|大于|超过|等于|<=|>=|≤|≥|<|>|=)(\d*\.?\d+)([a-z]+|毫克|克|千卡|大卡|千焦)?/gi;
  let invalid = false;
  const addCondition = (whole, fieldName, operator, value, unit) => {
    const field = FIELD_NAMES[fieldName]; const number = numericValue(value, unit, field);
    if (!number) { invalid = true; return whole; }
    conditions.push({ field, operator: OPERATORS[operator], ...number, basisQuantity, basisUnit }); return '';
  };
  text = text.replace(expression, addCondition);
  text = text.replace(/(碳水化合物|膳食纤维|蛋白质|蛋白|热量|热卡|能量|脂肪|碳水|纤维|钠)(?:含量)?(\d*\.?\d+)([a-z]+|毫克|克|千卡|大卡|千焦)?(及以下|以下|以内|及以上|以上)/gi,
    (whole, fieldName, value, unit, direction) => addCondition(whole, fieldName, direction.includes('上') ? '>=' : '<=', value, unit));
  if (invalid || !conditions.length && !history && !noun || scope.includes('medication') && history) return null;
  if (history && !conditions.length && !noun && !leading && !['food', 'powder', 'recipe'].includes(options.tab)) scope = ['food', 'powder', 'recipe'];
  const raw = { schemaVersion: 1, status: 'ready', intent, scope, source, keyword: '', conditions, powderBasis,
    period: temporal ? temporal.period : history ? { kind: 'last_n_days', days: 30 } : { kind: 'all' } };
  if (/或者|或|任一/.test(text) || conditions.length > 6) return validateQueryPlan({ ...raw, conditions: conditions.slice(0, 6), status: 'unsupported', reasonCode: 'unsupported_logic', requiredFields: ['conditions'] });
  text = text.replace(/^(?:帮我|请|搜索|查找|找一下|找|查一下|查看|看看|哪些|有哪些)+/, '')
    .replace(/吃过|喝过|吃了|喝了|饮食记录|饮食明细/g, '').replace(/^[的，,、]+|[的，,、?？。]+$/g, '');
  if (history) text = text.replace(/^(?:吃|喝)(?:的)?/, '');
  if (/^(?:且|并且|同时|和|以及|的|，|,|、)*$/.test(text)) text = '';
  if (noun && /^(?:所有|全部)(?:的)?$/.test(text)) text = '';
  if (/[<>≤≥]|低于|高于|不超过|至少|最多|或者|每|怎么|如何|系数|平均|频率|频次|次数|用量|剂量|多久|几次|什么时候|多少|用药|服药/.test(text) || text.length > 100) return null;
  return validateQueryPlan({ ...raw, keyword: text });
}

// 模型输出只修正常见的数字/单位序列化差异，仍由严格协议做最终校验。
function normalizeModelPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return validateQueryPlan(input);
  const value = { ...input };
  if (value.schemaVersion === '1') value.schemaVersion = 1;
  if (typeof value.status === 'string') value.status = value.status.toLowerCase();
  if (typeof value.scope === 'string') value.scope = [value.scope];
  if (value.period && value.period.kind === 'last_n_days' && /^\d+$/.test(String(value.period.days))) value.period = { ...value.period, days: Number(value.period.days) };
  if (Array.isArray(value.conditions)) value.conditions = value.conditions.map(condition => {
    const field = FIELD_NAMES[condition.field] || condition.field;
    if (!FIELDS.includes(field)) return condition;
    const number = numericValue(condition.value, condition.unit, field);
    return { ...condition, field, ...(number || {}), basisUnit: unitName(condition.basisUnit),
      basisQuantity: /^\d*\.?\d+$/.test(String(condition.basisQuantity)) ? Number(condition.basisQuantity) : condition.basisQuantity };
  });
  return validateQueryPlan(value);
}
module.exports = { chineseNumber, parsePeriodPhrase, parseCatalogQuery, parseAttributeQuery, needsSemanticSearch, normalizeModelPlan };
