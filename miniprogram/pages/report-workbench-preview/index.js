const NutritionModel = require('../../models/nutrition');
const ReportRepository = require('../../models/reportRepository');
const {
  buildReportArchivePreview,
  buildReportDetailPreview,
  buildReportTrendPreview,
  buildReportWorkbenchView,
  toDateKey
} = require('../../utils/reportWorkbench');
const ReportModel = require('../../models/report');
const {
  waitForAppInitialization,
  getBabyUid
} = require('../../utils/index');

const PREVIEW_MODES = {
  ARCHIVE: 'archive',
  DETAIL: 'detail',
  TREND: 'trend'
};

const DEMO_REPORTS = [
  {
    _id: 'demo-urine-current',
    reportType: ReportModel.REPORT_TYPES.URINE_MS,
    reportDate: new Date('2026-12-20T00:00:00+08:00'),
    indicators: {
      methylmalonic_acid: { value: '356', status: 'high' },
      methylcitric_acid_1: { value: '22.4', status: 'high' },
      methylcitric_acid_2: { value: '11.2', status: 'high' },
      lactate: { value: '1.4', status: 'normal' },
      hydroxypropionic_acid: { value: '6.2', status: 'normal' },
      hydroxybutyric_acid: { value: '2.8', status: 'normal' }
    }
  },
  {
    _id: 'demo-urine-previous',
    reportType: ReportModel.REPORT_TYPES.URINE_MS,
    reportDate: new Date('2026-11-12T00:00:00+08:00'),
    indicators: {
      methylmalonic_acid: { value: '298', status: 'high' },
      methylcitric_acid_1: { value: '18.9', status: 'high' },
      methylcitric_acid_2: { value: '9.6', status: 'high' },
      lactate: { value: '1.2', status: 'normal' },
      hydroxypropionic_acid: { value: '6.4', status: 'normal' },
      hydroxybutyric_acid: { value: '3.1', status: 'normal' }
    }
  },
  {
    _id: 'demo-urine-older',
    reportType: ReportModel.REPORT_TYPES.URINE_MS,
    reportDate: new Date('2026-10-08T00:00:00+08:00'),
    indicators: {
      methylmalonic_acid: { value: '280', status: 'high' },
      methylcitric_acid_1: { value: '16.7', status: 'high' },
      lactate: { value: '1.1', status: 'normal' },
      hydroxypropionic_acid: { value: '5.9', status: 'normal' },
      hydroxybutyric_acid: { value: '3.0', status: 'normal' }
    }
  },
  {
    _id: 'demo-blood-current',
    reportType: ReportModel.REPORT_TYPES.BLOOD_MS,
    reportDate: new Date('2026-12-18T00:00:00+08:00'),
    indicators: {
      iso_leu: { value: '42', status: 'normal' },
      met: { value: '18', status: 'low' },
      val: { value: '75', status: 'normal' },
      thr: { value: '66', status: 'normal' },
      c0: { value: '20', status: 'normal' },
      c2: { value: '22', status: 'normal' },
      c3: { value: '8.1', status: 'high' },
      c3_c0: { value: '0.41', status: 'high' },
      c3_c2: { value: '0.36', status: 'high' }
    }
  },
  {
    _id: 'demo-blood-previous',
    reportType: ReportModel.REPORT_TYPES.BLOOD_MS,
    reportDate: new Date('2026-11-20T00:00:00+08:00'),
    indicators: {
      iso_leu: { value: '38', status: 'normal' },
      met: { value: '20', status: 'normal' },
      val: { value: '70', status: 'normal' },
      thr: { value: '60', status: 'normal' },
      c0: { value: '21', status: 'normal' },
      c2: { value: '24', status: 'normal' },
      c3: { value: '7.2', status: 'high' },
      c3_c0: { value: '0.34', status: 'high' },
      c3_c2: { value: '0.30', status: 'high' }
    }
  }
];

const DEMO_FEEDING_RECORDS = [
  {
    _id: 'demo-feed-1',
    date: '2026-11-13',
    basicInfo: { weight: 5.2 },
    intakes: [
      {
        type: 'food',
        proteinSource: 'natural',
        nutrition: { calories: 112, protein: 2.8, carbs: 10.2, fat: 4.1 },
        naturalProtein: 2.8,
        specialProtein: 0
      }
    ],
    feedings: []
  },
  {
    _id: 'demo-feed-2',
    date: '2026-12-15',
    basicInfo: { weight: 5.2 },
    intakes: [
      {
        type: 'food',
        proteinSource: 'special',
        nutrition: { calories: 80, protein: 1.1, carbs: 6, fat: 2.2 },
        naturalProtein: 0,
        specialProtein: 1.1
      }
    ],
    feedings: []
  },
  {
    _id: 'demo-feed-3',
    date: '2026-12-19',
    basicInfo: { weight: 5.2 },
    intakes: [
      {
        type: 'food',
        proteinSource: 'natural',
        nutrition: { calories: 110, protein: 3.2, carbs: 9, fat: 3.8 },
        naturalProtein: 3.2,
        specialProtein: 0
      }
    ],
    feedings: []
  }
];

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

function buildPreviewState({
  reports = [],
  feedingRecords = [],
  nutritionSettings = {},
  fallbackWeight = 0,
  filterType = 'all',
  selectedReportId = '',
  previewMode = PREVIEW_MODES.ARCHIVE,
  useDemoData = false
}) {
  const archive = buildReportArchivePreview({
    reports,
    filterType,
    selectedCompareReportId: selectedReportId
  });
  const activeReportId = archive.selectedCompareReportId;
  const activeReport = getReportById(reports, activeReportId);
  const trendType = inferTrendType(filterType, reports, activeReportId);

  return {
    previewMode,
    reportTypeTabs: archive.tabs,
    selectedFilterType: archive.filterType,
    archiveReportCards: archive.reportCards,
    selectedReportId: activeReportId,
    currentDetailView: buildReportDetailPreview({
      selectedReportId: activeReportId,
      reports
    }),
    currentTrendView: trendType ? buildReportTrendPreview({
      reportType: trendType,
      selectedReportId: activeReportId,
      reports,
      feedingRecords,
      nutritionSettings,
      fallbackWeight
    }) : null,
    reportView: activeReport ? buildReportWorkbenchView({
      selectedReportId: activeReportId,
      reports,
      feedingRecords,
      nutritionSettings,
      fallbackWeight
    }) : null,
    modeHint: useDemoData
      ? '当前展示示例数据，可先确认档案、详情、趋势三层结构。'
      : '已接入真实报告与喂养记录，可预览完整三层流程。'
  };
}

function buildDemoState(filterType = 'all', selectedReportId = '', previewMode = PREVIEW_MODES.ARCHIVE) {
  return {
    ...buildPreviewState({
      reports: DEMO_REPORTS,
      feedingRecords: DEMO_FEEDING_RECORDS,
      nutritionSettings: {},
      fallbackWeight: 5.2,
      filterType,
      selectedReportId,
      previewMode,
      useDemoData: true
    }),
    useDemoData: true
  };
}

Page({
  data: {
    previewMode: PREVIEW_MODES.ARCHIVE,
    reportTypeTabs: [],
    selectedFilterType: 'all',
    archiveReportCards: [],
    selectedReportId: '',
    currentDetailView: null,
    currentTrendView: null,
    reportView: null,
    loading: true,
    useDemoData: false,
    modeHint: '正在加载真实报告数据…',
    nutritionSettings: null,
    reportsCache: [],
    feedingRecordsCache: [],
    fallbackWeight: ''
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '报告工作台预览'
    });
    this.loadRealReports();
  },

  async loadRealReports() {
    this.setData({ loading: true });

    try {
      await waitForAppInitialization();
      const babyUid = getBabyUid();
      if (!babyUid) {
        this.applyDemoState();
        return;
      }

      const nutritionModel = new NutritionModel();
      const nutritionSettings = await nutritionModel.getNutritionSettings(babyUid);
      const app = getApp();
      const babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
      const fallbackWeight = babyInfo.weight || '';

      const reports = await ReportRepository.listReportsByBaby(babyUid, { limit: 100 });
      if (!reports.length) {
        this.applyDemoState();
        return;
      }

      const db = wx.cloud.database();
      const feedingRes = await db.collection('feeding_records')
        .where({ babyUid })
        .orderBy('updatedAt', 'desc')
        .limit(200)
        .get();

      const feedingRecords = (feedingRes.data || []).filter((record) => !!toDateKey(record.date));

      this.setData({
        reportsCache: reports,
        feedingRecordsCache: feedingRecords,
        nutritionSettings: nutritionSettings || {},
        fallbackWeight,
        useDemoData: false
      });

      this.refreshPreviewState();
    } catch (error) {
      console.error('加载报告工作台预览失败:', error);
      this.applyDemoState();
    }
  },

  refreshPreviewState(filterType = this.data.selectedFilterType || 'all', selectedReportId = this.data.selectedReportId || '', previewMode = this.data.previewMode || PREVIEW_MODES.ARCHIVE) {
    const nextState = buildPreviewState({
      reports: this.data.reportsCache || [],
      feedingRecords: this.data.feedingRecordsCache || [],
      nutritionSettings: this.data.nutritionSettings || {},
      fallbackWeight: this.data.fallbackWeight,
      filterType,
      selectedReportId,
      previewMode,
      useDemoData: false
    });

    if (!nextState.currentDetailView) {
      this.applyDemoState();
      return;
    }

    this.setData({
      ...nextState,
      useDemoData: false,
      loading: false
    });
  },

  applyDemoState(filterType = 'all', selectedReportId = '', previewMode = PREVIEW_MODES.ARCHIVE) {
    this.setData({
      ...buildDemoState(filterType, selectedReportId, previewMode),
      loading: false
    });
  },

  handleTypeFilterChange(e) {
    const filterType = e.currentTarget.dataset.type;
    if (!filterType || filterType === this.data.selectedFilterType) return;

    if (this.data.useDemoData) {
      this.applyDemoState(filterType, '', PREVIEW_MODES.ARCHIVE);
      return;
    }

    this.refreshPreviewState(filterType, '', PREVIEW_MODES.ARCHIVE);
  },

  openDetailPreview(e) {
    const reportId = e.currentTarget.dataset.reportId || this.data.selectedReportId;
    if (!reportId) return;

    if (this.data.useDemoData) {
      this.applyDemoState(this.data.selectedFilterType, reportId, PREVIEW_MODES.DETAIL);
      return;
    }

    this.refreshPreviewState(this.data.selectedFilterType, reportId, PREVIEW_MODES.DETAIL);
  },

  openTrendPreview(e) {
    const reportId = e.currentTarget.dataset.reportId || this.data.selectedReportId;
    const trendType = inferTrendType(this.data.selectedFilterType, this.data.reportsCache, reportId) ||
      inferTrendType(this.data.selectedFilterType, DEMO_REPORTS, reportId);

    if (!trendType) {
      wx.showToast({
        title: '先选择一种报告类型或一份报告',
        icon: 'none'
      });
      return;
    }

    if (this.data.useDemoData) {
      this.applyDemoState(this.data.selectedFilterType, reportId, PREVIEW_MODES.TREND);
      return;
    }

    this.refreshPreviewState(this.data.selectedFilterType, reportId, PREVIEW_MODES.TREND);
  },

  goBackToArchive() {
    if (this.data.useDemoData) {
      this.applyDemoState(this.data.selectedFilterType, this.data.selectedReportId, PREVIEW_MODES.ARCHIVE);
      return;
    }

    this.refreshPreviewState(this.data.selectedFilterType, this.data.selectedReportId, PREVIEW_MODES.ARCHIVE);
  },

  openReportDetailFromTrend(e) {
    const reportId = e.currentTarget.dataset.reportId;
    if (!reportId) return;

    if (this.data.useDemoData) {
      this.applyDemoState(this.data.selectedFilterType, reportId, PREVIEW_MODES.DETAIL);
      return;
    }

    this.refreshPreviewState(this.data.selectedFilterType, reportId, PREVIEW_MODES.DETAIL);
  },

  goToAddReport() {
    const typeQuery = this.data.selectedFilterType && this.data.selectedFilterType !== 'all'
      ? `&type=${this.data.selectedFilterType}`
      : '';
    wx.navigateTo({
      url: `/pages/add-report/index?mode=add${typeQuery}`
    });
  },

  showPreviewToast() {
    wx.showToast({
      title: this.data.useDemoData ? '当前为示例预览' : '当前为真实数据预览',
      icon: 'none'
    });
  }
});
