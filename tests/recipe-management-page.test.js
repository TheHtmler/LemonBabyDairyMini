const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('recipe management page is registered and linked from profile', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  const recordsPackage = appConfig.subPackages.find(item => item.root === 'pkg-records');
  const profileSource = fs.readFileSync('miniprogram/pages/profile/index.js', 'utf8');

  assert.ok(recordsPackage.pages.includes('recipe-management/index'));
  assert.match(profileSource, /\/pkg-records\/recipe-management\/index/);
  assert.match(profileSource, /食谱管理/);
});

test('recipe management implements yield weight without exposing steps UI', () => {
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');
  const templateSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.wxml', 'utf8');

  assert.match(pageSource, /yieldWeightG/);
  assert.match(pageSource, /shouldWarnYieldMismatch/);
  assert.match(pageSource, /steps:\s*\[\]/);
  assert.doesNotMatch(templateSource, /制作过程|bindinput="onStep|steps\}\}/);
});

test('recipe ingredients use an isolated food picker selection flow', () => {
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');
  const pickerSource = fs.readFileSync('miniprogram/pkg-records/food-picker/index.js', 'utf8');

  assert.match(pageSource, /\/pkg-records\/food-picker\/index\?from=recipe-management/);
  assert.match(pageSource, /recipe_ingredient_picker_selection/);
  assert.match(pickerSource, /from=recipe-management|recipe-management/);
  assert.match(pickerSource, /recipe_ingredient_picker_selection/);
});
