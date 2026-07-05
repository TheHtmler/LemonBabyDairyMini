const http = require('http');
const https = require('https');
const { URL } = require('url');
const FormData = require('form-data');
const { DEFAULT_TIMEOUT_MS } = require('./ocrConfig');
const RETRYABLE_ERROR_CODES = new Set(['OCR_GATEWAY_ERROR', 'OCR_UNAVAILABLE', 'OCR_BUSY', 'OCR_SERVER_ERROR']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorDetail(body = '', parsed = null, statusCode = 500) {
  if (parsed?.detail) return `${parsed.detail}`;
  if (parsed?.message) return `${parsed.message}`;
  if (parsed?.error) return `${parsed.error}`;

  const trimmed = `${body || ''}`.trim();
  if (!trimmed) return `HTTP ${statusCode}`;

  const htmlTitle = trimmed.match(/<title>([^<]+)<\/title>/i);
  if (htmlTitle) return htmlTitle[1].trim();

  if (trimmed.startsWith('<')) return `HTTP ${statusCode}`;

  return trimmed.slice(0, 300);
}

function buildOcrHttpError(statusCode, body = '', parsed = null) {
  const preview = `${body || ''}`.slice(0, 300);
  const detail = extractErrorDetail(body, parsed, statusCode);

  if (statusCode === 401 || statusCode === 403) {
    return Object.assign(new Error('OCR 服务 API Key 无效或缺失，请检查 CUSTOM_OCR_API_KEY'), {
      code: 'OCR_UNAUTHORIZED',
      statusCode,
      bodyPreview: preview
    });
  }

  if (statusCode === 413) {
    return Object.assign(new Error('图片过大，请压缩后重试'), {
      code: 'IMAGE_TOO_LARGE',
      statusCode,
      bodyPreview: preview
    });
  }

  if (statusCode === 429) {
    return Object.assign(new Error('OCR 服务繁忙，请稍后再试（一次只处理一个请求）'), {
      code: 'OCR_BUSY',
      statusCode,
      bodyPreview: preview
    });
  }

  if (statusCode === 502 || statusCode === 504) {
    return Object.assign(new Error('OCR 后端无响应（nginx 502/504），请确认 Mac mini 服务在运行，或调大 nginx proxy_read_timeout'), {
      code: 'OCR_GATEWAY_ERROR',
      statusCode,
      bodyPreview: preview
    });
  }

  if (statusCode === 503) {
    return Object.assign(new Error('OCR 服务暂不可用，请稍后再试'), {
      code: 'OCR_UNAVAILABLE',
      statusCode,
      bodyPreview: preview
    });
  }

  if (statusCode >= 500) {
    return Object.assign(new Error(`OCR 服务内部错误（${statusCode}）：${detail}`), {
      code: 'OCR_SERVER_ERROR',
      statusCode,
      bodyPreview: preview
    });
  }

  return Object.assign(new Error(`OCR 服务返回错误（${statusCode}）：${detail}`), {
    code: 'OCR_HTTP_ERROR',
    statusCode,
    bodyPreview: preview,
    response: parsed || undefined
  });
}

function parseOcrResponseBody(body = '', statusCode = 200) {
  const trimmed = `${body || ''}`.trim();
  if (!trimmed) {
    if (statusCode >= 400) {
      throw buildOcrHttpError(statusCode, trimmed, null);
    }
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    if (statusCode >= 400) {
      throw buildOcrHttpError(statusCode, trimmed, null);
    }
    throw Object.assign(new Error('解析 OCR 服务响应失败'), {
      code: 'INVALID_RESPONSE',
      statusCode,
      bodyPreview: trimmed.slice(0, 300)
    });
  }
}

function requestHttpJson({ method = 'GET', url, headers = {}, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const transport = endpoint.protocol === 'https:' ? https : http;

    const req = transport.request({
      method,
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
      path: `${endpoint.pathname}${endpoint.search}`,
      headers,
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body,
          responseServer: res.headers?.server || '',
          parsed: (() => {
            try {
              return JSON.parse(body);
            } catch (error) {
              return null;
            }
          })()
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('OCR 健康检查超时'), { code: 'OCR_HEALTH_TIMEOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function checkOcrHealth(healthUrl, timeoutMs = 5000) {
  if (!healthUrl) {
    return { ok: false, code: 'MISSING_HEALTH_URL', message: '无法解析 OCR 健康检查地址' };
  }

  const response = await requestHttpJson({ url: healthUrl, timeoutMs });
  if (response.statusCode >= 400) {
    throw buildOcrHttpError(response.statusCode, response.body, response.parsed);
  }

  if (response.parsed?.status !== 'ok') {
    return {
      ok: false,
      code: 'OCR_NOT_READY',
      message: 'OCR 服务未就绪',
      health: response.parsed || null
    };
  }

  return {
    ok: true,
    health: response.parsed,
    responseServer: response.responseServer
  };
}

function requestCustomOcr({
  buffer,
  fileName = 'report.jpg',
  contentType = 'image/jpeg',
  url,
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const transport = endpoint.protocol === 'https:' ? https : http;
    const form = new FormData();

    form.append('file', buffer, {
      filename: fileName,
      contentType
    });

    const req = transport.request({
      method: 'POST',
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
      path: `${endpoint.pathname}${endpoint.search}`,
      headers: {
        ...form.getHeaders(),
        'X-API-Key': apiKey
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = parseOcrResponseBody(body, res.statusCode);
          if (res.statusCode >= 400) {
            const httpError = buildOcrHttpError(res.statusCode, body, parsed);
            httpError.responseServer = res.headers?.server || '';
            reject(httpError);
            return;
          }
          resolve(parsed);
        } catch (error) {
          if (error?.statusCode >= 400) {
            error.responseServer = res.headers?.server || '';
          }
          reject(error);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('OCR 服务请求超时'), { code: 'OCR_TIMEOUT' }));
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

function shouldRetryOcrError(error = {}) {
  if (RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }
  return RETRYABLE_STATUS_CODES.has(Number(error.statusCode));
}

async function requestCustomOcrWithRetry(payload, { maxAttempts = 2, retryDelayMs = 2000 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestCustomOcr(payload);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && shouldRetryOcrError(error);
      if (!canRetry) {
        throw error;
      }
      console.warn('[recognizeReportCustom] ocr retry', {
        attempt,
        maxAttempts,
        code: error?.code,
        statusCode: error?.statusCode,
        retryDelayMs
      });
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}

module.exports = {
  buildOcrHttpError,
  extractErrorDetail,
  parseOcrResponseBody,
  checkOcrHealth,
  requestCustomOcr,
  requestCustomOcrWithRetry,
  shouldRetryOcrError
};
