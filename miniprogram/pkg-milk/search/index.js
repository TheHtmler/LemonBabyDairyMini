const service = require('../../utils/searchService');
const { waitForAppInitialization } = require('../../utils/index');
const { currentContext, createSearchSession, takeSearchAddition, openSearchLocator } = require('../../utils/searchSession');
const { openFeature } = require('../../utils/searchFeatureCatalog');
const { PROTOCOL_VERSION, MEASURES } = require('../../utils/search-core/capabilities');
const { displayItem, resultConditions } = require('../../utils/searchPresentation');
function numberText(value) { return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '缺少数据'; }
function emptyResult(response) {
  const output = response.result || {};
  const missing = response.status === 'missing_data' && !(output.items || []).length && !(output.rows || []).length;
  if (!['no_match', 'no_records'].includes(response.status) && !missing) return null;
  if (missing) return { title: '记录信息还不完整', description: response.message || '部分记录缺少计算所需的数据，暂时无法给出完整结果。' };
  if (response.status === 'no_match') return { title: '没有找到相关内容', description: '试试更常用的名称，或减少一些查询条件。' };
  const interpretation = response.interpretation || {};
  const domain = interpretation.domain;
  if (domain === 'growth') {
    const measure = MEASURES[interpretation.measure] || {};
    const allHistory = (interpretation.periodDefinitions || []).some(period => period.kind === 'all');
    const query = !allHistory && measure.label ? '最近一次' + measure.label : '';
    return { title: '这段时间没有新的成长测量',
      description: '自动沿用上次体重、身高等数值不算新测量。' + (query ? '可以改搜“' + query + '”。' : '保存新的测量后，就能在这里查到。'), query };
  }
  const label = ({ diet: '饮食', milk: '喂奶', medication: '服药', water: '饮水', sleep: '睡眠', bowel: '尿布', intake: '摄入' })[domain] || '相关';
  return { title: '这段时间还没有' + label + '记录', description: '结果只包含当前宝宝已保存的记录，可在问题中指定其他日期。' };
}
function manualFromInterpretation(value) {
  if (!value) return null;
  return { schemaVersion: 2, status: 'ready', operation: value.operation, domain: value.domain,
    entityMentions: value.entityMentions || value.entityNames || [], measure: value.measure, measures: value.measures || [],
    periods: value.periodDefinitions || [], filters: value.filters || [], source: value.source || 'all',
    powderBasis: value.powderBasis || null, aggregation: value.aggregation, subjectMode: value.subjectMode,
    basisQuantity: value.basisQuantity || 100, basisUnit: value.basisUnit || 'g', groupBy: value.groupBy, featureId: value.featureId, browseGroup: value.browseGroup };
}
Page({
  data: {
    query: '', babyName: '', busy: false, moreBusy: false, previewLoading: false, preview: null,
    queryFocus: false, queryReady: false, queryEdited: false, resultQuery: '', resultConditions: '', retryAvailable: false,
    moreError: '', slow: false, savedAddition: null, highlightedId: '', resultSummary: '',
    searchEnabled: false, capabilityError: '', capabilitiesLoading: false,
    exampleQueries: [
      { query: '系统食物有哪些' }, { query: '今天喝了多少奶' },
      { query: '每100克蛋白质低于5克的系统食物' }, { query: '最近一周的体重变化' },
      { query: '今天的饮食记录' }, { query: '最近一周的天然蛋白系数' }
    ],
    hasSearched: false, recent: [], recentExpanded: false, recentManaging: false, examplesExpanded: false,
    message: '', error: '', emptyState: null, question: null, thresholdValue: '',
    items: [], visibleItems: [], result: null, actions: [], nextCursor: null, notesOpen: false
  },
  onLoad() { this._unloaded = false; this._capabilityEpoch = 0; this._scrollTop = 0; this.attachContext(); },
  async onShow() {
    try { await waitForAppInitialization(); } catch (error) {
      if (this._unloaded) return;
      this.clearPrivateResults();
      this.setData({ capabilityError: error.message || '账号信息加载失败，请重试' }); return;
    }
    if (this._unloaded) return;
    const current = currentContext();
    let refresh = null;
    if (!this._session || this._session.accountKey !== current.accountKey || this._session.babyUid !== current.babyUid) this.attachContext();
    else if (this._session.changed()) {
      refresh = manualFromInterpretation(this._response && this._response.interpretation) || this._failedRequest && this._failedRequest.payload.manual || this._lastSuccessful && this._lastSuccessful.payload.manual;
      this._refreshIntent = refresh;
      this._refreshSelection = this._response && this._response.interpretation && this._response.interpretation.selectionSnapshot || this._lastSuccessful && this._lastSuccessful.payload.selectionSnapshot;
      this._refreshQuery = !!this._response;
      this._restoreScroll = this._scrollTop;
      this._session.next(); this._contextToken = null; this._failedRequest = null; this._previewEpoch++;
      this.setData({ preview: null, previewLoading: false, savedAddition: takeSearchAddition(current.babyUid), moreError: '', retryAvailable: false });
    }
    // 首次进入不预检；返回已有结果时仍核对权限，实际搜索始终由服务端鉴权。
    if (this._response || !this._enabled) await this.loadCapabilities();
    if (this._enabled && this._refreshQuery && !this._unloaded) {
      this._refreshQuery = false;
      const manual = refresh || this._refreshIntent; const selectionSnapshot = this._refreshSelection; this._refreshIntent = null; this._refreshSelection = null;
      return this.request({ requestMode: 'new', query: this.data.resultQuery, ...(manual ? { manual, selectionSnapshot } : {}) });
    }
  },
  onPageScroll(event) { this._scrollTop = event.scrollTop; },
  onHide() { this.setData({ queryFocus: false }); },
  onUnload() { this._unloaded = true; this._capabilityEpoch++; clearTimeout(this._slowTimer); clearTimeout(this._highlightTimer); if (this._session) this._session.dispose(); },
  attachContext() {
    if (this._session) this._session.dispose();
    const context = currentContext(); this._session = createSearchSession(context); this._contextToken = null; this._response = null; this._allowed = []; this._enabled = !!(context.accountKey && context.babyUid); this._previewEpoch = 0;
    this._failedRequest = null; this._lastSuccessful = null; this._refreshQuery = false; this._refreshIntent = null; this._refreshSelection = null;
    clearTimeout(this._slowTimer);
    this.setData({ query: '', babyName: context.babyName, searchEnabled: this._enabled, capabilityError: '', busy: false, moreBusy: false,
      queryReady: false, queryEdited: false, resultQuery: '', resultConditions: '', recentExpanded: false, recentManaging: false, examplesExpanded: false,
      items: [], visibleItems: [], result: null, question: null, recent: this._session.recent(), hasSearched: false,
      error: '', message: '', emptyState: null, preview: null, previewLoading: false, actions: [], nextCursor: null,
      retryAvailable: false, moreError: '', slow: false, savedAddition: takeSearchAddition(context.babyUid), highlightedId: '', resultSummary: '', notesOpen: false });
  },
  async loadCapabilities() {
    const session = this._session; const epoch = ++this._capabilityEpoch;
    const active = () => this._session === session && this._capabilityEpoch === epoch && session.active(session.epoch);
    if (!session.accountKey || !session.babyUid) { this.setData({ capabilityError: '请先选择宝宝，再搜索资料' }); return; }
    this.setData({ capabilitiesLoading: true });
    try {
      const result = await service.capabilities({ babyUid: session.babyUid });
      if (!active()) return;
      this._allowed = result.allowedFeatureIds || [];
      this._enabled = result.flags.home_search_enabled !== false && result.protocolVersion === PROTOCOL_VERSION;
      this.setData({ searchEnabled: this._enabled,
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
      queryReady: false, queryEdited: false, resultQuery: '', resultConditions: '', hasSearched: false,
      busy: false, moreBusy: false, searchEnabled: false, recent: [], savedAddition: null, highlightedId: '',
      actions: [], nextCursor: null, retryAvailable: false,
      moreError: '', slow: false, resultSummary: '', emptyState: null });
  },
  onInput(event) {
    const query = event.detail.value;
    this._session.next(); this._previewEpoch++; this._failedRequest = null; clearTimeout(this._slowTimer);
    // 输入仅更新草稿并使迟到响应失效；旧结果及其后续操作仍归属原查询。
    const patch = { query, queryReady: !!query.trim(), queryEdited: !!this.data.resultQuery && query.trim() !== this.data.resultQuery,
      busy: false, moreBusy: false, preview: null, previewLoading: false, error: '', retryAvailable: false, moreError: '', slow: false };
    if (!query.trim()) {
      this._contextToken = null; this._response = null; this._lastSuccessful = null;
      this._refreshQuery = false; this._refreshIntent = null; this._refreshSelection = null;
      Object.assign(patch, { items: [], visibleItems: [], result: null, question: null, hasSearched: false, message: '', emptyState: null,
        actions: [], nextCursor: null, notesOpen: false, resultSummary: '', resultQuery: '', resultConditions: '', queryEdited: false, highlightedId: '' });
    }
    this.setData(patch);
  },
  clearQuery() { this.onInput({ detail: { value: '' } }); this.focusQuery(); },
  focusQuery() { this.setData({ queryFocus: true }); },
  async submit() {
    if (this.data.busy || this.data.moreBusy || !this.data.query.trim()) return;
    return this.request({ requestMode: 'new' });
  },
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
    const session = this._session; const token = session.next();
    const previous = this._response; const previousItems = this.data.items;
    const requestMode = extra.requestMode || (extra.cursor ? 'page' : extra.resolution || extra.command ? 'edit' : 'new');
    const payload = retry ? retry.payload : JSON.parse(JSON.stringify({ protocolVersion: PROTOCOL_VERSION,
      babyUid: session.babyUid, requestId: service.createSearchRequestId(), query: requestMode === 'new' ? this.data.query.trim() : this.data.resultQuery, ...extra,
      requestMode, contextToken: requestMode === 'new' ? undefined : this._contextToken || undefined }));
    this._refreshQuery = false; this._refreshIntent = null; this._refreshSelection = null;
    this._failedRequest = null; this._previewEpoch++;
    clearTimeout(this._slowTimer);
    this._slowTimer = setTimeout(() => { if (this._session === session && session.active(token)) this.setData({ slow: true }); }, 8000);
    this.setData({ [append ? 'moreBusy' : 'busy']: true, error: '', hasSearched: true, preview: null,
      previewLoading: false, retryAvailable: false, moreError: '', slow: false, queryFocus: false,
      ...(!append ? { notesOpen: false } : {}) });
    try {
      const result = await service.search(payload);
      if (this._session !== session || !session.active(token)) return;
      if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error('搜索服务版本暂未就绪，请稍后重试');
      if (result.status === 'unavailable' || result.status === 'partial' && !result.result || result.resetContext) throw Object.assign(new Error(result.message || '本次查询未完成，请重试'), { code: result.reasonCode, terminal: result.reasonCode !== 'AI_RUNNING', resetContext: result.resetContext });
      this._contextToken = result.contextToken || null;
      const output = result.result ? { ...result.result } : null;
      if (output && output.kind === 'feature') this._allowed = (output.items || []).map(item => item.id);
      let items = (output && output.items || []).map(item => displayItem(item, result.interpretation));
      if (append && output && output.kind === 'list') items = [...new Map([...previousItems, ...items].map(item => [item.id, item])).values()];
      if (output && output.rows) {
        let rows = output.rows;
        if (append && output.kind === 'series' && previous && previous.result) rows = [...new Map([...(previous.result.rows || []), ...rows].map(row => [row.date, row])).values()];
        output.rows = rows.map(row => ({ ...row, displayValue: row.known === false || row.value === null ? '缺少数据' : numberText(row.value),
          canOpen: !!row.locator && (row.locator.kind === 'day' || !!row.locator.recordId),
          leftText: numberText(row.left), rightText: numberText(row.right), deltaText: row.delta === null ? '' : (row.delta > 0 ? '+' : '') + numberText(row.delta) }));
      }
      this._response = { ...result, result: output };
      this._lastSuccessful = { payload };
      session.remember(payload.query);
      const emptyState = emptyResult(result);
      const summaryMessage = emptyState ? '' : result.message || (result.status === 'partial' ? '本次结果尚不完整，请核对查询范围与统计说明' : '');
      this.setData({ message: summaryMessage, emptyState, question: result.question || null, thresholdValue: '', busy: false, moreBusy: false, slow: false,
        resultQuery: payload.query, queryEdited: this.data.query.trim() !== payload.query, resultConditions: resultConditions(result),
        items, visibleItems: items, result: output, actions: result.actions || [], nextCursor: result.nextCursor || null, recent: session.recent(),
        resultSummary: [output && output.kind === 'list' && output.total > 0 ? '找到 ' + output.total + (output.entityType === 'meal' ? ' 餐' : ' 项') : '',
          ...(output && (output.kind !== 'comparison' || !(output.rows || []).length) ? output.periodLabels || [] : [])].filter(Boolean).join(' · ') });
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
  renderItems() { this.setData({ visibleItems: this.data.items }); },
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
  useQuery(event) {
    const query = event.currentTarget.dataset.query;
    if (!query || !this.data.searchEnabled || this.data.busy || this.data.moreBusy) return;
    this.onInput({ detail: { value: query } });
    return this.submit();
  },
  clearRecent() { this._session.clear(); this.setData({ recent: [], recentExpanded: false, recentManaging: false }); },
  removeRecent(event) { this._session.remove(event.currentTarget.dataset.query); const recent = this._session.recent(); this.setData({ recent, ...(!recent.length ? { recentExpanded: false, recentManaging: false } : {}) }); },
  toggleRecentManaging() { this.setData({ recentManaging: !this.data.recentManaging }); },
  toggleRecentExpanded() { this.setData({ recentExpanded: !this.data.recentExpanded }); },
  toggleExamples() { this.setData({ examplesExpanded: !this.data.examplesExpanded }); },
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
  openResultGroup(event) { if (!this.data.busy && !this.data.moreBusy && this._response && this._response.interpretation.operation === 'catalog.browse') return this.request({ command: 'browse:' + event.currentTarget.dataset.id }); },
  toggleNotes() { this.setData({ notesOpen: !this.data.notesOpen }); },
  feature(event) { openFeature(event.currentTarget.dataset.id, this._allowed); },
  openSeriesDay(event) { const row = this.data.result && this.data.result.rows[Number(event.currentTarget.dataset.index)]; if (row && row.canOpen) openSearchLocator(row.locator); },
  async openItem(event) {
    const item = this.data.items.find(x => x.id === event.currentTarget.dataset.id); if (!item) return;
    if (!this._session || !this._session.active(this._session.epoch)) return wx.showToast({ title: '资料已变化，请重新搜索', icon: 'none' });
    if (item.type === 'meal' && item.locator && item.locator.kind === 'legacy') return this.setData({ preview: displayItem(item), previewLoading: false });
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
  }
});
