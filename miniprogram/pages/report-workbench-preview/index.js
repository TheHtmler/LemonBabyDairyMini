const NutritionModel = require('../../models/nutrition');
const {
  buildReportArchivePreview,
  buildReportWorkbenchView,
  toDateKey
} = require('../../utils/reportWorkbench');
const ReportModel = require('../../models/report');
const {
  waitForAppInitialization,
  getBabyUid
} = require('../../utils/index');

const DEMO_REPORTS = [
  {
    _id: 'demo-urine-current',
    reportType: ReportModel.REPORT_TYPES.URINE_MS,
    reportDate: new Date('2026-12-20T00:00:00+08:00'),
    indicators: {
      methylmalonic_acid: { value: '356', status: 'high' },
      methylcitric_acid: { value: '22.4', status: 'high' },
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
      methylcitric_acid: { value: '18.9', status: 'high' },
      hydroxypropionic_acid: { value: '6.4', status: 'normal' },
      hydroxybutyric_acid: { value: '3.1', status: 'normal' }
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
  }
];

const DEMO_FEEDING_RECORDS = [
  {
    _id: 'demo-feed-1',
    date: '2026-12-13',
    basicInfo: { weight: 5.2 },
    intakes: [
      {
        type: 'food',
        proteinSource: 'natural',
        nutrition: { calories: 120, protein: 2.8, carbs: 11, fat: 4.5 },
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

function buildDemoState(filterType = 'all', selectedCompareReportId = '') {
  const archive = buildReportArchivePreview({
    reports: DEMO_REPORTS,
    filterType,
    selectedCompareReportId
  });

  return {
    reportTypeTabs: archive.tabs,
    selectedFilterType: archive.filterType,
    archiveReportCards: archive.reportCards,
    selectedCompareReportId: archive.selectedCompareReportId,
    reportView: buildReportWorkbenchView({
      selectedReportId: archive.selectedCompareReportId,
      reports: DEMO_REPORTS,
      feedingRecords: DEMO_FEEDING_RECORDS,
      nutritionSettings: {},
      fallbackWeight: 5.2
    }),
    modeHint: '当前展示示例数据，可先确认布局和信息结构。',
    useDemoData: true
  };
}

Page({
  data: {
    reportTypeTabs: [],
    selectedFilterType: 'all',
    archiveReportCards: [],
    selectedCompareReportId: '',
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
    this.setData({
      loading: true
    });

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

      const db = wx.cloud.database();
      const reportRes = await db.collection('baby_reports')
        .where({ babyUid })
        .orderBy('reportDate', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      const reports = reportRes.data || [];
      if (!reports.length) {
        this.applyDemoState();
        return;
      }

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
        useDemoData: false,
        modeHint: '已接入真实报告与两次化验间喂养记录摘要。'
      });

      this.refreshPreviewState();
    } catch (error) {
      console.error('加载报告工作台预览失败:', error);
      this.applyDemoState();
    }
  },

  refreshPreviewState(filterType = this.data.selectedFilterType || 'all', selectedCompareReportId = this.data.selectedCompareReportId) {
    const archive = buildReportArchivePreview({
      reports: this.data.reportsCache || [],
      filterType,
      selectedCompareReportId
    });

    const reportView = buildReportWorkbenchView({
      selectedReportId: archive.selectedCompareReportId,
      reports: this.data.reportsCache || [],
      feedingRecords: this.data.feedingRecordsCache || [],
      nutritionSettings: this.data.nutritionSettings || {},
      fallbackWeight: this.data.fallbackWeight
    });

    if (!reportView) {
      this.applyDemoState();
      return;
    }

    this.setData({
      reportTypeTabs: archive.tabs,
      selectedFilterType: archive.filterType,
      archiveReportCards: archive.reportCards,
      selectedCompareReportId: archive.selectedCompareReportId,
      reportView,
      loading: false
    });
  },

  applyDemoState() {
    this.setData({
      ...buildDemoState(),
      loading: false
    });
  },

  handleTypeFilterChange(e) {
    const filterType = e.currentTarget.dataset.type;
    if (!filterType || filterType === this.data.selectedFilterType) return;

    if (this.data.useDemoData) {
      this.setData({
        ...buildDemoState(filterType),
        loading: false
      });
      return;
    }

    this.refreshPreviewState(filterType, '');
  },

  handleCompareReport(e) {
    const reportId = e.currentTarget.dataset.reportId;
    if (!reportId || reportId === this.data.selectedCompareReportId) return;

    if (this.data.useDemoData) {
      this.setData({
        ...buildDemoState(this.data.selectedFilterType, reportId),
        loading: false
      });
      return;
    }

    this.refreshPreviewState(this.data.selectedFilterType, reportId);
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
