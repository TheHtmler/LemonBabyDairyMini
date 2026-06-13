const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function installWxForIndex({ meta, foods, cloudIndex, cloudError, metaError, storageErrorKeys = [] }) {
  const previousWx = global.wx;
  const storage = {};
  const queries = [];

  function createQuery(collectionName) {
    let query = null;
    let offset = 0;
    let limitCount = 20;

    return {
      where(nextQuery) {
        query = nextQuery;
        return this;
      },
      skip(nextOffset) {
        offset = nextOffset;
        return this;
      },
      limit(nextLimit) {
        limitCount = nextLimit;
        return this;
      },
      async get() {
        queries.push({ collectionName, query, offset, limit: limitCount });
        if (collectionName === 'system_food_catalog_meta') {
          if (metaError) throw metaError;
          return { data: meta ? [meta] : [] };
        }
        if (collectionName === 'food_catalog') {
          return { data: foods.slice(offset, offset + limitCount) };
        }
        return { data: [] };
      }
    };
  }

  const cloud = {
    database() {
      return {
        collection(collectionName) {
          return createQuery(collectionName);
        }
      };
    }
  };

  if (cloudIndex !== undefined || cloudError) {
    cloud.callFunction = async ({ name, data = {} }) => {
      queries.push({ collectionName: `cloudFunction:${name}`, query: data, offset: data.startIndex || 0, limit: data.batchSize || 0 });
      if (cloudError) throw cloudError;
      if (name === 'getSystemFoodIndex') {
        const source = cloudIndex || [];
        const startIndex = Number(data.startIndex) || 0;
        const batchSize = Number(data.batchSize) || source.length || 20;
        const endIndex = Math.min(startIndex + batchSize, source.length);
        return {
          result: {
            ok: true,
            total: source.length,
            startIndex,
            endIndex,
            nextStart: endIndex < source.length ? endIndex : null,
            hasMore: endIndex < source.length,
            index: source.slice(startIndex, endIndex)
          }
        };
      }
      return { result: { ok: false } };
    };
  }

  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      if (storageErrorKeys.includes(key)) {
        throw new Error(`storage item too large: ${key}`);
      }
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    cloud
  };

  return {
    storage,
    queries,
    restore() {
      global.wx = previousWx;
    }
  };
}

function loadIndexService() {
  const modulePath = require.resolve('../miniprogram/utils/systemFoodIndex');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('system food index downloads a slim cache when version changes', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 2,
      indexSchemaVersion: 1
    },
    foods: [
      {
        _id: 'sys-1',
        name: '小麦',
        category: '谷类及制品',
        categoryLevel2: '小麦',
        sourceType: 'system',
        nutritionBasis: { quantity: 100, unit: 'g' },
        nutritionPerBasis: { protein: 11.9 },
        nutritionExtra: { water: 10 },
        image: 'cloud://image'
      },
      {
        _id: 'sys-2',
        name: '苹果',
        category: '水果类及制品',
        categoryLevel2: '仁果类',
        sourceType: 'system',
        nutritionBasis: { quantity: 100, unit: 'g' },
        nutritionPerBasis: { protein: 0.2 }
      }
    ]
  });

  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex({ forceRefresh: true, allowClientPaging: true, pageSize: 1 });

    assert.equal(index.length, 2);
    assert.equal(mock.storage.system_food_index_version, '2026-06-13-v1');
    assert.equal(mock.storage.system_food_index_total, 2);
    assert.equal(index[0].name, '小麦');
    assert.equal(index[0].searchText.includes('小麦'), true);
    assert.equal(index[0].nutritionExtra, undefined);
    assert.equal(index[0].image, undefined);
  } finally {
    mock.restore();
  }
});

test('system food index does not block on client paging when cloud function fails', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 1751,
      indexSchemaVersion: 1
    },
    foods: [
      { _id: 'sys-db-1', name: '不应分页读取', sourceType: 'system' }
    ],
    cloudError: new Error('cloud function not found')
  });

  mock.storage.system_food_index_version = 'old-version';
  mock.storage.system_food_index_total = 1;
  mock.storage.system_food_index_schema_version = 1;
  mock.storage.system_food_index = [{ _id: 'stale-cache', name: '旧缓存', searchText: '旧缓存' }];

  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex();

    assert.deepEqual(index.map(item => item._id), ['stale-cache']);
    assert.equal(mock.storage.system_food_index_version, 'old-version');
    assert.equal(mock.queries.some(item => item.collectionName === 'cloudFunction:getSystemFoodIndex'), true);
    assert.equal(mock.queries.filter(item => item.collectionName === 'food_catalog').length, 0);
  } finally {
    console.warn = previousWarn;
    mock.restore();
  }
});

test('system food index uses cloud function snapshot instead of client paging', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 1,
      indexSchemaVersion: 1
    },
    foods: [
      {
        _id: 'sys-db',
        name: '不应该客户端分页读取',
        sourceType: 'system'
      }
    ],
    cloudIndex: [
      {
        _id: 'sys-cloud',
        name: '云端索引食物',
        category: '谷类及制品',
        sourceType: 'system',
        nutritionBasis: { quantity: 100, unit: 'g' },
        nutritionPerBasis: { protein: 8 }
      }
    ]
  });

  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex({ forceRefresh: true });

    assert.deepEqual(index.map(item => item._id), ['sys-cloud']);
    assert.equal(mock.queries.some(item => item.collectionName === 'cloudFunction:getSystemFoodIndex'), true);
    assert.equal(mock.queries.filter(item => item.collectionName === 'food_catalog').length, 0);
  } finally {
    mock.restore();
  }
});

test('system food index downloads cloud function pages under response size limit', async () => {
  const cloudIndex = Array.from({ length: 401 }, (_, index) => ({
    _id: `sys-cloud-${index + 1}`,
    name: `云端索引食物${index + 1}`,
    category: '谷类及制品',
    sourceType: 'system',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { protein: 8 }
  }));
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 401,
      indexSchemaVersion: 1
    },
    foods: [],
    cloudIndex
  });

  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex({ forceRefresh: true });
    const cloudCalls = mock.queries.filter(item => item.collectionName === 'cloudFunction:getSystemFoodIndex');

    assert.equal(index.length, 401);
    assert.deepEqual(cloudCalls.map(item => item.offset), [0, 50, 100, 150, 200, 250, 300, 350, 400]);
    assert.equal(cloudCalls.every(item => item.limit === 50), true);
    assert.equal(mock.queries.filter(item => item.collectionName === 'food_catalog').length, 0);
  } finally {
    mock.restore();
  }
});

test('system food index reports progressive batches during first sync', async () => {
  const cloudIndex = Array.from({ length: 120 }, (_, index) => ({
    _id: `sys-cloud-${index + 1}`,
    name: `云端索引食物${index + 1}`,
    category: '谷类及制品',
    sourceType: 'system',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { protein: 8 }
  }));
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 120,
      indexSchemaVersion: 1
    },
    foods: [],
    cloudIndex
  });
  const progressCounts = [];

  try {
    const service = loadIndexService();
    await service.getSystemFoodIndex({
      forceRefresh: true,
      onProgress: index => progressCounts.push(index.length)
    });

    assert.deepEqual(progressCounts, [50, 100, 120]);
  } finally {
    mock.restore();
  }
});

test('system food index stores local cache in chunks to avoid storage item limit', async () => {
  const cloudIndex = Array.from({ length: 120 }, (_, index) => ({
    _id: `sys-cloud-${index + 1}`,
    name: `云端索引食物${index + 1}`,
    category: '谷类及制品',
    sourceType: 'system',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { protein: 8 }
  }));
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 120,
      indexSchemaVersion: 1
    },
    foods: [],
    cloudIndex
  });

  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex({ forceRefresh: true });

    assert.equal(index.length, 120);
    assert.equal(mock.storage.system_food_index, undefined);
    assert.equal(mock.storage.system_food_index_chunk_count > 1, true);
    assert.equal(mock.storage.system_food_index_chunks_total, 120);

    const cached = await service.getSystemFoodIndex();
    assert.equal(cached.length, 120);
    assert.deepEqual(cached.map(item => item._id), index.map(item => item._id));
  } finally {
    mock.restore();
  }
});

test('system food index still returns downloaded foods when local cache write fails', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 1,
      indexSchemaVersion: 1
    },
    foods: [],
    cloudIndex: [
      {
        _id: 'sys-cloud',
        name: '云端索引食物',
        category: '谷类及制品',
        sourceType: 'system',
        nutritionBasis: { quantity: 100, unit: 'g' },
        nutritionPerBasis: { protein: 8 }
      }
    ],
    storageErrorKeys: ['system_food_index_chunk_0']
  });

  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex({ forceRefresh: true });

    assert.deepEqual(index.map(item => item._id), ['sys-cloud']);
  } finally {
    console.warn = previousWarn;
    mock.restore();
  }
});

test('system food index does not cache an empty cloud result when meta expects foods', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 1751,
      indexSchemaVersion: 1
    },
    foods: [],
    cloudIndex: []
  });

  mock.storage.system_food_index_version = 'old-version';
  mock.storage.system_food_index_schema_version = 1;
  mock.storage.system_food_index = [{ _id: 'old-cache', name: '旧缓存', searchText: '旧缓存' }];

  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex();

    assert.deepEqual(index.map(item => item._id), ['old-cache']);
    assert.equal(mock.storage.system_food_index_version, 'old-version');
  } finally {
    console.warn = previousWarn;
    mock.restore();
  }
});

test('system food index reuses local cache when version and total match', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 1,
      indexSchemaVersion: 1
    },
    foods: []
  });

  mock.storage.system_food_index_version = '2026-06-13-v1';
  mock.storage.system_food_index_total = 1;
  mock.storage.system_food_index_schema_version = 1;
  mock.storage.system_food_index = [{ _id: 'cached', name: '缓存食物', searchText: '缓存食物' }];

  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex();

    assert.deepEqual(index, mock.storage.system_food_index);
    assert.equal(mock.queries.filter(item => item.collectionName === 'food_catalog').length, 0);
  } finally {
    mock.restore();
  }
});

test('system food index keeps cache usable when meta total is only a hint', async () => {
  const mock = installWxForIndex({
    meta: {
      version: '2026-06-13-v1',
      total: 1752,
      indexSchemaVersion: 1
    },
    foods: []
  });

  mock.storage.system_food_index_version = '2026-06-13-v1';
  mock.storage.system_food_index_total = 1751;
  mock.storage.system_food_index_schema_version = 1;
  mock.storage.system_food_index = [{ _id: 'cached', name: '缓存食物', searchText: '缓存食物' }];

  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex();

    assert.deepEqual(index, mock.storage.system_food_index);
    assert.equal(mock.queries.filter(item => item.collectionName === 'food_catalog').length, 0);
  } finally {
    mock.restore();
  }
});

test('system food index returns local cache when meta lookup fails', async () => {
  const mock = installWxForIndex({
    meta: null,
    foods: [
      { _id: 'sys-db-1', name: '不应分页读取', sourceType: 'system' }
    ],
    metaError: new Error('permission denied')
  });

  mock.storage.system_food_index_version = 'cached-version';
  mock.storage.system_food_index_schema_version = 1;
  mock.storage.system_food_index = [{ _id: 'cached', name: '旧缓存', searchText: '旧缓存' }];

  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const service = loadIndexService();
    const index = await service.getSystemFoodIndex();

    assert.deepEqual(index.map(item => item._id), ['cached']);
    assert.equal(mock.queries.filter(item => item.collectionName === 'food_catalog').length, 0);
  } finally {
    console.warn = previousWarn;
    mock.restore();
  }
});

test('system food index reports whether a local cache exists', () => {
  const mock = installWxForIndex({
    meta: null,
    foods: []
  });

  try {
    const service = loadIndexService();
    assert.equal(service.hasLocalIndex(), false);

    mock.storage.system_food_index_schema_version = 1;
    mock.storage.system_food_index_chunk_count = 1;
    mock.storage.system_food_index_chunk_0 = [{ _id: 'sys-local', name: '本地缓存' }];

    assert.equal(service.hasLocalIndex(), true);
  } finally {
    mock.restore();
  }
});

test('system food index searches locally and limits visible results', async () => {
  const mock = installWxForIndex({ meta: null, foods: [] });
  try {
    const service = loadIndexService();
    const results = service.searchSystemFoodIndex([
      { _id: '1', name: '小麦', searchText: '小麦 谷类' },
      { _id: '2', name: '小麦粉', searchText: '小麦粉 谷类' },
      { _id: '3', name: '苹果', searchText: '苹果 水果' }
    ], '小麦', { limit: 1 });

    assert.deepEqual(results.map(item => item._id), ['1']);
  } finally {
    mock.restore();
  }
});

test('getSystemFoodIndex cloud function returns a slim index payload', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/getSystemFoodIndex/index.js'),
    'utf8'
  );

  assert.match(source, /exports\.main\s*=\s*async\s*\(event\s*=\s*\{\}\)/);
  assert.match(source, /startIndex/);
  assert.match(source, /const DEFAULT_BATCH_SIZE = 50;/);
  assert.match(source, /const MAX_BATCH_SIZE = 100;/);
  assert.match(source, /nextStart/);
  assert.match(source, /hasMore/);
  assert.match(source, /sourceType:\s*'system'/);
  assert.doesNotMatch(source, /where\(\{\s*sourceType:\s*'system',\s*status:\s*'active'\s*\}\)/);
  assert.match(source, /nutritionPerBasis/);
  assert.match(source, /searchText/);
  assert.match(source, /return\s*\{\s*ok:\s*true/);
});
