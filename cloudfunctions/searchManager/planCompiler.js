'use strict';
const { validateIntentDraft, resolvePeriod, shiftDate, MEASURES, CAPABILITY_VERSION, searchText, fail } = require('./lib/search');
const { resolveEntities } = require('./entityResolver');
const { hash } = require('./access');

function periodDefinitions(draft) {
  if (draft.periods.length) return draft.periods;
  if (draft.operation === 'catalog.browse') return [{ kind: 'last_n_days', days: 30 }];
  if (draft.operation.startsWith('catalog') || draft.operation === 'feature.open' || draft.unresolved.includes('period')) return [];
  return draft.aggregation === 'latest' || draft.operation === 'metrics.series' && draft.domain === 'intake' ? [{ kind: 'all' }] : [{ kind: 'last_n_days', days: 30 }];
}

// 模型纠错和实际执行共用能力约束，校验时不读取业务数据。
function executionIssue(draft, now = Date.now()) {
  if (draft.status === 'unsupported') return null;
  const catalog = draft.operation.startsWith('catalog'); const browse = draft.operation === 'catalog.browse';
  const metric = draft.operation.startsWith('metrics'); const care = ['sleep', 'bowel'].includes(draft.domain);
  const issue = (field, message) => ({ field, message });
  if (draft.filters.some(filter => filter.field.startsWith('bowel.') ? draft.domain !== 'bowel' : filter.field === 'recipe.ingredients' ?
    !(draft.domain === 'recipe' && draft.operation === 'catalog.search') : !(catalog && !browse && (draft.domain === 'catalog' || ((MEASURES[filter.field] || {}).domains || []).includes(draft.domain)) || draft.operation === 'records.list' && draft.domain === 'diet')))
    return issue('filters', '筛选字段必须属于当前领域和操作，不能把营养筛选用于成长或护理记录。');
  if (!catalog && draft.source !== 'all') return issue('source', 'system/mine 只限定资料库来源；宝宝记录使用 all，由服务器绑定当前宝宝。');
  if (catalog && !browse && draft.periods.length && !draft.unresolved.includes('queryDirection')) return issue('periods', '资料属性与资料筛选没有发生日期；有日期的实际记录需要相应的记录或指标操作。');
  if (draft.operation !== 'metrics.compare' && draft.periods.length > 1) return issue('periods', '只有两段时间比较操作支持两个日期范围。');
  if (draft.operation === 'metrics.series' && draft.aggregation && draft.aggregation !== 'latest') return issue('aggregation', '逐日趋势不接受整体合计或平均；整体统计使用注册的 aggregate 操作。');
  if (draft.groupBy === 'day' && draft.operation !== 'records.aggregate' || draft.groupBy === 'entity' && metric)
    return issue('groupBy', '按日的指标使用 metrics.series；groupBy=day 仅用于记录统计，指标操作不能按对象分组。');
  if (draft.operation === 'metrics.aggregate' && draft.domain === 'intake' && !['mean_daily', 'min', 'max', null].includes(draft.aggregation))
    return issue('aggregation', '摄入指标整体统计仅支持 mean_daily/min/max，不能对系数求和。');
  if ((care || draft.domain === 'growth') && (draft.entityMentions.length || draft.groupBy !== 'none' || draft.powderBasis))
    return issue('entityMentions/groupBy/powderBasis', '成长与护理指标不接受资料名称、对象分组或奶粉计量基准。');
  if (draft.domain === 'intake' && draft.entityMentions.length) return issue('entityMentions', '整日摄入指标尚不支持按具体食物名称筛选，不得悄悄删除原句的对象条件。');
  if (draft.operation === 'records.aggregate' && draft.aggregation === 'latest' && !care)
    return issue('operation/aggregation', '查询最近一条记录使用 records.list+latest，记录整体统计不能替代记录明细。');
  if (browse && (draft.entityMentions.length !== 1 || draft.filters.length || draft.measures.length || draft.aggregation || draft.powderBasis || draft.groupBy !== 'none'))
    return issue('operation', '综合名称查找仅支持一个名称；有属性、筛选或统计方向时必须选择对应的明确操作。');
  if (draft.operation === 'feature.open' && !draft.featureId) return issue('featureId', '打开功能需要已注册的 featureId。');
  if (draft.unresolved.includes('queryDirection') && (draft.operation !== 'catalog.read' || draft.domain !== 'food' || !['nutrition.protein', 'nutrition.calories', 'nutrition.fat', 'nutrition.carbs'].includes(draft.measure)))
    return issue('unresolved', 'queryDirection 仅用于无法判断食物资料营养与实际摄入的情况，其他信息缺失使用对应的待补槽位。');
  if (draft.operation === 'catalog.read' && !draft.measures.length || ['records.aggregate', 'metrics.aggregate', 'metrics.compare', 'metrics.series'].includes(draft.operation) && !draft.measure)
    return issue('measure', '属性读取和指标计算必须使用当前领域与操作注册的指标。');
  if (['records.aggregate', 'metrics.aggregate', 'metrics.compare'].includes(draft.operation)) {
    const periods = periodDefinitions(draft).map(period => resolvePeriod(period, now));
    if (periods.some(period => !period.startDate)) return issue('periods', '整体统计需要明确有限日期；最近一条记录应使用 records.list 或 metrics.series 的 latest，不应计算全部历史统计。');
    if (periods.some(period => (Date.parse(period.endDateExclusive) - Date.parse(period.startDate)) / 86400000 > 90))
      return issue('periods', '一次整体统计最多90天；不得擅自缩短原问句的日期范围。');
  }
  return null;
}

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
  if (choice.slot === 'queryDirection') {
    if (choice.value === 'observed') {
      if (next.measures.length !== 1) fail('UNSUPPORTED_LOGIC', '实际摄入目前一次只能统计一个指标，请把多个指标分开查询');
      const field = String(next.measure || '').replace(/^nutrition\./, '');
      if (!['protein', 'calories', 'fat', 'carbs'].includes(field) || next.domain !== 'food') fail('UNSUPPORTED_LOGIC', '这项属性暂不支持按单个资料统计实际摄入，请查询对应记录');
      next.domain = 'diet'; next.operation = 'records.aggregate';
      next.measure = 'intake.' + field; next.measures = [next.measure]; next.subjectMode = 'observed'; next.source = 'all';
      next.aggregation = 'sum'; next.powderBasis = null;
    } else if (choice.value === 'configured') { next.operation = 'catalog.read'; next.subjectMode = 'configured'; next.periods = []; }
    else fail('INVALID_QUERY', '查询方向无效');
  }
  if (choice.slot === 'powderBasis') {
    next.powderBasis = choice.value; next.basisUnit = choice.value === 'prepared' ? 'ml' : 'g';
  }
  if (choice.slot === 'threshold') {
    if (!draft.threshold) fail('INVALID_CONTEXT', '待补条件已失效，请重新输入完整查询');
    // 只补缺失数值，不改比较方向、计量基准或已确定的其他筛选。
    next.filters = [...draft.filters, { ...draft.threshold, value: choice.value }];
    delete next.threshold;
    next.measure = null; next.measures = [];
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
  const periods = periodDefinitions(draft);
  const isCatalog = draft.operation.startsWith('catalog');
  const isCare = ['sleep', 'bowel'].includes(draft.domain);
  const isGrowth = draft.domain === 'growth';
  const isBrowse = draft.operation === 'catalog.browse';
  if (executionIssue(draft, now))
    return { draft, selected, terminal: { status: 'unsupported', message: '当前查询不能完整执行这些条件，请调整范围或统计方式' } };
  const effective = periods.map(period => resolvePeriod(period, now));
  const resolverPeriod = effective[0] || { startDate: null, endDateExclusive: null };
  if (draft.unresolved.includes('queryDirection')) {
    return ask('queryDirection', '想查资料中的营养含量，还是已记录的实际摄入？', [{ label: '资料中的营养含量', value: 'configured' }, { label: '已记录的实际摄入', value: 'observed' }]);
  }
  let entities = isBrowse || isCare || isGrowth ? { items: [], candidates: [], match: 'none' } : await resolveEntities(reader, draft, effective.length > 1 ? effective : resolverPeriod);
  if (selected.entityId) {
    const chosen = entities.items.find(item => item.id === selected.entityId);
    if (!chosen) return { draft, selected, terminal: { status: 'no_match', message: '刚才选择的资料已变化，请重新选择对象' } };
    entities = { ...entities, items: [chosen], candidates: entities.candidates, match: 'selected' };
  }
  const needsName = draft.operation === 'catalog.read' || draft.operation === 'metrics.series' && draft.measure === 'medication.amount';
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
    if (isGrowth) return ask('aggregation', '想比较期末测量值，还是各段时间内的增长量？', [{ label: '期末测量值', value: 'latest' }, { label: '期间增长量', value: 'change' }]);
    const coefficient = (draft.measure || '').startsWith('metrics.'); const count = draft.measure === 'records.count';
    return ask('aggregation', '比较日均还是总量？', count ? [{ label: '记录次数', value: 'count' }] : coefficient ? [{ label: '日均系数', value: 'mean_daily' }] : [{ label: '日均', value: 'mean_daily' }, { label: '总量', value: 'sum' }]);
  }
  if (draft.domain === 'powder' && (draft.threshold || draft.measures.some(x => x.startsWith('nutrition.')) || draft.filters.length) && !draft.powderBasis) return ask('powderBasis', '按干粉还是冲调液？', [{ label: '干粉', value: 'dry' }, { label: '冲调液', value: 'prepared' }]);
  if (draft.threshold) {
    const condition = draft.threshold;
    const basis = condition.basisQuantity + ({ g: '克', ml: '毫升', portion: '份' })[condition.basisUnit];
    const comparison = { lt: '低于', lte: '不超过', eq: '等于', gte: '不低于', gt: '高于' }[condition.operator];
    return ask('threshold', '每 ' + basis + '的' + MEASURES[condition.field].label + comparison + '多少？', [],
      { type: 'number', label: '请输入数值', unit: condition.unit });
  }
  if (draft.filters.some(x => x.field === 'recipe.ingredients' && x.entityMention === '奶') || draft.unresolved.includes('excludedIngredientScope')) return ask('excludedIngredientScope', '你想排除哪些配料？', [{ label: '牛奶和奶粉', value: 'milk_and_powder' }, { label: '所有乳制品', value: 'dairy' }]);
  if (effective.some(p => p.startDate && p.endDateExclusive && ['records.aggregate', 'metrics.aggregate', 'metrics.compare'].includes(draft.operation) && (Date.parse(p.endDateExclusive) - Date.parse(p.startDate)) / 86400000 > 90)) fail('QUERY_BUDGET', '一次统计最多 90 天，请缩短日期范围');
  if (effective.some(p => !p.startDate) && ['records.aggregate', 'metrics.aggregate', 'metrics.compare'].includes(draft.operation)) fail('QUERY_BUDGET', '合计统计需要明确日期，一次最多 90 天；可改为近 7 天或近 30 天');
  // 首次执行冻结日期，追问修改日期时重新冻结；翻页不会跨午夜漂移。
  const frozenPeriods = effective.map(period => period.startDate ? { kind: 'range', startDate: period.startDate, endDateExclusive: period.endDateExclusive } : { kind: 'all' });
  const normalized = { ...draft, status: 'ready', periods: frozenPeriods, unresolved: [] };
  const plan = { ...normalized, capabilityVersion: CAPABILITY_VERSION, entityIds: entities.items.map(x => x.id), entities: entities.items, effectivePeriods: effective, entityMatch: entities.match,
    aggregation: draft.aggregation || (draft.operation === 'metrics.series' ? !draft.periods.length && draft.domain === 'intake' ? 'latest' : null : draft.measure === 'records.count' ? 'count' : draft.operation === 'metrics.aggregate' ? 'mean_daily' : draft.operation === 'records.aggregate' ? 'sum' : null) };
  plan.id = hash([plan.operation, plan.domain, plan.measure, plan.measures, plan.entityIds, frozenPeriods, plan.filters, plan.source, plan.powderBasis, plan.aggregation, plan.groupBy, plan.basisQuantity, plan.basisUnit, plan.subjectMode, plan.browseGroup || '',
    ...(plan.domain === 'diet' && plan.operation === 'records.list' && plan.groupBy !== 'entity' ? ['meal-list-v1'] : [])]);
  return { draft: normalized, plan, selected, candidates: entities.candidates };
}
module.exports = { compilePlan, applySelection, executionIssue };
