# 大生化报告录入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有报告链路中新增 `blood_biochem`（大生化）类型：28 项全 optional 手动录入、至少 1 项有值可保存、无 OCR、档案/对比可筛选展示。

**Architecture:** 按血气/血常规同款扩展：`ReportModel` 为单一 schema 源；`reportRepository` / `reportWorkbench` / `add-report` / `analysis-report` 同步硬编码类型列表；大生化特有「至少 1 项有值」写在 `validateReportData`；OCR 入口改为 `ocrEntryVisible = ocrAllowed && reportType !== blood_biochem`。

**Tech Stack:** 微信小程序原生页面、`baby_reports_v2`、Node `node:test` 源码/单元测试

**Spec:** `docs/superpowers/specs/2026-07-13-blood-biochem-report-design.md`

**Branch:** 在 `feat/blood-biochem-report`（或从当前非 `main` 工作分支）实施；勿在 `main` 直接提交。

---

## File map

| File | Responsibility |
|------|----------------|
| `miniprogram/models/report.js` | 类型枚举、28 指标、`getIndicators` / `getReportTypeName`、至少 1 项有值校验 |
| `miniprogram/models/reportRepository.js` | 档案/趋势关键 key |
| `miniprogram/utils/reportWorkbench.js` | 卡片关键指标、筛选 Tab（不改 `splitIndicatorGroups`） |
| `miniprogram/pkg-report/add-report/index.js` | `reportTypes`、`ocrEntryVisible` 刷新 |
| `miniprogram/pkg-report/add-report/index.wxml` | OCR 绑定 `ocrEntryVisible` |
| `miniprogram/pages/analysis-report/index.js` | `COMPARE_TYPE_TABS` |
| `tests/report-model.test.js` | schema + 校验 |
| `tests/add-report.test.js` | OCR 入口 + 类型列表 |
| `tests/report-workbench-data.test.js` 或新建轻量源码断言 | 工作台/分析页接线（若现有文件不便扩展，可在 `tests/add-report.test.js` 旁新建 `tests/blood-biochem-report.test.js` 集中源码断言） |

---

### Task 1: ReportModel schema + 至少一项校验（TDD）

**Files:**
- Modify: `miniprogram/models/report.js`
- Test: `tests/report-model.test.js`

- [ ] **Step 1: Write failing tests**

在 `tests/report-model.test.js` 追加：

```js
test('blood biochem exposes 28 optional indicators and display name', () => {
  const indicators = ReportModel.getIndicators(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM);
  assert.equal(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, 'blood_biochem');
  assert.equal(ReportModel.getReportTypeName(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM), '大生化');
  assert.equal(indicators.length, 28);
  assert.ok(indicators.every((item) => item.optional === true));
  assert.deepEqual(
    indicators.map(({ key, name, unit, abbr }) => ({ key, name, unit, abbr })),
    [
      { key: 'tp', name: '总蛋白', unit: 'g/L', abbr: 'TP' },
      { key: 'alb', name: '白蛋白', unit: 'g/L', abbr: 'ALB' },
      { key: 'alt', name: '丙氨酸氨基转移酶', unit: 'U/L', abbr: 'ALT' },
      { key: 'ast', name: '天门冬氨酸氨基转移酶', unit: 'U/L', abbr: 'AST' },
      { key: 'alp', name: '碱性磷酸酶', unit: 'U/L', abbr: 'ALP' },
      { key: 'ggt', name: '谷氨酰转肽酶', unit: 'U/L', abbr: 'GGT' },
      { key: 'dbil', name: '直接胆红素', unit: 'μmol/L', abbr: 'DBil' },
      { key: 'tbil', name: '总胆红素', unit: 'μmol/L', abbr: 'TBil' },
      { key: 'crea', name: '肌酐', unit: 'μmol/L', abbr: 'CREA' },
      { key: 'tba', name: '总胆汁酸', unit: 'μmol/L', abbr: 'TBA' },
      { key: 'ua', name: '尿酸', unit: 'μmol/L', abbr: 'UA' },
      { key: 'tc', name: '总胆固醇', unit: 'mmol/L', abbr: 'TC' },
      { key: 'tg', name: '甘油三酯', unit: 'mmol/L', abbr: 'TG' },
      { key: 'ldl', name: '低密度脂蛋白', unit: 'mmol/L', abbr: 'LDL' },
      { key: 'hdl', name: '高密度脂蛋白', unit: 'mmol/L', abbr: 'HDL' },
      { key: 'glu', name: '空腹血糖', unit: 'mmol/L', abbr: 'Glu' },
      { key: 'bun', name: '尿素氮', unit: 'mmol/L', abbr: 'BUN' },
      { key: 'egfr', name: '肾小球滤过率', unit: 'ml/min', abbr: 'eGFR' },
      { key: 'cysc', name: '胱抑素C', unit: 'mg/L', abbr: 'CysC' },
      { key: 'na', name: '钠', unit: 'mmol/L', abbr: 'Na' },
      { key: 'k', name: '钾', unit: 'mmol/L', abbr: 'K' },
      { key: 'mg', name: '镁', unit: 'mmol/L', abbr: 'Mg' },
      { key: 'ca', name: '钙', unit: 'mmol/L', abbr: 'Ca' },
      { key: 'cl', name: '氯', unit: 'mmol/L', abbr: 'Cl' },
      { key: 'ck', name: '肌酸激酶', unit: 'U/L', abbr: 'CK' },
      { key: 'ck_mb', name: '肌酸激酶同工酶', unit: 'U/L', abbr: 'CK-MB' },
      { key: 'ctni', name: '肌钙蛋白', unit: 'ng/mL', abbr: 'cTnI' },
      { key: 'co2', name: '二氧化碳', unit: 'mmol/L', abbr: 'CO₂' }
    ]
  );
});

test('validateReportData rejects empty blood biochem report', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, {});
  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /至少/);
});

test('validateReportData accepts partial blood biochem with one value and no ranges', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, {
    alt: { value: '32', minRange: '', maxRange: '' }
  });
  assert.equal(result.isValid, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/report-model.test.js`

Expected: FAIL（`BLOOD_BIOCHEM` / 指标缺失）

- [ ] **Step 3: Implement schema + validation**

在 `miniprogram/models/report.js`：

1. `REPORT_TYPES` 增加 `BLOOD_BIOCHEM: 'blood_biochem'`
2. 新增 `BLOOD_BIOCHEM_INDICATORS`（28 项，全部 `optional: true`，字段见 spec 表；`unit` / `abbr` 按 spec）
3. `getIndicators` / `getReportTypeName` 增加分支（展示名 `'大生化'`）
4. 在 `validateReportData` 末尾、`return` 前增加：

```js
if (reportType === this.REPORT_TYPES.BLOOD_BIOCHEM) {
  const hasAnyValue = requiredIndicators.some((indicator) => {
    const data = indicators[indicator.key];
    return data && data.value && String(data.value).trim() !== '';
  });
  if (!hasAnyValue) {
    errors.push('请至少填写一项大生化指标');
  }
}
```

注意：不要改动 optional 有值可不填范围的现网逻辑。

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/report-model.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/models/report.js tests/report-model.test.js
git commit -m "feat: 新增大生化报告类型与校验"
```

---

### Task 2: Repository / Workbench / 分析页接线

**Files:**
- Modify: `miniprogram/models/reportRepository.js`
- Modify: `miniprogram/utils/reportWorkbench.js`
- Modify: `miniprogram/pages/analysis-report/index.js`
- Create: `tests/blood-biochem-report.test.js`（源码断言，集中本功能接线）

- [ ] **Step 1: Write failing wiring tests**

在 `tests/blood-biochem-report.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('repository and workbench register blood_biochem key metrics', () => {
  const repo = read('miniprogram/models/reportRepository.js');
  const workbench = read('miniprogram/utils/reportWorkbench.js');
  const analysis = read('miniprogram/pages/analysis-report/index.js');

  assert.match(repo, /BLOOD_BIOCHEM[\s\S]*alt[\s\S]*ast[\s\S]*crea[\s\S]*\bk\b[\s\S]*glu/);
  assert.match(workbench, /KEY_METRICS_BY_REPORT_TYPE[\s\S]*BLOOD_BIOCHEM[\s\S]*'alt'/);
  assert.match(workbench, /REPORT_TYPE_FILTERS[\s\S]*blood_biochem[\s\S]*大生化/);
  assert.match(analysis, /COMPARE_TYPE_TABS[\s\S]*blood_biochem[\s\S]*大生化/);
});
```

（断言可按实际数组写法微调，但必须覆盖 5 个关键 key 与「大生化」label。）

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/blood-biochem-report.test.js`

Expected: FAIL

- [ ] **Step 3: Wire lists**

关键指标数组（三处一致）：`['alt', 'ast', 'crea', 'k', 'glu']`

1. `reportRepository.js`：`ARCHIVE_KEY_INDICATORS` 与 `TREND_METRIC_KEYS` 增加 `[ReportModel.REPORT_TYPES.BLOOD_BIOCHEM]: [...]`
2. `reportWorkbench.js`：`KEY_METRICS_BY_REPORT_TYPE` 同上；`REPORT_TYPE_FILTERS` 在血常规后、血氨前插入 `{ key: ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, label: '大生化' }`
3. `analysis-report/index.js`：`COMPARE_TYPE_TABS` 同样插入 `{ key: 'blood_biochem', label: '大生化' }`
4. **不要**为 biochem 改 `splitIndicatorGroups`（走默认单组）

- [ ] **Step 4: Run tests**

Run: `node --test tests/blood-biochem-report.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/models/reportRepository.js miniprogram/utils/reportWorkbench.js miniprogram/pages/analysis-report/index.js tests/blood-biochem-report.test.js
git commit -m "feat: 大生化接入档案摘要与对比筛选"
```

---

### Task 3: add-report 类型入口 + 隐藏 OCR

**Files:**
- Modify: `miniprogram/pkg-report/add-report/index.js`
- Modify: `miniprogram/pkg-report/add-report/index.wxml`
- Modify: `tests/add-report.test.js`
- Modify: `tests/blood-biochem-report.test.js`（可追加断言）

- [ ] **Step 1: Update / write failing tests**

1. 改 `tests/add-report.test.js` 中 OCR gating 测试：

```js
assert.match(wxml, /wx:if="\{\{ocrEntryVisible\}\}"/);
assert.match(js, /ocrEntryVisible/);
assert.match(js, /ocrAllowed[\s\S]*selectedReportType\s*!==\s*'blood_biochem'/);
assert.match(js, /action:\s*'checkAccess'/);
assert.match(js, /OCR_NOT_ALLOWED/);
```

2. 在 `tests/blood-biochem-report.test.js` 追加：

```js
test('add-report lists blood biochem and hides OCR for that type', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  const wxml = read('miniprogram/pkg-report/add-report/index.wxml');
  assert.match(js, /key:\s*'blood_biochem'[\s\S]*name:\s*'大生化'/);
  assert.match(js, /refreshOcrEntryVisible/);
  assert.match(js, /ocrAllowed[\s\S]*selectedReportType\s*!==\s*'blood_biochem'/);
  assert.match(js, /async switchReportType\(reportType\)[\s\S]*refreshOcrEntryVisible/);
  assert.match(wxml, /ocrEntryVisible/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/add-report.test.js tests/blood-biochem-report.test.js`

Expected: FAIL on OCR / 类型断言

- [ ] **Step 3: Implement UI wiring**

1. `reportTypes` 在血常规后、血氨前插入：

```js
{ key: 'blood_biochem', name: '大生化', icon: '🧬' }
```

（icon 可换成现有风格 emoji，保持一致即可。）

2. `data` 增加 `ocrEntryVisible: false`

3. 新增方法：

```js
refreshOcrEntryVisible() {
  const visible = !!this.data.ocrAllowed
    && this.data.selectedReportType !== 'blood_biochem';
  if (this.data.ocrEntryVisible !== visible) {
    this.setData({ ocrEntryVisible: visible });
  }
}
```

4. 调用点（**不要**挂在 `onReportTypeChange` 末尾——未保存确认时类型尚未切换）：
   - `loadOcrAccess` 每次 `setData`（成功/失败）之后
   - `switchReportType` 在 `setData({ selectedReportType... })` 之后（`initIndicators` 前后均可，建议紧跟 `setData`）
   - `loadReportData` 设好 `selectedReportType` 之后（编辑进入大生化也要隐藏）

5. `index.wxml`：`wx:if="{{ocrAllowed}}"` → `wx:if="{{ocrEntryVisible}}"`

- [ ] **Step 4: Run tests**

Run: `node --test tests/add-report.test.js tests/blood-biochem-report.test.js tests/report-model.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pkg-report/add-report/index.js miniprogram/pkg-report/add-report/index.wxml tests/add-report.test.js tests/blood-biochem-report.test.js
git commit -m "feat: 大生化录入入口并隐藏 OCR"
```

---

### Task 4: 回归与验收扫尾

**Files:** 无新文件（除非测试需微调）

- [ ] **Step 1: Run related regression suite**

Run:

```bash
node --test \
  tests/report-model.test.js \
  tests/add-report.test.js \
  tests/blood-biochem-report.test.js \
  tests/report-workbench-data.test.js \
  tests/report-repository.test.js \
  tests/analysis-report-flow.test.js
```

若某文件不存在，跳过该路径。失败则按断言修复，不扩大范围。

Expected: PASS（或仅与本功能无关的既有失败——若出现，记录并确认与本次无关）

- [ ] **Step 2: Manual checklist（开发者工具）**

对照 spec 验收：

- [ ] 类型列表有「大生化」，录入 28 项
- [ ] 只填 ALT 可保存；全空不可保存
- [ ] 大生化无 OCR 入口；切到血串联后白名单用户仍可看到 OCR（若本机有权限）
- [ ] 分析页筛选/对比有「大生化」；档案摘要优先 ALT/AST 等已填项
- [ ] 详情 / 编辑 / 删除行为与其他报告类型一致

- [ ] **Step 3: Final commit if any fixes**

```bash
git add -A
git status
git commit -m "test: 完善大生化接线回归"
```

（无改动则跳过 commit。）

---

## Out of scope（实现时勿做）

- OCR lexicon / `recognizeReportCustom`
- 录入页分组 UI、尿项
- 新集合 / 数据迁移
- 改档案卡截断条数
- 改血气 key 或合并电解质数据
