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
  assert.equal(natural.valueText, '5.40');
  assert.equal(natural.targetText, '4.80g');
  assert.equal(natural.pctText, '112.5%');
  assert.equal(natural.badgeText, '超出 0.60g');
  assert.equal(natural.draftText, '本次增加 +1.40g');
  assert.equal(natural.actionText, '仍然保存');

  assert.equal(special.actual, 1.2);
  assert.equal(special.target, 3.2);
  assert.equal(special.status, 'ok');
  assert.equal(special.badgeText, '还差 2.00g');
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

test('nutrition target preview shows a setup entry when protein target is unset', () => {
  const js = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.js',
    'utf8'
  );
  const wxml = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.wxml',
    'utf8'
  );
  const wxss = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.wxss',
    'utf8'
  );
  const json = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.json',
    'utf8'
  );
  const modalJs = fs.readFileSync(
    'miniprogram/components/nutrition-target-settings-modal/nutrition-target-settings-modal.js',
    'utf8'
  );
  const modalWxml = fs.readFileSync(
    'miniprogram/components/nutrition-target-settings-modal/nutrition-target-settings-modal.wxml',
    'utf8'
  );
  const modalWxss = fs.readFileSync(
    'miniprogram/components/nutrition-target-settings-modal/nutrition-target-settings-modal.wxss',
    'utf8'
  );

  assert.match(wxml, /\{\{showProtein && !preview\.hasProteinTarget \? emptyTitle : title\}\}/);
  assert.match(wxml, /target-preview-empty-copy/);
  assert.match(wxml, /class="target-preview-empty-action" bindtap="handleSetupTap"/);
  assert.match(wxml, /\{\{setupText\}\}/);
  assert.match(js, /emptyTitle:[\s\S]*value:\s*'还没有设置蛋白目标'/);
  assert.match(js, /setupText:[\s\S]*value:\s*'去设置目标'/);
  assert.match(json, /nutrition-target-settings-modal/);
  assert.match(wxml, /<nutrition-target-settings-modal/);
  assert.match(js, /handleSetupTap\(\)/);
  assert.match(js, /settingsModalVisible:\s*true/);
  assert.doesNotMatch(js, /wx\.navigateTo\(\{\s*url:\s*this\.data\.setupUrl\s*\}\)/);
  assert.match(modalJs, /saveNutritionTargetPreferences/);
  assert.match(modalJs, /triggerEvent\('saved', \{ preferences \}\)/);
  assert.match(modalWxml, /设置营养目标|蛋白目标|热量目标/);
  assert.match(modalWxml, /class="target-section" wx:if="\{\{activeMode === 'protein'\}\}"/);
  assert.match(modalWxml, /class="target-section" wx:if="\{\{activeMode === 'calorie'\}\}"/);
  assert.match(modalWxss, /\.target-modal-mask\s*\{[\s\S]*align-items:\s*center/);
  assert.match(modalWxss, /\.target-modal-mask\s*\{[\s\S]*justify-content:\s*center/);
  assert.match(modalWxss, /\.target-modal-sheet\s*\{[\s\S]*border-radius:\s*34rpx/);
  assert.match(modalWxss, /\.btn-cancel,\s*\n\.btn-confirm\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*margin:\s*0;[\s\S]*line-height:\s*normal;[\s\S]*box-sizing:\s*border-box;/);
  assert.match(modalWxss, /\.btn-cancel::after,\s*\n\.btn-confirm::after\s*\{[\s\S]*border:\s*none/);
  const sheetStyle = modalWxss.match(/\.target-modal-sheet\s*\{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(sheetStyle, /bottom:\s*0/);
  assert.doesNotMatch(sheetStyle, /translateY\(100%\)/);
  assert.match(wxss, /\.target-preview-empty-action\s*\{/);
  assert.match(wxss, /border-radius:\s*999rpx/);
});

test('nutrition target preview keeps a modify entry when a target is displayed', () => {
  const js = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.js',
    'utf8'
  );
  const wxml = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.wxml',
    'utf8'
  );
  const wxss = fs.readFileSync(
    'miniprogram/components/nutrition-target-preview/nutrition-target-preview.wxss',
    'utf8'
  );
  const treatmentWxml = fs.readFileSync(
    'miniprogram/pkg-records/treatment-record/index.wxml',
    'utf8'
  );

  assert.match(js, /actionText:[\s\S]*value:\s*'修改目标'/);
  assert.match(js, /showSetupAction:[\s\S]*value:\s*true/);
  assert.match(wxml, /class="target-preview-action"[\s\S]*bindtap="handleSetupTap"/);
  assert.match(wxml, /\{\{actionText\}\}/);
  assert.match(wxml, /showSetupAction && \(\(showProtein && preview\.hasProteinTarget\) \|\| \(showCalorie && preview\.calorieNote && preview\.calorieNote\.visible\)\)/);
  assert.match(wxml, /wx:if="\{\{showCalorie && !showProtein && \(!preview\.calorieNote \|\| !preview\.calorieNote\.visible\)\}\}"/);
  assert.match(wxss, /\.target-preview-action\s*\{/);
  assert.match(wxss, /color:\s*#D99700/);
  assert.match(treatmentWxml, /setup-mode="calorie"/);
  assert.doesNotMatch(treatmentWxml, /setup-url=/);
});

test('target preview pages refresh targets after returning from setup', () => {
  const treatmentJs = fs.readFileSync('miniprogram/pkg-records/treatment-record/index.js', 'utf8');
  const treatmentWxml = fs.readFileSync('miniprogram/pkg-records/treatment-record/index.wxml', 'utf8');
  const milkEditorJs = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');
  const milkEditorWxml = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml', 'utf8');
  const mealEditorWxml = fs.readFileSync('miniprogram/pkg-records/meal-editor/index.wxml', 'utf8');
  const foodPickerWxml = fs.readFileSync('miniprogram/pkg-records/food-picker/index.wxml', 'utf8');

  assert.match(treatmentJs, /async onShow\(\)\s*\{[\s\S]*await this\.loadTargetContext\(this\.data\.dateKey\);[\s\S]*this\.refreshTargetPreview\(\);[\s\S]*\}/);
  assert.match(treatmentJs, /async handleNutritionTargetsSaved\(\)/);
  assert.match(milkEditorJs, /async refreshTargetContextFromPreferences\(\)/);
  assert.match(milkEditorJs, /await this\.refreshTargetContextFromPreferences\(\);/);
  assert.match(milkEditorJs, /async handleNutritionTargetsSaved\(\)/);
  assert.match(milkEditorJs, /this\.refreshNutritionPreview\(\);/);
  assert.match(treatmentWxml, /bind:targetssaved="handleNutritionTargetsSaved"/);
  assert.match(milkEditorWxml, /bind:targetssaved="handleNutritionTargetsSaved"/);
  assert.match(mealEditorWxml, /bind:targetssaved="handleNutritionTargetsSaved"/);
  assert.match(foodPickerWxml, /bind:targetssaved="handleNutritionTargetsSaved"/);
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
