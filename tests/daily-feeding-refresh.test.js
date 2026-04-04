const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('meal-editor and treatment-record notify daily-feeding page to reload after save', () => {
  const mealEditor = fs.readFileSync('miniprogram/pages/meal-editor/index.js', 'utf8');
  const treatmentRecord = fs.readFileSync('miniprogram/pages/treatment-record/index.js', 'utf8');

  assert.match(mealEditor, /notifyPreviousPageRefresh\s*\(/);
  assert.match(mealEditor, /await this\.notifyPreviousPageRefresh\(\);[\s\S]*wx\.navigateBack\(\)/);
  assert.match(mealEditor, /prevPage\.route [!=]==? 'pages\/daily-feeding\/index'/);
  assert.match(mealEditor, /await prevPage\.loadTodayData\(true\)/);

  assert.match(treatmentRecord, /notifyPreviousPageRefresh\s*\(/);
  assert.match(treatmentRecord, /await this\.notifyPreviousPageRefresh\(\);[\s\S]*wx\.navigateBack\(\)/);
  assert.match(treatmentRecord, /prevPage\.route [!=]==? 'pages\/daily-feeding\/index'/);
  assert.match(treatmentRecord, /await prevPage\.loadTodayData\(true\)/);
});
