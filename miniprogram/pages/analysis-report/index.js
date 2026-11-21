const ReportRepository = require('../../models/reportRepository');
const { buildComparisonExportDocument, showReportExport, cancelReportExport } = require('../../utils/reportExport');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { REPORT_ENTRY_TYPES } = require('../../constants/reportTypes');
const { buildReportMetricTrend } = require('../../utils/reportMetricTrend');
const {
  buildReportArchivePreview, inferDefaultCompareReportType
} = require('../../utils/reportWorkbench');
const {
  resolveMultiReportSelection, buildMultiReportComparison, resolveMultiNutritionWindows
} = require('../../utils/reportComparison');

const FOCUS_KEY = 'analysis_report_focus';
const RELOAD_KEY = 'analysis_report_reload';
const CACHE_TTL = 60000;
const TYPE_TABS = [
  { key: 'blood_ms', label: '血串联' }, { key: 'urine_ms', label: '尿串联' },
  { key: 'blood_gas', label: '血气' }, { key: 'blood_cbc', label: '血常规' },
  { key: 'blood_cbc_crp', label: '血五分类CRP' }, { key: 'blood_biochem', label: '大生化' },
  { key: 'blood_ammonia', label: '血氨' }
];
const currentBaby = () => getApp().globalData.babyInfo;
const METRIC_FILTERS = [
  { key: 'all', label: '全部指标' }, { key: 'focus', label: '重点指标' },
  { key: 'abnormal', label: '超范围' }, { key: 'pending', label: '待核对' }
];

Page({
  data: {
    mainTab: 'archive', loading: true, loadError: '', babyInfo: null, exporting: false,
    reportsCache: [], dailySummariesCache: [],
    selectedFilterType: 'all', reportTypeTabs: [], archiveReportCards: [], reportYearGroups: [],
    archiveTypeIndex: 0, archiveTypeLabel: '全部报告',
    compareTypeTabs: TYPE_TABS, compareTypeIndex: 0, compareTypeLabel: '', compareReportType: '', compareReportOptions: [],
    compareReportIds: [], compareBaselineId: '',
    reportChooserVisible: false, reportChoiceOptions: [], draftReportIds: [], reportSearch: '',
    compareSelectedMetricKeys: [], compareMetricMode: 'all',
    metricPickerVisible: false, metricPickerStage: 'mode', metricFilterOptions: METRIC_FILTERS,
    compareMetricLabel: '全部指标', metricChoiceOptions: [], draftMetricKeys: [], metricSearch: '',
    metricDetail: null, compareScrollLeft: 0, compareScrollTarget: 0,
    compareAtEnd: false, compareScrollOffsetPercent: 0,
    compareDietVisible: false, compareDietLoading: false, compareDietError: '',
    currentCompareView: null, typePickerVisible: false, reportEntryTypes: REPORT_ENTRY_TYPES
  },

  onShow() {
    if (require('../../utils/elderMode').guardNormalPage()) return;
    require('../../utils/feedback').refreshUnreadSilently();
    const force = !!wx.getStorageSync(RELOAD_KEY);
    if (force) wx.removeStorageSync(RELOAD_KEY);
    this.loadReportData({ force });
  },

  onUnload() {
    cancelReportExport(this);
    this._metricTrendRequest = null;
    this._exportDisposed = true;
    this._requestId = (this._requestId || 0) + 1;
    this._dietRequestId = (this._dietRequestId || 0) + 1;
  },

  onHide() { cancelReportExport(this); this.closeCompareDiet(); this.closeReportChooser(); this.closeMetricPicker(); this.closeMetricDetail(); },

  onPullDownRefresh() {
    this.loadReportData({ force: true }).finally(() => wx.stopPullDownRefresh());
  },

  async loadReportData({ force = false } = {}) {
    const babyInfo = currentBaby();
    const babyUid = babyInfo?.babyUid;
    if (!babyUid) {
      this._pendingCompareType = '';
      this._requestId = (this._requestId || 0) + 1;
      this._loadedAt = 0;
      this.invalidateDiet();
      this.setData({ babyInfo: null, loading: false, loadError: '请先完善宝宝信息',
        reportsCache: [], archiveReportCards: [], reportYearGroups: [], currentCompareView: null, reportTypeTabs: [],
        compareReportOptions: [], compareReportIds: [], compareBaselineId: '', compareReportType: '',
        compareSelectedMetricKeys: [], compareMetricMode: 'all', compareDietVisible: false,
        reportChooserVisible: false, reportChoiceOptions: [], draftReportIds: [],
        metricPickerVisible: false, metricDetail: null, metricChoiceOptions: [], draftMetricKeys: [],
        selectedFilterType: 'all', mainTab: 'archive', typePickerVisible: false });
      return;
    }
    if (this.data.babyInfo?.babyUid !== babyUid) {
      this._pendingCompareType = '';
      this.invalidateDiet();
      this._loadedAt = 0;
      this.setData({ babyInfo, reportsCache: [], archiveReportCards: [], reportYearGroups: [], currentCompareView: null,
        compareReportIds: [], compareBaselineId: '', compareReportType: '', selectedFilterType: 'all',
        compareSelectedMetricKeys: [], compareMetricMode: 'all', compareDietVisible: false,
        reportChooserVisible: false, reportChoiceOptions: [], draftReportIds: [],
        metricPickerVisible: false, metricDetail: null, metricChoiceOptions: [], draftMetricKeys: [],
        typePickerVisible: false, mainTab: 'archive' });
      this.resetCompareScroll();
    }
    if (!force && this._loadedAt && Date.now() - this._loadedAt < CACHE_TTL) {
      this.refreshAnalysisState(this.consumeFocus());
      return;
    }
    if (!force && this._loadingUid === babyUid && this._loadPromise) return this._loadPromise;
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    this._loadingUid = babyUid;
    const isCurrent = () => this._requestId === requestId && currentBaby()?.babyUid === babyUid;
    this.setData({ loading: !this.data.reportsCache.length, loadError: '' });
    const promise = (async () => {
      try {
        const reports = await ReportRepository.listReportsByBaby(babyUid, { limit: 100 });
        if (!isCurrent()) return;
        this.invalidateDiet();
        this.setData({ reportsCache: reports, babyInfo });
        this._loadedAt = Date.now();
        this.refreshAnalysisState(this.consumeFocus());
      } catch (error) {
        if (!isCurrent()) return;
        console.error('加载报告失败:', error);
        this._loadedAt = 0;
        this.setData({ loading: false, loadError: '报告加载失败，请重试' });
      } finally {
        if (isCurrent()) this.setData({ loading: false });
      }
    })();
    this._loadPromise = promise;
    await promise;
    if (this._loadPromise === promise) this._loadPromise = null;
  },

  consumeFocus() {
    const focus = wx.getStorageSync(FOCUS_KEY);
    if (!focus || typeof focus !== 'object') return {};
    wx.removeStorageSync(FOCUS_KEY);
    if (focus.babyUid && focus.babyUid !== this.data.babyInfo?.babyUid) return {};
    if (focus.reportId && !this.data.reportsCache.some(report => (report._id || report.id || report.reportId) === focus.reportId)) return {};
    return focus;
  },

  refreshAnalysisState(focus = {}) {
    if (focus.reportType) this._pendingCompareType = '';
    const reports = this.data.reportsCache;
    const filterType = focus.reportType || this.data.selectedFilterType;
    const archive = buildReportArchivePreview({ reports, filterType });
    const compareType = inferDefaultCompareReportType(reports, focus.reportType || this.data.compareReportType || filterType);
    const requestedIds = focus.reportId
      ? [focus.reportId, focus.compareReportBId].filter(Boolean) : this.data.compareReportIds;
    const selection = resolveMultiReportSelection(reports, compareType, requestedIds,
      focus.reportId ? focus.compareReportBId : this.data.compareBaselineId);
    const mainTab = focus.mainTab === 'compare' || focus.previewMode === 'compare' ? 'compare' : this.data.mainTab;
    const archiveTypeIndex = Math.max(0, archive.tabs.findIndex(tab => tab.key === archive.filterType));
    const compareTypeIndex = Math.max(0, TYPE_TABS.findIndex(tab => tab.key === compareType));
    this.setData({
      reportTypeTabs: archive.tabs, archiveReportCards: archive.reportCards, reportYearGroups: archive.reportYearGroups,
      archiveTypeIndex, archiveTypeLabel: archive.tabs[archiveTypeIndex]?.label || '全部报告',
      compareTypeIndex, compareTypeLabel: TYPE_TABS[compareTypeIndex].label,
      selectedFilterType: archive.filterType,
      mainTab, compareReportType: compareType,
      compareReportOptions: selection.options, compareReportIds: selection.reportIds,
      compareBaselineId: selection.baselineId,
      ...(focus.reportId ? { compareSelectedMetricKeys: [], compareMetricMode: 'all', metricDetail: null } : {}), loading: false
    });
    this.refreshCompareView();
    if (focus.reportId) this.resetCompareScroll();
    if (this.data.reportChooserVisible) this.updateReportChoices(this.data.draftReportIds);
    if (focus.requireCompareSelection && selection.options.length >= 2) this.openReportChooser();
    if (mainTab === 'compare' && this.data.compareDietVisible) this.ensureCompareFeedingData();
  },

  refreshCompareView() {
    const d = this.data;
    const previousColumns = (d.currentCompareView?.columns || []).map(column => column.reportId).join('|');
    const hadVisibleRows = !!d.currentCompareView?.compareRows.length;
    const view = buildMultiReportComparison({ reportType: d.compareReportType,
      reportIds: d.compareReportIds, baselineId: d.compareBaselineId,
      selectedMetricKeys: d.compareSelectedMetricKeys, metricMode: d.compareMetricMode, reports: d.reportsCache,
      dailySummaries: d.dailySummariesCache,
      includeNutrition: d.compareDietVisible && !d.compareDietLoading && !d.compareDietError });
    const counts = { all: view.summary.totalCount, focus: view.focusMetricKeys.length,
      abnormal: view.summary.abnormalCount, pending: view.summary.pendingCount };
    this.setData({ currentCompareView: view,
      compareMetricLabel: METRIC_FILTERS.find(item => item.key === d.compareMetricMode)?.label || '自选指标',
      metricFilterOptions: METRIC_FILTERS.map(item => ({ ...item, count: counts[item.key] }))
    });
    const nextColumns = view.columns.map(column => column.reportId).join('|');
    if (previousColumns !== nextColumns || (!hadVisibleRows && view.compareRows.length)) {
      this.resetCompareScroll();
    }
    if (d.metricDetail) this.updateMetricDetail(d.metricDetail.key);
  },

  switchMainTab(e) {
    const mainTab = e.currentTarget.dataset.tab;
    if (!['archive', 'compare'].includes(mainTab)) return;
    const tabChanged = mainTab !== this.data.mainTab;
    if (!tabChanged && mainTab === 'archive') return;
    this.closeMetricDetail();
    if (tabChanged) this.setData({ mainTab });
    if (mainTab === 'compare') {
      this.resetCompareScroll();
      const type = inferDefaultCompareReportType(this.data.reportsCache, this._pendingCompareType || this.data.compareReportType);
      this._pendingCompareType = '';
      if (type !== this.data.compareReportType) this.selectCompareType(type);
      else this.refreshCompareView();
      if (this.data.compareDietVisible) this.ensureCompareFeedingData();
    }
  },

  handleTypeFilterChange(e) {
    const type = this.data.reportTypeTabs[Number(e.detail.value)]?.key;
    if (!type) return;
    this._pendingCompareType = type === 'all' ? '' : type;
    this.setData({ selectedFilterType: type });
    this.refreshAnalysisState();
  },

  selectCompareType(type) {
    const selection = resolveMultiReportSelection(this.data.reportsCache, type);
    const compareTypeIndex = Math.max(0, TYPE_TABS.findIndex(tab => tab.key === type));
    this.setData({ compareReportType: type, compareTypeIndex, compareTypeLabel: TYPE_TABS[compareTypeIndex].label,
      compareReportOptions: selection.options,
      compareReportIds: selection.reportIds, compareBaselineId: selection.baselineId,
      reportChooserVisible: false, draftReportIds: [], reportChoiceOptions: [] });
    this.refreshCompareAfterSelectionChange();
  },

  handleCompareTypeChange(e) {
    const type = TYPE_TABS[Number(e.detail.value)]?.key;
    if (type && type !== this.data.compareReportType) this.selectCompareType(type);
  },
  openReportChooser() {
    this.setData({ reportSearch: '' });
    this.updateReportChoices(this.data.compareReportIds);
    this.setData({ reportChooserVisible: true });
  },
  closeReportChooser() { this.setData({ reportChooserVisible: false, draftReportIds: [], reportChoiceOptions: [], reportSearch: '' }); },
  updateReportChoices(ids) {
    const valid = new Set(this.data.compareReportOptions.map(option => option.reportId));
    const draftReportIds = [...new Set(ids)].filter(id => valid.has(id));
    this.setData({ draftReportIds,
      reportChoiceOptions: this.data.compareReportOptions.filter(option => (
        [option.date, option.labName, option.sameDayLabel].join(' ').toLowerCase().includes(this.data.reportSearch.trim().toLowerCase())
      )).map(option => ({
        ...option, selected: draftReportIds.includes(option.reportId)
      })) });
  },
  onReportSearch(e) { this.setData({ reportSearch: e.detail.value }); this.updateReportChoices(this.data.draftReportIds); },
  toggleReportChoice(e) {
    const id = e.currentTarget.dataset.reportId;
    const ids = this.data.draftReportIds;
    this.updateReportChoices(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  },
  selectAllReports() { this.updateReportChoices(this.data.compareReportOptions.map(option => option.reportId)); },
  selectRecentReports() { this.updateReportChoices(this.data.compareReportOptions.slice(0, 2).map(option => option.reportId)); },
  clearReportChoices() { this.updateReportChoices([]); },
  confirmReportChoices() {
    const availableIds = new Set(this.data.compareReportOptions.map(option => option.reportId));
    const validIds = this.data.draftReportIds.filter(id => availableIds.has(id));
    if (!validIds.length) {
      this.updateReportChoices(validIds);
      wx.showToast({ title: '请选择报告', icon: 'none' }); return;
    }
    const selection = resolveMultiReportSelection(this.data.reportsCache, this.data.compareReportType,
      validIds, this.data.compareBaselineId);
    this.setData({ compareReportIds: selection.reportIds, compareBaselineId: selection.baselineId });
    this.closeReportChooser();
    this.refreshCompareAfterSelectionChange();
  },
  setCompareBaseline(e) {
    const id = e.currentTarget.dataset.reportId;
    if (!this.data.compareReportIds.includes(id) || id === this.data.compareBaselineId) return;
    this.setData({ compareBaselineId: id });
    this.refreshCompareView();
    wx.showToast({ title: '已更换对照报告', icon: 'none' });
  },
  refreshCompareAfterSelectionChange() {
    this.invalidateDiet();
    this.setData({ compareSelectedMetricKeys: [], compareMetricMode: 'all', metricDetail: null });
    this.closeMetricPicker();
    this.resetCompareScroll();
    this.refreshCompareView();
    if (this.data.compareDietVisible) this.ensureCompareFeedingData();
  },

  setCompareMetricMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!['all', 'focus', 'abnormal', 'pending'].includes(mode)) return;
    this.setData({ compareMetricMode: mode, compareSelectedMetricKeys: [], metricDetail: null });
    this.closeMetricPicker();
    this.resetCompareScroll();
    this.refreshCompareView();
  },
  openMetricFilter() { this.setData({ metricPickerVisible: true, metricPickerStage: 'mode' }); },
  openMetricPicker() {
    const keys = (this.data.currentCompareView?.compareRows || []).map(row => row.key);
    this.setData({ metricPickerVisible: true, metricPickerStage: 'custom', metricSearch: '' });
    this.updateMetricChoices(keys);
  },
  closeMetricPicker() { this.setData({ metricPickerVisible: false, draftMetricKeys: [], metricChoiceOptions: [], metricSearch: '' }); },
  updateMetricChoices(keys) {
    const options = this.data.currentCompareView?.metricOptions || [];
    const validKeys = new Set(options.map(item => item.key));
    const draftMetricKeys = [...new Set(keys)].filter(key => validKeys.has(key));
    const query = this.data.metricSearch.trim().toLowerCase();
    this.setData({ draftMetricKeys, metricChoiceOptions: options.filter(item => (
      (item.name + ' ' + item.key).toLowerCase().includes(query)
    )).map(item => ({ ...item, selected: draftMetricKeys.includes(item.key) })) });
  },
  onMetricSearch(e) { this.setData({ metricSearch: e.detail.value }); this.updateMetricChoices(this.data.draftMetricKeys); },
  toggleMetricChoice(e) {
    const key = e.currentTarget.dataset.key;
    const keys = this.data.draftMetricKeys;
    this.updateMetricChoices(keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key]);
  },
  selectAllMetrics() { this.updateMetricChoices((this.data.currentCompareView?.metricOptions || []).map(item => item.key)); },
  clearMetricChoices() { this.updateMetricChoices([]); },
  confirmMetricChoices() {
    const valid = new Set((this.data.currentCompareView?.metricOptions || []).map(item => item.key));
    const keys = this.data.draftMetricKeys.filter(key => valid.has(key));
    if (!keys.length) { wx.showToast({ title: '请至少选择一个指标', icon: 'none' }); return; }
    this.setData({ compareSelectedMetricKeys: keys, compareMetricMode: 'custom' });
    this.closeMetricPicker();
    this.resetCompareScroll();
    this.refreshCompareView();
  },
  onCompareScroll(e) {
    const left = Math.max(0, Number(e.detail.scrollLeft) || 0);
    const windowWidth = wx.getWindowInfo().windowWidth;
    const pixelsPerRpx = windowWidth / 750;
    const valuesWidth = Math.max(1, (this.data.currentCompareView?.tableWidthRpx || 702) - 200);
    const maxScroll = Math.max(0, valuesWidth - 502) * pixelsPerRpx;
    if (Math.abs(left - this.data.compareScrollLeft) >= 1 || this.data.compareAtEnd !== (left >= maxScroll - 1)) {
      this.setData({ compareScrollLeft: left, compareAtEnd: left >= maxScroll - 1,
        compareScrollOffsetPercent: Math.min(Math.max(0, 100 - 502 / valuesWidth * 100), left / pixelsPerRpx / valuesWidth * 100) });
    }
  },
  resetCompareScroll() {
    // 先同步实际位置，再归零，确保重复切换报告时也能触发原生滚动属性。
    this.setData({ compareScrollTarget: this.data.compareScrollLeft }, () => {
      this.setData({ compareScrollTarget: 0, compareScrollLeft: 0, compareAtEnd: false, compareScrollOffsetPercent: 0 });
    });
  },
  openMetricDetail(e) { this.updateMetricDetail(e.currentTarget.dataset.key); },
  updateMetricDetail(key) {
    const view = this.data.currentCompareView;
    const row = view?.compareRows.find(item => item.key === key);
    if (!row) { this.closeMetricDetail(); return; }
    const columns = new Map(view.columns.map(column => [column.reportId, column]));
    const cells = row.cells.map(cell => ({ ...columns.get(cell.reportId), ...cell }));
    const validIndices = cells.flatMap((cell, index) => Number.isFinite(cell.numericValue) ? [index] : []);
    let trendIndex = -1;
    if (validIndices.length >= 2) {
      const previous = this.data.metricDetail;
      const selectedReportId = previous?.key === key ? previous.cells[previous.trendIndex]?.reportId : '';
      trendIndex = validIndices.find(index => cells[index].reportId === selectedReportId)
        ?? validIndices[validIndices.length - 1];
    }
    this._metricTrendRect = null;
    this._metricTrendRequest = null;
    this.setData({ metricDetail: { ...row, cells, trendIndex } }, () => this.measureMetricTrend());
  },
  onResize() { this.measureMetricTrend(); },
  measureMetricTrend() {
    const detail = this.data.metricDetail;
    if (!detail || detail.trendIndex < 0) return;
    const request = {};
    this._metricTrendRequest = request;
    const query = typeof this.createSelectorQuery === 'function' ? this.createSelectorQuery() : wx.createSelectorQuery().in(this);
    query.select('#report-metric-trend').boundingClientRect().exec(([rect] = []) => {
      const current = this.data.metricDetail;
      if (this._metricTrendRequest !== request || !rect || !current || current.trendIndex < 0) return;
      this._metricTrendRect = rect;
      this.setData({ 'metricDetail.trendChart': buildReportMetricTrend(current.cells, rect.width, rect.height, current.trendIndex) });
    });
  },
  onMetricTrendTap(e) {
    const detail = this.data.metricDetail;
    const rect = this._metricTrendRect;
    const chart = detail?.trendChart;
    const tapX = e.changedTouches?.[0]?.clientX ?? e.detail?.x;
    if (!rect || !chart || !Number.isFinite(tapX)) return;
    const index = Math.round((tapX - rect.left - chart.left) / chart.step);
    if (index === detail.trendIndex || !Number.isFinite(detail.cells[index]?.numericValue)) return;
    this.setData({ 'metricDetail.trendIndex': index,
      'metricDetail.trendChart': buildReportMetricTrend(detail.cells, rect.width, rect.height, index) });
  },
  closeMetricDetail() {
    this._metricTrendRequest = null;
    this._metricTrendRect = null;
    this.setData({ metricDetail: null });
  },
  onExportComparison() {
    if (!this.data.currentCompareView?.columns.length) return;
    return showReportExport(this, buildComparisonExportDocument({ view: this.data.currentCompareView,
      babyInfo: this.data.babyInfo, reportType: this.data.compareReportType }));
  },

  invalidateDiet() {
    this._dietRequestId = (this._dietRequestId || 0) + 1;
    this._dietCacheKey = '';
    this.setData({ dailySummariesCache: [], compareDietError: '', compareDietLoading: false });
  },
  openCompareDiet() {
    if (!this.data.currentCompareView?.columns.length) return;
    this.setData({ compareDietVisible: true });
    this.ensureCompareFeedingData();
  },
  showNutritionMethod() {
    wx.showModal({ title: '统计口径', showCancel: false, confirmText: '知道了',
      content: '窗口为检测前第7天至前1天。均值按有营养记录的日期计算；未记录日期不作为0。未录全食物或营养成分时，汇总量可能少于实际摄入。\n\n每公斤摄入按对应日期可用体重换算，体重可能沿用此前测量。优质占比为窗口内优质蛋白总量÷天然蛋白总量，沿用饮食模块的分类。\n\n两份报告对应指标均有7天数据时才显示差值；占比差值用百分点表示。' });
  },
  closeCompareDiet() {
    if (!this.data.compareDietVisible) return;
    // 关闭时使在途结果失效，重新打开仍可复用已成功加载的缓存。
    this._dietRequestId = (this._dietRequestId || 0) + 1;
    this.setData({ compareDietVisible: false, compareDietLoading: false });
    this.refreshCompareView();
  },
  async ensureCompareFeedingData() {
    const d = this.data;
    if (!d.compareDietVisible || !d.currentCompareView?.columns.length) return;
    const babyUid = d.babyInfo?.babyUid;
    const windows = resolveMultiNutritionWindows(d.currentCompareView.columns);
    const cacheKey = [babyUid, ...d.compareReportIds, ...windows.map(w => w.startDate + '_' + w.endDate)].join('|');
    if (this._dietCacheKey === cacheKey) { this.refreshCompareView(); return; }
    const requestId = (this._dietRequestId || 0) + 1;
    this._dietRequestId = requestId;
    const isCurrent = () => this._dietRequestId === requestId && currentBaby()?.babyUid === babyUid;
    this.setData({ compareDietLoading: true, compareDietError: '', dailySummariesCache: [] });
    try {
      // 多份报告按窗口去重，最多三路并发，避免一次发出大量重建请求。
      const groups = [];
      let nextIndex = 0;
      const worker = async () => {
        while (isCurrent() && nextIndex < windows.length) {
          const index = nextIndex++;
          const range = windows[index];
          try {
            groups[index] = await DailyRecordV2Service.getDailySummariesForRange(
              babyUid, range.startDate, range.endDate,
              { rebuildMissing: true, rebuildStaleSchema: true, maxRebuildDays: 14, strictRebuild: true });
          } catch (error) {
            nextIndex = windows.length;
            throw error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, windows.length) }, worker));
      if (!isCurrent()) return;
      const unique = new Map();
      groups.flat().forEach(summary => { if (summary?.date) unique.set(String(summary.date), summary); });
      this._dietCacheKey = cacheKey;
      this.setData({ dailySummariesCache: Array.from(unique.values()), compareDietLoading: false });
      this.refreshCompareView();
    } catch (error) {
      if (!isCurrent()) return;
      console.warn('加载报告饮食背景失败:', error);
      this.setData({ compareDietLoading: false, compareDietError: '饮食记录加载失败，请重试' });
      this.refreshCompareView();
    }
  },
  retryDiet() { this._dietCacheKey = ''; this.ensureCompareFeedingData(); },
  retryReports() { this.loadReportData({ force: true }); },

  openDetailView(e) {
    const reportId = e.currentTarget.dataset.reportId;
    const metricKey = e.currentTarget.dataset.key;
    if (reportId) wx.navigateTo({ url: '/pkg-report/report-detail/index?reportId=' + encodeURIComponent(reportId)
      + (metricKey ? '&metricKey=' + encodeURIComponent(metricKey) : '') });
  },
  editMetricReport(e) {
    const { reportId, key } = e.currentTarget.dataset;
    if (reportId && key) wx.navigateTo({ url: '/pkg-report/add-report/index?mode=edit&reportId='
      + encodeURIComponent(reportId) + '&metricKey=' + encodeURIComponent(key) });
  },
  openBabyProfile() { wx.switchTab({ url: '/pages/profile/index' }); },
  onAddReport() {
    if (!this.data.babyInfo?.babyUid) { wx.switchTab({ url: '/pages/profile/index' }); return; }
    const type = this.data.mainTab === 'compare' ? this.data.compareReportType : this.data.selectedFilterType;
    if (type && type !== 'all') this.navigateToAddReport(type);
    else this.setData({ typePickerVisible: true });
  },
  navigateToAddReport(type) { wx.navigateTo({ url: '/pkg-report/add-report/index?mode=add&type=' + encodeURIComponent(type) }); },
  onCloseTypePicker() { this.setData({ typePickerVisible: false }); },
  onSelectReportType(e) { this.onCloseTypePicker(); this.navigateToAddReport(e.currentTarget.dataset.type); },
  stopPropagation() {}, preventScroll() {},
  onShareAppMessage() { return { title: '柠檬宝宝喂养记录', path: '/pages/role-selection/index', imageUrl: '/images/LemonLogo.png' }; }
});
