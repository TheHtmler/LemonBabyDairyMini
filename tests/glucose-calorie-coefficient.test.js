const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('treatment record page lets users switch glucose calorie coefficient and recalculates', () => {
  const js = fs.readFileSync('miniprogram/pkg-records/treatment-record/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pkg-records/treatment-record/index.wxml', 'utf8');

  assert.match(js, /deriveTreatmentItemNutrition\(item, this\.data\.glucoseCalorieCoefficient\)/);
  assert.match(js, /async onGlucoseCoefficientTap\(e\)/);
  assert.match(js, /applyGlucoseCalorieCoefficient\(nextCoefficient\)/);
  assert.match(js, /await saveGlucoseCalorieCoefficient\(getBabyUid\(\), nextCoefficient\)/);
  assert.match(js, /glucoseCalorieCoefficient: this\.data\.glucoseCalorieCoefficient/);
  assert.match(js, /isValidGlucoseCalorieCoefficient\(record\.glucoseCalorieCoefficient\)/);
  assert.match(js, /DEFAULT_GLUCOSE_CALORIE_COEFFICIENT/);
  assert.doesNotMatch(js, /carbsG \* 3\.4/);

  assert.match(wxml, /葡萄糖热量换算/);
  assert.match(wxml, /bindtap="onGlucoseCoefficientTap"/);
  assert.match(wxml, /\{\{glucoseCalorieNote\}\}/);
  assert.doesNotMatch(wxml, /1 g 葡萄糖约 3\.4 kcal/);
});

test('emergency support calculator shares the same glucose calorie coefficient', () => {
  const js = fs.readFileSync('miniprogram/pkg-misc/emergency-support/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pkg-misc/emergency-support/index.wxml', 'utf8');

  assert.match(js, /calculateDextroseFluidCalories\(/);
  assert.match(js, /coefficient: this\.data\.glucoseCalorieCoefficient/);
  assert.match(js, /async onGlucoseCoefficientTap\(e\)/);
  assert.match(js, /applyGlucoseCalorieCoefficient\(nextCoefficient, \{ persist: true \}\)/);
  assert.doesNotMatch(js, /dextroseGrams \* 3\.4/);
  assert.doesNotMatch(js, /concentration \* 0\.034/);

  assert.match(wxml, /热量换算标准/);
  assert.match(wxml, /bindtap="onGlucoseCoefficientTap"/);
  assert.match(wxml, /葡萄糖克数 × \{\{glucoseCalorieCoefficient\}\}/);
  assert.match(wxml, /肠外营养常用 3\.4，口服碳水常用 4/);
});

test('treatment record model persists the glucose calorie coefficient used for the record', () => {
  const js = fs.readFileSync('miniprogram/models/treatmentRecord.js', 'utf8');
  assert.match(js, /glucoseCalorieCoefficient: normalizeGlucoseCalorieCoefficient\(data\.glucoseCalorieCoefficient\)/);
});
