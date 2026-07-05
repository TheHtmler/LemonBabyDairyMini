const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const functionPath = path.join('cloudfunctions', 'recognizeReportCustom', 'index.js');

function loadFunctionWithMockCloud({ downloadFileImpl, requestCustomOcrImpl, env = {} } = {}) {
  const resolved = require.resolve(path.resolve(__dirname, '..', functionPath));
  const resolvedClient = require.resolve(path.resolve(__dirname, '..', 'cloudfunctions', 'recognizeReportCustom', 'customOcrClient.js'));
  const previousLoad = Module._load;

  Object.assign(process.env, env);
  delete require.cache[resolved];
  delete require.cache[resolvedClient];

  Module._load = function mockModule(request, parent, isMain) {
    const resolvedRequest = (() => {
      try {
        return Module._resolveFilename(request, parent, isMain);
      } catch (error) {
        return request;
      }
    })();

    if (request === 'wx-server-sdk' || resolvedRequest.includes(`${path.sep}wx-server-sdk${path.sep}`)) {
      return {
        DYNAMIC_CURRENT_ENV: 'test-env',
        init() {},
        async downloadFile({ fileID }) {
          if (downloadFileImpl) {
            return downloadFileImpl({ fileID });
          }
          return { fileContent: Buffer.from('jpeg-bytes') };
        }
      };
    }

    if (resolvedRequest === resolvedClient) {
      return {
        checkOcrHealth: async () => ({ ok: true, health: { status: 'ok', ocr_loaded: true } }),
        requestCustomOcrWithRetry: requestCustomOcrImpl || (async () => ({
          client: 'owner',
          report_type: 'lemon_metabolic_report',
          parser_version: 'v1.rules.1',
          item_count: 1,
          warnings: [],
          items: [{ name: '丙酰肉碱(C3)', value: '53.62', ref_range: '1.00-4.00', flag: 'high' }],
          raw_ocr: { lines: [{ text: 'C3', score: 0.9, box: [0, 0, 40, 20] }] }
        }))
      };
    }

    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    return require(resolved);
  } finally {
    Module._load = previousLoad;
  }
}

test('recognizeReportCustom returns MISSING_FILE when fileID is absent', async () => {
  const fn = loadFunctionWithMockCloud({ env: { CUSTOM_OCR_API_KEY: 'test-key' } });
  const result = await fn.main({});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_FILE');
});

test('recognizeReportCustom returns MISSING_CONFIG when api key is absent', async () => {
  const fn = loadFunctionWithMockCloud({ env: { CUSTOM_OCR_API_KEY: '' } });
  const result = await fn.main({ fileID: 'cloud://report.jpg' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_CONFIG');
});

test('recognizeReportCustom forwards image buffer and returns structured items', async () => {
  let captured = null;
  const fn = loadFunctionWithMockCloud({
    env: {
      CUSTOM_OCR_API_KEY: 'test-key',
      CUSTOM_OCR_BASE_URL: 'http://60.205.243.92:8080'
    },
    requestCustomOcrImpl: async (payload) => {
      captured = payload;
      return {
        client: 'owner',
        report_type: 'lemon_metabolic_report',
        parser_version: 'v1.rules.1',
        item_count: 2,
        warnings: [],
        items: [
          { name: '血氨', value: '45.000', ref_range: '18.00-72.00', flag: 'normal', confidence: 0.98 },
          { name: '丙酰肉碱(C3)', value: '53.62', ref_range: '1.00-4.00', flag: 'high', confidence: 0.99 }
        ],
        raw_ocr: {
          lines: [{ text: '血氨', score: 0.98, box: [10, 20, 80, 50] }]
        }
      };
    }
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg' });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'format-report');
  assert.equal(result.meta.provider, 'mac-mini-ocr');
  assert.equal(result.structuredItems.length, 2);
  assert.equal(result.lines.length, 1);
  assert.equal(result.items.length, 1);
  assert.ok(Buffer.isBuffer(captured.buffer));
  assert.equal(captured.url, 'http://60.205.243.92:8080/api/v1/ocr/lemon/format-report');
  assert.equal(captured.apiKey, 'test-key');
  assert.equal(result.meta.source, 'fileID');
});

test('recognizeReportCustom accepts imageBase64 without cloud download', async () => {
  let captured = null;
  const fn = loadFunctionWithMockCloud({
    env: { CUSTOM_OCR_API_KEY: 'test-key' },
    requestCustomOcrImpl: async (payload) => {
      captured = payload;
      return {
        items: [{ name: 'C3', value: '53.62', ref_range: '1.00-4.00' }],
        raw_ocr: { lines: [] }
      };
    }
  });

  const result = await fn.main({
    imageBase64: Buffer.from('jpeg-bytes').toString('base64')
  });

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, 'base64');
  assert.equal(result.meta.downloadMs, 0);
  assert.equal(result.structuredItems.length, 1);
  assert.ok(Buffer.isBuffer(captured.buffer));
});

test('recognizeReportCustom supports generic mode via event.mode', async () => {
  let captured = null;
  const fn = loadFunctionWithMockCloud({
    env: { CUSTOM_OCR_API_KEY: 'test-key' },
    requestCustomOcrImpl: async (payload) => {
      captured = payload;
      return {
        client: 'owner',
        text: 'C3',
        lines: [{ text: 'C3', score: 0.9, box: [0, 0, 40, 20] }]
      };
    }
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg', mode: 'generic' });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'generic');
  assert.equal(captured.url, 'http://60.205.243.92:8080/api/v1/ocr');
  assert.equal(result.structuredItems.length, 0);
  assert.equal(result.lines.length, 1);
});

test('recognizeReportCustom probe action returns config without image', async () => {
  const fn = loadFunctionWithMockCloud({
    env: {
      CUSTOM_OCR_API_KEY: 'test-key',
      CUSTOM_OCR_URL: 'http://60.205.243.92/ocr/file'
    }
  });

  const result = await fn.main({ action: 'probe' });
  assert.equal(result.action, 'probe');
  assert.equal(result.ok, true);
  assert.equal(result.config.healthUrl, 'http://60.205.243.92:8080/api/v1/health');
  assert.equal(result.config.urlMigrated, true);
});
