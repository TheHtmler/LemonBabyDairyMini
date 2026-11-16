const { REPORT_OCR_TYPES, REPORT_MAX_PHOTOS } = require('../../constants/reportTypes');
const { currentContext } = require('../../utils/searchSession');
const { getReportOcrAccess } = require('../../utils/reportOcrAccess');
const { recognizeReportPhotos, getOcrFailureMessage } = require('../utils/reportRecognition');
const { mergeReportPages } = require('../utils/reportPageMerge');
const { callOriginals } = require('../../utils/reportOriginals');
const { isModelQuotaExhausted } = require('../../utils/recognitionErrors');
const { summarizeReportValues } = require('../../utils/reportNumeric');

Page({
  data: {
    reportType: '', reportTypeName: '', fillExisting: false, pages: [], rows: [],
    loading: true, error: '', sending: false, choosingPhotos: false, canConfirm: false,
    failedCount: 0, failureMessage: '', modelQuotaExhausted: false, maxPhotos: REPORT_MAX_PHOTOS,
    originalsEnabled: false, saveOriginals: false, unrecognizedCount: 0
  },
  onLoad(options = {}) {
    this._requestId = 0; this._photoSequence = 0; this._pages = []; this._choices = {}; this._batchResult = null;
    const type = REPORT_OCR_TYPES.find(item => item.key === options.type);
    if (!type) { this.setData({ loading: false, error: '该报告类型暂不支持识别，请返回重新选择' }); return; }
    this.setData({ reportType: type.key, reportTypeName: type.name, fillExisting: options.target === 'existing' });
    const channel = this.getOpenerEventChannel();
    if (typeof channel.once !== 'function') {
      this.setData({ loading: false, error: '未收到报告图片，请返回重新拍摄' }); return;
    }
    this._photoChannel = channel;
    channel.once('reportPhotosSelected', batch => {
      if (this._unloaded) return;
      this._context = { babyUid: batch?.babyUid, accountKey: batch?.accountKey };
      if (!this.isBatchCurrent()) { this.showContextError(); return; }
      callOriginals({ action: 'originalsCapabilities', babyUid: this._context.babyUid }).then(result => {
        if (this.isBatchCurrent()) this.setData({ originalsEnabled: result.enabled === true });
      }).catch(() => { /* 原图服务未部署时仍允许正常识别和录入。 */ });
      const photos = batch?.photos;
      if (!Array.isArray(photos) || !photos.length || photos.length > REPORT_MAX_PHOTOS
        || photos.some(photo => typeof photo?.tempFilePath !== 'string' || !photo.tempFilePath)) {
        this.setData({ loading: false, error: '报告图片无效，请返回重新选择' }); return;
      }
      this.appendPhotos(photos);
      this.recognizePending();
    });
  },
  onShow() {
    this.setData({ sending: false });
    if (this._context && !this.isBatchCurrent()) this.showContextError();
    else if (this._context) this.refreshResults();
  },
  onUnload() {
    this._unloaded = true; this._requestId++;
    this._pages = []; this._merged = null; this._context = null; this._batchResult = null;
    if (this._photoChannel) this._photoChannel.off('reportPhotosSelected');
  },
  isBatchCurrent() {
    const current = currentContext();
    return !this._unloaded && !!this._context?.accountKey && !!this._context.babyUid && this._context.accountKey === current.accountKey
      && this._context.babyUid === current.babyUid && this._context.babyUid === getApp().globalData.babyInfo?.babyUid;
  },
  showContextError() {
    this._requestId++; this._pages = []; this._merged = null; this._context = null; this._choices = {}; this._batchResult = null;
    this.setData({ loading: false, pages: [], rows: [], canConfirm: false,
      failedCount: 0, failureMessage: '', modelQuotaExhausted: false,
      error: '宝宝或账号已切换，请返回重新拍摄报告' });
  },
  appendPhotos(photos) {
    const previousCount = this._pages.length;
    photos.forEach(photo => {
      if (this._pages.length < REPORT_MAX_PHOTOS) this._pages.push({
        id: 'report-page-' + (++this._photoSequence), photo: { tempFilePath: photo.tempFilePath, size: photo.size || 0 },
        status: 'pending', error: ''
      });
    });
    if (this._pages.length !== previousCount) this.invalidateRecognition();
    this.refreshResults();
  },
  invalidateRecognition() {
    // 联合结果属于整组照片；增删后必须作废整组结果，不能继续使用已移除照片的证据。
    this._batchResult = null; this._merged = null; this._choices = {};
    this._pages.forEach(page => { page.status = 'pending'; page.error = ''; });
  },
  refreshResults() {
    if (this._unloaded) return;
    const merged = mergeReportPages(this._batchResult ? [{ status: 'success', result: this._batchResult }] : [],
      this.data.reportType, this._choices);
    this._merged = merged;
    const pages = this._pages.map(page => ({
      id: page.id, imagePath: page.photo.tempFilePath,
      status: page.status, modelQuotaExhausted: isModelQuotaExhausted(page.error)
    }));
    const failedPages = this._pages.filter(page => page.status === 'failed');
    this.setData({ pages, rows: merged.rows,
      unrecognizedCount: merged.context.unrecognizedCount,
      failedCount: failedPages.length, failureMessage: failedPages[0]?.error || '',
      modelQuotaExhausted: failedPages.some(page => isModelQuotaExhausted(page.error)),
      loading: !!this._recognizing,
      canConfirm: this.isBatchCurrent() && Object.keys(merged.indicators).length > 0
        && !this._recognizing && !this._choosingPhotos });
  },
  async recognizePending() {
    if (this._recognizing || !this.isBatchCurrent()) return;
    if (!this._pages.some(page => page.status === 'pending')) { this.refreshResults(); return; }
    const tasks = [...this._pages];
    const requestId = ++this._requestId;
    const isCurrent = () => requestId === this._requestId && this.isBatchCurrent();
    this._recognizing = true;
    this.setData({ error: '' });
    this.refreshResults();
    try {
      const access = await getReportOcrAccess(this._context.babyUid);
      if (!isCurrent()) return;
      if (!access.available) throw Object.assign(new Error(access.message || '报告识别暂未开放'), { code: access.reasonCode });
      tasks.forEach(page => { page.status = 'recognizing'; page.error = ''; });
      this.refreshResults();
      const result = await recognizeReportPhotos({ photos: tasks.map(page => page.photo),
        reportType: this.data.reportType, babyUid: this._context.babyUid, isCurrent });
      if (!result || !isCurrent()) return;
      this._batchResult = result;
      tasks.forEach(page => { page.status = 'success'; });
    } catch (error) {
      if (isCurrent()) {
        this._batchResult = null;
        tasks.forEach(page => { page.status = 'failed'; page.error = getOcrFailureMessage(error); });
      }
    } finally {
      this._recognizing = false;
      if (isCurrent()) this.refreshResults();
    }
  },
  retryFailed(event) {
    if (this.data.loading || this.data.sending || this._choosingPhotos) return;
    const page = this._pages.find(item => item.id === event.currentTarget.dataset.id && item.status === 'failed');
    if (!page) return;
    this.invalidateRecognition();
    this.recognizePending();
  },
  async addPhotos() {
    if (this.data.loading || this.data.sending || this._choosingPhotos || !this.isBatchCurrent()) return;
    const remaining = REPORT_MAX_PHOTOS - this._pages.length;
    if (remaining <= 0) { wx.showToast({ title: '最多6张，请先移除不需要的图片', icon: 'none' }); return; }
    this._choosingPhotos = true; this.setData({ choosingPhotos: true }); this.refreshResults();
    try {
      const choice = await wx.showActionSheet({ itemList: ['继续拍摄', '从相册选择'] });
      if (!this.isBatchCurrent()) return;
      const source = choice.tapIndex === 0 ? 'camera' : 'album';
      const media = await wx.chooseMedia({ count: source === 'camera' ? 1 : remaining,
        mediaType: ['image'], sizeType: ['original'], sourceType: [source] });
      if (!this.isBatchCurrent()) return;
      this.appendPhotos((media?.tempFiles || []).filter(photo => photo?.tempFilePath));
    } catch (error) {
      if (this.isBatchCurrent() && !/cancel/i.test(error.errMsg || error.message || '')) wx.showToast({ title: '添加图片失败，请重试', icon: 'none' });
    } finally {
      this._choosingPhotos = false;
      if (!this._unloaded) this.setData({ choosingPhotos: false });
      if (this.isBatchCurrent()) { this.refreshResults(); this.recognizePending(); }
    }
  },
  async removePage(event) {
    if (this.data.loading || this.data.sending || this._choosingPhotos || !this.isBatchCurrent()) return;
    const id = event.currentTarget.dataset.id;
    const page = this._pages.find(item => item.id === id);
    if (!page) return;
    this._choosingPhotos = true; this.refreshResults();
    try {
      const result = await wx.showModal({ title: '移除这一页', content: '此页图片和识别结果将从本次报告中移除。',
        confirmText: '移除', cancelText: '取消' });
      if (result.confirm && this.isBatchCurrent()) {
        this._pages = this._pages.filter(item => item.id !== id);
        this.invalidateRecognition();
      }
    } catch (_) { /* 取消或弹窗失败时保留图片和识别结果。 */ }
    finally {
      this._choosingPhotos = false;
      if (this.isBatchCurrent()) { this.refreshResults(); this.recognizePending(); }
    }
  },
  async reviewResult(event) {
    if (this.data.sending || this._choosingPhotos || !this.isBatchCurrent()) return;
    const key = event.currentTarget.dataset.key;
    const conflict = this._merged?.conflicts.find(item => item.key === key);
    if (!conflict) return;
    this._choosingPhotos = true; this.setData({ choosingPhotos: true }); this.refreshResults();
    try {
      const selectable = conflict.variants.filter(variant => !variant.confirmationBlocked);
      if (!selectable.length || selectable.length > 6) {
        await wx.showModal({ title: '请对照原报告填写', showCancel: false,
          content: conflict.variants.map(variant => [variant.sourceLabel, variant.sourceText,
            variant.valueText, variant.unit, variant.rangeText].filter(Boolean).join(' ')).join('\n') +
            '\n此项暂不自动填入，可继续录入其他可靠项目，再据原图手工填写。' });
        return;
      }
      const choice = await wx.showActionSheet({ itemList: selectable.map(variant =>
        [variant.sourceLabel, variant.sourceText, variant.valueText, variant.unit, '参考范围 ' + variant.rangeText,
          variant.confirmationBlocked ? '单位需核对，不能自动填入' : '']
          .filter(Boolean).join(' ')) });
      const variant = selectable[choice.tapIndex];
      if (variant?.confirmationBlocked) {
        wx.showToast({ title: '此项单位需核对，请手工填写', icon: 'none' });
      } else if (variant && this.isBatchCurrent()) this._choices[key] = variant.signature;
    } catch (_) { /* 取消时保留已有结果，不自动选取冲突值。 */ }
    finally {
      this._choosingPhotos = false;
      if (!this._unloaded) this.setData({ choosingPhotos: false });
      if (this.isBatchCurrent()) this.refreshResults();
    }
  },
  onPhotoTap(event) {
    const page = this._pages.find(item => item.id === event.currentTarget.dataset.id);
    if (page?.status === 'failed') this.managePhoto(event);
    else this.previewOriginal(event);
  },
  async managePhoto(event) {
    if (this.data.loading || this.data.sending || this._choosingPhotos || !this.isBatchCurrent()) return;
    const page = this._pages.find(item => item.id === event.currentTarget.dataset.id);
    if (!page) return;
    const actions = page.status === 'failed' ? ['重试识别', '查看原图', '移除图片'] : ['查看原图', '移除图片'];
    this._choosingPhotos = true; this.setData({ choosingPhotos: true }); this.refreshResults();
    let action;
    try {
      const choice = await wx.showActionSheet({ itemList: actions });
      action = actions[choice.tapIndex];
    } catch (_) { /* 取消时不修改本次报告。 */ }
    finally {
      this._choosingPhotos = false;
      if (!this._unloaded) this.setData({ choosingPhotos: false });
      if (this.isBatchCurrent()) this.refreshResults();
    }
    if (!this.isBatchCurrent()) return;
    if (action === '重试识别') this.retryFailed(event);
    else if (action === '查看原图') this.previewOriginal(event);
    else if (action === '移除图片') this.removePage(event);
  },
  previewOriginal(event) {
    const id = event.currentTarget.dataset.id;
    const page = this._pages.find(item => item.id === id);
    if (page) wx.previewImage({ current: page.photo.tempFilePath, urls: this._pages.map(item => item.photo.tempFilePath) });
  },
  retake() {
    if (!this.data.sending) wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/daily-feeding/index' }) });
  },
  onSaveOriginalsChange(event) {
    if (this.isBatchCurrent() && !this.data.sending && this.data.originalsEnabled) {
      this.setData({ saveOriginals: event.detail.value === true });
    }
  },
  confirmRecognition() {
    if (!this.data.canConfirm || this.data.sending || this._choosingPhotos) return;
    if (!this.isBatchCurrent()) { this.showContextError(); return; }
    const context = this._context; const result = this._merged;
    if (!result || !Object.keys(result.indicators).length) return;
    console.info('[report-recognition-values]', { stage: 'handoff', reportType: this.data.reportType,
      values: summarizeReportValues(Object.values(result.indicators).map(item => item.value)) });
    this.setData({ sending: true });
    const payload = { indicators: result.indicators, context: { ...result.context, pageCount: this._pages.length },
      reportType: this.data.reportType, ...context,
      originalPhotos: this.data.originalsEnabled && this.data.saveOriginals ? this._pages.map(page => page.photo.tempFilePath) : [] };
    if (this.data.fillExisting) {
      try {
        this._photoChannel.emit('reportRecognitionConfirmed', payload);
        wx.navigateBack({ fail: () => {
          if (!this._unloaded) this.setData({ sending: false });
          wx.showToast({ title: '已填入，请点击返回', icon: 'none' });
        } });
      } catch (_) {
        this.setData({ sending: false }); wx.showToast({ title: '结果传递失败，请重试', icon: 'none' });
      }
      return;
    }
    wx.navigateTo({
      url: '/pkg-report/add-report/index?mode=add&type=' + encodeURIComponent(this.data.reportType) + '&from=recognition',
      success: response => {
        try {
          response.eventChannel.emit('reportRecognitionConfirmed', payload);
        } catch (_) {
          if (!this._unloaded) this.setData({ sending: false });
          wx.showToast({ title: '识别结果传递失败，请返回重试', icon: 'none' });
        }
      },
      fail: () => {
        if (this._unloaded) return;
        this.setData({ sending: false }); wx.showToast({ title: '无法打开创建报告，请重试', icon: 'none' });
      }
    });
  }
});
