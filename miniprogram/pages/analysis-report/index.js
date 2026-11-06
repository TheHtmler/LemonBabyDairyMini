const ReportRepository = require('../../models/reportRepository');
const NutritionModel = require('../../models/nutrition');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { REPORT_ENTRY_TYPES } = require('../../constants/reportTypes');
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

Page({
  data: {
    mainTab: 'archive', loading: true, loadError: '', babyInfo: null,
    reportsCache: [], nutritionSettings: {}, dailySummariesCache: [],
    selectedFilterType: 'all', reportTypeTabs: [], archiveReportCards: [], reportYearGroups: [],
    compareTypeTabs: TYPE_TABS, compareReportType: '', compareReportOptions: [],
    compareReportIds: [], compareBaselineId: '',
    reportChooserVisible: false, reportChoiceOptions: [], draftReportIds: [],
    compareSelectedMetricKeys: [], compareFilterVisible: false,
    compareFocusOnly: false,
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
    this._requestId = (this._requestId || 0) + 1;
    this._dietRequestId = (this._dietRequestId || 0) + 1;
  },

  onHide() { this.closeCompareDiet(); this.closeReportChooser(); },

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
        compareSelectedMetricKeys: [], compareDietVisible: false, reportChooserVisible: false, reportChoiceOptions: [], draftReportIds: [],
        selectedFilterType: 'all', mainTab: 'archive', typePickerVisible: false });
      return;
    }
    if (this.data.babyInfo?.babyUid !== babyUid) {
      this._pendingCompareType = '';
      this.invalidateDiet();
      this._loadedAt = 0;
      this.setData({ babyInfo, reportsCache: [], archiveReportCards: [], reportYearGroups: [], currentCompareView: null,
        compareReportIds: [], compareBaselineId: '', compareReportType: '', selectedFilterType: 'all',
        compareSelectedMetricKeys: [], compareDietVisible: false, reportChooserVisible: false, reportChoiceOptions: [], draftReportIds: [],
        compareFilterVisible: false, mainTab: 'archive' });
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
        const [reports, nutritionSettings] = await Promise.all([
          ReportRepository.listReportsByBaby(babyUid, { limit: 100 }),
          NutritionModel.getNutritionSettings(babyUid).catch(() => ({}))
        ]);
        if (!isCurrent()) return;
        this.invalidateDiet();
        this.setData({ reportsCache: reports, nutritionSettings: nutritionSettings || {}, babyInfo });
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
    this.setData({
      reportTypeTabs: archive.tabs, archiveReportCards: archive.reportCards, reportYearGroups: archive.reportYearGroups,
      selectedFilterType: archive.filterType,
      mainTab, compareReportType: compareType,
      compareReportOptions: selection.options, compareReportIds: selection.reportIds,
      compareBaselineId: selection.baselineId,
      ...(focus.reportId ? { compareSelectedMetricKeys: [], compareFocusOnly: false } : {}), loading: false
    });
    this.refreshCompareView();
    if (this.data.reportChooserVisible) this.updateReportChoices(this.data.draftReportIds);
    if (focus.requireCompareSelection && selection.options.length >= 2) this.openReportChooser();
    if (mainTab === 'compare' && this.data.compareDietVisible) this.ensureCompareFeedingData();
  },

  refreshCompareView() {
    const d = this.data;
    const view = buildMultiReportComparison({ reportType: d.compareReportType,
      reportIds: d.compareReportIds, baselineId: d.compareBaselineId,
      selectedMetricKeys: d.compareSelectedMetricKeys, reports: d.reportsCache,
      dailySummaries: d.dailySummariesCache, nutritionSettings: d.nutritionSettings,
      includeNutrition: d.compareDietVisible && !d.compareDietLoading && !d.compareDietError });
    this.setData({ currentCompareView: view });
  },

  switchMainTab(e) {
    const mainTab = e.currentTarget.dataset.tab;
    if (!['archive', 'compare'].includes(mainTab) || mainTab === this.data.mainTab) return;
    this.setData({ mainTab });
    if (mainTab === 'compare') {
      const type = inferDefaultCompareReportType(this.data.reportsCache, this._pendingCompareType || this.data.compareReportType);
      this._pendingCompareType = '';
      if (type !== this.data.compareReportType) this.selectCompareType(type);
      else this.refreshCompareView();
      if (this.data.compareDietVisible) this.ensureCompareFeedingData();
    }
  },

  handleTypeFilterChange(e) {
    const type = e.currentTarget.dataset.type;
    this._pendingCompareType = type === 'all' ? '' : type;
    this.setData({ selectedFilterType: type });
    this.refreshAnalysisState();
  },

  selectCompareType(type) {
    const selection = resolveMultiReportSelection(this.data.reportsCache, type);
    this.setData({ compareReportType: type, compareReportOptions: selection.options,
      compareReportIds: selection.reportIds, compareBaselineId: selection.baselineId,
      reportChooserVisible: false, draftReportIds: [], reportChoiceOptions: [] });
    this.refreshCompareAfterSelectionChange();
  },

  handleCompareTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    if (type !== this.data.compareReportType) this.selectCompareType(type);
  },
  openReportChooser() {
    this.updateReportChoices(this.data.compareReportIds);
    this.setData({ reportChooserVisible: true });
  },
  closeReportChooser() { this.setData({ reportChooserVisible: false, draftReportIds: [], reportChoiceOptions: [] }); },
  updateReportChoices(ids) {
    const valid = new Set(this.data.compareReportOptions.map(option => option.reportId));
    const draftReportIds = [...new Set(ids)].filter(id => valid.has(id));
    this.setData({ draftReportIds,
      reportChoiceOptions: this.data.compareReportOptions.map(option => ({
        ...option, selected: draftReportIds.includes(option.reportId)
      })) });
  },
  toggleReportChoice(e) {
    const id = e.currentTarget.dataset.reportId;
    const ids = this.data.draftReportIds;
    this.updateReportChoices(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  },
  selectAllReports() { this.updateReportChoices(this.data.compareReportOptions.map(option => option.reportId)); },
  selectRecentReports() { this.updateReportChoices(this.data.compareReportOptions.slice(0, 2).map(option => option.reportId)); },
  confirmReportChoices() {
    const availableIds = new Set(this.data.compareReportOptions.map(option => option.reportId));
    const validIds = this.data.draftReportIds.filter(id => availableIds.has(id));
    if (validIds.length < 2) {
      this.updateReportChoices(validIds);
      wx.showToast({ title: '请至少选择两份报告', icon: 'none' }); return;
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
  },
  refreshCompareAfterSelectionChange() {
    this.invalidateDiet();
    this.setData({ compareSelectedMetricKeys: [], compareFocusOnly: false });
    this.refreshCompareView();
    if (this.data.compareDietVisible) this.ensureCompareFeedingData();
  },

  toggleCompareFilter() { this.setData({ compareFilterVisible: !this.data.compareFilterVisible }); },
  setCompareMetricMode(e) {
    const focusOnly = e.currentTarget.dataset.mode === 'focus';
    this.setData({ compareFocusOnly: focusOnly, compareSelectedMetricKeys: focusOnly ? this.data.currentCompareView.focusMetricKeys : [] });
    this.refreshCompareView();
  },
  toggleCompareMetric(e) {
    const key = e.currentTarget.dataset.key;
    const options = this.data.currentCompareView?.metricOptions || [];
    if (!options.some(item => item.key === key)) return;
    const selected = options.filter(item => item.selected).map(item => item.key);
    if (selected.length === 1 && selected[0] === key) {
      wx.showToast({ title: '请至少保留一个指标', icon: 'none' }); return;
    }
    this.setData({ compareSelectedMetricKeys: selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key], compareFocusOnly: false });
    this.refreshCompareView();
  },

  invalidateDiet() {
    this._dietRequestId = (this._dietRequestId || 0) + 1;
    this._dietCacheKey = '';
    this.setData({ dailySummariesCache: [], compareDietError: '', compareDietLoading: false });
  },
  openCompareDiet() {
    if (!this.data.currentCompareView?.canCompare) return;
    this.setData({ compareDietVisible: true });
    this.ensureCompareFeedingData();
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
    if (!d.compareDietVisible || !d.currentCompareView?.canCompare) return;
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
    if (reportId) wx.navigateTo({ url: '/pkg-report/report-detail/index?reportId=' + encodeURIComponent(reportId) });
  },
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
