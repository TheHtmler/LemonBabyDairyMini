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

test('data records v2 food actions use food_intake_records as the write surface', () => {
  const source = readProjectFile('miniprogram/pages/data-records-v2/index.js');

  assert.match(source, /FoodIntakeRecordModel\.createFoodIntake\(/);
  assert.match(source, /FoodIntakeRecordModel\.softDeleteFoodIntake\(/);
  assert.match(source, /FoodIntakeRecordModel\.deleteMealBatch\(/);
  assert.match(source, /FoodIntakeRecordModel\.findByDate\(babyUid,\s*sourceDateStr\)/);
  assert.doesNotMatch(source, /食物全部走 v1/);
  assert.doesNotMatch(source, /intakes:\s*updatedIntakes/);
});

test('food selection pages handle local system index results in the right surface', () => {
  const foodPickerSource = readProjectFile('miniprogram/pkg-records/food-picker/index.js');
  const dataRecordsSource = readProjectFile('miniprogram/pages/data-records-v2/index.js');

  assert.match(foodPickerSource, /this\.filteredFoodOptions\s*=\s*baseList\.map\(food\s*=>/);
  assert.match(foodPickerSource, /visibleFoodOptions:\s*list\.slice\(start,\s*end\)/);
  assert.doesNotMatch(foodPickerSource, /FOOD_VISIBLE_LIMIT/);
  assert.doesNotMatch(dataRecordsSource, /FOOD_VISIBLE_LIMIT/);
  assert.match(dataRecordsSource, /preferLocalSystemIndex:\s*true/);
  assert.match(dataRecordsSource, /hasMoreFilteredFoodOptions/);
  assert.match(dataRecordsSource, /hasMoreFoodExperimentOptions/);
});
