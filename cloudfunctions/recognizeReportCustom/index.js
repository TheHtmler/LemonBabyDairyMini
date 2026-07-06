const cloud = require('wx-server-sdk');
const { adaptOcrResponse } = require('./customOcrAdapter');
const { requestCustomOcrWithRetry, checkOcrHealth } = require('./customOcrClient');
const { preprocessImageForOcr } = require('./imagePreprocess');
const { resolveImageBuffer } = require('./imagePayload');
const { OCR_MODES, resolveOcrEndpoint, resolveHealthUrl, inferContentType } = require('./ocrConfig');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const FEATURE_FLAG_COLLECTION = 'feature_flags';
const REPORT_OCR_ACCESS_KEY = 'report_ocr_access';
const MISSING_FILE_MESSAGE = '缺少识别图片';
const MISSING_CONFIG_MESSAGE = '未配置 CUSTOM_OCR_API_KEY 云函数环境变量';
const OCR_ACCESS_DENIED_MESSAGE = '拍照识别功能调试中，暂未对当前用户开放';

function getCustomOcrConfig(event = {}) {
  return resolveOcrEndpoint(process.env, event.mode);
}

function hasImagePayload(event = {}) {
  return Boolean(event.fileID || event.avatarFileId || event.imageBase64);
}

function normalizeOpenid(value = '') {
  return String(value || '').trim();
}

function normalizeOpenids(openids = []) {
  const source = Array.isArray(openids)
    ? openids
    : String(openids || '').split(/[\n,，\s]+/);
  return Array.from(new Set(source.map(normalizeOpenid).filter(Boolean)));
}

function normalizeScope(scope = '') {
  return scope === 'all' ? 'all' : 'whitelist';
}

function normalizeReportOcrAccess(config = {}) {
  return {
    scope: normalizeScope(config.scope),
    allowOpenids: normalizeOpenids(config.allowOpenids),
    message: String(config.message || OCR_ACCESS_DENIED_MESSAGE).trim() || OCR_ACCESS_DENIED_MESSAGE
  };
}

async function getReportOcrAccessConfig() {
  try {
    const res = await db.collection(FEATURE_FLAG_COLLECTION)
      .where({ key: REPORT_OCR_ACCESS_KEY })
      .limit(1)
      .get();
    return normalizeReportOcrAccess(res.data?.[0] || {});
  } catch (error) {
    console.warn('[recognizeReportCustom] access config missing', error);
    return normalizeReportOcrAccess({});
  }
}

async function resolveReportOcrAccess(openid = '') {
  const config = await getReportOcrAccessConfig();
  const normalizedOpenid = normalizeOpenid(openid);
  const allowed = config.scope === 'all' || config.allowOpenids.includes(normalizedOpenid);
  return {
    allowed,
    scope: config.scope,
    message: allowed ? '' : config.message
  };
}

function resolveUserMessage(error = {}) {
  if (error.code === 'OCR_TIMEOUT') {
    return 'OCR 服务 55 秒内无响应，请检查 Mac mini 服务是否卡住';
  }
  if (error.code === 'OCR_GATEWAY_ERROR') {
    return 'OCR 后端无响应（502），请确认 Mac mini 在运行，且 nginx 超时 ≥ 120 秒';
  }
  if (error.code === 'OCR_NOT_READY' || error.code === 'OCR_HEALTH_FAILED') {
    return 'OCR 服务未就绪，请先在 Mac mini 上确认 /api/v1/health 正常';
  }
  if (error.code === 'OCR_BUSY') {
    return 'OCR 服务正在处理其他请求，请稍后再试';
  }
  if (error.code === 'OCR_UNAVAILABLE') {
    return 'OCR 服务暂不可用，请稍后再试';
  }
  return error.message || '自建 OCR 识别失败';
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const ocrConfig = getCustomOcrConfig(event);
  const { url, apiKey, mode, urlMigrated, rawCustomUrl } = ocrConfig;
  const healthUrl = resolveHealthUrl(process.env);

  if (event.action === 'checkAccess') {
    const access = await resolveReportOcrAccess(OPENID);
    return {
      ok: true,
      action: 'checkAccess',
      allowed: access.allowed,
      scope: access.scope,
      message: access.message || ''
    };
  }

  if (event.action === 'probe') {
    const startedAt = Date.now();
    try {
      const health = await checkOcrHealth(healthUrl, 8000);
      return {
        ok: true,
        action: 'probe',
        config: {
          endpoint: url,
          healthUrl,
          mode,
          urlMigrated: Boolean(urlMigrated),
          rawCustomUrl: rawCustomUrl || undefined,
          hasApiKey: Boolean(apiKey)
        },
        health: health.health,
        responseServer: health.responseServer,
        elapsedMs: Date.now() - startedAt,
        hint: health.responseServer === 'nginx'
          ? '命中 nginx 说明仍在访问 80 端口，请删除 CUSTOM_OCR_URL 并改用 CUSTOM_OCR_BASE_URL=http://60.205.243.92:8080'
          : '正常应看到 responseServer=uvicorn'
      };
    } catch (error) {
      return {
        ok: false,
        action: 'probe',
        code: error?.code || 'PROBE_FAILED',
        message: resolveUserMessage(error),
        config: {
          endpoint: url,
          healthUrl,
          mode,
          urlMigrated: Boolean(urlMigrated),
          rawCustomUrl: rawCustomUrl || undefined,
          hasApiKey: Boolean(apiKey)
        },
        debug: {
          statusCode: error?.statusCode,
          responseServer: error?.responseServer,
          bodyPreview: error?.bodyPreview,
          elapsedMs: Date.now() - startedAt
        },
        hint: error?.responseServer === 'nginx' || `${error?.bodyPreview || ''}`.includes('nginx')
          ? '502/504 且 server=nginx：云函数打到了 80 端口。请删除环境变量 CUSTOM_OCR_URL，只保留 CUSTOM_OCR_BASE_URL=http://60.205.243.92:8080'
          : undefined
      };
    }
  }

  console.log('[recognizeReportCustom] invoke', {
    ocrRequestId: event.ocrRequestId || '',
    hasFileID: Boolean(event.fileID || event.avatarFileId),
    hasImageBase64: Boolean(event.imageBase64),
    mode,
    endpoint: url,
    healthUrl,
    urlMigrated: Boolean(urlMigrated),
    rawCustomUrl: rawCustomUrl || undefined,
    hasApiKey: Boolean(apiKey)
  });

  const access = await resolveReportOcrAccess(OPENID);
  if (!access.allowed) {
    return {
      ok: false,
      code: 'OCR_NOT_ALLOWED',
      message: access.message || OCR_ACCESS_DENIED_MESSAGE
    };
  }

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

    const shouldPreprocess = event.skipPreprocess === false;
    const preprocessed = shouldPreprocess
      ? await preprocessImageForOcr(imagePayload.buffer)
      : {
        buffer: imagePayload.buffer,
        preprocessMs: 0,
        resized: false,
        skipped: true,
        originalBytes: imagePayload.buffer.length,
        outputBytes: imagePayload.buffer.length
      };
    const preprocessMs = preprocessed.preprocessMs || 0;
    const uploadFileName = imagePayload.fileName || 'report.jpg';
    const uploadContentType = inferContentType(uploadFileName);

    console.log('[recognizeReportCustom] payload', {
      ocrRequestId: event.ocrRequestId || '',
      source: imagePayload.source,
      mode,
      bufferBytes: imagePayload.buffer.length,
      outputBytes: preprocessed.outputBytes || preprocessed.buffer.length,
      resized: Boolean(preprocessed.resized),
      skipped: preprocessed.skipped !== false,
      fileName: uploadFileName,
      downloadMs: imagePayload.downloadMs || 0,
      preprocessMs
    });

    if (event.skipHealthCheck !== true && healthUrl) {
      const healthStartedAt = Date.now();
      try {
        const health = await checkOcrHealth(healthUrl, 5000);
        console.log('[recognizeReportCustom] health', {
          ocrRequestId: event.ocrRequestId || '',
          ok: health.ok,
          elapsedMs: Date.now() - healthStartedAt,
          ocrLoaded: health.health?.ocr_loaded,
          responseServer: health.responseServer
        });
        if (!health.ok) {
          return {
            ok: false,
            code: health.code || 'OCR_NOT_READY',
            message: resolveUserMessage({ code: health.code || 'OCR_NOT_READY', message: health.message })
          };
        }
      } catch (error) {
        console.warn('[recognizeReportCustom] health failed', {
          ocrRequestId: event.ocrRequestId || '',
          healthUrl,
          code: error?.code,
          statusCode: error?.statusCode,
          message: error?.message
        });
        return {
          ok: false,
          code: error?.code === 'OCR_GATEWAY_ERROR' ? 'OCR_GATEWAY_ERROR' : 'OCR_HEALTH_FAILED',
          message: resolveUserMessage(error),
          debug: {
            healthUrl,
            endpoint: url,
            statusCode: error?.statusCode,
            responseServer: error?.responseServer,
            hint: error?.responseServer === 'nginx'
              ? '命中 nginx=80 端口，请删除 CUSTOM_OCR_URL，改用 CUSTOM_OCR_BASE_URL=http://60.205.243.92:8080'
              : '请确认 Mac mini frp 8080 可从公网访问'
          }
        };
      }
    }

    const ocrStartedAt = Date.now();
    const ocrResponse = await requestCustomOcrWithRetry({
      buffer: preprocessed.buffer,
      fileName: uploadFileName,
      contentType: uploadContentType,
      url,
      apiKey
    });
    const ocrMs = Date.now() - ocrStartedAt;

    const adapted = adaptOcrResponse(ocrResponse, mode);
    const elapsedMs = Date.now() - startedAt;

    console.log('[recognizeReportCustom] result', {
      ocrRequestId: event.ocrRequestId || '',
      mode: adapted.mode,
      structuredCount: adapted.structuredItems.length,
      lineCount: adapted.lines.length,
      itemCount: adapted.items.length,
      warningCount: adapted.warnings.length,
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
      mode: adapted.mode,
      structuredItems: adapted.structuredItems,
      warnings: adapted.warnings,
      reportType: adapted.reportType,
      parserVersion: adapted.parserVersion,
      lines: adapted.lines,
      items: adapted.items,
      rawText: adapted.rawText,
      meta: {
        provider: 'mac-mini-ocr',
        client: adapted.client,
        mode: adapted.mode,
        endpoint: url,
        source: imagePayload.source,
        structuredCount: adapted.structuredItems.length,
        lineCount: adapted.lines.length,
        itemCount: adapted.items.length,
        warningCount: adapted.warnings.length,
        bufferBytes: imagePayload.buffer.length,
        downloadMs: imagePayload.downloadMs || 0,
        preprocessMs,
        ocrMs,
        elapsedMs,
        originalBytes: preprocessed.originalBytes,
        outputBytes: preprocessed.outputBytes,
        resized: Boolean(preprocessed.resized),
        skipped: preprocessed.skipped !== false
      }
    };
  } catch (error) {
    console.error('[recognizeReportCustom] failed', {
      ocrRequestId: event.ocrRequestId || '',
      elapsedMs: Date.now() - startedAt,
      code: error?.code,
      statusCode: error?.statusCode,
      message: error?.message
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
      message: resolveUserMessage(error),
      debug: {
        statusCode: error?.statusCode,
        responseServer: error?.responseServer,
        bodyPreview: error?.bodyPreview,
        endpoint: url,
        healthUrl,
        mode,
        urlMigrated: Boolean(urlMigrated),
        rawCustomUrl: rawCustomUrl || undefined,
        elapsedMs: Date.now() - startedAt,
        hint: error?.responseServer === 'nginx' || `${error?.bodyPreview || ''}`.includes('nginx')
          ? 'server=nginx 表示打到 80 端口。删除 CUSTOM_OCR_URL，仅保留 CUSTOM_OCR_BASE_URL=http://60.205.243.92:8080 后重新部署'
          : undefined
      }
    };
  }
};

exports._internal = {
  getCustomOcrConfig,
  hasImagePayload,
  resolveImageBuffer,
  preprocessImageForOcr,
  adaptOcrResponse,
  requestCustomOcrWithRetry,
  checkOcrHealth,
  OCR_MODES
};
