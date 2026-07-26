const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_TIMELINE_FILTER_TABS,
  DEFAULT_PINNED_KEYS,
  DEFAULT_ORDERED_KEYS,
  normalizeTimelineTabsPreference,
  buildTimelineTabBar,
  moveOrderedTab,
  togglePinnedTab,
  loadTimelineTabsPreference,
  saveTimelineTabsPreference
} = require('../miniprogram/utils/timelineTabsPreference');

test('default pins milk/food/med/bowel and puts rest in more', () => {
  const prefs = normalizeTimelineTabsPreference();
  assert.deepEqual(prefs.pinnedKeys, DEFAULT_PINNED_KEYS);
  assert.deepEqual(prefs.orderedKeys, DEFAULT_ORDERED_KEYS);
  assert.equal(ALL_TIMELINE_FILTER_TABS.length, 7);

  const bar = buildTimelineTabBar(prefs, 'all');
  assert.deepEqual(bar.visibleTabs.map((t) => t.key), ['all', 'milk', 'food', 'med', 'bowel']);
  assert.deepEqual(bar.moreTabs.map((t) => t.key), ['treatment', 'water', 'sleep']);
  assert.equal(bar.showMoreEntry, true);
});

test('normalize fills missing tabs and drops unknown keys', () => {
  const prefs = normalizeTimelineTabsPreference({
    orderedKeys: ['sleep', 'milk', 'unknown'],
    pinnedKeys: ['sleep', 'ghost']
  });
  assert.equal(prefs.orderedKeys[0], 'sleep');
  assert.equal(prefs.orderedKeys[1], 'milk');
  assert.equal(prefs.orderedKeys.includes('food'), true);
  assert.equal(prefs.orderedKeys.includes('unknown'), false);
  assert.deepEqual(prefs.pinnedKeys, ['sleep']);
});

test('moveOrderedTab and togglePinnedTab update prefs', () => {
  let prefs = normalizeTimelineTabsPreference();
  prefs = moveOrderedTab(prefs, 'water', -1);
  assert.ok(prefs.orderedKeys.indexOf('water') < prefs.orderedKeys.indexOf('sleep'));

  prefs = togglePinnedTab(prefs, 'water');
  assert.equal(prefs.pinnedKeys.includes('water'), true);
  prefs = togglePinnedTab(prefs, 'milk');
  assert.equal(prefs.pinnedKeys.includes('milk'), false);
});

test('buildTimelineTabBar surfaces active more-tab into visible row', () => {
  const prefs = normalizeTimelineTabsPreference();
  const bar = buildTimelineTabBar(prefs, 'sleep');
  assert.equal(bar.activeTab, 'sleep');
  assert.ok(bar.visibleTabs.some((t) => t.key === 'sleep'));
  assert.equal(bar.moreTabs.some((t) => t.key === 'sleep'), false);
});

test('load/save roundtrip with storage mock', () => {
  const memory = {};
  const storage = {
    getStorageSync(key) { return memory[key]; },
    setStorageSync(key, value) { memory[key] = value; }
  };
  const saved = saveTimelineTabsPreference({
    orderedKeys: ['sleep', 'milk', 'food', 'med', 'bowel', 'treatment', 'water'],
    pinnedKeys: ['sleep', 'milk']
  }, storage);
  const loaded = loadTimelineTabsPreference(storage);
  assert.deepEqual(loaded, saved);
  assert.deepEqual(loaded.pinnedKeys, ['sleep', 'milk']);
});
