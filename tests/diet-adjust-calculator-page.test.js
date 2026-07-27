const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('diet adjust calculator page exposes solver and overwrite flow', () => {
  const pagePath = path.join(root, 'miniprogram/pkg-misc/diet-adjust-calculator/index.js');
  assert.equal(fs.existsSync(pagePath), true, 'wizard page should exist');
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /solveDietAdjust/);
  assert.match(source, /energyPowders|selectedEnergyPowders/);
  assert.match(source, /onMilkRatioChanging/);
  assert.match(source, /openPicker/);
  assert.match(source, /getDefaultMacroRatioRangesByBirthday/);
  assert.match(source, /deleteRecord/);
  assert.match(source, /softDeleteFoodIntake/);
});

test('diet adjust calculator wxml uses slider, searchable picker and ratio summary', () => {
  const wxml = fs.readFileSync(
    path.join(root, 'miniprogram/pkg-misc/diet-adjust-calculator/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /<slider/);
  assert.match(wxml, /能量粉/);
  assert.match(wxml, /算一算/);
  assert.match(wxml, /openPicker/);
  assert.match(wxml, /pickerKeyword|输入名称搜索/);
  assert.match(wxml, /营养汇总/);
  assert.match(wxml, /比例对照/);
  assert.match(wxml, /优质蛋白占总蛋白/);
});

test('profile menu exposes diet adjust calculator entry', () => {
  const source = fs.readFileSync(
    path.join(root, 'miniprogram/pages/profile/index.js'),
    'utf8'
  );
  assert.match(source, /饮食调整换算/);
});

test('pkg-misc registers diet adjust calculator page', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8')
  );
  const pkgMisc = appConfig.subPackages.find((item) => item.root === 'pkg-misc');
  assert.ok(pkgMisc);
  assert.ok(pkgMisc.pages.includes('diet-adjust-calculator/index'));
});
