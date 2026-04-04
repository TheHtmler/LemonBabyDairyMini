# Report Preview Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the report preview demo entry into the approved three-step flow: archive list, single report detail, and same-type trend analysis with feeding context.

**Architecture:** Keep the formal `analysis-report` page untouched. Extend the preview demo entry with internal view-state navigation and pure data builders so archive/detail/trend responsibilities stay separated while still sharing real report and feeding data.

**Tech Stack:** WeChat Mini Program pages, existing `ReportModel`, pure JS utility builders, Node built-in test runner.

---

### Task 1: Add failing tests for the three-step preview flow

**Files:**
- Modify: `tests/report-workbench-preview.test.js`
- Modify: `tests/report-workbench-data.test.js`

- [ ] Add assertions for archive/detail/trend preview sections and navigation handlers.
- [ ] Add utility-level tests for detail preview and trend preview builders.
- [ ] Run `node --test tests/report-workbench-preview.test.js tests/report-workbench-data.test.js` and confirm failures are for missing preview flow behavior.

### Task 2: Build pure preview data helpers

**Files:**
- Modify: `miniprogram/utils/reportWorkbench.js`
- Test: `tests/report-workbench-data.test.js`

- [ ] Add a pure builder for single report detail preview data.
- [ ] Add a pure builder for same-type trend preview data with selected interval reports and feeding window copy.
- [ ] Keep archive builder and workbench builder consistent so preview state can derive from one report selection.
- [ ] Re-run the targeted tests and confirm the new builders pass.

### Task 3: Implement preview page state and navigation

**Files:**
- Modify: `miniprogram/pages/report-workbench-preview/index.js`
- Test: `tests/report-workbench-preview.test.js`

- [ ] Add internal preview modes for archive, detail, and trend.
- [ ] Wire archive cards to detail preview, and type-scoped trend entry to trend preview.
- [ ] Keep add-report navigation defaulting to the active type when possible.
- [ ] Re-run targeted tests and confirm page logic passes.

### Task 4: Update preview UI to show the final flow

**Files:**
- Modify: `miniprogram/pages/report-workbench-preview/index.wxml`
- Modify: `miniprogram/pages/report-workbench-preview/index.wxss`
- Test: `tests/report-workbench-preview.test.js`

- [ ] Render archive view as the default landing state.
- [ ] Render single-report detail view with grouped indicators and a same-type trend CTA.
- [ ] Render same-type trend view with trend metrics, interval summary, feeding background, and links back to the two report details.
- [ ] Run `node --test tests/report-workbench-preview.test.js tests/report-workbench-data.test.js`.

### Task 5: Verify the whole workspace

**Files:**
- Verify only

- [ ] Run `node --test tests/*.test.js`.
- [ ] Check that the preview demo entry still preserves the formal report analysis page unchanged.
