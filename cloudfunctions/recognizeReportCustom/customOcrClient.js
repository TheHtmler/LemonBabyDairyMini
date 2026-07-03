const http = require('http');
const https = require('https');
const { URL } = require('url');
const FormData = require('form-data');

function buildOcrHttpError(statusCode, body = '', parsed = null) {
  const preview = `${body || ''}`.slice(0, 300);
  const detail = parsed?.detail || parsed?.message || parsed?.error || preview || `HTTP ${statusCode}`;

  if (statusCode === 401) {
    return Object.assign(new Error('OCR 服务 API Key 无效，请检查 CUSTOM_OCR_API_KEY'), {
      code: 'OCR_UNAUTHORIZED',
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

function requestCustomOcr({ buffer, fileName = 'report.jpg', url, apiKey, timeoutMs = 55000 }) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const transport = endpoint.protocol === 'https:' ? https : http;
    const form = new FormData();

    form.append('file', buffer, {
      filename: fileName,
      contentType: 'image/jpeg'
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
            reject(buildOcrHttpError(res.statusCode, body, parsed));
            return;
          }
          resolve(parsed);
        } catch (error) {
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

module.exports = {
  buildOcrHttpError,
  parseOcrResponseBody,
  requestCustomOcr
};
