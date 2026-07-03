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
        requestCustomOcr: requestCustomOcrImpl || (async () => ({
          lines: [{ text: 'C3', confidence: 0.9, box: [0, 0, 40, 20] }]
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

test('recognizeReportCustom forwards image buffer and returns items', async () => {
  let captured = null;
  const fn = loadFunctionWithMockCloud({
    env: {
      CUSTOM_OCR_API_KEY: 'test-key',
      CUSTOM_OCR_URL: 'http://60.205.243.92/ocr/file'
    },
    requestCustomOcrImpl: async (payload) => {
      captured = payload;
      return {
        lines: [
          { text: '血氨', confidence: 0.98, box: [10, 20, 80, 50] },
          { text: '45.000', confidence: 0.95, box: [200, 20, 320, 50] }
        ]
      };
    }
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg' });
  assert.equal(result.ok, true);
  assert.equal(result.meta.provider, 'custom');
  assert.equal(result.lines.length, 2);
  assert.equal(result.items.length, 2);
  assert.ok(Buffer.isBuffer(captured.buffer));
  assert.equal(captured.url, 'http://60.205.243.92/ocr/file');
  assert.equal(captured.apiKey, 'test-key');
  assert.equal(result.meta.source, 'fileID');
});

test('recognizeReportCustom accepts imageBase64 without cloud download', async () => {
  let captured = null;
  const fn = loadFunctionWithMockCloud({
    env: { CUSTOM_OCR_API_KEY: 'test-key' },
    requestCustomOcrImpl: async (payload) => {
      captured = payload;
      return { lines: [{ text: 'C3', confidence: 0.9, box: [0, 0, 40, 20] }] };
    }
  });

  const result = await fn.main({
    imageBase64: Buffer.from('jpeg-bytes').toString('base64')
  });

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, 'base64');
  assert.equal(result.meta.downloadMs, 0);
  assert.ok(Buffer.isBuffer(captured.buffer));
});
