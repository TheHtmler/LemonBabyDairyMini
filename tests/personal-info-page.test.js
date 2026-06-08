const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('profile menu exposes personal info entry', () => {
  const source = readProjectFile('miniprogram/pages/profile/index.js');

  assert.match(source, /name:\s*'个人信息'/);
  assert.match(source, /path:\s*'\/pkg-misc\/personal-info\/index'/);
  assert.match(source, /查看身份、展示名称与账号状态/);
});

test('personal info page is registered and supports identity editing and status copy', () => {
  const appJson = JSON.parse(readProjectFile('miniprogram/app.json'));
  const miscPackage = appJson.subPackages.find((item) => item.root === 'pkg-misc');

  assert.ok(miscPackage.pages.includes('personal-info/index'));

  const js = readProjectFile('miniprogram/pkg-misc/personal-info/index.js');
  const wxml = readProjectFile('miniprogram/pkg-misc/personal-info/index.wxml');

  assert.match(js, /loadPersonalInfo/);
  assert.match(js, /saveDisplayName/);
  assert.match(js, /copyAccountStatus/);
  assert.match(js, /baby_creators/);
  assert.match(js, /baby_participants/);
  assert.match(wxml, /当前身份/);
  assert.match(wxml, /展示名称/);
  assert.match(wxml, /宝宝名称/);
  assert.match(wxml, /创建者/);
  assert.match(wxml, /参与者/);
  assert.match(wxml, /排查标识/);
  assert.match(wxml, /当前页面/);
  assert.match(wxml, /设备信息/);
  assert.match(wxml, /复制账号状态/);
});

test('cached babyInfo includes creator and participants info snapshots', () => {
  const source = readProjectFile('miniprogram/app.js');

  assert.match(source, /resolveBabyCaregiverInfo/);
  assert.match(source, /creatorInfo/);
  assert.match(source, /participantsInfo/);
  assert.match(source, /baby_creators/);
  assert.match(source, /baby_participants/);
  assert.match(source, /wx\.setStorageSync\('baby_info', normalizedBabyInfo\)/);
});

test('logout keeps persisted baby records intact', () => {
  const source = readProjectFile('miniprogram/pages/profile/index.js');

  assert.doesNotMatch(source, /collection\('feeding_records'\)[\s\S]{0,120}\.remove\(/);
  assert.doesNotMatch(source, /collection\('medication_records'\)[\s\S]{0,120}\.remove\(/);
  assert.doesNotMatch(source, /collection\('baby_info'\)[\s\S]{0,160}\.remove\(/);
});
