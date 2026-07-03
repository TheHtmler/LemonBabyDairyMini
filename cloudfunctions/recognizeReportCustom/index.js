const cloud = require('wx-server-sdk');
const { linesToOcrItems } = require('./customOcrAdapter');
const { requestCustomOcr } = require('./customOcrClient');
const { preprocessImageForOcr } = require('./imagePreprocess');
const { resolveImageBuffer } = require('./imagePayload');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_OCR_URL = 'http://60.205.243.92/ocr/file';
const MISSING_FILE_MESSAGE = '缺少识别图片';
const MISSING_CONFIG_MESSAGE = '未配置 CUSTOM_OCR_API_KEY 云函数环境变量';

function getCustomOcrConfig() {
  return {
    url: process.env.CUSTOM_OCR_URL || DEFAULT_OCR_URL,
    apiKey: process.env.CUSTOM_OCR_API_KEY || ''
  };
}

function hasImagePayload(event = {}) {
  return Boolean(event.fileID || event.avatarFileId || event.imageBase64);
}

exports.main = async (event = {}) => {
  const { url, apiKey } = getCustomOcrConfig();

  console.log('[recognizeReportCustom] invoke', {
    ocrRequestId: event.ocrRequestId || '',
    hasFileID: Boolean(event.fileID || event.avatarFileId),
    hasImageBase64: Boolean(event.imageBase64),
    endpoint: url,
    hasApiKey: Boolean(apiKey)
  });

  if (!hasImagePayload(event)) {
    return { ok: false, code: 'MISSING_FILE', message: MISSING_FILE_MESSAGE };
  }

  if (!apiKey) {
    return { ok: false, code: 'MISSING_CONFIG', message: MISSING_CONFIG_MESSAGE };
  }

  const startedAt = Date.now();

  try {
    const imagePayload = await resolveImageBuffer(cloud, event);
    if (!imagePayload?.buffer?.length) {
      return { ok: false, code: 'MISSING_FILE', message: MISSING_FILE_MESSAGE };
    }

    const preprocessStartedAt = Date.now();
    const preprocessed = await preprocessImageForOcr(imagePayload.buffer);
    const preprocessMs = preprocessed.preprocessMs ?? (Date.now() - preprocessStartedAt);

    console.log('[recognizeReportCustom] payload', {
      ocrRequestId: event.ocrRequestId || '',
      source: imagePayload.source,
      bufferBytes: imagePayload.buffer.length,
      outputBytes: preprocessed.outputBytes || preprocessed.buffer.length,
      resized: Boolean(preprocessed.resized),
      fileName: imagePayload.fileName,
      downloadMs: imagePayload.downloadMs || 0,
      preprocessMs
    });

    const ocrStartedAt = Date.now();
    const ocrResponse = await requestCustomOcr({
      buffer: preprocessed.buffer,
      fileName: imagePayload.fileName,
      url,
      apiKey
    });
    const ocrMs = Date.now() - ocrStartedAt;
    const lines = Array.isArray(ocrResponse?.lines) ? ocrResponse.lines : [];
    const items = linesToOcrItems(lines);
    const elapsedMs = Date.now() - startedAt;

    console.log('[recognizeReportCustom] result', {
      ocrRequestId: event.ocrRequestId || '',
      lineCount: lines.length,
      itemCount: items.length,
      source: imagePayload.source,
      downloadMs: imagePayload.downloadMs || 0,
      preprocessMs,
      ocrMs,
      elapsedMs,
      originalBytes: preprocessed.originalBytes,
      outputBytes: preprocessed.outputBytes
    });

    return {
      ok: true,
      lines,
      items,
      meta: {
        provider: 'custom',
        lineCount: lines.length,
        itemCount: items.length,
        endpoint: url,
        source: imagePayload.source,
        bufferBytes: imagePayload.buffer.length,
        downloadMs: imagePayload.downloadMs || 0,
        preprocessMs,
        ocrMs,
        elapsedMs,
        originalBytes: preprocessed.originalBytes,
        outputBytes: preprocessed.outputBytes,
        resized: Boolean(preprocessed.resized)
      }
    };
  } catch (error) {
    console.error('[recognizeReportCustom] failed', {
      ocrRequestId: event.ocrRequestId || '',
      elapsedMs: Date.now() - startedAt,
      error
    });
    if (error?.code === 'DOWNLOAD_FAILED' || `${error?.message || ''}`.includes('empty_file_content') || `${error?.message || ''}`.includes('empty_image_base64')) {
      return { ok: false, code: 'DOWNLOAD_FAILED', message: '读取图片失败，请重新拍摄后再试' };
    }
    if (error?.code === 'IMAGE_TOO_LARGE') {
      return { ok: false, code: 'IMAGE_TOO_LARGE', message: '图片过大，请重新拍摄或压缩后再试' };
    }
    return {
      ok: false,
      code: error?.code || 'RECOGNIZE_FAILED',
      message: error?.code === 'OCR_TIMEOUT'
        ? 'OCR 服务 55 秒内无响应，请检查服务器是否卡住'
        : (error?.message || '自建 OCR 识别失败'),
      debug: {
        statusCode: error?.statusCode,
        bodyPreview: error?.bodyPreview,
        endpoint: url,
        elapsedMs: Date.now() - startedAt
      }
    };
  }
};

exports._internal = {
  getCustomOcrConfig,
  hasImagePayload,
  resolveImageBuffer,
  preprocessImageForOcr,
  linesToOcrItems,
  requestCustomOcr
};
