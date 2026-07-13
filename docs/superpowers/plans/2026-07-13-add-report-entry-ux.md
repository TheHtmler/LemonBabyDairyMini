# 新建报告交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分析页「全部」筛选下添加报告先弹类型选择；录入/编辑页展示单位与「已填 x / 共 n」。

**Architecture:** 抽 `miniprogram/constants/reportTypes.js` 供分析页与录入页共用；分析页用底部 sheet（z-index > FAB）实现类型选择状态机；录入页增加 `refreshFilledCount` 并在 init/切换/编辑加载/输入/OCR/比值计算后刷新；WXML 在检测值旁展示 `unit`。

**Tech Stack:** 微信小程序原生页面、Node `node:test` 源码断言

**Spec:** `docs/superpowers/specs/2026-07-13-add-report-entry-ux-design.md`

**Branch:** 在 `feat/blood-biochem-report`（或当前非 `main` 工作分支）实施；勿在 `main` 直接提交。

---

## File map

| File | Responsibility |
|------|----------------|
| `miniprogram/constants/reportTypes.js` | 6 项 `{ key, name, icon }` 单一来源 |
| `miniprogram/pages/analysis-report/index.js` | `onAddReport` 三分支、弹层方法、`navigateToAddReport` |
| `miniprogram/pages/analysis-report/index.wxml` | 类型选择 sheet + 遮罩 |
| `miniprogram/pages/analysis-report/index.wxss` | sheet/mask，`z-index > 30` |
| `miniprogram/pkg-report/add-report/index.js` | 引用常量、`filledCount`/`totalCount`、`refreshFilledCount` |
| `miniprogram/pkg-report/add-report/index.wxml` / `.wxss` | 已填进度、检测值旁 unit |
| `tests/add-report-entry-ux.test.js` | 类型一致、onAddReport 分支、单位与计数接线 |

---

### Task 1: 共享 `reportTypes` 常量

**Files:**
- Create: `miniprogram/constants/reportTypes.js`
- Modify: `miniprogram/pkg-report/add-report/index.js`
- Create: `tests/add-report-entry-ux.test.js`

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('reportTypes constant lists all six report entry types', () => {
  const { REPORT_ENTRY_TYPES } = require('../miniprogram/constants/reportTypes');
  assert.deepEqual(
    REPORT_ENTRY_TYPES.map(({ key, name, icon }) => ({ key, name, icon })),
    [
      { key: 'blood_ms', name: '血串联质谱', icon: '🩸' },
      { key: 'urine_ms', name: '尿串联质谱', icon: '🧪' },
      { key: 'blood_gas', name: '血气分析', icon: '💨' },
      { key: 'blood_cbc', name: '血常规', icon: '🩺' },
      { key: 'blood_biochem', name: '大生化', icon: '🧬' },
      { key: 'blood_ammonia', name: '血氨检测', icon: '⚡' }
    ]
  );
});

test('add-report uses shared REPORT_ENTRY_TYPES', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  assert.match(js, /constants\/reportTypes/);
  assert.match(js, /REPORT_ENTRY_TYPES/);
  assert.doesNotMatch(js, /reportTypes:\s*\[\s*\{\s*key:\s*'blood_ms'/);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test tests/add-report-entry-ux.test.js`

- [ ] **Step 3: Implement constant + wire add-report**

`miniprogram/constants/reportTypes.js`:

```js
const REPORT_ENTRY_TYPES = [
  { key: 'blood_ms', name: '血串联质谱', icon: '🩸' },
  { key: 'urine_ms', name: '尿串联质谱', icon: '🧪' },
  { key: 'blood_gas', name: '血气分析', icon: '💨' },
  { key: 'blood_cbc', name: '血常规', icon: '🩺' },
  { key: 'blood_biochem', name: '大生化', icon: '🧬' },
  { key: 'blood_ammonia', name: '血氨检测', icon: '⚡' }
];

module.exports = { REPORT_ENTRY_TYPES };
```

在 `add-report/index.js` 顶部 `require`，`data.reportTypes: REPORT_ENTRY_TYPES`（或展开拷贝）。删除内联数组。

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tests/add-report-entry-ux.test.js tests/add-report.test.js`

- [ ] **Step 5: Commit**

```bash
git add miniprogram/constants/reportTypes.js miniprogram/pkg-report/add-report/index.js tests/add-report-entry-ux.test.js
git commit -m "$(cat <<'EOF'
refactor: 抽取报告录入类型常量为单一来源

EOF
)"
```

---

### Task 2: 分析页类型选择弹层

**Files:**
- Modify: `miniprogram/pages/analysis-report/index.js`
- Modify: `miniprogram/pages/analysis-report/index.wxml`
- Modify: `miniprogram/pages/analysis-report/index.wxss`
- Modify: `tests/add-report-entry-ux.test.js`

- [ ] **Step 1: Write failing wiring tests**

追加到 `tests/add-report-entry-ux.test.js`：

```js
test('analysis-report add flow opens type picker or navigates by context', () => {
  const js = read('miniprogram/pages/analysis-report/index.js');
  const wxml = read('miniprogram/pages/analysis-report/index.wxml');
  const wxss = read('miniprogram/pages/analysis-report/index.wxss');

  assert.match(js, /constants\/reportTypes|REPORT_ENTRY_TYPES/);
  assert.match(js, /typePickerVisible/);
  assert.match(js, /navigateToAddReport/);
  assert.match(js, /mainTab\s*===\s*MAIN_TABS\.COMPARE|mainTab\s*===\s*['"]compare['"]/);
  assert.match(js, /compareReportType/);
  assert.match(js, /selectedFilterType[\s\S]*!==\s*['"]all['"]/);
  assert.match(js, /onCloseTypePicker|typePickerVisible:\s*false/);
  assert.match(js, /onSelectReportType/);
  assert.match(wxml, /typePickerVisible/);
  assert.match(wxml, /onSelectReportType|data-type/);
  assert.match(wxss, /z-index:\s*(?:1000|9999)/);
});
```

（z-index 断言可改为精确匹配实现值，如 `1000` / `9999`。）

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tests/add-report-entry-ux.test.js`

- [ ] **Step 3: Implement**

1. `require` `REPORT_ENTRY_TYPES`；`data` 增加：
   - `typePickerVisible: false`
   - `reportEntryTypes: REPORT_ENTRY_TYPES`（供 WXML 渲染）

2. 替换 `onAddReport`：

```js
onAddReport() {
  if (this.data.mainTab === MAIN_TABS.COMPARE) {
    this.navigateToAddReport(this.data.compareReportType);
    return;
  }
  const filterType = this.data.selectedFilterType;
  if (filterType && filterType !== 'all') {
    this.navigateToAddReport(filterType);
    return;
  }
  this.setData({ typePickerVisible: true });
},

navigateToAddReport(typeKey) {
  const type = typeKey ? `&type=${typeKey}` : '';
  wx.navigateTo({
    url: `/pkg-report/add-report/index?mode=add${type}`
  });
},

onCloseTypePicker() {
  this.setData({ typePickerVisible: false });
},

onSelectReportType(e) {
  const typeKey = e.currentTarget.dataset.type;
  this.setData({ typePickerVisible: false });
  this.navigateToAddReport(typeKey);
}
```

（`MAIN_TABS.COMPARE` 以文件内既有常量名为准。）

3. WXML：在 FAB 同级增加 mask+sheet（结构参考 `pkg-misc/medications/index.wxml`）：
   - 遮罩 `bindtap="onCloseTypePicker"`
   - sheet 内标题「选择报告类型」、列表 `wx:for="{{reportEntryTypes}}"`、取消按钮
   - `catchtap` 阻止冒泡到遮罩

4. WXSS：`.report-type-mask` / `.report-type-sheet`，**z-index ≥ 1000**（FAB 为 30）。柠檬色点缀可轻量，勿大改分析页风格。

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/add-report-entry-ux.test.js tests/analysis-report-flow.test.js`

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/analysis-report/index.js miniprogram/pages/analysis-report/index.wxml miniprogram/pages/analysis-report/index.wxss tests/add-report-entry-ux.test.js
git commit -m "$(cat <<'EOF'
feat: 添加报告在全部筛选下先选类型

EOF
)"
```

---

### Task 3: 录入页单位 + 已填计数

**Files:**
- Modify: `miniprogram/pkg-report/add-report/index.js`
- Modify: `miniprogram/pkg-report/add-report/index.wxml`
- Modify: `miniprogram/pkg-report/add-report/index.wxss`
- Modify: `tests/add-report-entry-ux.test.js`
- Optionally adjust: `tests/add-report.test.js`（若源码断言被影响）

- [ ] **Step 1: Write failing tests**

```js
test('add-report shows unit and filled progress wiring', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  const wxml = read('miniprogram/pkg-report/add-report/index.wxml');

  assert.match(js, /filledCount/);
  assert.match(js, /totalCount/);
  assert.match(js, /refreshFilledCount/);
  assert.match(js, /async initIndicators[\s\S]*refreshFilledCount/);
  assert.match(js, /async switchReportType[\s\S]*refreshFilledCount/);
  assert.match(js, /loadReportData[\s\S]*refreshFilledCount/);
  assert.match(js, /onIndicatorValueInput[\s\S]*refreshFilledCount|refreshFilledCount[\s\S]*onIndicatorValueInput/);
  assert.match(wxml, /filledCount/);
  assert.match(wxml, /totalCount/);
  assert.match(wxml, /indicator\.unit/);
});
```

另写一个可执行的纯函数级测试更稳——若在 `add-report/index.js` 抽出：

```js
function countFilledIndicators(currentIndicators = [], indicatorData = {}) {
  return (currentIndicators || []).reduce((n, item) => {
    const value = indicatorData[item.key]?.value;
    return n + (value && String(value).trim() !== '' ? 1 : 0);
  }, 0);
}
```

并在同文件 `module.exports` 仅测试环境导出，或放到 `miniprogram/utils/reportFilledCount.js`。**推荐**小工具文件以便单测：

Create `miniprogram/utils/reportFilledCount.js` + 单元测试：

```js
test('countFilledIndicators only counts current indicator keys with non-empty value', () => {
  const { countFilledIndicators } = require('../miniprogram/utils/reportFilledCount');
  const current = [{ key: 'alt' }, { key: 'ast' }];
  const data = { alt: { value: '32' }, ast: { value: '  ' }, crea: { value: '99' } };
  assert.equal(countFilledIndicators(current, data), 1);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

1. `miniprogram/utils/reportFilledCount.js` 导出 `countFilledIndicators`（逻辑见上）。

2. `add-report` `data` 增加 `filledCount: 0`, `totalCount: 0`。

3. `refreshFilledCount()`：

```js
refreshFilledCount() {
  const currentIndicators = this.data.currentIndicators || [];
  const filledCount = countFilledIndicators(currentIndicators, this.data.indicatorData || {});
  const totalCount = currentIndicators.length;
  if (this.data.filledCount === filledCount && this.data.totalCount === totalCount) return;
  this.setData({ filledCount, totalCount });
}
```

4. 调用点（必须）：
   - `initIndicators`：在 **`recalculateAllIndicators()` 之后**（比值可能改写 value，不可在 recalculate 前刷）
   - `switchReportType`：在 `await this.initIndicators()` **之后再显式** `this.refreshFilledCount()`（即使 init 已刷，保留显式调用以满足接线断言与编辑切换路径清晰）
   - `loadReportData` 成功路径末尾（加载 + init 完成后）
   - `onIndicatorValueInput`：`field === 'value'` 时（或每次 value 相关 input 后）
   - `onIndicatorValueBlur`：value 相关路径
   - OCR 回填：在 **`setData` callback 内、`recalculateAllIndicators()` 之后**（查找 `applyRecognizedIndicators` 或等价 OCR 应用函数）
   - `calculateRatioIndicators` 内每次 `setData({ indicatorData })` 之后（覆盖 blur 触发的比值更新）

5. WXML：
   - 类型 section 与指标列表之间（或列表上方）：

```xml
<view class="filled-progress">
  <text>已填 {{filledCount}} / 共 {{totalCount}}</text>
</view>
```

   - 检测值 cell 内 input 旁：

```xml
<text wx:if="{{indicator.unit}}" class="value-unit">{{indicator.unit}}</text>
```

6. WXSS：轻量 `.filled-progress`、`.value-unit`（可参考 `report-detail` `.value-unit`）。

- [ ] **Step 4: Run — expect PASS**

Run:

```bash
node --test \
  tests/add-report-entry-ux.test.js \
  tests/add-report.test.js \
  tests/blood-biochem-report.test.js \
  tests/report-model.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/reportFilledCount.js miniprogram/pkg-report/add-report/index.js miniprogram/pkg-report/add-report/index.wxml miniprogram/pkg-report/add-report/index.wxss tests/add-report-entry-ux.test.js
git commit -m "$(cat <<'EOF'
feat: 报告录入展示单位与已填进度

EOF
)"
```

---

### Task 4: 回归扫尾

**Files:** 仅必要时微调测试

- [ ] **Step 1: Run regression**

```bash
node --test \
  tests/add-report-entry-ux.test.js \
  tests/add-report.test.js \
  tests/blood-biochem-report.test.js \
  tests/report-model.test.js \
  tests/analysis-report-flow.test.js \
  tests/report-workbench-data.test.js
```

不存在的文件跳过。失败则只修本功能相关断言。

- [ ] **Step 2: Source-verify checklist**

对照 spec 验收项用 grep 确认：三分支、unit、filledCount、z-index、共享常量。

- [ ] **Step 3: Commit only if fixes**

```bash
git commit -m "$(cat <<'EOF'
test: 完善新建报告交互回归

EOF
)"
```

---

## Out of scope

- 指标分组 / 折叠 / 搜索
- OCR / 校验规则变更
- 给血尿串联补单位文案
- 隐藏对比 Tab 的 FAB
