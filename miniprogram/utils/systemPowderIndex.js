const {
  POWDER_CATEGORIES,
  getDefaultProteinRole,
  normalizeNutritionPer100g,
  normalizeMixRatio
} = require('./formulaPowderUtils');

const META_COLLECTION = 'system_powder_catalog_meta';
const POWDER_COLLECTION = 'powder_catalog';
const META_KEY = 'system_powder_index';
const INDEX_SCHEMA_VERSION = 1;
const STORAGE_KEYS = {
  version: 'system_powder_index_version',
  total: 'system_powder_index_total',
  schemaVersion: 'system_powder_index_schema_version',
  items: 'system_powder_index_items',
  chunkCount: 'system_powder_index_chunk_count',
  chunksTotal: 'system_powder_index_chunks_total',
  chunkPrefix: 'system_powder_index_chunk_'
};
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_RESULT_LIMIT = 50;
const DEFAULT_CLOUD_BATCH_SIZE = 50;
const MAX_STORAGE_CHUNK_ITEMS = 50;
const INDEX_FIELDS = {
  _id: true,
  powderCode: true,
  name: true,
  category: true,
  proteinRole: true,
  brand: true,
  stage: true,
  image: true,
  nutritionPer100g: true,
  mixRatio: true,
  alias: true,
  description: true,
  schemaVersion: true,
  status: true
};

function getDb() {
  return wx.cloud.database();
}

function hasCloud() {
  return !!(typeof wx !== 'undefined' && wx.cloud);
}

function normalizeSearchText(value = '') {
  return value.toString().trim().toLowerCase().replace(/\s+/g, '');
}

function buildSearchText(powder = {}) {
  return normalizeSearchText([
    powder.name || '',
    powder.brand || '',
    powder.stage || '',
    powder.powderCode || '',
    powder.description || '',
    Array.isArray(powder.alias) ? powder.alias.join(' ') : ''
  ].join(' '));
}

function normalizeSystemPowderItem(item = {}, index = 0) {
  const category = Object.values(POWDER_CATEGORIES).includes(item.category)
    ? item.category
    : POWDER_CATEGORIES.REGULAR_FORMULA;
  const powderCode = (item.powderCode || item._id || `system_powder_${index + 1}`).toString().trim();

  return {
    _id: item._id || powderCode,
    powderCode,
    name: item.name || '未命名奶粉',
    category,
    proteinRole: item.proteinRole || getDefaultProteinRole(category),
    brand: item.brand || '',
    stage: item.stage || '',
    image: item.image || '',
    nutritionPer100g: normalizeNutritionPer100g(item.nutritionPer100g || {}),
    mixRatio: normalizeMixRatio(item.mixRatio || {}),
    alias: Array.isArray(item.alias) ? item.alias : [],
    description: item.description || '',
    schemaVersion: Number(item.schemaVersion) || INDEX_SCHEMA_VERSION,
    recordType: 'powder_catalog_item',
    status: item.status || 'active',
    sourceType: 'system',
    ownerType: 'system',
    isSystem: true,
    libraryScope: 'system',
    searchText: buildSearchText({ ...item, powderCode })
  };
}

async function getRemoteMeta() {
  const res = await getDb().collection(META_COLLECTION)
    .where({ key: META_KEY, status: 'active' })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function getLocalIndex() {
  const chunkCount = Number(wx.getStorageSync(STORAGE_KEYS.chunkCount)) || 0;
  if (chunkCount > 0) {
    const chunks = [];
    for (let i = 0; i < chunkCount; i += 1) {
      const chunk = wx.getStorageSync(`${STORAGE_KEYS.chunkPrefix}${i}`);
      if (!Array.isArray(chunk)) {
        return [];
      }
      chunks.push(...chunk);
    }
    return chunks;
  }

  const items = wx.getStorageSync(STORAGE_KEYS.items);
  return Array.isArray(items) ? items : [];
}

function hasLocalIndex() {
  try {
    return getLocalIndex().length > 0;
  } catch (error) {
    console.warn('读取系统奶粉本地索引状态失败:', error);
    return false;
  }
}

function getLocalVersion() {
  return wx.getStorageSync(STORAGE_KEYS.version) || '';
}

function isLocalIndexFresh(meta) {
  if (!meta) return false;
  const localVersion = getLocalVersion();
  const localSchemaVersion = Number(wx.getStorageSync(STORAGE_KEYS.schemaVersion)) || 0;
  const index = getLocalIndex();

  return (
    localVersion === meta.version &&
    localSchemaVersion === INDEX_SCHEMA_VERSION &&
    index.length > 0
  );
}

function saveLocalIndex(meta, index) {
  const previousChunkCount = Number(wx.getStorageSync(STORAGE_KEYS.chunkCount)) || 0;
  const chunks = [];
  for (let i = 0; i < index.length; i += MAX_STORAGE_CHUNK_ITEMS) {
    chunks.push(index.slice(i, i + MAX_STORAGE_CHUNK_ITEMS));
  }

  chunks.forEach((chunk, chunkIndex) => {
    wx.setStorageSync(`${STORAGE_KEYS.chunkPrefix}${chunkIndex}`, chunk);
  });
  for (let i = chunks.length; i < previousChunkCount; i += 1) {
    wx.removeStorageSync(`${STORAGE_KEYS.chunkPrefix}${i}`);
  }

  wx.setStorageSync(STORAGE_KEYS.version, (meta && meta.version) || 'local');
  wx.setStorageSync(STORAGE_KEYS.total, index.length);
  wx.setStorageSync(STORAGE_KEYS.schemaVersion, INDEX_SCHEMA_VERSION);
  wx.setStorageSync(STORAGE_KEYS.chunkCount, chunks.length);
  wx.setStorageSync(STORAGE_KEYS.chunksTotal, index.length);
  wx.removeStorageSync(STORAGE_KEYS.items);
}

async function downloadFromCloudFunction(options = {}) {
  if (!hasCloud() || typeof wx.cloud.callFunction !== 'function') {
    return null;
  }

  try {
    const batchSize = Number(options.cloudBatchSize) || DEFAULT_CLOUD_BATCH_SIZE;
    const allIndex = [];
    let startIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await wx.cloud.callFunction({
        name: 'getSystemPowderIndex',
        data: {
          indexSchemaVersion: INDEX_SCHEMA_VERSION,
          startIndex,
          batchSize
        }
      });
      const result = res && res.result;
      if (!result || result.ok !== true || !Array.isArray(result.index)) {
        return null;
      }

      allIndex.push(...result.index.map((item, idx) => normalizeSystemPowderItem(item, startIndex + idx)));
      hasMore = result.hasMore === true;
      if (hasMore) {
        const nextStart = Number(result.nextStart);
        if (!Number.isFinite(nextStart) || nextStart <= startIndex) {
          return null;
        }
        startIndex = nextStart;
      }
    }

    return allIndex;
  } catch (error) {
    console.warn('云函数获取系统奶粉索引失败，将使用本地缓存:', error);
    return null;
  }
}

async function downloadFromCollection(options = {}) {
  if (!hasCloud()) {
    return null;
  }

  try {
    const pageSize = Number(options.pageSize) || DEFAULT_PAGE_SIZE;
    const items = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      let query = getDb().collection(POWDER_COLLECTION)
        .where({ sourceType: 'system', status: 'active' })
        .skip(offset)
        .limit(pageSize);
      if (typeof query.field === 'function') {
        query = query.field(INDEX_FIELDS);
      }
      const res = await query.get();
      const batch = res.data || [];
      items.push(...batch.map((item, idx) => normalizeSystemPowderItem(item, offset + idx)));
      if (batch.length < pageSize) {
        hasMore = false;
      } else {
        offset += batch.length;
      }
    }

    return items;
  } catch (error) {
    console.warn('读取系统奶粉集合失败，将使用本地缓存:', error);
    return null;
  }
}

async function getSystemPowderIndex(options = {}) {
  if (!options.forceRefresh && options.preferLocal === true) {
    const localIndex = getLocalIndex();
    if (localIndex.length > 0) {
      return localIndex;
    }
  }

  let meta = null;
  try {
    meta = await getRemoteMeta();
  } catch (error) {
    console.warn('读取系统奶粉索引版本失败，将使用本地缓存:', error);
  }

  if (!options.forceRefresh && isLocalIndexFresh(meta)) {
    return getLocalIndex();
  }

  const cloudIndex = await downloadFromCloudFunction(options)
    || await downloadFromCollection(options);

  if (Array.isArray(cloudIndex)) {
    try {
      saveLocalIndex(meta, cloudIndex);
    } catch (error) {
      console.warn('系统奶粉索引写入本地缓存失败，本次仍使用云端索引:', error);
    }
    return cloudIndex;
  }

  return getLocalIndex();
}

function fuzzyIncludes(text = '', query = '') {
  const source = normalizeSearchText(text);
  const keyword = normalizeSearchText(query);
  if (!keyword) return true;
  if (!source) return false;
  if (source.includes(keyword)) return true;

  let queryIndex = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === keyword[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === keyword.length) {
        return true;
      }
    }
  }
  return false;
}

function searchSystemPowders(items = [], query = '') {
  const keyword = normalizeSearchText(query);
  if (!keyword) {
    return items;
  }

  return items.filter((item) => fuzzyIncludes(item.searchText || buildSearchText(item), keyword));
}

function groupSystemPowdersByCategory(items = []) {
  const categoryOrder = [
    POWDER_CATEGORIES.REGULAR_FORMULA,
    POWDER_CATEGORIES.SPECIAL_FORMULA,
    POWDER_CATEGORIES.ENERGY_SUPPLEMENT
  ];

  const groupedMap = categoryOrder.reduce((acc, category) => {
    acc[category] = [];
    return acc;
  }, {});

  items.forEach((item) => {
    const category = groupedMap[item.category] ? item.category : POWDER_CATEGORIES.REGULAR_FORMULA;
    groupedMap[category].push(item);
  });

  return categoryOrder
    .map((category) => ({
      category,
      items: groupedMap[category] || []
    }))
    .filter((group) => group.items.length > 0);
}

module.exports = {
  INDEX_SCHEMA_VERSION,
  STORAGE_KEYS,
  META_COLLECTION,
  POWDER_COLLECTION,
  META_KEY,
  fuzzyIncludes,
  getLocalIndex,
  getLocalVersion,
  getSystemPowderIndex,
  groupSystemPowdersByCategory,
  hasLocalIndex,
  normalizeSystemPowderItem,
  searchSystemPowders
};
