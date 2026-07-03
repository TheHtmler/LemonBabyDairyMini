const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const { parseReportOcrResult } = require('../../utils/reportOcrParser');

const REPORT_OCR_CLOUD_PATH_PREFIX = 'report_ocr_temp';
const REPORT_OCR_MAX_BYTES = 1.4 * 1024 * 1024;
const REPORT_OCR_TEMP_FILE_MAX_AGE = 600;
const REPORT_OCR_CALL_TIMEOUT_MS = 25000;

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

    // 拍照识别：已自动填入但用户还没核对过的指标 key 列表
    ocrPendingKeys: [],
    ocrRecognizing: false,
    ocrQuotaHint: '',

    // 页面状态
    loading: false,
    saving: false,
    hasUnsavedChanges: false
  },

  onLoad: function (options) {
    const mode = options.mode || 'add';
    const reportId = options.reportId || '';
    const selectedReportType = options.type || this.data.selectedReportType;
    
    this.setData({
      mode: mode,
      reportId: reportId,
      selectedReportType
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
        await this.initIndicators();
      }

      this.fetchOcrQuotaHint();

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

      const reportData = await ReportRepository.getReportById(this.data.reportId);
      if (!reportData) {
        throw new Error('report_not_found');
      }
      
      this.setData({
        reportDate: ReportModel.formatDate(reportData.reportDate),
        selectedReportType: reportData.reportType,
        indicatorData: reportData.indicators || {},
        loading: false
      });

      // 初始化指标配置
      await this.initIndicators();

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

  // 获取历史范围值
  async getHistoricalRanges(reportType) {
    try {
      if (!this.data.babyInfo || !this.data.babyInfo.babyUid) {
        return {};
      }

      const historicalRanges = await ReportRepository.getHistoricalRanges(
        this.data.babyInfo.babyUid,
        reportType
      );
      console.log('获取到历史范围值:', historicalRanges);
      return historicalRanges;
    } catch (error) {
      console.error('获取历史范围值失败:', error);
      return {};
    }
  },

  // 初始化指标配置
  async initIndicators() {
    const indicators = ReportModel.getIndicators(this.data.selectedReportType);
    const indicatorData = { ...this.data.indicatorData };

    // 如果是新建模式，尝试从历史记录中获取范围值
    let historicalRanges = {};
    if (this.data.mode === 'add') {
      historicalRanges = await this.getHistoricalRanges(this.data.selectedReportType);
    }

    // 初始化指标数据
    indicators.forEach(indicator => {
      if (!indicatorData[indicator.key]) {
        const historical = historicalRanges[indicator.key] || {};
        indicatorData[indicator.key] = {
          value: '',
          minRange: historical.minRange || '',
          maxRange: historical.maxRange || '',
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
  async switchReportType(reportType) {
    this.setData({
      selectedReportType: reportType,
      indicatorData: {},
      ocrPendingKeys: [],
      hasUnsavedChanges: false
    });
    
    await this.initIndicators();
  },

  // 格式化数字为小数点后三位
  formatToThreeDecimalPlaces(value) {
    if (!value || value === '') return '';
    
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    
    // 保留小数点后三位
    return num.toFixed(3);
  },

  // 验证是否为有效数字
  isValidNumber(value) {
    if (!value || value === '') return true; // 空值允许
    
    // 检查是否为有效的数字格式（包括整数、小数、科学计数法）
    const numberRegex = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
    return numberRegex.test(value.toString().trim());
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

    const update = {
      indicatorData: indicatorData,
      hasUnsavedChanges: true
    };

    if (this.data.ocrPendingKeys.includes(indicator)) {
      update.ocrPendingKeys = this.data.ocrPendingKeys.filter((key) => key !== indicator);
      indicatorData[indicator].ocrPending = false;
    }

    this.setData(update);
  },

  // 指标值失去焦点时验证和格式化
  onIndicatorValueBlur: function (e) {
    const { indicator, field } = e.currentTarget.dataset;
    let value = e.detail.value;
    
    // 验证数字格式
    if (value && value !== '') {
      if (!this.isValidNumber(value)) {
        wx.showToast({
          title: '请输入有效的数字',
          icon: 'none',
          duration: 2000
        });
        
        // 清空无效输入
        const indicatorData = { ...this.data.indicatorData };
        if (!indicatorData[indicator]) {
          indicatorData[indicator] = {};
        }
        indicatorData[indicator][field] = '';
        
        this.setData({
          indicatorData: indicatorData
        });
        return;
      }
      
      // 格式化为小数点后三位
      const formattedValue = this.formatToThreeDecimalPlaces(value);
      
      const indicatorData = { ...this.data.indicatorData };
      if (!indicatorData[indicator]) {
        indicatorData[indicator] = {};
      }
      
      indicatorData[indicator][field] = formattedValue;
      
      this.setData({
        indicatorData: indicatorData
      });
    }

    // 重新计算该指标状态
    this.calculateIndicatorStatus(indicator);
    this.calculateRatioIndicators();
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
          
          // 计算比值指标的状态
          this.calculateIndicatorStatus('c3_c0');
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
          
          // 计算比值指标的状态
          this.calculateIndicatorStatus('c3_c2');
        }
      }
    }
  },

  // 重新计算所有指标状态
  recalculateAllIndicators() {
    this.data.currentIndicators.forEach(indicator => {
      // 非比值指标或允许范围输入的比值指标都计算状态
      if (!indicator.isRatio || indicator.allowRangeInput) {
        this.calculateIndicatorStatus(indicator.key);
      }
    });
    this.calculateRatioIndicators();
  },

  getCloudEnvId() {
    const app = getApp();
    return app?.globalData?.cloudEnvId || '';
  },

  getCloudCallConfig(cloudEnvId = '') {
    return cloudEnvId ? { config: { env: cloudEnvId } } : {};
  },

  getLocalFileSize(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (res) => resolve(res.size || 0),
        fail: reject
      });
    });
  },

  // 只向云函数传 fileID 等短字段；图片走云存储，避免 callFunction 超 1MB，也避免 imgUrl+fileID 双路径重复消耗微信 OCR 额度
  async buildRecognizeReportPayload({ fileID = '', cloudEnvId = '', babyUid = '' }) {
    if (!fileID) {
      throw new Error('上传识别图片失败');
    }

    return {
      fileID,
      babyUid: babyUid || this.data.babyInfo?.babyUid || ''
    };
  },

  async prepareOcrImagePath(tempFilePath, fileSize = 0) {
    let currentPath = tempFilePath;
    let currentSize = fileSize;

    const refreshSize = async () => {
      try {
        currentSize = await this.getLocalFileSize(currentPath);
      } catch (error) {
        currentSize = currentSize || 0;
      }
      return currentSize;
    };

    if (!currentSize) {
      await refreshSize();
    }

    const compressWithQuality = async (quality) => {
      const compressed = await wx.compressImage({
        src: currentPath,
        quality
      });
      currentPath = compressed.tempFilePath || currentPath;
      await refreshSize();
      return currentPath;
    };

    try {
      if (currentSize <= REPORT_OCR_MAX_BYTES) {
        return compressWithQuality(80);
      }

      for (const quality of [60, 45, 30, 20]) {
        await compressWithQuality(quality);
        if (currentSize <= REPORT_OCR_MAX_BYTES) {
          return currentPath;
        }
      }
    } catch (error) {
      console.warn('压缩识别图片失败，使用原图继续:', error);
    }

    return currentPath;
  },

  getOcrFailureMessage(error = {}, cloudResult = null) {
    const usageSuffix = this.formatWeChatOcrUsageSuffix(cloudResult);

    if (cloudResult?.code === 'WECHAT_OCR_QUOTA_EXCEEDED') {
      return (cloudResult.message || '微信 OCR 今日共享额度已用完（约100次/天），请明天再试或手动填写') + usageSuffix;
    }
    if (cloudResult?.code === 'BABY_DAILY_QUOTA_EXCEEDED'
      || cloudResult?.code === 'BABY_MONTHLY_QUOTA_EXCEEDED'
      || cloudResult?.code === 'GLOBAL_QUOTA_EXCEEDED'
      || cloudResult?.code === 'USER_QUOTA_EXCEEDED') {
      return (cloudResult.message || '应用内识别次数已达上限') + usageSuffix;
    }
    if (cloudResult?.message) {
      return cloudResult.message + usageSuffix;
    }

    const errMsg = `${error?.errMsg || error?.message || ''}`;
    if (errMsg.includes('data exceed max size')) {
      return '图片数据过大，请重新拍摄后再试';
    }
    if (errMsg.includes('FUNCTION_NOT_FOUND') || errMsg.includes('-501000')) {
      return '识别服务未部署，请在开发者工具部署 recognizeReportImage';
    }
    if (errMsg.includes('cloud.callFunction:fail')) {
      return '调用识别服务失败，请检查云函数是否已部署';
    }
    return '识别失败，请重新拍摄后再试';
  },

  formatWeChatOcrUsageSuffix(cloudResult = null) {
    const callCount = cloudResult?.meta?.wechatOcrCallCount ?? cloudResult?.debug?.wechatOcrCallCount;
    if (!callCount) return '';
    return `（本次消耗微信 OCR ${callCount} 次）`;
  },

  formatOcrQuotaHint(quota = null) {
    if (!quota) return '';

    if (quota.limits?.enabled === false) {
      return '应用内不限次数；微信 OCR 约100次/天（全应用共享）';
    }

    const parts = [];
    const { babyDaily, babyMonthly, remaining } = quota;

    if (babyDaily?.limit > 0 && remaining?.babyDaily !== null && remaining?.babyDaily !== undefined) {
      parts.push(`今日已识别 ${babyDaily.used} 次，剩余 ${remaining.babyDaily} 次`);
    }
    if (babyMonthly?.limit > 0 && remaining?.babyMonthly !== null && remaining?.babyMonthly !== undefined) {
      parts.push(`本月已识别 ${babyMonthly.used} 次，剩余 ${remaining.babyMonthly} 次`);
    }
    return parts.join('；');
  },

  updateOcrQuotaHint(quota = null) {
    this.setData({ ocrQuotaHint: this.formatOcrQuotaHint(quota) });
  },

  async fetchOcrQuotaHint() {
    const babyUid = this.data.babyInfo?.babyUid || '';
    if (!babyUid) return;

    try {
      const cloudEnvId = this.getCloudEnvId();
      const response = await wx.cloud.callFunction({
        name: 'recognizeReportImage',
        data: { action: 'quota', babyUid },
        ...this.getCloudCallConfig(cloudEnvId)
      });
      const result = response?.result;
      if (result?.ok && result.quota) {
        this.updateOcrQuotaHint(result.quota);
      }
    } catch (error) {
      console.warn('[report-ocr] fetch quota failed', error);
    }
  },

  reportOcrFeedback(title, extra = {}) {
    wx.hideLoading();
    console.warn('[report-ocr]', {
      title,
      time: new Date().toISOString(),
      ...extra
    });
    wx.showToast({
      title,
      icon: 'none',
      duration: extra.duration || 3000
    });
  },

  callRecognizeReportCloudFunction(payload, cloudEnvId = '') {
    const callPromise = wx.cloud.callFunction({
      name: 'recognizeReportImage',
      data: payload,
      ...this.getCloudCallConfig(cloudEnvId)
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('识别超时，请稍后重试或手动填写'));
      }, REPORT_OCR_CALL_TIMEOUT_MS);
    });

    return Promise.race([callPromise, timeoutPromise]);
  },

  // 拍照识别：选图 -> 压缩 -> 上传临时文件 -> 云函数识别 -> 解析并填充表单
  async onRecognizeReportPhoto() {
    if (this.data.ocrRecognizing) return;

    let media;
    try {
      media = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      });
    } catch (error) {
      // 用户取消选择，不提示错误
      return;
    }

    const tempFile = media?.tempFiles?.[0];
    const tempFilePath = tempFile?.tempFilePath;
    if (!tempFilePath) return;

    this.setData({ ocrRecognizing: true });
    wx.showLoading({ title: '识别中...', mask: true });
    let fileID = '';

    try {
      const uploadPath = await this.prepareOcrImagePath(tempFilePath, tempFile.size || 0);
      const cloudEnvId = this.getCloudEnvId();
      const cloudPath = `${REPORT_OCR_CLOUD_PATH_PREFIX}/${this.data.babyInfo?.babyUid || 'unknown'}_${Date.now()}.jpg`;
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath: uploadPath,
        ...this.getCloudCallConfig(cloudEnvId)
      });
      fileID = uploadResult.fileID || uploadResult.fileId || '';

      const recognizePayload = await this.buildRecognizeReportPayload({
        fileID,
        cloudEnvId,
        babyUid: this.data.babyInfo?.babyUid || ''
      });
      const ocrRequestId = `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      recognizePayload.ocrRequestId = ocrRequestId;

      console.warn('[report-ocr] invoke start', {
        ocrRequestId,
        fileID,
        hasImgUrl: !!recognizePayload.imgUrl,
        reportType: this.data.selectedReportType
      });

      const cloudResponse = await this.callRecognizeReportCloudFunction(recognizePayload, cloudEnvId);
      const result = cloudResponse?.result;
      const itemCount = Array.isArray(result?.items) ? result.items.length : 0;
      const sampleTexts = (result?.items || []).slice(0, 5).map((item) => item?.text).filter(Boolean);

      console.warn('[report-ocr] cloud function result', {
        ocrRequestId,
        ok: result?.ok,
        code: result?.code,
        message: result?.message,
        debug: result?.debug,
        itemCount,
        sampleTexts,
        wechatOcrCallCount: result?.meta?.wechatOcrCallCount ?? result?.debug?.wechatOcrCallCount,
        attemptedPaths: result?.meta?.attemptedPaths ?? result?.debug?.attemptedPaths,
        successfulPath: result?.meta?.successfulPath,
        fileID,
        hasImgUrl: !!recognizePayload.imgUrl
      });

      if (!result || result.ok !== true) {
        const message = this.getOcrFailureMessage({}, result);
        this.updateOcrQuotaHint(result?.quota);
        this.reportOcrFeedback(message, {
          phase: 'cloud-function-failed',
          code: result?.code,
          cloudResult: result,
          fileID,
          duration: 5000
        });
        return;
      }

      const recognized = parseReportOcrResult({
        items: result.items || [],
        reportType: this.data.selectedReportType
      });
      const recognizedKeys = Object.keys(recognized);
      console.warn('[report-ocr] parsed indicators', {
        reportType: this.data.selectedReportType,
        itemCount,
        recognizedKeyCount: recognizedKeys.length,
        keys: recognizedKeys,
        recognized
      });

      if (recognizedKeys.length === 0 && itemCount > 0) {
        this.reportOcrFeedback(`识别到 ${itemCount} 段文字，但未匹配到指标`, {
          phase: 'parse-no-match',
          itemCount,
          sampleTexts,
          duration: 4000
        });
        return;
      }

      this.applyOcrRecognitionResult(recognized, {
        itemCount,
        sampleTexts,
        wechatOcrCallCount: result?.meta?.wechatOcrCallCount
      });
      this.updateOcrQuotaHint(result.quota);
    } catch (error) {
      const message = this.getOcrFailureMessage(error);
      console.error('[report-ocr] recognize failed', error);
      this.reportOcrFeedback(message, {
        phase: 'recognize-exception',
        error,
        duration: 5000
      });
    } finally {
      wx.hideLoading();
      this.setData({ ocrRecognizing: false });
      if (fileID) {
        wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
      }
    }
  },

  // 把识别结果合并进表单：只填空字段，不覆盖用户已经手填的值；命中的字段标记为"待核对"
  applyOcrRecognitionResult(recognizedIndicators = {}, context = {}) {
    const keys = Object.keys(recognizedIndicators);
    if (keys.length === 0) {
      const itemCount = context.itemCount || 0;
      const message = itemCount > 0
        ? `识别到 ${itemCount} 段文字，但未匹配到指标`
        : '没有识别到可用的指标，请手动填写';
      this.reportOcrFeedback(message, {
        phase: itemCount > 0 ? 'parse-no-match' : 'parse-empty',
        itemCount,
        sampleTexts: context.sampleTexts || []
      });
      return;
    }

    const indicatorData = { ...this.data.indicatorData };
    const newlyFilledKeys = [];

    keys.forEach((key) => {
      const existing = indicatorData[key] || {};
      const recognizedItem = recognizedIndicators[key];
      const hasExistingValue = existing.value !== '' && existing.value !== undefined && existing.value !== null;
      if (hasExistingValue) return;

      indicatorData[key] = {
        ...existing,
        value: recognizedItem.value || '',
        minRange: existing.minRange || recognizedItem.minRange || '',
        maxRange: existing.maxRange || recognizedItem.maxRange || '',
        ocrPending: true
      };
      newlyFilledKeys.push(key);
    });

    if (newlyFilledKeys.length === 0) {
      this.reportOcrFeedback('识别到的指标都已经有数值了', {
        phase: 'all-fields-already-filled',
        recognizedKeys: keys
      });
      return;
    }

    this.setData({
      indicatorData,
      ocrPendingKeys: [...new Set([...this.data.ocrPendingKeys, ...newlyFilledKeys])],
      hasUnsavedChanges: true
    });

    this.recalculateAllIndicators();
    const usageSuffix = context.wechatOcrCallCount
      ? `（消耗微信 OCR ${context.wechatOcrCallCount} 次）`
      : '';
    this.reportOcrFeedback(`识别到 ${newlyFilledKeys.length} 项，请核对${usageSuffix}`, {
      phase: 'apply-success',
      newlyFilledKeys,
      wechatOcrCallCount: context.wechatOcrCallCount
    });
  },

  // 保存报告
  async onSaveReport() {
    if (this.data.saving) return;

    if (this.data.ocrPendingKeys.length > 0) {
      const pendingCount = this.data.ocrPendingKeys.length;
      wx.showModal({
        title: '还有识别结果未核对',
        content: `还有 ${pendingCount} 项拍照识别的数值未核对，确定要保存吗？`,
        confirmText: '确定保存',
        success: (res) => {
          if (res.confirm) {
            this.performSaveReport();
          }
        }
      });
      return;
    }

    await this.performSaveReport();
  },

  async performSaveReport() {
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
      await ReportRepository.saveReport({
        mode,
        reportId,
        babyUid: babyInfo.babyUid,
        reportDate: new Date(reportDate),
        reportType: selectedReportType,
        indicators: indicatorData
      });

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
