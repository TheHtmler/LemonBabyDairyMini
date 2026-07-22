/**
 * 数据记录页 Tab 顺序偏好（仅本地存储）
 */

const STORAGE_KEY = 'data_records_tab_prefs_v1';

const ALL_RECORD_TABS = [
  { key: 'feeding', label: '喂奶' },
  { key: 'food', label: '食物' },
  { key: 'medication', label: '用药' },
  { key: 'treatment', label: '治疗' },
  { key: 'bowel', label: '尿布' },
  { key: 'water', label: '喝水' }
];

const DEFAULT_ORDERED_KEYS = ALL_RECORD_TABS.map((item) => item.key);
/** @deprecated 兼容旧版常驻字段 */
const DEFAULT_PINNED_KEYS = ['feeding', 'food', 'medication'];
const MAX_PINNED_TABS = ALL_RECORD_TABS.length;

const TAB_MAP = ALL_RECORD_TABS.reduce((map, item) => {
  map[item.key] = item;
  return map;
}, {});

function clonePrefs(prefs = {}) {
  return {
    orderedKeys: Array.isArray(prefs.orderedKeys) ? prefs.orderedKeys.slice() : []
  };
}

function normalizeRecordTabsPreference(raw = {}) {
  const seen = new Set();
  const orderedKeys = [];
  const sourceKeys = Array.isArray(raw.orderedKeys) && raw.orderedKeys.length > 0
    ? raw.orderedKeys
    : (Array.isArray(raw.pinnedKeys) ? raw.pinnedKeys.concat(DEFAULT_ORDERED_KEYS) : DEFAULT_ORDERED_KEYS);

  sourceKeys.forEach((key) => {
    if (!TAB_MAP[key] || seen.has(key)) return;
    seen.add(key);
    orderedKeys.push(key);
  });

  DEFAULT_ORDERED_KEYS.forEach((key) => {
    if (seen.has(key)) return;
    seen.add(key);
    orderedKeys.push(key);
  });

  return { orderedKeys };
}

function getVisibleTabs(prefs = {}) {
  const normalized = normalizeRecordTabsPreference(prefs);
  return normalized.orderedKeys.map((key) => TAB_MAP[key]).filter(Boolean);
}

function moveOrderedTab(prefs = {}, key, offset = 0) {
  const next = clonePrefs(normalizeRecordTabsPreference(prefs));
  const index = next.orderedKeys.indexOf(key);
  if (index < 0 || !Number.isFinite(offset) || offset === 0) return next;
  const target = index + offset;
  if (target < 0 || target >= next.orderedKeys.length) return next;
  const [item] = next.orderedKeys.splice(index, 1);
  next.orderedKeys.splice(target, 0, item);
  return next;
}

function buildRecordTabBar(prefs = {}, activeTab = 'feeding') {
  const normalized = normalizeRecordTabsPreference(prefs);
  const visibleTabs = getVisibleTabs(normalized);
  return {
    prefs: normalized,
    visibleTabs,
    activeTab: TAB_MAP[activeTab] ? activeTab : 'feeding'
  };
}

function loadRecordTabsPreference(storage = null) {
  try {
    const store = storage || (typeof wx !== 'undefined' ? wx : null);
    const raw = store && typeof store.getStorageSync === 'function'
      ? store.getStorageSync(STORAGE_KEY)
      : null;
    return normalizeRecordTabsPreference(raw || {});
  } catch (error) {
    return normalizeRecordTabsPreference();
  }
}

function saveRecordTabsPreference(prefs, storage = null) {
  const normalized = normalizeRecordTabsPreference(prefs);
  try {
    const store = storage || (typeof wx !== 'undefined' ? wx : null);
    if (store && typeof store.setStorageSync === 'function') {
      store.setStorageSync(STORAGE_KEY, normalized);
    }
  } catch (error) {
    // ignore local storage failures
  }
  return normalized;
}

// 兼容旧调用名
function getPinnedTabs(prefs) {
  return getVisibleTabs(prefs);
}

function getMoreTabs() {
  return [];
}

function togglePinnedTab(prefs) {
  return normalizeRecordTabsPreference(prefs);
}

function movePinnedTab(prefs, key, offset) {
  return moveOrderedTab(prefs, key, offset);
}

module.exports = {
  STORAGE_KEY,
  ALL_RECORD_TABS,
  DEFAULT_ORDERED_KEYS,
  DEFAULT_PINNED_KEYS,
  MAX_PINNED_TABS,
  normalizeRecordTabsPreference,
  getVisibleTabs,
  getPinnedTabs,
  getMoreTabs,
  togglePinnedTab,
  movePinnedTab,
  moveOrderedTab,
  buildRecordTabBar,
  loadRecordTabsPreference,
  saveRecordTabsPreference
};
