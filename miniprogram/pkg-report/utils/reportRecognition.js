const { parseStructuredReportCandidates } = require('./reportOcrParser');
const { REPORT_OCR_TYPES, REPORT_MAX_IMAGE_BYTES, REPORT_MAX_PHOTOS, REPORT_OCR_TIMING, REPORT_RECOGNITION_VERSION } = require('../../constants/reportTypes');
const { MODEL_QUOTA_EXHAUSTED_MESSAGE, isModelQuotaExhausted } = require('../../utils/recognitionErrors');
const { summarizeReportValues } = require('../../utils/reportNumeric');
const { getReportCloudFailureMessage, logReportCloudFailure } = require('../../utils/reportCloudErrors');

const CALL_TIMEOUT_MS = REPORT_OCR_TIMING.clientMs;

function cloudConfig() {
  const env = getApp()?.globalData?.cloudEnvId || '';
  return env ? { config: { env } } : {};
}

async function prepareReportImage(tempFilePath, fileSize = 0) {
  const readSize = async (filePath, fallback = 0) => {
    try {
      const result = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject });
      });
      return result.size || fallback;
    } catch (_) { return fallback; }
  };
  const originalSize = await readSize(tempFilePath, fileSize);
  if (!originalSize || originalSize <= REPORT_MAX_IMAGE_BYTES) return tempFilePath;
  // 上限内保留原图；每次压缩都从原图开始，不叠加有损压缩损伤小字和小数点。
  for (const quality of [95, 90, 85, 80]) {
    try {
      const image = await wx.compressImage({ src: tempFilePath, quality });
      if (!image.tempFilePath) continue;
      const size = await readSize(image.tempFilePath);
      if (size > 0 && size <= REPORT_MAX_IMAGE_BYTES) return image.tempFilePath;
    } catch (_) {
      // 尝试下一档高质量压缩，不将未校验大小的压缩文件作为成功结果。
    }
  }
  throw new Error('图片过大，请分段拍摄报告以保留文字清晰度');
}

function getOcrFailureMessage(error = {}, cloudResult = null) {
  if (isModelQuotaExhausted(cloudResult) || isModelQuotaExhausted(error)) return MODEL_QUOTA_EXHAUSTED_MESSAGE;
  if (cloudResult?.message) return cloudResult.message;
  const message = `${error?.errMsg || error?.message || ''}`;
  if (message.includes('data exceed max size')) return '图片数据过大，请重新拍摄后再试';
  const cloudMessage = getReportCloudFailureMessage(error);
  if (cloudMessage) return cloudMessage;
  if (message.includes('OCR_GATEWAY_ERROR') || message.includes('后端无响应')) return 'OCR 服务暂时不可用，请稍后再试';
  if (message.includes('OCR_BUSY') || message.includes('繁忙')) return 'OCR 服务正在处理其他请求，请稍后再试';
  if (message.includes('OCR_NOT_ALLOWED')) return '拍照识别功能调试中，暂未对当前用户开放';
  if (message.includes('识别超时') || message.includes('timeout') || message.includes('timed out')) return '识别超时，请稍后重试或手动填写';
  return message || '识别失败，请重新拍摄后再试';
}

// 预览与填写页共用同一条识别链路；失效请求只清理临时文件，不再交付结果。
async function recognizeReportPhotos({ photos, reportType, babyUid, isCurrent = () => true }) {
  if (!Array.isArray(photos) || !photos.length || photos.length > REPORT_MAX_PHOTOS
    || photos.some(photo => !photo?.tempFilePath)) throw new Error('请选择1至6张报告图片');
  if (!REPORT_OCR_TYPES.some(type => type.key === reportType)) throw new Error('该类型暂不支持拍照识别');
  const fileIDs = [];
  let timer;
  let stage = 'upload';
  try {
    let next = 0; let failure;
    // 上传最多三张并行；保留照片顺序，失败或取消后等在途上传结束再清理，避免遗留晚完成文件。
    await Promise.all(Array.from({ length: Math.min(3, photos.length) }, async () => {
      while (!failure && isCurrent() && next < photos.length) {
        const index = next++;
        try {
          const photo = photos[index];
          const filePath = await prepareReportImage(photo.tempFilePath, photo.size || 0);
          if (failure || !isCurrent()) return;
          const upload = await wx.cloud.uploadFile({
            cloudPath: `custom_ocr_temp/${babyUid}_${Date.now()}_${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.jpg`,
            filePath, ...cloudConfig()
          });
          const fileID = upload.fileID || upload.fileId || '';
          if (!fileID) throw new Error('上传识别图片失败');
          fileIDs[index] = fileID;
        } catch (error) { if (!failure) failure = error; }
      }
    }));
    if (failure) throw failure;
    if (!isCurrent()) return null;
    stage = 'invoke';
    const response = await Promise.race([
      wx.cloud.callFunction({
        name: 'recognizeReportCustom',
        data: { fileIDs, babyUid, reportType, protocolVersion: REPORT_RECOGNITION_VERSION,
          ocrRequestId: `custom_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
        ...cloudConfig()
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('识别超时，请稍后重试或手动填写')), CALL_TIMEOUT_MS);
      })
    ]);
    stage = 'result';
    if (!isCurrent()) return null;
    const result = response?.result;
    if (!result || result.ok !== true) throw Object.assign(new Error(getOcrFailureMessage({}, result)),
      { code: result?.code || 'SERVICE_UNAVAILABLE' });
    const structuredItems = result.structuredItems;
    const candidates = parseStructuredReportCandidates({ structuredItems, reportType, protocolVersion: result.protocolVersion });
    console.info('[report-recognition-values]', { stage: 'received', reportType,
      parserVersion: result.parserVersion, values: summarizeReportValues(structuredItems.map(item => item.value)) });
    console.info('[report-recognition-values]', { stage: 'parsed', reportType,
      values: summarizeReportValues(candidates.map(item => item.value)) });
    return {
      candidates,
      context: {
        itemCount: structuredItems.length, imageCount: photos.length,
        warnings: Array.isArray(result.warnings) ? result.warnings : []
      }
    };
  } catch (error) {
    if (stage === 'invoke') logReportCloudFailure(error, 'recognition', getApp()?.globalData?.cloudEnvId || '');
    throw error;
  } finally {
    clearTimeout(timer);
    const uploaded = fileIDs.filter(Boolean);
    if (uploaded.length) wx.cloud.deleteFile({ fileList: uploaded }).catch(() => {});
  }
}

module.exports = { recognizeReportPhotos, getOcrFailureMessage };
