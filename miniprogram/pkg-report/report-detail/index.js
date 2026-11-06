const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const { buildReportDisplay } = require('../../utils/reportDisplay');
const { buildReportComparePickerOptions } = require('../../utils/reportWorkbench');
const RELOAD_KEY = 'analysis_report_reload';
const FOCUS_KEY = 'analysis_report_focus';
const currentBaby = () => getApp().globalData.babyInfo;
const selectVisibleRows = (rows, tab, showMissing) => rows.filter(row => (
  tab === 'focus' ? row.abnormal : showMissing || row.hasValue
));

Page({
  data: {
    reportData: null, reportId: '', loading: true, loadError: '', deleting: false,
    babyInfo: null, reportSummary: null, indicatorRows: [], visibleRows: [], detailTab: 'full', showMissing: false,
    compareLabel: '选择报告对比', comparePeerId: '', hasSingleReport: false
  },
  onLoad(options) {
    if (!options.reportId) {
      this.setData({ loading: false, loadError: '报告标识无效' }); return;
    }
    this.setData({ reportId: options.reportId });
  },
  onShow() { if (this.data.reportId && !this.data.deleting) this.loadReportData(); },
  onUnload() { this._requestId = (this._requestId || 0) + 1; },
  async loadReportData() {
    const babyInfo = currentBaby();
    const babyUid = babyInfo?.babyUid;
    if (!babyUid) {
      this.setData({ reportData: null, loading: false, loadError: '请先选择宝宝' }); return;
    }
    if (this.data.babyInfo?.babyUid !== babyUid) this.setData({ reportData: null, babyInfo });
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    const isCurrent = () => this._requestId === requestId && currentBaby()?.babyUid === babyUid;
    this.setData({ loading: !this.data.reportData, loadError: '' });
    try {
      const [report, reports] = await Promise.all([
        ReportRepository.getReportById(this.data.reportId, { expectedBabyUid: babyUid }),
        ReportRepository.listReportsByBaby(babyUid, { limit: 100 }).catch(() => null)
      ]);
      if (!isCurrent()) return;
      if (!report) {
        this.setData({ reportData: null, loading: false, loadError: '未能读取报告，请重试或返回列表' }); return;
      }
      const display = buildReportDisplay(report);
      const options = reports ? buildReportComparePickerOptions(reports, report.reportType) : [];
      const current = buildReportComparePickerOptions([report], report.reportType)[0];
      const peer = options.find(item => item.reportId !== this.data.reportId && item.date < current.date);
      const hasSingleReport = reports !== null && !options.some(item => item.reportId !== this.data.reportId);
      this.setData({
        reportData: { ...report, formattedDate: ReportModel.formatDate(report.reportDate),
          reportTypeName: ReportModel.getReportTypeName(report.reportType), formattedUpdatedAt: ReportModel.formatDateTime(report.updatedAt) },
        babyInfo, reportSummary: display.summary, indicatorRows: display.rows,
        visibleRows: selectVisibleRows(display.rows, this.data.detailTab, this.data.showMissing),
        compareLabel: hasSingleReport ? '添加同类报告' : peer ? '与上一份对比' : '选择报告对比',
        comparePeerId: peer?.reportId || '', hasSingleReport, loading: false
      });
      wx.setNavigationBarTitle({ title: ReportModel.getReportTypeName(report.reportType) + '报告' });
    } catch (error) {
      if (!isCurrent()) return;
      console.error('加载报告详情失败:', error);
      this.setData({ loading: false, loadError: '报告加载失败，请重试' });
    }
  },
  switchDetailTab(e) {
    const detailTab = e.currentTarget.dataset.tab;
    this.setData({ detailTab, visibleRows: selectVisibleRows(this.data.indicatorRows, detailTab, this.data.showMissing) });
  },
  toggleMissingIndicators() {
    const showMissing = !this.data.showMissing;
    this.setData({ showMissing, visibleRows: selectVisibleRows(this.data.indicatorRows, this.data.detailTab, showMissing) });
  },
  onMoreActions() {
    if (!this.data.reportData || this.data.deleting) return;
    wx.showActionSheet({ itemList: ['复制报告', '删除报告'], success: result => {
      if (result.tapIndex === 0) this.onCopyReport();
      if (result.tapIndex === 1) this.onDeleteReport();
    } });
  },
  onCompareReport() {
    if (!this.data.reportData || this.data.deleting) return;
    if (currentBaby()?.babyUid !== this.data.babyInfo?.babyUid) { this.loadReportData(); return; }
    if (this.data.hasSingleReport) {
      wx.navigateTo({ url: '/pkg-report/add-report/index?mode=add&type=' + encodeURIComponent(this.data.reportData.reportType) }); return;
    }
    wx.setStorageSync(FOCUS_KEY, {
      babyUid: this.data.babyInfo.babyUid, reportId: this.data.reportId,
      reportType: this.data.reportData.reportType, mainTab: 'compare',
      compareReportBId: this.data.comparePeerId, requireCompareSelection: !this.data.comparePeerId
    });
    wx.switchTab({ url: '/pages/analysis-report/index' });
  },
  onEditReport() {
    if (!this.data.reportData || this.data.deleting) return;
    wx.navigateTo({ url: '/pkg-report/add-report/index?reportId=' + encodeURIComponent(this.data.reportId) + '&mode=edit' });
  },
  onDeleteReport() {
    if (this.data.deleting || !this.data.reportData) return;
    wx.showModal({ title: '确认删除', content: '删除后无法恢复，确定要删除这个报告吗？', confirmText: '删除', confirmColor: '#A54737',
      success: result => { if (result.confirm) this.deleteReport(); } });
  },
  async deleteReport() {
    if (this.data.deleting) return;
    if (currentBaby()?.babyUid !== this.data.babyInfo?.babyUid) { this.loadReportData(); return; }
    try {
      this.setData({ deleting: true });
      await ReportRepository.deleteReport(this.data.reportId);
      wx.setStorageSync(RELOAD_KEY, Date.now());
      wx.showToast({ title: '删除成功', icon: 'success' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/analysis-report/index' }) });
    } catch (error) {
      console.error('删除报告失败:', error);
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
      this.setData({ deleting: false });
    }
  },
  onCopyReport() {
    if (!this.data.reportData) return;
    const report = this.data.reportData;
    const lines = [report.reportTypeName + '报告', '检测日期：' + report.formattedDate, ''];
    if (report.labName) lines.splice(2, 0, '检测机构：' + report.labName);
    this.data.indicatorRows.forEach(row => {
      lines.push(row.name + '：' + row.valueText + (row.unit ? ' ' + row.unit : '') + ' [' + row.statusText + ']');
      if (row.rangeText) lines.push('参考范围：' + row.rangeText);
      if (row.optimalRangeText) lines.push('最优范围：' + row.optimalRangeText);
    });
    wx.setClipboardData({ data: lines.join('\n') });
  },
  onPullDownRefresh() { this.loadReportData().finally(() => wx.stopPullDownRefresh()); },
  onShareAppMessage() {
    return { title: (this.data.babyInfo?.babyName || '宝宝') + '的' + (this.data.reportData?.reportTypeName || '') + '报告',
      path: '/pkg-report/report-detail/index?reportId=' + encodeURIComponent(this.data.reportId), imageUrl: '/images/LemonLogo.png' };
  }
});
