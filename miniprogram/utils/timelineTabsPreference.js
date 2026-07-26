/**
 * 首页「今日时间轴」筛选 Tab 偏好（仅本地存储）
 * - 「全部」始终固定在首位，不参与排序/常驻配置
 * - pinnedKeys：常驻显示；其余进入「更多」
 */

const STORAGE_KEY = 'timeline_tabs_prefs_v1';

const ALL_TAB = { key: 'all', label: '全部' };

/** 可配置的筛选分类（不含全部） */
const ALL_TIMELINE_FILTER_TABS = [
  { key: 'milk', label: '喂奶' },
  { key: 'food', label: '辅食' },
  { key: 'med', label: '用药' },
  { key: 'treatment', label: '治疗' },
  { key: 'bowel', label: '尿布' },
  { key: 'water', label: '喝水' },
  { key: 'sleep', label: '睡眠' }
];

const DEFAULT_ORDERED_KEYS = ALL_TIMELINE_FILTER_TABS.map((item) => item.key);
const DEFAULT_PINNED_KEYS = ['milk', 'food', 'med', 'bowel'];

const TAB_MAP = ALL_TIMELINE_FILTER_TABS.reduce((map, item) => {
  map[item.key] = item;
  return map;
}, {});

function clonePrefs(prefs = {}) {
  return {
    orderedKeys: Array.isArray(prefs.orderedKeys) ? prefs.orderedKeys.slice() : [],
    pinnedKeys: Array.isArray(prefs.pinnedKeys) ? prefs.pinnedKeys.slice() : []
  };
}

function normalizeTimelineTabsPreference(raw = {}) {
  const seen = new Set();
  const orderedKeys = [];
  const sourceKeys = Array.isArray(raw.orderedKeys) && raw.orderedKeys.length > 0
    ? raw.orderedKeys
    : DEFAULT_ORDERED_KEYS;

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

  const pinnedSeen = new Set();
  const pinnedSource = Array.isArray(raw.pinnedKeys) ? raw.pinnedKeys : DEFAULT_PINNED_KEYS;
  const pinnedKeys = [];
  pinnedSource.forEach((key) => {
    if (!TAB_MAP[key] || pinnedSeen.has(key) || !orderedKeys.includes(key)) return;
    pinnedSeen.add(key);
    pinnedKeys.push(key);
  });

  // 若用户把常驻全部关掉，至少保留默认常驻中仍存在的项，避免主栏只剩「全部」
  if (pinnedKeys.length === 0) {
    DEFAULT_PINNED_KEYS.forEach((key) => {
      if (orderedKeys.includes(key) && !pinnedSeen.has(key)) {
        pinnedSeen.add(key);
        pinnedKeys.push(key);
      }
    });
  }

  // 常驻顺序跟随 orderedKeys
  pinnedKeys.sort((a, b) => orderedKeys.indexOf(a) - orderedKeys.indexOf(b));

  return { orderedKeys, pinnedKeys };
}

function moveOrderedTab(prefs = {}, key, offset = 0) {
  const next = clonePrefs(normalizeTimelineTabsPreference(prefs));
  const index = next.orderedKeys.indexOf(key);
  if (index < 0 || !Number.isFinite(offset) || offset === 0) return next;
  const target = index + offset;
  if (target < 0 || target >= next.orderedKeys.length) return next;
  const [item] = next.orderedKeys.splice(index, 1);
  next.orderedKeys.splice(target, 0, item);
  next.pinnedKeys.sort((a, b) => next.orderedKeys.indexOf(a) - next.orderedKeys.indexOf(b));
  return next;
}

function togglePinnedTab(prefs = {}, key) {
  const next = clonePrefs(normalizeTimelineTabsPreference(prefs));
  if (!TAB_MAP[key]) return next;
  const index = next.pinnedKeys.indexOf(key);
  if (index >= 0) {
    // 不允许取消最后一个常驻
    if (next.pinnedKeys.length <= 1) return next;
    next.pinnedKeys.splice(index, 1);
  } else {
    next.pinnedKeys.push(key);
    next.pinnedKeys.sort((a, b) => next.orderedKeys.indexOf(a) - next.orderedKeys.indexOf(b));
  }
  return next;
}

function buildTimelineTabBar(prefs = {}, activeTab = 'all') {
  const normalized = normalizeTimelineTabsPreference(prefs);
  const pinnedSet = new Set(normalized.pinnedKeys);
  const pinnedTabs = normalized.pinnedKeys.map((key) => TAB_MAP[key]).filter(Boolean);
  const moreTabs = normalized.orderedKeys
    .filter((key) => !pinnedSet.has(key))
    .map((key) => TAB_MAP[key])
    .filter(Boolean);

  const activeKey = activeTab === 'all' || TAB_MAP[activeTab] ? activeTab : 'all';
  const visibleTabs = [ALL_TAB, ...pinnedTabs];

  // 当前选中落在「更多」时，临时挂到主栏，便于看到筛选项
  if (activeKey !== 'all' && !pinnedSet.has(activeKey) && TAB_MAP[activeKey]) {
    visibleTabs.push(TAB_MAP[activeKey]);
  }

  const displayMoreTabs = moreTabs.filter((tab) => tab.key !== activeKey);

  return {
    prefs: normalized,
    visibleTabs,
    moreTabs: displayMoreTabs,
    showMoreEntry: moreTabs.length > 0,
    activeTab: activeKey,
    customizeTabs: normalized.orderedKeys.map((key) => ({
      ...TAB_MAP[key],
      pinned: pinnedSet.has(key)
    }))
  };
}

function loadTimelineTabsPreference(storage = null) {
  try {
    const store = storage || (typeof wx !== 'undefined' ? wx : null);
    const raw = store && typeof store.getStorageSync === 'function'
      ? store.getStorageSync(STORAGE_KEY)
      : null;
    return normalizeTimelineTabsPreference(raw || {});
  } catch (error) {
    return normalizeTimelineTabsPreference();
  }
}

function saveTimelineTabsPreference(prefs, storage = null) {
  const normalized = normalizeTimelineTabsPreference(prefs);
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

module.exports = {
  STORAGE_KEY,
  ALL_TAB,
  ALL_TIMELINE_FILTER_TABS,
  DEFAULT_ORDERED_KEYS,
  DEFAULT_PINNED_KEYS,
  normalizeTimelineTabsPreference,
  moveOrderedTab,
  togglePinnedTab,
  buildTimelineTabBar,
  loadTimelineTabsPreference,
  saveTimelineTabsPreference
};
