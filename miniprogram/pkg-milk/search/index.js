const service = require('../../utils/searchService');
const { waitForAppInitialization } = require('../../utils/index');
const { currentContext, createSearchSession, takeSearchAddition, openSearchLocator } = require('../../utils/searchSession');
const { openFeature } = require('../../utils/searchFeatureCatalog');
const { FEATURES } = require('../../utils/search-core/features');
const { PROTOCOL_VERSION, BUILD_VERSION } = require('../../utils/search-core/capabilities');
const { FIELDS, UNITS } = require('../../utils/search-core/contracts');
const { shiftDate, resolvePeriod } = require('../../utils/search-core/period');
const LABELS = { calories: '能量', protein: '蛋白质', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' };
const TABS = [{ id: 'all', label: '全部' }, { id: 'food', label: '食物' }, { id: 'powder', label: '奶粉' }, { id: 'recipe', label: '食谱' }, { id: 'medication', label: '药物' }, { id: 'history', label: '记录' }, { id: 'feature', label: '功能' }];
const PERIODS = [{ label: '近 30 天', value: { kind: 'last_n_days', days: 30 } }, { label: '上周', value: { kind: 'previous_calendar_week' } }, { label: '近 7 天', value: { kind: 'last_n_days', days: 7 } }, { label: '本月', value: { kind: 'current_month' } }, { label: '全部历史', value: { kind: 'all' } }, { label: '自定义', value: { kind: 'range' } }];
function numberText(value) { return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '缺少数据'; }
function manualFromInterpretation(value) {
  if (!value) return null;
  return { schemaVersion: 2, status: 'ready', operation: value.operation, domain: value.domain,
    entityMentions: value.entityMentions || value.entityNames || [], measure: value.measure, measures: value.measures || [],
    periods: value.periodDefinitions || [], filters: value.filters || [], source: value.source || 'all',
    powderBasis: value.powderBasis || null, aggregation: value.aggregation, subjectMode: value.subjectMode,
    basisQuantity: value.basisQuantity || 100, basisUnit: value.basisUnit || 'g', groupBy: value.groupBy, featureId: value.featureId };
}
function displayItem(item) {
  const basis = item.nutritionBasis || {};
  const values = FIELDS.map(key => {
    const entry = (item.nutrients || {})[key] || {};
    return { key, label: LABELS[key], value: entry.state === 'known' ? Math.round(entry.value * 1000) / 1000 + ' ' + entry.unit : '未提供' };
  });
  const calories = (item.nutrients || {}).calories || {};
  const basisText = basis.quantity > 0 && basis.unit ? '每 ' + basis.quantity + (basis.unit === 'g' ? ' 克' : basis.unit === 'ml' ? ' 毫升' : ' 份') +
    (basis.material === 'dry_powder' ? '干粉' : basis.material === 'prepared_formula' ? '冲调液' : '') : '计量基准未提供';
  return { ...item, answers: item.answers || [], ingredients: item.ingredients || [], values, proteinText: values.find(value => value.key === 'protein').value,
    energyText: calories.state === 'known' ? Math.round(calories.value * 1000) / 1000 + ' 千卡' : '能量未提供',
    basisCaption: basisText.replace(/^每\s*/, ''),
    thumbnailUrl: typeof item.image === 'string' ? item.image : '',
    typeLabel: ({ medication: '药物', powder: '奶粉', recipe: '食谱', water: '饮水', milk: '喂奶' })[item.type] || '食物',
    hasNutrition: ['food', 'powder'].includes(item.type),
    medicationText: [item.dosage && item.dosage + ' ' + (item.unit || ''), item.frequency].filter(Boolean).join(' · '),
    medicationDetails: item.type === 'medication' ? [
      { label: '已设置剂量', value: item.dosage ? item.dosage + ' ' + (item.unit || '') : '未填写' },
      { label: '已设置频率', value: item.frequency || '未填写' },
      { label: '浓度', value: item.concentration ? item.concentration + ' ' + (item.concentrationUnit || '') + '/' + (item.volumeUnit || '') : '未填写' },
      { label: '备注', value: item.notes || '未填写' }
    ] : [],
    actualUnitText: ({ g: '克', ml: '毫升', portion: '份' })[item.actualUnit] || item.actualUnit || '',
    basisText,
    sourceText: ({ system: '系统', mine: '我的', history: '记录' })[item.source] || '饮食记录',
    estimate: Object.values((item.provenance || {}).fieldSources || {}).includes('model_estimate') };
}
Page({
  data: {
    query: '', babyName: '', tabs: TABS, tab: 'all', showTabs: false, busy: false, moreBusy: false, previewLoading: false, preview: null,
    queryFocus: true, followupActive: false, continuationReady: false, continuationLabel: '', retryAvailable: false,
    moreError: '', slow: false, savedAddition: null, highlightedId: '', resultSummary: '',
    searchEnabled: false, capabilityError: '', capabilitiesLoading: false, scanAvailable: true,
    hasSearched: false, catalogResult: false, recent: [], status: '', message: '', error: '', question: null, thresholdValue: '',
    items: [], visibleItems: [], result: null, chips: [], actions: [], nextCursor: null, notesOpen: false,
    filtersOpen: false, historyOptionsOpen: false, filterKeyword: '', sources: ['全部来源', '系统', '我的'], sourceIndex: 0,
    modes: ['资料', '饮食记录', '服药记录', '喂奶记录', '饮水记录'], modeIndex: 0,
    periods: PERIODS.map(x => x.label), periodIndex: 0, startDate: '', endDate: '', historyPeriodText: '', dateRangeOpen: false,
    powderBases: ['请选择基准', '干粉', '冲调液'], powderIndex: 0, conditions: [], fields: FIELDS.map(x => LABELS[x]),
    operators: ['低于', '不高于', '等于', '不低于', '高于'], basisUnits: ['克', '毫升', '份'],
    recordDomains: [{ id: 'diet', label: '饮食记录' }, { id: 'medication', label: '服药记录' }, { id: 'milk', label: '喂奶记录' }, { id: 'water', label: '饮水记录' }], recordDomainIndex: 0
  },
  onLoad() { this._unloaded = false; this._capabilityEpoch = 0; this._scrollTop = 0; this.attachContext(); },
  async onShow() {
    try { await waitForAppInitialization(); } catch (error) { this.setData({ capabilityError: error.message || '账号信息加载失败，请重试' }); return; }
    if (this._unloaded) return;
    const current = currentContext();
    let refresh = null;
    if (!this._session || this._session.accountKey !== current.accountKey || this._session.babyUid !== current.babyUid) this.attachContext();
    else if (this._session.changed()) {
      refresh = manualFromInterpretation(this._response && this._response.interpretation) || this._failedRequest && this._failedRequest.payload.manual || this._lastSuccessful && this._lastSuccessful.payload.manual;
      this._refreshIntent = refresh;
      this._refreshSelection = this._response && this._response.interpretation && this._response.interpretation.selectionSnapshot || this._lastSuccessful && this._lastSuccessful.payload.selectionSnapshot;
      this._refreshQuery = this.data.hasSearched;
      this._restoreScroll = this._scrollTop;
      this._session.next(); this._contextToken = null; this._failedRequest = null; this._previewEpoch++;
      this.setData({ preview: null, previewLoading: false, savedAddition: takeSearchAddition(current.babyUid), moreError: '', retryAvailable: false, continuationReady: false, followupActive: false });
    }
    await this.loadCapabilities();
    if (this._enabled && this._refreshQuery && !this._unloaded) {
      this._refreshQuery = false;
      const manual = refresh || this._refreshIntent; const selectionSnapshot = this._refreshSelection; this._refreshIntent = null; this._refreshSelection = null;
      return this.request({ requestMode: 'new', ...(manual ? { manual, selectionSnapshot } : {}) });
    }
  },
  onPageScroll(event) { this._scrollTop = event.scrollTop; },
  onHide() { this.setData({ queryFocus: false }); },
  onUnload() { this._unloaded = true; this._capabilityEpoch++; clearTimeout(this._slowTimer); clearTimeout(this._highlightTimer); if (this._session) this._session.dispose(); },
  attachContext() {
    if (this._session) this._session.dispose();
    const context = currentContext(); this._session = createSearchSession(context); this._contextToken = null; this._response = null; this._allowed = []; this._enabled = false; this._previewEpoch = 0;
    this._failedRequest = null; this._lastSuccessful = null; this._refreshQuery = false; this._refreshIntent = null; this._refreshSelection = null; clearTimeout(this._slowTimer);
    this._periods = PERIODS;
    this.setData({ query: '', babyName: context.babyName, searchEnabled: false, capabilityError: '', busy: false, moreBusy: false,
      items: [], visibleItems: [], result: null, question: null, recent: this._session.recent(), hasSearched: false,
      status: '', error: '', message: '', preview: null, previewLoading: false, chips: [], actions: [], nextCursor: null, filtersOpen: false,
      followupActive: false, continuationReady: false, retryAvailable: false, moreError: '', slow: false, savedAddition: takeSearchAddition(context.babyUid), highlightedId: '', resultSummary: '', showTabs: false, tab: 'all',
      historyOptionsOpen: false, conditions: [], sourceIndex: 0, modeIndex: 0, periodIndex: 0, notesOpen: false });
    this.updateHistoryPeriodText();
  },
  async loadCapabilities() {
    const session = this._session; const epoch = ++this._capabilityEpoch;
    const active = () => this._session === session && this._capabilityEpoch === epoch && session.active(session.epoch);
    if (!session.accountKey || !session.babyUid) { this.setData({ capabilityError: '请先选择宝宝，再搜索资料' }); return; }
    this.setData({ capabilitiesLoading: true });
    try {
      const result = await service.capabilities({ babyUid: session.babyUid });
      if (!active()) return;
      this.reportSearchVersion(result);
      this._allowed = result.allowedFeatureIds || [];
      this._enabled = result.flags.home_search_enabled !== false && result.protocolVersion === PROTOCOL_VERSION;
      this.setData({ searchEnabled: this._enabled, scanAvailable: result.flags.nutrition_scan_enabled !== false,
        capabilityError: result.flags.home_search_enabled === false ? '搜索功能已关闭' : result.protocolVersion !== PROTOCOL_VERSION ? '搜索服务版本暂未就绪，请稍后重试' : '' });
      if (!this._enabled) this.clearPrivateResults();
    } catch (error) {
      if (!active()) return;
      this.setData({ capabilityError: error.message || '搜索服务暂时无法连接' });
      if (['FORBIDDEN', 'FEATURE_DISABLED'].includes(error.code)) this.clearPrivateResults();
    } finally { if (active()) this.setData({ capabilitiesLoading: false }); }
  },
  retryCapabilities() { if (!this.data.capabilitiesLoading) return this.loadCapabilities(); },
  clearPrivateResults() {
    this._session.next(); this._previewEpoch++; clearTimeout(this._slowTimer);
    this._enabled = false; this._contextToken = null; this._response = null; this._lastSuccessful = null;
    this._failedRequest = null; this._refreshIntent = null; this._refreshSelection = null; this._refreshQuery = false;
    this.setData({ query: '', items: [], visibleItems: [], result: null, question: null, preview: null, previewLoading: false,
      busy: false, moreBusy: false, searchEnabled: false, recent: [], savedAddition: null, highlightedId: '',
      chips: [], actions: [], nextCursor: null, continuationReady: false, followupActive: false, retryAvailable: false,
      moreError: '', showTabs: false, slow: false, resultSummary: '' });
  },
  onInput(event) {
    this._session.next(); this._previewEpoch++; this._failedRequest = null; clearTimeout(this._slowTimer);
    if (!this.data.followupActive) { this._contextToken = null; this._response = null; this._lastSuccessful = null; }
    this.setData({ query: event.detail.value, busy: false, moreBusy: false, items: [], visibleItems: [], result: null, question: null, preview: null,
      previewLoading: false, hasSearched: false, error: '', message: '', status: '', actions: [], chips: [], nextCursor: null, notesOpen: false,
      retryAvailable: false, moreError: '', slow: false, resultSummary: '', showTabs: false });
  },
  clearQuery() { this._contextToken = null; this._response = null; this.onInput({ detail: { value: '' } }); this.setData({ filtersOpen: false, historyOptionsOpen: false, conditions: [], followupActive: false, continuationReady: false }); },
  async submit() {
    if (this.data.busy || !this.data.query.trim()) return;
    return this.request({ requestMode: this.data.followupActive ? 'followup' : 'new' });
  },
  continueQuery() {
    if (!this._contextToken || !this.data.continuationReady) return;
    this.setData({ followupActive: true, query: '', queryFocus: true, error: '' });
  },
  newQuery() { this.clearQuery(); this.setData({ followupActive: false, continuationReady: false, queryFocus: true }); },
  async retrySearch() {
    const failed = this._failedRequest;
    if (!failed || this.data.busy || this.data.moreBusy) return;
    if (failed.code === 'AI_UNKNOWN') {
      const session = this._session; const epoch = session.epoch;
      const answer = await new Promise(resolve => wx.showModal({ title: '重新提交智能查询', content: '上次调用结果暂不能确认。继续将发起一次新查询，可能再次使用一次智能解析次数。', confirmText: '重新查询', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!answer.confirm || this._failedRequest !== failed || this._session !== session || !session.active(epoch)) return;
    }
    const payload = { ...failed.payload, ...(!failed.reuseId ? { requestId: service.createSearchRequestId() } : {}) };
    return this.request({}, failed.append, { payload });
  },
  async request(extra = {}, append = false, retry = null) {
    if (!this._enabled) { this.setData({ error: this.data.capabilityError || '搜索服务正在准备，请稍后重试' }); return; }
    const started = Date.now();
    const session = this._session; const token = session.next();
    const previous = this._response; const previousItems = this.data.items;
    const requestMode = extra.requestMode || (extra.cursor ? 'page' : extra.edits || extra.resolution || extra.command ? 'edit' : 'new');
    const payload = retry ? retry.payload : JSON.parse(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuildVersion: BUILD_VERSION,
      babyUid: session.babyUid, requestId: service.createSearchRequestId(), query: this.data.query.trim(), ...extra,
      requestMode, contextToken: requestMode === 'new' ? undefined : this._contextToken || undefined }));
    if (payload.requestMode === 'new' && !append) { this._contextToken = null; this._response = null; this._lastSuccessful = null; }
    this._failedRequest = null; this._previewEpoch++;
    clearTimeout(this._slowTimer);
    this._slowTimer = setTimeout(() => { if (this._session === session && session.active(token)) this.setData({ slow: true }); }, 8000);
    this.setData({ [append ? 'moreBusy' : 'busy']: true, error: '', hasSearched: true, preview: null, filtersOpen: false, historyOptionsOpen: false,
      previewLoading: false, retryAvailable: false, moreError: '', slow: false, queryFocus: false,
      ...(payload.requestMode === 'new' ? { continuationReady: false, followupActive: false } : {}),
      ...(!append ? { items: [], visibleItems: [], result: null, question: null, message: '', actions: [], notesOpen: false } : {}) });
    try {
      const result = await service.search(payload);
      if (this._session !== session || !session.active(token)) return;
      this.reportSearchVersion(result);
      if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error('搜索服务版本暂未就绪，请稍后重试');
      if (result.resetContext) { this._contextToken = null; this.setData({ continuationReady: false, followupActive: false }); }
      else if (result.contextToken) this._contextToken = result.contextToken;
      if (result.status === 'unavailable' || result.status === 'partial' && !result.result || result.resetContext) throw Object.assign(new Error(result.message || '本次查询未完成，请重试'), { code: result.reasonCode, terminal: result.reasonCode !== 'AI_RUNNING', resetContext: result.resetContext });
      const output = result.result ? { ...result.result } : null;
      let items = (output && output.items || []).map(displayItem);
      if (append && output && output.kind === 'list') items = [...new Map([...previousItems, ...items].map(item => [item.id, item])).values()];
      if (output && output.rows) {
        let rows = output.rows;
        if (append && output.kind === 'series' && previous && previous.result) rows = [...new Map([...(previous.result.rows || []), ...rows].map(row => [row.date, row])).values()];
        output.rows = rows.map(row => ({ ...row, displayValue: row.known === false || row.value === null ? '缺少数据' : numberText(row.value),
          leftText: numberText(row.left), rightText: numberText(row.right), deltaText: row.delta === null ? '' : (row.delta > 0 ? '+' : '') + numberText(row.delta) }));
      }
      this._response = { ...result, result: output };
      let tab = this.data.tab;
      if (!append && output) {
        if (output.kind === 'feature') tab = 'feature';
        else if (output.kind !== 'list') tab = 'all';
        else if (items.length && items.every(item => item.source === 'history')) tab = 'history';
        else if (result.interpretation && ['food', 'powder', 'recipe', 'medication'].includes(result.interpretation.domain)) tab = result.interpretation.domain;
        else tab = 'all';
      }
      this._lastSuccessful = { payload };
      session.remember(this.data.query);
      const interpretation = result.interpretation;
      const metric = output && !['list', 'feature'].includes(output.kind);
      const summaryMessage = result.message || (result.status === 'partial' ? '本次结果尚不完整，请核对查询范围与依据' : '');
      this.setData({ tab, status: result.status, message: summaryMessage, question: result.question || null, thresholdValue: '', busy: false, moreBusy: false, slow: false,
        items, visibleItems: items, result: output, catalogResult: !!(interpretation && interpretation.operation.startsWith('catalog')), chips: result.chips || [], actions: result.actions || [], nextCursor: result.nextCursor || null, recent: session.recent(),
        followupActive: false, continuationReady: !!this._contextToken && !!output,
        continuationLabel: interpretation ? [interpretation.entityNames.join('、'), ...(interpretation.periods || [])].filter(Boolean).join(' · ') : this.data.query,
        showTabs: !!output && !metric && output.kind === 'list' && !!interpretation && interpretation.operation.startsWith('catalog'),
        recordDomainIndex: Math.max(0, this.data.recordDomains.findIndex(item => interpretation && item.id === interpretation.domain)),
        resultSummary: [output && output.total !== undefined ? '找到 ' + output.total + ' 项' : '', summaryMessage, output && output.note || ''].filter(Boolean).join('；') }, () => {
        if (this._session === session && session.active(token)) console.info('[search-display-timing]', { durationMs: Date.now() - started, diagnosticId: result.diagnosticId || '', serverMs: result.performance && result.performance.totalMs, append });
      });
      if (result.interpretation) this.populateFilters(result.interpretation);
      this.restoreResultPosition();
    } catch (error) {
      if (this._session === session && session.active(token)) {
        this._failedRequest = { payload, append, code: error.code, reuseId: !error.terminal && error.code !== 'AI_UNKNOWN' };
        if (['FORBIDDEN', 'FEATURE_DISABLED'].includes(error.code)) { this.clearPrivateResults(); this.setData({ capabilityError: error.message || '当前宝宝的访问权限已失效' }); return; }
        if (error.resetContext) this._failedRequest = null;
        this.setData({ [append ? 'moreError' : 'error']: error.message || '这次查询没有完成，请重试', retryAvailable: !!this._failedRequest });
      }
    } finally { if (this._session === session && session.active(token)) { clearTimeout(this._slowTimer); if (this.data.busy || this.data.moreBusy || this.data.slow) this.setData({ busy: false, moreBusy: false, slow: false }); } }
  },
  reportSearchVersion(result) {
    const version = result.buildVersion || 'unknown'; const stamp = BUILD_VERSION + ':' + version;
    if (this._versionStamp === stamp) return;
    this._versionStamp = stamp;
    console.info('[search-version]', { clientBuildVersion: BUILD_VERSION, serviceBuildVersion: version, protocolVersion: result.protocolVersion });
  },
  renderItems() { this.setData({ visibleItems: this.data.items }); },
  async onTab(event) {
    const tab = event.currentTarget.dataset.id;
    if (!TABS.some(x => x.id === tab) || this.data.busy || this.data.moreBusy || tab === this.data.tab) return;
    const value = this._response && this._response.interpretation;
    const session = this._session;
    const targetDomain = tab === 'history' ? value && value.domain === 'medication' ? 'medication' : value && value.domain === 'powder' ? 'milk' : 'diet' : tab === 'all' ? 'catalog' : tab;
    const filters = value && value.filters || [];
    const compatible = filters.filter(filter => filter.field === 'recipe.ingredients' ? targetDomain === 'recipe' : ['catalog', 'food', 'powder', 'diet'].includes(targetDomain));
    if (compatible.length !== filters.length) {
      const epoch = this._session.epoch;
      const answer = await new Promise(resolve => wx.showModal({ title: '调整查询范围', content: '新的分类不支持部分筛选条件，继续将移除这些条件。', confirmText: '移除并查询', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!answer.confirm || this._session !== session || !session.active(epoch)) return;
    }
    if (tab === 'feature') {
      const keyword = this.data.filterKeyword || this.data.query;
      const items = FEATURES.filter(item => this._allowed.includes(item.id) && (!keyword || [item.name, ...(item.keywords || []), ...(item.aliases || [])].some(name => name.includes(keyword)))).map(({ id, name }) => ({ id, name }));
      this._session.next(); this._contextToken = null; this._response = null; this._failedRequest = null;
      this.setData({ tab, items: [], visibleItems: [], result: { kind: 'feature', items }, showTabs: false, continuationReady: false, retryAvailable: false, error: '', nextCursor: null, chips: [], actions: [], resultSummary: '', message: items.length ? '' : '没有找到这个功能，可输入功能名称重新搜索' });
      return;
    }
    const edits = { operation: tab === 'history' ? 'records.list' : 'catalog.search',
      domain: targetDomain, filters: compatible, source: tab === 'history' ? 'all' : value && value.source || 'all',
      powderBasis: tab === 'powder' ? value && value.powderBasis || null : null };
    this.setData({ tab });
    if (this._contextToken) return this.request({ edits });
    return this.request({ manual: { ...(manualFromInterpretation(value) || { schemaVersion: 2, status: 'ready', entityMentions: [], periods: [] }), ...edits } });
  },
  async onRecordDomain(event) {
    const index = Number(event.detail.value); const domain = this.data.recordDomains[index];
    if (!domain || this.data.busy || this.data.moreBusy || !this._contextToken) return;
    const filters = this._response && this._response.interpretation && this._response.interpretation.filters || [];
    if (domain.id !== 'diet' && filters.length) {
      const session = this._session; const epoch = session.epoch;
      const answer = await new Promise(resolve => wx.showModal({ title: '调整记录范围', content: '新范围不支持营养筛选，继续会移除这些条件。', confirmText: '移除并查询', success: resolve, fail: () => resolve({ confirm: false }) }));
      if (!answer.confirm || this._session !== session || !session.active(epoch)) return;
    }
    return this.request({ edits: { operation: 'records.list', domain: domain.id, filters: domain.id === 'diet' ? filters : [], powderBasis: null, source: 'all' } });
  },
  restoreResultPosition() {
    const added = this.data.savedAddition;
    const index = added ? this.data.visibleItems.findIndex(item => item.type === added.type && (item.sourceId === added.id || item.locator && item.locator.memberId === added.id)) : -1;
    if (index >= 0) {
      this.setData({ highlightedId: this.data.visibleItems[index].id });
      if (wx.pageScrollTo) wx.pageScrollTo({ selector: '#search-result-' + index, duration: 180 });
      clearTimeout(this._highlightTimer); this._highlightTimer = setTimeout(() => { if (!this._unloaded) this.setData({ highlightedId: '' }); }, 1200);
    } else if (this._restoreScroll !== undefined && wx.pageScrollTo) wx.pageScrollTo({ scrollTop: this._restoreScroll, duration: 0 });
    this._restoreScroll = undefined;
  },
  openAddedItem() {
    const added = this.data.savedAddition; if (!added) return;
    wx.navigateTo({ url: (added.type === 'powder' ? '/pkg-milk/powder-management/index' : '/pkg-milk/food-management/index') + '?searchId=' + encodeURIComponent(added.id) + '&searchScope=mine&searchBabyUid=' + encodeURIComponent(this._session.babyUid) });
  },
  useQuery(event) { this.onInput({ detail: { value: event.currentTarget.dataset.query } }); return this.submit(); },
  clearRecent() { this._session.clear(); this.setData({ recent: [] }); },
  removeRecent(event) { this._session.remove(event.currentTarget.dataset.query); this.setData({ recent: this._session.recent() }); },
  resolveChoice(event) {
    if (this.data.busy || !this.data.question) return;
    return this.request({ resolution: { challengeId: this.data.question.id, choiceId: event.currentTarget.dataset.id } });
  },
  onThreshold(event) { this.setData({ thresholdValue: event.detail.value }); },
  resolveThreshold() {
    if (!this.data.question || this.data.thresholdValue === '' || !Number.isFinite(Number(this.data.thresholdValue))) { this.setData({ error: '请输入有效数值' }); return; }
    return this.request({ resolution: { challengeId: this.data.question.id, value: Number(this.data.thresholdValue) } });
  },
  more() { if (!this.data.busy && !this.data.moreBusy && this.data.nextCursor) return this.request({ cursor: this.data.nextCursor }, true); },
  action(event) { if (!this.data.busy) return this.request({ command: event.currentTarget.dataset.id }); },
  toggleNotes() { this.setData({ notesOpen: !this.data.notesOpen }); },
  toggleFilters() { this.setData({ filtersOpen: !this.data.filtersOpen, historyOptionsOpen: false }); },
  onChip(event) { if (event.currentTarget.dataset.kind === 'period') this.setData({ historyOptionsOpen: !this.data.historyOptionsOpen, filtersOpen: false }); else this.toggleFilters(); },
  populateFilters(value) {
    const definitions = value.periodDefinitions || []; this._periods = PERIODS.slice();
    let periodIndex = definitions[0] ? this._periods.findIndex(x => JSON.stringify(x.value) === JSON.stringify(definitions[0])) : 0;
    if (periodIndex < 0) { periodIndex = this._periods.length; this._periods.push({ label: value.periods[0], value: definitions[0] }); }
    this.setData({ filterKeyword: value.entityNames[0] || '', sourceIndex: ['all', 'system', 'mine'].indexOf(value.source), powderIndex: [null, 'dry', 'prepared'].indexOf(value.powderBasis),
      periodIndex, periods: this._periods.map(x => x.label), modeIndex: value.operation.startsWith('catalog') ? 0 : ({ diet: 1, medication: 2, milk: 3, water: 4 })[value.domain] || 1,
      conditions: (value.filters || []).filter(x => x.field.startsWith('nutrition.')).map(x => ({ fieldIndex: FIELDS.indexOf(x.field.slice(10)), operatorIndex: ['lt', 'lte', 'eq', 'gte', 'gt'].indexOf(x.operator), value: String(x.value), basisQuantity: String(x.basisQuantity), unitIndex: ['g', 'ml', 'portion'].indexOf(x.basisUnit) })) });
    this.updateHistoryPeriodText();
  },
  selectedPeriod() { const value = (this._periods[this.data.periodIndex] || PERIODS[0]).value; return value.kind === 'range' && !value.startDate ? { kind: 'range', startDate: this.data.startDate, endDateExclusive: this.data.endDate ? shiftDate(this.data.endDate, 1) : '' } : value; },
  updateHistoryPeriodText() { try { const p = resolvePeriod(this.selectedPeriod()); this.setData({ historyPeriodText: p.startDate ? p.startDate + ' 至 ' + shiftDate(p.endDateExclusive, -1) : '全部历史' }); } catch (_) { this.setData({ historyPeriodText: '请选择有效日期范围' }); } },
  onPicker(event) { const key = event.currentTarget.dataset.key; if (['sourceIndex', 'modeIndex', 'periodIndex', 'powderIndex'].includes(key)) { const value = Number(event.detail.value); this.setData({ [key]: value, ...(key === 'modeIndex' && value > 0 ? { sourceIndex: 0, ...(value > 1 ? { conditions: [], powderIndex: 0 } : {}) } : {}) }); if (key === 'periodIndex') this.updateHistoryPeriodText(); } },
  onDate(event) { if (['startDate', 'endDate'].includes(event.currentTarget.dataset.key)) this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); this.updateHistoryPeriodText(); },
  async onHistoryPeriod(event) {
    const index = Number(event.currentTarget.dataset.index === undefined ? event.detail.value : event.currentTarget.dataset.index);
    if (!this._periods[index] || this.data.busy) return;
    this.setData({ periodIndex: index, dateRangeOpen: index === 5 }); this.updateHistoryPeriodText();
    if (index !== 5) return this.applyHistoryPeriod();
  },
  applyHistoryPeriod() { try { const period = this.selectedPeriod(); resolvePeriod(period); return this.request({ edits: { period } }); } catch (error) { this.setData({ error: error.message || '日期范围无效' }); } },
  onSourceFilter(event) { this.setData({ sourceIndex: Number(event.detail.value) }); if (this._contextToken) return this.request({ edits: { source: ['all', 'system', 'mine'][this.data.sourceIndex] } }); },
  onFilterKeyword(event) { this.setData({ filterKeyword: event.detail.value }); },
  addCondition() { if (this.data.conditions.length < 6) this.setData({ conditions: [...this.data.conditions, { fieldIndex: 1, operatorIndex: 0, value: '', basisQuantity: '100', unitIndex: 0 }] }); },
  removeCondition(event) { this.setData({ conditions: this.data.conditions.filter((_, i) => i !== Number(event.currentTarget.dataset.index)) }); },
  onCondition(event) {
    const index = Number(event.currentTarget.dataset.index), key = event.currentTarget.dataset.key;
    if (!this.data.conditions[index] || !['fieldIndex', 'operatorIndex', 'value', 'basisQuantity', 'unitIndex'].includes(key)) return;
    const conditions = this.data.conditions.map((row, i) => i === index ? { ...row, [key]: key.endsWith('Index') ? Number(event.detail.value) : event.detail.value } : row);
    this.setData({ conditions });
  },
  applyFilters() {
    try {
      const filters = this.data.conditions.map(c => {
        if (c.value === '' || c.basisQuantity === '') throw new Error('请填写营养值和比较基准');
        const field = FIELDS[c.fieldIndex]; return { field: 'nutrition.' + field, operator: ['lt', 'lte', 'eq', 'gte', 'gt'][c.operatorIndex], value: Number(c.value), unit: UNITS[field], basisQuantity: Number(c.basisQuantity), basisUnit: ['g', 'ml', 'portion'][c.unitIndex] };
      });
      const catalog = this.data.modeIndex === 0;
      const domain = catalog ? ['food', 'powder', 'recipe', 'medication'].includes(this.data.tab) ? this.data.tab : 'catalog' : ['diet', 'medication', 'milk', 'water'][this.data.modeIndex - 1];
      return this.request({ contextToken: undefined, manual: { schemaVersion: 2, status: 'ready', operation: catalog ? 'catalog.search' : 'records.list', domain,
        entityMentions: this.data.filterKeyword.trim() ? [this.data.filterKeyword.trim()] : [], filters, source: catalog ? ['all', 'system', 'mine'][this.data.sourceIndex] : 'all',
        powderBasis: [null, 'dry', 'prepared'][this.data.powderIndex], periods: catalog ? [] : [this.selectedPeriod()] } });
    } catch (error) { this.setData({ error: error.message || '请检查筛选条件' }); }
  },
  feature(event) { openFeature(event.currentTarget.dataset.id, this._allowed); },
  openSeriesDay(event) { const row = this.data.result && this.data.result.rows[Number(event.currentTarget.dataset.index)]; if (row && row.locator) openSearchLocator(row.locator); },
  async openItem(event) {
    const item = this.data.items.find(x => x.id === event.currentTarget.dataset.id); if (!item) return;
    if (item.source === 'history') return openSearchLocator(item.locator);
    const session = this._session, token = session.epoch, previewEpoch = ++this._previewEpoch;
    this.setData({ previewLoading: true, error: '' });
    try {
      const result = await service.preview({ babyUid: session.babyUid, type: item.type, source: item.locator.source, sourceId: item.sourceId, memberIndex: item.locator.memberIndex, memberId: item.locator.memberId });
      if (this._session === session && session.active(token) && previewEpoch === this._previewEpoch) this.setData({ preview: displayItem(result.item) });
    } catch (error) { if (this._session === session && session.active(token) && previewEpoch === this._previewEpoch) this.setData({ error: error.message }); }
    finally { if (this._session === session && session.active(token) && previewEpoch === this._previewEpoch) this.setData({ previewLoading: false }); }
  },
  onResultImageError(event) { this.setData({ items: this.data.items.map(item => item.id === event.currentTarget.dataset.id ? { ...item, thumbnailUrl: '' } : item) }); this.renderItems(); },
  closePreview() { this._previewEpoch++; this.setData({ preview: null, previewLoading: false }); },
  stopPropagation() {},
  openManagement() {
    const item = this.data.preview; if (!item) return;
    if (item.type === 'medication') return wx.navigateTo({ url: '/pkg-misc/medications/index' });
    const route = item.type === 'food' ? '/pkg-milk/food-management/index' : item.type === 'powder' ? '/pkg-milk/powder-management/index' : '/pkg-records/recipe-management/index';
    wx.navigateTo({ url: route + (item.type === 'recipe' ? '?mode=detail&id=' : '?searchId=') + encodeURIComponent(item.locator.memberId || item.sourceId) + '&searchScope=' + encodeURIComponent(item.source) + '&searchBabyUid=' + encodeURIComponent(this._session.babyUid) });
  },
  scan() { if (this.data.scanAvailable) { this._restoreScroll = this._scrollTop; wx.navigateTo({ url: '/pkg-milk/nutrition-scan/index?from=search' }); } }
});
