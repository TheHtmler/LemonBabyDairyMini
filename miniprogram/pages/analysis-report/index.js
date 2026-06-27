const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const NutritionModel = require('../../models/nutrition');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const {
  buildReportArchivePreview,
  buildReportDetailPreview,
  buildReportTrendPreview
} = require('../../utils/reportWorkbench');

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeFeedingDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateKey(date);
}

function parseDateKey(value) {
  const key = normalizeFeedingDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(year, month - 1, day);
}

function addDays(dateKey, deltaDays) {
  const date = parseDateKey(dateKey);
  if (!date) return '';
  date.setDate(date.getDate() + deltaDays);
  return formatDateKey(date);
}

function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(num * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.round(num);
}

function hasFoodSummaryContent(food = {}) {
  return [
    food.calories,
    food.protein,
    food.naturalProtein,
    food.specialProtein,
    food.carbs,
    food.fat,
    food.fiber
  ].some(value => Number(value) > 0);
}

function hasSummaryMetricsContent(metrics = {}) {
  return [
    metrics.calories,
    metrics.protein,
    metrics.naturalProtein,
    metrics.specialProtein,
    metrics.carbs,
    metrics.fat
  ].some(value => Number(value) > 0);
}

function dailySummaryToFeedingWindowRecord(summary = {}) {
  const food = summary.food || {};
  const macroSummary = summary.macroSummary || {};
  const summaryMetrics = {
    calories: roundCalories(Number(macroSummary.calories ?? food.calories) || 0),
    protein: roundNumber(Number(macroSummary.protein ?? food.protein) || 0, 2),
    naturalProtein: roundNumber(Number(macroSummary.naturalProtein ?? food.naturalProtein) || 0, 2),
    specialProtein: roundNumber(Number(macroSummary.specialProtein ?? food.specialProtein) || 0, 2),
    carbs: roundNumber(Number(macroSummary.carbs ?? food.carbs) || 0, 2),
    fat: roundNumber(Number(macroSummary.fat ?? food.fat) || 0, 2)
  };
  const intakes = hasFoodSummaryContent(food)
    ? [{
      _id: `daily-summary-food-${summary.date || summary._id || ''}`,
      type: 'food',
      foodId: '',
      nameSnapshot: '食物汇总',
      proteinSource: 'natural',
      nutrition: {
        calories: roundCalories(Number(food.calories) || 0),
        protein: roundNumber(Number(food.protein) || 0, 2),
        naturalProtein: roundNumber(Number(food.naturalProtein) || 0, 2),
        specialProtein: roundNumber(Number(food.specialProtein) || 0, 2),
        carbs: roundNumber(Number(food.carbs) || 0, 2),
        fat: roundNumber(Number(food.fat) || 0, 2),
        fiber: roundNumber(Number(food.fiber) || 0, 2)
      },
      naturalProtein: roundNumber(Number(food.naturalProtein) || 0, 2),
      specialProtein: roundNumber(Number(food.specialProtein) || 0, 2)
    }]
    : [];

  return {
    _id: summary._id || `daily-summary-${summary.date || ''}`,
    babyUid: summary.babyUid || '',
    date: summary.date || '',
    basicInfo: { ...(summary.basicInfo || {}) },
    feedings: [],
    intakes,
    summaryMetrics: hasSummaryMetricsContent(summaryMetrics) ? summaryMetrics : null,
    source: 'daily_summary_v2'
  };
}

function mergeFeedingWindowRecord(existing, record = {}) {
  if (!existing) return record;
  return {
    ...existing,
    ...record,
    date: existing.date || record.date,
    basicInfo: {
      ...(existing.basicInfo || {}),
      ...(record.basicInfo || {})
    },
    feedings: [
      ...(Array.isArray(existing.feedings) ? existing.feedings : []),
      ...(Array.isArray(record.feedings) ? record.feedings : [])
    ],
    intakes: [
      ...(Array.isArray(existing.intakes) ? existing.intakes : []),
      ...(Array.isArray(record.intakes) ? record.intakes : [])
    ]
  };
}

const PREVIEW_MODES = {
  ARCHIVE: 'archive',
  DETAIL: 'detail',
  TREND: 'trend'
};

const ANALYSIS_REPORT_FOCUS_KEY = 'analysis_report_focus';

function getReportId(report = {}) {
  return report._id || report.id || report.reportId || '';
}

function getReportById(reports = [], reportId = '') {
  return reports.find((report) => getReportId(report) === reportId) || null;
}

function inferTrendType(filterType, reports = [], selectedReportId = '') {
  if (filterType && filterType !== 'all') return filterType;
  return getReportById(reports, selectedReportId)?.reportType || '';
}

function resolveFeedingWindowRange(reports = []) {
  const byType = (reports || []).reduce((map, report = {}) => {
    const type = report.reportType || '';
    const dateKey = normalizeFeedingDateKey(report.reportDate);
    if (!type || !dateKey) return map;
    if (!map[type]) map[type] = [];
    map[type].push({ ...report, dateKey });
    return map;
  }, {});

  let startDate = '';
  let endDate = '';
  Object.values(byType).forEach((items) => {
    const sorted = [...items].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    sorted.forEach((report, index) => {
      const previous = sorted[index - 1];
      const intervalStart = previous ? addDays(previous.dateKey, 1) : addDays(report.dateKey, -7);
      const intervalEnd = addDays(report.dateKey, -1);
      if (!intervalStart || !intervalEnd || intervalEnd < intervalStart) return;
      startDate = startDate ? (intervalStart < startDate ? intervalStart : startDate) : intervalStart;
      endDate = endDate ? (intervalEnd > endDate ? intervalEnd : endDate) : intervalEnd;
    });
  });

  return startDate && endDate ? { startDate, endDate } : null;
}

function readFocusRequest() {
  const focus = wx.getStorageSync(ANALYSIS_REPORT_FOCUS_KEY);
  if (!focus || typeof focus !== 'object') return null;
  wx.removeStorageSync(ANALYSIS_REPORT_FOCUS_KEY);
  return focus;
}

Page({
  data: {
    previewMode: PREVIEW_MODES.ARCHIVE,
    loading: true,
    babyInfo: null,
    reportsCache: [],
    feedingRecordsCache: [],
    nutritionSettings: {},
    fallbackWeight: '',
    selectedFilterType: 'all',
    selectedReportId: '',
    reportTypeTabs: [],
    archiveReportCards: [],
    currentDetailView: null,
    currentTrendView: null,
    modeHint: '按类型记录、回看和对比报告'
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    this.loadReportData();
  },

  onPullDownRefresh() {
    this.loadReportData().finally(() => {
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
            wx.switchTab({
              url: '/pages/profile/index'
            });
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

  async loadReportData() {
    if (!this.data.babyInfo) {
      // 没有宝宝信息也要清掉 loading，避免永远停在“正在整理报告档案”转圈
      this.setData({ loading: false });
      return;
    }

    try {
      this.setData({ loading: true });

      const { babyUid } = this.data.babyInfo;
      // 报告档案只依赖报告集合，先快速拉取并立即渲染；
      // 喂养数据（量大、需分页，仅趋势视图的营养对照需要）放到后台加载，绝不阻塞档案渲染与 loading 收尾。
      const [reports, nutritionSettings] = await Promise.all([
        ReportRepository.listReportsByBaby(babyUid, { limit: 100 }),
        NutritionModel.getNutritionSettings(babyUid).catch(() => ({}))
      ]);

      const focus = readFocusRequest();

      this.setData({
        reportsCache: reports,
        nutritionSettings: nutritionSettings || {}
      });

      this.refreshAnalysisState({
        filterType: focus?.reportType || this.data.selectedFilterType || 'all',
        selectedReportId: focus?.reportId || this.data.selectedReportId || '',
        previewMode: focus?.previewMode || this.data.previewMode || PREVIEW_MODES.ARCHIVE
      });

      // 后台补齐喂养营养对照数据（趋势视图用），失败/超时都不影响档案展示
      this.loadFeedingWindow(babyUid, reports);
    } catch (error) {
      console.error('加载报告数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  // 后台加载营养窗口数据：直接使用 daily_summary_v2 的按日汇总，避免为趋势卡重复拉全年原始明细。
  // 与档案渲染解耦，避免分页拉取慢/卡住时让整页一直停在 loading。
  async loadFeedingWindow(babyUid, reports = this.data.reportsCache || []) {
    if (!babyUid) return;
    try {
      const range = resolveFeedingWindowRange(reports);
      if (!range) {
        this.setData({ feedingRecordsCache: [] });
        return;
      }
      const summaries = await DailyRecordV2Service.getDailySummariesForRange(babyUid, range.startDate, range.endDate, {
        rebuildMissing: true
      });

      const recordsByDate = new Map();
      (summaries || [])
        .filter((record) => !!record.date)
        .map(dailySummaryToFeedingWindowRecord)
        .forEach((record) => {
          const dateKey = normalizeFeedingDateKey(record.date);
          recordsByDate.set(dateKey, mergeFeedingWindowRecord(recordsByDate.get(dateKey), record));
        });
      const feedingRecords = Array.from(recordsByDate.values())
        .filter(record => record.summaryMetrics || (record.feedings || []).length > 0 || (record.intakes || []).length > 0);

      this.setData({ feedingRecordsCache: feedingRecords });

      // 趋势视图依赖喂养营养对照，数据到位后刷新当前视图一次
      if (this.data.previewMode === PREVIEW_MODES.TREND) {
        this.refreshAnalysisState({
          filterType: this.data.selectedFilterType,
          selectedReportId: this.data.selectedReportId,
          previewMode: PREVIEW_MODES.TREND
        });
      }
    } catch (error) {
      console.warn('加载喂养窗口数据失败（趋势营养对照降级）:', error);
    }
  },

  refreshAnalysisState({
    filterType = this.data.selectedFilterType || 'all',
    selectedReportId = this.data.selectedReportId || '',
    previewMode = this.data.previewMode || PREVIEW_MODES.ARCHIVE
  } = {}) {
    const reports = this.data.reportsCache || [];
    const archive = buildReportArchivePreview({
      reports,
      filterType,
      selectedCompareReportId: selectedReportId
    });
    const activeReportId = archive.selectedCompareReportId;
    const trendType = inferTrendType(filterType, reports, activeReportId);

    this.setData({
      previewMode,
      selectedFilterType: archive.filterType,
      selectedReportId: activeReportId,
      reportTypeTabs: archive.tabs,
      archiveReportCards: archive.reportCards,
      currentDetailView: activeReportId ? buildReportDetailPreview({
        selectedReportId: activeReportId,
        reports
      }) : null,
      currentTrendView: trendType ? buildReportTrendPreview({
        reportType: trendType,
        selectedReportId: activeReportId,
        reports,
        feedingRecords: this.data.feedingRecordsCache || [],
        nutritionSettings: this.data.nutritionSettings || {},
        fallbackWeight: this.data.fallbackWeight
      }) : null,
      loading: false
    });
  },

  handleTypeFilterChange(e) {
    const filterType = e.currentTarget.dataset.type;
    if (!filterType || filterType === this.data.selectedFilterType) return;

    this.refreshAnalysisState({
      filterType,
      selectedReportId: '',
      previewMode: PREVIEW_MODES.ARCHIVE
    });
  },

  openDetailView(e) {
    const reportId = e.currentTarget.dataset.reportId || this.data.selectedReportId;
    if (!reportId) return;

    this.refreshAnalysisState({
      filterType: this.data.selectedFilterType,
      selectedReportId: reportId,
      previewMode: PREVIEW_MODES.DETAIL
    });
  },

  openTrendView(e) {
    const reportId = e.currentTarget.dataset.reportId || this.data.selectedReportId;
    const trendType = inferTrendType(this.data.selectedFilterType, this.data.reportsCache, reportId);
    if (!trendType) {
      wx.showToast({
        title: '先选择某一类报告',
        icon: 'none'
      });
      return;
    }

    this.refreshAnalysisState({
      filterType: trendType,
      selectedReportId: reportId,
      previewMode: PREVIEW_MODES.TREND
    });
  },

  goBackToArchive() {
    this.refreshAnalysisState({
      filterType: this.data.selectedFilterType,
      selectedReportId: this.data.selectedReportId,
      previewMode: PREVIEW_MODES.ARCHIVE
    });
  },

  openReportDetailFromTrend(e) {
    const reportId = e.currentTarget.dataset.reportId;
    if (!reportId) return;

    this.refreshAnalysisState({
      filterType: this.data.selectedFilterType,
      selectedReportId: reportId,
      previewMode: PREVIEW_MODES.DETAIL
    });
  },

  onAddReport() {
    const typeQuery = this.data.selectedFilterType && this.data.selectedFilterType !== 'all'
      ? `&type=${this.data.selectedFilterType}`
      : '';
    wx.navigateTo({
      url: `/pkg-report/add-report/index?mode=add${typeQuery}`
    });
  },

  onEditReport() {
    const reportId = this.data.selectedReportId;
    if (!reportId) return;

    wx.navigateTo({
      url: `/pkg-report/add-report/index?reportId=${reportId}&mode=edit`
    });
  },

  onDeleteReport() {
    const reportId = this.data.selectedReportId;
    if (!reportId) return;

    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这个报告吗？',
      confirmText: '删除',
      confirmColor: '#F44336',
      success: async (res) => {
        if (res.confirm) {
          await this.deleteReport(reportId);
        }
      }
    });
  },

  async deleteReport(reportId) {
    try {
      wx.showLoading({
        title: '删除中...',
        mask: true
      });
      await ReportRepository.deleteReport(reportId);
      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
      await this.loadReportData();
      this.goBackToArchive();
    } catch (error) {
      wx.hideLoading();
      console.error('删除报告失败:', error);
      wx.showToast({
        title: '删除失败',
        icon: 'none'
      });
    }
  }
});
