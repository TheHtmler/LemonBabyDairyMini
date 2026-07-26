const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sleep-record page has start/end pickers and save flow', () => {
  const dir = path.join(__dirname, '..', 'miniprogram', 'pkg-records', 'sleep-record');
  const js = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8');

  assert.match(js, /SleepRecordModel/);
  assert.match(js, /startTime/);
  assert.match(js, /endTime/);
  assert.match(js, /findOngoing/);
  assert.match(wxml, /开始/);
  assert.match(wxml, /结束/);
  assert.match(wxml, /备注/);
});

test('sleep-record page is registered in app.json', () => {
  const appConfig = require('../miniprogram/app.json');
  const recordsPackage = appConfig.subPackages.find(item => item.root === 'pkg-records');

  assert.ok(recordsPackage);
  assert.ok(recordsPackage.pages.includes('sleep-record/index'));
});
