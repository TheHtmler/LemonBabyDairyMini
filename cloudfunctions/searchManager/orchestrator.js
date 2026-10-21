'use strict';
const crypto = require('crypto');
const { validateIntentDraft, PROTOCOL_VERSION, CAPABILITY_VERSION, BUILD_VERSION, MEASURES, searchText, parsePeriodPhrase, shiftDate, fail } = require('./lib/search');
const { FEATURES } = require('./lib/search/features');
const { hash } = require('./access');
const { identityRank } = require('./entityResolver');
const { createReadRepository } = require('./readRepository');
const { createContextRepository } = require('./contextRepository');
const { compilePlan, applySelection } = require('./planCompiler');
const { explicitDraft, interpretV2, make } = require('./intentV2Service');
const { queryCatalog } = require('./catalogQueryService');
const { queryRecords } = require('./recordQueryService');
const { queryMetrics } = require('./metricQueryService');

function periodLabel(period) { return period && period.startDate ? period.startDate + ' 至 ' + shiftDate(period.endDateExclusive, -1) : '全部历史'; }
function semanticGuard(query, draft, context) {
  const text = searchText(query); const previous = context ? context.draft.entityMentions : [];
  if (draft.status === 'ready' && /或者|或是|任一|要么/.test(query)) fail('UNSUPPORTED_LOGIC', '暂时只支持同时满足的条件，请把任选条件分开查询');
  if (draft.status === 'ready' && draft.operation === 'catalog.search' && !draft.entityMentions.length && !draft.filters.length && !/食物|食材|食品|菜|奶粉|配方粉|食谱|药物|药品/.test(query)) fail('SEMANTIC_CONFLICT', '请说明要查的名称或筛选条件');
  if (draft.entityMentions.some(x => !text.includes(searchText(x)) && !previous.some(y => searchText(y) === searchText(x)))) fail('INVALID_MODEL_RESULT', '对象名称没有对应原句，请保留原名称重试');
  if (/平均|日均/.test(query) && draft.status === 'ready' && draft.aggregation !== 'mean_daily') fail('SEMANTIC_CONFLICT', '请明确要统计日均值，当前理解未保留这个条件');
  if (/比(?:上周|本周|这周|上个月|本月)|相比|高多少|低多少/.test(query) && draft.status === 'ready' && draft.operation !== 'metrics.compare') fail('SEMANTIC_CONFLICT', '当前理解没有保留两段时间的比较，请补充比较范围');
  if (/不含|不包含|排除/.test(query) && draft.status === 'ready' && !draft.filters.some(x => x.operator === 'excludes')) fail('SEMANTIC_CONFLICT', '当前理解没有保留排除条件，请明确要排除的配料');
  if (/低于|高于|少于|不到|不超过|不低于/.test(query) && draft.status === 'ready' && !draft.filters.length) fail('SEMANTIC_CONFLICT', '当前理解没有保留比较条件，请补充数值和单位');
  if (draft.filters.some(x => x.field === 'recipe.ingredients' && !(draft.domain === 'recipe' && draft.operation === 'catalog.search')) ||
      draft.filters.some(x => x.field.startsWith('nutrition.') && !(draft.operation.startsWith('catalog') && ['food', 'powder', 'catalog', 'recipe'].includes(draft.domain) || draft.operation === 'records.list' && draft.domain === 'diet')))
    fail('SEMANTIC_CONFLICT', '当前类型不能执行这项筛选，请调整查询范围');
}
function applyEdits(draft, edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits) || Object.keys(edits).some(x => !['source', 'period', 'domain', 'filters', 'powderBasis', 'entityMention', 'operation'].includes(x))) fail('INVALID_QUERY', '筛选条件无效');
  const next = { ...draft, status: 'ready', unresolved: [] };
  if (edits.period) next.periods = [edits.period];
  for (const key of ['source', 'domain', 'filters', 'powderBasis', 'operation']) if (edits[key] !== undefined) next[key] = edits[key];
  if (edits.entityMention !== undefined) next.entityMentions = edits.entityMention ? [edits.entityMention] : [];
  if (next.operation === 'records.list') { next.aggregation = null; next.measure = null; next.measures = []; }
  if (next.operation === 'catalog.search') { next.measure = null; next.measures = []; next.aggregation = null; next.periods = []; }
  if (edits.operation) { next.subjectMode = next.operation.startsWith('catalog') ? 'configured' : 'observed'; next.groupBy = 'none'; }
  return validateIntentDraft(next);
}
function followUp(query, context) {
  if (!context) return null;
  const text = searchText(query);
  const time = text.match(/^(?:换成|改成|改为|看看|再看)?(?:的)?(上个月|上月|本月|上周|本周|今天|昨天|近[零一二两三四五六七八九十百0-9]+天|最近[零一二两三四五六七八九十百0-9]+天)(?:的)?$/);
  if (time) {
    const p = ['上个月', '上月'].includes(time[1]) ? { kind: 'previous_calendar_month' } : (parsePeriodPhrase(time[1]) || {}).period;
    if (p) return { draft: validateIntentDraft({ ...context.draft, periods: [p], status: 'ready', unresolved: [] }), selected: context.selected || {} };
  }
  if (/^(?:那)?(?:另一种|另外一种|另一个)(?:呢|的)?$/.test(text)) {
    const other = (context.candidates || []).filter(x => x.id !== (context.selected || {}).entityId);
    if ((context.candidates || []).length === 2 && (context.selected || {}).entityId && other.length === 1) return { draft: context.draft, selected: { entityId: other[0].id } };
    return { draft: validateIntentDraft({ ...context.draft, status: 'needs_clarification', unresolved: ['entity'] }), selected: {} };
  }
  return null;
}
function publicQuestion(question) { return question ? { id: question.id, slot: question.slot, message: question.message, options: question.options.map(x => ({ id: x.id, label: x.label })), ...(question.input ? { input: question.input } : {}) } : null; }
function errorResponse(error) {
  if (error.code === 'UNSUPPORTED_LOGIC') return { status: 'unsupported', reasonCode: error.code, message: error.message };
  if (['INVALID_CONTEXT', 'EXPIRED_CONTEXT'].includes(error.code)) return { status: 'needs_clarification', reasonCode: error.code, message: error.message, resetContext: true };
  if (error.code === 'QUERY_BUDGET' || error.code === 'DATA_CHANGED') return { status: 'partial', reasonCode: error.code, message: error.message };
  if (error.code === 'SEMANTIC_CONFLICT') return { status: 'needs_clarification', reasonCode: error.code, message: error.message };
  const known = ['AI_UNAVAILABLE', 'DAILY_LIMIT', 'CONFIG_MISSING', 'SOURCE_UNAVAILABLE', 'INVALID_MODEL_RESULT', 'MODEL_TIMEOUT', 'MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT', 'FREE_QUOTA_EXHAUSTED', 'AI_RUNNING', 'AI_UNKNOWN', 'REQUEST_CONFLICT', 'INVALID_QUERY', 'INVALID_CURSOR', 'STALE_CURSOR'];
  return { status: 'unavailable', reasonCode: known.includes(error.code) ? error.code : 'SEARCH_FAILED', message: error.code === 'AI_UNAVAILABLE' ? '智能解析暂不可用，仍可直接按名称查询' : known.includes(error.code) ? error.message : '这次查询没有完成，请重试' };
}
async function search({ db, accessContext, event, env, flags, now, modelClient }) {
  const diagnosticId = crypto.randomBytes(10).toString('hex'); const started = Date.now(); let stage = 'validate'; let route = ''; let operation = ''; let fallbackReason = ''; let reader; let contexts;
  const timings = {};
  const measure = async (key, action) => { const began = Date.now(); try { return await action(); } finally { timings[key] = (timings[key] || 0) + Date.now() - began; } };
  const performance = () => ({ ...timings, durationMs: Date.now() - started });
  const clientBuildVersion = typeof event.clientBuildVersion === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(event.clientBuildVersion) ? event.clientBuildVersion : 'unknown';
  const base = { ok: true, protocolVersion: PROTOCOL_VERSION, capabilityVersion: CAPABILITY_VERSION, buildVersion: BUILD_VERSION, diagnosticId };
  try {
    if (event.protocolVersion !== PROTOCOL_VERSION) return { ...base, status: 'unavailable', reasonCode: 'PROTOCOL_MISMATCH', message: '搜索服务版本暂未就绪，请稍后重试' };
    const requestMode = event.requestMode || (event.cursor ? 'page' : event.edits || event.resolution || event.command ? 'edit' : event.manual ? 'new' : event.contextToken ? 'followup' : 'new');
    if (!['new', 'followup', 'edit', 'page'].includes(requestMode) ||
        [event.cursor, event.edits, event.resolution, event.command, event.manual].filter(Boolean).length > 1 ||
        requestMode === 'new' && (event.cursor || event.edits || event.resolution || event.command) ||
        requestMode === 'page' && !event.cursor || requestMode === 'edit' && !(event.edits || event.resolution || event.command) ||
        requestMode === 'followup' && (event.cursor || event.edits || event.resolution || event.command || event.manual)) fail('INVALID_QUERY', '搜索操作与请求范围不一致');
    // 完整新查询不读取旧上下文，避免过期会话阻断新的问题。
    event = { ...event, contextToken: requestMode === 'new' ? undefined : event.contextToken };
    if (event.selectionSnapshot && (requestMode !== 'new' || !event.manual || typeof event.selectionSnapshot !== 'object' || Array.isArray(event.selectionSnapshot) ||
        Object.keys(event.selectionSnapshot).some(key => key !== 'entityId') || typeof event.selectionSnapshot.entityId !== 'string' || !event.selectionSnapshot.entityId || event.selectionSnapshot.entityId.length > 256)) fail('INVALID_QUERY', '对象选择快照无效');
    const query = event.query === undefined ? '' : event.query;
    if (typeof query !== 'string' || query.length > 300 || !query.trim() && !event.contextToken && !event.manual) fail('INVALID_QUERY', '请输入要搜索的名称或问题');
    contexts = createContextRepository({ db, accessContext, secret: env.SEARCH_CURSOR_SECRET, now });
    const requestHash = hash([requestMode, query, event.contextToken || '', event.resolution || null, event.edits || null, event.cursor || null, event.manual || null, event.command || '', event.selectionSnapshot || null]);
    const cached = await measure('requestCacheMs', () => contexts.cached(event.requestId, requestHash));
    if (cached) {
      const timing = performance();
      console.info('[search-v2]', JSON.stringify({ diagnosticId, stage: 'complete', route: 'response_cache', status: cached.status, ...timing, clientBuildVersion, buildVersion: BUILD_VERSION }));
      return { ...cached, diagnosticId, performance: { ...timing, responseCache: true } };
    }
    reader = createReadRepository({ db, accessContext, now, deadline: started + 22000 });
    let context = event.contextToken ? await measure('contextLoadMs', () => contexts.load(event.contextToken)) : null;
    if (requestMode !== 'new' && !context) fail('INVALID_CONTEXT', '上次搜索已过期，请重新输入完整问题');
    let draft; let selected = {}; let carriedCandidates = [];
    if (event.resolution || event.edits || event.cursor || event.command) {
      if (!context) fail('INVALID_CONTEXT', '上次搜索已过期，请重新输入');
      draft = context.draft; selected = context.selected || {}; carriedCandidates = context.candidates || [];
      if (event.resolution) ({ draft, selected } = applySelection(draft, selected, contexts.selection(context, event.resolution)));
      if (event.edits) { draft = applyEdits(draft, event.edits); if (event.edits.domain || event.edits.entityMention !== undefined || event.edits.source) selected = {}; }
      if (event.command) {
        if (event.command === 'actual-records' && draft.domain === 'medication' && draft.operation === 'catalog.read') draft = validateIntentDraft({ ...draft, operation: 'records.aggregate', subjectMode: 'observed', measure: 'records.count', measures: ['records.count'], aggregation: 'count', periods: [{ kind: 'last_n_days', days: 30 }] });
        else if (event.command === 'record-details' && draft.operation === 'records.aggregate' && draft.domain !== 'intake') draft = validateIntentDraft({ ...draft, operation: 'records.list', measure: null, measures: [], aggregation: null });
        else fail('INVALID_QUERY', '此结果不支持该操作');
      }
      route = 'context';
    } else if (event.manual) { draft = validateIntentDraft(event.manual); selected = event.selectionSnapshot ? { entityId: event.selectionSnapshot.entityId } : {}; route = 'controls'; }
    else {
      const continued = followUp(query, context);
      if (continued) { ({ draft, selected } = continued); carriedCandidates = context.candidates || []; route = 'followup'; }
      else {
        // 完整输入能确认真实名称时直接查询；自然问句不再先按句式选业务意图。
        const name = query.trim().replace(/^(我的|系统(?:的)?)/, ''); const source = /^我的/.test(query) ? 'mine' : /^系统/.test(query) ? 'system' : 'all';
        if (name.length <= 100) {
          let catalog = [];
          try { catalog = await measure('nameProbeMs', () => reader.catalogItems('catalog', name, source)); }
          catch (error) { if (error.code !== 'SOURCE_UNAVAILABLE') throw error; }
          const identities = catalog.filter(item => identityRank(item, name) >= 0);
          if (identities.length) { const best = Math.min(...identities.map(item => identityRank(item, name))); const types = [...new Set(identities.filter(item => identityRank(item, name) === best).map(x => x.type))]; draft = make('catalog.search', types.length === 1 ? types[0] : 'catalog', { entityMentions: [name], source }); route = 'grounded_name'; }
        }
        if (!draft) {
          stage = 'understand'; route = 'model';
          try {
            if (!flags.ai_search_enabled) fail('AI_UNAVAILABLE', '智能解析暂不可用');
            const interpreted = await measure('understandMs', () => interpretV2({ db, accessContext, query, context, requestId: event.requestId, env, now, modelClient, deadline: started + 22000, validateDraft: value => semanticGuard(query, value, context) }));
            draft = interpreted.draft; semanticGuard(query, draft, context);
            if (interpreted.understandingSource === 'intent_cache') route = 'intent_cache';
            else if (interpreted.understandingSource === 'request_cache') route = 'model_request_cache';
          } catch (error) {
            if (!['AI_UNAVAILABLE', 'DAILY_LIMIT', 'FREE_QUOTA_EXHAUSTED', 'MODEL_TIMEOUT', 'MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT', 'CONFIG_MISSING', 'INVALID_MODEL_RESULT'].includes(error.code)) throw error;
            const fallback = explicitDraft(query);
            if (!fallback) throw error;
            if (fallback.operation === 'catalog.read' && fallback.entityMentions.length) {
              const candidates = await reader.catalogItems(fallback.domain, fallback.entityMentions[0], fallback.source);
              if (!candidates.some(item => identityRank(item, fallback.entityMentions[0]) >= 0)) throw error;
            }
            draft = fallback; route = 'explicit_fallback'; fallbackReason = error.code;
          }
          if (context && draft.domain === context.draft.domain && JSON.stringify(draft.entityMentions.map(searchText)) === JSON.stringify(context.draft.entityMentions.map(searchText))) {
            selected = context.selected || {}; carriedCandidates = context.candidates || [];
          }
        }
      }
    }
    stage = 'compile'; operation = draft.operation;
    const compiled = await measure('compileMs', () => compilePlan({ draft, reader, contexts, selected, now }));
    let result;
    if (compiled.question) result = { status: 'needs_clarification', message: compiled.question.message, question: publicQuestion(compiled.question) };
    else if (compiled.terminal) result = compiled.terminal;
    else {
      const plan = { ...compiled.plan, babyUid: accessContext.babyUid }; let offset = 0;
      if (event.cursor) offset = contexts.pageOffset(event.cursor, event.contextToken, plan.id);
      stage = 'execute';
      if (plan.operation === 'feature.open') result = { status: 'ready', result: { kind: 'feature', items: FEATURES.filter(x => x.id === plan.featureId).map(x => ({ id: x.id, name: x.name })) } };
      else if (plan.operation.startsWith('catalog')) result = await measure('executeMs', () => queryCatalog({ reader, plan, offset }));
      else if (plan.operation.startsWith('metrics') || plan.domain === 'intake' || (plan.measure || '').startsWith('intake.')) result = await measure('executeMs', () => queryMetrics({ reader, plan, now, offset }));
      else result = await measure('executeMs', () => queryRecords({ reader, plan, now, offset }));
      await measure('verifyMs', () => reader.verify());
      if (event.cursor && context.sourceRevisions && Object.entries(reader.revisions()).some(([key, value]) => context.sourceRevisions[key] !== value)) fail('DATA_CHANGED', '上次结果的数据已变化，请重新搜索');
      if (result.result) {
        result.result.periodLabels = plan.effectivePeriods.map(periodLabel);
        if (result.result.label && ['mean_daily', 'min', 'max'].includes(plan.aggregation)) result.result.label = ({ mean_daily: '日均', min: '最低', max: '最高' })[plan.aggregation] + result.result.label;
        if (plan.aggregation === 'mean_daily' && !plan.operation.startsWith('metrics') && plan.domain !== 'intake') result.result.note = '按有完整记录的日期求日均，未记录日期不补零。' + (result.result.note || '');
      }
      result.planId = plan.id;
      result.interpretation = { operation: plan.operation, domain: plan.domain, measure: plan.measure, measures: plan.measures, subjectMode: plan.subjectMode, entityNames: plan.entities.map(x => x.name),
        entityMentions: plan.entityMentions, periods: plan.effectivePeriods.map(periodLabel), periodDefinitions: plan.periods, source: plan.source, filters: plan.filters, powderBasis: plan.powderBasis, aggregation: plan.aggregation,
        basisQuantity: plan.basisQuantity, basisUnit: plan.basisUnit, groupBy: plan.groupBy, featureId: plan.featureId,
        ...(compiled.selected.entityId ? { selectionSnapshot: { entityId: compiled.selected.entityId } } : {}) };
      result.chips = [...(plan.operation.startsWith('catalog') ? [{ id: 'source', label: { all: '全部来源', mine: '我的资料', system: '系统资料' }[plan.source], kind: 'source' }] : []),
        ...(plan.powderBasis ? [{ id: 'basis', label: plan.powderBasis === 'dry' ? '按干粉比较' : '按冲调液比较', kind: 'basis' }] : []),
        ...plan.effectivePeriods.map((period, index) => ({ id: 'period-' + index, label: periodLabel(period), kind: 'period' })),
        ...plan.filters.map((filter, index) => ({ id: 'filter-' + index, label: filter.field === 'recipe.ingredients' ? '排除 ' + filter.entityMention : '每' + filter.basisQuantity + (filter.basisUnit === 'ml' ? '毫升' : '克') + MEASURES[filter.field].label + ({ lt: '<', lte: '≤', eq: '=', gte: '≥', gt: '>' }[filter.operator]) + filter.value + filter.unit, kind: 'filter' }))];
      if (plan.operation === 'catalog.read' && plan.measure === 'medication.frequency') result.actions = [{ id: 'actual-records', label: '看实际服用记录' }];
      if (['scalar', 'comparison'].includes((result.result || {}).kind) && !plan.operation.startsWith('metrics')) result.actions = [{ id: 'record-details', label: '查看明细' }];
    }
    stage = 'complete';
    result.understanding = { source: route, degraded: !!fallbackReason, reasonCode: fallbackReason };
    if (fallbackReason && result.result) result.result.note = '智能解析暂不可用，本次仅按完整明确的条件查询。' + (result.result.note || '');
    const token = await measure('contextSaveMs', () => contexts.save({ draft: compiled.draft, selected: compiled.selected, candidates: compiled.candidates && compiled.candidates.length ? compiled.candidates : carriedCandidates, question: compiled.question || null, planId: result.planId || '', sourceRevisions: reader.revisions() }, context));
    result.contextToken = token;
    if (result.result && result.result.nextOffset !== undefined && result.result.nextOffset !== null) result.nextCursor = contexts.pageToken(token, result.planId, result.result.nextOffset);
    const response = { ...base, ...result, queriedAt: new Date(now).toISOString() };
    await measure('responseSaveMs', () => contexts.remember(event.requestId, requestHash, response));
    response.performance = performance();
    console.info('[search-v2]', JSON.stringify({ diagnosticId, stage, route, operation, status: response.status, reads: reader.reads, ...response.performance, clientBuildVersion, buildVersion: BUILD_VERSION }));
    return response;
  } catch (error) {
    const timing = performance();
    console.warn('[search-v2]', JSON.stringify({ diagnosticId, stage, route, operation, code: error.code || 'SEARCH_FAILED', reads: reader ? reader.reads : 0, ...timing, clientBuildVersion, buildVersion: BUILD_VERSION }));
    return { ...base, ...errorResponse(error), performance: timing };
  }
}
module.exports = { search, applyEdits, followUp, semanticGuard };
