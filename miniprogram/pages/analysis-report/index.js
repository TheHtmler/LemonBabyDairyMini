const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const InvitationModel = require('../../models/invitation');
const NutritionModel = require('../../models/nutrition');
const {
  buildReportArchivePreview,
  buildReportDetailPreview,
  buildReportTrendPreview
} = require('../../utils/reportWorkbench');
const {
  groupV2FeedingRecordsByDate
} = require('../../utils/dataRecordsV2Adapter');

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
    const app = getApp();
    const babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
    const inviteCode = babyInfo.inviteCode;
    if (inviteCode) {
      return InvitationModel.getShareInfo(inviteCode, babyInfo.name);
    }
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
    if (!this.data.babyInfo) return;

    try {
      this.setData({ loading: true });

      const { babyUid } = this.data.babyInfo;
      const db = wx.cloud.database();
      const [reports, feedingRes, v2MilkRecords, nutritionSettings] = await Promise.all([
        ReportRepository.listReportsByBaby(babyUid, { limit: 100 }),
        db.collection('feeding_records')
          .where({ babyUid })
          .orderBy('date', 'desc')
          .limit(365)
          .get(),
        this.loadV2MilkRecords(babyUid),
        NutritionModel.getNutritionSettings(babyUid).catch(() => ({}))
      ]);

      const legacyRecords = (feedingRes.data || []).filter((record) => !!record.date);
      // 奶统计切到 v2：奶来自 feeding_records_v2，旧 feeding_records 仅保留食物/基础信息。
      // 同一天若有 v2 奶记录则以 v2 为准（剥离旧奶 feedings），避免与旧数据双计。
      const v2MilkByDate = groupV2FeedingRecordsByDate(v2MilkRecords, babyUid);
      const feedingRecords = legacyRecords.map((record) => (
        v2MilkByDate.has(normalizeFeedingDateKey(record.date))
          ? { ...record, feedings: [] }
          : record
      ));
      v2MilkByDate.forEach((dailyRecord) => {
        feedingRecords.push(dailyRecord);
      });
      const focus = readFocusRequest();

      this.setData({
        reportsCache: reports,
        feedingRecordsCache: feedingRecords,
        nutritionSettings: nutritionSettings || {}
      });

      this.refreshAnalysisState({
        filterType: focus?.reportType || this.data.selectedFilterType || 'all',
        selectedReportId: focus?.reportId || this.data.selectedReportId || '',
        previewMode: focus?.previewMode || this.data.previewMode || PREVIEW_MODES.ARCHIVE
      });
    } catch (error) {
      console.error('加载报告数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  // 读取近一年的 v2 喂奶记录作为奶统计数据源。失败返回空数组，自动降级回旧数据，避免页面崩溃。
  async loadV2MilkRecords(babyUid) {
    if (!babyUid) {
      return [];
    }
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 365);
      const startKey = formatDateKey(cutoff);
      const MAX_LIMIT = 20;
      let all = [];
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await db.collection('feeding_records_v2')
          .where({
            babyUid,
            status: 'active',
            date: _.gte(startKey)
          })
          .orderBy('date', 'desc')
          .skip(skip)
          .limit(MAX_LIMIT)
          .get();
        const batch = res.data || [];
        all = all.concat(batch);
        skip += batch.length;
        if (batch.length < MAX_LIMIT) {
          hasMore = false;
        }
      }
      return all;
    } catch (error) {
      console.warn('加载 v2 喂奶记录失败，报告营养窗口降级为旧数据:', error);
      return [];
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
