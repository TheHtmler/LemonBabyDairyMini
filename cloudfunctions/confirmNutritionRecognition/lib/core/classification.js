'use strict';

const { identity } = require('./contracts');
const CATEGORY_ALIASES = [
  ['蔬菜类', '蔬菜', 'vegetables'], ['水果类', '水果', 'fruits'],
  ['肉禽类', '肉禽', '肉类', '禽肉'], ['水产类', '水产', '海鲜', '鱼虾类'],
  ['乳类及制品', '奶类', '乳制品', '奶制品', 'milk'], ['蛋类', '蛋'],
  ['豆制品', '豆类及制品'], ['主食及谷薯', '谷薯类', '谷物类', '主食', 'food'],
  ['婴幼儿辅食', '辅食']
];
const CATEGORY_FAMILIES = [
  { name: '主食及谷薯', category: /主食|谷物|谷薯|薯类|淀粉|粮食|米面|面食|cereal|starch/i,
    local: /主食|谷物|谷薯|谷类|薯类|粮食|米面/, food: /米饭|大米|小米|燕麦|玉米|面条|馒头|米粥|面包/ },
  { name: '蔬菜类', category: /蔬菜|绿叶|根茎|瓜菜|vegetable/i, local: /蔬菜|绿叶|根茎/,
    food: /上海青|小白菜|菠菜|西兰花|花椰菜|胡萝卜|白萝卜|南瓜|黄瓜|冬瓜|番茄|西红柿|芹菜|生菜|油麦菜/ },
  { name: '水果类', category: /水果|鲜果|果品|fruit/i, local: /水果|鲜果|果品/,
    food: /苹果|香蕉|橙子|橘子|草莓|蓝莓|葡萄|猕猴桃|火龙果|西瓜|芒果/ },
  { name: '肉禽类', category: /肉类|肉禽|畜肉|禽肉|meat|poultry/i, local: /肉禽|肉类|禽肉|畜肉/,
    food: /鸡肉|鸭肉|牛肉|羊肉|猪肉|瘦肉|鸡胸/ },
  { name: '水产类', category: /水产|鱼虾|海鲜|鱼类|seafood|fish/i, local: /水产|鱼虾|海鲜|鱼类/,
    food: /鲈鱼|鳕鱼|三文鱼|鲫鱼|鲤鱼|虾仁|鲜虾/ },
  { name: '乳类及制品', category: /乳类|奶类|乳制品|奶制品|dairy/i, local: /乳类|奶类|乳制品|奶制品/,
    food: /牛奶|酸奶|奶酪|芝士/ },
  { name: '蛋类', category: /蛋类|禽蛋|egg/i, local: /蛋类|禽蛋/, food: /鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋/ },
  { name: '豆制品', category: /豆类|豆制品|豆及|soy|legume/i, local: /豆类|豆制品|豆及/,
    food: /豆腐|豆干|豆浆|黄豆|毛豆|腐竹/ },
  { name: '零食', category: /零食|膨化|饼干|snack/i, local: /零食|膨化|饼干/, food: /薯片|饼干|膨化/ },
  { name: '饮品', category: /饮品|饮料|beverage|drink/i, local: /饮品|饮料/, food: /果汁|汽水|饮料/ }
];
function categoryText(value) { return typeof value === 'string' ? value.trim() : ''; }
function key(value) { return categoryText(value).toLowerCase(); }

// 与原食物表单共用同一名称规则，避免弹窗创建名与最终保存名不同。
function normalizeCategoryName(value) {
  const name = categoryText(value); const lower = name.toLowerCase();
  if (lower === 'milk' || name === '奶类') return '乳类及制品';
  if (lower === 'food') return '主食及谷薯';
  return name === '辅食' ? '婴幼儿辅食' : name;
}

function normalizeCategoryCatalog(options) {
  const result = []; const seen = new Set();
  (Array.isArray(options) ? options : []).forEach(option => {
    const value = categoryText(typeof option === 'string' ? option : option && option.value);
    const label = categoryText(typeof option === 'string' ? option : option && option.label) || value;
    if (!value || seen.has(key(value))) return;
    seen.add(key(value)); result.push({ value, label });
  });
  return result;
}

function matchCategory(name, options) {
  const wanted = key(name); if (!wanted) return null;
  const catalog = normalizeCategoryCatalog(options);
  const exact = catalog.filter(item => [key(item.value), key(item.label)].includes(wanted));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const aliases = CATEGORY_ALIASES.find(group => group.map(key).includes(wanted));
  if (!aliases) return null;
  const keys = aliases.map(key);
  const matched = catalog.filter(item => keys.includes(key(item.value)) || keys.includes(key(item.label)));
  return matched.length === 1 ? matched[0] : null;
}

function recommendCategories(name, food, options) {
  const catalog = normalizeCategoryCatalog(options); const wanted = key(name);
  const exact = wanted ? catalog.filter(item => [key(item.value), key(item.label)].includes(wanted)) : [];
  if (exact.length) return exact.map(item => ({ ...item, score: 120, kind: 'exact', reason: '本地分类' }));
  const alias = matchCategory(name, catalog);
  if (alias) return [{ ...alias, score: 115, kind: 'alias', reason: '已匹配本地分类' }];
  const foodName = identity(food || {}).name;
  // 完整薯类可归入主食或蔬菜；淀粉、粉制品、薯片等不能套用鲜食蔬菜规则。
  const wholeRoot = /山药|淮山|土豆|马铃薯|红薯|甘薯|番薯|紫薯|芋头/.test(foodName) &&
    !/粉|淀粉|薯片|糕|饼|干|酥|膨化|零食/.test(foodName);
  const candidates = new Map();
  CATEGORY_FAMILIES.forEach(family => {
    const byCategory = family.category.test(wanted); const byFood = family.food.test(foodName);
    const rootScore = wholeRoot ? family.name === '主食及谷薯' ? 100 : family.name === '蔬菜类' ? 85 : 0 : 0;
    if (!byCategory && !byFood && !rootScore) return;
    catalog.forEach(item => {
      if (!family.local.test(item.label + ' ' + item.value)) return;
      const score = Math.max(byCategory ? 90 : 0, byFood ? 96 : 0, rootScore) +
        ([item.label, item.value].includes(family.name) ? 4 : 0);
      const previous = candidates.get(item.value);
      if (!previous || score > previous.score) candidates.set(item.value,
        { ...item, score, kind: 'semantic', reason: rootScore || byFood ? '按食材推荐' : '按分类语义推荐' });
    });
  });
  return [...candidates.values()].sort((left, right) => right.score - left.score).slice(0, 3);
}

function classificationIdentityKey(value) {
  const food = identity(value || {});
  return JSON.stringify([food.name.toLowerCase().replace(/\s+/g, ''), food.brand, food.series, food.stage, food.barcode]);
}

// 模型识别蛋白来源，程序统一映射分类；不维护具体食品名称名单，也不依赖用户的资料库分类。
const PROTEIN_GROUPS = {
  meat: { label: '畜禽肉类的肌肉蛋白', quality: 'premium' },
  seafood: { label: '鱼虾贝等水产蛋白', quality: 'premium' },
  egg: { label: '蛋及以蛋为蛋白来源的制品', quality: 'premium' },
  dairy: { label: '奶及以乳蛋白为来源的制品', quality: 'premium' },
  soy: { label: '大豆及以大豆蛋白为来源的制品', quality: 'premium' },
  grain_tuber: { label: '谷物与薯类', quality: 'regular' },
  other_legume: { label: '大豆以外的普通杂豆', quality: 'regular' },
  vegetable_fruit: { label: '蔬菜与水果', quality: 'regular' },
  nuts_seeds: { label: '坚果与种子', quality: 'regular' },
  collagen: { label: '皮筋、明胶及胶原蛋白', quality: 'regular' },
  mixed: { label: '主要蛋白来源不明确的混合食品', quality: null },
  unknown: { label: '无法确认蛋白来源', quality: null },
  special_formula: { label: '有明确产品依据的特殊营养配方', quality: null }
};

function hasProteinGroupSupport(proteinGroup, food, requested, observation) {
  if (['unknown', 'mixed'].includes(proteinGroup)) return true;
  const source = [identity(food).name, observation && observation.packageEvidence &&
    observation.packageEvidence.identity && observation.packageEvidence.identity.text].filter(Boolean).join(' ');
  const protein = observation && observation.nutrients && observation.nutrients.protein;
  const labelZero = !!(protein && protein.state === 'present' && protein.value === 0);
  // 商品口味不等于配料或主要蛋白来源，不能凭“牛奶味糖果”派生乳蛋白质量。
  if (/口味|风味|(?:奶|肉|蛋|豆|芝士|奶酪)味|flavou?r(?:ed)?/i.test(source)) return false;
  const soy = /大豆|黄豆|黑大豆|青大豆|毛豆|豆腐|豆干|豆浆|豆奶|腐竹|\bsoy(?:bean)?s?\b/i.test(source);
  const otherLegume = /红豆|赤小豆|绿豆|芸豆|豌豆|蚕豆|鹰嘴豆|扁豆|眉豆|豇豆|\b(?:adzuki|mung|kidney|pinto|navy)\s+beans?\b|\blentils?\b|\bchickpeas?\b|\bpeas?\b/i.test(source);
  // 标签零值可能取整；有明确来源名称时仍可保留，不能仅凭零值否定真实来源。
  if (proteinGroup === 'other_legume') return otherLegume && !soy;
  if (proteinGroup === 'soy') return soy && !otherLegume;
  if (proteinGroup === 'collagen') return /胶原|明胶|皮筋|肉皮|猪皮|牛筋|\bcollagen\b|\bgelatin\b/i.test(source);
  if (proteinGroup === 'special_formula') return /特殊医学用途|特殊营养|全营养配方|\bmedical\s+food\b|\bspecial\s+formula\b/i.test(source);
  const families = {
    meat: ['肉禽类'], seafood: ['水产类'], egg: ['蛋类'], dairy: ['乳类及制品'], soy: ['豆制品'],
    grain_tuber: ['主食及谷薯'], vegetable_fruit: ['蔬菜类', '水果类']
  };
  if (proteinGroup === 'nuts_seeds') return /坚果|种子|果仁|\bnuts?\b|\bseeds?\b/i.test(source) ||
    !labelZero && /坚果|种子|果仁|nut|seed/i.test(requested);
  const groupFamilies = families[proteinGroup] || [];
  const explicit = CATEGORY_FAMILIES.some(family => groupFamilies.includes(family.name) &&
    (family.food.test(source) || family.category.test(source)));
  if (explicit) return true;
  if (proteinGroup === 'grain_tuber' && /山药|淮山|土豆|马铃薯|红薯|甘薯|番薯|紫薯|芋头/.test(source)) return true;
  // 具体食材已支持另一类别时，模型自己的分类名称不能反过来充当来源证据。
  if (CATEGORY_FAMILIES.some(family => family.food.test(source))) return false;
  // 分类族只能辅助非零或未读到蛋白含量的食品；零蛋白且来源只靠模型猜测时不派生质量。
  return !labelZero && CATEGORY_FAMILIES.some(family => groupFamilies.includes(family.name) && family.category.test(requested));
}

function normalizeClassification(raw, food, catalog, { allowSpecial = true, observation = null, warnings = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const requested = categoryText(raw.category); const matched = matchCategory(requested, catalog);
  // 完整本地标识可直接匹配；未知的新分类名称超限时不静默截断。
  const category = matched ? matched.value : requested.length <= 60 ? normalizeCategoryName(requested) : '';
  let proteinGroup = typeof raw.proteinGroup === 'string' && Object.prototype.hasOwnProperty.call(PROTEIN_GROUPS, raw.proteinGroup) ?
    raw.proteinGroup : 'unknown';
  const classificationWarnings = [];
  if (!hasProteinGroupSupport(proteinGroup, food, requested, observation)) {
    proteinGroup = 'unknown';
    const message = '蛋白来源分类缺少与食品身份一致的依据，已保留为未知';
    classificationWarnings.push(message);
    if (Array.isArray(warnings) && !warnings.includes(message)) warnings.push(message);
  }
  const group = PROTEIN_GROUPS[proteinGroup];
  let proteinSource = null; let proteinQuality = null;
  if (group.quality) {
    proteinSource = 'natural'; proteinQuality = group.quality;
  } else if (allowSpecial && proteinGroup === 'special_formula') {
    proteinSource = 'special'; proteinQuality = '';
  }
  if (!category && !proteinSource) return null;
  return { category: matched ? matched.value : category, categoryMatched: !!matched,
    proteinGroup, proteinSource, proteinQuality, proteinQualitySource: 'source_group_rule',
    identity: identity(food), source: 'model_suggestion',
    ...(classificationWarnings.length ? { warnings: classificationWarnings } : {}) };
}

module.exports = { PROTEIN_GROUPS, normalizeCategoryCatalog, normalizeCategoryName, matchCategory, recommendCategories, classificationIdentityKey, normalizeClassification };
