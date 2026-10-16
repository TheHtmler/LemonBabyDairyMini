const service = require('../../utils/searchService');
const { waitForAppInitialization } = require('../../utils/index');
const { currentContext, createSearchSession, openSearchLocator } = require('../../utils/searchSession');
const { openFeature } = require('../../utils/searchFeatureCatalog');
const { PROTOCOL_VERSION, BUILD_VERSION, FIELDS, UNITS, shiftDate, resolvePeriod } = require('./lib/search/index');
const LABELS = { calories: '能量', protein: '蛋白质', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' };
const TABS = [{ id: 'all', label: '全部' }, { id: 'food', label: '食物' }, { id: 'powder', label: '奶粉' }, { id: 'recipe', label: '食谱' }, { id: 'medication', label: '药物' }, { id: 'history', label: '记录' }, { id: 'feature', label: '功能' }];
const PERIODS = [{ label: '近 30 天', value: { kind: 'last_n_days', days: 30 } }, { label: '上周', value: { kind: 'previous_calendar_week' } }, { label: '近 7 天', value: { kind: 'last_n_days', days: 7 } }, { label: '本月', value: { kind: 'current_month' } }, { label: '全部历史', value: { kind: 'all' } }, { label: '自定义', value: { kind: 'range' } }];
function numberText(value) { return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '缺少数据'; }
function formatItem(item) {
  const basis = item.nutritionBasis || {};
  const values = FIELDS.map(key => {
    const entry = (item.nutrients || {})[key] || {};
    return { key, label: LABELS[key], value: entry.state === 'known' ? Math.round(entry.value * 1000) / 1000 + ' ' + entry.unit : '未提供' };
  });
  const calories = (item.nutrients || {}).calories || {};
  const basisText = basis.quantity > 0 && basis.unit ? '每 ' + basis.quantity + (basis.unit === 'g' ? ' 克' : basis.unit === 'ml' ? ' 毫升' : ' 份') +
    (basis.material === 'dry_powder' ? '干粉' : basis.material === 'prepared_formula' ? '冲调液' : '') : '计量基准未提供';
  return { ...item, answers: item.answers || [], ingredients: item.ingredients || [], values, proteinText: values.find(value => value.key === 'protein').value,
    calorieText: values.find(value => value.key === 'calories').value,
    energyText: calories.state === 'known' ? Math.round(calories.value * 1000) / 1000 + ' 千卡' : '能量未提供',
    basisCaption: basisText.replace(/^每\s*/, ''),
    thumbnailUrl: typeof item.image === 'string' ? item.image : '',
    typeLabel: item.type === 'medication' ? '药物' : item.type === 'powder' ? '奶粉' : item.type === 'recipe' ? '食谱' : '食物',
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
    sourceText: item.source === 'system' ? '系统' : item.source === 'mine' ? '我的' : '饮食记录',
    estimate: Object.values((item.provenance || {}).fieldSources || {}).includes('model_estimate') };
}
function displayItem(item) {
  const result = formatItem(item);
  if (item.type === 'water') result.typeLabel = '饮水';
  if (item.type === 'milk') result.typeLabel = '喂奶';
  if (item.source === 'history') result.sourceText = '记录';
  return result;
}
Page({
  data: {
    query: '', babyName: '', tabs: TABS, tab: 'all', busy: false, moreBusy: false, previewLoading: false, preview: null,
    searchEnabled: false, capabilityError: '', capabilitiesLoading: false, scanAvailable: true, aiAvailable: false,
    hasSearched: false, catalogResult: false, recent: [], status: '', message: '', error: '', diagnosticId: '', question: null, thresholdValue: '',
    items: [], visibleItems: [], result: null, chips: [], actions: [], nextCursor: null, notesOpen: false,
    filtersOpen: false, historyOptionsOpen: false, filterKeyword: '', sources: ['全部来源', '系统', '我的'], sourceIndex: 0,
    modes: ['资料', '饮食记录', '服药记录', '喂奶记录', '饮水记录'], modeIndex: 0,
    periods: PERIODS.map(x => x.label), periodIndex: 0, startDate: '', endDate: '', historyPeriodText: '', dateRangeOpen: false,
    powderBases: ['请选择基准', '干粉', '冲调液'], powderIndex: 0, conditions: [], fields: FIELDS.map(x => LABELS[x]),
    operators: ['低于', '不高于', '等于', '不低于', '高于'], basisUnits: ['克', '毫升', '份']
  },
  onLoad() { this._unloaded = false; this._capabilityEpoch = 0; this.attachContext(); },
  async onShow() {
    try { await waitForAppInitialization(); } catch (error) { this.setData({ capabilityError: error.message || '账号信息加载失败，请重试' }); return; }
    if (this._unloaded) return;
    const current = currentContext();
    if (!this._session || this._session.accountKey !== current.accountKey || this._session.babyUid !== current.babyUid) this.attachContext();
    else if (this._session.changed()) { this.clearQuery(); this.setData({ message: '资料已更新，请重新搜索' }); }
    await this.loadCapabilities();
  },
  onUnload() { this._unloaded = true; this._capabilityEpoch++; if (this._session) this._session.dispose(); },
  attachContext() {
    if (this._session) this._session.dispose();
    const context = currentContext(); this._session = createSearchSession(context); this._contextToken = null; this._response = null; this._allowed = []; this._enabled = false; this._previewEpoch = 0;
    this._periods = PERIODS;
    this.setData({ query: '', babyName: context.babyName, searchEnabled: false, capabilityError: '', busy: false, moreBusy: false,
      items: [], visibleItems: [], result: null, question: null, recent: this._session.recent(), hasSearched: false,
      status: '', error: '', message: '', preview: null, chips: [], actions: [], nextCursor: null, filtersOpen: false,
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
      this.setData({ searchEnabled: this._enabled, aiAvailable: !!(result.ai && result.ai.available), scanAvailable: result.flags.nutrition_scan_enabled !== false,
        capabilityError: result.flags.home_search_enabled === false ? '搜索功能已关闭' : result.protocolVersion !== PROTOCOL_VERSION ? '搜索服务版本暂未就绪，请稍后重试' : '' });
      if (!this._enabled) { session.next(); this._contextToken = null; this._response = null; this.setData({ items: [], visibleItems: [], result: null, question: null, preview: null, busy: false }); }
    } catch (error) {
      if (!active()) return;
      this.setData({ capabilityError: error.message || '搜索服务暂时无法连接' });
      if (['FORBIDDEN', 'FEATURE_DISABLED'].includes(error.code)) { this._enabled = false; this.clearQuery(); this.setData({ searchEnabled: false, recent: [] }); }
    } finally { if (active()) this.setData({ capabilitiesLoading: false }); }
  },
  retryCapabilities() { if (!this.data.capabilitiesLoading) return this.loadCapabilities(); },
  onInput(event) {
    this._session.next(); this._previewEpoch++;
    this.setData({ query: event.detail.value, busy: false, moreBusy: false, items: [], visibleItems: [], result: null, question: null, preview: null,
      hasSearched: false, error: '', message: '', status: '', actions: [], chips: [], nextCursor: null, notesOpen: false });
  },
  clearQuery() { this._contextToken = null; this._response = null; this.onInput({ detail: { value: '' } }); this.setData({ filtersOpen: false, historyOptionsOpen: false, conditions: [] }); },
  async submit() {
    if (this.data.busy || !this.data.query.trim()) return;
    return this.request({});
  },
  async request(extra, append = false) {
    if (!this._enabled) { this.setData({ error: this.data.capabilityError || '搜索服务正在准备，请稍后重试' }); return; }
    const session = this._session; const token = session.next();
    const previous = this._response; const previousItems = this.data.items;
    const contextToken = this._contextToken;
    this.setData({ [append ? 'moreBusy' : 'busy']: true, error: '', hasSearched: true, preview: null, filtersOpen: false, historyOptionsOpen: false,
      ...(!append ? { items: [], visibleItems: [], result: null, question: null, message: '', actions: [], notesOpen: false } : {}) });
    try {
      const result = await service.search({ protocolVersion: PROTOCOL_VERSION, clientBuildVersion: BUILD_VERSION, babyUid: session.babyUid, requestId: service.createSearchRequestId(), query: this.data.query.trim(), contextToken: contextToken || undefined, ...extra });
      if (this._session !== session || !session.active(token)) return;
      this.reportSearchVersion(result);
      if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error('搜索服务版本暂未就绪，请稍后重试');
      if (result.resetContext) this._contextToken = null;
      else if (result.contextToken) this._contextToken = result.contextToken;
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
        else if (items.length && items.every(item => item.type === items[0].type)) tab = items[0].type;
        else tab = 'all';
      }
      session.remember(this.data.query);
      this.setData({ tab, status: result.status, message: result.message || '', diagnosticId: result.diagnosticId || '', question: result.question || null, thresholdValue: '',
        items, result: output, catalogResult: !!(result.interpretation && result.interpretation.operation.startsWith('catalog')), chips: result.chips || [], actions: result.actions || [], nextCursor: result.nextCursor || null, recent: session.recent() });
      if (result.interpretation) this.populateFilters(result.interpretation);
      this.renderItems();
    } catch (error) {
      if (this._session === session && session.active(token)) {
        if (error.code === 'FORBIDDEN') { this._contextToken = null; this._response = null; this._enabled = false; this.setData({ items: [], visibleItems: [], result: null, question: null, searchEnabled: false }); }
        this.setData({ error: error.message || '这次查询没有完成，请重试' });
      }
    } finally { if (this._session === session && session.active(token)) this.setData({ busy: false, moreBusy: false }); }
  },
  reportSearchVersion(result) {
    const version = result.buildVersion || 'unknown'; const stamp = BUILD_VERSION + ':' + version;
    if (this._versionStamp === stamp) return;
    this._versionStamp = stamp;
    console.info('[search-version]', { clientBuildVersion: BUILD_VERSION, serviceBuildVersion: version, protocolVersion: result.protocolVersion });
  },
  renderItems() { const tab = this.data.tab; this.setData({ visibleItems: this.data.items.filter(item => tab === 'all' || (tab === 'history' ? item.source === 'history' : item.type === tab)) }); },
  onTab(event) { const tab = event.currentTarget.dataset.id; if (TABS.some(x => x.id === tab)) { this.setData({ tab }); this.renderItems(); } },
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
  scan() { if (this.data.scanAvailable) wx.navigateTo({ url: '/pkg-milk/nutrition-scan/index' }); }
});
