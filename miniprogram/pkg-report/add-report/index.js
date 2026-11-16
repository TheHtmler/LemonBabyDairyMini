const ReportModel = require('../../models/report');
const ReportRepository = require('../../models/reportRepository');
const { REPORT_ENTRY_TYPES, REPORT_OCR_TYPES, REPORT_MAX_PHOTOS } = require('../../constants/reportTypes');
const { getReportOcrAccess } = require('../../utils/reportOcrAccess');
const { currentContext } = require('../../utils/searchSession');
const { getOcrFailureMessage } = require('../utils/reportRecognition');
const { sanitizeSignedDecimalInput, formatReportNumber } = require('../utils/reportNumberFormat');
const { normalizeReportDetectionValue, toExactReportNumber, summarizeReportValues } = require('../../utils/reportNumeric');
const { countFilledIndicators } = require('../utils/reportFilledCount');
const { uploadReportOriginals, sameContext } = require('../../utils/reportOriginals');

const ANALYSIS_REPORT_RELOAD_KEY = 'analysis_report_reload';

function buildOcrPendingSaveTip(pendingCount = 0) {
  const count = Math.max(Number(pendingCount) || 0, 0);
  if (count <= 0) return '';
  return `含 ${count} 项拍照识别数据，请对照原报告确认后再保存`;
}

function hasReportValue(value) {
  return `${value ?? ''}`.trim() !== '';
}

function sanitizeIndicatorsForSave(indicatorData = {}) {
  return Object.keys(indicatorData).reduce((result, key) => {
    const indicator = indicatorData[key] || {};
    const { ocrPending, rangePending, ...rest } = indicator;
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
    labName: '',
    selectedReportType: 'blood_ms',
    
    // 报告类型配置
    reportTypes: REPORT_ENTRY_TYPES,
    
    // 当前指标配置
    currentIndicators: [],
    
    // 指标数据
    indicatorData: {},
    originalImages: [],
    originalPhotos: [],
    focusedMetricKey: '',

    // 拍照识别：已自动填入但用户还没核对过的指标 key 列表
    ocrPendingKeys: [],
    ocrRecognizing: false,
    ocrAllowed: false,
    ocrEntryVisible: false,
    ocrAccessChecked: false,
    ocrAccessMessage: '拍照识别功能调试中，仅对白名单用户开放',
    ocrEntryHint: '同一份报告最多6张，核对合并结果后填入',

    // 页面状态：默认 loading，避免指标异步就绪前空白闪一下
    loading: true,
    saving: false,
    saveSucceeded: false,
    hasUnsavedChanges: false,

    // 已填进度
    filledCount: 0,
    totalCount: 0
  },

  onLoad: function (options = {}) {
    const mode = options.mode || 'add';
    const reportId = options.reportId || '';
    const selectedReportType = options.type || this.data.selectedReportType;
    this._pendingMetricKey = typeof options.metricKey === 'string' ? options.metricKey : '';
    this._returnDelta = options.from === 'recognition' && mode === 'add' ? 2 : 1;
    
    this.setData({
      mode: mode,
      reportId: reportId,
      selectedReportType
    });
    this.refreshNavigationTitle();

    if (options.from === 'recognition' && mode === 'add') {
      const channel = this.getOpenerEventChannel();
      // 直接打开填写页时可能没有来源通道，仍允许正常手动填写。
      if (typeof channel.once === 'function') {
        this._recognitionChannel = channel;
        channel.once('reportRecognitionConfirmed', recognition => {
          if (this._pageUnloaded) return;
          this._pendingReportRecognition = recognition;
          this.consumeReportRecognition();
        });
      }
    }
    this.initPage();
  },

  onReady() {
    this._pageReady = true;
    this.focusRequestedIndicator();
    this.consumeReportRecognition();
  },

  onUnload() {
    this._pageUnloaded = true;
    this._pendingReportRecognition = null;
    if (this._recognitionChannel) this._recognitionChannel.off('reportRecognitionConfirmed');
    if (this.data.ocrRecognizing) wx.hideLoading();
    if (this._returnTimer) {
      clearTimeout(this._returnTimer);
      this._returnTimer = null;
    }
  },

  // 只接收用户在结果页明确确认过的数据，进入表单后不再重复识别。
  consumeReportRecognition() {
    if (this._pageUnloaded || !this._pageReady || this.data.loading || !this.data.ocrAccessChecked || !this._pendingReportRecognition) return;
    const recognition = this._pendingReportRecognition;
    this._pendingReportRecognition = null;
    const context = currentContext();
    if (recognition.babyUid !== this.data.babyInfo?.babyUid || recognition.babyUid !== context.babyUid
      || recognition.accountKey !== context.accountKey || recognition.reportType !== this.data.selectedReportType) {
      wx.showToast({ title: '宝宝或账号已切换，请重新识别报告', icon: 'none' });
      return;
    }
    if (!recognition.indicators || typeof recognition.indicators !== 'object' || Array.isArray(recognition.indicators)) return;
    this.applyOcrRecognitionResult(recognition.indicators, recognition.context || {});
    this.receiveOriginalPhotos(recognition.originalPhotos);
  },

  receiveOriginalPhotos(photos) {
    if (!Array.isArray(photos) || !photos.length) return;
    if (photos.some(path => typeof path !== 'string' || !path || path.startsWith('cloud://'))) return;
    const context = currentContext();
    if (this._originalPhotosContext && !sameContext(this._originalPhotosContext)) {
      wx.showToast({ title: '宝宝或账号已切换，请重新打开报告', icon: 'none' }); return;
    }
    const pending = [...new Set([...this.data.originalPhotos, ...photos])];
    if (this.data.originalImages.length + pending.length > REPORT_MAX_PHOTOS) {
      wx.showToast({ title: '指标已填入，原图超过6张，未追加', icon: 'none' }); return;
    }
    this._originalPhotosContext = context;
    this.setData({ originalPhotos: pending, hasUnsavedChanges: true });
  },

  onDiscardOriginalPhotos() {
    if (!this.data.saving) this.setData({ originalPhotos: [], hasUnsavedChanges: true });
  },

  // 等页面与指标都就绪后定位，避免异步加载时找不到目标节点。
  focusRequestedIndicator() {
    const metricKey = this._pendingMetricKey;
    if (!this._pageReady || this.data.loading || !metricKey) return;

    this._pendingMetricKey = '';
    if (!this.data.currentIndicators.some((indicator) => indicator.key === metricKey)) return;

    this.setData({ focusedMetricKey: metricKey }, () => {
      wx.pageScrollTo({
        selector: `#indicator-${metricKey}`,
        offsetTop: -16,
        duration: 200
      });
    });
  },

  refreshNavigationTitle() {
    const typeName = ReportModel.getReportTypeName(this.data.selectedReportType);
    const title = this.data.mode === 'edit'
      ? `编辑${typeName}`
      : (typeName && typeName !== '未知报告' ? typeName : '检测报告');
    if (typeof wx !== 'undefined' && typeof wx.setNavigationBarTitle === 'function') {
      wx.setNavigationBarTitle({ title });
    }
  },

  // 初始化页面
  async initPage() {
    try {
      this.setData({ loading: true });

      // 获取宝宝信息
      const app = getApp();
      const babyInfo = app.globalData.babyInfo;
      
      if (!babyInfo || !babyInfo.babyUid) {
        this.setData({ loading: false });
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

      await this.loadOcrAccess();
      if (this._pageUnloaded) return;

      // 如果是编辑模式，加载报告数据
      if (this.data.mode === 'edit' && this.data.reportId) {
        await this.loadReportData();
      } else {
        // 新建模式，初始化指标后再关 loading
        await this.initIndicators();
        if (this._pageUnloaded) return;
        this.setData({ loading: false }, () => {
          this.focusRequestedIndicator();
          this.consumeReportRecognition();
        });
      }

    } catch (error) {
      if (this._pageUnloaded) return;
      console.error('初始化页面失败:', error);
      this.setData({ loading: false });
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
        labName: reportData.labName || '',
        selectedReportType: reportData.reportType,
        originalImages: Array.isArray(reportData.originalImages) ? reportData.originalImages : [],
        indicatorData: reportData.indicators || {}
      });
      this.refreshNavigationTitle();
      this.refreshOcrEntryVisible();

      // 初始化指标配置完成后再关 loading，避免表单空闪
      await this.initIndicators();
      this.refreshFilledCount();
      this.setData({ loading: false }, () => this.focusRequestedIndicator());

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
    const indicators = ReportModel.getIndicators(this.data.selectedReportType).map(config => ({ ...config,
      unit: this.data.indicatorData[config.key]?.unit || config.unit }));
    const indicatorData = { ...this.data.indicatorData };

    // 如果是新建模式，尝试从历史记录中获取范围值
    let historicalRanges = {};
    if (this.data.mode === 'add') {
      historicalRanges = await this.getHistoricalRanges(this.data.selectedReportType);
    }

    if (this._pageUnloaded) return;
    // 初始化指标数据
    indicators.forEach(indicator => {
      if (!indicatorData[indicator.key]) {
        const historical = historicalRanges[indicator.key] || {};
        const minRange = historical.minRange ?? '';
        const maxRange = historical.maxRange ?? '';
        indicatorData[indicator.key] = {
          value: '',
          minRange,
          maxRange,
          rangePending: hasReportValue(minRange) || hasReportValue(maxRange),
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
    this.refreshFilledCount();
  },

  // 日期选择
  onDateChange: function (e) {
    this.setData({
      reportDate: e.detail.value,
      hasUnsavedChanges: true
    });
  },

  onLabNameInput(e) {
    this.setData({ labName: e.detail.value, hasUnsavedChanges: true });
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

  // 执行报告类型切换（页内类型入口已移除，保留方法供兼容调用）
  async switchReportType(reportType) {
    this.setData({
      selectedReportType: reportType,
      indicatorData: {},
      focusedMetricKey: '',
      ocrPendingKeys: [],
      hasUnsavedChanges: false,
      loading: true
    });
    this.refreshNavigationTitle();
    this.refreshOcrEntryVisible();
    
    try {
      await this.initIndicators();
      this.refreshFilledCount();
    } finally {
      this.setData({ loading: false });
    }
  },

  // 格式化数字为小数点后三位
  formatToThreeDecimalPlaces(value) {
    if (!hasReportValue(value)) return '';
    const formatted = formatReportNumber(value);
    return formatted || value;
  },

  // 验证是否为有效数字
  isValidNumber(value, field = 'value') {
    if (!value || value === '') return true; // 空值允许
    
    return field === 'value' ? Boolean(normalizeReportDetectionValue(value)) : Number.isFinite(toExactReportNumber(value));
  },

  // 指标值输入
  onIndicatorValueInput: function (e) {
    const { indicator, field } = e.currentTarget.dataset;
    const value = sanitizeSignedDecimalInput(e.detail.value);
    
    const indicatorData = { ...this.data.indicatorData };
    if (!indicatorData[indicator]) {
      indicatorData[indicator] = {};
    }
    
    // 历史范围按整项核对，修改任一边界后仍需明确确认上下限。
    indicatorData[indicator][field] = value;
    if (field === 'value') indicatorData[indicator].calculated = false;

    const update = {
      indicatorData: indicatorData,
      hasUnsavedChanges: true
    };

    if (this.data.ocrPendingKeys.includes(indicator)) {
      update.ocrPendingKeys = this.data.ocrPendingKeys.filter((key) => key !== indicator);
      indicatorData[indicator].ocrPending = false;
    }

    this.setData(update);

    if (field === 'value') {
      this.refreshFilledCount();
    }
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

  clearRangePendingReview(indicatorKeys = []) {
    const indicatorData = { ...this.data.indicatorData };
    const keys = indicatorKeys.length > 0 ? indicatorKeys : Object.keys(indicatorData);
    keys.forEach((key) => {
      if (!indicatorData[key] || !indicatorData[key].rangePending) return;
      indicatorData[key] = { ...indicatorData[key], rangePending: false };
    });
    this.setData({ indicatorData });
  },

  onConfirmRangeIndicator(e) {
    const indicator = e.currentTarget.dataset.indicator;
    if (!indicator || !this.data.indicatorData[indicator]?.rangePending) return;
    this.clearRangePendingReview([indicator]);
  },

  // 指标值失去焦点时验证和格式化
  onIndicatorValueBlur: function (e) {
    const { indicator, field } = e.currentTarget.dataset;
    let value = e.detail.value;
    
    // 验证数字格式
    if (value && value !== '') {
      if (!this.isValidNumber(value, field)) {
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
        if (field === 'value') {
          this.refreshFilledCount();
        }
        return;
      }
      
      // 统一书写但不舍入原值，保留比较符与科学计数法。
      const formattedValue = this.formatToThreeDecimalPlaces(value);
      
      const indicatorData = { ...this.data.indicatorData };
      if (!indicatorData[indicator]) {
        indicatorData[indicator] = {};
      }
      
      indicatorData[indicator][field] = formattedValue;
      
      this.setData({
        indicatorData: indicatorData
      });
      if (field === 'value') {
        this.refreshFilledCount();
      }
    }

    // 重新计算该指标状态
    this.calculateIndicatorStatus(indicator);
    this.calculateRatioIndicators();
  },

  // 计算单个指标状态
  calculateIndicatorStatus(indicatorKey) {
    const data = this.data.indicatorData[indicatorKey];
    if (!data || !hasReportValue(data.value) || !hasReportValue(data.minRange) || !hasReportValue(data.maxRange)) {
      if (data && (data.status !== 'unknown' || data.optimalRange)) {
        this.setData({ [`indicatorData.${indicatorKey}.status`]: 'unknown', [`indicatorData.${indicatorKey}.optimalRange`]: null });
      }
      return;
    }

    // 计算状态
    const status = ReportModel.calculateIndicatorStatus(
      data.value, 
      data.minRange, 
      data.maxRange
    );

    // 沿用项目既有的 25% 计算规则（仅限氨基酸指标）。
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
    if (selectedReportType !== 'blood_ms') return;
    const updated = { ...indicatorData };
    const changed = [];
    for (const [key, denominator] of [['c3_c0', 'c0'], ['c3_c2', 'c2']]) {
      const existing = indicatorData[key] || {};
      // 手工填写与原图比值不能被派生值覆盖，只有程序生成的结果才随基础值更新。
      if (existing.ocrPending || hasReportValue(existing.value) && existing.calculated !== true) continue;
      const ratio = ReportModel.calculateRatio(indicatorData.c3?.value, indicatorData[denominator]?.value);
      if (ratio === null && !existing.calculated) continue;
      updated[key] = { ...existing, value: ratio === null ? '' : String(ratio),
        calculated: true, status: 'unknown', optimalRange: null };
      changed.push(key);
    }
    if (!changed.length) return;
    this.setData({ indicatorData: updated }, () => {
      changed.forEach(key => this.calculateIndicatorStatus(key));
      this.refreshFilledCount();
    });
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

  refreshOcrEntryVisible() {
    const visible = !!this.data.ocrAllowed
      && REPORT_OCR_TYPES.some(type => type.key === this.data.selectedReportType);
    if (this.data.ocrEntryVisible !== visible) {
      this.setData({ ocrEntryVisible: visible });
    }
  },

  refreshFilledCount() {
    const currentIndicators = this.data.currentIndicators || [];
    const filledCount = countFilledIndicators(currentIndicators, this.data.indicatorData || {});
    const totalCount = currentIndicators.length;
    if (this.data.filledCount === filledCount && this.data.totalCount === totalCount) return;
    this.setData({ filledCount, totalCount });
  },

  async loadOcrAccess() {
    try {
      const result = await getReportOcrAccess(this.data.babyInfo?.babyUid || '');
      if (this._pageUnloaded) return;
      this.setData({
        ocrAllowed: result.available,
        ocrAccessChecked: true,
        ocrAccessMessage: result.message || this.data.ocrAccessMessage
      });
      this.refreshOcrEntryVisible();
    } catch (error) {
      if (this._pageUnloaded) return;
      console.warn('[report-ocr] access check failed', error);
      this.setData({
        ocrAllowed: false,
        ocrAccessChecked: true,
        ocrAccessMessage: error.message || '报告识别权限检查失败，请稍后重试'
      });
      this.refreshOcrEntryVisible();
    }
  },

  getOcrFailureMessage,

  reportOcrFeedback(title, extra = {}) {
    if (this._pageUnloaded) return;
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

  // 创建和编辑报告均先核对多页识别结果，再只填入表单中的空白项。
  async onRecognizeReportPhoto() {
    if (this._pageUnloaded || this.data.loading || this.data.ocrRecognizing || this.data.saving) return;
    if (!this.data.ocrAllowed) {
      wx.showToast({ title: this.data.ocrAccessMessage || '拍照识别功能暂未开放', icon: 'none' }); return;
    }
    const context = currentContext();
    const reportType = this.data.selectedReportType;
    const babyUid = this.data.babyInfo?.babyUid;
    if (!REPORT_OCR_TYPES.some(type => type.key === reportType)) return;
    const isCurrent = () => {
      const current = currentContext();
      return !this._pageUnloaded && current.accountKey === context.accountKey && current.babyUid === babyUid
        && getApp().globalData.babyInfo?.babyUid === babyUid && this.data.selectedReportType === reportType;
    };
    if (!isCurrent()) return;
    this.setData({ ocrRecognizing: true });
    try {
      const media = await wx.chooseMedia({ count: REPORT_MAX_PHOTOS, mediaType: ['image'], sizeType: ['original'], sourceType: ['album', 'camera'] });
      const photos = (media?.tempFiles || []).filter(photo => photo?.tempFilePath);
      if (!photos.length || !isCurrent()) return;
      await new Promise((resolve, reject) => wx.navigateTo({
        url: '/pkg-report/report-recognition/index?type=' + encodeURIComponent(reportType) + '&target=existing',
        events: {
          reportRecognitionConfirmed: recognition => {
            if (!isCurrent() || !recognition || recognition.babyUid !== babyUid || recognition.accountKey !== context.accountKey
              || recognition.reportType !== reportType) return;
            if (!recognition.indicators || typeof recognition.indicators !== 'object' || Array.isArray(recognition.indicators)) return;
            this.applyOcrRecognitionResult(recognition.indicators, recognition.context || {});
            this.receiveOriginalPhotos(recognition.originalPhotos);
          }
        },
        success: response => {
          try {
            response.eventChannel.emit('reportPhotosSelected', { photos, babyUid, accountKey: context.accountKey });
            resolve();
          } catch (error) { reject(error); }
        },
        fail: reject
      }));
    } catch (error) {
      if (isCurrent() && !/cancel/i.test(error.errMsg || error.message || '')) this.reportOcrFeedback(this.getOcrFailureMessage(error));
    } finally {
      if (!this._pageUnloaded) this.setData({ ocrRecognizing: false });
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
      if (!recognizedItem || recognizedItem.needsReview || recognizedItem.confirmationBlocked) return;
      const hasExistingValue = existing.value !== '' && existing.value !== undefined && existing.value !== null;
      if (hasExistingValue) return;

      const recognizedMinRange = `${recognizedItem.minRange ?? ''}`.trim();
      const recognizedMaxRange = `${recognizedItem.maxRange ?? ''}`.trim();
      const isBloodRatio = this.data.selectedReportType === 'blood_ms'
        && (key === 'c3_c0' || key === 'c3_c2');
      // 识别范围替换历史范围后，由识别待核对接管；仍沿用任一历史边界时保留提醒。
      const retainsHistoricalRange = !isBloodRatio && (
        (!recognizedMinRange && hasReportValue(existing.minRange))
        || (!recognizedMaxRange && hasReportValue(existing.maxRange))
      );

      indicatorData[key] = {
        ...existing,
        value: formatReportNumber(recognizedItem.value ?? ''),
        unit: recognizedItem.unit || existing.unit || '',
        minRange: isBloodRatio
          ? formatReportNumber(recognizedMinRange)
          : formatReportNumber(recognizedMinRange || (existing.minRange ?? '')),
        maxRange: isBloodRatio
          ? formatReportNumber(recognizedMaxRange)
          : formatReportNumber(recognizedMaxRange || (existing.maxRange ?? '')),
        rangePending: Boolean(existing.rangePending && retainsHistoricalRange),
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
            maxRange: '',
            rangePending: false
          };
          return;
        }

        const recognizedMinRange = `${recognizedRatio.minRange ?? ''}`.trim();
        const recognizedMaxRange = `${recognizedRatio.maxRange ?? ''}`.trim();
        if (!recognizedMinRange && !recognizedMaxRange) {
          indicatorData[ratioKey] = {
            ...indicatorData[ratioKey],
            minRange: '',
            maxRange: '',
            rangePending: false
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
      currentIndicators: this.data.currentIndicators.map(config => ({ ...config, unit: indicatorData[config.key]?.unit || config.unit })),
      ocrPendingKeys: [...new Set([...this.data.ocrPendingKeys, ...newlyFilledKeys])],
      hasUnsavedChanges: true
    }, () => {
      this.recalculateAllIndicators();
      this.refreshFilledCount();
    });
    console.info('[report-recognition-values]', { stage: 'filled', reportType: this.data.selectedReportType,
      values: summarizeReportValues(newlyFilledKeys.map(key => indicatorData[key].value)) });

    this.reportOcrFeedback(`识别到 ${newlyFilledKeys.length} 项，请核对`, {
      phase: 'apply-success',
      newlyFilledKeys
    });
  },

  // 保存报告
  async onSaveReport() {
    if (this.data.saving || this.data.loading || this._saveConfirmationPending) return;

    // 先检查必填项，再合并核对提示，避免一次保存接连出现多个确认弹窗。
    const validation = this.validateReportData();
    if (!validation.isValid) {
      wx.showModal({
        title: '数据验证失败',
        content: validation.errors.join('\n'),
        showCancel: false
      });
      return;
    }

    const pendingCount = this.data.ocrPendingKeys.length;
    const rangePendingCount = this.data.currentIndicators.filter(
      (indicator) => {
        const data = this.data.indicatorData[indicator.key];
        return data?.rangePending && hasReportValue(data.value);
      }
    ).length;
    if (pendingCount > 0 || rangePendingCount > 0) {
      const tips = [];
      if (rangePendingCount > 0) {
        tips.push(`${rangePendingCount} 项初始参考范围来自历史报告，请对照本次原报告核对上下限`);
      }
      if (pendingCount > 0) tips.push(buildOcrPendingSaveTip(pendingCount));
      this._saveConfirmationPending = true;
      wx.showModal({
        title: '保存前请核对报告',
        content: `${tips.join('；')}。核对完成后即可保存。`,
        confirmText: '已核对，保存',
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
          this.clearRangePendingReview();
          await this.performSaveReport();
        },
        complete: () => { this._saveConfirmationPending = false; }
      });
      return;
    }

    await this.performSaveReport();
  },

  async performSaveReport() {
    if (this.data.saving || this.data.saveSucceeded) return;

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

      const { babyInfo, reportDate, labName, selectedReportType, indicatorData, mode, reportId } = this.data;
      const context = currentContext();
      if (context.babyUid !== babyInfo.babyUid || !sameContext(context)) throw new Error('宝宝或账号已切换，请重新打开报告');
      this._originalUploads = this._originalUploads || {};
      const photos = this.data.originalPhotos;
      if (photos.length && !sameContext(this._originalPhotosContext)) throw new Error('宝宝或账号已切换，请重新打开报告');
      const missing = photos.filter(path => !this._originalUploads[path]);
      const uploaded = await uploadReportOriginals(missing, context, () => !this._pageUnloaded);
      missing.forEach((path, index) => { this._originalUploads[path] = uploaded[index]; });
      if (this._pageUnloaded || !sameContext(context)) throw new Error('宝宝或账号已切换，请重新打开报告');
      const originalImages = [...new Set([...this.data.originalImages, ...photos.map(path => this._originalUploads[path])])];

      // 创建报告数据
      await ReportRepository.saveReport({
        mode,
        reportId,
        babyUid: babyInfo.babyUid,
        reportDate: new Date(reportDate),
        labName: labName.trim(),
        originalImages,
        reportType: selectedReportType,
        indicators: sanitizeIndicatorsForSave(indicatorData)
      });

      // 写入成功后保持保存锁，返回前只能导航，避免重复新增同一份报告。
      this.setData({
        saving: true,
        saveSucceeded: true,
        hasUnsavedChanges: false,
        ocrPendingKeys: []
      });

      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      wx.setStorageSync(ANALYSIS_REPORT_RELOAD_KEY, Date.now());

      // 延迟返回上一页
      if (!this._pageUnloaded) {
        this._returnTimer = setTimeout(() => this.returnAfterSave(), 1500);
      }

    } catch (error) {
      if (this.data.saveSucceeded) {
        console.error('报告已保存，页面更新失败:', error);
        wx.showToast({ title: '报告已保存，请点击返回', icon: 'none' });
        return;
      }
      console.error('保存报告失败:', error);
      wx.showToast({
        title: error.message || '保存失败',
        icon: 'none'
      });
      this.setData({ saving: false });
    }
  },

  returnAfterSave() {
    if (this._returnTimer) {
      clearTimeout(this._returnTimer);
      this._returnTimer = null;
    }
    if (this._pageUnloaded || this._returnInProgress || !this.data.saveSucceeded) return;

    this._returnInProgress = true;
    wx.navigateBack({
      delta: this._returnDelta || 1,
      fail: () => {
        if (this._pageUnloaded) return;
        // 无可返回页面时回到报告分析，仍保持保存锁，导航失败可再次点击返回。
        wx.switchTab({
          url: '/pages/analysis-report/index',
          fail: () => {
            this._returnInProgress = false;
            wx.showToast({ title: '报告已保存，请重试返回', icon: 'none' });
          }
        });
      }
    });
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
