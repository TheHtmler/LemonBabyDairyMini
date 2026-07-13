const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function withMockWx(mockWx, run) {
  const previousWx = global.wx;
  global.wx = mockWx;
  try {
    return await run();
  } finally {
    global.wx = previousWx;
  }
}

function loadCacheModule() {
  const modulePath = require.resolve('../miniprogram/utils/cloudTempUrlCache');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('resolveCloudTempUrls returns cached urls without calling getTempFileURL', async () => {
  const storage = {};
  let getTempFileURLCalls = 0;

  await withMockWx({
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    cloud: {
      async getTempFileURL() {
        getTempFileURLCalls += 1;
        assert.fail('should not call getTempFileURL when cache hits');
      }
    }
  }, async () => {
    const cache = loadCacheModule();
    const fileId = 'cloud://env.bucket/powder/a.png';
    storage[cache.CACHE_STORAGE_KEY] = {
      [fileId]: {
        url: 'https://cdn.example/a.png',
        expiresAt: Date.now() + cache.DEFAULT_TTL_MS
      }
    };

    const map = await cache.resolveCloudTempUrls([fileId, fileId]);
    assert.equal(map.get(fileId), 'https://cdn.example/a.png');
    assert.equal(getTempFileURLCalls, 0);
  });
});

test('resolveCloudTempUrls fetches missing ids and writes local cache', async () => {
  const storage = {};
  let requested = [];

  await withMockWx({
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    cloud: {
      async getTempFileURL({ fileList }) {
        requested = (fileList || []).map((item) => item.fileID);
        return {
          fileList: (fileList || []).map((item) => ({
            fileID: item.fileID,
            tempFileURL: `https://cdn.example/${encodeURIComponent(item.fileID)}.tmp`
          }))
        };
      }
    }
  }, async () => {
    const cache = loadCacheModule();
    const fileId = 'cloud://env.bucket/food/b.png';
    const map = await cache.resolveCloudTempUrls([fileId, 'https://ignore.me/x.png', '']);
    assert.equal(requested.length, 1);
    assert.equal(requested[0], fileId);
    assert.equal(map.get(fileId), `https://cdn.example/${encodeURIComponent(fileId)}.tmp`);
    assert.equal(storage[cache.CACHE_STORAGE_KEY][fileId].url, map.get(fileId));
    assert.ok(storage[cache.CACHE_STORAGE_KEY][fileId].expiresAt > Date.now());
  });
});

test('powder / food / group qrcode resolvers use cloudTempUrlCache', () => {
  const powderCatalog = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/models/powderCatalog.js'),
    'utf8'
  );
  const food = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/models/food.js'),
    'utf8'
  );
  const groupQr = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/utils/groupQrCode.js'),
    'utf8'
  );

  assert.match(powderCatalog, /cloudTempUrlCache/);
  assert.match(powderCatalog, /resolveCloudTempUrls\(fileIds\)/);
  assert.doesNotMatch(powderCatalog, /wx\.cloud\.getTempFileURL/);

  assert.match(food, /cloudTempUrlCache/);
  assert.match(food, /resolveCloudTempUrls\(fileIds\)/);
  assert.doesNotMatch(food, /wx\.cloud\.getTempFileURL/);

  assert.match(groupQr, /cloudTempUrlCache/);
  assert.match(groupQr, /resolveCloudTempUrls\(\[normalizedFileId\]\)/);
});

test('powder-management and meal-editor skip passive onShow image reloads', () => {
  const powderPage = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-milk/powder-management/index.js'),
    'utf8'
  );
  const mealEditor = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-records/meal-editor/index.js'),
    'utf8'
  );
  const dailyFeeding = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/daily-feeding/index.js'),
    'utf8'
  );

  const powderOnShow = powderPage.match(/async onShow\(\) \{[\s\S]*?\n  \},\n\n  markPowdersDirty/)[0];
  assert.match(powderOnShow, /!this\._powdersDirty/);
  assert.match(powderOnShow, /this\.data\.powders\.length > 0/);
  assert.match(powderPage, /resolvePowderImageUrls\(\[\s*\.\.\.\(systemPowders/);

  const mealOnShow = mealEditor.match(/async onShow\(\) \{[\s\S]*?\n  \},\n\n  async loadTargetContext/)[0];
  assert.match(mealOnShow, /this\._foodCatalogDirty/);
  assert.doesNotMatch(mealOnShow, /await this\.loadFoodCatalog\(\);\n  \}/);
  assert.match(mealEditor, /navigateToFoodManagement\(\) \{[\s\S]*this\._foodCatalogDirty = true/);

  assert.match(dailyFeeding, /loadDeferredDashboardParts\(\{ rebuildMissing: shouldRebuildTrend \}\)/);
  assert.match(dailyFeeding, /loadDeferredDashboardParts\(\{ rebuildMissing: true \}\)/);
  assert.match(dailyFeeding, /const rebuildMissing = options\.rebuildMissing === true/);
});
