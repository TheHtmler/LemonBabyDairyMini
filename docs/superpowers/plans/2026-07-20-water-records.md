# Water Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一期喝水记录：独立集合、日汇总、柠檬环形容器持续波浪水位页、首页与数据记录入口。

**Architecture:** `water_records` Model 写路径 markDirty；`dailySummaryV2Utils` / `dailyRecordV2Service` / 云函数 rebuild 同步 `water` 段；页面用 Canvas 椭圆裁切水位 + Option B 透明叠层，水面 `requestAnimationFrame` 循环。

**Tech Stack:** 微信小程序、云开发 DB、Canvas 2d、WXSS

---

### Task 1: Model + Summary
- Create: `miniprogram/models/waterRecord.js`
- Modify: `dailySummaryV2Utils.js`, `dailyRecordV2Service.js`, `rebuildDailySummaryV2`, `accountCleanup`

### Task 2: Water page
- Create: `pkg-records/water-record/*` + vessel PNG
- Register in `app.json`

### Task 3: Entries + preview
- Home quick entry, data-records tab, intakeOverview.water

### Task 4: Tests
- water-record model/page tests; update summary/service/cleanup tests
