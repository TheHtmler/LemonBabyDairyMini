const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageDir = path.join(__dirname, '..', 'miniprogram', 'pages', 'data-records-v2');

test('data records page shows all tabs and customize order without more sheet', () => {
  const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8');

  assert.match(wxml, /recordTabs/);
  assert.match(wxml, /openRecordTabCustomizeSheet/);
  assert.match(wxml, /images\/icons\/sort\.svg/);
  assert.match(wxml, /saveRecordTabCustomize/);
  assert.doesNotMatch(wxml, /openRecordTabMoreSheet/);
  assert.doesNotMatch(wxml, />更多</);
  assert.match(js, /recordTabsPreference/);
  assert.match(js, /loadRecordTabsPreference/);
  assert.match(js, /saveRecordTabsPreference/);
  assert.match(js, /applyRecordTabBar/);
  assert.match(js, /moveOrderedTab/);
});
