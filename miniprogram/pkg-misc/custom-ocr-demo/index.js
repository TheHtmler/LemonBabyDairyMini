const ReportModel = require('../../models/report');
const { parseReportOcrResult } = require('../../utils/reportOcrParser');

const CUSTOM_OCR_CLOUD_PATH_PREFIX = 'custom_ocr_temp';
const CUSTOM_OCR_CALL_TIMEOUT_MS = 70000;
const CUSTOM_OCR_TARGET_BYTES = 500 * 1024;
const CUSTOM_OCR_BASE64_MAX_BYTES = 512 * 1024;
const CUSTOM_OCR_MAX_WIDTH = 1400;

const REPORT_TYPE_OPTIONS = [
  { value: ReportModel.REPORT_TYPES.BLOOD_MS, label: '血串联' },
  { value: ReportModel.REPORT_TYPES.URINE_MS, label: '尿串联' },
  { value: ReportModel.REPORT_TYPES.BLOOD_GAS, label: '血气' },
  { value: ReportModel.REPORT_TYPES.BLOOD_AMMONIA, label: '血氨' }
];

Page({
  data: {
    reportTypeOptions: REPORT_TYPE_OPTIONS,
    selectedReportType: ReportModel.REPORT_TYPES.BLOOD_MS,
    recognizing: false,
    previewPath: '',
    ocrLines: [],
    parsedIndicators: {},
    parsedIndicatorKeys: [],
    rawJson: '',
    debugInfo: '',
    lastError: ''
  },

  getCloudCallConfig() {
    const cloudEnvId = getApp()?.globalData?.cloudEnvId || '';
    return cloudEnvId ? { config: { env: cloudEnvId } } : {};
  },

  onReportTypeTap(e) {
    const { value } = e.currentTarget.dataset || {};
    if (!value) return;
    this.setData({ selectedReportType: value });
  },

  callCustomOcrCloudFunction(payload) {
    const callPromise = wx.cloud.callFunction({
      name: 'recognizeReportCustom',
      data: payload,
      ...this.getCloudCallConfig()
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('识别超时（70秒）：请查看云函数日志中的 ocrMs / downloadMs'));
      }, CUSTOM_OCR_CALL_TIMEOUT_MS);
    });
    return Promise.race([callPromise, timeoutPromise]);
  },

  async prepareUploadImagePath(tempFilePath, fileSize = 0) {
    let currentPath = tempFilePath;
    let currentSize = fileSize;

    const refreshSize = async () => {
      try {
        const info = await new Promise((resolve, reject) => {
          wx.getFileSystemManager().getFileInfo({
            filePath: currentPath,
            success: resolve,
            fail: reject
          });
        });
        currentSize = info.size || 0;
      } catch (error) {
        currentSize = currentSize || 0;
      }
      return currentSize;
    };

    const compressWithQuality = async (quality) => {
      const compressed = await wx.compressImage({
        src: currentPath,
        quality,
        compressedWidth: CUSTOM_OCR_MAX_WIDTH
      });
      currentPath = compressed.tempFilePath || currentPath;
      await refreshSize();
      return currentPath;
    };

    if (!currentSize) {
      await refreshSize();
    }

    try {
      if (currentSize <= CUSTOM_OCR_TARGET_BYTES) {
        return compressWithQuality(80);
      }

      for (const quality of [70, 60, 45, 30, 20]) {
        await compressWithQuality(quality);
        if (currentSize <= CUSTOM_OCR_TARGET_BYTES) {
          return currentPath;
        }
      }
    } catch (error) {
      console.warn('[custom-ocr-demo] 压缩图片失败，使用原图继续:', error);
    }

    return currentPath;
  },

  getFileSize(filePath) {
    return new Promise((resolve) => {
      wx.getFileSystemManager().getFileInfo({
        filePath,
        success: (res) => resolve(res.size || 0),
        fail: () => resolve(0)
      });
    });
  },

  readFileBase64(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: (res) => resolve(res.data || ''),
        fail: reject
      });
    });
  },

  async buildRecognizePayload({ uploadPath, ocrRequestId, babyUid }) {
    const fileSize = await this.getFileSize(uploadPath);
    if (fileSize > 0 && fileSize <= CUSTOM_OCR_BASE64_MAX_BYTES) {
      const imageBase64 = await this.readFileBase64(uploadPath);
      return {
        payload: {
          imageBase64,
          fileName: 'report.jpg',
          ocrRequestId
        },
        transport: 'base64',
        fileSize
      };
    }

    const cloudPath = `${CUSTOM_OCR_CLOUD_PATH_PREFIX}/${babyUid}_${Date.now()}.jpg`;
    const uploadResult = await wx.cloud.uploadFile({
      cloudPath,
      filePath: uploadPath,
      ...this.getCloudCallConfig()
    });
    const fileID = uploadResult.fileID || uploadResult.fileId || '';
    if (!fileID) {
      throw new Error('上传识别图片失败');
    }
    return {
      payload: { fileID, ocrRequestId },
      transport: 'fileID',
      fileSize,
      fileID
    };
  },

  getRecognizeErrorMessage(error = {}, cloudResult = null) {
    if (cloudResult?.message) {
      return cloudResult.message;
    }
    const errMsg = `${error?.errMsg || error?.message || ''}`;
    if (errMsg.includes('识别超时') || errMsg.includes('OCR 服务请求超时') || errMsg.includes('OCR_TIMEOUT')) {
      return 'OCR 服务响应过慢，请稍后重试或检查服务器负载';
    }
    if (errMsg.includes('timeout') || errMsg.includes('timed out') || errMsg.includes('ESOCKETTIMEDOUT')) {
      return '云函数调用超时，请确认 recognizeReportCustom 已部署且超时设为 60 秒';
    }
    return error?.message || '自建 OCR 识别失败';
  },

  async onChooseAndRecognize() {
    if (this.data.recognizing) return;

    let media;
    try {
      media = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      });
    } catch (error) {
      return;
    }

    const tempFilePath = media?.tempFiles?.[0]?.tempFilePath;
    if (!tempFilePath) return;

    this.setData({
      recognizing: true,
      lastError: '',
      previewPath: tempFilePath,
      ocrLines: [],
      parsedIndicators: {},
      parsedIndicatorKeys: [],
      rawJson: '',
      debugInfo: ''
    });
    wx.showLoading({ title: '识别中...', mask: true });

    let fileID = '';
    const ocrRequestId = `custom_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    let transport = '';

    try {
      const babyUid = getApp()?.globalData?.babyInfo?.babyUid
        || getApp()?.globalData?.babyUid
        || wx.getStorageSync('baby_uid')
        || 'unknown';
      const uploadPath = await this.prepareUploadImagePath(
        tempFilePath,
        media?.tempFiles?.[0]?.size || 0
      );
      const recognizeRequest = await this.buildRecognizePayload({
        uploadPath,
        ocrRequestId,
        babyUid
      });
      transport = recognizeRequest.transport;
      fileID = recognizeRequest.fileID || '';

      console.warn('[custom-ocr-demo] invoke start', {
        ocrRequestId,
        transport,
        fileSize: recognizeRequest.fileSize,
        fileID: fileID || undefined
      });

      const cloudResponse = await this.callCustomOcrCloudFunction(recognizeRequest.payload);
      const result = cloudResponse?.result;

      console.warn('[custom-ocr-demo] cloud function result', {
        ocrRequestId,
        elapsedMs: Date.now() - startedAt,
        ok: result?.ok,
        code: result?.code,
        message: result?.message,
        lineCount: result?.meta?.lineCount,
        itemCount: result?.meta?.itemCount,
        debug: result?.debug
      });

      if (!result || result.ok !== true) {
        throw Object.assign(new Error(result?.message || '自建 OCR 识别失败'), { cloudResult: result });
      }

      const ocrLines = result.lines || [];
      const parsedIndicators = parseReportOcrResult({
        items: result.items || [],
        reportType: this.data.selectedReportType
      });
      const parsedIndicatorKeys = Object.keys(parsedIndicators);
      const debugInfo = [
        `transport：${result.meta?.source || transport || '-'}`,
        `provider：${result.meta?.provider || 'custom'}`,
        `endpoint：${result.meta?.endpoint || '-'}`,
        `图片：${result.meta?.outputBytes || result.meta?.bufferBytes || recognizeRequest.fileSize || 0} bytes`,
        `下载：${result.meta?.downloadMs || 0} ms`,
        `缩图：${result.meta?.preprocessMs || 0} ms`,
        `OCR：${result.meta?.ocrMs || 0} ms`,
        `总耗时：${result.meta?.elapsedMs || (Date.now() - startedAt)} ms`,
        `lines：${ocrLines.length} 条`,
        `items：${result.meta?.itemCount || 0} 项`,
        `解析指标：${parsedIndicatorKeys.length} 项`
      ].join('；');

      this.setData({
        ocrLines,
        parsedIndicators,
        parsedIndicatorKeys,
        rawJson: JSON.stringify(result, null, 2),
        debugInfo
      });

      if (ocrLines.length === 0) {
        wx.showToast({
          title: '未识别到文字',
          icon: 'none'
        });
        return;
      }

      wx.showToast({
        title: parsedIndicatorKeys.length
          ? `识别 ${ocrLines.length} 行，解析 ${parsedIndicatorKeys.length} 项`
          : `识别 ${ocrLines.length} 行`,
        icon: 'none'
      });
    } catch (error) {
      const message = this.getRecognizeErrorMessage(error, error?.cloudResult);
      this.setData({ lastError: message });
      console.error('[custom-ocr-demo] failed', {
        ocrRequestId,
        elapsedMs: Date.now() - startedAt,
        error
      });
      wx.showToast({
        title: message,
        icon: 'none',
        duration: 3500
      });
    } finally {
      wx.hideLoading();
      this.setData({ recognizing: false });
      if (fileID) {
        wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
      }
    }
  },

  onPreviewImage() {
    if (!this.data.previewPath) return;
    wx.previewImage({
      current: this.data.previewPath,
      urls: [this.data.previewPath]
    });
  },

  onCopyRawJson() {
    if (!this.data.rawJson) return;
    wx.setClipboardData({
      data: this.data.rawJson,
      success: () => {
        wx.showToast({
          title: '已复制 JSON',
          icon: 'success'
        });
      }
    });
  }
});
