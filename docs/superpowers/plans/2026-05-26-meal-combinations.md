# Meal Combinations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add v2 “菜谱” so users can save reusable food-and-quantity groups, apply them to a meal, and record actual intake by meal completion percentage.

**Architecture:** Keep “菜谱” as template data in a new `meal_combinations` collection and keep real eaten meals in `food_intake_records`. Reuse the existing `meal-editor-v2` flow: recipes expand into `mealDraft.items`, then saving creates or updates one `food_intake_records` document per food item under the same `mealBatchId`. Store actual intake in existing `quantity` and `nutrition` fields so `daily_summary_v2` continues to summarize without a new read path; store `plannedQuantity`, `plannedNutrition`, `completionPercent`, and `mealCombinationSource` for history and editing.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, Cloud Database, CommonJS modules, `node:test`.

---

## Cloud Database Checklist

- [ ] Create the new `meal_combinations` collection in the WeChat Cloud Development console before release.
- [ ] Add the recommended compound index for active-list queries: `babyUid + status + updatedAt`.
- [ ] Consider adding the optional compound index for usage-ranked lists or future shortcuts: `babyUid + status + usageCount`.
- [ ] Keep `food_intake_records` as the existing v2 food intake collection. The new planned/actual meal fields do not require a new collection migration.
- [ ] Keep old `food_intake_records` documents compatible when planned fields are missing. Read/edit paths should treat missing planned fields as legacy v2 food records and avoid rescaling from stored completion data.
- [ ] Before production rollout, verify the collection and indexes exist in the WeChat Cloud Development console for the target environment.

---

## Product Boundary

- Do not change legacy `meal-editor` or v1 `feeding_records.intakes`.
- Do not write v2 food records to `feeding_records`.
- Do not turn a 菜谱 into a `food_catalog` item.
- Do not implement recipe steps, cooking instructions, or migration from old intakes.
- Do not commit changes unless the user explicitly asks for a commit.

## File Structure

### New Files

- `miniprogram/models/mealCombination.js`
  - CRUD and normalization for `meal_combinations`.
  - Query active combinations by `babyUid`.
  - Increment usage metadata after applying a combination.
- `miniprogram/utils/mealCombinationUtils.js`
  - Pure conversion and calculation helpers.
  - Convert `mealDraft` into a combination payload.
  - Convert a combination into `mealDraft.items`.
  - Scale planned items into actual intake values by `completionPercent`.
  - Scale `naturalProtein` and `specialProtein` together with total `protein`.
- `tests/meal-combination-model.test.js`
  - Model contract tests for the new collection.
- `tests/meal-combination-utils.test.js`
  - Pure utility tests for conversion, scaling, fallback snapshots, and validation.
- `tests/meal-editor-v2-combinations.test.js`
  - Page-level tests for loading, applying, saving, and deleting combinations.
- `tests/meal-editor-v2-completion-percent.test.js`
  - Page-level tests for completion percentage and planned-vs-actual saved payloads.
- Optional: `docs/miniprogram/v2-cloud-database-checklist.md`
  - Document the required `meal_combinations` collection and recommended indexes if the project keeps deployment checklists separate.

### Modified Files

- `miniprogram/models/foodIntakeRecord.js`
  - Preserve and normalize `plannedQuantity`, `plannedNutrition`, `completionPercent`, and `mealCombinationSource`.
  - Keep `quantity` and `nutrition` as actual intake values.
- `miniprogram/pages/meal-editor-v2/index.js`
  - Add `MealCombinationModel` and pure utility usage.
  - Add `completionPercent`, planned summary, actual summary, combination drawer state, and combination actions.
  - Load existing v2 meals using planned fields when present.
  - Save actual intake fields scaled by `completionPercent`.
- `miniprogram/pages/meal-editor-v2/index.wxml`
  - Add completion percentage controls.
  - Add “从菜谱添加” and “保存为菜谱”.
  - Add combination selection drawer.
  - Show planned and actual summaries.
- `miniprogram/pages/meal-editor-v2/index.wxss`
  - Style completion chips, combination cards, and planned/actual summary rows.
- `miniprogram/pages/data-records/index.js`
  - Preserve new fields in v2 food adapters.
  - Surface completion percentage and planned-vs-actual text in meal groups.
  - Keep legacy v1 data display unchanged.
- `miniprogram/pages/data-records/index.wxml`
  - Render completion percentage and prepared-vs-actual copy for v2 food meal groups.
- `miniprogram/pages/data-records/index.wxss`
  - Style compact completion/actual intake metadata.
- `tests/data-records-v2.test.js`
  - Add shared-page regression coverage so v1 food records do not pick up v2 completion/planned UI behavior.
- `docs/miniprogram/data-schema-guidelines.md`
  - Add `meal_combinations` collection and recommended indexes if this repository keeps schema notes there.
- `docs/superpowers/specs/2026-05-26-meal-combinations-design.md`
  - Reference the implementation plan if desired after implementation starts.

---

## Task 1: Add Meal Combination Model Tests

**Files:**
- Create: `tests/meal-combination-model.test.js`
- Future Create: `miniprogram/models/mealCombination.js`

- [ ] **Step 1: Write failing model tests**

Cover:

- `createMealCombination()` writes to `meal_combinations`, not `food_intake_records` or `feeding_records`.
- Created records include `schemaVersion`, `recordType`, `status`, `babyUid`, `name`, normalized `items`, `usageCount`, `lastUsedAt`, `createdAt`, and `updatedAt`.
- `findByBaby(babyUid)` returns active combinations sorted by `updatedAt desc` or `lastUsedAt desc`.
- `updateMealCombination()` strips `_id`, `id`, `createdAt`, and rewrites normalized item data.
- `deleteMealCombination()` marks `status: 'deleted'` or removes the document. Recommendation: soft delete with `status: 'deleted'` so accidental deletion can be recovered later.
- `incrementUsage()` increments `usageCount` and sets `lastUsedAt`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/meal-combination-model.test.js
```

Expected: FAIL because `miniprogram/models/mealCombination.js` does not exist.

---

## Task 2: Implement Meal Combination Model

**Files:**
- Create: `miniprogram/models/mealCombination.js`
- Test: `tests/meal-combination-model.test.js`

- [ ] **Step 1: Implement normalization helpers**

Required helper behavior:

- `normalizeMealCombination(record)` returns a complete record with default `schemaVersion: 1`, `recordType: 'meal_combination'`, `status: 'active'`, `items: []`, `usageCount: 0`, and `lastUsedAt: null`.
- `normalizeCombinationItem(item, index)` returns:
  - `foodId`
  - `foodName`
  - `foodSnapshot`
  - `plannedQuantity`
  - `unit`
  - `sortOrder`
  - `notes`
- `foodSnapshot` preserves `name`, `category`, `proteinSource`, `baseQuantity`, `baseUnit`, `nutritionPerUnit`, `proteinQuality`, and `milkType` if present.

- [ ] **Step 2: Implement exported CRUD methods**

Export:

```js
module.exports = {
  createMealCombination,
  updateMealCombination,
  deleteMealCombination,
  findByBaby,
  incrementUsage,
  normalizeMealCombination
};
```

Implementation notes:

- Initialize `const db = wx.cloud.database()` and `const collection = db.collection('meal_combinations')` like existing models.
- Use `db.serverDate()` for `createdAt`, `updatedAt`, and `lastUsedAt`.
- Soft delete with `status: 'deleted'` for this pass.
- `findByBaby()` must filter `status: 'active'`.

- [ ] **Step 3: Run focused model tests**

Run:

```bash
node --test tests/meal-combination-model.test.js
```

Expected: PASS.

---

## Task 3: Add Pure Meal Combination Utility Tests

**Files:**
- Create: `tests/meal-combination-utils.test.js`
- Future Create: `miniprogram/utils/mealCombinationUtils.js`

- [ ] **Step 1: Write failing utility tests**

Cover:

- `scaleNutrition(nutrition, factor)` keeps 2 decimals for calories, protein, naturalProtein, specialProtein, carbs, fat, fiber, and sodium.
- `scaleNutrition()` scales `naturalProtein` and `specialProtein` from planned values, not from unscaled top-level item fields.
- `scaleNutrition()` keeps `calories` at 2 decimals instead of rounding it to an integer.
- `calculateActualMealItems(items, 50)` keeps planned fields and returns actual `quantity` and `nutrition` scaled to 50%.
- `calculateActualMealItems(items, 50)` returns actual top-level `naturalProtein` and `specialProtein` that match scaled `nutrition.naturalProtein` and `nutrition.specialProtein`.
- A multi-food meal with fractional calories preserves 2-decimal actual calories per item so `daily_summary_v2` can round after aggregation.
- `validateCompletionPercent()` accepts `1` through `100`, rejects empty values, `0`, negatives, and greater than `100`.
- `buildMealCombinationFromDraft(mealDraft, name)` stores current meal items as `plannedQuantity` and food snapshots.
- `buildMealItemsFromCombination(combination, foodCatalog)` prefers current `food_catalog` data by `foodId`.
- `buildMealItemsFromCombination()` falls back to the combination snapshot if the food is no longer in the catalog.
- Applying a combination appends new local IDs and does not mutate input combination items.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/meal-combination-utils.test.js
```

Expected: FAIL because `miniprogram/utils/mealCombinationUtils.js` does not exist.

---

## Task 4: Implement Meal Combination Utilities

**Files:**
- Create: `miniprogram/utils/mealCombinationUtils.js`
- Test: `tests/meal-combination-utils.test.js`

- [ ] **Step 1: Implement rounding and validation helpers**

Export helpers:

```js
function roundNumber(value, precision = 2) {}
function scaleNutrition(nutrition = {}, factor = 1) {}
function normalizeCompletionPercent(value, fallback = 100) {}
function validateCompletionPercent(value) {}
```

Implementation notes:

- Use numeric conversion that treats empty/invalid values as invalid for validation.
- `validateCompletionPercent()` should return a structured result such as `{ valid: true, value: 50 }` or `{ valid: false, message: '请输入 1-100 的吃完比例' }`.
- Store calories with 2 decimals in actual records; UI can still round for display.
- Do not call the existing page-level `roundCalories()` inside this utility. The utility stores actual nutrition values; display code can round calories for presentation later.

- [ ] **Step 2: Implement conversion helpers**

Export:

```js
module.exports = {
  roundNumber,
  scaleNutrition,
  normalizeCompletionPercent,
  validateCompletionPercent,
  createEmptyMealSummary,
  calculateMealSummary,
  calculateActualMealItems,
  buildMealCombinationFromDraft,
  buildMealItemsFromCombination
};
```

Implementation notes:

- Move or mirror existing `createEmptyMealSummary()` and `calculateMealSummary()` semantics from `meal-editor-v2`.
- `calculateMealSummary(items)` should sum each item’s `nutrition`.
- `calculateActualMealItems(items, completionPercent)` should read plan fields from `plannedQuantity/plannedNutrition` if present, otherwise from `quantity/nutrition`.
- `calculateActualMealItems()` should set actual item top-level `naturalProtein` and `specialProtein` from scaled actual nutrition so old payload builders cannot accidentally write unscaled protein splits.
- `buildMealCombinationFromDraft()` must store planned nutrition with `naturalProtein` and `specialProtein` included.
- `buildMealCombinationFromDraft()` should reject empty item lists at the page layer, but the utility should still normalize safely.
- `buildMealItemsFromCombination()` should create items compatible with existing `mealDraft.items`.

- [ ] **Step 3: Run focused utility tests**

Run:

```bash
node --test tests/meal-combination-utils.test.js
```

Expected: PASS.

---

## Task 5: Extend Food Intake Record Model For Planned Fields

**Files:**
- Modify: `miniprogram/models/foodIntakeRecord.js`
- Modify: `tests/food-intake-record-v2.test.js`

- [ ] **Step 1: Write failing food intake model tests**

Add coverage:

- `createFoodIntake()` preserves `plannedQuantity`, `plannedNutrition`, `completionPercent`, and `mealCombinationSource`.
- `updateFoodIntake()` normalizes those same fields and strips unsafe keys.
- `findByDate()` returns normalized planned fields for display and edit.
- Existing records without planned fields still normalize with `plannedQuantity` omitted or defaulted in a backward-compatible way. Recommendation: normalize missing `completionPercent` to `100`, but do not invent `plannedQuantity` inside the model; let the editor fallback decide.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
node --test tests/food-intake-record-v2.test.js
```

Expected: FAIL because new fields are not normalized or asserted yet.

- [ ] **Step 3: Implement model normalization**

Implementation notes:

- Add `normalizeMealCombinationSource(source = {})`.
- Add `normalizePlannedNutrition(nutrition = {})` using the same nutrition keys as actual nutrition plus `sodium` if passed.
- Add `plannedQuantity: toNumber(record.plannedQuantity, undefined)` only if field exists; avoid silently turning unknown planned quantity into `0`.
- Add `completionPercent: toNumber(record.completionPercent, 100)`.
- Preserve `mealCombinationSource` with `combinationId` and `combinationName`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/food-intake-record-v2.test.js
```

Expected: PASS.

---

## Task 6: Add Completion Percent To Meal Editor

**Files:**
- Modify: `miniprogram/pages/meal-editor-v2/index.js`
- Modify: `miniprogram/pages/meal-editor-v2/index.wxml`
- Modify: `miniprogram/pages/meal-editor-v2/index.wxss`
- Create: `tests/meal-editor-v2-completion-percent.test.js`
- Test: `tests/data-records-v2-food-intakes.test.js`

- [ ] **Step 1: Write failing page tests**

Cover:

- New editor instances default `completionPercent` to `100`.
- Saving with `100` writes `plannedQuantity === quantity` and `plannedNutrition === nutrition`.
- Saving with `50` writes actual `quantity` and `nutrition` at 50%, while planned fields keep original values.
- Saving with `50` also writes top-level `naturalProtein` and `specialProtein` at 50%, matching `nutrition.naturalProtein` and `nutrition.specialProtein`.
- Saving with `75` on foods with fractional calories preserves 2-decimal `nutrition.calories`; it must not round calories to an integer before saving.
- A multi-food meal with fractional calories stores actual per-item calories with 2 decimals and leaves integer rounding to summary/display.
- Invalid completion percent blocks save and shows a toast.
- Editing an existing v2 meal with planned fields restores `completionPercent` and planned items.
- Editing an existing v2 meal without planned fields falls back to `completionPercent: 100` and treats existing actual values as planned.
- Multiple inconsistent `completionPercent` values under the same `mealBatchId` restore the first valid value and rewrite all items with one value on save.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/meal-editor-v2-completion-percent.test.js
```

Expected: FAIL because editor state and save payload do not support completion percentage.

- [ ] **Step 3: Refactor editor summary helpers to use utilities**

Implementation notes:

- Import from `../../utils/mealCombinationUtils`.
- Replace local `createEmptyMealSummary()` and `calculateMealSummary()` only if this can be done safely; otherwise keep wrappers that call the shared utility to minimize page churn.
- Add data fields:
  - `completionPercent: 100`
  - `completionPercentOptions: [100, 75, 50]`
  - `plannedMealSummary`
  - `actualMealSummary`
- Keep existing `mealSummary` as the planned summary or alias it to `plannedMealSummary` to reduce WXML churn.

- [ ] **Step 4: Add completion percent handlers**

Add page methods:

- `onCompletionPercentTap(e)`
- `onCompletionPercentInput(e)`
- `refreshMealSummaries(items = this.data.mealDraft.items, completionPercent = this.data.completionPercent)`

Implementation notes:

- `refreshMealSummaries()` calculates planned summary from plan items and actual summary from scaled items.
- Trigger refresh after adding, editing, removing, applying combinations, and editing completion percent.

- [ ] **Step 5: Update save payload**

Implementation notes:

- `buildMealIntakes(mealBatchId)` should keep plan fields on each intake:
  - `plannedQuantity`
  - `plannedNutrition`
  - `completionPercent`
  - `mealCombinationSource`
- `buildV2FoodIntakePayload()` should write actual `quantity` and `nutrition`, plus planned fields.
- `buildV2FoodIntakePayload()` must derive actual `naturalProtein` and `specialProtein` only from the scaled actual item/nutrition values.
- Do not use `roundCalories()` for stored `plannedNutrition.calories` or actual `nutrition.calories`; use the shared utility rounding to 2 decimals.
- Keep `source: 'meal_editor_v2'`; do not overwrite it with combination source.
- Mark `daily_summary_v2` dirty as already done.

- [ ] **Step 6: Update WXML/WXSS**

UI requirements:

- In the “餐次设置” card, add:
  - Label: `吃完比例`
  - Chips: `100%`, `75%`, `50%`
  - Digit input for custom percent
- In summary area, show:
  - `准备量`
  - `实际计入`
- Keep footer buttons accessible and avoid crowding on small screens.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/meal-editor-v2-completion-percent.test.js tests/data-records-v2-food-intakes.test.js
```

Expected: PASS.

---

## Task 7: Add Meal Combination Actions To Meal Editor

**Files:**
- Modify: `miniprogram/pages/meal-editor-v2/index.js`
- Modify: `miniprogram/pages/meal-editor-v2/index.wxml`
- Modify: `miniprogram/pages/meal-editor-v2/index.wxss`
- Create: `tests/meal-editor-v2-combinations.test.js`
- Test: `tests/meal-combination-model.test.js`
- Test: `tests/meal-combination-utils.test.js`

- [ ] **Step 1: Write failing editor combination tests**

Cover:

- `onLoad()` loads active combinations for the current baby.
- `openCombinationDrawer()` shows available combinations.
- Selecting a combination appends all combination items to existing `mealDraft.items`.
- Newly appended items carry `mealCombinationSource: { combinationId, combinationName }`.
- Applying a combination increments usage.
- If a combination item’s `foodId` exists in `foodCatalog`, current catalog nutrition is used.
- If not, snapshot nutrition is used.
- `saveCurrentMealAsCombination()` creates a `meal_combinations` document from current plan items.
- Saving a combination requires a non-empty user-entered name; empty names show a toast and do not write.
- Saving a combination does not save the current meal record.
- Deleting a combination from the drawer soft deletes it and refreshes the list.
- Saving the meal after applying a combination writes `mealCombinationSource` to each created `food_intake_records` document.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/meal-editor-v2-combinations.test.js
```

Expected: FAIL because the editor does not use `MealCombinationModel` yet.

- [ ] **Step 3: Wire model and state**

Implementation notes:

- Import `MealCombinationModel`.
- Add data fields:
  - `mealCombinations: []`
  - `combinationDrawerVisible: false`
  - `isCombinationSaving: false`
- Add `loadMealCombinations()` after `loadFoodCatalog()` in `onLoad()` and `onShow()`.
- Avoid querying combinations when `babyUid` is missing.

- [ ] **Step 4: Add apply/delete/save methods**

Add page methods:

- `openCombinationDrawer()`
- `closeCombinationDrawer()`
- `applyMealCombination(e)`
- `promptSaveMealCombination()`
- `saveCurrentMealAsCombination(name)`
- `deleteMealCombination(e)`

Implementation notes:

- Implement a lightweight name input state inside `meal-editor-v2`; do not rely on `wx.showModal` for text input because it cannot collect a custom name.
- Add state such as `combinationNameInputVisible`, `combinationNameInput`, and `combinationNameError`.
- Recommended prefilled name: `${mealDraft.mealLabel || '餐食'}菜谱`.
- Validate the name before create: trim whitespace, reject empty names, and show `请输入菜谱名称`.
- After applying, append items and call `refreshMealSummaries()`.
- After applying, each appended item must keep `mealCombinationSource` so Task 6 can persist it to `food_intake_records`.
- After saving or deleting, reload combinations.

- [ ] **Step 5: Update WXML/WXSS**

UI requirements:

- Add a secondary action near “本顿食物”: `从菜谱添加`.
- Add a small text action: `保存为菜谱`.
- Add drawer/list cards:
  - Combination name
  - Item count
  - Brief item preview such as `米粉 20g、苹果泥 30g`
  - `使用` action
  - optional `删除` action

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/meal-editor-v2-combinations.test.js tests/meal-combination-model.test.js tests/meal-combination-utils.test.js
```

Expected: PASS.

---

## Task 8: Preserve And Display Planned Vs Actual In Data Records

**Files:**
- Modify: `miniprogram/pages/data-records/index.js`
- Modify: `miniprogram/pages/data-records/index.wxml`
- Modify: `miniprogram/pages/data-records/index.wxss`
- Modify: `tests/data-records-v2-food-intakes.test.js`

- [ ] **Step 1: Write failing data-records tests**

Cover:

- `adaptV2FoodIntakeToLegacyIntake()` or equivalent adapter preserves:
  - `plannedQuantity`
  - `plannedNutrition`
  - `completionPercent`
  - `mealCombinationSource`
- `groupFoodIntakesByMeal()` exposes group-level `completionPercent` when group records agree.
- Group summary uses actual nutrition, not planned nutrition.
- WXML contains display copy for `吃了 {{completionPercent}}%`.
- If planned fields are missing, display remains compatible with existing records.
- Legacy v1 `feeding_records.intakes` records do not show completion/planned copy and keep existing group/edit behavior.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test tests/data-records-v2-food-intakes.test.js tests/data-records-v2.test.js
```

Expected: FAIL because planned fields are not yet preserved or rendered.

- [ ] **Step 3: Update adapters and grouping**

Implementation notes:

- Preserve new fields in the v2 food adapter near existing `quantity`, `nutrition`, and `mealBatchId` mapping.
- In `groupFoodIntakesByMeal()`, compute:
  - `completionPercent`
  - `plannedSummary`
  - `actualSummary`
  - `completionText`
  - `preparedText`
- If records in a group have inconsistent completion percentages, use the first valid one for display and avoid throwing.
- Gate completion/planned display to v2 food groups or to records that actually have planned fields; do not change legacy v1 food display.

- [ ] **Step 4: Update WXML/WXSS**

Display recommendation:

- In each v2 meal group header or metadata:
  - `吃了 50%`
  - `实际 36 kcal · 蛋白 0.7g`
- Per item secondary copy:
  - `准备 20g，实际按 10g 计入`

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests/data-records-v2-food-intakes.test.js tests/data-records-v2.test.js
```

Expected: PASS.

---

## Task 9: Verify Daily Summary Uses Actual Nutrition

**Files:**
- Modify: `tests/daily-summary-v2-utils.test.js`
- Possibly Modify: `miniprogram/utils/dailySummaryV2Utils.js` only if tests reveal planned fields are accidentally included.

- [ ] **Step 1: Add summary regression tests**

Cover:

- A food record with `plannedNutrition.calories: 72` and actual `nutrition.calories: 36` contributes `36` to `daily_summary_v2.food.calories`.
- Planned protein is ignored; actual protein is counted.
- `recordCounts.food` remains the number of food intake documents, not the number of combinations.

- [ ] **Step 2: Run test**

Run:

```bash
node --test tests/daily-summary-v2-utils.test.js
```

Expected: PASS if current builder already uses actual `nutrition` only. If it fails, update `mergeFoodNutrition()` to ignore planned fields explicitly.

- [ ] **Step 3: Run combined v2 food tests**

Run:

```bash
node --test tests/meal-combination-model.test.js tests/meal-combination-utils.test.js tests/meal-editor-v2-combinations.test.js tests/meal-editor-v2-completion-percent.test.js tests/data-records-v2-food-intakes.test.js tests/daily-summary-v2-utils.test.js
```

Expected: PASS.

---

## Task 10: Final Regression And Manual Checks

**Files:**
- Modify: `docs/miniprogram/data-schema-guidelines.md` or Create: `docs/miniprogram/v2-cloud-database-checklist.md`
- No code changes unless regressions are found.

- [ ] **Step 1: Document cloud database requirements**

Document:

- Required collection: `meal_combinations`.
- Recommended index: `babyUid + status + updatedAt desc`.
- Optional index: `babyUid + status + lastUsedAt desc`.
- Access note: records should be scoped by `babyUid`, following the same collaboration assumptions as `food_catalog` and `food_intake_records`.
- Rollout note: create the collection/index before enabling the UI.

- [ ] **Step 2: Run focused regression suite**

Run:

```bash
node --test tests/food-intake-record-v2.test.js tests/daily-record-v2-service.test.js tests/data-records-v2.test.js tests/data-records-v2-food-intakes.test.js tests/meal-combination-model.test.js tests/meal-combination-utils.test.js tests/meal-editor-v2-combinations.test.js tests/meal-editor-v2-completion-percent.test.js tests/daily-summary-v2-utils.test.js
```

Expected: PASS.

- [ ] **Step 3: Run broad test suite if time permits**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS, or document unrelated pre-existing failures.

- [ ] **Step 4: Manual mini program checks**

Manual checklist:

- Open v2 meal editor for today.
- Add two food items manually.
- Save as a 菜谱.
- Start another meal, apply the 菜谱.
- Add one extra food manually.
- Set `吃完比例` to `50%`.
- Save the meal.
- Open v2 data records and verify:
  - The meal appears as one group.
  - It says `吃了 50%`.
  - Item copy shows prepared vs actual amounts.
  - Daily summary totals use actual intake only.
- Edit that meal and verify:
  - Completion percent restores to `50%`.
  - Planned item quantities restore to the prepared amounts.
  - Saving again keeps one consistent percentage on all records.

---

## Rollback Strategy

- If 菜谱 UI has issues, hide “从菜谱添加” and “保存为菜谱”; existing v2 food recording still works.
- If completion percentage calculation has issues, set `completionPercent` default and UI to `100` and keep planned fields ignored until fixed.
- `food_intake_records.quantity` and `nutrition` remain actual source-of-truth fields, so `daily_summary_v2` can be rebuilt from existing records after fixes.
- `meal_combinations` can be left unused without affecting historical intake records.

## Verification Summary

Minimum required automated verification before declaring implementation ready:

```bash
node --test tests/meal-combination-model.test.js
node --test tests/meal-combination-utils.test.js
node --test tests/meal-editor-v2-combinations.test.js
node --test tests/meal-editor-v2-completion-percent.test.js
node --test tests/food-intake-record-v2.test.js
node --test tests/data-records-v2-food-intakes.test.js
node --test tests/daily-summary-v2-utils.test.js
```

Recommended broader verification:

```bash
node --test tests/food-intake-record-v2.test.js tests/daily-record-v2-service.test.js tests/data-records-v2.test.js tests/data-records-v2-food-intakes.test.js tests/meal-combination-model.test.js tests/meal-combination-utils.test.js tests/meal-editor-v2-combinations.test.js tests/meal-editor-v2-completion-percent.test.js tests/daily-summary-v2-utils.test.js
node --test tests/*.test.js
```
