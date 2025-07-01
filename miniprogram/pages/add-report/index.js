const ReportModel = require('../../models/report');

Page({
  data: {
    // 页面模式
    mode: 'add', // add 或 edit
    reportId: '',
    
    // 基础信息
    babyInfo: null,
    reportDate: '',
    selectedReportType: 'blood_ms',
    
    // 报告类型配置
    reportTypes: [
      { key: 'blood_ms', name: '血串联质谱', icon: '🩸' },
      { key: 'urine_ms', name: '尿串联质谱', icon: '🧪' },
      { key: 'blood_gas', name: '血气分析', icon: '💨' },
      { key: 'blood_ammonia', name: '血氨检测', icon: '⚡' }
    ],
    
    // 当前指标配置
    currentIndicators: [],
    
    // 指标数据
    indicatorData: {},
    
    // 页面状态
    loading: false,
    saving: false,
    hasUnsavedChanges: false
  },

  onLoad: function (options) {
    const mode = options.mode || 'add';
    const reportId = options.reportId || '';
    
    this.setData({
      mode: mode,
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
      
      if (!babyInfo || !babyInfo.babyUid) {
        wx.showModal({
          title: '提示',
          content: '请先完善宝宝信息',
          showCancel: false,
          success: () => {
            wx.navigateBack();
          }
        });
        return;
      }

      this.setData({
        babyInfo: babyInfo,
        reportDate: this.getCurrentDate()
      });

      // 如果是编辑模式，加载报告数据
      if (this.data.mode === 'edit' && this.data.reportId) {
        await this.loadReportData();
      } else {
        // 新建模式，初始化指标
        this.initIndicators();
      }

    } catch (error) {
      console.error('初始化页面失败:', error);
      wx.showToast({
        title: '初始化失败',
        icon: 'none'
      });
    }
  },

  // 加载报告数据（编辑模式）
  async loadReportData() {
    try {
      this.setData({ loading: true });

      const db = wx.cloud.database();
      const result = await db.collection('baby_reports').doc(this.data.reportId).get();
      
      const reportData = result.data;
      
      this.setData({
        reportDate: ReportModel.formatDate(reportData.reportDate),
        selectedReportType: reportData.reportType,
        indicatorData: reportData.indicators || {},
        loading: false
      });

      // 初始化指标配置
      this.initIndicators();

    } catch (error) {
      console.error('加载报告数据失败:', error);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  // 获取当前日期
  getCurrentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 初始化指标配置
  initIndicators() {
    const indicators = ReportModel.getIndicators(this.data.selectedReportType);
    const indicatorData = { ...this.data.indicatorData };

    // 初始化空的指标数据
    indicators.forEach(indicator => {
      if (!indicatorData[indicator.key]) {
        indicatorData[indicator.key] = {
          value: '',
          minRange: '',
          maxRange: '',
          status: 'unknown',
          optimalRange: null
        };
      }
    });

    this.setData({
      currentIndicators: indicators,
      indicatorData: indicatorData
    });

    // 重新计算所有指标状态
    this.recalculateAllIndicators();
  },

  // 日期选择
  onDateChange: function (e) {
    this.setData({
      reportDate: e.detail.value,
      hasUnsavedChanges: true
    });
  },

  // 切换报告类型
  onReportTypeChange: function (e) {
    const reportType = e.currentTarget.dataset.type;
    
    if (reportType === this.data.selectedReportType) return;

    // 如果有未保存的数据，提示用户
    if (this.data.hasUnsavedChanges) {
      wx.showModal({
        title: '切换类型',
        content: '切换报告类型将清空当前输入的数据，确定要切换吗？',
        success: (res) => {
          if (res.confirm) {
            this.switchReportType(reportType);
          }
        }
      });
    } else {
      this.switchReportType(reportType);
    }
  },

  // 执行报告类型切换
  switchReportType(reportType) {
    this.setData({
      selectedReportType: reportType,
      indicatorData: {},
      hasUnsavedChanges: false
    });
    
    this.initIndicators();
  },

  // 指标值输入
  onIndicatorValueInput: function (e) {
    const { indicator, field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    const indicatorData = { ...this.data.indicatorData };
    if (!indicatorData[indicator]) {
      indicatorData[indicator] = {};
    }
    
    indicatorData[indicator][field] = value;
    
    this.setData({
      indicatorData: indicatorData,
      hasUnsavedChanges: true
    });

    // 重新计算该指标状态
    this.calculateIndicatorStatus(indicator);
  },

  // 计算单个指标状态
  calculateIndicatorStatus(indicatorKey) {
    const data = this.data.indicatorData[indicatorKey];
    if (!data || !data.value || !data.minRange || !data.maxRange) {
      return;
    }

    // 计算状态
    const status = ReportModel.calculateIndicatorStatus(
      data.value, 
      data.minRange, 
      data.maxRange
    );

    // 计算最优范围（仅限氨基酸指标）
    let optimalRange = null;
    if (ReportModel.isAminoAcidIndicator(indicatorKey)) {
      optimalRange = ReportModel.calculateOptimalRange(
        data.minRange, 
        data.maxRange
      );
    }

    // 更新状态
    const indicatorData = { ...this.data.indicatorData };
    indicatorData[indicatorKey] = {
      ...indicatorData[indicatorKey],
      status: status,
      optimalRange: optimalRange
    };

    this.setData({
      indicatorData: indicatorData
    });

    // 计算比值指标
    this.calculateRatioIndicators();
  },

  // 计算比值指标
  calculateRatioIndicators() {
    const { indicatorData, selectedReportType } = this.data;
    
    if (selectedReportType === 'blood_ms') {
      // 计算 C3/C0
      if (indicatorData.c3 && indicatorData.c0 && 
          indicatorData.c3.value && indicatorData.c0.value) {
        const ratio = ReportModel.calculateRatio(
          indicatorData.c3.value, 
          indicatorData.c0.value
        );
        
        if (ratio !== null) {
          const newIndicatorData = { ...indicatorData };
          if (!newIndicatorData.c3_c0) {
            newIndicatorData.c3_c0 = {};
          }
          newIndicatorData.c3_c0.value = ratio.toString();
          
          this.setData({ indicatorData: newIndicatorData });
        }
      }

      // 计算 C3/C2
      if (indicatorData.c3 && indicatorData.c2 && 
          indicatorData.c3.value && indicatorData.c2.value) {
        const ratio = ReportModel.calculateRatio(
          indicatorData.c3.value, 
          indicatorData.c2.value
        );
        
        if (ratio !== null) {
          const newIndicatorData = { ...indicatorData };
          if (!newIndicatorData.c3_c2) {
            newIndicatorData.c3_c2 = {};
          }
          newIndicatorData.c3_c2.value = ratio.toString();
          
          this.setData({ indicatorData: newIndicatorData });
        }
      }
    }
  },

  // 重新计算所有指标状态
  recalculateAllIndicators() {
    this.data.currentIndicators.forEach(indicator => {
      if (!indicator.isRatio) {
        this.calculateIndicatorStatus(indicator.key);
      }
    });
  },

  // 保存报告
  async onSaveReport() {
    if (this.data.saving) return;

    try {
      // 验证数据
      const validation = this.validateReportData();
      if (!validation.isValid) {
        wx.showModal({
          title: '数据验证失败',
          content: validation.errors.join('\n'),
          showCancel: false
        });
        return;
      }

      this.setData({ saving: true });

      const { babyInfo, reportDate, selectedReportType, indicatorData, mode, reportId } = this.data;
      
      // 创建报告数据
      const reportData = ReportModel.createReportData(
        babyInfo.babyUid,
        new Date(reportDate),
        selectedReportType,
        indicatorData
      );

      const db = wx.cloud.database();

      if (mode === 'edit') {
        // 更新报告
        await db.collection('baby_reports').doc(reportId).update({
          data: {
            ...reportData,
            updatedAt: db.serverDate()
          }
        });
      } else {
        // 新增报告
        await db.collection('baby_reports').add({
          data: reportData
        });
      }

      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      this.setData({
        saving: false,
        hasUnsavedChanges: false
      });

      // 延迟返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (error) {
      console.error('保存报告失败:', error);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
      this.setData({ saving: false });
    }
  },

  // 验证报告数据
  validateReportData() {
    const { selectedReportType, indicatorData, reportDate } = this.data;

    // 验证日期
    if (!reportDate) {
      return { isValid: false, errors: ['请选择检测日期'] };
    }

    // 验证指标数据
    return ReportModel.validateReportData(selectedReportType, indicatorData);
  },

  // 页面返回处理
  onPageBack() {
    if (this.data.hasUnsavedChanges) {
      wx.showModal({
        title: '确认离开',
        content: '您有未保存的更改，确定要离开吗？',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack();
          }
        }
      });
    } else {
      wx.navigateBack();
    }
  },

  // 获取指标状态显示信息
  getIndicatorStatusDisplay(status) {
    return ReportModel.getStatusDisplay(status);
  }
}); 