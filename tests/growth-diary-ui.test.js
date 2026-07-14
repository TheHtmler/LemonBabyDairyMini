const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const test = require('node:test');

test('growth-records page has no milestone UI and titled 成长曲线', () => {
  const growthWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pkg-records/growth-records/index.wxml'), 'utf8');
  assert.doesNotMatch(growthWxml, /里程碑/);
  const growthJson = fs.readFileSync(path.join(__dirname, '../miniprogram/pkg-records/growth-records/index.json'), 'utf8');
  assert.match(growthJson, /成长曲线/);
});
