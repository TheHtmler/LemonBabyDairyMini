# Recipe Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable recipe templates to meal recording so users can save a meal as a template, apply it later with a single consumed ratio, and keep historical nutrition totals based on flattened final intake snapshots.

**Architecture:** Keep `feeding_records.intakes[]` as the only historical source of truth and add a separate `recipe_catalog` model for reusable templates. Implement the ratio math and drift detection in a pure utility module, integrate recipe selection and “save as recipe” into `meal-editor`, and add only lightweight provenance display in `daily-feeding` and `data-records`.

**Tech Stack:** WeChat Mini Program native pages, cloud database models, shared utility modules in `miniprogram/utils`, Node `node:test` source and behavior tests

---

## Planned File Map

- Create: `miniprogram/utils/recipeUtils.js`
  Responsibility: pure helpers for recipe scaling, template payload building, provenance metadata, drift detection, and base-quantity backfill.
- Create: `miniprogram/models/recipe.js`
  Responsibility: CRUD and usage metadata for the `recipe_catalog` collection.
- Create: `miniprogram/pages/recipe-management/index.js`
  Responsibility: recipe list loading, editor state, save/delete flows, and page-level navigation actions.
- Create: `miniprogram/pages/recipe-management/index.wxml`
  Responsibility: recipe list UI, empty state, add/edit form, and food-item editing controls.
- Create: `miniprogram/pages/recipe-management/index.wxss`
  Responsibility: page styling for recipe list cards and editor form.
- Create: `miniprogram/pages/recipe-management/index.json`
  Responsibility: route title and page configuration.
- Modify: `miniprogram/app.json`
  Responsibility: register the new recipe management page route.
- Modify: `miniprogram/pages/meal-editor/index.js`
  Responsibility: load recipes, apply a recipe into `mealDraft.items`, persist recipe provenance fields into `intakes[]`, save the current meal as a recipe, and prompt for template updates on drift.
- Modify: `miniprogram/pages/meal-editor/index.wxml`
  Responsibility: add recipe entry points, consumed-ratio input, recipe provenance labels, and save-as-recipe actions.
- Modify: `miniprogram/pages/meal-editor/index.wxss`
  Responsibility: recipe picker, ratio form, and provenance badge styling.
- Modify: `miniprogram/pages/daily-feeding/index.js`
  Responsibility: preserve recipe provenance while grouping meal batches for history cards.
- Modify: `miniprogram/pages/daily-feeding/index.wxml`
  Responsibility: render “来自食谱 / 食用比例” labels on grouped meal cards.
- Modify: `miniprogram/pages/daily-feeding/index.wxss`
  Responsibility: styles for recipe provenance labels in today view.
- Modify: `miniprogram/pages/data-records/index.js`
  Responsibility: preserve recipe provenance in historical grouped meals and deletions.
- Modify: `miniprogram/pages/data-records/index.wxml`
  Responsibility: render recipe provenance in the historical day view.
- Modify: `miniprogram/pages/data-records/index.wxss`
  Responsibility: styles for historical recipe provenance labels.
- Create: `tests/recipe-utils.test.js`
  Responsibility: pure unit coverage for ratio scaling, provenance payloads, and drift detection.
- Create: `tests/recipe-management.test.js`
  Responsibility: source and mocked-model coverage for route registration, page shell, and recipe model behavior.
- Create: `tests/meal-editor-recipe.test.js`
  Responsibility: `meal-editor` behavior coverage for applying recipes, saving provenance, and template update prompts.
- Create: `tests/recipe-history-display.test.js`
  Responsibility: grouped-history behavior coverage in `daily-feeding` and `data-records`.
- Modify: `tests/report-workbench-data.test.js`
  Responsibility: lock compatibility so recipe provenance fields do not affect nutrition summary calculations.

### Task 1: Lock Recipe Utility Contracts First

**Files:**
- Create: `tests/recipe-utils.test.js`
- Create: `miniprogram/utils/recipeUtils.js`
- Test: `tests/recipe-utils.test.js`

- [ ] **Step 1: Write the failing pure-helper tests**

Add tests for these behaviors:

```js
const scaled = scaleRecipeItems([
  { foodId: 'A', baseQuantity: 10, nutritionSnapshot: { calories: 100, protein: 2 }, naturalProtein: 2, specialProtein: 0 },
  { foodId: 'B', baseQuantity: 3, nutritionSnapshot: { calories: 30, protein: 1 }, naturalProtein: 0, specialProtein: 1 }
], 0.7);

assert.equal(scaled[0].quantity, 7);
assert.equal(scaled[0].nutrition.calories, 70);
assert.equal(scaled[1].quantity, 2.1);

const drift = detectRecipeDrift({
  items: [{ foodId: 'C', baseQuantity: 25 }]
}, [
  { foodId: 'C', quantity: 20 }
], 0.7);

assert.equal(drift.changed, true);
assert.equal(drift.updatedItems[0].baseQuantity, 28.57);
```

- [ ] **Step 2: Run the tests to verify the red state**

Run: `node --test tests/recipe-utils.test.js`
Expected: FAIL with `Cannot find module '../miniprogram/utils/recipeUtils'` or missing helper exports.

- [ ] **Step 3: Implement the minimal pure helper module**

In `miniprogram/utils/recipeUtils.js`, add only the helpers needed for the feature:

```js
function scaleRecipeItems(items = [], ratio = 1) { /* scale quantity + nutrition + protein splits */ }
function buildRecipeItemsFromMealItems(items = []) { /* convert current meal items to template base items */ }
function detectRecipeDrift(recipe = {}, mealItems = [], ratio = 1) { /* compare by foodId + baseQuantity + membership */ }
function buildRecipeSourceMeta(recipe = {}, ratio = 1, baseQuantity = 0) { /* recipeId/nameSnapshot/ratio/baseQuantity */ }
```

Keep this module pure and free of `wx` or database calls.

- [ ] **Step 4: Run the helper tests to verify green**

Run: `node --test tests/recipe-utils.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/recipeUtils.js tests/recipe-utils.test.js
git commit -m "feat: add recipe utility helpers"
```

### Task 2: Add the Recipe Catalog Model and Page Route Shell

**Files:**
- Create: `miniprogram/models/recipe.js`
- Create: `miniprogram/pages/recipe-management/index.js`
- Create: `miniprogram/pages/recipe-management/index.wxml`
- Create: `miniprogram/pages/recipe-management/index.wxss`
- Create: `miniprogram/pages/recipe-management/index.json`
- Modify: `miniprogram/app.json`
- Create: `tests/recipe-management.test.js`
- Test: `tests/recipe-management.test.js`

- [ ] **Step 1: Write the failing model and page-shell tests**

Add assertions that:

```js
assert.match(appJson, /"pages\/recipe-management\/index"/);
assert.ok(typeof RecipeModel.listRecipes === 'function');
assert.ok(typeof RecipeModel.createRecipe === 'function');
assert.ok(typeof RecipeModel.updateRecipe === 'function');
assert.ok(typeof RecipeModel.deleteRecipe === 'function');
assert.ok(typeof RecipeModel.touchRecipeUsage === 'function');
```

Also assert the new page contains:
- a recipe list
- an empty state
- an add/edit form with `name`, `note`, and item editing controls
- a way to open the recipe editor from inside the page

- [ ] **Step 2: Run the tests to verify the red state**

Run: `node --test tests/recipe-management.test.js`
Expected: FAIL because the route, page files, and model do not exist yet.

- [ ] **Step 3: Implement the minimal route, model, and page shell**

In `miniprogram/models/recipe.js`, add CRUD plus usage metadata helpers against `recipe_catalog`.

Use a small normalized payload shape:

```js
{
  babyUid,
  name,
  note,
  items,
  createdFrom,
  useCount: 0,
  status: 'active',
  createdAt: db.serverDate(),
  updatedAt: db.serverDate()
}
```

In the page shell, support:
- initial list loading
- entering add/edit mode
- canceling editor mode
- saving and deleting through the model

Do not wire meal-editor integration in this task.

- [ ] **Step 4: Run the tests to verify green**

Run: `node --test tests/recipe-management.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/models/recipe.js miniprogram/pages/recipe-management/index.js miniprogram/pages/recipe-management/index.wxml miniprogram/pages/recipe-management/index.wxss miniprogram/pages/recipe-management/index.json tests/recipe-management.test.js
git commit -m "feat: scaffold recipe catalog management"
```

### Task 3: Integrate “Apply Recipe” Into Meal Editor

**Files:**
- Modify: `miniprogram/pages/meal-editor/index.js`
- Modify: `miniprogram/pages/meal-editor/index.wxml`
- Modify: `miniprogram/pages/meal-editor/index.wxss`
- Create: `tests/meal-editor-recipe.test.js`
- Test: `tests/meal-editor-recipe.test.js`

- [ ] **Step 1: Write the failing meal-editor recipe-apply tests**

Add behavior coverage for:

```js
const instance = createMealEditorInstance();
instance.applyRecipeToMeal({
  _id: 'recipe_1',
  name: '早餐模板',
  items: [
    { foodId: 'A', nameSnapshot: 'A', unit: 'g', baseQuantity: 10, nutritionSnapshot: { calories: 100, protein: 2 }, naturalProtein: 2, specialProtein: 0 }
  ]
}, 0.7);

assert.equal(instance.data.mealDraft.items[0].quantity, 7);
assert.equal(instance.data.mealDraft.items[0].nutrition.calories, 70);
assert.equal(instance.data.mealDraft.recipeContext.recipeId, 'recipe_1');
assert.equal(instance.data.mealDraft.recipeContext.consumedRatio, 0.7);
```

Also lock the source for:
- a “从食谱添加” entry
- a consumed-ratio input defaulting to `100%`
- a link to `recipe-management`

- [ ] **Step 2: Run the tests to verify the red state**

Run: `node --test tests/meal-editor-recipe.test.js`
Expected: FAIL because recipe state and handlers are not implemented.

- [ ] **Step 3: Implement the minimal apply-recipe flow**

In `meal-editor`:
- load recipe options alongside foods
- add page state for recipe picker and consumed ratio
- apply a selected recipe into `mealDraft.items` using `recipeUtils.scaleRecipeItems`
- store a compact `mealDraft.recipeContext`:

```js
{
  recipeId,
  recipeNameSnapshot,
  consumedRatio,
  sourceType: 'recipe'
}
```

Keep manual item editing behavior intact after recipe expansion.

- [ ] **Step 4: Run the tests to verify green**

Run: `node --test tests/meal-editor-recipe.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/meal-editor/index.js miniprogram/pages/meal-editor/index.wxml miniprogram/pages/meal-editor/index.wxss tests/meal-editor-recipe.test.js
git commit -m "feat: apply recipes in meal editor"
```

### Task 4: Persist Recipe Provenance and Support “Save as Recipe”

**Files:**
- Modify: `miniprogram/pages/meal-editor/index.js`
- Modify: `miniprogram/pages/meal-editor/index.wxml`
- Modify: `miniprogram/models/recipe.js`
- Modify: `tests/meal-editor-recipe.test.js`
- Test: `tests/meal-editor-recipe.test.js`

- [ ] **Step 1: Extend tests for save payloads and template updates**

Add failing coverage for:

```js
const intakes = instance.buildMealIntakes('meal_1');
assert.equal(intakes[0].sourceType, 'recipe');
assert.equal(intakes[0].recipeId, 'recipe_1');
assert.equal(intakes[0].recipeNameSnapshot, '早餐模板');
assert.equal(intakes[0].recipeConsumedRatio, 0.7);
assert.equal(intakes[0].recipeBaseQuantity, 10);
```

Also test that:
- `saveCurrentMealAsRecipe()` builds a template from current `mealDraft.items`
- drifted edits trigger a confirm path
- choosing “更新食谱” sends base quantities, not current scaled quantities

- [ ] **Step 2: Run the tests to verify the red state**

Run: `node --test tests/meal-editor-recipe.test.js`
Expected: FAIL on missing provenance fields, missing save-as-recipe flow, or wrong base-quantity update logic.

- [ ] **Step 3: Implement save metadata, save-as-recipe, and drift prompt**

Update `buildMealIntakes()` so recipe-generated items persist:

```js
{
  sourceType: 'recipe',
  recipeId: recipeContext.recipeId,
  recipeNameSnapshot: recipeContext.recipeNameSnapshot,
  recipeConsumedRatio: recipeContext.consumedRatio,
  recipeBaseQuantity: item.recipeBaseQuantity
}
```

Add:
- a “存为食谱” action for existing or newly composed meals
- drift detection before or during save
- a confirm flow that updates the recipe via `RecipeModel.updateRecipe()` only when the user confirms
- `RecipeModel.touchRecipeUsage()` after successful recipe-based meal saves

- [ ] **Step 4: Run the tests to verify green**

Run: `node --test tests/meal-editor-recipe.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/meal-editor/index.js miniprogram/pages/meal-editor/index.wxml miniprogram/models/recipe.js tests/meal-editor-recipe.test.js
git commit -m "feat: persist recipe meal provenance"
```

### Task 5: Surface Recipe Provenance in Today and Historical Views

**Files:**
- Modify: `miniprogram/pages/daily-feeding/index.js`
- Modify: `miniprogram/pages/daily-feeding/index.wxml`
- Modify: `miniprogram/pages/daily-feeding/index.wxss`
- Modify: `miniprogram/pages/data-records/index.js`
- Modify: `miniprogram/pages/data-records/index.wxml`
- Modify: `miniprogram/pages/data-records/index.wxss`
- Create: `tests/recipe-history-display.test.js`
- Test: `tests/recipe-history-display.test.js`

- [ ] **Step 1: Write the failing history-group tests**

Load both pages and assert grouped meal cards retain recipe provenance:

```js
const groups = page.buildFoodMealGroups([
  {
    type: 'food',
    mealBatchId: 'meal_1',
    mealLabel: '早餐',
    recipeId: 'recipe_1',
    recipeNameSnapshot: '早餐模板',
    recipeConsumedRatio: 0.7,
    nutrition: { calories: 70, protein: 1.4, carbs: 0, fat: 0 }
  }
]);

assert.equal(groups[0].recipeNameSnapshot, '早餐模板');
assert.equal(groups[0].recipeConsumedRatio, 0.7);
```

Also add source-based assertions that both WXML files render:
- `来自食谱`
- `食用 70%`-style labels

- [ ] **Step 2: Run the tests to verify the red state**

Run: `node --test tests/recipe-history-display.test.js`
Expected: FAIL because the grouping logic and markup do not carry recipe provenance yet.

- [ ] **Step 3: Implement the minimal grouped-history changes**

In both pages:
- carry `recipeId`, `recipeNameSnapshot`, and `recipeConsumedRatio` from grouped intakes to the meal card view model
- render them only when present
- keep delete/edit behavior keyed by `mealBatchId` unchanged

Do not restructure the meal cards or change nutrition totals.

- [ ] **Step 4: Run the tests to verify green**

Run: `node --test tests/recipe-history-display.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/daily-feeding/index.js miniprogram/pages/daily-feeding/index.wxml miniprogram/pages/daily-feeding/index.wxss miniprogram/pages/data-records/index.js miniprogram/pages/data-records/index.wxml miniprogram/pages/data-records/index.wxss tests/recipe-history-display.test.js
git commit -m "feat: show recipe provenance in history"
```

### Task 6: Lock Summary Compatibility and Run Manual QA

**Files:**
- Modify: `tests/report-workbench-data.test.js`
- Modify: `tests/meal-editor-recipe.test.js`
- Modify only if needed: `miniprogram/utils/reportWorkbench.js`
- Test: `tests/report-workbench-data.test.js`, `tests/recipe-utils.test.js`, `tests/recipe-management.test.js`, `tests/meal-editor-recipe.test.js`, `tests/recipe-history-display.test.js`

- [ ] **Step 1: Add failing compatibility assertions**

Extend `tests/report-workbench-data.test.js` so intakes containing:

```js
{
  sourceType: 'recipe',
  recipeId: 'recipe_1',
  recipeNameSnapshot: '早餐模板',
  recipeConsumedRatio: 0.7,
  recipeBaseQuantity: 10
}
```

still produce the same nutrition window totals as the equivalent manual intakes.

- [ ] **Step 2: Run the focused regression suite**

Run: `node --test tests/report-workbench-data.test.js tests/recipe-utils.test.js tests/recipe-management.test.js tests/meal-editor-recipe.test.js tests/recipe-history-display.test.js`
Expected: PASS if provenance fields are ignored by summary math; otherwise FAIL on summary regressions.

- [ ] **Step 3: Implement only the compatibility fixes that tests prove necessary**

If a regression appears, patch the smallest possible surface, preferably in `miniprogram/utils/reportWorkbench.js`, so recipe metadata is treated as inert display metadata and not as a new intake type.

- [ ] **Step 4: Re-run the focused suite and then perform manual WeChat DevTools verification**

Run: `node --test tests/report-workbench-data.test.js tests/recipe-utils.test.js tests/recipe-management.test.js tests/meal-editor-recipe.test.js tests/recipe-history-display.test.js`
Expected: PASS

Manual verification checklist:
- create a recipe from scratch in `recipe-management`
- apply it in `meal-editor` at `70%`
- save and confirm `daily-feeding` shows actual quantities plus recipe provenance
- edit that meal, change one item, choose `仅本次`, and confirm the template remains unchanged
- repeat, choose `更新食谱`, and confirm the template stores the back-calculated base quantities
- save a meal as a recipe from `meal-editor`
- confirm `data-records` shows the same provenance labels as `daily-feeding`

- [ ] **Step 5: Commit**

```bash
git add tests/report-workbench-data.test.js tests/meal-editor-recipe.test.js miniprogram/utils/reportWorkbench.js
git commit -m "test: lock recipe summary compatibility"
```
