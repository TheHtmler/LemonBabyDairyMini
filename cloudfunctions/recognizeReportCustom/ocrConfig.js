const DEFAULT_BASE_URL = 'http://60.205.243.92:8080';
const MAC_MINI_HOST = '60.205.243.92';

const ENDPOINTS = {
  FORMAT_REPORT: '/api/v1/ocr/lemon/format-report',
  GENERIC: '/api/v1/ocr',
  HEALTH: '/api/v1/health'
};

const OCR_MODES = {
  FORMAT_REPORT: 'format-report',
  GENERIC: 'generic'
};

const DEFAULT_TIMEOUT_MS = 55000;

function normalizeBaseUrl(baseUrl = '') {
  let normalized = `${baseUrl || ''}`.replace(/\/$/, '');

  if (normalized === `http://${MAC_MINI_HOST}` || normalized === `https://${MAC_MINI_HOST}`) {
    normalized = DEFAULT_BASE_URL;
  }

  return ensureMacMiniPort8080(normalized);
}

function ensureMacMiniPort8080(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== MAC_MINI_HOST) {
      return rawUrl;
    }
    if (!url.port || url.port === '80') {
      url.port = '8080';
    }
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    return rawUrl;
  }
}

function migrateLegacyOcrUrl(url = '') {
  const trimmed = `${url || ''}`.trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes('/ocr/file')) {
    return `${DEFAULT_BASE_URL}${ENDPOINTS.FORMAT_REPORT}`;
  }

  if (
    (trimmed.startsWith(`http://${MAC_MINI_HOST}/`) || trimmed.startsWith(`https://${MAC_MINI_HOST}/`))
    && !trimmed.includes(':8080')
  ) {
    return `${DEFAULT_BASE_URL}${ENDPOINTS.FORMAT_REPORT}`;
  }

  return ensureMacMiniPort8080(trimmed);
}

function finalizeOcrUrl(url = '') {
  return ensureMacMiniPort8080(migrateLegacyOcrUrl(url));
}

function resolveOcrEndpoint(env = process.env, mode = '') {
  const apiKey = env.CUSTOM_OCR_API_KEY || '';
  const resolvedMode = mode || env.CUSTOM_OCR_MODE || OCR_MODES.FORMAT_REPORT;
  const rawCustomUrl = env.CUSTOM_OCR_URL || '';

  if (rawCustomUrl) {
    const url = finalizeOcrUrl(rawCustomUrl);
    return {
      url,
      apiKey,
      mode: resolvedMode,
      baseUrl: null,
      urlMigrated: url !== rawCustomUrl,
      rawCustomUrl
    };
  }

  const baseUrl = normalizeBaseUrl(env.CUSTOM_OCR_BASE_URL || DEFAULT_BASE_URL);
  const path = resolvedMode === OCR_MODES.GENERIC
    ? ENDPOINTS.GENERIC
    : ENDPOINTS.FORMAT_REPORT;

  return {
    url: finalizeOcrUrl(`${baseUrl}${path}`),
    apiKey,
    mode: resolvedMode,
    baseUrl,
    urlMigrated: false,
    rawCustomUrl: ''
  };
}

function resolveHealthUrl(env = process.env) {
  const config = resolveOcrEndpoint(env);
  try {
    const endpoint = new URL(config.url);
    return finalizeOcrUrl(`${endpoint.protocol}//${endpoint.host}${ENDPOINTS.HEALTH}`);
  } catch (error) {
    return `${DEFAULT_BASE_URL}${ENDPOINTS.HEALTH}`;
  }
}

function inferContentType(fileName = 'report.jpg') {
  const lower = `${fileName || ''}`.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

module.exports = {
  DEFAULT_BASE_URL,
  MAC_MINI_HOST,
  DEFAULT_TIMEOUT_MS,
  ENDPOINTS,
  OCR_MODES,
  normalizeBaseUrl,
  ensureMacMiniPort8080,
  migrateLegacyOcrUrl,
  finalizeOcrUrl,
  resolveOcrEndpoint,
  resolveHealthUrl,
  inferContentType
};
