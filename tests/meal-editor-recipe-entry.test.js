const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function readSource(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

const mealEditorSource = readSource('miniprogram/pkg-records/meal-editor/index.js');
const mealEditorTemplate = readSource('miniprogram/pkg-records/meal-editor/index.wxml');
const recipePickerSource = readSource('miniprogram/pkg-records/recipe-picker/index.js');
const intakeModelSource = readSource('miniprogram/models/foodIntakeRecord.js');

test('meal editor presents food and recipe entry choices', () => {
  assert.match(mealEditorSource, /showAddTypeSheet:\s*false/);
  assert.match(mealEditorSource, /openAddTypeSheet/);
  assert.match(mealEditorSource, /chooseFoodEntry[\s\S]*openFoodDrawer/);
  assert.match(mealEditorSource, /chooseRecipeEntry[\s\S]*\/pkg-records\/recipe-picker\/index/);
  assert.match(mealEditorTemplate, /从食物库选，按克\/毫升记录/);
  assert.match(mealEditorTemplate, /选已做好的菜，按本次吃的克数记营养/);
});

test('recipe picker stores a complete recipe meal selection', () => {
  assert.match(recipePickerSource, /RecipeModel\.listActiveByBaby/);
  assert.match(recipePickerSource, /meal_recipe_picker_selection/);
  assert.match(recipePickerSource, /sourceType:\s*['"]recipe['"]/);
  assert.match(recipePickerSource, /nutritionPer100g/);
  assert.match(recipePickerSource, /ingredientsSnapshot/);
});

test('meal editor merges, saves, reloads and edits recipe rows without foodId', () => {
  assert.match(mealEditorSource, /meal_recipe_picker_selection/);
  assert.match(mealEditorSource, /scaleNutrition/);
  assert.match(mealEditorSource, /if\s*\(item\.sourceType\s*===\s*['"]recipe['"]\)/);
  assert.match(mealEditorSource, /recipeSource:\s*\{/);
  assert.match(mealEditorSource, /foodId:\s*['"]/);
  assert.match(mealEditorSource, /if\s*\(target\.sourceType\s*===\s*['"]recipe['"]\)/);
  assert.match(mealEditorSource, /updateRecipeMealItemQuantity/);
  assert.match(mealEditorSource, /RecipeModel\.touchUsage/);
  assert.doesNotMatch(
    mealEditorSource,
    /foodSnapshot:\s*\{[\s\S]{0,500}sourceType:\s*['"]recipe['"]/
  );
});

test('food intake normalization preserves recipeSource outside foodSnapshot', () => {
  assert.match(intakeModelSource, /function normalizeRecipeSource/);
  assert.match(intakeModelSource, /const recipeSource\s*=\s*normalizeRecipeSource\(record\.recipeSource\)/);
  assert.match(intakeModelSource, /foodSnapshot,\s*\n\s*recipeSource,/);
  assert.match(intakeModelSource, /updateData\.recipeSource\s*=\s*normalizeRecipeSource/);
});
