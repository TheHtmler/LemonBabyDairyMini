const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_RECORD_TABS,
  DEFAULT_ORDERED_KEYS,
  normalizeRecordTabsPreference,
  getVisibleTabs,
  moveOrderedTab,
  buildRecordTabBar
} = require('../miniprogram/utils/recordTabsPreference');

test('default preference shows all tabs in default order', () => {
  const prefs = normalizeRecordTabsPreference();
  assert.deepEqual(prefs.orderedKeys, DEFAULT_ORDERED_KEYS);
  assert.deepEqual(
    getVisibleTabs(prefs).map((item) => item.key),
    DEFAULT_ORDERED_KEYS
  );
  assert.equal(ALL_RECORD_TABS.length, 7);
});

test('normalize migrates legacy pinnedKeys and fills missing tabs', () => {
  const prefs = normalizeRecordTabsPreference({
    pinnedKeys: ['water', 'feeding', 'unknown']
  });
  assert.deepEqual(prefs.orderedKeys[0], 'water');
  assert.deepEqual(prefs.orderedKeys[1], 'feeding');
  assert.equal(prefs.orderedKeys.includes('food'), true);
  assert.equal(prefs.orderedKeys.length, 7);
});

test('moveOrderedTab reorders visible tabs', () => {
  let prefs = normalizeRecordTabsPreference();
  prefs = moveOrderedTab(prefs, 'water', -1);
  assert.equal(prefs.orderedKeys[prefs.orderedKeys.length - 1], 'sleep');
  assert.equal(prefs.orderedKeys[prefs.orderedKeys.length - 2], 'bowel');
  assert.equal(prefs.orderedKeys[prefs.orderedKeys.length - 3], 'water');
});

test('buildRecordTabBar exposes full visible tabs without more overflow', () => {
  const prefs = normalizeRecordTabsPreference({
    orderedKeys: ['water', 'feeding', 'food', 'medication', 'treatment', 'bowel', 'sleep']
  });
  const bar = buildRecordTabBar(prefs, 'water');
  assert.deepEqual(bar.visibleTabs.map((item) => item.key), prefs.orderedKeys);
  assert.equal(bar.activeTab, 'water');
  assert.equal(bar.moreTabs, undefined);
});
