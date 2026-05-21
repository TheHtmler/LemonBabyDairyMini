# Feeding Records v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated v2 milk feeding flow that writes to `feeding_records_v2` and uses `milk_nutrition_profiles` without changing the current `feeding_records` workflow.

**Architecture:** Keep the existing milk feeding page and `feeding_records` collection untouched. Add a new page and menu entry for v2, store each milk feeding as one document in `feeding_records_v2`, and save full formula component snapshots so future profile edits or archives do not affect historical records. Shared utilities should own snapshot building, nutrition summary calculation, and fallback loading for basic info.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, Cloud Database, CommonJS modules, `node:test`.

---

## Product Boundary

- Old entry remains unchanged:
  - Page: `pages/milk-feeding-editor/index`
  - Collection: `feeding_records`
- New entry is isolated:
  - Page: `pages/milk-feeding-editor-v2/index`
  - Collection: `feeding_records_v2`
- New entry reads formula profiles from:
  - Collection: `milk_nutrition_profiles`
  - Only use `formulaPowders` with `status === 'active'` for new selection.
- Do not migrate or rewrite old feeding records in this phase.
- Do not make existing daily-feeding/data-records pages depend on v2 unless adding explicitly named v2 preview/read paths.

---

## Current Hidden Behaviors To Preserve

The current milk feeding editor does more than save milk amounts:

- It writes daily `basicInfo.weight` into `feeding_records`.
- It writes daily protein/calorie coefficients into `feeding_records.basicInfo`.
- It does not directly write `growth_records`.
- It does not directly update `baby_info.weight` or `baby_info.height`.
- Recent/default values are loaded from recent `feeding_records` and then `baby_info`.
- Growth chart uses `feeding_records.basicInfo.weight` as daily weight supplement.
- Edit mode preserves an existing feeding item's `createdAt`.
- New mode creates or updates a day-level record using `findOrCreateDailyRecord`.

v2 should preserve the user-visible behavior, but through a cleaner v2 data model.

---

## v2 Collection Contract

`feeding_records_v2` should store one document per milk feeding.

```js
{
  schemaVersion: 1,
  recordType: 'milk_feeding',
  source: 'milk_feeding_v2',

  babyUid: 'baby_xxx',
  date: '2026-05-20',
  startTime: '08:30',
  endTime: '',
  startDateTime: Date,
  endDateTime: null,

  formulaComponents: [],
  nutritionSummary: {
    totalVolume: 0,
    totalPowderWeight: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    zeroProteinCalories: 0
  },

  basicInfoSnapshot: {
    weight: '',
    height: '',
    naturalProteinCoefficient: '',
    specialProteinCoefficient: '',
    calorieCoefficient: '',
    source: 'manual' // manual | v2_record | legacy_record | baby_info | empty
  },

  notes: '',
  status: 'active',
  createdAt: db.serverDate(),
  updatedAt: db.serverDate(),
  deletedAt: null
}
```

### Component Contract

Breast milk:

```js
{
  kind: 'breast_milk',
  volume: 60,
  nutritionSnapshot: {
    protein: 1.1,
    calories: 67,
    fat: 4,
    carbs: 6.8,
    fiber: 0
  }
}
```

Formula powder:

```js
{
  kind: 'formula_powder',
  powderId: 'powder_1',
  powderName: '普奶 A',
  category: 'regular_formula',
  categoryShortLabel: '普',
  categoryBadgeClass: 'regular',
  proteinRole: 'natural',
  waterVolume: 30,
  powderWeight: 4.5,
  ratioMode: 'standard',
  mixRatioSnapshot: {
    powder: 4.5,
    water: 30
  },
  nutritionSnapshot: {
    protein: 10.6,
    calories: 505,
    fat: 26,
    carbs: 55,
    fiber: 0
  }
}
```

---

## Hidden Behavior Rules For v2

### Basic Info Fallback

When opening the v2 editor, resolve basic info in this order:

1. Same-day `feeding_records_v2.basicInfoSnapshot`.
2. Most recent previous `feeding_records_v2.basicInfoSnapshot`.
3. Same-day or recent legacy `feeding_records.basicInfo`.
4. `baby_info`.
5. Empty fallback.

### Weight And Height

- Save `weight` and `height` into `feeding_records_v2.basicInfoSnapshot`.
- Do not write `growth_records` automatically from ordinary feeding save.
- Do not update `baby_info` automatically from ordinary feeding save.
- Later, growth chart should read `feeding_records_v2.basicInfoSnapshot.weight/height` as supplement data, similar to legacy `feeding_records.basicInfo.weight`.
- If we later add an explicit "保存为测量记录" action, that action can write `growth_records`.

### Nutrition Snapshots

- Every formula powder component must save `nutritionSnapshot`.
- Every formula powder component must save `mixRatioSnapshot`.
- Historical display should prefer snapshots over current profile data.
- If profile is archived later, old records still display normally.

### Status And Deletion

- v2 feeding records use soft delete:
  - active: `status: 'active'`, `deletedAt: null`
  - delete: `status: 'archived'`, `deletedAt: db.serverDate()`
- Normal list and statistics only read `status === 'active'`.

---

## File Structure

- Create `miniprogram/utils/feedingRecordV2Utils.js`
  - Build formula components from selected milk inputs.
  - Build breast milk snapshots.
  - Build formula powder snapshots.
  - Calculate `nutritionSummary`.
  - Normalize `feeding_records_v2` documents for display.
- Create `miniprogram/models/feedingRecordV2.js`
  - Read/write `feeding_records_v2`.
  - Resolve basic info fallback.
  - Add, update, archive records.
- Create `miniprogram/pages/milk-feeding-editor-v2/`
  - `index.js`: page state, profile loading, component editor, save/archive.
  - `index.wxml`: v2 UI.
  - `index.wxss`: v2 styles.
  - `index.json`: title.
- Modify `miniprogram/app.json`
  - Register `pages/milk-feeding-editor-v2/index`.
- Modify `miniprogram/pages/profile/index.js`
  - Add new menu entry for `喂奶记录v2`.
- Test files:
  - `tests/feeding-record-v2-utils.test.js`
  - `tests/feeding-record-v2-model.test.js`
  - `tests/milk-feeding-editor-v2.test.js`
  - `tests/feeding-record-v2-entry.test.js`

---

## Task 1: Define v2 Pure Utilities

**Files:**
- Create: `miniprogram/utils/feedingRecordV2Utils.js`
- Test: `tests/feeding-record-v2-utils.test.js`

- [ ] **Step 1: Write failing tests for component snapshots**

Cover:
- Breast milk component saves volume and nutrition snapshot.
- Formula powder component saves `powderId`, `powderName`, `category`, `categoryShortLabel`, `proteinRole`, `mixRatioSnapshot`, and `nutritionSnapshot`.
- Energy supplement contributes calories but no protein.

Run: `node --test tests/feeding-record-v2-utils.test.js`
Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement utility functions**

Export:

```js
module.exports = {
  buildBreastMilkComponent,
  buildFormulaPowderComponent,
  buildNutritionSummary,
  normalizeFeedingRecordV2
};
```

- [ ] **Step 3: Run tests**

Run: `node --test tests/feeding-record-v2-utils.test.js`
Expected: PASS.

---

## Task 2: Add v2 Data Model

**Files:**
- Create: `miniprogram/models/feedingRecordV2.js`
- Test: `tests/feeding-record-v2-model.test.js`

- [ ] **Step 1: Write failing tests for collection writes**

Cover:
- Add writes to `feeding_records_v2`, not `feeding_records`.
- Add includes `schemaVersion`, `recordType`, `source`, `status`, `createdAt`, `updatedAt`, `deletedAt`.
- Update preserves original `createdAt`.
- Archive writes `status: 'archived'` and `deletedAt`.

Run: `node --test tests/feeding-record-v2-model.test.js`
Expected: FAIL.

- [ ] **Step 2: Implement model methods**

Methods:

```js
addRecord(data)
updateRecord(recordId, data)
archiveRecord(recordId)
getRecordsByDate(babyUid, date)
resolveBasicInfoSnapshot(babyUid, date)
```

- [ ] **Step 3: Implement basic info fallback**

Fallback order:
1. same-day v2
2. latest previous v2
3. legacy `feeding_records.basicInfo`
4. `baby_info`
5. empty

- [ ] **Step 4: Run tests**

Run: `node --test tests/feeding-record-v2-model.test.js`
Expected: PASS.

---

## Task 3: Add New v2 Entry And Page Skeleton

**Files:**
- Create: `miniprogram/pages/milk-feeding-editor-v2/index.js`
- Create: `miniprogram/pages/milk-feeding-editor-v2/index.wxml`
- Create: `miniprogram/pages/milk-feeding-editor-v2/index.wxss`
- Create: `miniprogram/pages/milk-feeding-editor-v2/index.json`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/profile/index.js`
- Test: `tests/feeding-record-v2-entry.test.js`, `tests/milk-feeding-editor-v2.test.js`

- [ ] **Step 1: Write failing entry tests**

Cover:
- `app.json` registers v2 page.
- Profile menu exposes `喂奶记录v2`.
- Old milk feeding entry remains unchanged.

Run: `node --test tests/feeding-record-v2-entry.test.js`
Expected: FAIL.

- [ ] **Step 2: Create page skeleton**

Page must:
- Load active formula powders from `milk_nutrition_profiles`.
- Show category badges `普 / 特 / 能`.
- Show basic info fields.
- Provide save button but no old collection writes.

- [ ] **Step 3: Run entry tests**

Run: `node --test tests/feeding-record-v2-entry.test.js tests/milk-feeding-editor-v2.test.js`
Expected: PASS.

---

## Task 4: Implement v2 Save Flow

**Files:**
- Modify: `miniprogram/pages/milk-feeding-editor-v2/index.js`
- Test: `tests/milk-feeding-editor-v2.test.js`

- [ ] **Step 1: Write failing save tests**

Cover:
- Save validates time and at least one component.
- Formula powder component requires selected powder and valid water/powder amount.
- Save builds `formulaComponents`.
- Save builds `nutritionSummary`.
- Save writes to `feeding_records_v2`.
- Save does not call `feeding_records`.

Run: `node --test tests/milk-feeding-editor-v2.test.js`
Expected: FAIL.

- [ ] **Step 2: Implement save flow**

Use `feedingRecordV2Utils` and `feedingRecordV2` model.

- [ ] **Step 3: Run tests**

Run: `node --test tests/milk-feeding-editor-v2.test.js`
Expected: PASS.

---

## Task 5: Add v2 Display And Edit Loop

**Files:**
- Modify: `miniprogram/pages/milk-feeding-editor-v2/index.js`
- Modify: `miniprogram/pages/milk-feeding-editor-v2/index.wxml`
- Modify: `miniprogram/pages/milk-feeding-editor-v2/index.wxss`
- Test: `tests/milk-feeding-editor-v2.test.js`

- [ ] **Step 1: Write failing edit/display tests**

Cover:
- Existing v2 record loads from `feeding_records_v2`.
- Edit preserves `createdAt`.
- Archived records do not appear in normal list.
- Display uses `nutritionSnapshot`, not current powder profile.

- [ ] **Step 2: Implement edit/display**

- [ ] **Step 3: Run tests**

Run: `node --test tests/milk-feeding-editor-v2.test.js`
Expected: PASS.

---

## Task 6: Plan Read-Side Integrations

Do not implement in the first page task unless user approves.

Future read-side targets:
- `daily-feeding` v2 preview.
- `data-records` v2 preview.
- `growth-records` reads `feeding_records_v2.basicInfoSnapshot`.
- `data-analysis` v2 reads `feeding_records_v2.nutritionSummary` or recalculates from `formulaComponents`.

Before implementing these, create separate plans because each touches existing read-side behavior.

---

## Verification

Minimum commands after implementation:

```bash
node --test tests/feeding-record-v2-utils.test.js
node --test tests/feeding-record-v2-model.test.js
node --test tests/feeding-record-v2-entry.test.js
node --test tests/milk-feeding-editor-v2.test.js
node --test tests/*.test.js
```

Expected: all pass.

