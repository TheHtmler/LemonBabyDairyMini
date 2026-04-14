# Milk Feeding Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new standalone milk feeding editor page for formula and special milk with water/powder bidirectional entry, while preserving the existing modal flow and making nutrition calculations prefer explicitly recorded powder weights.

**Architecture:** Keep the current `feeding-modal` flow intact and add a parallel page-level editor that owns its own form state, validation, ratio conversion, preview, and save path. Reuse the existing `feeding_records` daily document model, add only a new entry button from `daily-feeding`, and upgrade shared calculation helpers so saved explicit powder weight becomes the source of truth for nutrition while water volume remains the intake volume.

**Tech Stack:** WeChat Mini Program native pages/components, cloud database, shared utility modules in `miniprogram/utils`, Node test suite

---

### Task 1: Lock the New Navigation and Save Contract in Tests

**Files:**
- Modify: `tests/feeding-field-write-contract.test.js`
- Create or modify: `tests/milk-feeding-editor.test.js`
- Test: `tests/feeding-field-write-contract.test.js`, `tests/milk-feeding-editor.test.js`

- [ ] **Step 1: Write the failing navigation and source-contract tests**

Add assertions that:
- `daily-feeding` contains a new quick-action button and navigation method for the new page
- `app.json` registers `pages/milk-feeding-editor/index`
- the new page source writes `formulaPowderWeight` for formula and `specialMilkPowder` for special milk
- the new page saves intake volume from actual water volume

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js`
Expected: FAIL with missing page/button/method/source matches

- [ ] **Step 3: Add the minimal test scaffolding**

Use source-based assertions consistent with the current repository style. Keep tests narrow and tied to the agreed behavior only.

- [ ] **Step 4: Run tests again to verify the red state is correct**

Run: `npm test -- tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js`
Expected: FAIL only because the implementation is not present yet

- [ ] **Step 5: Commit**

```bash
git add tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js
git commit -m "test: define milk feeding editor contracts"
```

### Task 2: Add Shared Ratio and Powder-Priority Helpers

**Files:**
- Modify: `miniprogram/utils/feedingUtils.js`
- Test: `tests/feeding-utils-compat.test.js`, `tests/milk-feeding-editor.test.js`

- [ ] **Step 1: Write the failing helper tests**

Add tests for:
- converting water to powder using a ratio
- converting powder to water using a ratio
- preferring explicit formula powder weight over ratio-derived powder
- preferring explicit special milk powder over ratio-derived powder
- keeping volume semantics as actual water volume

- [ ] **Step 2: Run tests to verify helper failures**

Run: `npm test -- tests/feeding-utils-compat.test.js tests/milk-feeding-editor.test.js`
Expected: FAIL with missing helper behavior or wrong priority rules

- [ ] **Step 3: Implement the minimal helper changes**

In `miniprogram/utils/feedingUtils.js`:
- add ratio conversion helpers for `water -> powder` and `powder -> water`
- add a formula powder getter that prefers explicit `formulaPowderWeight`
- keep special milk powder getter preferring explicit stored values
- avoid changing existing field semantics for legacy records

- [ ] **Step 4: Run the helper tests to verify green**

Run: `npm test -- tests/feeding-utils-compat.test.js tests/milk-feeding-editor.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/feedingUtils.js tests/feeding-utils-compat.test.js tests/milk-feeding-editor.test.js
git commit -m "feat: add milk ratio conversion helpers"
```

### Task 3: Create the Standalone Milk Feeding Editor Page

**Files:**
- Create: `miniprogram/pages/milk-feeding-editor/index.js`
- Create: `miniprogram/pages/milk-feeding-editor/index.wxml`
- Create: `miniprogram/pages/milk-feeding-editor/index.wxss`
- Create: `miniprogram/pages/milk-feeding-editor/index.json`
- Modify: `miniprogram/app.json`
- Test: `tests/milk-feeding-editor.test.js`

- [ ] **Step 1: Write the failing page-structure tests**

Add assertions that the new page:
- is registered in `app.json`
- includes milk-kind selection, time input, water input, powder input, restore-standard-ratio action, notes input, and save action
- uses page-level state instead of the existing `feeding-modal`

- [ ] **Step 2: Run tests to verify page-structure failures**

Run: `npm test -- tests/milk-feeding-editor.test.js`
Expected: FAIL because the page files and route do not exist

- [ ] **Step 3: Implement the minimal page shell**

Create the page with:
- formula/special switch
- time field
- water and powder inputs
- ratio info display
- restore-standard-ratio button
- nutrition preview block
- notes input
- save button

Do not wire persistence yet beyond state preparation if not needed for this step.

- [ ] **Step 4: Run tests to verify the page shell passes**

Run: `npm test -- tests/milk-feeding-editor.test.js`
Expected: PASS for structure assertions, with save-path assertions still failing if separated

- [ ] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/pages/milk-feeding-editor/index.js miniprogram/pages/milk-feeding-editor/index.wxml miniprogram/pages/milk-feeding-editor/index.wxss miniprogram/pages/milk-feeding-editor/index.json tests/milk-feeding-editor.test.js
git commit -m "feat: scaffold milk feeding editor page"
```

### Task 4: Add Daily-Feeding Entry and Navigation

**Files:**
- Modify: `miniprogram/pages/daily-feeding/index.wxml`
- Modify: `miniprogram/pages/daily-feeding/index.js`
- Test: `tests/feeding-field-write-contract.test.js`

- [ ] **Step 1: Write the failing entry-point test**

Assert that `daily-feeding`:
- renders a new quick-action button near the meal-editor entry
- navigates to `/pages/milk-feeding-editor/index`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/feeding-field-write-contract.test.js`
Expected: FAIL on missing button or missing navigation method

- [ ] **Step 3: Implement the minimal navigation changes**

Add:
- a new quick-action button in `daily-feeding/index.wxml`
- a navigation method in `daily-feeding/index.js`

Keep the existing “添加喂奶” modal button untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/feeding-field-write-contract.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/daily-feeding/index.wxml miniprogram/pages/daily-feeding/index.js tests/feeding-field-write-contract.test.js
git commit -m "feat: add milk feeding editor entry"
```

### Task 5: Implement Page-Level Bidirectional Water/Powder Editing and Save

**Files:**
- Modify: `miniprogram/pages/milk-feeding-editor/index.js`
- Modify: `miniprogram/pages/milk-feeding-editor/index.wxml`
- Possibly modify: `miniprogram/utils/feedingRecordStore.js`
- Test: `tests/milk-feeding-editor.test.js`

- [ ] **Step 1: Write the failing behavior tests for page save logic**

Add assertions that the page source:
- tracks `lastEditedField`
- recalculates powder from water and water from powder
- exposes a restore-standard-ratio action
- saves formula using `naturalMilkVolume + formulaPowderWeight`
- saves special using `specialMilkVolume + specialMilkPowder`
- uses `totalVolume` equal to actual water volume

- [ ] **Step 2: Run the tests to verify the red state**

Run: `npm test -- tests/milk-feeding-editor.test.js`
Expected: FAIL on missing state/update/save behavior

- [ ] **Step 3: Implement minimal page behavior**

In the new page:
- load nutrition settings and recent defaults
- maintain `milkKind`, `waterVolume`, `powderWeight`, `lastEditedField`, `recordTime`, `notes`
- implement bidirectional conversion using shared helpers
- implement restore-standard-ratio behavior
- validate required settings before save
- save a feeding entry into the current-day `feeding_records` document using `findOrCreateDailyRecord`

- [ ] **Step 4: Run the tests to verify green**

Run: `npm test -- tests/milk-feeding-editor.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/milk-feeding-editor/index.js miniprogram/pages/milk-feeding-editor/index.wxml miniprogram/utils/feedingRecordStore.js tests/milk-feeding-editor.test.js
git commit -m "feat: save milk feeding editor records"
```

### Task 6: Make Nutrition Calculations Prefer Explicit Powder Weights

**Files:**
- Modify: `miniprogram/pages/daily-feeding/index.js`
- Modify: `miniprogram/pages/data-records/index.js`
- Modify: `miniprogram/utils/feedingUtils.js`
- Test: `tests/feeding-utils-compat.test.js`, `tests/feeding-field-write-contract.test.js`, `tests/milk-feeding-editor.test.js`

- [ ] **Step 1: Write the failing compatibility tests**

Add tests that assert:
- formula nutrition paths prefer explicit `formulaPowderWeight`
- special nutrition paths prefer explicit `specialMilkPowder`
- explicit powder fields are not overwritten by ratio-derived values in summary calculations
- legacy records without powder fields still fall back to ratio-based behavior

- [ ] **Step 2: Run the tests to verify they fail correctly**

Run: `npm test -- tests/feeding-utils-compat.test.js tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js`
Expected: FAIL on the new priority assertions

- [ ] **Step 3: Implement the minimal calculation updates**

Update shared and page-level nutrition calculation paths so:
- intake volume still uses actual water volume
- nutrition uses explicit powder when present
- ratio-based derivation is only fallback behavior

Keep changes focused on milk-related calculations only.

- [ ] **Step 4: Run the targeted tests to verify green**

Run: `npm test -- tests/feeding-utils-compat.test.js tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/daily-feeding/index.js miniprogram/pages/data-records/index.js miniprogram/utils/feedingUtils.js tests/feeding-utils-compat.test.js tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js
git commit -m "feat: prefer explicit powder weights in nutrition calculations"
```

### Task 7: Final Verification

**Files:**
- Verify only: `miniprogram/pages/milk-feeding-editor/*`, `miniprogram/pages/daily-feeding/index.*`, `miniprogram/pages/data-records/index.js`, `miniprogram/utils/feedingUtils.js`, relevant tests

- [ ] **Step 1: Run the focused test suite**

Run: `npm test -- tests/feeding-utils-compat.test.js tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js`
Expected: PASS

- [ ] **Step 2: Run the broader regression suite covering feeding pages**

Run: `npm test -- tests/daily-feeding-layout.test.js tests/daily-feeding-refresh.test.js tests/data-records-layout.test.js`
Expected: PASS

- [ ] **Step 3: Perform a manual smoke checklist**

Verify in the mini program:
- new entry button appears in `daily-feeding`
- new page opens
- formula and special modes both calculate water/powder correctly
- restore-standard-ratio works
- save writes a record and returns cleanly
- existing quick modal flow still works

- [ ] **Step 4: Stage and commit the finishing changes**

```bash
git add miniprogram/app.json miniprogram/pages/milk-feeding-editor miniprogram/pages/daily-feeding/index.js miniprogram/pages/daily-feeding/index.wxml miniprogram/pages/data-records/index.js miniprogram/utils/feedingUtils.js tests/feeding-utils-compat.test.js tests/feeding-field-write-contract.test.js tests/milk-feeding-editor.test.js docs/superpowers/specs/2026-04-15-milk-feeding-editor-design.md docs/superpowers/plans/2026-04-15-milk-feeding-editor.md
git commit -m "feat: add standalone milk feeding editor"
```

