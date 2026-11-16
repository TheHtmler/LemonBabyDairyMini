const CACHE_KEY = 'food_image_files_v1';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2048;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOADS = 3;
const FILE_PATTERN = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/;
const pending = new Map();
const failures = new Map();
const queue = [];
let activeDownloads = 0;
let cache = null;
let flushTimer = null;

function flush() {
  if (!cache) return;
  try { wx.setStorageSync(CACHE_KEY, { items: cache.items }); }
  catch (error) { console.warn('保存食物图片缓存目录失败'); }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 500);
}

function getCache() {
  if (cache) return cache;
  try {
    const fs = wx.getFileSystemManager();
    const directory = wx.env.USER_DATA_PATH + '/food-image-cache-v1';
    try { fs.accessSync(directory); } catch (error) { fs.mkdirSync(directory, true); }
    const stored = wx.getStorageSync(CACHE_KEY);
    const items = Object.create(null);
    const storedItems = stored?.items && typeof stored.items === 'object' ? stored.items : {};
    const existingFiles = new Set(fs.readdirSync(directory));
    const retained = new Set();
    let bytes = 0;
    Object.keys(storedItems).sort((a, b) => (storedItems[b]?.usedAt || 0) - (storedItems[a]?.usedAt || 0))
      .forEach(source => {
        const item = storedItems[source];
        if (!item || !FILE_PATTERN.test(item.file) || !Number.isFinite(item.size) || item.size <= 0
          || item.size > MAX_FILE_BYTES || retained.size >= MAX_FILES || bytes + item.size > MAX_BYTES
          || retained.has(item.file)) return;
        if (!existingFiles.has(item.file)) return;
        items[source] = { file: item.file, size: item.size, usedAt: Number(item.usedAt) || 0 };
        retained.add(item.file);
        bytes += item.size;
      });
    // 仅清理专用目录内符合命名规则的孤立缓存，不触碰用户照片或其他业务文件。
    existingFiles.forEach(file => {
      if (FILE_PATTERN.test(file) && !retained.has(file)) {
        try { fs.unlinkSync(directory + '/' + file); } catch (error) { /* 下次初始化再清理。 */ }
      }
    });
    cache = { fs, directory, items };
    return cache;
  } catch (error) {
    return null;
  }
}

function removeEntry(store, source) {
  const item = store.items[source];
  if (!item) return true;
  const filePath = store.directory + '/' + item.file;
  try { store.fs.accessSync(filePath); }
  catch (error) { delete store.items[source]; return true; }
  try { store.fs.unlinkSync(filePath); delete store.items[source]; return true; }
  catch (error) { return false; }
}

function getCachedFile(source) {
  const store = getCache();
  const item = store?.items[source];
  if (!item) return '';
  try { store.fs.accessSync(store.directory + '/' + item.file); }
  catch (error) { delete store.items[source]; scheduleFlush(); return ''; }
  item.usedAt = Date.now();
  scheduleFlush();
  return store.directory + '/' + item.file;
}

function fileName(source) {
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < source.length; i++) {
    first = Math.imul(first ^ source.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ source.charCodeAt(i);
  }
  const hex = value => (value >>> 0).toString(16).padStart(8, '0');
  const extension = source.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i)?.[1].toLowerCase() || 'jpg';
  return hex(first) + hex(second) + '.' + extension;
}

async function persistFile(source, tempFilePath) {
  const store = getCache();
  if (!store) return tempFilePath;
  try {
    const info = await new Promise((resolve, reject) => store.fs.getFileInfo({ filePath: tempFilePath, success: resolve, fail: reject }));
    if (!Number.isFinite(info.size) || info.size <= 0 || info.size > MAX_FILE_BYTES) return tempFilePath;
    let entries = Object.keys(store.items);
    let bytes = entries.reduce((total, key) => total + store.items[key].size, 0);
    const oldest = entries.sort((a, b) => store.items[a].usedAt - store.items[b].usedAt);
    while (bytes + info.size > MAX_BYTES || entries.length >= MAX_FILES) {
      const key = oldest.shift();
      if (!key) return tempFilePath;
      const size = store.items[key].size;
      if (!removeEntry(store, key)) return tempFilePath;
      bytes -= size;
      entries = entries.filter(entry => entry !== key);
    }
    const file = fileName(source);
    // 两个来源不能共用同一个缓存文件，即使遇到极少见的摘要碰撞也直接跳过持久化。
    if (Object.keys(store.items).some(key => key !== source && store.items[key].file === file)) return tempFilePath;
    const target = store.directory + '/' + file;
    store.fs.copyFileSync(tempFilePath, target);
    store.items[source] = { file, size: info.size, usedAt: Date.now() };
    flush();
    return target;
  } catch (error) {
    // 手机空间不足或文件 API 不可用时，仍可用本次下载的临时文件显示图片。
    return tempFilePath;
  }
}

function download(source) {
  return new Promise((resolve, reject) => {
    const success = result => {
      if (result.statusCode && result.statusCode !== 200) { reject(new Error('食物图片下载失败')); return; }
      if (!result.tempFilePath) { reject(new Error('食物图片文件为空')); return; }
      resolve(result.tempFilePath);
    };
    if (source.startsWith('cloud://')) wx.cloud.downloadFile({ fileID: source, success, fail: reject });
    else wx.downloadFile({ url: source, timeout: 15000, success, fail: reject });
  }).then(tempFilePath => persistFile(source, tempFilePath));
}

function pumpQueue() {
  while (activeDownloads < MAX_DOWNLOADS && queue.length) {
    const task = queue.shift();
    if (!task.waiters.some(waiter => waiter.isActive())) {
      pending.delete(task.source);
      task.waiters.forEach(waiter => waiter.resolve(''));
      continue;
    }
    activeDownloads++;
    download(task.source).then(path => {
      pending.delete(task.source);
      task.waiters.forEach(waiter => waiter.resolve(path));
    }, error => {
      pending.delete(task.source);
      if (failures.size >= MAX_FILES) failures.clear();
      failures.set(task.source, Date.now() + 30000);
      task.waiters.forEach(waiter => waiter.reject(error));
    }).finally(() => {
      activeDownloads--;
      pumpQueue();
    });
  }
}

function loadFoodImage(source, options = {}) {
  if (!/^(cloud:\/\/|https:\/\/)/.test(source)) return Promise.resolve(source);
  const local = getCachedFile(source);
  if (local) return Promise.resolve(local);
  if ((failures.get(source) || 0) > Date.now()) return Promise.reject(new Error('食物图片暂不可用'));
  return new Promise((resolve, reject) => {
    let task = pending.get(source);
    if (!task) {
      task = { source, waiters: [] };
      pending.set(source, task);
      queue.push(task);
    }
    task.waiters.push({ resolve, reject, isActive: options.isActive || (() => true) });
    pumpQueue();
  });
}

function invalidateFoodImage(source) {
  const store = getCache();
  if (store && removeEntry(store, source)) scheduleFlush();
}

module.exports = { getCachedFoodImage: getCachedFile, loadFoodImage, invalidateFoodImage };
