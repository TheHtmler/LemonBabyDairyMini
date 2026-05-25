# v2 Data Model And Page Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the unfinished v2 upgrade by making v2 the main record path for milk, food, growth snapshots, summaries, and read-side analysis while keeping legacy v1 data readable and reversible.

**Architecture:** Keep `baby_info`, medication records, treatment records, bowel records, food catalog, and report v2 collections as shared infrastructure. Promote `feeding_records_v2`, `growth_records_v2`, and `milk_nutrition_profiles` as v2 primary sources, add an independent food intake event collection, and add a daily summary cache for fast today/analysis/report reads. Legacy `feeding_records` stays as an archive and migration source until all v2 read paths are verified.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, Cloud Database, CommonJS modules, cloud functions, `node:test`.

---

## Product Boundary

- Do not delete `feeding_records`, `nutrition_settings`, `growth_records`, or `baby_reports` in this plan.
- Do not change historical records in-place. Migrations create v2 documents and keep source IDs for audit.
- v2 pages should not write new food or milk data into `feeding_records`.
- Existing independent event collections can be reused:
  - `medication_records`
  - `treatment_records`
  - `bowel_records`
- Existing configuration collections can be reused:
  - `baby_info`
  - `food_catalog`
  - `baby_creators`
  - `baby_participants`
- v2 primary collections:
  - `milk_nutrition_profiles`
  - `feeding_records_v2`
  - `growth_records_v2`
  - `baby_reports_v2`
- New collections proposed by this plan:
  - `food_intake_records`
  - `daily_summary_v2`

---

## Collection Strategy

### Reuse

| Collection | Role | Notes |
| --- | --- | --- |
| `baby_info` | Baby master profile and collaboration anchor | Keep as the one baby identity source. |
| `food_catalog` | Food dictionary | No v2 clone needed. |
| `medication_records` | Medication event records | Already one document per event. |
| `treatment_records` | Treatment event records | Already independent and nutrition-aware. |
| `bowel_records` | Bowel event records | Already independent. |
| `baby_reports_v2` | Report primary collection | Existing repository already prefers v2. |

### Promote As v2 Primary

| Collection | Replaces | Notes |
| --- | --- | --- |
| `feeding_records_v2` | `feeding_records.feedings[]` | One milk feeding per document. |
| `growth_records_v2` | `feeding_records.basicInfo` for v2 daily snapshots | One daily growth/basic-info snapshot. |
| `milk_nutrition_profiles` | v1 scalar nutrition settings for v2 pages | v2 editors should use this only. |

### Add

| Collection | Purpose |
| --- | --- |
| `food_intake_records` | One food/meal item event per document or one meal batch per document, replacing `feeding_records.intakes` for v2. |
| `daily_summary_v2` | One summary document per baby per day for today cards, analysis, growth/report nutrition windows, and fast dashboards. |

### Archive / Migration Source

| Collection | Future Role |
| --- | --- |
| `feeding_records` | Read-only v1 archive and migration source. |
| `nutrition_settings` | Legacy compatibility. |
| `growth_records` | Legacy growth history, migrated or merged into v2 reads. |
| `baby_reports` | Legacy reports, already deduped by `ReportRepository`. |

---

## New Collection Contracts

### `food_intake_records`

```js
{
  schemaVersion: 1,
  recordType: 'food_intake',
  source: 'meal_editor_v2',
  status: 'active',

  babyUid: 'baby_xxx',
  date: '2026-05-25',
  mealBatchId: 'meal_...',
  recordedAt: Date,
  time: '12:30',

  foodId: 'food_xxx',
  foodName: '米粉',
  foodSnapshot: {
    name: '米粉',
    category: 'grain',
    proteinSource: 'natural',
    nutritionPer100g: {
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0
    }
  },
  quantity: 0,
  unit: 'g',
  nutrition: {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0
  },

  notes: '',
  legacySource: {
    collection: '',
    recordId: '',
    intakeId: ''
  },
  createdAt: db.serverDate(),
  updatedAt: db.serverDate(),
  deletedAt: null
}
```

Decision: store one document per food item first. Meal grouping stays through `mealBatchId`. This keeps edit/delete simple and avoids another nested array that recreates the v1 problem.

### `daily_summary_v2`

```js
{
  schemaVersion: 1,
  recordType: 'daily_summary',
  source: 'summary_builder_v2',
  status: 'active',

  babyUid: 'baby_xxx',
  date: '2026-05-25',
  basicInfo: {
    weight: '',
    height: '',
    naturalProteinCoefficient: '',
    specialProteinCoefficient: '',
    calorieCoefficient: ''
  },
  milk: {
    totalVolume: 0,
    totalPowderWeight: 0,
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    zeroProteinCalories: 0
  },
  food: {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0
  },
  treatment: {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  },
  medication: {
    totalRecords: 0,
    takenMedicationIds: []
  },
  bowel: {
    totalRecords: 0,
    latestType: ''
  },
  macroSummary: {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    carbs: 0,
    fat: 0
  },
  recordCounts: {
    milk: 0,
    food: 0,
    medication: 0,
    treatment: 0,
    bowel: 0
  },
  sourceUpdatedAt: {
    feeding: null,
    food: null,
    medication: null,
    treatment: null,
    bowel: null,
    growth: null
  },
  isDirty: false,
  rebuiltAt: db.serverDate(),
  createdAt: db.serverDate(),
  updatedAt: db.serverDate()
}
```

Decision: `daily_summary_v2` is a cache, not the source of truth. If wrong, rebuild it from event collections.

---

## File Structure

### New Files

- `miniprogram/models/foodIntakeRecord.js`
  - CRUD for `food_intake_records`.
  - Normalize food snapshots and soft deletion.
  - Query by `babyUid + date + status`.
- `miniprogram/models/dailySummaryV2.js`
  - Upsert and query `daily_summary_v2`.
  - Mark a day dirty after event writes.
- `miniprogram/utils/dailySummaryV2Utils.js`
  - Pure functions to build daily summary from milk, food, medication, treatment, bowel, and growth inputs.
- `miniprogram/utils/dailyRecordV2Service.js`
  - Read aggregation facade for today page, data records, analysis, growth, and report modules.
  - Hides whether a page reads raw events or `daily_summary_v2`.
- `cloudfunctions/migrateFeedingRecordsV2/index.js`
  - Dry-run and execute migration from `feeding_records.feedings[]` to `feeding_records_v2`.
- `cloudfunctions/migrateFoodIntakesV2/index.js`
  - Dry-run and execute migration from `feeding_records.intakes[]` to `food_intake_records`.
- `cloudfunctions/rebuildDailySummaryV2/index.js`
  - Rebuild summaries by `babyUid` and date range.

### Modified Files

- `miniprogram/app.json`
  - Register any new v2 pages if a new page is used.
  - Later switch tab paths after verification.
- `miniprogram/pages/profile/index.js`
  - Add cleanup for v2 collections.
  - Hide or demote v1 menu entries after v2 is validated.
- `miniprogram/pages/data-records/index.js`
  - Remove v2 food writes to `feeding_records`.
  - Use `food_intake_records` and `dailyRecordV2Service` in v2 mode.
- `miniprogram/pages/data-records-v2/index.js`
  - Keep the thin shell, but ensure v2 mode no longer depends on legacy intakes.
- `miniprogram/pages/meal-editor/index.js`
  - Add `recordSource=v2` support.
  - Write to `food_intake_records` for v2.
- `miniprogram/pages/daily-feeding/index.js`
  - Either add a `recordSource` branch or reduce it to a v2 dashboard using `dailyRecordV2Service`.
- `miniprogram/pages/milk-feeding-editor-v2/index.js`
  - Mark `daily_summary_v2` dirty after add/update/delete.
- `miniprogram/pages/nutrition-profile-settings/index.js`
  - Mark affected recent summaries dirty only if profile edits should trigger future recomputation.
- `miniprogram/pages/data-analysis/index.js`
  - Read `daily_summary_v2` first.
  - Fall back to legacy only during migration window.
- `miniprogram/pages/growth-records/index.js`
  - Read `growth_records_v2` and/or summaries.
- `miniprogram/pages/analysis-report/index.js`
  - Use v2 summaries for nutrition exposure.
- `miniprogram/pages/report-workbench-preview/index.js`
  - Replace direct `feeding_records` query with v2 summary/service read.
- `miniprogram/pages/trend-report/index.js`
  - Replace direct `feeding_records` read with v2 summary/service read.

### Tests

- `tests/food-intake-record-v2.test.js`
- `tests/daily-summary-v2-utils.test.js`
- `tests/daily-record-v2-service.test.js`
- `tests/data-records-v2-food-intakes.test.js`
- `tests/daily-feeding-v2-summary.test.js`
- `tests/data-analysis-v2-summary.test.js`
- `tests/growth-records-v2-read.test.js`
- `tests/report-v2-nutrition-summary.test.js`
- `tests/profile-v2-cleanup.test.js`
- `tests/migrate-feeding-records-v2.test.js`
- `tests/migrate-food-intakes-v2.test.js`

---

## Task 1: Add v2 Food Intake Model

**Files:**
- Create: `miniprogram/models/foodIntakeRecord.js`
- Test: `tests/food-intake-record-v2.test.js`

- [x] **Step 1: Write failing model tests**

Cover:
- `createFoodIntake()` writes to `food_intake_records`, not `feeding_records`.
- Created records include `schemaVersion`, `recordType`, `source`, `status`, `babyUid`, `date`, `mealBatchId`, food snapshot, nutrition snapshot, `createdAt`, and `updatedAt`.
- `updateFoodIntake()` preserves `createdAt`.
- `deleteFoodIntake()` soft deletes by setting `status: 'archived'` and `deletedAt`.
- `findByDate()` returns only `status === 'active'`.

Run:

```bash
node --test tests/food-intake-record-v2.test.js
```

Expected: FAIL because the model does not exist.

- [x] **Step 2: Implement `FoodIntakeRecordModel`**

Export methods:

```js
module.exports = {
  createFoodIntake,
  updateFoodIntake,
  deleteFoodIntake,
  findByDate,
  normalizeFoodIntakeRecord
};
```

Implementation notes:
- Use `date` as `YYYY-MM-DD` string for v2.
- Use `recordedAt` as a Date for precise sorting.
- Keep `foodSnapshot` and `nutrition` on the record so later food catalog edits do not change history.
- Do not read from `feeding_records`.

- [x] **Step 3: Run focused tests**

Run:

```bash
node --test tests/food-intake-record-v2.test.js
```

Expected: PASS.

---

## Task 2: Add Daily Summary Pure Builder

**Files:**
- Create: `miniprogram/utils/dailySummaryV2Utils.js`
- Test: `tests/daily-summary-v2-utils.test.js`

- [x] **Step 1: Write failing pure utility tests**

Cover:
- Milk totals use `feeding_records_v2.nutritionSummary`.
- Food totals use `food_intake_records.nutrition`.
- Treatment totals use existing treatment summaries.
- Medication and bowel counts are included but do not affect nutrition.
- Basic info prefers `growth_records_v2` over milk record snapshots.
- Missing data returns zeroed sections, not `undefined`.

Run:

```bash
node --test tests/daily-summary-v2-utils.test.js
```

Expected: FAIL because the utility does not exist.

- [x] **Step 2: Implement pure builder functions**

Export:

```js
module.exports = {
  createEmptyDailySummaryV2,
  buildDailySummaryV2,
  mergeMilkNutrition,
  mergeFoodNutrition,
  mergeTreatmentNutrition,
  normalizeDailySummaryV2
};
```

Implementation notes:
- Keep all numeric public totals rounded to 2 decimals.
- Do not mutate input records.
- Keep the output shape aligned with the `daily_summary_v2` contract in this plan.

- [x] **Step 3: Run focused tests**

Run:

```bash
node --test tests/daily-summary-v2-utils.test.js
```

Expected: PASS.

---

## Task 3: Add Daily Summary Model And Aggregation Service

**Files:**
- Create: `miniprogram/models/dailySummaryV2.js`
- Create: `miniprogram/utils/dailyRecordV2Service.js`
- Test: `tests/daily-record-v2-service.test.js`

- [x] **Step 1: Write failing service tests**

Cover:
- `getDailyRecordV2(babyUid, date)` loads milk, food, medication, treatment, bowel, growth, and summary data.
- If `daily_summary_v2` exists and is not dirty, service returns it for summary sections.
- If summary is missing or dirty, service can rebuild from event records.
- The service does not query `feeding_records` unless an explicit `includeLegacyFallback` option is passed.
- Returned shape can feed `data-records` existing summary UI.

Run:

```bash
node --test tests/daily-record-v2-service.test.js
```

Expected: FAIL because the service/model does not exist.

- [x] **Step 2: Implement `DailySummaryV2Model`**

Export methods:

```js
module.exports = {
  getByDate,
  upsertSummary,
  markDirty,
  rebuildByDate
};
```

Implementation notes:
- Query by `{ babyUid, date, status: 'active' }`.
- Upsert by finding an existing active summary first.
- Store `isDirty` so writes can be cheap and rebuilds can happen on next read or via cloud function.

- [x] **Step 3: Implement `dailyRecordV2Service`**

Export:

```js
module.exports = {
  getDailyRecordV2,
  rebuildDailySummaryForDate,
  getDailySummariesForRange
};
```

Implementation notes:
- Reuse existing `FeedingRecordV2Model.getRecordsByDate`.
- Reuse `MedicationRecordModel.findByDate`.
- Reuse `TreatmentRecordModel.findByDate`.
- Query `bowel_records` directly until a model exists.
- Use `FoodIntakeRecordModel.findByDate` for v2 food.

- [x] **Step 4: Run focused tests**

Run:

```bash
node --test tests/daily-record-v2-service.test.js tests/daily-summary-v2-utils.test.js tests/food-intake-record-v2.test.js
```

Expected: PASS.

---

## Task 4: Move v2 Food Writes Off `feeding_records.intakes`

**Files:**
- Create: `miniprogram/pages/meal-editor-v2/index.js`
- Create: `miniprogram/pages/meal-editor-v2/index.wxml`
- Create: `miniprogram/pages/meal-editor-v2/index.wxss`
- Create: `miniprogram/pages/meal-editor-v2/index.json`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/data-records/index.js`
- Test: `tests/data-records-v2-food-intakes.test.js`

- [x] **Step 1: Write failing v2 food tests**

Cover:
- Opening standalone `meal-editor-v2` writes new food intake documents to `food_intake_records`.
- Editing a v2 food intake updates `food_intake_records`.
- Deleting a v2 food intake archives the food document.
- `data-records-v2` loads food records from `food_intake_records`.
- `data-records-v2` no longer creates a `feeding_records` day shell only to store food.
- Legacy `meal-editor` remains isolated from v2 food models.

Run:

```bash
node --test tests/data-records-v2-food-intakes.test.js
```

Expected: FAIL because v2 food still depends on `feeding_records.intakes`.

- [x] **Step 2: Add standalone `meal-editor-v2` page**

Implementation notes:
- Duplicate the full legacy meal editor page into `meal-editor-v2` for data and logic isolation.
- Register `pages/meal-editor-v2/index` in `app.json`.
- Keep legacy `meal-editor` on the current `feeding_records.intakes` behavior only.

- [x] **Step 3: Update `data-records` v2 food actions**

Implementation notes:
- In `isV2RecordsSource()`, use `FoodIntakeRecordModel` for add/edit/delete/copy food.
- Navigate v2 food add/edit actions to `pages/meal-editor-v2/index`.
- Keep existing legacy functions for v1 mode.
- After each v2 write, call `DailySummaryV2Model.markDirty(babyUid, date)`.

- [x] **Step 4: Run focused tests**

Run:

```bash
node --test tests/data-records-v2-food-intakes.test.js tests/data-records-v2.test.js
```

Expected: PASS.

---

## Task 5: Make `data-records-v2` Fully v2 For Milk, Food, And Growth

**Files:**
- Modify: `miniprogram/pages/data-records/index.js`
- Modify: `miniprogram/pages/data-records-v2/index.js`
- Test: `tests/data-records-v2.test.js`
- Test: `tests/data-records-v2-food-intakes.test.js`

- [ ] **Step 1: Write failing contract tests**

Cover:
- `data-records-v2` does not call `loadLegacyDailyRecordResult` during normal v2 load.
- v2 basic info writes to `growth_records_v2`.
- v2 summary uses `daily_summary_v2` or a rebuilt v2 summary.
- v2 copy day copies milk from `feeding_records_v2` and food from `food_intake_records`.
- Legacy `data-records` still reads/writes `feeding_records`.

Run:

```bash
node --test tests/data-records-v2.test.js tests/data-records-v2-food-intakes.test.js
```

Expected: FAIL for the legacy dependency assertions.

- [ ] **Step 2: Replace v2 daily load path**

Implementation notes:
- In v2 mode, call `dailyRecordV2Service.getDailyRecordV2`.
- Keep the existing v1 consolidation path untouched.
- Keep adapters that make v2 milk rows render in the current WXML.

- [ ] **Step 3: Replace v2 copy/delete flows**

Implementation notes:
- Copy food from `food_intake_records`.
- Copy milk from `feeding_records_v2`.
- Rebuild or mark dirty `daily_summary_v2` for target date.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/data-records-v2.test.js tests/data-records-v2-food-intakes.test.js tests/daily-record-v2-service.test.js
```

Expected: PASS.

---

## Task 6: Add v2 Today Page Read Path

**Files:**
- Modify: `miniprogram/pages/daily-feeding/index.js`
- Optional Create: `miniprogram/pages/daily-feeding-v2/index.js`
- Modify: `miniprogram/app.json` only if a new page is created.
- Test: `tests/daily-feeding-v2-summary.test.js`

- [ ] **Step 1: Decide implementation shape before coding**

Choose one:
- Option A: Add `recordSource: 'v2'` branch inside existing `daily-feeding`.
- Option B: Create `daily-feeding-v2` and keep the current page untouched until tab switch.

Recommendation: Option B if UI changes are significant, because `daily-feeding/index.js` is already over 6000 lines.

- [ ] **Step 2: Write failing today summary tests**

Cover:
- v2 today page reads `daily_summary_v2`.
- Milk list comes from `feeding_records_v2`.
- Food list comes from `food_intake_records`.
- Medication, treatment, and bowel reuse existing event collections.
- Add milk navigates to `milk-feeding-editor-v2`.
- Add food navigates to `meal-editor?recordSource=v2`.

Run:

```bash
node --test tests/daily-feeding-v2-summary.test.js
```

Expected: FAIL because v2 today path does not exist.

- [ ] **Step 3: Implement v2 read path**

Implementation notes:
- Use `dailyRecordV2Service.getDailyRecordV2`.
- Do not write `feeding_records`.
- Keep baby-friendly lemon theme and existing dashboard cards where possible.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/daily-feeding-v2-summary.test.js tests/daily-record-v2-service.test.js
```

Expected: PASS.

---

## Task 7: Switch Analysis, Growth, And Reports To v2 Summaries

**Files:**
- Modify: `miniprogram/pages/data-analysis/index.js`
- Modify: `miniprogram/pages/growth-records/index.js`
- Modify: `miniprogram/pages/analysis-report/index.js`
- Modify: `miniprogram/pages/report-workbench-preview/index.js`
- Modify: `miniprogram/pages/trend-report/index.js`
- Test: `tests/data-analysis-v2-summary.test.js`
- Test: `tests/growth-records-v2-read.test.js`
- Test: `tests/report-v2-nutrition-summary.test.js`

- [ ] **Step 1: Write failing read-side tests**

Cover:
- `data-analysis` can render a week/month using only `daily_summary_v2`.
- `growth-records` includes `growth_records_v2` measurements.
- `analysis-report` nutrition exposure uses v2 summaries.
- `report-workbench-preview` no longer queries `feeding_records` directly.
- Legacy fallback can be enabled only for migration window tests.

Run:

```bash
node --test tests/data-analysis-v2-summary.test.js tests/growth-records-v2-read.test.js tests/report-v2-nutrition-summary.test.js
```

Expected: FAIL because pages still read legacy feeding data.

- [ ] **Step 2: Add range read to `dailyRecordV2Service`**

Implementation notes:
- `getDailySummariesForRange(babyUid, startDate, endDate)` should return one item per date that has data.
- Prefer `daily_summary_v2`.
- Allow explicit fallback to rebuild missing dates from events.

- [ ] **Step 3: Update `data-analysis`**

Implementation notes:
- Replace direct `feeding_records` reads with summary range reads.
- Keep existing chart shape so WXML/WXSS changes are minimal.
- Keep treatment nutrition included through summary.

- [ ] **Step 4: Update growth pages**

Implementation notes:
- Read `growth_records_v2` as the v2 daily snapshot source.
- During migration, optionally merge `growth_records` and v2 records by date, preferring explicit v2 records for v2 mode.

- [ ] **Step 5: Update reports**

Implementation notes:
- Replace direct `feeding_records` nutrition windows with summary range reads.
- Keep `ReportRepository` unchanged unless report record CRUD needs new behavior.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/data-analysis-v2-summary.test.js tests/growth-records-v2-read.test.js tests/report-v2-nutrition-summary.test.js
```

Expected: PASS.

---

## Task 8: Unify v2 Entry Points And Profile Cleanup

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/profile/index.js`
- Test: `tests/profile-v2-cleanup.test.js`
- Existing tests: `tests/feeding-record-v2-entry.test.js`, `tests/data-records-v2.test.js`

- [ ] **Step 1: Write failing entry and cleanup tests**

Cover:
- Profile can hide or demote v1 milk/data entries after v2 switch.
- Creator logout removes `feeding_records_v2`, `growth_records_v2`, `milk_nutrition_profiles`, `food_intake_records`, and `daily_summary_v2`.
- Existing v1 cleanup remains intact.
- Tab switch can be tested without deleting legacy pages.

Run:

```bash
node --test tests/profile-v2-cleanup.test.js tests/feeding-record-v2-entry.test.js
```

Expected: FAIL for missing v2 cleanup.

- [ ] **Step 2: Add v2 cleanup list**

Implementation notes:
- Avoid hardcoding cleanup logic across pages.
- Prefer a local constant list in `profile/index.js` for this pass.
- Future improvement can move cleanup to a cloud function.

- [ ] **Step 3: Switch visible entries after read-side tests pass**

Implementation notes:
- Change Tab `数据记录` to `pages/data-records-v2/index` only after Task 5 passes.
- Change Tab `今日记录` to v2 only after Task 6 passes.
- Keep legacy pages registered in `app.json` for rollback.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/profile-v2-cleanup.test.js tests/feeding-record-v2-entry.test.js tests/data-records-v2.test.js
```

Expected: PASS.

---

## Task 9: Add Migration Cloud Functions

**Files:**
- Create: `cloudfunctions/migrateFeedingRecordsV2/index.js`
- Create: `cloudfunctions/migrateFeedingRecordsV2/package.json`
- Create: `cloudfunctions/migrateFoodIntakesV2/index.js`
- Create: `cloudfunctions/migrateFoodIntakesV2/package.json`
- Create: `cloudfunctions/rebuildDailySummaryV2/index.js`
- Create: `cloudfunctions/rebuildDailySummaryV2/package.json`
- Test: `tests/migrate-feeding-records-v2.test.js`
- Test: `tests/migrate-food-intakes-v2.test.js`

- [ ] **Step 1: Write failing migration tests**

Cover:
- Dry-run returns counts and sample transformed records without writing.
- Execute creates v2 records with `legacySource`.
- Re-running execute does not duplicate records for the same legacy source.
- Feeding migration preserves start/end time, date, milk fields, and calculated nutrition summary.
- Food migration preserves meal batch, food snapshot, quantity, nutrition, and notes.
- Summary rebuild creates or updates `daily_summary_v2`.

Run:

```bash
node --test tests/migrate-feeding-records-v2.test.js tests/migrate-food-intakes-v2.test.js
```

Expected: FAIL because cloud functions do not exist.

- [ ] **Step 2: Implement feeding migration**

Function input:

```js
{
  babyUid: 'baby_xxx',
  startDate: '2026-01-01',
  endDate: '2026-05-25',
  execute: false,
  limit: 100
}
```

Implementation notes:
- Read `feeding_records` by `babyUid` and date range.
- Support both Date and `YYYY-MM-DD` legacy date shapes.
- Convert each `feedings[]` item to one `feeding_records_v2` document.
- Set `source: 'legacy_migration'`.
- Store `legacySource.collection`, `legacySource.recordId`, and `legacySource.feedingIndex`.
- Do not remove source records.

- [ ] **Step 3: Implement food migration**

Implementation notes:
- Convert each non-milk `intakes[]` item to one `food_intake_records` document.
- Set `source: 'legacy_migration'`.
- Store `legacySource.collection`, `legacySource.recordId`, and `legacySource.intakeId`.
- Preserve `mealBatchId`.

- [ ] **Step 4: Implement summary rebuild**

Implementation notes:
- Rebuild by baby and date range.
- Use `dailyRecordV2Service.rebuildDailySummaryForDate` logic where possible.
- Return counts: rebuilt, skipped, failed.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests/migrate-feeding-records-v2.test.js tests/migrate-food-intakes-v2.test.js
```

Expected: PASS.

---

## Task 10: Cloud Database Index And Environment Checklist

**Files:**
- Modify: `docs/miniprogram/data-schema-guidelines.md`
- Optional Create: `docs/miniprogram/v2-cloud-database-checklist.md`

- [ ] **Step 1: Document required collections**

Required collections:
- `milk_nutrition_profiles`
- `feeding_records_v2`
- `growth_records_v2`
- `food_intake_records`
- `daily_summary_v2`

- [ ] **Step 2: Document recommended indexes**

Recommended indexes:
- `feeding_records_v2`: `babyUid + date + status + startTime`
- `feeding_records_v2`: `babyUid + status + date desc + startTime desc`
- `growth_records_v2`: `babyUid + date + status`
- `food_intake_records`: `babyUid + date + status + recordedAt`
- `daily_summary_v2`: `babyUid + date + status`
- `medication_records`: `babyUid + date`
- `treatment_records`: `babyUid + date`
- `bowel_records`: `babyUid + recordTime`
- `milk_nutrition_profiles`: `babyUid`

- [ ] **Step 3: Document rollout order**

Rollout order:
1. Create collections and indexes.
2. Deploy v2 model/service code.
3. Enable v2 data-records for internal testing.
4. Run dry-run migrations.
5. Execute migrations for one baby.
6. Rebuild summaries.
7. Compare v1/v2 totals.
8. Switch Tab entries.
9. Keep legacy pages registered for rollback.

---

## Verification

Minimum automated verification after all tasks:

```bash
node --test tests/food-intake-record-v2.test.js
node --test tests/daily-summary-v2-utils.test.js
node --test tests/daily-record-v2-service.test.js
node --test tests/data-records-v2-food-intakes.test.js
node --test tests/daily-feeding-v2-summary.test.js
node --test tests/data-analysis-v2-summary.test.js
node --test tests/growth-records-v2-read.test.js
node --test tests/report-v2-nutrition-summary.test.js
node --test tests/profile-v2-cleanup.test.js
node --test tests/migrate-feeding-records-v2.test.js
node --test tests/migrate-food-intakes-v2.test.js
node --test tests/*.test.js
```

Expected: all pass.

Manual Mini Program checks:

- Create one v2 formula profile for breast milk, regular formula, special formula, and energy supplement.
- Add one v2 milk record.
- Add one v2 food meal with two food items.
- Add one medication record.
- Add one treatment record that counts into nutrition.
- Add one bowel record.
- Open v2 data records and confirm all sections display.
- Open today page and confirm summary totals match v2 data records.
- Open data analysis and confirm weekly/monthly totals include v2 milk and food.
- Open growth records and confirm v2 weight/height appears.
- Open report workbench and confirm nutrition exposure includes v2 summaries.
- Run migration dry-run and confirm no writes.
- Run migration execute for one known date range and compare v1/v2 totals.

---

## Rollback Strategy

- Keep legacy pages registered in `app.json`.
- Keep `feeding_records` untouched.
- Keep v1 menu entries hidden rather than deleted during the first rollout.
- If v2 read-side totals are wrong, switch Tab paths back to legacy pages and rebuild `daily_summary_v2` offline.
- If migration creates bad v2 data, archive migrated documents by `legacySource` and rerun after fixing the transformer.

---

## Out Of Scope

- Deleting legacy collections.
- Replacing medication configuration with a new v2 medication settings collection.
- Replacing `treatment_records` or `bowel_records` with v2 clones.
- Implementing push notifications or WeChat subscription reminders for medication schedules.
- Full UI redesign beyond the minimal v2 replacement needed for data correctness.
