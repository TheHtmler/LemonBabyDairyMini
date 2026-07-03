const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const functionPath = path.join('cloudfunctions', 'recognizeReportImage', 'index.js');

function createUsageStore() {
  const records = [];

  function matches(record, query) {
    return Object.keys(query).every((key) => record[key] === query[key]);
  }

  function createCollection(target) {
    return {
      where(query) {
        return {
          limit(n) {
            return {
              async get() {
                return {
                  data: target.filter((record) => matches(record, query)).slice(0, n)
                };
              }
            };
          },
          async update({ data }) {
            const matched = target.filter((record) => matches(record, query));
            matched.forEach((record) => {
              if (typeof data.count === 'number') {
                record.count += data.count;
              }
            });
            return { stats: { updated: matched.length } };
          }
        };
      },
      async add({ data }) {
        target.push({ ...data });
        return { _id: `id_${target.length}` };
      }
    };
  }

  return { records, createCollection };
}

function createMockDatabase({ quotaConfig = { enabled: false } } = {}) {
  const usage = createUsageStore();
  const appConfig = quotaConfig ? [{ key: 'report_ocr_quota', value: quotaConfig }] : [];

  return {
    usage,
    db: {
      command: { inc: (value) => value },
      collection(name) {
        if (name === 'app_config') {
          return {
            where() {
              return {
                limit() {
                  return {
                    async get() {
                      return { data: appConfig };
                    }
                  };
                }
              };
            }
          };
        }
        if (name === 'ocr_usage_daily') {
          return usage.createCollection(usage.records);
        }
        throw new Error(`unknown collection ${name}`);
      },
      async startTransaction() {
        const txRecords = JSON.parse(JSON.stringify(usage.records));
        const txCollection = usage.createCollection(txRecords);
        return {
          collection(collectionName) {
            if (collectionName === 'ocr_usage_daily') {
              return txCollection;
            }
            throw new Error(`unknown tx collection ${collectionName}`);
          },
          async commit() {
            usage.records.splice(0, usage.records.length, ...txRecords);
          },
          async rollback() {}
        };
      }
    }
  };
}

function loadFunctionWithMockCloud({ printedTextImpl, downloadFileImpl, quotaConfig = { enabled: false } } = {}) {
  const resolved = require.resolve(path.resolve(__dirname, '..', functionPath));
  const previousLoad = Module._load;
  delete require.cache[resolved];
  const { db } = createMockDatabase({ quotaConfig });

  Module._load = function mockWxServerSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test-env',
        init() {},
        getWXContext() {
          return { OPENID: 'test-openid' };
        },
        database() {
          return db;
        },
        async downloadFile({ fileID }) {
          if (downloadFileImpl) {
            return downloadFileImpl({ fileID });
          }
          return { fileContent: Buffer.from('image-bytes') };
        },
        openapi: {
          ocr: {
            printedText: printedTextImpl
          }
        }
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

test('recognizeReportImage returns quota snapshot without consuming usage', async () => {
  const fn = loadFunctionWithMockCloud({
    quotaConfig: {
      enabled: true,
      globalDaily: 0,
      perBabyUidDaily: 5,
      perBabyUidMonthly: 20,
      perOpenidDaily: 0
    },
    printedTextImpl: async () => ({ errcode: 0, items: [] })
  });

  const result = await fn.main({ action: 'quota', babyUid: 'baby-1' });
  assert.equal(result.ok, true);
  assert.equal(result.quota.babyDaily.used, 0);
  assert.equal(result.quota.remaining.babyDaily, 5);
  assert.equal(result.quota.limits.perBabyUidDaily, 5);
});

test('recognizeReportImage returns MISSING_FILE when no image payload is provided', async () => {
  const fn = loadFunctionWithMockCloud({ printedTextImpl: async () => ({ items: [] }) });
  const result = await fn.main({});
  assert.deepEqual(result, { ok: false, code: 'MISSING_FILE', message: '缺少识别图片' });
});

test('recognizeReportImage downloads cloud file and sends image buffer to printedText', async () => {
  const items = [{ text: '游离肉碱(C0) 20.000 10.000-40.000', pos: { top: 10, left: 0 } }];
  const fn = loadFunctionWithMockCloud({
    downloadFileImpl: async ({ fileID }) => {
      assert.equal(fileID, 'cloud://report.jpg');
      return { fileContent: Buffer.from('jpeg-bytes') };
    },
    printedTextImpl: async ({ type, img, imgUrl }) => {
      assert.equal(type, 'photo');
      assert.equal(imgUrl, undefined);
      assert.equal(img.contentType, 'image/jpeg');
      assert.ok(Buffer.isBuffer(img.value));
      return { errcode: 0, items };
    }
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, items);
  assert.equal(result.meta.itemCount, 1);
  assert.equal(result.meta.wechatOcrCallCount, 1);
  assert.deepEqual(result.meta.attemptedPaths, ['fileID-buffer-photo']);
});

test('recognizeReportImage accepts imgUrl for older clients or fallback path', async () => {
  const items = [{ text: '血氨 45.000', pos: { top: 10, left: 0 } }];
  const fn = loadFunctionWithMockCloud({
    printedTextImpl: async ({ imgUrl }) => {
      assert.equal(imgUrl, 'https://example.com/report.jpg');
      return { errcode: 0, items };
    }
  });

  const result = await fn.main({ imgUrl: 'https://example.com/report.jpg', babyUid: 'baby-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, items);
});

test('recognizeReportImage accepts imageBase64 without cloud storage', async () => {
  const items = [{ text: 'C3 8.000', pos: { top: 10, left: 0 } }];
  const fn = loadFunctionWithMockCloud({
    printedTextImpl: async ({ img }) => {
      assert.equal(img.contentType, 'image/jpeg');
      assert.deepEqual(img.value, Buffer.from('abc', 'utf8'));
      return { errcode: 0, items };
    }
  });

  const result = await fn.main({
    imageBase64: Buffer.from('abc', 'utf8').toString('base64'),
    contentType: 'image/jpeg',
    babyUid: 'baby-1'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, items);
});

test('recognizeReportImage maps oversized image errors to a friendly message', async () => {
  const fn = loadFunctionWithMockCloud({
    printedTextImpl: async () => {
      throw { errMsg: 'openapi.ocr.printedText:fail image too large' };
    }
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'IMAGE_TOO_LARGE');
  assert.equal(result.message, '图片过大，请重新拍摄或压缩后再试');
});

test('recognizeReportImage maps WeChat OCR quota errors to a dedicated message', async () => {
  const fn = loadFunctionWithMockCloud({
    printedTextImpl: async () => ({ errcode: 101003, errmsg: 'not enough market quota' })
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WECHAT_OCR_QUOTA_EXCEEDED');
  assert.match(result.message, /微信 OCR/);
  assert.equal(result.debug.wechatOcrCallCount, 1);
  assert.deepEqual(result.debug.attemptedPaths, ['fileID-buffer-photo']);
});

test('recognizeReportImage stops retrying once WeChat OCR quota is exhausted', async () => {
  let callCount = 0;
  const fn = loadFunctionWithMockCloud({
    printedTextImpl: async () => {
      callCount += 1;
      return { errcode: 101003, errmsg: 'not enough market quota' };
    }
  });

  const result = await fn.main({
    fileID: 'cloud://report.jpg',
    imgUrl: 'https://example.com/report.jpg',
    babyUid: 'baby-1'
  });

  assert.equal(result.code, 'WECHAT_OCR_QUOTA_EXCEEDED');
  assert.equal(callCount, 1);
  assert.equal(result.debug.wechatOcrCallCount, 1);
});

test('recognizeReportImage maps openapi permission errors to a friendly message', async () => {
  const fn = loadFunctionWithMockCloud({
    printedTextImpl: async () => {
      throw { errCode: 40001, errMsg: 'openapi.ocr.printedText:fail no permission' };
    }
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PERMISSION_DENIED');
  assert.match(result.message, /权限未开通/);
});

test('recognizeReportImage returns DOWNLOAD_FAILED when cloud file cannot be read', async () => {
  const fn = loadFunctionWithMockCloud({
    downloadFileImpl: async () => {
      throw new Error('download failed');
    },
    printedTextImpl: async () => ({ items: [] })
  });

  const result = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DOWNLOAD_FAILED');
  assert.equal(result.message, '读取图片失败，请重新拍摄后再试');
});

test('recognizeReportImage blocks when app-layer baby daily quota is exceeded', async () => {
  const fn = loadFunctionWithMockCloud({
    quotaConfig: {
      enabled: true,
      globalDaily: 0,
      perBabyUidDaily: 1,
      perBabyUidMonthly: 0,
      perOpenidDaily: 0
    },
    printedTextImpl: async () => ({ errcode: 0, items: [{ text: 'C3 8.000' }] })
  });

  const first = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(first.ok, true);

  const second = await fn.main({ fileID: 'cloud://report.jpg', babyUid: 'baby-1' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'BABY_DAILY_QUOTA_EXCEEDED');
});
