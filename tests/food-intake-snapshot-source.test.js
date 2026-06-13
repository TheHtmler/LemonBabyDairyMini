const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('meal editor persists the v2 food snapshot for each intake item', () => {
  const source = readProjectFile('miniprogram/pkg-records/meal-editor/index.js');

  assert.match(source, /foodSnapshot:\s*FoodModel\.buildFoodSnapshot\(food\)/);
  assert.match(source, /foodSnapshot:\s*item\.foodSnapshot\s*\|\|\s*FoodModel\.buildFoodSnapshot\(item\.food/);
});

test('data records food intake flow persists and migrates v2 food snapshots', () => {
  const source = readProjectFile('miniprogram/pages/data-records-v2/index.js');

  assert.match(source, /foodSnapshot:\s*FoodModel\.buildFoodSnapshot\(food\)/);
  assert.match(source, /foodSnapshot:\s*intake\.foodSnapshot\s*\|\|\s*FoodModel\.buildFoodSnapshot\(catalogFood\)/);
});

test('food intake modal and meal editor show food source labels to avoid ambiguity', () => {
  const modalWxml = readProjectFile('miniprogram/components/food-intake-modal/food-intake-modal.wxml');
  const mealEditorWxml = readProjectFile('miniprogram/pkg-records/meal-editor/index.wxml');

  assert.match(modalWxml, /food-option-source/);
  assert.match(mealEditorWxml, /food-option-source/);
});

test('food intake record model normalizes v2 snapshot nutrition basis fields', () => {
  const source = readProjectFile('miniprogram/models/foodIntakeRecord.js');

  assert.match(source, /normalizeNutritionPerBasis/);
  assert.match(source, /nutritionBasis/);
  assert.match(source, /nutritionPerBasis/);
});

test('food selection pages limit rendered options for local system index results', () => {
  const mealEditorSource = readProjectFile('miniprogram/pkg-records/meal-editor/index.js');
  const dataRecordsSource = readProjectFile('miniprogram/pages/data-records-v2/index.js');

  assert.match(mealEditorSource, /FOOD_VISIBLE_LIMIT\s*=\s*50/);
  assert.match(mealEditorSource, /filteredFoodOptions:\s*filtered\.slice\(0,\s*FOOD_VISIBLE_LIMIT\)/);
  assert.match(dataRecordsSource, /FOOD_VISIBLE_LIMIT\s*=\s*50/);
  assert.match(dataRecordsSource, /filteredFoodOptions:\s*filtered\.slice\(0,\s*FOOD_VISIBLE_LIMIT\)/);
  assert.match(dataRecordsSource, /filteredFoodExperimentOptions:\s*filtered\.slice\(0,\s*FOOD_VISIBLE_LIMIT\)/);
});
