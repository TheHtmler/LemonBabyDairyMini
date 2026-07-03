const cloud = require('wx-server-sdk');
const { consumeOcrQuota, releaseOcrQuota, readQuotaSnapshot, loadQuotaLimits } = require('./quota');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const OCR_MAX_BYTES = 2 * 1024 * 1024;
const MISSING_FILE_MESSAGE = '缺少识别图片';
const DOWNLOAD_FAILED_MESSAGE = '读取图片失败，请重新拍摄后再试';
const RECOGNIZE_FAILED_MESSAGE = '识别失败，请重新拍摄后再试';
const IMAGE_TOO_LARGE_MESSAGE = '图片过大，请重新拍摄或压缩后再试';
const QUOTA_EXCEEDED_MESSAGE = '今日识别次数已用完，请明天再试或手动填写';
const WECHAT_OCR_QUOTA_EXCEEDED_MESSAGE = '微信 OCR 今日共享额度已用完（约100次/天），请明天再试或手动填写';
const PERMISSION_DENIED_MESSAGE = 'OCR 权限未开通，请在开发者工具重新部署 recognizeReportImage 云函数';
const INVALID_IMAGE_URL_MESSAGE = '图片链接无效，微信 OCR 无法读取，请重新拍摄后再试';

function inferContentType(source = '', fallback = 'image/jpeg') {
  const lower = String(source || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return fallback;
}

function getApiErrorCode(errorOrResult = {}) {
  const code = errorOrResult.errCode ?? errorOrResult.errcode ?? errorOrResult.code;
  return code === undefined || code === null ? 0 : Number(code);
}

function getApiErrorMessage(errorOrResult = {}) {
  return `${errorOrResult.errMsg || errorOrResult.errmsg || errorOrResult.message || ''}`.trim();
}

function isImageTooLargeError(error = {}) {
  const message = getApiErrorMessage(error).toLowerCase();
  const code = getApiErrorCode(error);
  return code === 101002 || message.includes('too large') || message.includes('decode image') || message.includes('过大');
}

function isWeChatOcrQuotaError(error = {}) {
  const code = getApiErrorCode(error);
  const message = getApiErrorMessage(error).toLowerCase();
  return code === 101003 || message.includes('market quota') || message.includes('not enough market quota');
}

function isQuotaExceededError(error = {}) {
  if (isWeChatOcrQuotaError(error)) {
    return true;
  }
  const message = getApiErrorMessage(error).toLowerCase();
  const code = getApiErrorCode(error);
  return message.includes('quota') && code !== 0;
}

function isPermissionError(error = {}) {
  const message = getApiErrorMessage(error).toLowerCase();
  const code = getApiErrorCode(error);
  return code === 40001 || code === 41001 || message.includes('no permission') || message.includes('invalid credential') || message.includes('openapi');
}

function isInvalidImageUrlError(error = {}) {
  const code = getApiErrorCode(error);
  return code === 101000 || getApiErrorMessage(error).toLowerCase().includes('invalid image url');
}

function buildDebugInfo(error = {}, extra = {}) {
  return {
    errCode: getApiErrorCode(error) || undefined,
    errMsg: getApiErrorMessage(error) || undefined,
    ...extra
  };
}

function buildFailureResponse(error = {}, extra = {}) {
  const debug = buildDebugInfo(error, extra);
  if (isImageTooLargeError(error)) {
    return { ok: false, code: 'IMAGE_TOO_LARGE', message: IMAGE_TOO_LARGE_MESSAGE, debug };
  }
  if (isWeChatOcrQuotaError(error)) {
    return { ok: false, code: 'WECHAT_OCR_QUOTA_EXCEEDED', message: WECHAT_OCR_QUOTA_EXCEEDED_MESSAGE, debug };
  }
  if (isQuotaExceededError(error)) {
    return { ok: false, code: 'QUOTA_EXCEEDED', message: QUOTA_EXCEEDED_MESSAGE, debug };
  }
  if (isPermissionError(error)) {
    return { ok: false, code: 'PERMISSION_DENIED', message: PERMISSION_DENIED_MESSAGE, debug };
  }
  if (isInvalidImageUrlError(error)) {
    return { ok: false, code: 'INVALID_IMAGE_URL', message: INVALID_IMAGE_URL_MESSAGE, debug };
  }

  const errCode = getApiErrorCode(error);
  const errMsg = getApiErrorMessage(error);
  const message = errMsg
    ? `识别失败（${errCode || 'unknown'}：${errMsg}）`
    : RECOGNIZE_FAILED_MESSAGE;

  return { ok: false, code: 'RECOGNIZE_FAILED', message, debug };
}

function hasRecognizePayload(event = {}) {
  return Boolean(
    event.fileID
    || event.avatarFileId
    || event.imgUrl
    || event.imageBase64
  );
}

function isSuccessfulOcrResult(result = {}) {
  const errCode = getApiErrorCode(result);
  return !errCode || errCode === 0;
}

async function callPrintedText(payload, meta = {}) {
  console.log('[recognizeReportImage] printedText request', {
    ...meta,
    hasImgUrl: Boolean(payload.imgUrl || payload.img_url),
    hasImg: Boolean(payload.img),
    bufferBytes: payload.img?.value?.length || 0
  });

  try {
    const result = await cloud.openapi.ocr.printedText(payload);
    console.log('[recognizeReportImage] printedText response', {
      ...meta,
      errCode: getApiErrorCode(result),
      errMsg: getApiErrorMessage(result),
      itemCount: Array.isArray(result?.items) ? result.items.length : 0
    });
    return result;
  } catch (error) {
    console.error('[recognizeReportImage] printedText threw', meta, error);
    throw error;
  }
}

async function downloadCloudImage(fileID) {
  try {
    const fileRes = await cloud.downloadFile({ fileID });
    const fileContent = fileRes.fileContent;
    if (!fileContent || !fileContent.length) {
      throw Object.assign(new Error('empty_file_content'), { code: 'DOWNLOAD_FAILED' });
    }
    return fileContent;
  } catch (error) {
    console.error('下载识别图片失败:', error);
    throw Object.assign(error, { code: 'DOWNLOAD_FAILED' });
  }
}

function buildBufferPayload(buffer, contentType, withType) {
  const payload = {
    img: {
      contentType: contentType || 'image/jpeg',
      value: buffer
    }
  };
  if (withType) {
    payload.type = 'photo';
  }
  return payload;
}

function buildImgUrlPayload(imgUrl, withType) {
  const payload = { imgUrl };
  if (withType) {
    payload.type = 'photo';
  }
  return payload;
}

async function buildRecognizeAttempts(event = {}) {
  const fileID = event.fileID || event.avatarFileId || '';
  const imgUrl = event.imgUrl || '';
  const imageBase64 = event.imageBase64 || '';
  const contentType = event.contentType || inferContentType(fileID, 'image/jpeg');
  const attempts = [];

  // 有 fileID 时优先走云存储下载，不再走 imgUrl，避免一次识别多次消耗微信 OCR 额度
  if (fileID) {
    let buffer = null;
    attempts.push({
      path: 'fileID-buffer-photo',
      async prepare() {
        if (!buffer) {
          buffer = await downloadCloudImage(fileID);
        }
        if (buffer.length > OCR_MAX_BYTES) {
          throw Object.assign(new Error('image_too_large'), { code: 'IMAGE_TOO_LARGE', bufferBytes: buffer.length });
        }
        return buildBufferPayload(buffer, inferContentType(fileID, contentType), true);
      }
    });
    attempts.push({
      path: 'fileID-buffer-plain',
      async prepare() {
        if (!buffer) {
          buffer = await downloadCloudImage(fileID);
        }
        if (buffer.length > OCR_MAX_BYTES) {
          throw Object.assign(new Error('image_too_large'), { code: 'IMAGE_TOO_LARGE', bufferBytes: buffer.length });
        }
        return buildBufferPayload(buffer, inferContentType(fileID, contentType), false);
      }
    });
  } else if (imgUrl) {
    attempts.push({
      path: 'imgUrl-plain',
      payload: buildImgUrlPayload(imgUrl, false)
    });
    attempts.push({
      path: 'imgUrl-photo',
      payload: buildImgUrlPayload(imgUrl, true)
    });
  }

  if (imageBase64) {
    const buffer = Buffer.from(imageBase64, 'base64');
    if (!buffer.length) {
      throw Object.assign(new Error('empty_image_base64'), { code: 'DOWNLOAD_FAILED' });
    }
    attempts.push({
      path: 'imageBase64-photo',
      payload: buildBufferPayload(buffer, contentType, true)
    });
  }

  return attempts;
}

async function recognizeFromEvent(event = {}) {
  const attempts = await buildRecognizeAttempts(event);
  const usage = {
    wechatOcrCallCount: 0,
    attemptedPaths: [],
    plannedPaths: attempts.map((attempt) => attempt.path),
    successfulPath: ''
  };

  if (!attempts.length) {
    return null;
  }

  let lastError = null;
  let lastPath = '';

  for (const attempt of attempts) {
    try {
      const payload = attempt.payload || await attempt.prepare();
      usage.wechatOcrCallCount += 1;
      usage.attemptedPaths.push(attempt.path);

      const result = await callPrintedText(payload, {
        ocrRequestId: event.ocrRequestId || '',
        path: attempt.path
      });
      if (isSuccessfulOcrResult(result)) {
        usage.successfulPath = attempt.path;
        return { ocrResult: result, usage };
      }
      if (isWeChatOcrQuotaError(result)) {
        const quotaError = new Error(getApiErrorMessage(result) || 'wechat_ocr_quota_exceeded');
        Object.assign(quotaError, {
          errCode: getApiErrorCode(result),
          errcode: getApiErrorCode(result),
          errmsg: getApiErrorMessage(result),
          lastPath: attempt.path,
          wechatOcrUsage: usage
        });
        throw quotaError;
      }
      lastError = result;
      lastPath = attempt.path;
    } catch (error) {
      if (error?.code === 'DOWNLOAD_FAILED' || error?.code === 'IMAGE_TOO_LARGE') {
        error.wechatOcrUsage = usage;
        throw error;
      }
      if (isWeChatOcrQuotaError(error)) {
        error.wechatOcrUsage = error.wechatOcrUsage || usage;
        error.lastPath = error.lastPath || attempt.path;
        throw error;
      }
      if (`${error?.message || ''}`.includes('empty_file_content') || `${error?.message || ''}`.includes('empty_image_base64')) {
        error.wechatOcrUsage = usage;
        throw error;
      }
      if (!usage.attemptedPaths.includes(attempt.path)) {
        usage.wechatOcrCallCount += 1;
        usage.attemptedPaths.push(attempt.path);
      }
      lastError = error;
      lastPath = attempt.path;
    }
  }

  if (lastError) {
    const thrown = new Error(getApiErrorMessage(lastError) || 'ocr_failed');
    Object.assign(thrown, {
      errCode: getApiErrorCode(lastError),
      errcode: getApiErrorCode(lastError),
      errmsg: getApiErrorMessage(lastError),
      lastPath,
      bufferBytes: lastError?.bufferBytes,
      wechatOcrUsage: usage
    });
    throw thrown;
  }

  return null;
}

function logWeChatOcrUsage(event = {}, usage = null) {
  if (!usage) return;
  console.log('[recognizeReportImage] wechat ocr usage', {
    ocrRequestId: event.ocrRequestId || '',
    babyUid: event.babyUid || '',
    wechatOcrCallCount: usage.wechatOcrCallCount,
    attemptedPaths: usage.attemptedPaths,
    plannedPaths: usage.plannedPaths,
    successfulPath: usage.successfulPath || undefined
  });
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || '';
  let quotaResult = null;

  console.log('[recognizeReportImage] invoke', {
    action: event.action || 'recognize',
    ocrRequestId: event.ocrRequestId || '',
    babyUid: event.babyUid || '',
    hasFileID: Boolean(event.fileID || event.avatarFileId),
    hasImgUrl: Boolean(event.imgUrl),
    hasImageBase64: Boolean(event.imageBase64)
  });

  if (event.action === 'quota') {
    try {
      const limits = await loadQuotaLimits(cloud.database());
      const quota = await readQuotaSnapshot(cloud.database(), {
        babyUid: event.babyUid || '',
        openid,
        limits
      });
      return { ok: true, quota: { ...quota, limits } };
    } catch (error) {
      console.error('[recognizeReportImage] read quota failed', error);
      return { ok: false, code: 'QUOTA_READ_FAILED', message: '读取识别次数失败' };
    }
  }

  if (!hasRecognizePayload(event)) {
    return { ok: false, code: 'MISSING_FILE', message: MISSING_FILE_MESSAGE };
  }

  try {
    quotaResult = await consumeOcrQuota({
      db: cloud.database(),
      babyUid: event.babyUid || '',
      openid
    });
    if (!quotaResult.ok) {
      console.warn('[recognizeReportImage] quota blocked', {
        ocrRequestId: event.ocrRequestId || '',
        babyUid: event.babyUid || '',
        code: quotaResult.code,
        scope: quotaResult.scope || '',
        dateKey: quotaResult.dateKey || '',
        monthKey: quotaResult.monthKey || ''
      });
      let quota = null;
      try {
        quota = await readQuotaSnapshot(cloud.database(), {
          babyUid: event.babyUid || '',
          openid,
          limits: quotaResult.limits
        });
      } catch (error) {
        console.warn('[recognizeReportImage] read quota snapshot failed', error);
      }
      return {
        ok: false,
        code: quotaResult.code,
        message: quotaResult.message,
        quota
      };
    }

    const recognized = await recognizeFromEvent(event);
    if (!recognized) {
      await releaseOcrQuota({
        db: cloud.database(),
        babyUid: event.babyUid || '',
        openid
      });
      return { ok: false, code: 'MISSING_FILE', message: MISSING_FILE_MESSAGE };
    }

    const { ocrResult, usage } = recognized;
    logWeChatOcrUsage(event, usage);

    return {
      ok: true,
      items: ocrResult?.items || [],
      quota: quotaResult.quota || null,
      meta: {
        itemCount: Array.isArray(ocrResult?.items) ? ocrResult.items.length : 0,
        sampleTexts: (ocrResult?.items || []).slice(0, 5).map((item) => item?.text).filter(Boolean),
        wechatOcrCallCount: usage.wechatOcrCallCount,
        attemptedPaths: usage.attemptedPaths,
        successfulPath: usage.successfulPath
      }
    };
  } catch (error) {
    console.error('报告拍照识别失败:', error);
    logWeChatOcrUsage(event, error?.wechatOcrUsage);
    if (quotaResult?.ok) {
      try {
        await releaseOcrQuota({
          db: cloud.database(),
          babyUid: event.babyUid || '',
          openid
        });
      } catch (releaseError) {
        console.warn('[recognizeReportImage] release quota failed', releaseError);
      }
    }
    if (error?.code === 'DOWNLOAD_FAILED' || `${error?.message || ''}`.includes('empty_file_content') || `${error?.message || ''}`.includes('empty_image_base64')) {
      return {
        ok: false,
        code: 'DOWNLOAD_FAILED',
        message: DOWNLOAD_FAILED_MESSAGE,
        debug: buildDebugInfo(error, {
          path: error?.lastPath,
          wechatOcrCallCount: error?.wechatOcrUsage?.wechatOcrCallCount,
          attemptedPaths: error?.wechatOcrUsage?.attemptedPaths
        })
      };
    }
    if (error?.code === 'IMAGE_TOO_LARGE' || `${error?.message || ''}`.includes('image_too_large')) {
      return {
        ok: false,
        code: 'IMAGE_TOO_LARGE',
        message: IMAGE_TOO_LARGE_MESSAGE,
        debug: buildDebugInfo(error, {
          path: error?.lastPath,
          bufferBytes: error?.bufferBytes,
          wechatOcrCallCount: error?.wechatOcrUsage?.wechatOcrCallCount,
          attemptedPaths: error?.wechatOcrUsage?.attemptedPaths
        })
      };
    }
    return buildFailureResponse(error, {
      path: error?.lastPath,
      bufferBytes: error?.bufferBytes,
      wechatOcrCallCount: error?.wechatOcrUsage?.wechatOcrCallCount,
      attemptedPaths: error?.wechatOcrUsage?.attemptedPaths
    });
  }
};

exports._internal = {
  inferContentType,
  getApiErrorCode,
  getApiErrorMessage,
  hasRecognizePayload,
  recognizeFromEvent,
  buildRecognizeAttempts,
  isImageTooLargeError,
  isWeChatOcrQuotaError,
  isQuotaExceededError,
  isPermissionError,
  isInvalidImageUrlError,
  buildFailureResponse,
  consumeOcrQuota,
  releaseOcrQuota
};
