'use strict';
const { MEASURES, compareNutrient, matchCandidate, rankCatalogCandidate, configuredFrequency, searchText } = require('./lib/search');
const { publicCandidate } = require('./queryService');
const { identityRank } = require('./entityResolver');

function answer(item, measure, plan) {
  const meta = MEASURES[measure]; let value = ''; let note = '';
  if (measure === 'medication.frequency') value = configuredFrequency(item);
  else if (measure === 'medication.dosage') value = item.dosage ? item.dosage + ' ' + item.unit : '';
  else if (measure === 'medication.concentration') value = item.concentration ? item.concentration + ' ' + item.concentrationUnit + (item.volumeUnit ? '/' + item.volumeUnit : '') : '';
  else if (measure === 'medication.notes') value = item.notes || '';
  else if (measure === 'recipe.ingredients') value = (item.ingredients || []).filter(Boolean).join('、');
  else if (measure.startsWith('nutrition.')) {
    const compared = compareNutrient(item, { field: meta.field, operator: 'gte', value: 0, basisQuantity: plan.basisQuantity, basisUnit: plan.basisUnit }, plan.powderBasis);
    if (compared.value !== undefined && compared.state !== 'unknown') value = Math.round(compared.value * 1000) / 1000 + ' ' + meta.unit;
    note = value ? '每 ' + plan.basisQuantity + ' ' + ({ g: '克', ml: '毫升', portion: '份' }[plan.basisUnit]) + (item.type === 'powder' ? plan.powderBasis === 'prepared' ? '冲调液' : '干粉' : '') : '缺少所选基准的营养数据';
  }
  return { field: measure, label: meta.label, value: value || '未填写', displayValue: value || '未填写', known: !!value, unit: '', note };
}
async function queryCatalog({ reader, plan, offset = 0, pageSize = 20 }) {
  const keyword = plan.entityMentions[0] || '';
  let items = plan.entities.length ? plan.entities : await reader.catalogItems(plan.domain, keyword, plan.source);
  const conditions = plan.filters.filter(x => x.field !== 'recipe.ingredients').map(x => ({ ...x, field: x.field.replace(/^nutrition\./, '') }));
  const exclusions = plan.filters.filter(x => x.field === 'recipe.ingredients');
  const resolvedExclusions = [];
  const excludePowder = exclusions.some(x => x.entityMention === '奶粉');
  const ingredientCatalog = excludePowder ? await reader.catalogItems('catalog', '', 'all') : [];
  for (const filter of exclusions) {
    const candidates = filter.entityMention === '奶粉' ? ingredientCatalog.filter(x => x.type === 'powder' || /奶粉|乳粉/.test(x.categoryPath + x.name)) : (await reader.catalogItems('catalog', filter.entityMention, 'all')).filter(x => identityRank(x, filter.entityMention) >= 0 && (identityRank(x, filter.entityMention) < 2 || filter.entityMention === '牛奶'));
    resolvedExclusions.push({ mention: searchText(filter.entityMention), ids: new Set(candidates.map(x => x.locator && x.locator.memberId || x.sourceId)), names: new Set([searchText(filter.entityMention), ...candidates.flatMap(x => [x.name, ...(x.aliases || [])]).map(searchText)]) });
  }
  if (plan.domain === 'recipe' && conditions.length) return { status: 'unsupported', message: '食谱暂不支持严格的每 100 克营养筛选，可查名称和完整配料', result: { kind: 'list', items: [] } };
  let unknown = 0;
  items = items.filter(item => {
    if (plan.entities.length && !plan.entities.some(x => x.id === item.id)) return false;
    if (keyword && !plan.entities.length && rankCatalogCandidate(item, keyword) < 0) return false;
    if (exclusions.length) {
      if (item.type !== 'recipe') return false;
      if (!item.ingredientsComplete) { unknown++; return false; }
      if (excludePowder && item.ingredientEntities.some(x => !x.category && !ingredientCatalog.some(known => known.sourceId === x.id || known.locator && known.locator.memberId === x.id))) { unknown++; return false; }
      if (excludePowder && item.ingredientEntities.some(x => /奶粉|乳粉/.test(x.category))) return false;
      if (resolvedExclusions.some(filter => item.ingredientEntities.some(x => filter.ids.has(x.id) || filter.names.has(searchText(x.name))))) return false;
    }
    if (conditions.length) {
      const matched = matchCandidate(item, { intent: 'search_catalog', scope: [item.type], keyword: '', source: plan.source, conditions, powderBasis: plan.powderBasis });
      if (matched.state === 'unknown') unknown++;
      return matched.state === 'matched';
    }
    return true;
  }).sort((a, b) => rankCatalogCandidate(a, keyword) - rankCatalogCandidate(b, keyword) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const total = items.length;
  const page = items.slice(offset, offset + pageSize).map(item => ({ ...publicCandidate(item), ...(plan.operation === 'catalog.read' ? { answers: plan.measures.map(measure => answer(item, measure, plan)) } : {}) }));
  const missing = plan.operation === 'catalog.read' && page.length && page.every(item => item.answers.every(value => !value.known));
  return { status: missing || !total && unknown ? 'missing_data' : total ? 'ready' : 'no_match',
    message: missing ? '这项资料还没有填写所问内容' : !total && unknown ? '缺少可验证的营养或完整配料，无法确认是否满足条件' : !total ? '没有找到符合条件的资料' : '',
    result: { kind: 'list', items: page, total, nextOffset: offset + page.length < total ? offset + page.length : null,
      note: unknown ? unknown + ' 项缺少可比较依据，未纳入结果' : '' } };
}
module.exports = { queryCatalog };
