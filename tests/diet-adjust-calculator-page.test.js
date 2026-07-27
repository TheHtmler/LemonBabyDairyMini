const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('diet adjust calculator page does not cross-require pkg-milk modules', () => {
  const source = fs.readFileSync(
    path.join(root, 'miniprogram/pkg-misc/diet-adjust-calculator/index.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /require\(['"][^'"]*pkg-milk[^'"]*['"]\)/);
  assert.match(source, /powder_catalog/);
});

test('diet adjust calculator page exposes solver and overwrite flow', () => {
  const pagePath = path.join(root, 'miniprogram/pkg-misc/diet-adjust-calculator/index.js');
  assert.equal(fs.existsSync(pagePath), true, 'wizard page should exist');
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /solveDietAdjust/);
  assert.match(source, /useProteinTarget/);
  assert.match(source, /useCalorieTarget/);
  assert.match(source, /primaryMode/);
  assert.match(source, /showAddMilkPanel/);
  assert.match(source, /diet-adjust/);
  assert.match(source, /DIET_ADJUST_FOOD_PICKER_SELECTION_KEY|diet_adjust_food_picker_selection/);
  assert.doesNotMatch(source, /FOOD_SELECT_LIMIT/);
  assert.match(source, /deleteRecord/);
  assert.match(source, /softDeleteFoodIntake/);
});

test('diet adjust calculator wxml uses milk cart, food picker and item nutrition', () => {
  const wxml = fs.readFileSync(
    path.join(root, 'miniprogram/pkg-misc/diet-adjust-calculator/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /<slider/);
  assert.match(wxml, /能量粉|add-milk/);
  assert.match(wxml, /算一算/);
  assert.match(wxml, /showAddMilkPanel/);
  assert.match(wxml, /添加食物|openFoodPicker/);
  assert.match(wxml, /item\.nutrition/);
  assert.match(wxml, /营养汇总/);
  assert.match(wxml, /为主/);
});

test('food picker supports diet-adjust selection-only mode', () => {
  const source = fs.readFileSync(
    path.join(root, 'miniprogram/pkg-records/food-picker/index.js'),
    'utf8'
  );
  assert.match(source, /diet-adjust/);
  assert.match(source, /DIET_ADJUST_FOOD_PICKER_SELECTION_KEY/);
  assert.match(source, /isDietAdjustPicker/);
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
