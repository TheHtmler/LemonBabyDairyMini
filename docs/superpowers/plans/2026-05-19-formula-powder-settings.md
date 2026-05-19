# Formula Powder Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed "普奶 / 特奶" setting model with user-maintained formula powder profiles and reusable mixing plans, while keeping old feeding records readable.

**Architecture:** Add a normalized settings layer inside `nutritionSettings`: `formulaPowders` stores powder profiles, `mixingPlans` stores reusable combinations, and existing `formula_milk_*` / `special_milk_*` fields remain as legacy compatibility fields. Calculation code reads through a single adapter so old records and new records can be summarized with the same nutrient output.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, CommonJS modules, `node:test`, cloud database documents under `baby_info.nutritionSettings` and `nutrition_settings`.

---

## File Structure

- Create `miniprogram/utils/formulaPowderUtils.js`
  - Owns profile normalization, legacy default profile generation, mixing plan validation, nutrient preview, and old feeding conversion helpers.
- Modify `miniprogram/models/nutrition.js`
  - Extends default and normalized settings with `formulaPowders`, `mixingPlans`, and `activeMixingPlanId`.
  - Keeps writing old scalar fields for compatibility.
- Modify `miniprogram/pages/nutrition-settings/index.js`
  - Changes page state from three fixed tabs to settings overview, powder profile list, and mixing plan editor state.
  - Adds add/edit/delete methods for formula powder profiles and mixing plans.
- Modify `miniprogram/pages/nutrition-settings/index.wxml`
  - Implements the three-screen interaction in one page: overview, profiles, plan editor.
- Modify `miniprogram/pages/nutrition-settings/index.wxss`
  - Adds card/list/editor styles aligned with existing lemon theme.
- Extend `miniprogram/utils/feedingUtils.js`
  - Adds `getFormulaComponents`, `calculateFormulaComponentNutrition`, and `calculateFeedingMilkNutrition`.
  - Leaves existing helpers intact for current callers.
- Create `tests/formula-powder-utils.test.js`
  - Tests new pure utility behavior and legacy conversion.
- Create `tests/nutrition-settings-formula-powders.test.js`
  - Tests setting model normalization and page structure.
- Extend `tests/feeding-utils-compat.test.js`
  - Tests old record and new `formulaComponents` records produce compatible totals.

---

## Data Contract

### Formula Powder Profile

```js
{
  id: 'powder_formula_default',
  name: '默认普通配方粉',
  category: 'regular_formula', // regular_formula | special_formula | energy_supplement
  proteinRole: 'natural', // natural | special | none
  nutritionPer100g: {
    protein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0
  },
  mixRatio: {
    powder: 0,
    water: 0
  },
  status: 'active', // active | archived
  source: 'legacy', // legacy | user
  createdAt: null,
  updatedAt: null,
  deletedAt: null
}
```

### Mixing Plan

```js
{
  id: 'plan_default_morning',
  name: '上午奶 120ml',
  components: [
    { kind: 'breast_milk', volume: 40 },
    {
      kind: 'formula_powder',
      powderId: 'powder_formula_default',
      waterVolume: 30,
      powderWeight: 4.5,
      ratioMode: 'standard'
    }
  ],
  enabled: true,
  createdAt: null,
  updatedAt: null
}
```

### Feeding Record Forward Contract

New records can later store:

```js
{
  formulaComponents: [
    { kind: 'breast_milk', volume: 40 },
    {
      kind: 'formula_powder',
      powderId: 'powder_special_default',
      powderName: '特奶',
      category: 'special_formula',
      proteinRole: 'special',
      waterVolume: 50,
      powderWeight: 7.5,
      nutritionSnapshot: {
        protein: 12.5,
        calories: 520,
        fat: 0,
        carbs: 0,
        fiber: 0
      }
    }
  ]
}
```

Old records keep using `naturalMilkType`, `naturalMilkVolume`, `formulaPowderWeight`, `specialMilkVolume`, and `specialMilkPowder`.

---

## Task 1: Add Pure Formula Powder Utilities

**Files:**
- Create: `miniprogram/utils/formulaPowderUtils.js`
- Test: `tests/formula-powder-utils.test.js`

- [ ] **Step 1: Write failing tests for profile normalization**

Cover:
- Empty settings returns no user profiles.
- Legacy `formula_milk_*` creates a regular formula profile with `proteinRole: 'natural'`.
- Legacy `special_milk_*` creates a special formula profile with `proteinRole: 'special'`.
- Energy supplement profile accepts `proteinRole: 'none'` and still contributes calories.

Run: `node --test tests/formula-powder-utils.test.js`
Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement utility skeleton**

Export:

```js
module.exports = {
  POWDER_CATEGORIES,
  PROTEIN_ROLES,
  normalizeFormulaPowders,
  createLegacyFormulaPowders,
  normalizeMixingPlans,
  calculatePowderNutrition,
  calculateMixingPlanPreview,
  createFormulaComponentsFromLegacyFeeding
};
```

- [ ] **Step 3: Implement nutrient calculation**

Rules:
- `proteinRole: 'natural'` adds to `naturalProtein`.
- `proteinRole: 'special'` adds to `specialProtein`.
- `proteinRole: 'none'` does not add protein buckets.
- All enabled profiles can add calories, fat, carbs, and fiber when values exist.
- Round public totals to 2 decimals.

- [ ] **Step 4: Run tests**

Run: `node --test tests/formula-powder-utils.test.js`
Expected: PASS.

---

## Task 2: Normalize Nutrition Settings Without Breaking Legacy Fields

**Files:**
- Modify: `miniprogram/models/nutrition.js`
- Test: `tests/nutrition-settings-formula-powders.test.js`

- [ ] **Step 1: Write failing model tests**

Cover:
- `createDefaultSettings()` includes `formulaPowders: []`, `mixingPlans: []`, and `activeMixingPlanId: ''`.
- `normalizeSettings()` preserves existing scalar fields and normalizes arrays.
- A settings object with only legacy formula/special fields can expose generated default powder profiles.
- `updateNutritionSettings()` still writes old scalar fields into `nutrition_settings`.

Run: `node --test tests/nutrition-settings-formula-powders.test.js`
Expected: FAIL.

- [ ] **Step 2: Import formula powder utilities**

Use `normalizeFormulaPowders`, `createLegacyFormulaPowders`, and `normalizeMixingPlans`.

- [ ] **Step 3: Extend default settings**

Add:

```js
formulaPowders: [],
mixingPlans: [],
activeMixingPlanId: ''
```

- [ ] **Step 4: Extend `normalizeSettings()`**

Keep all existing fields. Append:

```js
const explicitPowders = normalizeFormulaPowders(settings.formulaPowders || []);
const legacyPowders = createLegacyFormulaPowders(settings);
const normalizedPowders = explicitPowders.length > 0 ? explicitPowders : legacyPowders;
```

Set:

```js
formulaPowders: normalizedPowders,
mixingPlans: normalizeMixingPlans(settings.mixingPlans || [], normalizedPowders),
activeMixingPlanId: settings.activeMixingPlanId || ''
```

- [ ] **Step 5: Run model tests**

Run: `node --test tests/nutrition-settings-formula-powders.test.js`
Expected: PASS.

---

## Task 3: Add Unified Feeding Nutrition Calculation

**Files:**
- Modify: `miniprogram/utils/feedingUtils.js`
- Extend: `tests/feeding-utils-compat.test.js`

- [ ] **Step 1: Write failing feeding compatibility tests**

Cover:
- Legacy breast + special feeding returns correct total volume and protein buckets.
- Legacy formula + special feeding creates natural and special protein from old fields.
- New `formulaComponents` with regular formula, special formula, and energy supplement returns natural protein, special protein, zero-protein calories, total calories, total volume, powder total.

Run: `node --test tests/feeding-utils-compat.test.js`
Expected: FAIL for new APIs.

- [ ] **Step 2: Add `calculator.getFormulaComponents()`**

Behavior:
- If `feeding.formulaComponents` is a non-empty array, normalize and return it.
- Otherwise convert old fields using `createFormulaComponentsFromLegacyFeeding(feeding, calculation_params)`.

- [ ] **Step 3: Add `calculator.calculateFeedingMilkNutrition()`**

Return shape:

```js
{
  totalVolume,
  totalPowderWeight,
  protein,
  naturalProtein,
  specialProtein,
  calories,
  fat,
  carbs,
  fiber,
  zeroProteinCalories
}
```

- [ ] **Step 4: Keep existing helpers**

Do not remove `getTotalVolume`, `getSpecialMilkPowder`, or `getFormulaMilkPowder`; make them compatible with `formulaComponents` where low risk.

- [ ] **Step 5: Run feeding tests**

Run: `node --test tests/feeding-utils-compat.test.js`
Expected: PASS.

---

## Task 4: Rework Nutrition Settings Page Into Overview + Profiles + Plans

**Files:**
- Modify: `miniprogram/pages/nutrition-settings/index.js`
- Modify: `miniprogram/pages/nutrition-settings/index.wxml`
- Modify: `miniprogram/pages/nutrition-settings/index.wxss`
- Extend: `tests/nutrition-settings-formula-powders.test.js`

- [ ] **Step 1: Write failing page structure tests**

Assert WXML contains:
- `配方粉档案`
- `常用配奶方案`
- `普通配方粉`
- `特殊配方粉`
- `能量补充粉`
- `无蛋白·计热量`
- `添加组成`
- `营养预览`

Assert WXML no longer presents top-level tabs as only `普奶` and `特奶`.

- [ ] **Step 2: Update page state**

Use:

```js
activeView: 'overview', // overview | powders | planEditor
editingPowder: null,
editingPlan: null,
selectedPowderCategory: 'regular_formula'
```

Keep `activeTab: 'mother'` only if needed for mother milk editing inside the new page.

- [ ] **Step 3: Add powder actions**

Methods:
- `showPowderList`
- `showOverview`
- `startAddPowder`
- `startEditPowder`
- `savePowderDraft`
- `deletePowder`
- `onPowderCategoryChange`
- `onPowderProteinRoleChange`

- [ ] **Step 4: Add mixing plan actions**

Methods:
- `showPlanEditor`
- `startAddPlan`
- `startEditPlan`
- `savePlanDraft`
- `deletePlan`
- `addPlanComponent`
- `updatePlanComponent`
- `removePlanComponent`

- [ ] **Step 5: Preserve old setup flow**

When `fromSetup=true`, saving still switches to `/pages/daily-feeding/index`.

- [ ] **Step 6: Run page tests**

Run: `node --test tests/nutrition-settings-formula-powders.test.js`
Expected: PASS.

---

## Task 5: Verification Pass

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test tests/formula-powder-utils.test.js tests/nutrition-settings-formula-powders.test.js tests/feeding-utils-compat.test.js
```

Expected: PASS.

- [ ] **Step 2: Run related existing tests**

Run:

```bash
node --test tests/milk-feeding-editor.test.js tests/data-records-summary-preview.test.js tests/report-workbench-data.test.js
```

Expected: PASS.

- [ ] **Step 3: Manual Mini Program check**

In WeChat developer tools:
- Open `配奶设置`.
- Confirm old mother milk defaults display.
- Add one `普通配方粉`.
- Add one `特殊配方粉`.
- Add one `能量补充粉`.
- Create one mixing plan with all three.
- Confirm preview shows natural protein, special protein, zero-protein calories, and total calories.
- Save settings and reload page.
- Confirm saved profiles and plan render.

---

## Out Of Scope For This First Pass

- Full replacement of `milk-feeding-editor` with multi-component entry.
- Batch migration of historical `feeding_records`.
- Deleting old `formula_milk_*` or `special_milk_*` fields.
- Cloud migration functions for all users.
- Drag sorting in the plan editor. Use simple list order first.

---

## Rollback Strategy

- Because old scalar settings are retained, disabling the new UI can fall back to current `formula_milk_*` and `special_milk_*` behavior.
- Historical feeding records are not rewritten.
- New functions should be pure and covered by tests, so calculation regressions can be isolated to `formulaPowderUtils` or the new `calculateFeedingMilkNutrition` adapter.
