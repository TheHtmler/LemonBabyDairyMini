/**
 * cloud:// fileID → 临时 HTTPS URL 本地缓存。
 * 命中缓存时不调用 getTempFileURL，减少云存储下载计费。
 * maxAge 只影响 CDN 临时链有效期，不能省 API 次数；省次数靠本缓存。
 */

const CACHE_STORAGE_KEY = 'cloud_temp_url_cache_v1';
const DEFAULT_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 天，略短于 maxAge 7 天
const DEFAULT_MAX_AGE_SEC = 604800;
const CHUNK_SIZE = 50;

function readCacheStore() {
  try {
    const store = wx.getStorageSync(CACHE_STORAGE_KEY);
    return store && typeof store === 'object' ? store : {};
  } catch (error) {
    return {};
  }
}

function writeCacheStore(store) {
  try {
    wx.setStorageSync(CACHE_STORAGE_KEY, store || {});
  } catch (error) {
    console.warn('[cloudTempUrlCache] 写入本地缓存失败:', error);
  }
}

function getCachedUrl(fileId, now = Date.now()) {
  if (!fileId) return '';
  const store = readCacheStore();
  const entry = store[fileId];
  if (!entry || !entry.url || !entry.expiresAt || entry.expiresAt <= now) {
    return '';
  }
  return entry.url;
}

function putCachedUrls(entries = [], ttlMs = DEFAULT_TTL_MS) {
  if (!entries.length) return;
  const store = readCacheStore();
  const expiresAt = Date.now() + ttlMs;
  entries.forEach(({ fileId, url }) => {
    if (!fileId || !url) return;
    store[fileId] = { url, expiresAt };
  });
  writeCacheStore(store);
}

/**
 * 批量解析 cloud:// fileID。
 * @param {string[]} fileIds
 * @param {{ forceRefresh?: boolean, maxAge?: number, ttlMs?: number }} options
 * @returns {Promise<Map<string, string>>} fileId → tempUrl
 */
async function resolveCloudTempUrls(fileIds = [], options = {}) {
  const {
    forceRefresh = false,
    maxAge = DEFAULT_MAX_AGE_SEC,
    ttlMs = DEFAULT_TTL_MS
  } = options;

  const uniqueIds = Array.from(
    new Set(
      (fileIds || [])
        .map((id) => String(id || '').trim())
        .filter((id) => id.startsWith('cloud://'))
    )
  );

  const result = new Map();
  if (!uniqueIds.length) return result;

  const now = Date.now();
  const missing = [];

  uniqueIds.forEach((fileId) => {
    if (!forceRefresh) {
      const cached = getCachedUrl(fileId, now);
      if (cached) {
        result.set(fileId, cached);
        return;
      }
    }
    missing.push(fileId);
  });

  if (!missing.length) {
    return result;
  }

  const fetched = [];
  for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
    const chunk = missing.slice(i, i + CHUNK_SIZE);
    try {
      const { fileList } = await wx.cloud.getTempFileURL({
        fileList: chunk.map((fileID) => ({ fileID, maxAge }))
      });
      (fileList || []).forEach((item) => {
        if (item?.fileID && item.tempFileURL) {
          result.set(item.fileID, item.tempFileURL);
          fetched.push({ fileId: item.fileID, url: item.tempFileURL });
        }
      });
    } catch (error) {
      console.warn('[cloudTempUrlCache] getTempFileURL 失败:', error);
    }
  }

  putCachedUrls(fetched, ttlMs);
  return result;
}

function invalidateCloudTempUrl(fileId = '') {
  const id = String(fileId || '').trim();
  if (!id) return;
  const store = readCacheStore();
  if (!store[id]) return;
  delete store[id];
  writeCacheStore(store);
}

function clearCloudTempUrlCache() {
  try {
    wx.removeStorageSync(CACHE_STORAGE_KEY);
  } catch (error) {
    console.warn('[cloudTempUrlCache] 清空缓存失败:', error);
  }
}

module.exports = {
  resolveCloudTempUrls,
  getCachedUrl,
  invalidateCloudTempUrl,
  clearCloudTempUrlCache,
  CACHE_STORAGE_KEY,
  DEFAULT_TTL_MS
};
