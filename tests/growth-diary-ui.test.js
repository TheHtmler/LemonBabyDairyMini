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

  const firstRow = dailyWxml.match(/<view class="qrow">[\s\S]*?<\/view>\s*<view class="qrow">/);
  assert.ok(firstRow, 'should have two qrows');
  assert.match(firstRow[0], /记一顿奶/);
  assert.match(firstRow[0], /加食物/);
  assert.match(firstRow[0], /喂药/);
  assert.match(firstRow[0], /治疗/);
  assert.match(firstRow[0], /记尿布/);
  assert.doesNotMatch(firstRow[0], /成长日记/);
  assert.doesNotMatch(firstRow[0], /微信提醒/);

  assert.ok(
    dailyWxml.indexOf('记一顿奶') < dailyWxml.indexOf('量体重')
    && dailyWxml.indexOf('量体重') < dailyWxml.indexOf('成长日记')
    && dailyWxml.indexOf('成长日记') < dailyWxml.indexOf('记备忘')
    && dailyWxml.indexOf('记备忘') < dailyWxml.indexOf('检测报告')
    && dailyWxml.indexOf('检测报告') < dailyWxml.indexOf('微信提醒'),
    'first-screen shortcuts should follow the requested order'
  );
});

test('growth diary requires role modal and publish meta wiring', () => {
  const diaryJs = fs.readFileSync(path.join(__dirname, '../miniprogram/pkg-records/growth-diary/index.js'), 'utf8');
  const diaryWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pkg-records/growth-diary/index.wxml'), 'utf8');
  assert.match(diaryJs, /checkDiaryAccess/);
  assert.match(diaryJs, /accessDenied/);
  assert.match(diaryWxml, /accessDenied/);
  assert.match(diaryJs, /confirmRoleModal/);
  assert.match(diaryJs, /authorDisplayName/);
  assert.match(diaryJs, /formatDiaryPublishMeta/);
  assert.match(diaryJs, /formatDiaryEventAgeText/);
  assert.match(diaryJs, /onShow[\s\S]*ensureAuthorRole/);
  assert.match(diaryWxml, /showRoleModal/);
  assert.match(diaryWxml, /publishMetaText/);
  assert.match(diaryWxml, /eventAgeText/);
  assert.match(diaryWxml, /maxRoleLen/);
});
