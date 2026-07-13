const ReportRepository = require('../../models/reportRepository');
const NutritionModel = require('../../models/nutrition');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { REPORT_ENTRY_TYPES } = require('../../constants/reportTypes');
const {
  buildReportArchivePreview,
  buildReportComparePreview,
  inferDefaultCompareReportType,
  resolveCompareNutritionWindows,
  resolveCompareReportSelection
} = require('../../utils/reportWorkbench');

const REPORTS_CACHE_TTL_MS = 60000;
const ANALYSIS_REPORT_RELOAD_KEY = 'analysis_report_reload';

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDailySummaryDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date);
}

const MAIN_TABS = {
  ARCHIVE: 'archive',
  COMPARE: 'compare'
};

const ANALYSIS_REPORT_FOCUS_KEY = 'analysis_report_focus';
const COMPARE_TYPE_TABS = [
  { key: 'blood_ms', label: '血串联' },
  { key: 'urine_ms', label: '尿串联' },
  { key: 'blood_gas', label: '血气' },
  { key: 'blood_cbc', label: '血常规' },
  { key: 'blood_cbc_crp', label: '血五分类CRP' },
  { key: 'blood_biochem', label: '大生化' },
  { key: 'blood_ammonia', label: '血氨' }
];

function readFocusRequest() {
  const focus = wx.getStorageSync(ANALYSIS_REPORT_FOCUS_KEY);
  if (!focus || typeof focus !== 'object') return null;
  wx.removeStorageSync(ANALYSIS_REPORT_FOCUS_KEY);
  return focus;
}

function findPickerIndex(options = [], reportId = '') {
  const index = options.findIndex((item) => item.reportId === reportId);
  return index >= 0 ? index : 0;
}

Page({
  data: {
    mainTab: MAIN_TABS.ARCHIVE,
    loading: true,
    babyInfo: null,
    reportsCache: [],
    dailySummariesCache: [],
    nutritionSettings: {},
    fallbackWeight: '',
    selectedFilterType: 'all',
    selectedReportId: '',
    reportTypeTabs: [],
    archiveReportCards: [],
    archiveYearGroups: [],
    compareTypeTabs: COMPARE_TYPE_TABS,
    compareReportType: 'blood_ms',
    compareReportAId: '',
    compareReportBId: '',
    compareReportAIndex: 0,
    compareReportBIndex: 1,
    compareReportOptions: [],
    compareSelectedMetricKeys: [],
    compareDietVisible: false,
    compareDietLoading: false,
    currentCompareView: null,
    typePickerVisible: false,
    reportEntryTypes: REPORT_ENTRY_TYPES
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    const reloadAt = wx.getStorageSync(ANALYSIS_REPORT_RELOAD_KEY);
    if (reloadAt) {
      wx.removeStorageSync(ANALYSIS_REPORT_RELOAD_KEY);
      this.loadReportData({ force: true });
      return;
    }
    this.loadReportData().then(() => {
      if (this.data.mainTab === MAIN_TABS.COMPARE && this.data.compareDietVisible) {
        this.ensureCompareFeedingData();
      }
    });
  },

  onPullDownRefresh() {
    this.loadReportData({ force: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },
  onShareAppMessage() {
    return {
      title: '柠檬宝宝喂养记录',
      path: '/pages/role-selection/index',
      imageUrl: '/images/LemonLogo.png'
    };
  },

  async initPage() {
    try {
      const app = getApp();
      const babyInfo = app.globalData.babyInfo;

      if (!babyInfo || !babyInfo.babyUid) {
        wx.showModal({
          title: '提示',
          content: '请先完善宝宝信息',
          showCancel: false,
          success: () => {
            wx.switchTab({ url: '/pages/profile/index' });
          }
        });
        return;
      }

      this.setData({
        babyInfo,
        fallbackWeight: babyInfo.weight || ''
      });

      await this.loadReportData();
    } catch (error) {
      console.error('初始化报告分析页失败:', error);
      this.setData({ loading: false });
    }
  },

  async loadReportData(options = {}) {
    const force = options.force === true;
    if (!force
      && this.data.reportsCache?.length
      && this._reportsLoadedAt
      && Date.now() - this._reportsLoadedAt < REPORTS_CACHE_TTL_MS) {
      return;
    }

    if (this._loadReportDataPromise) {
      return this._loadReportDataPromise;
    }

    this._loadReportDataPromise = this._loadReportDataInternal()
      .finally(() => {
        this._loadReportDataPromise = null;
      });

    return this._loadReportDataPromise;
  },

  async _loadReportDataInternal() {
    if (!this.data.babyInfo) {
      this.setData({ loading: false });
      return;
    }

    try {
      this.setData({ loading: true });

      const { babyUid } = this.data.babyInfo;
      const [reports, nutritionSettings] = await Promise.all([
        ReportRepository.listReportsByBaby(babyUid, { limit: 100 }),
        NutritionModel.getNutritionSettings(babyUid).catch(() => ({}))
      ]);

      const focus = readFocusRequest();

      this.setData({
        reportsCache: reports,
        nutritionSettings: nutritionSettings || {}
      });
      this._reportsLoadedAt = Date.now();
      this._dailySummaryCacheKey = '';
      this._dailySummaryCacheLoaded = false;

      this.refreshAnalysisState({
        filterType: focus?.reportType || this.data.selectedFilterType || 'all',
        selectedReportId: focus?.reportId || this.data.selectedReportId || '',
        mainTab: focus?.mainTab || (focus?.previewMode === 'compare' ? MAIN_TABS.COMPARE : (this.data.mainTab || MAIN_TABS.ARCHIVE)),
        compareReportType: focus?.reportType && focus.reportType !== 'all'
          ? focus.reportType
          : this.data.compareReportType,
        compareReportAId: focus?.reportId || this.data.compareReportAId,
        compareReportBId: focus?.compareReportBId || this.data.compareReportBId,
        compareSelectedMetricKeys: focus?.compareMetricKeys || this.data.compareSelectedMetricKeys || []
      });
    } catch (error) {
      console.error('加载报告数据失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  async loadCompareDailySummaries(babyUid, windows = [], cacheKey = '') {
    if (!babyUid || !Array.isArray(windows) || windows.length === 0) return;

    const requestId = (this._dailySummaryRequestId || 0) + 1;
    this._dailySummaryRequestId = requestId;

    try {
      const summaryMap = new Map();

      for (const range of windows) {
        if (!range?.startDate || !range?.endDate) continue;

        // 对比趋势只读 daily_summary_v2：与首页/数据记录页同源。
        // rebuildMissing 仅在某天汇总缺失时，后台按原始记录重建该日 summary，不是直接拿原始记录算趋势。
        const summaries = await DailyRecordV2Service.getDailySummariesForRange(
          babyUid,
          range.startDate,
          range.endDate,
          { rebuildMissing: true, rebuildStaleSchema: true, maxRebuildDays: 14 }
        );

        if (this._dailySummaryRequestId !== requestId) {
          return;
        }

        (summaries || []).forEach((summary) => {
          const dateKey = normalizeDailySummaryDateKey(summary.date);
          if (dateKey) {
            summaryMap.set(dateKey, summary);
          }
        });
      }

      if (this._dailySummaryRequestId !== requestId) {
        return;
      }

      this._dailySummaryCacheKey = cacheKey;
      this._dailySummaryCacheLoaded = true;
      this.setData({
        dailySummariesCache: Array.from(summaryMap.values()),
        compareDietLoading: false
      });
      this.refreshCompareView();
    } catch (error) {
      console.warn('加载对比用 daily summary 失败:', error);
      this.setData({ compareDietLoading: false });
    }
  },

  ensureCompareFeedingData() {
    const {
      mainTab,
      babyInfo,
      compareReportAId,
      compareReportBId,
      reportsCache
    } = this.data;

    if (mainTab !== MAIN_TABS.COMPARE) {
      this.refreshCompareView();
      return;
    }

    const babyUid = babyInfo?.babyUid;
    if (!babyUid) {
      this.refreshCompareView();
      return;
    }

    const windows = resolveCompareNutritionWindows(
      reportsCache || [],
      compareReportAId,
      compareReportBId,
      this.data.compareReportType
    );
    if (windows.length === 0) {
      this.setData({
        dailySummariesCache: [],
        compareDietVisible: true,
        compareDietLoading: false
      }, () => this.refreshCompareView());
      return;
    }

    const cacheKey = windows.map((window) => `${window.startDate}_${window.endDate}`).join('|');
    if (this._dailySummaryCacheKey === cacheKey && this._dailySummaryCacheLoaded) {
      this.setData({
        compareDietVisible: true,
        compareDietLoading: false
      }, () => this.refreshCompareView());
      return;
    }

    this._dailySummaryCacheLoaded = false;
    this.setData({
      dailySummariesCache: [],
      compareDietVisible: true,
      compareDietLoading: true
    }, () => {
      this.refreshCompareView();
      this.loadCompareDailySummaries(babyUid, windows, cacheKey);
    });
  },

  refreshAnalysisState({
    filterType = this.data.selectedFilterType || 'all',
    selectedReportId = this.data.selectedReportId || '',
    mainTab = this.data.mainTab || MAIN_TABS.ARCHIVE,
    compareReportType = this.data.compareReportType,
    compareReportAId = this.data.compareReportAId,
    compareReportBId = this.data.compareReportBId,
    compareSelectedMetricKeys = this.data.compareSelectedMetricKeys || []
  } = {}) {
    const reports = this.data.reportsCache || [];
    const archive = buildReportArchivePreview({
      reports,
      filterType,
      selectedCompareReportId: selectedReportId
    });
    const activeReportId = archive.selectedCompareReportId;
    const resolvedCompareType = inferDefaultCompareReportType(reports, compareReportType || filterType);
    const compareSelection = resolveCompareReportSelection(
      reports,
      resolvedCompareType,
      compareReportAId,
      compareReportBId
    );

    this.setData({
      mainTab,
      selectedFilterType: archive.filterType,
      selectedReportId: activeReportId,
      reportTypeTabs: archive.tabs,
      archiveReportCards: archive.reportCards,
      archiveYearGroups: archive.reportYearGroups,
      compareReportType: resolvedCompareType,
      compareReportOptions: compareSelection.options,
      compareReportAId: compareSelection.reportAId,
      compareReportBId: compareSelection.reportBId,
      compareReportAIndex: compareSelection.reportAIndex,
      compareReportBIndex: compareSelection.reportBIndex,
      compareSelectedMetricKeys,
      loading: false
    }, () => {
      if (mainTab === MAIN_TABS.COMPARE && this.data.compareDietVisible) {
        this.ensureCompareFeedingData();
      } else {
        this.refreshCompareView();
      }
    });
  },

  refreshCompareView() {
    const {
      compareReportType,
      compareReportAId,
      compareReportBId,
      compareSelectedMetricKeys,
      reportsCache,
      dailySummariesCache,
      nutritionSettings,
      fallbackWeight
    } = this.data;

    const compareSelection = resolveCompareReportSelection(
      reportsCache || [],
      compareReportType,
      compareReportAId,
      compareReportBId
    );

    const currentCompareView = buildReportComparePreview({
      reportType: compareReportType,
      reportAId: compareSelection.reportAId,
      reportBId: compareSelection.reportBId,
      selectedMetricKeys: compareSelectedMetricKeys,
      reports: reportsCache || [],
      dailySummaries: dailySummariesCache || [],
      nutritionSettings: nutritionSettings || {},
      fallbackWeight,
      includeNutrition: this.data.compareDietVisible && !this.data.compareDietLoading
    });

    this.setData({
      currentCompareView,
      compareReportOptions: compareSelection.options,
      compareReportAId: compareSelection.reportAId,
      compareReportBId: compareSelection.reportBId,
      compareReportAIndex: compareSelection.reportAIndex,
      compareReportBIndex: compareSelection.reportBIndex
    });
  },

  switchMainTab(e) {
    const mainTab = e.currentTarget.dataset.tab;
    if (!mainTab || mainTab === this.data.mainTab) return;

    this.setData({ mainTab });
    if (mainTab === MAIN_TABS.COMPARE && this.data.compareDietVisible) {
      this.ensureCompareFeedingData();
    } else if (mainTab === MAIN_TABS.COMPARE) {
      this.refreshCompareView();
    }
  },

  handleTypeFilterChange(e) {
    const filterType = e.currentTarget.dataset.type;
    if (!filterType || filterType === this.data.selectedFilterType) return;

    this.refreshAnalysisState({
      filterType,
      selectedReportId: '',
      mainTab: MAIN_TABS.ARCHIVE,
      compareReportType: filterType !== 'all' ? filterType : this.data.compareReportType
    });
  },

  handleCompareTypeChange(e) {
    const reportType = e.currentTarget.dataset.type;
    if (!reportType || reportType === this.data.compareReportType) return;

    const compareSelection = resolveCompareReportSelection(
      this.data.reportsCache || [],
      reportType,
      '',
      ''
    );
    this.setData({
      compareReportType: reportType,
      compareReportOptions: compareSelection.options,
      compareReportAId: compareSelection.reportAId,
      compareReportBId: compareSelection.reportBId,
      compareReportAIndex: compareSelection.reportAIndex,
      compareReportBIndex: compareSelection.reportBIndex
    }, () => {
      this.refreshCompareAfterSelectionChange();
    });
  },

  onCompareReportAChange(e) {
    const index = Number(e.detail.value);
    const options = this.data.compareReportOptions || [];
    const option = options[index];
    if (!option) return;

    let nextBId = this.data.compareReportBId;
    if (option.reportId === nextBId) {
      const alt = options.find((item) => item.reportId !== option.reportId);
      nextBId = alt?.reportId || nextBId;
    }

    this.setData({
      compareReportAIndex: index,
      compareReportAId: option.reportId,
      compareReportBId: nextBId,
      compareReportBIndex: findPickerIndex(options, nextBId)
    }, () => {
      this.refreshCompareAfterSelectionChange();
    });
  },

  onCompareReportBChange(e) {
    const index = Number(e.detail.value);
    const options = this.data.compareReportOptions || [];
    const option = options[index];
    if (!option) return;

    let nextAId = this.data.compareReportAId;
    if (option.reportId === nextAId) {
      const alt = options.find((item) => item.reportId !== option.reportId);
      nextAId = alt?.reportId || nextAId;
    }

    this.setData({
      compareReportBIndex: index,
      compareReportBId: option.reportId,
      compareReportAId: nextAId,
      compareReportAIndex: findPickerIndex(options, nextAId)
    }, () => {
      this.refreshCompareAfterSelectionChange();
    });
  },

  onSwapCompareReports() {
    const {
      compareReportAId,
      compareReportBId,
      compareReportAIndex,
      compareReportBIndex
    } = this.data;

    if (!compareReportAId || !compareReportBId || compareReportAId === compareReportBId) {
      return;
    }

    this.setData({
      compareReportAId: compareReportBId,
      compareReportBId: compareReportAId,
      compareReportAIndex: compareReportBIndex,
      compareReportBIndex: compareReportAIndex
    }, () => {
      this.refreshCompareAfterSelectionChange();
    });
  },

  refreshCompareAfterSelectionChange() {
    if (this.data.compareDietVisible) {
      this.ensureCompareFeedingData();
      return;
    }
    this.refreshCompareView();
  },

  showCompareDiet() {
    if (this.data.compareDietLoading) return;
    this.ensureCompareFeedingData();
  },

  toggleCompareMetric(e) {
    const metricKey = e.currentTarget.dataset.key;
    if (!metricKey) return;

    const currentView = this.data.currentCompareView;
    const metricOptions = currentView?.metricOptions || [];
    const selectedKeys = metricOptions.filter((item) => item.selected).map((item) => item.key);
    const exists = selectedKeys.includes(metricKey);
    const nextKeys = exists
      ? selectedKeys.filter((key) => key !== metricKey)
      : [...selectedKeys, metricKey];

    this.setData({ compareSelectedMetricKeys: nextKeys }, () => {
      this.refreshCompareView();
    });
  },

  openDetailView(e) {
    const reportId = e.currentTarget.dataset.reportId || this.data.selectedReportId;
    if (!reportId) return;

    wx.navigateTo({
      url: `/pkg-report/report-detail/index?reportId=${reportId}`
    });
  },

  onAddReport() {
    if (this.data.mainTab === MAIN_TABS.COMPARE) {
      this.navigateToAddReport(this.data.compareReportType);
      return;
    }
    const filterType = this.data.selectedFilterType;
    if (filterType && filterType !== 'all') {
      this.navigateToAddReport(filterType);
      return;
    }
    this.setData({ typePickerVisible: true });
  },

  navigateToAddReport(typeKey) {
    const type = typeKey ? `&type=${typeKey}` : '';
    wx.navigateTo({
      url: `/pkg-report/add-report/index?mode=add${type}`
    });
  },

  onCloseTypePicker() {
    this.setData({ typePickerVisible: false });
  },

  onSelectReportType(e) {
    const typeKey = e.currentTarget.dataset.type;
    this.setData({ typePickerVisible: false });
    this.navigateToAddReport(typeKey);
  },

  stopPropagation() {},

  preventScroll() {}
});
