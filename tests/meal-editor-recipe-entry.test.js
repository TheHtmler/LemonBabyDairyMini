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

test('meal editor edit mode shows loading instead of empty state while fetching', () => {
  const pageSource = fs.readFileSync(mealEditorPath, 'utf8');
  const templateSource = fs.readFileSync(mealEditorWxmlPath, 'utf8');

  assert.match(pageSource, /initialLoading:\s*isEditMode/);
  assert.match(pageSource, /优先拉本顿|loadExistingMeal\(editMealBatchId\)/);
  assert.match(templateSource, /initialLoading/);
  assert.match(templateSource, /正在加载本顿内容/);
  assert.match(templateSource, /wx:elif="\{\{mealDraft\.items\.length === 0\}\}"/);
  assert.doesNotMatch(templateSource, /本顿吃了什么/);
  assert.match(templateSource, /保存本顿后的目标/);
  assert.doesNotMatch(templateSource, /targetPanelExpanded/);
});

test('meal editor edit quantity preview falls back to intake food snapshot nutrition', () => {
  const pageSource = fs.readFileSync(mealEditorPath, 'utf8');
  assert.match(pageSource, /function resolveFoodForNutritionCalc/);
  assert.match(pageSource, /hydrateMealItemsFromCatalog/);
  assert.match(pageSource, /resolveMealItemFood/);
  assert.match(pageSource, /foodSnapshot[\s\S]*nutritionPerBasis/);
  assert.match(pageSource, /updateCurrentFoodDraftPreview\(\)[\s\S]*resolveMealItemFood/);
});

test('recipe picker collects batch ingredient amounts and intake percent or grams', () => {
  const pickerSource = fs.readFileSync(recipePickerPath, 'utf8');
  const pickerTemplate = fs.readFileSync(recipePickerWxmlPath, 'utf8');
  const managementSource = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/pkg-records/recipe-management/index.js'),
    'utf8'
  );
  const managementTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/pkg-records/recipe-management/index.wxml'),
    'utf8'
  );
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
  assert.match(pickerSource, /matchRecipeBySearch/);
  assert.match(pickerTemplate, /recipeCount/);
  assert.match(pickerTemplate, /菜名或原料/);
  assert.match(pickerTemplate, /recipe-card/);
  assert.match(pickerTemplate, /ingredientLine/);
  assert.match(pickerSource, /goToRecipeManagement/);
  assert.match(pickerSource, /mode=create/);
  assert.match(pickerSource, /openCreate|recipeCount === 0|!\(this\.data\.recipeCount > 0\)/);
  assert.match(pickerSource, /readRecipeCache|applyRecipesToView/);
  assert.match(pickerTemplate, /data-mode="create"/);
  assert.match(managementSource, /options\.mode === 'create'/);
  assert.match(managementSource, /ensureFoodCatalog/);
  assert.match(pickerSource, /\/pkg-records\/recipe-management\/index/);
  assert.match(pickerTemplate, /食谱管理/);
  assert.match(pickerTemplate, /intro-action/);
  assert.match(pickerTemplate, /list-sticky/);
  assert.match(pickerTemplate, /scroll-view/);
  assert.match(pickerTemplate, /去新建食谱/);
  assert.doesNotMatch(pickerTemplate, /原料均估|上次用量|recipe-facts/);
  assert.match(managementSource, /matchRecipeBySearch/);
  assert.match(managementSource, /ingredientTags/);
  assert.match(managementTemplate, /菜名或原料/);
  assert.match(managementTemplate, /食谱管理/);
  assert.match(managementTemplate, /catalog-item/);
  assert.match(managementTemplate, /catalog-edit/);
  assert.match(managementTemplate, /catalog-delete/);
  assert.match(managementTemplate, /编辑/);
  assert.match(managementTemplate, /删除/);
  assert.doesNotMatch(managementTemplate, /pick-btn|recipe-avatar/);
  assert.doesNotMatch(managementTemplate, /原料均估|上次用量/);
  assert.match(managementTemplate, /可预填默认份量/);
  assert.match(managementTemplate, /当前食谱营养成份/);
  assert.doesNotMatch(pickerTemplate, /本次原料用量/);

  assert.match(batchSource, /meal_recipe_picker_selection/);
  assert.match(batchSource, /summarizeBatchFromIngredients/);
  assert.match(batchSource, /resolveBatchIntake/);
  assert.match(batchSource, /clearAllQuantities/);
  assert.match(batchSource, /applyDefaultQuantities/);
  assert.match(batchSource, /applyLastQuantities/);
  assert.match(batchSource, /saveLastBatchQuantities/);
  assert.match(batchSource, /readLastBatchQuantities/);
  assert.match(batchSource, /hasDefaultQuantities/);
  assert.match(batchSource, /hasLastQuantities/);
  assert.match(batchSource, /defaultQuantity/);
  assert.match(batchSource, /intakeMode/);
  assert.match(batchSource, /batchWeightG/);
  assert.match(batchSource, /ingredientsSnapshot/);
  assert.match(batchSource, /navigateBack\(\{\s*delta:\s*2\s*\}\)/);
  assert.doesNotMatch(batchTemplate, /原料用量/);
  assert.match(batchTemplate, /默认份量/);
  assert.match(batchTemplate, /上次份量/);
  assert.match(batchTemplate, />清空</);
  assert.match(batchTemplate, /wx:if="\{\{hasDefaultQuantities\}\}"/);
  assert.match(batchTemplate, /wx:if="\{\{hasLastQuantities\}\}"/);
  assert.doesNotMatch(batchTemplate, /已带出默认份量|ingredient-ref|ingredient-current/);
  assert.match(batchTemplate, /快捷操作：/);
  assert.match(batchTemplate, /qty-action-row/);
  assert.match(batchTemplate, /qty-action-chip/);
  assert.match(batchTemplate, /placeholder="必填"/);
  assert.match(
    batchTemplate,
    /ingredient-edit-list[\s\S]*qty-action-row/
  );
  assert.match(batchTemplate, /focus="\{\{focusedQuantityIndex === ingredientIndex\}\}"/);
  assert.match(batchTemplate, /focus="\{\{focusedIntake\}\}"/);
  assert.doesNotMatch(batchTemplate, /disabled="\{\{!intakeValue\}\}"/);
  assert.match(batchSource, /focusMissingIngredientQuantity/);
  assert.match(batchSource, /focusIntakeValueInput/);
  assert.match(batchSource, /quantityMissing/);
  assert.match(batchSource, /intakeValueMissing/);
  assert.match(batchSource, /请填写实际克数|请填写摄入百分比/);
  assert.match(batchTemplate, /百分比/);
  assert.match(batchTemplate, /克数/);
  assert.match(batchTemplate, /吃了多少/);
  assert.doesNotMatch(batchTemplate, /宝宝吃了多少/);
  assert.match(batchTemplate, /intake-panel/);
  assert.match(batchTemplate, /intake-card/);
  assert.match(batchTemplate, /intake-card[\s\S]*吃了多少[\s\S]*intake-detail/);
  assert.doesNotMatch(batchTemplate, /这次吃进去/);
  assert.match(batchTemplate, /nutrition-preview|summary-grid/);
  assert.match(batchTemplate, /ingredient-edit-line/);
  assert.match(batchTemplate, /unit-text/);
  assert.match(batchSource, /intakeMode:\s*canUseGramsIntake\s*\?\s*'grams'\s*:\s*'percent'/);
  assert.match(batchSource, /buildLiveIngredients/);
  assert.match(batchSource, /buildIntakeTargetPreview/);
  assert.match(batchSource, /intakeTargetPreview:\s*this\.buildIntakeTargetPreview\(\{[\s\S]*premiumProtein:\s*premiumSummary\.premiumProtein[\s\S]*\}\)/);
  assert.match(batchSource, /refreshIntakePreview/);
  assert.match(batchSource, /summarizePremiumProteinFromIngredients/);
  assert.match(batchSource, /combinePremiumProteinWithDay/);
  assert.match(batchSource, /buildEntryTargetPreview/);
  assert.match(batchSource, /intakeTargetPreview/);
  assert.match(batchTemplate, /nutrition-target-preview/);
  assert.match(batchTemplate, /保存前看看/);
  assert.match(batchTemplate, /已记录 \+ 本次/);
  assert.match(batchTemplate, /intakePreview|intake-detail/);
  assert.match(
    batchTemplate,
    /intake-card[\s\S]*nutrition-target-preview[\s\S]*保存前看看/
  );
  assert.match(batchTemplate, /intro-title/);
  assert.match(batchTemplate, /intro-card/);
  assert.match(batchTemplate, /\{\{draftIngredients\.length\}\}种食物/);
  assert.doesNotMatch(batchTemplate, /hero-recipe-tag|原料填多少|intro-bar/);
  assert.match(batchTemplate, /含优质蛋白 \{\{intakePreview\.premiumValue\}\}g · \{\{intakePreview\.premiumRatio\}\}%/);
  assert.doesNotMatch(batchTemplate, /优质占比|天然 \{\{intakePreview/);
  assert.match(batchTemplate, /intake-detail-note/);
  assert.match(
    fs.readFileSync(mealEditorPath, 'utf8'),
    /writeRecipeBatchTargetContext|RECIPE_DAY_PROTEIN_CONTEXT_KEY/
  );
  assert.match(
    fs.readFileSync(
      path.join(__dirname, '..', 'miniprogram/pkg-records/recipe-batch/index.json'),
      'utf8'
    ),
    /nutrition-target-preview/
  );
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
  assert.match(pageSource, /saveLastBatchQuantities/);
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
