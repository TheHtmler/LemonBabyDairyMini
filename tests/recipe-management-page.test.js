const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('recipe management page is registered and linked from profile', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  const recordsPackage = appConfig.subPackages.find(item => item.root === 'pkg-records');
  const profileSource = fs.readFileSync('miniprogram/pages/profile/index.js', 'utf8');
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');

  assert.ok(recordsPackage.pages.includes('recipe-management/index'));
  assert.match(profileSource, /\/pkg-records\/recipe-management\/index/);
  assert.match(profileSource, /食谱管理/);
  assert.match(pageSource, /ensureFoodCatalog/);
  assert.match(pageSource, /食物库首次可能要拉系统索引/);
});

test('recipe management supports optional default quantities with preview', () => {
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');
  const templateSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.wxml', 'utf8');

  assert.match(pageSource, /steps:\s*recipe\.steps/);
  assert.match(pageSource, /coverImageFileId:\s*recipe\.coverImageFileId/);
  assert.match(pageSource, /onDefaultQuantityBlur/);
  assert.match(pageSource, /buildDefaultPreview/);
  assert.match(pageSource, /quantity:\s*Math\.max\(0,\s*Number\(item\.quantity\) \|\| 0\)/);
  assert.doesNotMatch(pageSource, /shouldWarnYieldMismatch/);
  assert.doesNotMatch(templateSource, /制作过程/);
  assert.match(templateSource, /原料组合/);
  assert.match(templateSource, /可预填默认份量/);
  assert.match(templateSource, /当前食谱营养成份/);
  assert.match(templateSource, /default-qty-input/);
  assert.match(templateSource, /add-ingredient-bar/);
  assert.match(templateSource, /ingredient-edit-line/);
  assert.match(templateSource, /点上面添加/);
  assert.match(templateSource, /含优质蛋白 \{\{defaultPreview\.premiumProteinText\}\}g/);
  assert.match(pageSource, /summarizePremiumProteinFromIngredients/);
  assert.match(pageSource, /showPremiumProtein:\s*premiumProtein > 0/);
  assert.doesNotMatch(templateSource, /已填 \{\{defaultPreview\.filledCount\}\}/);
  assert.match(pageSource, /输入中只刷新营养预览|defaultPreview:\s*buildDefaultPreview\(previewIngredients\)/);
});

test('recipe management supports soft delete without wiping historical intakes', () => {
  const pageSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.js', 'utf8');
  const templateSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.wxml', 'utf8');

  assert.match(pageSource, /confirmDeleteRecipe/);
  assert.match(pageSource, /onDeleteTap/);
  assert.match(pageSource, /onEditTap/);
  assert.match(pageSource, /openRecipe\([^,]+,\s*'edit'\)/);
  assert.match(pageSource, /RecipeModel\.softDelete/);
  assert.match(pageSource, /不会改已保存的喂养记录|历史那几顿仍按当时快照/);
  assert.match(templateSource, /catalog-edit/);
  assert.match(templateSource, /catalog-delete/);
  assert.match(templateSource, /删除这份食谱/);
  assert.match(templateSource, /已保存的喂养记录仍按当时快照保留/);
  assert.match(templateSource, /list-sticky/);
  assert.match(templateSource, /scroll-view class="list-scroll"/);
});

test('recipe management search bar is lightweight like food management', () => {
  const templateSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.wxml', 'utf8');
  const styleSource = fs.readFileSync('miniprogram/pkg-records/recipe-management/index.wxss', 'utf8');

  assert.match(templateSource, /search-panel/);
  assert.match(templateSource, /search-input-wrap/);
  assert.match(templateSource, /search-icon/);
  assert.match(templateSource, /confirm-type="search"/);
  assert.match(templateSource, /找到 \{\{filteredCount\}\} 道/);
  assert.match(templateSource, /共 \{\{recipeCount\}\} 道/);
  assert.doesNotMatch(templateSource, /search-card|search-label/);
  assert.match(styleSource, /\.search-input-wrap\s*\{/);
  assert.doesNotMatch(styleSource, /\.search-card\s*\{/);
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
  assert.match(pickerTemplate, /回到食谱页可预填默认份量|预填默认份量/);
});
