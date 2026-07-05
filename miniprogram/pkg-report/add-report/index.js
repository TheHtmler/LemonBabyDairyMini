const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const { parseReportOcrResult, parseStructuredReportItems } = require('../../utils/reportOcrParser');
const { formatReportNumber } = require('../../utils/reportNumberFormat');

const ANALYSIS_REPORT_RELOAD_KEY = 'analysis_report_reload';

const CUSTOM_OCR_CLOUD_PATH_PREFIX = 'custom_ocr_temp';
const CUSTOM_OCR_MAX_BYTES = 2 * 1024 * 1024;
const CUSTOM_OCR_CALL_TIMEOUT_MS = 70000;

function inferFileNameFromPath(filePath = '') {
  const lower = `${filePath || ''}`.toLowerCase();
  if (lower.endsWith('.png')) return 'report.png';
  if (lower.endsWith('.webp')) return 'report.webp';
  if (lower.endsWith('.jpeg')) return 'report.jpeg';
  return 'report.jpg';
}

function mapOcrResultToIndicators({ structuredItems = [], items = [], reportType = '' } = {}) {
  if (Array.isArray(structuredItems) && structuredItems.length > 0) {
    return parseStructuredReportItems({ structuredItems, reportType });
  }
  return parseReportOcrResult({ items: items || [], reportType });
}

function buildOcrPendingSaveTip(pendingCount = 0) {
  const count = Math.max(Number(pendingCount) || 0, 0);
  if (count <= 0) return '';
  return `含 ${count} 项拍照识别数据，请对照原报告确认后再保存`;
}

function sanitizeIndicatorsForSave(indicatorData = {}) {
  return Object.keys(indicatorData).reduce((result, key) => {
    const indicator = indicatorData[key] || {};
    const { ocrPending, ...rest } = indicator;
    result[key] = {
      ...rest,
      value: formatReportNumber(rest.value),
      minRange: formatReportNumber(rest.minRange),
      maxRange: formatReportNumber(rest.maxRange)
    };
    return result;
  }, {});
}

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
    ocrEntryHint: '拍下报告单自动填值，请逐项核对',

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
    const formatted = formatReportNumber(value);
    return formatted || value;
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

  clearOcrPendingReview(indicatorKeys = []) {
    const keysToClear = Array.isArray(indicatorKeys) && indicatorKeys.length > 0
      ? indicatorKeys
      : [...this.data.ocrPendingKeys];

    if (keysToClear.length === 0) {
      return;
    }

    const indicatorData = { ...this.data.indicatorData };
    keysToClear.forEach((key) => {
      if (!indicatorData[key]) {
        return;
      }
      indicatorData[key] = {
        ...indicatorData[key],
        ocrPending: false
      };
    });

    this.setData({
      indicatorData,
      ocrPendingKeys: this.data.ocrPendingKeys.filter((key) => !keysToClear.includes(key))
    });
  },

  onConfirmOcrIndicator(e) {
    const indicator = e.currentTarget.dataset.indicator;
    if (!indicator || !this.data.ocrPendingKeys.includes(indicator)) {
      return;
    }

    this.clearOcrPendingReview([indicator]);
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
          if (!newIndicatorData.c3_c0.ocrPending) {
            newIndicatorData.c3_c0.value = ratio.toString();
          }

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
          const newIndicatorData = { ...this.data.indicatorData };
          if (!newIndicatorData.c3_c2) {
            newIndicatorData.c3_c2 = {};
          }
          if (!newIndicatorData.c3_c2.ocrPending) {
            newIndicatorData.c3_c2.value = ratio.toString();
          }

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

  // 只向云函数传 fileID 等短字段，图片走云存储，避免 callFunction 超 512KB
  async buildRecognizeReportPayload({ fileID = '', babyUid = '', reportType = '', ocrRequestId = '' }) {
    if (!fileID) {
      throw new Error('上传识别图片失败');
    }

    return {
      fileID,
      fileName: inferFileNameFromPath(fileID),
      babyUid: babyUid || this.data.babyInfo?.babyUid || '',
      reportType: reportType || this.data.selectedReportType,
      ocrRequestId
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
      if (currentSize <= CUSTOM_OCR_MAX_BYTES) {
        return compressWithQuality(80);
      }

      for (const quality of [60, 45, 30, 20]) {
        await compressWithQuality(quality);
        if (currentSize <= CUSTOM_OCR_MAX_BYTES) {
          return currentPath;
        }
      }
    } catch (error) {
      console.warn('压缩识别图片失败，使用原图继续:', error);
    }

    return currentPath;
  },

  getOcrFailureMessage(error = {}, cloudResult = null) {
    if (cloudResult?.message) {
      return cloudResult.message;
    }

    const errMsg = `${error?.errMsg || error?.message || ''}`;
    if (errMsg.includes('data exceed max size')) {
      return '图片数据过大，请重新拍摄后再试';
    }
    if (errMsg.includes('FUNCTION_NOT_FOUND') || errMsg.includes('-501000')) {
      return '识别服务未部署，请在开发者工具部署 recognizeReportCustom';
    }
    if (errMsg.includes('502') || errMsg.includes('OCR_GATEWAY_ERROR') || errMsg.includes('后端无响应')) {
      return 'OCR 服务暂时不可用，请稍后再试';
    }
    if (errMsg.includes('OCR_BUSY') || errMsg.includes('繁忙')) {
      return 'OCR 服务正在处理其他请求，请稍后再试';
    }
    if (errMsg.includes('识别超时') || errMsg.includes('timeout') || errMsg.includes('timed out')) {
      return '识别超时，请稍后重试或手动填写';
    }
    if (errMsg.includes('cloud.callFunction:fail')) {
      return '调用识别服务失败，请检查云函数是否已部署';
    }
    return '识别失败，请重新拍摄后再试';
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
      name: 'recognizeReportCustom',
      data: payload,
      ...this.getCloudCallConfig(cloudEnvId)
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('识别超时，请稍后重试或手动填写'));
      }, CUSTOM_OCR_CALL_TIMEOUT_MS);
    });

    return Promise.race([callPromise, timeoutPromise]);
  },

  // 拍照识别：选图 -> 压缩 -> 上传 -> 自建 OCR 云函数 -> 解析并填充表单
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
      const cloudPath = `${CUSTOM_OCR_CLOUD_PATH_PREFIX}/${this.data.babyInfo?.babyUid || 'unknown'}_${Date.now()}.jpg`;
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath: uploadPath,
        ...this.getCloudCallConfig(cloudEnvId)
      });
      fileID = uploadResult.fileID || uploadResult.fileId || '';
      const ocrRequestId = `custom_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const recognizePayload = await this.buildRecognizeReportPayload({
        fileID,
        babyUid: this.data.babyInfo?.babyUid || '',
        reportType: this.data.selectedReportType,
        ocrRequestId
      });

      console.warn('[report-ocr] invoke start', {
        ocrRequestId,
        fileID,
        reportType: this.data.selectedReportType
      });

      const cloudResponse = await this.callRecognizeReportCloudFunction(recognizePayload, cloudEnvId);
      const result = cloudResponse?.result;
      const structuredCount = Array.isArray(result?.structuredItems) ? result.structuredItems.length : 0;
      const itemCount = Array.isArray(result?.items) ? result.items.length : 0;
      const sampleTexts = (result?.items || []).slice(0, 5).map((item) => item?.text).filter(Boolean);

      console.warn('[report-ocr] cloud function result', {
        ocrRequestId,
        ok: result?.ok,
        code: result?.code,
        message: result?.message,
        structuredCount,
        itemCount,
        sampleTexts,
        fileID
      });

      if (!result || result.ok !== true) {
        const message = this.getOcrFailureMessage({}, result);
        this.reportOcrFeedback(message, {
          phase: 'cloud-function-failed',
          code: result?.code,
          cloudResult: result,
          fileID,
          duration: 5000
        });
        return;
      }

      const recognized = mapOcrResultToIndicators({
        structuredItems: result.structuredItems || [],
        items: result.items || [],
        reportType: this.data.selectedReportType
      });
      const recognizedKeys = Object.keys(recognized);
      console.warn('[report-ocr] parsed indicators', {
        reportType: this.data.selectedReportType,
        structuredCount,
        itemCount,
        recognizedKeyCount: recognizedKeys.length,
        keys: recognizedKeys
      });

      if (recognizedKeys.length === 0 && (structuredCount > 0 || itemCount > 0)) {
        this.reportOcrFeedback(`识别到 ${structuredCount || itemCount} 项，但未匹配到指标`, {
          phase: 'parse-no-match',
          itemCount: structuredCount || itemCount,
          sampleTexts,
          duration: 4000
        });
        return;
      }

      this.applyOcrRecognitionResult(recognized, {
        itemCount: structuredCount || itemCount,
        sampleTexts,
        structuredNames: (result.structuredItems || []).map((item) => item.name || item.label || item.indicatorKey || item.indicator_key || '')
      });
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
        sampleTexts: context.sampleTexts || [],
        structuredNames: context.structuredNames || []
      });
      return;
    }

    const validKeys = new Set(
      (this.data.currentIndicators || []).length
        ? this.data.currentIndicators.map((item) => item.key)
        : ReportModel.getIndicators(this.data.selectedReportType).map((item) => item.key)
    );
    const indicatorData = { ...this.data.indicatorData };
    const newlyFilledKeys = [];

    keys.forEach((key) => {
      if (!validKeys.has(key)) return;

      const existing = indicatorData[key] || {};
      const recognizedItem = recognizedIndicators[key];
      const hasExistingValue = existing.value !== '' && existing.value !== undefined && existing.value !== null;
      if (hasExistingValue) return;

      const recognizedMinRange = `${recognizedItem.minRange || ''}`.trim();
      const recognizedMaxRange = `${recognizedItem.maxRange || ''}`.trim();
      const isBloodRatio = this.data.selectedReportType === 'blood_ms'
        && (key === 'c3_c0' || key === 'c3_c2');

      indicatorData[key] = {
        ...existing,
        value: formatReportNumber(recognizedItem.value || ''),
        minRange: isBloodRatio
          ? formatReportNumber(recognizedMinRange)
          : formatReportNumber(recognizedMinRange || existing.minRange || ''),
        maxRange: isBloodRatio
          ? formatReportNumber(recognizedMaxRange)
          : formatReportNumber(recognizedMaxRange || existing.maxRange || ''),
        ocrPending: true
      };
      newlyFilledKeys.push(key);
    });

    if (this.data.selectedReportType === 'blood_ms') {
      ['c3_c0', 'c3_c2'].forEach((ratioKey) => {
        if (!indicatorData[ratioKey]) return;

        const recognizedRatio = recognizedIndicators[ratioKey];
        if (!recognizedRatio) {
          indicatorData[ratioKey] = {
            ...indicatorData[ratioKey],
            minRange: '',
            maxRange: ''
          };
          return;
        }

        const recognizedMinRange = `${recognizedRatio.minRange || ''}`.trim();
        const recognizedMaxRange = `${recognizedRatio.maxRange || ''}`.trim();
        if (!recognizedMinRange && !recognizedMaxRange) {
          indicatorData[ratioKey] = {
            ...indicatorData[ratioKey],
            minRange: '',
            maxRange: ''
          };
        }
      });
    }

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
    }, () => {
      this.recalculateAllIndicators();
    });

    this.reportOcrFeedback(`识别到 ${newlyFilledKeys.length} 项，请核对`, {
      phase: 'apply-success',
      newlyFilledKeys
    });
  },

  // 保存报告
  async onSaveReport() {
    if (this.data.saving) return;

    const pendingCount = this.data.ocrPendingKeys.length;
    if (pendingCount > 0) {
      const tip = buildOcrPendingSaveTip(pendingCount);
      wx.showModal({
        title: '保存前请核对识别数据',
        content: `${tip}。不必逐项点确认，对照原报告看一眼即可；如已核对，可直接继续保存。`,
        confirmText: '继续保存',
        cancelText: '返回修改',
        success: async (res) => {
          if (!res.confirm) {
            wx.showToast({
              title: '已取消保存',
              icon: 'none'
            });
            return;
          }
          this.clearOcrPendingReview();
          await this.performSaveReport();
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
        indicators: sanitizeIndicatorsForSave(indicatorData)
      });

      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      wx.setStorageSync(ANALYSIS_REPORT_RELOAD_KEY, Date.now());

      this.setData({
        saving: false,
        hasUnsavedChanges: false,
        ocrPendingKeys: []
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports.buildOcrPendingSaveTip = buildOcrPendingSaveTip;
  module.exports.sanitizeIndicatorsForSave = sanitizeIndicatorsForSave;
}
