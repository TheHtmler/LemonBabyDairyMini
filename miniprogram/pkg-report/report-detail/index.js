const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const { buildReportDisplay } = require('../../utils/reportDisplay');
const { buildReportExportDocument, showReportExport, cancelReportExport } = require('../../utils/reportExport');
const { buildReportComparePickerOptions } = require('../../utils/reportWorkbench');
const { callOriginals } = require('../../utils/reportOriginals');
const { currentContext } = require('../../utils/searchSession');
const RELOAD_KEY = 'analysis_report_reload';
const FOCUS_KEY = 'analysis_report_focus';
const currentBaby = () => getApp().globalData.babyInfo;
const selectVisibleRows = (rows, tab, showMissing) => rows.filter(row => {
  if (tab === 'focus') return row.abnormal;
  if (tab === 'review') return row.status === 'unknown';
  return showMissing || row.hasValue;
});
const CALCULATED_RANGE_NOTE = '项目规则：下限不变，上限＝下限＋区间宽度 × 25%，非原报告参考范围。';

Page({
  data: {
    reportData: null, reportId: '', loading: true, loadError: '', deleting: false, exporting: false, openingOriginals: false,
    babyInfo: null, reportSummary: null, indicatorRows: [], visibleRows: [], detailTab: 'full', showMissing: false,
    compareLabel: '选择报告对比', comparePeerId: '', hasSingleReport: false,
    selectedIndicator: null, focusedMetricKey: '', calculatedRangeNote: CALCULATED_RANGE_NOTE
  },
  onLoad(options = {}) {
    if (!options.reportId) {
      this.setData({ loading: false, loadError: '报告标识无效' }); return;
    }
    this._pendingMetricKey = typeof options.metricKey === 'string' ? options.metricKey : '';
    this.setData({ reportId: options.reportId });
  },
  onShow() {
    this._active = true;
    if (this.data.reportId && !this.data.deleting) this.loadReportData();
  },
  onHide() {
    cancelReportExport(this);
    this._active = false;
    this._requestId = (this._requestId || 0) + 1;
    this.setData({ selectedIndicator: null });
  },
  onUnload() {
    cancelReportExport(this);
    this._unloaded = true;
    this._active = false;
    this._requestId = (this._requestId || 0) + 1;
  },
  clearReportContext(babyInfo = null) {
    this.setData({ reportData: null, babyInfo, reportSummary: null, indicatorRows: [], visibleRows: [],
      selectedIndicator: null, focusedMetricKey: '', detailTab: 'full', showMissing: false,
      compareLabel: '选择报告对比', comparePeerId: '', hasSingleReport: false });
  },
  canUseReport() {
    if (!this.data.reportData || this.data.deleting || !this._active) return false;
    if (currentBaby()?.babyUid !== this.data.babyInfo?.babyUid) {
      this.loadReportData(); return false;
    }
    return true;
  },
  async onViewOriginals() {
    if (!this.canUseReport() || this.data.openingOriginals || !this.data.reportData.originalImages?.length) return;
    const context = currentContext();
    const reportId = this.data.reportId;
    const isCurrent = () => !this._unloaded && this._active && currentContext().accountKey === context.accountKey
      && currentBaby()?.babyUid === context.babyUid && this.data.reportId === reportId;
    this.setData({ openingOriginals: true });
    try {
      const result = await callOriginals({ action: 'getOriginals', babyUid: context.babyUid, reportId,
        collection: this.data.reportData.sourceCollection });
      if (isCurrent() && result.urls?.length) await wx.previewImage({ current: result.urls[0], urls: result.urls });
    } catch (error) {
      if (isCurrent()) wx.showToast({ title: error.message || '原报告读取失败，请重试', icon: 'none' });
    } finally { if (!this._unloaded) this.setData({ openingOriginals: false }); }
  },
  async loadReportData() {
    if (this.data.deleting || this._unloaded) return;
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    const babyInfo = currentBaby();
    const babyUid = babyInfo?.babyUid;
    if (!babyUid) {
      this._pendingMetricKey = '';
      this.clearReportContext();
      this.setData({ loading: false, loadError: '请先选择宝宝' }); return;
    }
    if (this.data.babyInfo?.babyUid !== babyUid) {
      if (this.data.babyInfo) this._pendingMetricKey = '';
      this.clearReportContext(babyInfo);
    }
    const isCurrent = () => !this._unloaded && this._active && this._requestId === requestId && currentBaby()?.babyUid === babyUid;
    this.setData({ loading: !this.data.reportData, loadError: '' });
    try {
      const [report, reports] = await Promise.all([
        ReportRepository.getReportById(this.data.reportId, { expectedBabyUid: babyUid }),
        ReportRepository.listReportsByBaby(babyUid, { limit: 100 }).catch(() => null)
      ]);
      if (!isCurrent()) return;
      if (!report) {
        this.clearReportContext(babyInfo);
        this.setData({ loading: false, loadError: '未能读取报告，请重试或返回列表' }); return;
      }
      const display = buildReportDisplay(report);
      const rows = display.rows.map((row, index) => ({ ...row,
        rowId: 'report-indicator-' + index,
        rawValueText: row.hasValue ? String(report.indicators[row.key].value).trim() : '未录入'
      }));
      const options = reports ? buildReportComparePickerOptions(reports, report.reportType) : [];
      const current = buildReportComparePickerOptions([report], report.reportType)[0];
      const peer = current && options.find(item => item.reportId !== this.data.reportId && item.date < current.date);
      const hasSingleReport = reports !== null && !options.some(item => item.reportId !== this.data.reportId);
      // 深链只在本次加载成功后消费；编辑返回时重新打开同一项，避免丢失核对位置。
      const pendingKey = this._pendingMetricKey;
      const focusedRow = rows.find(row => row.key === pendingKey);
      const detailTab = focusedRow ? 'full' : this.data.detailTab;
      const showMissing = focusedRow && !focusedRow.hasValue ? true : this.data.showMissing;
      const selectedKey = focusedRow?.key || this.data.selectedIndicator?.key;
      this.setData({
        reportData: { ...report, formattedDate: ReportModel.formatDate(report.reportDate),
          reportTypeName: ReportModel.getReportTypeName(report.reportType) },
        babyInfo, reportSummary: display.summary, indicatorRows: rows, detailTab, showMissing,
        visibleRows: selectVisibleRows(rows, detailTab, showMissing),
        focusedMetricKey: focusedRow?.key || this.data.focusedMetricKey,
        selectedIndicator: rows.find(row => row.key === selectedKey) || null,
        compareLabel: hasSingleReport ? '查看报告分析' : peer ? '与上一份对比' : '选择报告对比',
        comparePeerId: peer?.reportId || '', hasSingleReport, loading: false
      }, () => {
        if (!isCurrent()) return;
        this._pendingMetricKey = '';
        if (focusedRow) wx.pageScrollTo({ selector: '#' + focusedRow.rowId, duration: 0 });
        else if (pendingKey) wx.showToast({ title: '这份报告中没有该指标', icon: 'none' });
      });
      wx.setNavigationBarTitle({ title: ReportModel.getReportTypeName(report.reportType) + '报告' });
    } catch (error) {
      if (!isCurrent()) return;
      console.error('加载报告详情失败:', error);
      this.setData({ loading: false, loadError: '报告加载失败，请重试' });
    }
  },
  switchDetailTab(e) {
    if (!this.canUseReport()) return;
    const detailTab = e.currentTarget.dataset.tab;
    if (!['full', 'focus', 'review'].includes(detailTab)) return;
    this.setData({ detailTab, selectedIndicator: null, visibleRows: selectVisibleRows(this.data.indicatorRows, detailTab, this.data.showMissing) });
  },
  toggleMissingIndicators() {
    if (!this.canUseReport()) return;
    const showMissing = !this.data.showMissing;
    this.setData({ showMissing, visibleRows: selectVisibleRows(this.data.indicatorRows, this.data.detailTab, showMissing) });
  },
  onOpenIndicator(e) {
    if (!this.canUseReport()) return;
    const row = this.data.indicatorRows.find(item => item.key === e.currentTarget.dataset.key);
    if (row) this.setData({ selectedIndicator: row, focusedMetricKey: row.key });
  },
  onCloseIndicator() { this.setData({ selectedIndicator: null }); },
  stopPanelTouchMove() {},
  onMoreActions() {
    if (!this.canUseReport()) return;
    wx.showActionSheet({ itemList: ['复制已录入内容', '删除报告'], success: result => {
      if (!this.canUseReport()) return;
      if (result.tapIndex === 0) this.onCopyReport();
      if (result.tapIndex === 1) this.onDeleteReport();
    } });
  },
  onExportReport() {
    if (!this.canUseReport()) return;
    return showReportExport(this, buildReportExportDocument({ report: this.data.reportData,
      babyInfo: this.data.babyInfo, rows: this.data.indicatorRows }));
  },
  onCompareReport() {
    if (!this.canUseReport()) return;
    wx.setStorageSync(FOCUS_KEY, {
      babyUid: this.data.babyInfo.babyUid, reportId: this.data.reportId,
      reportType: this.data.reportData.reportType, mainTab: 'compare',
      compareReportBId: this.data.comparePeerId,
      requireCompareSelection: !this.data.hasSingleReport && !this.data.comparePeerId
    });
    wx.switchTab({ url: '/pages/analysis-report/index' });
  },
  onEditReport(e) {
    if (!this.canUseReport()) return;
    const metricKey = e?.currentTarget?.dataset?.key || this.data.selectedIndicator?.key || '';
    const selectedRow = this.data.indicatorRows.find(row => row.key === metricKey);
    this._pendingMetricKey = selectedRow?.key || '';
    const metricQuery = selectedRow ? '&metricKey=' + encodeURIComponent(selectedRow.key) : '';
    this.setData({ selectedIndicator: null });
    wx.navigateTo({ url: '/pkg-report/add-report/index?reportId=' + encodeURIComponent(this.data.reportId) + '&mode=edit' + metricQuery,
      fail: () => wx.showToast({ title: '未能打开编辑页，请重试', icon: 'none' }) });
  },
  onDeleteReport() {
    if (!this.canUseReport()) return;
    wx.showModal({ title: '确认删除', content: '删除后无法恢复，确定要删除这个报告吗？', confirmText: '删除', confirmColor: '#A54737',
      success: result => { if (result.confirm) this.deleteReport(); } });
  },
  async deleteReport() {
    if (!this.canUseReport()) return;
    const babyUid = this.data.babyInfo.babyUid;
    // 删除期间废弃尚未完成的详情请求，防止旧内容在删除后重新显示。
    this._requestId = (this._requestId || 0) + 1;
    try {
      this.setData({ deleting: true, selectedIndicator: null });
      await ReportRepository.deleteReport(this.data.reportId);
      wx.setStorageSync(RELOAD_KEY, Date.now());
      if (this._unloaded) return;
      this.clearReportContext(currentBaby());
      this.setData({ deleting: false, loading: false, loadError: '报告已删除，请返回列表' });
      if (!this._active || currentBaby()?.babyUid !== babyUid) return;
      wx.showToast({ title: '删除成功', icon: 'success' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/analysis-report/index' }) });
    } catch (error) {
      console.error('删除报告失败:', error);
      if (this._unloaded) return;
      this.setData({ deleting: false });
      if (!this._active) return;
      if (currentBaby()?.babyUid !== babyUid) { this.loadReportData(); return; }
      wx.showToast({ title: '删除失败，请重试', icon: 'none' });
    }
  },
  onCopyReport() {
    if (!this.canUseReport()) return;
    const report = this.data.reportData;
    const rows = this.data.indicatorRows.filter(row => row.hasValue);
    if (!rows.length) { wx.showToast({ title: '尚无已录入的检测值', icon: 'none' }); return; }
    const lines = [report.reportTypeName + '报告', '宝宝：' + (this.data.babyInfo.babyName || '未填写姓名'),
      '检测日期：' + report.formattedDate, '检测机构：' + (report.labName || '未录入'),
      '已录入 ' + rows.length + ' 项', ''];
    rows.forEach(row => {
      lines.push(row.name + '：' + row.rawValueText + ' [' + row.statusText + ']');
      lines.push('参考范围：' + (row.rangeText || '未录入'));
      if (row.unknownReason) lines.push('待核对原因：' + row.unknownReason);
      if (row.optimalRangeText) lines.push('项目计算范围：' + row.optimalRangeText);
      lines.push('');
    });
    lines.push('参考范围为已录入内容，请对照本次原报告核实。');
    if (rows.some(row => row.optimalRangeText)) lines.push(CALCULATED_RANGE_NOTE);
    wx.setClipboardData({ data: lines.join('\n') });
  },
  onPullDownRefresh() { this.loadReportData().finally(() => wx.stopPullDownRefresh()); },
  onBackToReports() { wx.switchTab({ url: '/pages/analysis-report/index' }); },
  onShareAppMessage() {
    return { title: (this.data.babyInfo?.babyName || '宝宝') + '的' + (this.data.reportData?.reportTypeName || '') + '报告',
      path: '/pkg-report/report-detail/index?reportId=' + encodeURIComponent(this.data.reportId), imageUrl: '/images/LemonLogo.png' };
  }
});
