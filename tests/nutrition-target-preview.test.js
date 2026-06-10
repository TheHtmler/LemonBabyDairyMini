const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  buildEntryTargetPreview,
  summarizeFoodItems,
  summarizeTreatmentGroups
} = require('../miniprogram/utils/nutritionTargetPreview');

test('buildEntryTargetPreview computes after-save protein status and subtracts previous edit value', () => {
  const preview = buildEntryTargetPreview({
    currentSummary: {
      naturalProtein: 5,
      specialProtein: 1,
      calories: 420
    },
    draftSummary: {
      naturalProtein: 1.4,
      specialProtein: 0.2,
      calories: 90
    },
    previousSummary: {
      naturalProtein: 1,
      specialProtein: 0,
      calories: 60
    },
    weight: 4,
    targetPreferences: {
      naturalProteinCoefficient: 1.2,
      specialProteinCoefficient: 0.8,
      calorieCoefficient: 120
    }
  });

  const natural = preview.proteinRows.find(row => row.key === 'naturalProtein');
  const special = preview.proteinRows.find(row => row.key === 'specialProtein');

  assert.equal(natural.actual, 5.4);
  assert.equal(natural.target, 4.8);
  assert.equal(natural.status, 'over');
  assert.equal(natural.badgeText, '超出 0.6g');
  assert.equal(natural.draftText, '本次 +1.4g');
  assert.equal(natural.actionText, '仍然保存');

  assert.equal(special.actual, 1.2);
  assert.equal(special.target, 3.2);
  assert.equal(special.status, 'ok');
  assert.equal(special.badgeText, '还差 2g');
  assert.equal(preview.hasOverProtein, true);
});

test('buildEntryTargetPreview keeps calorie as optional weak reminder', () => {
  const hidden = buildEntryTargetPreview({
    currentSummary: { naturalProtein: 1, specialProtein: 0, calories: 100 },
    draftSummary: { naturalProtein: 0.2, specialProtein: 0, calories: 30 },
    weight: 5,
    targetPreferences: {
      naturalProteinCoefficient: 1.2,
      specialProteinCoefficient: 0.6,
      calorieCoefficient: 100
    },
    includeCalories: false
  });
  assert.equal(hidden.calorieNote.visible, false);

  const visible = buildEntryTargetPreview({
    currentSummary: { naturalProtein: 1, specialProtein: 0, calories: 470 },
    draftSummary: { naturalProtein: 0.2, specialProtein: 0, calories: 50 },
    weight: 5,
    targetPreferences: {
      naturalProteinCoefficient: 1.2,
      specialProteinCoefficient: 0.6,
      calorieCoefficient: 100
    },
    includeCalories: true
  });

  assert.equal(visible.calorieNote.visible, true);
  assert.equal(visible.calorieNote.status, 'over');
  assert.equal(visible.calorieNote.badgeText, '超出 20kcal');
  assert.equal(visible.calorieNote.text, '本次 +50 kcal · 今日超出 20 kcal');
});

test('summarizeFoodItems preserves natural and special protein split', () => {
  const summary = summarizeFoodItems([
    {
      nutrition: { calories: 40, protein: 1, carbs: 5, fat: 1 },
      naturalProtein: 1,
      specialProtein: 0
    },
    {
      nutrition: { calories: 30, protein: 0.5, carbs: 4, fat: 0.5 },
      naturalProtein: 0,
      specialProtein: 0.5
    }
  ]);

  assert.deepEqual(summary, {
    calories: 70,
    protein: 1.5,
    naturalProtein: 1,
    specialProtein: 0.5,
    carbs: 9,
    fat: 1.5
  });
});

test('summarizeTreatmentGroups contributes calories but not natural or special protein', () => {
  const summary = summarizeTreatmentGroups([
    {
      items: [
        { countInNutrition: true, calories: 17, carbsG: 5, proteinG: 0, fatG: 0 },
        { countInNutrition: false, calories: 999, carbsG: 999, proteinG: 999, fatG: 999 }
      ]
    }
  ]);

  assert.deepEqual(summary, {
    calories: 17,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    carbs: 5,
    fat: 0
  });
});

test('meal editor food drawer keeps add button reachable after target preview expands content', () => {
  const wxss = fs.readFileSync('miniprogram/pkg-records/meal-editor/index.wxss', 'utf8');

  assert.match(wxss, /\.drawer-body\s*\{[^}]*flex:\s*1/s);
  assert.match(wxss, /\.drawer-body\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(wxss, /\.edit-body\s*\{[^}]*min-height:\s*0/s);
  assert.match(wxss, /\.add-item-btn\s*\{[^}]*position:\s*sticky/s);
  assert.match(wxss, /\.add-item-btn\s*\{[^}]*bottom:\s*0/s);
});

test('milk feeding editor keeps concentrated input layout without changing entry calculation flow', () => {
  const wxml = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml', 'utf8');

  assert.match(wxml, /class="page v2-page focused-feeding-page"/);
  assert.match(wxml, /class="feeding-hero"/);
  assert.match(wxml, /class="feeding-summary-strip"/);
  assert.doesNotMatch(wxml, /class="feeding-summary-strip" bindtap="navigateToGoalPlanner"/);
  assert.doesNotMatch(wxml, /class="hero-control-row"/);
  assert.match(wxml, /class="hero-action-pill" bindtap="navigateToGoalPlanner"/);
  assert.match(wxml, /class="hero-time-wrap"/);
  assert.match(wxml, /今日已喝 \{\{existingRecords\.length\}\} 顿/);
  assert.doesNotMatch(wxml, /class="feeding-summary-mark">🍼/);
  assert.doesNotMatch(wxml, /class="workbench-title-icon">🍼/);
  assert.doesNotMatch(wxml, /热量余量/);
  assert.doesNotMatch(wxml, /goalPreview\.remainingAfter/);
  assert.doesNotMatch(wxml, /compact-goal-entry/);
  assert.doesNotMatch(wxml, /先选奶源，再填这顿实际喝到的量/);
  assert.match(wxml, /class="add-source-button" bindtap="addMilkEntry"/);
  assert.match(wxml, /class="workbench-title-actions"/);
  assert.doesNotMatch(wxml, /class="source-chip source-chip-breast/);
  assert.doesNotMatch(wxml, /bindtap="addBreastMilkEntry"/);
  assert.match(wxml, /class="section-card primary-card mix-card feeding-workbench"/);
  assert.match(wxml, /wx:for="\{\{milkEntries\}\}"/);
  assert.match(wxml, /bindinput="onBreastMilkEntryInput"/);
  assert.match(wxml, /bindinput="onMilkEntryInput"/);
  assert.match(wxml, /<nutrition-target-preview[\s\S]*preview="\{\{targetPreview\}\}"[\s\S]*title="保存前看看"/);
  assert.match(wxml, /nutritionPreview\.totalVolume/);
});

test('milk feeding add panel still adds concrete milk powder options for multiple same-category powders', () => {
  const js = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml', 'utf8');

  assert.match(js, /\.\.\.sortFormulaPowdersByCategory\(this\.data\.formulaPowders \|\| \[\]\)\.map\(\(powder\) => \(\{/);
  assert.match(js, /key:\s*`powder:\$\{powder\.id\}`/);
  assert.match(js, /powderId:\s*powder\.id/);
  assert.match(js, /label:\s*powder\.name \|\| '未命名奶粉'/);
  assert.match(wxml, /class="add-milk-option-title">\{\{item\.label\}\}/);
  assert.match(wxml, /class="add-milk-option-subtitle">\{\{item\.subLabel\}\}/);
});

test('milk feeding top calorie preview uses daily macro calories, target preferences fallback, and edit-adjusted totals', () => {
  const js = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');

  assert.match(js, /dailyConsumedCalories\s*=\s*Number\(targetContext\.currentSummary\?\.calories\)/);
  assert.match(js, /fallbackConsumedCalories\s*=\s*\(this\.data\.existingRecords \|\| \[\]\)\.reduce/);
  assert.match(js, /consumedCalories\s*=\s*Number\.isFinite\(dailyConsumedCalories\)\s*\?\s*dailyConsumedCalories\s*:\s*fallbackConsumedCalories/);
  assert.match(js, /Number\(this\.data\.calorieCoefficientInput \|\| targetContext\.targetPreferences\?\.calorieCoefficient\)/);
  assert.match(js, /effectiveConsumedCalories\s*=\s*Math\.max\(0,\s*consumedCalories - \(Number\(previousSummary\.calories\) \|\| 0\)\)/);
  assert.match(js, /calorieGoal - effectiveConsumedCalories - nutritionPreview\.calories/);
});
