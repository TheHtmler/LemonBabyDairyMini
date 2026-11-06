const { indexNutrientStates } = require('./search-core/nutrition');
const db = wx.cloud.database();

const META_COLLECTION = 'system_food_catalog_meta';
const FOOD_COLLECTION = 'food_catalog';
const META_KEY = 'system_food_index';
const INDEX_SCHEMA_VERSION = 3;
const STORAGE_KEYS = {
  version: 'system_food_index_version',
  total: 'system_food_index_total',
  schemaVersion: 'system_food_index_schema_version',
  index: 'system_food_index',
  chunkCount: 'system_food_index_chunk_count',
  chunksTotal: 'system_food_index_chunks_total',
  chunkPrefix: 'system_food_index_chunk_'
};
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_RESULT_LIMIT = 50;
const DEFAULT_CLOUD_BATCH_SIZE = 50;
const MAX_STORAGE_CHUNK_ITEMS = 50;
const INDEX_FIELDS = {
  _id: true,
  name: true,
  category: true,
  categoryLevel1: true,
  categoryLevel2: true,
  schemaVersion: true,
  recordType: true,
  status: true,
  sourceType: true,
  ownerType: true,
  sourceFoodCode: true,
  categoryLevel1Code: true,
  categoryLevel2Code: true,
  nutritionBasis: true,
  servingBasis: true,
  baseQuantity: true,
  baseUnit: true,
  nutritionPer100g: true,
  nutritionPerUnit: true,
  nutritionPerBasis: true,
  nutrientStates: true,
  recognitionMeta: true,
  proteinSource: true,
  proteinQuality: true,
  proteinComposition: true,
  alias: true,
  aliasText: true,
  origin: true
};

function normalizeSearchText(value = '') {
  return value.toString().trim().toLowerCase().replace(/\s+/g, '');
}

function nutritionFromStates(states) {
  return Object.fromEntries(['calories', 'protein', 'carbs', 'fat', 'fiber', 'sodium'].map(field => {
    const entry = states[field];
    // 选择食物时提供可直接展示和计算的零值，来源状态另行保留。
    return [field, entry?.state === 'known' ? entry.value : 0];
  }));
}

function buildIndexNutrientStates(food, nutrition, basis) {
  const states = indexNutrientStates(food, nutrition, basis);
  Object.entries(states).forEach(([field, state]) => {
    const previous = food.nutrientStates?.[field];
    const proof = previous && typeof previous === 'object' ? previous : {};
    // 索引保留原始证据，不能在云端、客户端连续归一化时丢失真实零与微量的区别。
    state.rawValue = Object.prototype.hasOwnProperty.call(proof, 'rawValue')
      ? proof.rawValue : (nutrition[field] === undefined ? null : nutrition[field]);
    ['source', 'limit'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(proof, key)) state[key] = proof[key];
    });
    if (proof.sourceState || proof.state) state.sourceState = proof.sourceState || proof.state;
    if (state.state !== 'known' && proof.reason) state.reason = proof.reason;
  });
  return states;
}

function buildSearchText(food = {}) {
  return normalizeSearchText([
    food.name || '',
    food.category || '',
    food.categoryLevel1 || '',
    food.categoryLevel2 || '',
    food.sourceFoodCode || '',
    Array.isArray(food.alias) ? food.alias.join(' ') : (food.aliasText || food.alias || '')
  ].join(' '));
}

function toIndexItem(food = {}) {
  const nutrition = food.nutritionPerBasis || food.nutritionPer100g || food.nutritionPerUnit || {};
  const sourceBasis = food.nutritionBasis || food.servingBasis || {
    quantity: food.baseQuantity != null ? food.baseQuantity : (food.nutritionPer100g ? 100 : null),
    unit: food.baseUnit || (food.nutritionPer100g ? 'g' : null)
  };
  const quantity = Number(sourceBasis.quantity);
  const nutritionBasis = {
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    unit: sourceBasis.unit || null
  };
  const nutrientStates = buildIndexNutrientStates(food, nutrition, nutritionBasis);

  return {
    _id: food._id || '',
    name: food.name || '',
    category: food.category || food.categoryLevel1 || '',
    categoryLevel1: food.categoryLevel1 || food.category || '',
    categoryLevel2: food.categoryLevel2 || '',
    schemaVersion: Number(food.schemaVersion) || 2,
    recordType: food.recordType || 'food_catalog_item',
    status: food.status || 'active',
    sourceType: 'system',
    ownerType: 'system',
    isSystem: true,
    libraryScope: 'system',
    sourceFoodCode: food.sourceFoodCode || food.origin?.foodCode || '',
    categoryLevel1Code: food.categoryLevel1Code || food.origin?.categoryLevel1Code || '',
    categoryLevel2Code: food.categoryLevel2Code || food.origin?.categoryLevel2Code || '',
    nutritionBasis,
    nutritionPerBasis: nutritionFromStates(nutrientStates),
    nutrientStates,
    ...(food.recognitionMeta ? { recognitionMeta: food.recognitionMeta } : {}),
    origin: food.origin || {},
    proteinSource: food.proteinSource || 'natural',
    proteinQuality: food.proteinQuality || '',
    proteinComposition: food.proteinComposition || null,
    aliasText: food.aliasText || (Array.isArray(food.alias) ? food.alias.join(' / ') : (food.alias || '')),
    searchText: buildSearchText(food)
  };
}

async function getRemoteMeta() {
  const res = await db.collection(META_COLLECTION)
    .where({ key: META_KEY, status: 'active' })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

function getLocalIndex() {
  // 所有本地读取（包括 preferLocal 和网络失败兜底）统一拒绝旧版零值语义。
  if (Number(wx.getStorageSync(STORAGE_KEYS.schemaVersion)) !== INDEX_SCHEMA_VERSION) return [];
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
    return chunks.length === Number(wx.getStorageSync(STORAGE_KEYS.chunksTotal)) ? chunks : [];
  }

  const index = wx.getStorageSync(STORAGE_KEYS.index);
  return Array.isArray(index) ? index : [];
}

function isLocalIndexFresh(meta) {
  if (!meta) return false;
  const localVersion = wx.getStorageSync(STORAGE_KEYS.version);
  const localSchemaVersion = Number(wx.getStorageSync(STORAGE_KEYS.schemaVersion)) || 0;
  const index = getLocalIndex();

  return (
    localVersion === meta.version &&
    localSchemaVersion === INDEX_SCHEMA_VERSION &&
    index.length > 0
  );
}

function hasLocalIndex() {
  try {
    return getLocalIndex().length > 0;
  } catch (error) {
    console.warn('读取系统食物本地索引状态失败:', error);
    return false;
  }
}

async function downloadSystemFoodIndex(options = {}) {
  const pageSize = Number(options.pageSize) || DEFAULT_PAGE_SIZE;
  const allFoods = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = db.collection(FOOD_COLLECTION)
      .where({
        sourceType: 'system',
        status: 'active'
      })
      .skip(offset)
      .limit(pageSize);
    if (typeof query.field === 'function') {
      query = query.field(INDEX_FIELDS);
    }
    const res = await query.get();
    const batch = res.data || [];
    allFoods.push(...batch.map(toIndexItem));
    if (batch.length < pageSize) {
      hasMore = false;
    } else {
      offset += batch.length;
    }
  }

  return allFoods;
}

async function downloadSystemFoodIndexFromCloudFunction(options = {}) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return null;
  }

  try {
    const batchSize = Number(options.cloudBatchSize) || DEFAULT_CLOUD_BATCH_SIZE;
    const allIndex = [];
    let startIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await wx.cloud.callFunction({
        name: 'getSystemFoodIndex',
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
      if (Number(result.indexSchemaVersion) !== INDEX_SCHEMA_VERSION) {
        console.warn('系统食物云端索引版本不兼容，请先更新 getSystemFoodIndex 云函数');
        return null;
      }

      allIndex.push(...result.index.map(toIndexItem));
      if (typeof options.onProgress === 'function') {
        options.onProgress([...allIndex], {
          startIndex: result.startIndex,
          endIndex: result.endIndex,
          hasMore: result.hasMore === true
        });
      }
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
    console.warn('云函数获取系统食物索引失败，将使用本地缓存:', error);
    return null;
  }
}

function saveLocalIndex(meta, index) {
  const previousChunkCount = Number(wx.getStorageSync(STORAGE_KEYS.chunkCount)) || 0;
  // 全部分片写完后再提交版本，写入中断时不读取半份新旧混合缓存。
  wx.removeStorageSync(STORAGE_KEYS.schemaVersion);
  const chunks = [];
  for (let i = 0; i < index.length; i += MAX_STORAGE_CHUNK_ITEMS) {
    chunks.push(index.slice(i, i + MAX_STORAGE_CHUNK_ITEMS));
  }

  chunks.forEach((chunk, index) => {
    wx.setStorageSync(`${STORAGE_KEYS.chunkPrefix}${index}`, chunk);
  });
  for (let i = chunks.length; i < previousChunkCount; i += 1) {
    wx.removeStorageSync(`${STORAGE_KEYS.chunkPrefix}${i}`);
  }

  wx.setStorageSync(STORAGE_KEYS.version, meta.version);
  wx.setStorageSync(STORAGE_KEYS.total, index.length);
  wx.setStorageSync(STORAGE_KEYS.chunkCount, chunks.length);
  wx.setStorageSync(STORAGE_KEYS.chunksTotal, index.length);
  wx.removeStorageSync(STORAGE_KEYS.index);
  wx.setStorageSync(STORAGE_KEYS.schemaVersion, INDEX_SCHEMA_VERSION);
}

function shouldAcceptDownloadedIndex(meta, index) {
  const expectedTotal = Number(meta?.total) || 0;
  if (expectedTotal > 0 && (!Array.isArray(index) || index.length === 0)) {
    return false;
  }
  return Array.isArray(index);
}

async function getSystemFoodIndex(options = {}) {
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
    console.warn('读取系统食物索引版本失败，将使用本地缓存:', error);
    const localIndex = getLocalIndex();
    if (localIndex.length > 0 && !options.forceRefresh) return localIndex;
  }

  if (!options.forceRefresh && isLocalIndexFresh(meta)) {
    return getLocalIndex();
  }

  const cloudIndex = await downloadSystemFoodIndexFromCloudFunction(options);
  if (cloudIndex) {
    if (!shouldAcceptDownloadedIndex(meta, cloudIndex)) {
      console.warn('系统食物云端索引为空，保留本地缓存');
      return getLocalIndex();
    }
    if (meta) {
      try {
        saveLocalIndex(meta, cloudIndex);
      } catch (error) {
        console.warn('系统食物索引写入本地缓存失败，本次仍使用云端索引:', error);
      }
    }
    return cloudIndex;
  }

  if (!options.allowClientPaging) {
    return getLocalIndex();
  }

  const index = await downloadSystemFoodIndex(options);
  if (!shouldAcceptDownloadedIndex(meta, index)) {
    console.warn('系统食物客户端索引为空，保留本地缓存');
    return getLocalIndex();
  }
  if (meta) {
    try {
      saveLocalIndex(meta, index);
    } catch (error) {
      console.warn('系统食物索引写入本地缓存失败，本次仍使用云端索引:', error);
    }
  }

  return index;
}

function searchSystemFoodIndex(index = [], keyword = '', options = {}) {
  const limit = Number(options.limit) || DEFAULT_RESULT_LIMIT;
  const normalized = normalizeSearchText(keyword);
  const source = Array.isArray(index) ? index : [];
  const results = normalized
    ? source.filter(food => (food.searchText || buildSearchText(food)).includes(normalized))
    : source;
  return results.slice(0, limit);
}

module.exports = {
  getSystemFoodIndex,
  hasLocalIndex,
  searchSystemFoodIndex,
  toIndexItem,
  STORAGE_KEYS,
  INDEX_SCHEMA_VERSION
};
