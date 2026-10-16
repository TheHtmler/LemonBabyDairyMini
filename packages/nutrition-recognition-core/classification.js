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

function normalizeClassification(raw, food, catalog, { allowSpecial = true } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const requested = categoryText(raw.category); const matched = matchCategory(requested, catalog);
  // 完整本地标识可直接匹配；未知的新分类名称超限时不静默截断。
  const category = matched ? matched.value : requested.length <= 60 ? normalizeCategoryName(requested) : '';
  let proteinSource = null; let proteinQuality = null;
  if (raw.proteinSource === 'natural' && ['premium', 'regular'].includes(raw.proteinQuality)) {
    proteinSource = 'natural'; proteinQuality = raw.proteinQuality;
  } else if (allowSpecial && raw.proteinSource === 'special') {
    proteinSource = 'special'; proteinQuality = '';
  }
  if (!category && !proteinSource) return null;
  return { category: matched ? matched.value : category, categoryMatched: !!matched,
    proteinSource, proteinQuality, identity: identity(food), source: 'model_suggestion' };
}

module.exports = { normalizeCategoryCatalog, normalizeCategoryName, matchCategory, recommendCategories, classificationIdentityKey, normalizeClassification };
