const ReportModel = require('../../models/report');

Page({
  data: {
    // 报告数据
    reportData: null,
    reportId: '',
    
    // 页面状态
    loading: true,
    deleting: false,
    
    // 宝宝信息
    babyInfo: null,
    
    // 报告摘要
    reportSummary: null,
    
    // 指标配置
    indicatorConfigs: []
  },

  onLoad: function (options) {
    const reportId = options.reportId;
    
    if (!reportId) {
      wx.showToast({
        title: '报告ID无效',
        icon: 'none'
      });
      wx.navigateBack();
      return;
    }

    this.setData({
      reportId: reportId
    });

    this.initPage();
  },

  // 初始化页面
  async initPage() {
    try {
      // 获取宝宝信息
      const app = getApp();
      const babyInfo = app.globalData.babyInfo;
      
      this.setData({
        babyInfo: babyInfo
      });

      // 加载报告数据
      await this.loadReportData();

    } catch (error) {
      console.error('初始化页面失败:', error);
      wx.showToast({
        title: '初始化失败',
        icon: 'none'
      });
    }
  },

  // 加载报告数据
  async loadReportData() {
    try {
      this.setData({ loading: true });

      const db = wx.cloud.database();
      const result = await db.collection('baby_reports').doc(this.data.reportId).get();
      
      const reportData = result.data;
      
      // 获取指标配置
      const indicatorConfigs = ReportModel.getIndicators(reportData.reportType);
      
      // 计算报告摘要（基于指标配置）
      const reportSummary = this.calculateReportSummary(reportData, indicatorConfigs);
      
      // 格式化报告数据
      const formattedReportData = {
        ...reportData,
        formattedDate: ReportModel.formatDate(reportData.reportDate),
        reportTypeName: ReportModel.getReportTypeName(reportData.reportType),
        formattedUpdatedAt: ReportModel.formatDateTime(reportData.updatedAt)
      };

      this.setData({
        reportData: formattedReportData,
        reportSummary: reportSummary,
        indicatorConfigs: indicatorConfigs,
        loading: false
      });

      // 设置分享内容
      this.setupShareContent();

    } catch (error) {
      console.error('加载报告数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
      
      // 延迟返回
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  // 设置分享内容
  setupShareContent() {
    const { reportData, babyInfo } = this.data;
    const babyName = babyInfo ? babyInfo.babyName || '宝宝' : '宝宝';
    
    wx.setNavigationBarTitle({
      title: `${reportData.reportTypeName}报告`
    });
  },

  // 编辑报告
  onEditReport: function () {
    wx.navigateTo({
      url: `/pages/add-report/index?reportId=${this.data.reportId}&mode=edit`
    });
  },

  // 删除报告
  onDeleteReport: function () {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这个报告吗？',
      confirmText: '删除',
      confirmColor: '#F44336',
      success: async (res) => {
        if (res.confirm) {
          await this.deleteReport();
        }
      }
    });
  },

  // 执行删除报告
  async deleteReport() {
    if (this.data.deleting) return;

    try {
      this.setData({ deleting: true });

      const db = wx.cloud.database();
      await db.collection('baby_reports').doc(this.data.reportId).remove();

      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });

      // 延迟返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (error) {
      console.error('删除报告失败:', error);
      wx.showToast({
        title: '删除失败',
        icon: 'none'
      });
      this.setData({ deleting: false });
    }
  },

  // 下拉刷新
  onPullDownRefresh: function () {
    this.loadReportData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 获取指标状态显示
  getIndicatorStatusDisplay: function (status) {
    return ReportModel.getStatusDisplay(status);
  },

  // 格式化指标值
  formatIndicatorValue: function (value, unit) {
    if (!value && value !== 0) return '-';
    return `${value} ${unit || ''}`.trim();
  },

  // 获取指标数据
  getIndicatorData: function (indicatorKey) {
    const { reportData } = this.data;
    if (!reportData || !reportData.indicators) return null;
    return reportData.indicators[indicatorKey] || null;
  },

  // 计算报告摘要（基于指标配置）
  calculateReportSummary: function (reportData, indicatorConfigs) {
    const totalCount = indicatorConfigs.length;
    let normalCount = 0;
    let abnormalCount = 0;
    let filledCount = 0;

    indicatorConfigs.forEach(config => {
      const indicatorData = reportData.indicators && reportData.indicators[config.key];
      if (indicatorData && indicatorData.value) {
        filledCount++;
        if (indicatorData.status === 'normal') {
          normalCount++;
        } else if (indicatorData.status === 'high' || indicatorData.status === 'low') {
          abnormalCount++;
        }
      }
    });

    return {
      normalCount,
      abnormalCount,
      totalCount,
      filledCount,
      normalRate: filledCount > 0 ? Math.round((normalCount / filledCount) * 100) : 0
    };
  },

  // 查看历史趋势（预留功能）
  onViewTrend: function (e) {
    const indicatorKey = e.currentTarget.dataset.indicator;
    wx.showToast({
      title: '趋势功能开发中',
      icon: 'none'
    });
  },

  // 复制报告数据
  onCopyReport: function () {
    const { reportData, indicatorConfigs } = this.data;
    
    let copyText = `${reportData.reportTypeName}报告\n`;
    copyText += `检测日期：${reportData.formattedDate}\n\n`;
    
    indicatorConfigs.forEach(config => {
      const data = this.getIndicatorData(config.key);
      if (data && data.value) {
        const statusDisplay = this.getIndicatorStatusDisplay(data.status);
        copyText += `${config.name}(${config.abbr})：${data.value} [${statusDisplay.text}]\n`;
        
        if (data.minRange && data.maxRange) {
          copyText += `  参考范围：${data.minRange} - ${data.maxRange}\n`;
        }
        
        if (data.optimalRange) {
          copyText += `  最优范围：${data.optimalRange.min} - ${data.optimalRange.max}\n`;
        }
        copyText += '\n';
      } else {
        copyText += `${config.name}(${config.abbr})：未填写\n\n`;
      }
    });

    wx.setClipboardData({
      data: copyText,
      success: () => {
        wx.showToast({
          title: '报告数据已复制',
          icon: 'success'
        });
      }
    });
  },

  // 页面分享
  onShareAppMessage: function () {
    const { reportData, babyInfo } = this.data;
    const babyName = babyInfo ? babyInfo.babyName || '宝宝' : '宝宝';
    
    return {
      title: `${babyName}的${reportData.reportTypeName}报告`,
      desc: `检测日期：${reportData.formattedDate}`,
      path: `/pages/report-detail/index?reportId=${this.data.reportId}`,
      imageUrl: '/images/LemonLogo.png'
    };
  }
}); 