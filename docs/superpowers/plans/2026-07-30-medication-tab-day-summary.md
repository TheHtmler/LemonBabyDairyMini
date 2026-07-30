# 用药 Tab 当日汇总 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在数据记录页「用药」Tab 操作栏下方增加与水量/尿布/睡眠同风格的当日按药汇总条（药名、总剂量、次数），基于已加载列表本地聚合、不增加云调用。

**Architecture:** 抽纯函数 `buildMedicationDayStats(records)`；`processMedicationData` 在处理当日列表时同步算出 `medicationStats` 并一次 `setData`；WXML 用 `medication-stats-row` 渲染 pills。

**Tech Stack:** 微信小程序、`node:test`、现有 `pages/data-records-v2` / `MedicationRecordModel`

**Spec:** `docs/superpowers/specs/2026-07-30-medication-tab-day-summary-design.md`

## Global Constraints

- 仅当前选中日；不改顶部「当日汇总」卡片；不对照方案目标次数
- 不扩展 `daily_summary_v2.medication`；不新增云查询
- UI 对齐水量/尿布/睡眠的 Tab 内 `*-stats-row`；柠檬主题（淡黄 pill）
- 无记录时隐藏汇总行；同组单位不一致时不硬加剂量
- 分支：`feature/medication-tab-day-summary`（勿在 `main` 直接改）

---

## File Structure

### Create
| File | Responsibility |
|------|----------------|
| `miniprogram/utils/medicationDayStats.js` | `buildMedicationDayStats(records)` 纯函数 |
| `tests/medication-day-stats.test.js` | 聚合规则单测 |
| `tests/data-records-medication-summary.test.js` | 页面接线源码契约（wxml/js 字符串） |

### Modify
| File | Change |
|------|--------|
| `miniprogram/pages/data-records-v2/index.js` | require util；data 增加 `medicationStats`；`processMedicationData` 与清空路径写入/清空 |
| `miniprogram/pages/data-records-v2/index.wxml` | 用药 Tab 增加 stats-row |
| `miniprogram/pages/data-records-v2/index.wxss` | `medication-stats-*` 样式（淡黄，可换行） |

### Out of scope
- `dailySummaryV2Utils` / 首页 `buildMedicationChecklist` / 药物方案页

---

### Task 1: `buildMedicationDayStats` 纯函数

**Files:**
- Create: `miniprogram/utils/medicationDayStats.js`
- Test: `tests/medication-day-stats.test.js`

**Interfaces:**
- Consumes: 当日用药记录数组（字段含 `medicationId?`、`medicationName?`、`dosage`、`unit`）
- Produces: `buildMedicationDayStats(records) => Array<{ key, medicationName, totalDosage, dosageText, unit, count }>`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMedicationDayStats } = require('../miniprogram/utils/medicationDayStats');

test('empty list returns empty stats', () => {
  assert.deepEqual(buildMedicationDayStats([]), []);
  assert.deepEqual(buildMedicationDayStats(null), []);
});

test('sums same medication same unit and counts doses', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: '左卡尼丁', dosage: 1.5, unit: 'ml' },
    { medicationId: 'm1', medicationName: '左卡尼丁', dosage: 1.5, unit: 'ml' }
  ]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].key, 'm1');
  assert.equal(stats[0].medicationName, '左卡尼丁');
  assert.equal(stats[0].totalDosage, 3);
  assert.equal(stats[0].dosageText, '3');
  assert.equal(stats[0].unit, 'ml');
  assert.equal(stats[0].count, 2);
});

test('groups by medicationId not display name', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'a', medicationName: '同名药', dosage: 1, unit: 'ml' },
    { medicationId: 'b', medicationName: '同名药', dosage: 2, unit: 'ml' }
  ]);
  assert.equal(stats.length, 2);
});

test('falls back to medicationName when id missing', () => {
  const stats = buildMedicationDayStats([
    { medicationName: '精氨酸', dosage: 1.2, unit: 'ml' },
    { medicationName: '精氨酸', dosage: 1.2, unit: 'ml' }
  ]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].key, '精氨酸');
  assert.equal(stats[0].totalDosage, 2.4);
  assert.equal(stats[0].count, 2);
});

test('mixed units in same group skip dosage total', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: '某药', dosage: 1, unit: 'ml' },
    { medicationId: 'm1', medicationName: '某药', dosage: 1, unit: 'mg' }
  ]);
  assert.equal(stats[0].count, 2);
  assert.equal(stats[0].totalDosage, null);
  assert.equal(stats[0].dosageText, '');
  assert.equal(stats[0].unit, '');
});

test('invalid dosage treated as 0', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: 'B12', dosage: 'x', unit: 'ml' },
    { medicationId: 'm1', medicationName: 'B12', dosage: 1, unit: 'ml' }
  ]);
  assert.equal(stats[0].totalDosage, 1);
  assert.equal(stats[0].count, 2);
});

test('sorts by medicationName', () => {
  const stats = buildMedicationDayStats([
    { medicationId: '2', medicationName: '左卡尼丁', dosage: 1, unit: 'ml' },
    { medicationId: '1', medicationName: '精氨酸', dosage: 1, unit: 'ml' }
  ]);
  assert.deepEqual(stats.map((s) => s.medicationName), ['左卡尼丁', '精氨酸'].sort((a, b) => a.localeCompare(b)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/medication-day-stats.test.js`  
Expected: FAIL（模块不存在或未导出）

- [ ] **Step 3: Write minimal implementation**

Create `miniprogram/utils/medicationDayStats.js`:

```js
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUnit(unit) {
  return String(unit == null ? '' : unit).trim();
}

function formatDosageText(total) {
  if (total == null || !Number.isFinite(total)) return '';
  const rounded = Math.round(total * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function buildMedicationDayStats(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (list.length === 0) return [];

  const groups = new Map();
  list.forEach((record) => {
    const id = record.medicationId != null ? String(record.medicationId).trim() : '';
    const name = String(record.medicationName || '').trim() || '未命名药物';
    const key = id || name;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        medicationName: name,
        count: 0,
        dosages: [],
        units: []
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (!group.medicationName || group.medicationName === '未命名药物') {
      if (name && name !== '未命名药物') group.medicationName = name;
    }
    group.dosages.push(toNumber(record.dosage));
    group.units.push(normalizeUnit(record.unit));
  });

  return Array.from(groups.values())
    .map((group) => {
      const uniqueUnits = [...new Set(group.units.filter(Boolean))];
      const allBlank = group.units.every((u) => !u);
      const sameUnit = allBlank || uniqueUnits.length <= 1;
      const unit = sameUnit ? (uniqueUnits[0] || group.units[0] || '') : '';
      const totalDosage = sameUnit
        ? group.dosages.reduce((sum, d) => sum + d, 0)
        : null;
      return {
        key: group.key,
        medicationName: group.medicationName,
        totalDosage,
        dosageText: formatDosageText(totalDosage),
        unit: totalDosage == null ? '' : unit,
        count: group.count
      };
    })
    .sort((a, b) => a.medicationName.localeCompare(b.medicationName));
}

module.exports = {
  buildMedicationDayStats
};
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `node --test tests/medication-day-stats.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/medicationDayStats.js tests/medication-day-stats.test.js
git commit -m "$(cat <<'EOF'
feat(medication): add day stats aggregation util

Pure function for per-drug dose totals used by data-records tab.
EOF
)"
```

---

### Task 2: 接入 `processMedicationData`

**Files:**
- Modify: `miniprogram/pages/data-records-v2/index.js`（文件顶部 require；`data` 初值约 1519–1521；`processMedicationData` 约 5792–5835；清空记录处约 4703–4705）
- Test: 扩展 `tests/data-records-medication-summary.test.js`（本 Task 先写 js 契约部分；Task 3 补 wxml）

**Interfaces:**
- Consumes: `buildMedicationDayStats` from Task 1
- Produces: page `data.medicationStats`；空列表 / 清数据时为 `[]`

- [ ] **Step 1: Write failing page-wiring tests (js portion)**

Create `tests/data-records-medication-summary.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const pageJs = path.join('miniprogram', 'pages', 'data-records-v2', 'index.js');

test('data-records page wires medicationDayStats into processMedicationData', () => {
  const source = fs.readFileSync(pageJs, 'utf8');
  assert.match(source, /medicationDayStats/);
  assert.match(source, /buildMedicationDayStats/);
  assert.match(source, /medicationStats/);
  assert.match(source, /processMedicationData/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/data-records-medication-summary.test.js`  
Expected: FAIL（尚未 require / 未写 `medicationStats`）

- [ ] **Step 3: Wire page JS**

1. 在 `index.js` 顶部其它 utils require 旁增加：

```js
const { buildMedicationDayStats } = require('../../utils/medicationDayStats');
```

2. `data` 初值在 `groupedMedicationRecords: []` 旁增加：

```js
medicationStats: [],
```

3. 修改 `processMedicationData`：空列表分支与成功分支都写入 `medicationStats`：

```js
processMedicationData: function(medicationRecords) {
  if (!medicationRecords || medicationRecords.length === 0) {
    this.setData({
      medicationRecords: [],
      groupedMedicationRecords: [],
      medicationStats: []
    });
    return;
  }

  // ... existing map + sort ...

  const groupedMedicationRecords = MedicationRecordModel.groupRecordsByMedication(processedMedicationRecords);
  const medicationStats = buildMedicationDayStats(processedMedicationRecords);

  this.setData({
    medicationRecords: processedMedicationRecords,
    groupedMedicationRecords: groupedMedicationRecords,
    medicationStats: medicationStats
  });
},
```

4. 清空当日记录的 `setData`（约 4703）同步加 `medicationStats: []`。

- [ ] **Step 4: Run tests**

Run: `node --test tests/medication-day-stats.test.js tests/data-records-medication-summary.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/data-records-v2/index.js tests/data-records-medication-summary.test.js
git commit -m "$(cat <<'EOF'
feat(medication): compute tab day stats with record list

Reuse loaded medicationRecords; no extra cloud query.
EOF
)"
```

---

### Task 3: 用药 Tab 汇总 UI

**Files:**
- Modify: `miniprogram/pages/data-records-v2/index.wxml`（`activeTab === 'medication'` 块，约 343–378）
- Modify: `miniprogram/pages/data-records-v2/index.wxss`（在 `.water-stats-row` 附近新增样式）
- Modify: `tests/data-records-medication-summary.test.js`（补 wxml/wxss 契约）

**Interfaces:**
- Consumes: `medicationStats`、`loadingRecordTabs.medication`
- Produces: Tab 内可见按药 pill 汇总

- [ ] **Step 1: Extend failing UI contract tests**

在 `tests/data-records-medication-summary.test.js` 追加：

```js
const pageWxml = path.join('miniprogram', 'pages', 'data-records-v2', 'index.wxml');
const pageWxss = path.join('miniprogram', 'pages', 'data-records-v2', 'index.wxss');

test('medication tab renders stats row from medicationStats', () => {
  const template = fs.readFileSync(pageWxml, 'utf8');
  assert.match(template, /medication-stats-row/);
  assert.match(template, /medicationStats/);
  assert.match(template, /medication-stat-pill/);
  assert.match(template, /dosageText/);
});

test('medication stats styles exist', () => {
  const styles = fs.readFileSync(pageWxss, 'utf8');
  assert.match(styles, /\.medication-stats-row/);
  assert.match(styles, /\.medication-stat-pill/);
});
```

- [ ] **Step 2: Run test to verify UI portion fails**

Run: `node --test tests/data-records-medication-summary.test.js`  
Expected: FAIL on new assertions

- [ ] **Step 3: Add WXML**

在用药 Tab 操作栏 `</view>`（`card-title actions-only` 结束）之后、loading/列表之前插入：

```xml
<view class="medication-stats-row" wx:if="{{!loadingRecordTabs.medication && medicationStats.length > 0}}">
  <view class="medication-stat-pill" wx:for="{{medicationStats}}" wx:key="key">
    <text class="medication-stat-label">{{item.medicationName}}</text>
    <text class="medication-stat-value" wx:if="{{item.totalDosage != null}}">{{item.dosageText}} {{item.unit}}</text>
    <text class="medication-stat-value" wx:else>剂量单位不一</text>
    <text class="medication-stat-count">{{item.count}}次</text>
  </view>
</view>
```

- [ ] **Step 4: Add WXSS**

在 `.water-stats-row` 附近增加（柠檬淡黄，可换行；药多时不强制三列）：

```css
.medication-stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 0 0 16rpx;
}

.medication-stat-pill {
  flex: 1 1 calc(50% - 12rpx);
  min-width: 200rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 16rpx 18rpx;
  border-radius: 20rpx;
  background: rgba(255, 238, 185, 0.72);
  border: 1rpx solid rgba(255, 184, 0, 0.14);
  box-sizing: border-box;
}

.medication-stat-label {
  font-size: 22rpx;
  color: #8d7344;
}

.medication-stat-value {
  font-size: 30rpx;
  font-weight: 700;
  color: #8a6500;
}

.medication-stat-count {
  font-size: 22rpx;
  color: #a08a4a;
}
```

- [ ] **Step 5: Run all related tests**

Run:

```bash
node --test \
  tests/medication-day-stats.test.js \
  tests/data-records-medication-summary.test.js
```

Expected: PASS

- [ ] **Step 6: Manual smoke（开发者工具）**

1. 打开数据记录 → 选有用药记录的日期 → 用药 Tab：汇总 pills 与列表一致  
2. 删掉全部用药：汇总行消失，空态出现  
3. 补充一条用药：汇总次数/剂量更新  
4. 确认 Network/云调用相对改造前用药查询次数不增加

- [ ] **Step 7: Commit**

```bash
git add \
  miniprogram/pages/data-records-v2/index.wxml \
  miniprogram/pages/data-records-v2/index.wxss \
  tests/data-records-medication-summary.test.js
git commit -m "$(cat <<'EOF'
feat(medication): show day summary pills on records tab

Match water/bowel/sleep tab stats row for per-drug totals.
EOF
)"
```

---

## Spec coverage self-check

| Spec 要求 | Task |
|-----------|------|
| 选中日、Tab 内汇总 | Task 3 |
| 药名 + 总剂量 + 次数 | Task 1 + 3 |
| 本地聚合、不多一次云调用 | Task 1–2 |
| 无记录隐藏汇总 | Task 3 `wx:if` |
| 混单位不硬加 | Task 1 |
| 不改顶部当日汇总 / 方案对照 | 未列入任何 Task |
| 单测纯函数 | Task 1 |

## Placeholder scan

无 TBD/TODO；函数名与页面字段统一为 `buildMedicationDayStats` / `medicationStats`。
