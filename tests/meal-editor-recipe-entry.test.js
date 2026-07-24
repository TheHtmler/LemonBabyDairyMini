const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const mealEditorPath = path.join('miniprogram', 'pkg-records', 'meal-editor', 'index.js');
const mealEditorWxmlPath = path.join('miniprogram', 'pkg-records', 'meal-editor', 'index.wxml');
const recipePickerPath = path.join('miniprogram', 'pkg-records', 'recipe-picker', 'index.js');
const recipePickerWxmlPath = path.join('miniprogram', 'pkg-records', 'recipe-picker', 'index.wxml');
const foodIntakePath = path.join('miniprogram', 'models', 'foodIntakeRecord.js');

test('meal editor presents food and recipe entry choices', () => {
  const pageSource = fs.readFileSync(mealEditorPath, 'utf8');
  const templateSource = fs.readFileSync(mealEditorWxmlPath, 'utf8');

  assert.match(pageSource, /showAddTypeSheet/);
  assert.match(pageSource, /openAddTypeSheet/);
  assert.match(pageSource, /chooseFoodEntry/);
  assert.match(pageSource, /chooseRecipeEntry/);
  assert.match(pageSource, /\/pkg-records\/recipe-picker\/index/);
  assert.match(templateSource, /食物/);
  assert.match(templateSource, /食谱/);
});

test('recipe picker collects batch ingredient amounts and intake percent or grams', () => {
  const pickerSource = fs.readFileSync(recipePickerPath, 'utf8');
  const pickerTemplate = fs.readFileSync(recipePickerWxmlPath, 'utf8');
  const batchPath = path.join(__dirname, '..', 'miniprogram/pkg-records/recipe-batch/index.js');
  const batchTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/pkg-records/recipe-batch/index.wxml'),
    'utf8'
  );
  const batchSource = fs.readFileSync(batchPath, 'utf8');
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram/app.json'), 'utf8'));
  const recordsPackage = appJson.subPackages.find((item) => item.root === 'pkg-records');

  assert.ok(recordsPackage.pages.includes('recipe-batch/index'));
  assert.match(pickerSource, /\/pkg-records\/recipe-batch\/index/);
  assert.match(pickerSource, /recipeCount/);
  assert.match(pickerTemplate, /recipeCount/);
  assert.doesNotMatch(pickerTemplate, /本次原料用量/);

  assert.match(batchSource, /meal_recipe_picker_selection/);
  assert.match(batchSource, /summarizeBatchFromIngredients/);
  assert.match(batchSource, /resolveBatchIntake/);
  assert.match(batchSource, /intakeMode/);
  assert.match(batchSource, /batchWeightG/);
  assert.match(batchSource, /ingredientsSnapshot/);
  assert.match(batchSource, /navigateBack\(\{\s*delta:\s*2\s*\}\)/);
  assert.match(batchTemplate, /原料用量/);
  assert.match(batchTemplate, /按百分比/);
  assert.match(batchTemplate, /按克数/);
  assert.match(batchTemplate, /summary-card/);
  assert.match(batchTemplate, /per100Label|100/);
  assert.match(batchSource, /intakeMode:\s*canUseGramsIntake\s*\?\s*'grams'\s*:\s*'percent'/);
  assert.match(batchSource, /buildPer100Display|100/);
  assert.match(batchSource, /buildCurrentNutritionDisplay/);
  assert.match(batchSource, /refreshIntakePreview/);
  assert.match(batchTemplate, /实际摄入|intakePreview/);
  assert.match(
    fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pkg-records/recipe-batch/index.wxss'), 'utf8'),
    /margin:\s*0\s*!important/
  );
});

test('meal editor merges, saves, reloads and edits recipe rows without foodId', () => {
  const pageSource = fs.readFileSync(mealEditorPath, 'utf8');

  assert.match(pageSource, /handleRecipePickerSelection/);
  assert.match(pageSource, /meal_recipe_picker_selection/);
  assert.match(pageSource, /sourceType:\s*'recipe'/);
  assert.match(pageSource, /recipeSource/);
  assert.match(pageSource, /batchNutrition/);
  assert.match(pageSource, /updateRecipeMealItemQuantity/);
  assert.match(pageSource, /drawerStep:\s*'recipe-edit'/);
  assert.match(pageSource, /foodId:\s*''/);
  const recipeUpdateStart = pageSource.indexOf('updateRecipeMealItemQuantity(target, quantity');
  const recipeUpdateEnd = pageSource.indexOf('addOrUpdateRecipeMealItem', recipeUpdateStart);
  const recipeUpdateBody = pageSource.slice(recipeUpdateStart, recipeUpdateEnd);
  assert.match(recipeUpdateBody, /batchNutrition|nutritionPer100g/);
  assert.doesNotMatch(recipeUpdateBody, /请选择食物/);
});

test('food intake normalization preserves recipeSource outside foodSnapshot', () => {
  const modelSource = fs.readFileSync(foodIntakePath, 'utf8');

  assert.match(modelSource, /normalizeRecipeSource/);
  assert.match(modelSource, /batchWeightG/);
  assert.match(modelSource, /intakeMode/);
  assert.match(modelSource, /intakePercent/);
  assert.match(modelSource, /recipeSource/);
  assert.match(modelSource, /delete foodSnapshot\.sourceType/);
});
