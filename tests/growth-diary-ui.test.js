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

test('profile and daily-feeding expose growth diary and curve entries', () => {
  const profileJs = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/profile/index.js'), 'utf8');
  assert.match(profileJs, /\/pkg-records\/growth-diary\/index/);
  assert.match(profileJs, /\/pkg-records\/growth-records\/index/);
  assert.match(profileJs, /成长日记/);
  assert.match(profileJs, /成长曲线/);
  assert.doesNotMatch(profileJs, /成长记录/);

  const dailyWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/daily-feeding/index.wxml'), 'utf8');
  const diaryPathMatches = dailyWxml.match(/\/pkg-records\/growth-diary\/index/g) || [];
  assert.equal(diaryPathMatches.length, 1, 'daily-feeding should have exactly one growth-diary shortcut');
  assert.match(dailyWxml, /成长日记/);
  assert.doesNotMatch(dailyWxml, /情感/);
});
