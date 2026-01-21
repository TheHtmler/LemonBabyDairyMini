// pages/analysis-report/index.js
const ReportModel = require('../../models/report');
const InvitationModel = require('../../models/invitation');

Page({

  /**
   * 页面的初始数据
   */
  data: {
    // 统计信息
    statistics: {
      totalReports: 0,
      normalRate: 0,
      lastReportDate: '',
      abnormalCount: 0
    },
    
    // 报告列表
    reportList: [],
    
    // 加载状态
    loading: true,
    loadingMore: false,
    hasMore: true,
    
    // 筛选条件
    filterType: 'all', // all, blood_ms, urine_ms, blood_gas, blood_ammonia
    
    // 页面配置
    pageSize: 10,
    currentPage: 1,
    
    // 宝宝信息
    babyInfo: null
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.initPage();
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 每次显示页面时刷新数据
    this.loadReportData();
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.loadReportData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadReportData(true);
  },

  /**
   * 用户点击右上角分享
   */
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

  // 初始化页面
  async initPage() {
    try {
      // 获取宝宝信息
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
        babyInfo: babyInfo
      });

      // 加载报告数据
      await this.loadReportData();
    } catch (error) {
      console.error('初始化页面失败:', error);
      this.setData({
        loading: false
      });
    }
  },

  // 加载报告数据
  async loadReportData(isLoadMore = false) {
    if (!this.data.babyInfo) return;

    try {
      if (!isLoadMore) {
        this.setData({
          loading: true,
          currentPage: 1
        });
      } else {
        this.setData({
          loadingMore: true
        });
      }

      const db = wx.cloud.database();
      const { babyUid } = this.data.babyInfo;
      const { pageSize, currentPage, filterType } = this.data;
      
      // 构建查询条件
      let query = db.collection('baby_reports').where({
        babyUid: babyUid
      });

      // 添加类型筛选
      if (filterType !== 'all') {
        query = query.where({
          reportType: filterType
        });
      }

      // 分页查询
      const skip = (currentPage - 1) * pageSize;
      const result = await query
        .orderBy('reportDate', 'desc')
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(pageSize)
        .get();

      const newReports = result.data.map(report => {
        // 计算报告摘要
        const summary = ReportModel.getReportSummary(report);
        return {
          ...report,
          summary: summary,
          reportTypeName: ReportModel.getReportTypeName(report.reportType),
          formattedDate: ReportModel.formatDate(report.reportDate)
        };
      });

      // 更新列表数据
      let reportList = [];
      if (isLoadMore) {
        reportList = [...this.data.reportList, ...newReports];
      } else {
        reportList = newReports;
      }

      // 检查是否还有更多数据
      const hasMore = newReports.length === pageSize;

      this.setData({
        reportList: reportList,
        hasMore: hasMore,
        currentPage: isLoadMore ? currentPage + 1 : 1,
        loading: false,
        loadingMore: false
      });

      // 如果是首次加载，计算统计信息
      if (!isLoadMore) {
        await this.calculateStatistics();
      }

    } catch (error) {
      console.error('加载报告数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({
        loading: false,
        loadingMore: false
      });
    }
  },

  // 计算统计信息
  async calculateStatistics() {
    if (!this.data.babyInfo) return;

    try {
      const db = wx.cloud.database();
      const { babyUid } = this.data.babyInfo;

      // 获取所有报告数据
      const result = await db.collection('baby_reports').where({
        babyUid: babyUid
      }).get();

      const allReports = result.data;
      const totalReports = allReports.length;

      if (totalReports === 0) {
        this.setData({
          statistics: {
            totalReports: 0,
            normalRate: 0,
            lastReportDate: '',
            abnormalCount: 0
          }
        });
        return;
      }

      // 计算统计信息
      let totalNormalCount = 0;
      let totalIndicatorCount = 0;
      let abnormalReportCount = 0;
      let lastReportDate = '';

      allReports.forEach(report => {
        const summary = ReportModel.getReportSummary(report);
        totalNormalCount += summary.normalCount;
        totalIndicatorCount += summary.totalCount;
        
        if (summary.abnormalCount > 0) {
          abnormalReportCount++;
        }

        // 找到最新的报告日期
        if (!lastReportDate || report.reportDate > lastReportDate) {
          lastReportDate = report.reportDate;
        }
      });

      const normalRate = totalIndicatorCount > 0 ? 
        Math.round((totalNormalCount / totalIndicatorCount) * 100) : 0;

      this.setData({
        statistics: {
          totalReports: totalReports,
          normalRate: normalRate,
          lastReportDate: ReportModel.formatDate(lastReportDate),
          abnormalCount: abnormalReportCount
        }
      });

    } catch (error) {
      console.error('计算统计信息失败:', error);
    }
  },

  // 筛选报告类型
  onFilterChange: function (e) {
    const filterType = e.currentTarget.dataset.type;
    if (filterType === this.data.filterType) return;

    this.setData({
      filterType: filterType
    });
    
    this.loadReportData();
  },

  // 跳转到添加报告页面
  onAddReport: function () {
    wx.navigateTo({
      url: '/pages/add-report/index'
    });
  },

  // 查看报告详情
  onViewReport: function (e) {
    const reportId = e.currentTarget.dataset.reportId;
    wx.navigateTo({
      url: `/pages/report-detail/index?reportId=${reportId}`
    });
  },

  // 编辑报告
  onEditReport: function (e) {
    const reportId = e.currentTarget.dataset.reportId;
    wx.navigateTo({
      url: `/pages/add-report/index?reportId=${reportId}&mode=edit`
    });
  },

  // 删除报告
  onDeleteReport: function (e) {
    const reportId = e.currentTarget.dataset.reportId;
    const reportIndex = e.currentTarget.dataset.index;
    
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这个报告吗？',
      confirmText: '删除',
      confirmColor: '#F44336',
      success: async (res) => {
        if (res.confirm) {
          await this.deleteReport(reportId, reportIndex);
        }
      }
    });
  },

  // 执行删除报告
  async deleteReport(reportId, reportIndex) {
    try {
      wx.showLoading({
        title: '删除中...',
        mask: true
      });

      const db = wx.cloud.database();
      await db.collection('baby_reports').doc(reportId).remove();

      // 更新本地数据
      const reportList = [...this.data.reportList];
      reportList.splice(reportIndex, 1);
      
      this.setData({
        reportList: reportList
      });

      // 重新计算统计信息
      await this.calculateStatistics();

      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });

    } catch (error) {
      wx.hideLoading();
      console.error('删除报告失败:', error);
      wx.showToast({
        title: '删除失败',
        icon: 'none'
      });
    }
  },

  // 获取报告类型筛选器数据
  getFilterOptions: function () {
    return [
      { key: 'all', name: '全部', icon: '📊' },
      { key: ReportModel.REPORT_TYPES.BLOOD_MS, name: '血串联质谱', icon: '🩸' },
      { key: ReportModel.REPORT_TYPES.URINE_MS, name: '尿串联质谱', icon: '🧪' },
      { key: ReportModel.REPORT_TYPES.BLOOD_GAS, name: '血气分析', icon: '💨' },
      { key: ReportModel.REPORT_TYPES.BLOOD_AMMONIA, name: '血氨检测', icon: '⚡' }
    ];
  },

  // 分享报告数据
  onShareReport: function (e) {
    const report = e.currentTarget.dataset.report;
    const babyName = this.data.babyInfo.babyName || '宝宝';
    
    return {
      title: `${babyName}的${report.reportTypeName}报告`,
      desc: `检测日期：${report.formattedDate}`,
      path: `/pages/report-detail/index?reportId=${report._id}`,
      imageUrl: '/images/LemonLogo.png'
    };
  }
})
