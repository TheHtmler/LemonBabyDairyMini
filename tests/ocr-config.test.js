const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const configPath = path.resolve(__dirname, '..', 'cloudfunctions', 'recognizeReportCustom', 'ocrConfig.js');
const {
  DEFAULT_BASE_URL,
  ENDPOINTS,
  OCR_MODES,
  resolveOcrEndpoint,
  resolveHealthUrl,
  migrateLegacyOcrUrl,
  ensureMacMiniPort8080
} = require(configPath);

test('resolveOcrEndpoint defaults to format-report endpoint', () => {
  const config = resolveOcrEndpoint({
    CUSTOM_OCR_API_KEY: 'test-key'
  });

  assert.equal(config.url, `${DEFAULT_BASE_URL}${ENDPOINTS.FORMAT_REPORT}`);
  assert.equal(config.mode, OCR_MODES.FORMAT_REPORT);
  assert.equal(config.apiKey, 'test-key');
});

test('resolveOcrEndpoint supports generic mode', () => {
  const config = resolveOcrEndpoint({
    CUSTOM_OCR_API_KEY: 'test-key',
    CUSTOM_OCR_MODE: OCR_MODES.GENERIC
  });

  assert.equal(config.url, `${DEFAULT_BASE_URL}${ENDPOINTS.GENERIC}`);
  assert.equal(config.mode, OCR_MODES.GENERIC);
});

test('resolveOcrEndpoint honors legacy CUSTOM_OCR_URL override', () => {
  const config = resolveOcrEndpoint({
    CUSTOM_OCR_API_KEY: 'test-key',
    CUSTOM_OCR_URL: 'http://example.com/custom/path'
  });

  assert.equal(config.url, 'http://example.com/custom/path');
});

test('resolveHealthUrl builds health endpoint from base url', () => {
  assert.equal(
    resolveHealthUrl({ CUSTOM_OCR_BASE_URL: DEFAULT_BASE_URL }),
    `${DEFAULT_BASE_URL}${ENDPOINTS.HEALTH}`
  );
});

test('migrateLegacyOcrUrl rewrites old /ocr/file endpoint', () => {
  assert.equal(
    migrateLegacyOcrUrl('http://60.205.243.92/ocr/file'),
    `${DEFAULT_BASE_URL}${ENDPOINTS.FORMAT_REPORT}`
  );
});

test('resolveOcrEndpoint migrates legacy CUSTOM_OCR_URL', () => {
  const config = resolveOcrEndpoint({
    CUSTOM_OCR_API_KEY: 'test-key',
    CUSTOM_OCR_URL: 'http://60.205.243.92/ocr/file'
  });

  assert.equal(config.url, `${DEFAULT_BASE_URL}${ENDPOINTS.FORMAT_REPORT}`);
  assert.equal(config.urlMigrated, true);
});

test('resolveHealthUrl uses :8080 even when CUSTOM_OCR_URL is legacy', () => {
  assert.equal(
    resolveHealthUrl({
      CUSTOM_OCR_API_KEY: 'test-key',
      CUSTOM_OCR_URL: 'http://60.205.243.92/ocr/file'
    }),
    `${DEFAULT_BASE_URL}${ENDPOINTS.HEALTH}`
  );
});

test('ensureMacMiniPort8080 adds port for bare ip host', () => {
  assert.equal(
    ensureMacMiniPort8080('http://60.205.243.92/api/v1/health'),
    `${DEFAULT_BASE_URL}/api/v1/health`
  );
});
