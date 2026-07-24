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

test('recipe management is a template of foods without recipe quantities', () => {
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');
  const templateSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.wxml', 'utf8');

  assert.match(pageSource, /steps:\s*recipe\.steps/);
  assert.match(pageSource, /coverImageFileId:\s*recipe\.coverImageFileId/);
  assert.doesNotMatch(pageSource, /yieldWeightG/);
  assert.doesNotMatch(pageSource, /onIngredientQuantityInput|shouldWarnYieldMismatch/);
  assert.doesNotMatch(templateSource, /成品总重|配方用量|制作过程/);
  assert.match(templateSource, /原料组合/);
  assert.match(templateSource, /用量在记本顿时填写/);
});

test('recipe ingredients use an isolated food picker selection flow', () => {
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');
  const pickerSource = fs.readFileSync('miniprogram/pkg-records/food-picker/index.js', 'utf8');
  const pickerTemplate = fs.readFileSync('miniprogram/pkg-records/food-picker/index.wxml', 'utf8');

  assert.match(pageSource, /\/pkg-records\/food-picker\/index\?from=recipe-management/);
  assert.match(pageSource, /recipe_ingredient_picker_selection/);
  assert.match(pickerSource, /from === 'recipe-management'/);
  assert.match(pickerSource, /recipe_ingredient_picker_selection/);
  assert.match(pickerSource, /添加到食谱/);
  assert.match(pickerTemplate, /用量在记本顿时填写/);
});
