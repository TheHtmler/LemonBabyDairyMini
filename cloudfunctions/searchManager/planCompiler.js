'use strict';
const { validateIntentDraft, resolvePeriod, shiftDate, MEASURES, CAPABILITY_VERSION, searchText, fail } = require('./lib/search');
const { resolveEntities } = require('./entityResolver');
const { hash } = require('./access');

function applySelection(draft, selected, choice) {
  const next = { ...draft, status: 'ready', unresolved: draft.unresolved.filter(x => x !== choice.slot) };
  const state = { ...selected };
  if (choice.slot === 'entity') { state.entityId = choice.value.id; if (!next.entityMentions.length) next.entityMentions = [choice.value.name]; }
  if (choice.slot === 'subjectMode') {
    next.subjectMode = choice.value;
    if (choice.value === 'observed') { next.operation = 'records.aggregate'; next.measure = 'records.count'; next.measures = ['records.count']; next.aggregation = 'count'; }
    else { next.operation = 'catalog.read'; next.measure = 'medication.frequency'; next.measures = [next.measure]; next.periods = []; }
  }
  if (choice.slot === 'period') next.periods = Array.isArray(choice.value) ? choice.value : [choice.value];
  if (choice.slot === 'aggregation') next.aggregation = choice.value;
  if (choice.slot === 'powderBasis') { next.powderBasis = choice.value; next.basisUnit = choice.value === 'prepared' ? 'ml' : 'g'; }
  if (choice.slot === 'threshold') {
    const field = next.measure && next.measure.startsWith('nutrition.') ? next.measure : 'nutrition.protein';
    next.operation = 'catalog.search'; next.filters = [{ field, operator: 'lt', value: choice.value, unit: MEASURES[field].unit, basisQuantity: 100, basisUnit: 'g' }]; next.measure = null; next.measures = [];
  }
  if (choice.slot === 'excludedIngredientScope') {
    if (choice.value === 'dairy') return { draft: { ...next, status: 'unsupported', reasonCode: 'ingredient_group_unavailable' }, selected: state };
    next.filters = next.filters.filter(x => !(x.field === 'recipe.ingredients' && x.entityMention === '奶'));
    next.filters.push(...['牛奶', '奶粉'].map(entityMention => ({ field: 'recipe.ingredients', operator: 'excludes', entityMention })));
  }
  return { draft: validateIntentDraft(next), selected: state };
}
async function compilePlan({ draft: input, reader, contexts, selected = {}, now }) {
  const draft = validateIntentDraft(input);
  const ask = (slot, message, options, input) => ({ draft, selected, question: contexts.challenge(slot, message, options, input) });
  if (draft.status === 'unsupported') return { draft, selected, terminal: { status: 'unsupported', reasonCode: draft.reasonCode || 'unsupported_scope', message: draft.reasonCode === 'ingredient_group_unavailable' ? '现有配料数据不足以确认所有乳制品，可选择明确的配料排除' : '这类问题暂时没有可执行的查询，可以拆成明确的对象、日期和指标' } };
  if (draft.operation === 'feature.open') {
    if (!draft.featureId) return { draft, selected, terminal: { status: 'unsupported', message: '暂时没找到这个功能入口' } };
  }
  let periods = draft.periods;
  const isCatalog = draft.operation.startsWith('catalog');
  const isMetric = draft.operation.startsWith('metrics');
  // 编译器独立校验执行能力，模型和手动筛选走同一条约束。
  if (draft.filters.some(x => x.field === 'recipe.ingredients' ? !(draft.domain === 'recipe' && draft.operation === 'catalog.search') : !(isCatalog && ['food', 'powder', 'catalog', 'recipe'].includes(draft.domain) || draft.operation === 'records.list' && draft.domain === 'diet')) ||
      !isCatalog && draft.source !== 'all' || isCatalog && draft.periods.length || draft.operation !== 'metrics.compare' && draft.periods.length > 1 ||
      draft.operation === 'metrics.series' && draft.aggregation && draft.aggregation !== 'latest' ||
      draft.groupBy === 'day' && draft.operation !== 'records.aggregate' || draft.groupBy === 'entity' && isMetric ||
      draft.operation === 'metrics.aggregate' && !['mean_daily', 'min', 'max', null].includes(draft.aggregation))
    return { draft, selected, terminal: { status: 'unsupported', message: '当前查询不能完整执行这些条件，请调整范围或统计方式' } };
  if (!periods.length && !isCatalog && draft.operation !== 'feature.open' && !draft.unresolved.includes('period')) {
    periods = draft.aggregation === 'latest' || draft.operation === 'metrics.series' ? [{ kind: 'all' }] : [{ kind: 'last_n_days', days: 30 }];
  }
  const effective = periods.map(period => resolvePeriod(period, now));
  const resolverPeriod = effective[0] || { startDate: null, endDateExclusive: null };
  let entities = await resolveEntities(reader, draft, effective.length > 1 ? effective : resolverPeriod);
  if (selected.entityId) {
    const chosen = entities.items.find(item => item.id === selected.entityId);
    if (!chosen) return { draft, selected, terminal: { status: 'no_match', message: '刚才选择的资料已变化，请重新选择对象' } };
    entities = { ...entities, items: [chosen], candidates: entities.candidates, match: 'selected' };
  }
  const needsName = draft.operation === 'catalog.read';
  if (needsName && !draft.entityMentions.length || draft.unresolved.includes('entity')) {
    const candidates = await reader.catalogItems(draft.domain === 'medication' ? 'medication' : draft.domain, '', draft.source);
    if (!candidates.length) return { draft, selected, terminal: { status: 'no_match', message: '还没有可选择的资料，请先添加后再查属性' } };
    return ask('entity', draft.domain === 'medication' ? '你想查哪一种药物？' : '你想查哪一项资料？', candidates.slice(0, 12).map(x => ({ label: x.name, value: { id: x.id, name: x.name } })));
  }
  if (draft.entityMentions.length && entities.match === 'not_found') return { draft, selected, terminal: { status: 'no_match', message: '没找到这个名称，可以换一个名称或在资料中补充别名' } };
  if (entities.items.length > 1 && !isCatalog && draft.groupBy !== 'entity') return ask('entity', '你指哪一种？', entities.items.slice(0, 12).map(x => ({ label: x.name + (entities.items.some(y => y.id !== x.id && y.name === x.name) ? x.historical ? '（历史）' : '（当前）' : ''), value: { id: x.id, name: x.name } })));
  if (draft.unresolved.includes('subjectMode')) return ask('subjectMode', '你想看已设置频率，还是实际服用记录？', [{ label: '已设置频率', value: 'configured' }, { label: '实际服用记录', value: 'observed' }]);
  if (draft.unresolved.includes('period') || draft.operation === 'metrics.compare' && effective.length !== 2) return ask('period', draft.operation === 'metrics.compare' ? '想比较哪两段时间？' : '想查看哪段时间？', draft.operation === 'metrics.compare' ? [
    { label: '本周与上周', value: [{ kind: 'current_calendar_week' }, { kind: 'previous_calendar_week' }] },
    { label: '近 7 天与之前 7 天', value: [{ kind: 'last_n_days', days: 7 }, { kind: 'range', startDate: shiftDate(resolvePeriod({ kind: 'last_n_days', days: 7 }, now).startDate, -7), endDateExclusive: resolvePeriod({ kind: 'last_n_days', days: 7 }, now).startDate }] }
  ] : [{ label: '近 7 天', value: { kind: 'last_n_days', days: 7 } }, { label: '近 30 天', value: { kind: 'last_n_days', days: 30 } }, { label: '全部历史', value: { kind: 'all' } }]);
  if (draft.unresolved.includes('aggregation') || draft.operation === 'metrics.compare' && !draft.aggregation) {
    const coefficient = (draft.measure || '').startsWith('metrics.'); const count = draft.measure === 'records.count';
    return ask('aggregation', '比较日均还是总量？', count ? [{ label: '记录次数', value: 'count' }] : coefficient ? [{ label: '日均系数', value: 'mean_daily' }] : [{ label: '日均', value: 'mean_daily' }, { label: '总量', value: 'sum' }]);
  }
  if (draft.unresolved.includes('threshold')) return ask('threshold', '每 100 克的' + (MEASURES[draft.measure] || { label: '蛋白质' }).label + '低于多少？', [], { type: 'number', label: '请输入数值', unit: (MEASURES[draft.measure] || { unit: 'g' }).unit });
  if (draft.filters.some(x => x.field === 'recipe.ingredients' && x.entityMention === '奶') || draft.unresolved.includes('excludedIngredientScope')) return ask('excludedIngredientScope', '你想排除哪些配料？', [{ label: '牛奶和奶粉', value: 'milk_and_powder' }, { label: '所有乳制品', value: 'dairy' }]);
  if (draft.domain === 'powder' && (draft.measures.some(x => x.startsWith('nutrition.')) || draft.filters.length) && !draft.powderBasis) return ask('powderBasis', '按干粉还是冲调液？', [{ label: '干粉', value: 'dry' }, { label: '冲调液', value: 'prepared' }]);
  if (draft.operation === 'catalog.read' && !draft.measures.length || ['records.aggregate', 'metrics.aggregate', 'metrics.compare', 'metrics.series'].includes(draft.operation) && !draft.measure)
    return { draft, selected, terminal: { status: 'unsupported', message: '这句话缺少可查询的属性或指标，请说明想看频率、用量、次数还是摄入系数' } };
  if (effective.some(p => p.startDate && p.endDateExclusive && ['records.aggregate', 'metrics.aggregate', 'metrics.compare'].includes(draft.operation) && (Date.parse(p.endDateExclusive) - Date.parse(p.startDate)) / 86400000 > 90)) fail('QUERY_BUDGET', '一次统计最多 90 天，请缩短日期范围');
  if (effective.some(p => !p.startDate) && ['records.aggregate', 'metrics.aggregate', 'metrics.compare'].includes(draft.operation)) fail('QUERY_BUDGET', '合计统计需要明确日期，一次最多 90 天；可改为近 7 天或近 30 天');
  const normalized = { ...draft, status: 'ready', periods, unresolved: [] };
  const plan = { ...normalized, capabilityVersion: CAPABILITY_VERSION, entityIds: entities.items.map(x => x.id), entities: entities.items, effectivePeriods: effective, entityMatch: entities.match,
    aggregation: draft.aggregation || (draft.operation === 'metrics.aggregate' ? 'mean_daily' : draft.operation === 'metrics.series' && !draft.periods.length ? 'latest' : draft.measure === 'records.count' ? 'count' : draft.operation === 'records.aggregate' ? 'sum' : null) };
  plan.id = hash([plan.operation, plan.domain, plan.measure, plan.measures, plan.entityIds, periods, plan.filters, plan.source, plan.powderBasis, plan.aggregation, plan.groupBy, plan.basisQuantity, plan.basisUnit, plan.subjectMode]);
  return { draft: normalized, plan, selected, candidates: entities.candidates };
}
module.exports = { compilePlan, applySelection };
