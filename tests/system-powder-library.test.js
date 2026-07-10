const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SAMPLE_CATALOG = [
  {
    powderCode: 'RF_APTAMIL_1',
    name: '爱他美 经典版 1段',
    category: 'regular_formula',
    brand: '爱他美',
    stage: '1段',
    nutritionPer100g: { protein: 10.6, calories: 505, fat: 26, carbs: 55, fiber: 0 },
    mixRatio: { powder: 4.5, water: 30 },
    alias: ['Aptamil']
  },
  {
    powderCode: 'SF_NAN_AMINOMIX_1',
    name: '纽迪希亚 Anamix Infant 1段',
    category: 'special_formula',
    brand: '纽迪希亚',
    stage: '1段',
    nutritionPer100g: { protein: 13.1, calories: 505, fat: 26, carbs: 55, fiber: 0 },
    mixRatio: { powder: 13.5, water: 90 },
    alias: ['Anamix', '特护1段']
  },
  {
    powderCode: 'ES_NUTRICIA_POLICAL',
    name: '纽迪希亚 Polycal 能量粉',
    category: 'energy_supplement',
    brand: '纽迪希亚',
    nutritionPer100g: { protein: 0, calories: 456, fat: 0, carbs: 95, fiber: 0 },
    mixRatio: { powder: 4, water: 30 },
    alias: ['Polycal']
  }
];

function installWxMock({ catalog = [], meta = null } = {}) {
  const previousWx = global.wx;
  const storage = {};

  global.wx = {
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
      database() {
        return {
          collection(name) {
            const api = {
              where() { return api; },
              limit() { return api; },
              skip() { return api; },
              field() { return api; },
              async get() {
                if (name === 'system_powder_catalog_meta') {
                  return { data: meta ? [meta] : [] };
                }
                return { data: [] };
              }
            };
            return api;
          }
        };
      },
      async callFunction({ name, data = {} }) {
        if (name !== 'getSystemPowderIndex') {
          return { result: { ok: false } };
        }
        const start = Number(data.startIndex) || 0;
        const size = Number(data.batchSize) || 50;
        const slice = catalog.slice(start, start + size);
        const endIndex = start + slice.length;
        const nextStart = slice.length < size ? null : endIndex;
        return {
          result: {
            ok: true,
            index: slice,
            startIndex: start,
            endIndex,
            nextStart,
            hasMore: nextStart !== null
          }
        };
      }
    }
  };

  return {
    storage,
    restore() {
      global.wx = previousWx;
    }
  };
}

function loadSystemPowderIndex() {
  const modulePath = require.resolve('../miniprogram/utils/systemPowderIndex');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('system powder index downloads from cloud function and caches locally', async () => {
  const mock = installWxMock({ catalog: SAMPLE_CATALOG, meta: { version: 'v1', total: 3 } });
  const SystemPowderIndex = loadSystemPowderIndex();

  const items = await SystemPowderIndex.getSystemPowderIndex({ forceRefresh: true });
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.isSystem && item.libraryScope === 'system'));
  assert.ok(items.some((item) => item.name.includes('纽迪希亚')));

  // 二次读取应命中本地缓存（版本一致）。
  const cached = await SystemPowderIndex.getSystemPowderIndex();
  assert.equal(cached.length, 3);

  mock.restore();
});

test('system powder index returns empty when catalog is empty (client shows empty by default)', async () => {
  const mock = installWxMock({ catalog: [], meta: null });
  const SystemPowderIndex = loadSystemPowderIndex();

  const items = await SystemPowderIndex.getSystemPowderIndex({ forceRefresh: true });
  assert.deepEqual(items, []);

  mock.restore();
});

test('system powder index supports fuzzy search and category grouping', async () => {
  const mock = installWxMock({ catalog: SAMPLE_CATALOG, meta: { version: 'v1', total: 3 } });
  const SystemPowderIndex = loadSystemPowderIndex();

  const items = await SystemPowderIndex.getSystemPowderIndex({ forceRefresh: true });

  const searched = SystemPowderIndex.searchSystemPowders(items, 'Anamix');
  assert.ok(searched.some((item) => item.powderCode === 'SF_NAN_AMINOMIX_1'));

  const grouped = SystemPowderIndex.groupSystemPowdersByCategory(items);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].category, 'regular_formula');
  assert.equal(grouped[1].category, 'special_formula');
  assert.equal(grouped[2].category, 'energy_supplement');

  mock.restore();
});

test('powder management page is registered in app.json and profile menu', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  const milkPages = appConfig.subPackages.find((pkg) => pkg.root === 'pkg-milk')?.pages || [];
  assert.ok(milkPages.includes('powder-management/index'));

  const profileSource = fs.readFileSync('miniprogram/pages/profile/index.js', 'utf8');
  assert.ok(profileSource.includes("name: '奶粉管理'"));
  assert.ok(profileSource.includes('/pkg-milk/powder-management/index'));
});

test('powder catalog model can add system powder to nutrition profile', async () => {
  const previousWx = global.wx;
  const writes = [];
  const storage = {};
  let profileDoc = null;

  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    cloud: {
      database() {
        return {
          serverDate() {
            return 'SERVER_DATE';
          },
          collection(name) {
            const queryApi = {
              where() {
                return {
                  async get() {
                    if (name === 'milk_nutrition_profiles') {
                      return { data: profileDoc ? [profileDoc] : [] };
                    }
                    return { data: [] };
                  }
                };
              },
              doc(id) {
                return {
                  async update({ data }) {
                    writes.push({ type: 'update', id, data });
                    profileDoc = { ...profileDoc, ...data, _id: id };
                    return { stats: { updated: 1 } };
                  },
                  async remove() {
                    writes.push({ type: 'remove', id });
                    return { stats: { removed: 1 } };
                  }
                };
              },
              async add({ data }) {
                writes.push({ type: 'add', data });
                profileDoc = { _id: 'profile-1', ...data };
                return { _id: 'profile-1' };
              }
            };
            return queryApi;
          },
          command: {}
        };
      }
    }
  };

  const powderCatalogPath = require.resolve('../miniprogram/models/powderCatalog');
  delete require.cache[powderCatalogPath];
  const PowderCatalogModel = require('../miniprogram/models/powderCatalog');

  const result = await PowderCatalogModel.saveUserPowder('baby-1', {
    id: 'powder_test_1',
    name: '纽迪希亚 Anamix Infant 1段',
    category: 'special_formula',
    proteinRole: 'special',
    source: 'system',
    sourceSystemPowderId: 'SF_NAN_AMINOMIX_1',
    nutritionPer100g: { protein: 13.1, calories: 505, fat: 26, carbs: 55, fiber: 0 },
    mixRatio: { powder: 13.5, water: 90 }
  });
  assert.equal(result.added, true);
  assert.equal(result.message, '已加入我的奶粉');

  const duplicate = await PowderCatalogModel.saveUserPowder('baby-1', {
    id: 'powder_test_2',
    name: '纽迪希亚 Anamix Infant 1段',
    category: 'special_formula',
    proteinRole: 'special',
    source: 'system',
    sourceSystemPowderId: 'SF_NAN_AMINOMIX_1',
    nutritionPer100g: { protein: 13.1, calories: 505, fat: 26, carbs: 55, fiber: 0 },
    mixRatio: { powder: 13.5, water: 90 }
  });
  assert.equal(duplicate.added, false);

  const saved = await PowderCatalogModel.saveUserPowder('baby-1', {
    id: 'powder_custom_1',
    name: '自定义特奶',
    category: 'special_formula',
    proteinRole: 'special',
    nutritionPer100g: { protein: 13, calories: 500, fat: 25, carbs: 55, fiber: 0 },
    mixRatio: { powder: 13.5, water: 90 }
  });
  assert.equal(saved.powder.name, '自定义特奶');

  global.wx = previousWx;
});
