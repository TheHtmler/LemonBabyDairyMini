# Partial Feeding Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在喂奶编辑页支持「没喝完」时按冲后瓶内刻度 + 剩余 ml 统一比例折算各成分，保证蛋白统计准确，且全喝完路径零额外负担。

**Architecture:** 折算纯函数放进 `feedingRecordV2Utils.js`；编辑页表单始终编辑冲配量，保存时若剩余 > 0 则写入 `prepared*` + 折算后的 `formulaComponents`；展示层用适配器拼一行「冲后 · 喝 · 剩」次要文案。日汇总不改，继续读实际 `formulaComponents`。

**Tech Stack:** 微信小程序、`feeding_records_v2`、`node:test`、现有 `milk-feeding-editor-v2` / `dataRecordsV2Adapter` / `feeding-record-item`

**Spec:** `docs/superpowers/specs/2026-08-11-partial-feeding-intake-design.md`

## Global Constraints

- 比例分母必须是**冲后瓶内总量**，不能用加水量
- 主输入是**还剩 ___ ml**；空或 0 = 全喝完
- 入口默认收起，文案用「没喝完？按瓶内刻度折算」，禁止「高级设置」
- 全喝完保存：与现网一致，不强制写入新字段
- 剩余 = 冲后总量：禁止保存，toast「还剩整瓶时请删除本顿或改剩余」
- 本期不联动用药记录折算
- 文案避免开发用语（intakeRatio 等仅存库/代码，不进 UI）

---

## File Structure

### Modify
| File | Responsibility |
|------|----------------|
| `miniprogram/utils/feedingRecordV2Utils.js` | 估算冲后体积、比例、缩放成分、校验、保存字段组装、展示文案 |
| `tests/feeding-record-v2-utils.test.js` | 纯函数单测 |
| `miniprogram/pkg-milk/milk-feeding-editor-v2/index.js` | 折叠状态、输入、校验、保存/编辑回填 |
| `miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml` | 折算面板 + 备注 placeholder |
| `miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxss` | 低干扰折叠样式 |
| `tests/milk-feeding-editor-v2.test.js` | 保存 payload / 回填 / 校验契约 |
| `miniprogram/utils/dataRecordsV2Adapter.js` | `partialIntakeText` 等展示字段 |
| `miniprogram/components/feeding-record-item/feeding-record-item.{js,wxml,wxss}` | 展示次要文案 |
| `tests/feeding-record-item.test.js` | 组件展示契约 |
| `docs/superpowers/specs/2026-08-11-partial-feeding-intake-design.md` | 状态改为「已确认」 |

### Out of scope
| Item | Reason |
|------|--------|
| `daily_summary_v2` / 云函数 | 仍聚合实际 `formulaComponents` |
| `feeding-record-card` | 若首页未用该组件展示明细可跳过；若有引用 `partialIntakeText` 则一并接上 |
| 用药折算 | Spec 非目标 |

---

### Task 1: 折算纯函数 + 单测

**Files:**
- Modify: `miniprogram/utils/feedingRecordV2Utils.js`
- Modify: `tests/feeding-record-v2-utils.test.js`

**Interfaces:**
- Produces:
  - `estimatePreparedFinalVolume(components) -> number`
  - `scaleFormulaComponents(components, ratio) -> components`（深拷贝，缩放 volume/waterVolume/powderWeight，保留 snapshot）
  - `buildPartialIntakePreview({ components, preparedFinalVolume, leftoverVolume }) -> { ok, error, preparedFinalVolume, leftoverVolume, actualVolume, intakeRatio, scaledComponents, nutritionSummary }`
  - `buildPartialIntakeSavePayload({ preparedComponents, preparedFinalVolume, leftoverVolume }) -> { formulaComponents, nutritionSummary, preparedComponents?, preparedFinalVolume?, leftoverVolume?, intakeRatio?, consumedBottleVolume? } | { error: string }`
  - `formatPartialIntakeLabel({ preparedFinalVolume, leftoverVolume, consumedBottleVolume, intakeRatio }) -> string`  
    例：`冲后 155 · 喝 100（剩 55）`；全喝完或无效返回 `''`

- [ ] **Step 1: 在现有测试文件追加失败用例**

```js
const {
  // existing exports...
  estimatePreparedFinalVolume,
  scaleFormulaComponents,
  buildPartialIntakePreview,
  buildPartialIntakeSavePayload,
  formatPartialIntakeLabel,
  buildNutritionSummary
} = require('../miniprogram/utils/feedingRecordV2Utils');

test('estimatePreparedFinalVolume sums breast volume and powder waterVolume', () => {
  const components = [
    { kind: 'breast_milk', volume: 0, nutritionSnapshot: {} },
    {
      kind: 'formula_powder',
      waterVolume: 130,
      powderWeight: 14.2,
      proteinRole: 'natural',
      nutritionSnapshot: { protein: 10, calories: 500, fat: 0, carbs: 0, fiber: 0 }
    },
    {
      kind: 'formula_powder',
      waterVolume: 0,
      powderWeight: 5.27,
      proteinRole: 'special',
      nutritionSnapshot: { protein: 0, calories: 400, fat: 0, carbs: 0, fiber: 0 }
    }
  ];
  assert.equal(estimatePreparedFinalVolume(components), 130);
});

test('scaleFormulaComponents scales water and powder by same ratio', () => {
  const scaled = scaleFormulaComponents(
    [{
      kind: 'formula_powder',
      waterVolume: 130,
      powderWeight: 14.2,
      proteinRole: 'natural',
      nutritionSnapshot: { protein: 10, calories: 500, fat: 0, carbs: 0, fiber: 0 }
    }],
    100 / 155
  );
  assert.equal(scaled[0].waterVolume, 83.87); // roundValue 2 decimals: 130*100/155
  assert.equal(scaled[0].powderWeight, 9.16); // 14.2*100/155
});

test('buildPartialIntakeSavePayload uses bottle final volume as denominator', () => {
  const prepared = [{
    kind: 'formula_powder',
    powderName: '普奶',
    waterVolume: 130,
    powderWeight: 14.2,
    proteinRole: 'natural',
    nutritionSnapshot: { protein: 10.6, calories: 505, fat: 26, carbs: 55, fiber: 0 }
  }];
  const result = buildPartialIntakeSavePayload({
    preparedComponents: prepared,
    preparedFinalVolume: 155,
    leftoverVolume: 55
  });
  assert.equal(result.error, undefined);
  assert.equal(result.intakeRatio, roundApprox(100 / 155)); // implementer: compare with roundValue
  assert.equal(result.consumedBottleVolume, 100);
  assert.equal(result.leftoverVolume, 55);
  assert.equal(result.preparedFinalVolume, 155);
  assert.equal(result.formulaComponents[0].powderWeight, 9.16);
  assert.equal(result.nutritionSummary.totalPowderWeight, 9.16);
});

test('buildPartialIntakeSavePayload omits partial fields when leftover is 0', () => {
  const prepared = [{
    kind: 'formula_powder',
    waterVolume: 130,
    powderWeight: 14.2,
    proteinRole: 'natural',
    nutritionSnapshot: { protein: 10, calories: 500, fat: 0, carbs: 0, fiber: 0 }
  }];
  const result = buildPartialIntakeSavePayload({
    preparedComponents: prepared,
    preparedFinalVolume: 155,
    leftoverVolume: 0
  });
  assert.equal(result.formulaComponents[0].powderWeight, 14.2);
  assert.equal(result.preparedComponents, undefined);
  assert.equal(result.leftoverVolume, undefined);
  assert.equal(result.intakeRatio, undefined);
});

test('buildPartialIntakeSavePayload rejects full bottle leftover', () => {
  const result = buildPartialIntakeSavePayload({
    preparedComponents: [{ kind: 'breast_milk', volume: 60, nutritionSnapshot: {} }],
    preparedFinalVolume: 60,
    leftoverVolume: 60
  });
  assert.equal(result.error, '还剩整瓶时请删除本顿或改剩余');
});

test('buildPartialIntakeSavePayload rejects leftover greater than final volume', () => {
  const result = buildPartialIntakeSavePayload({
    preparedComponents: [{ kind: 'breast_milk', volume: 60, nutritionSnapshot: {} }],
    preparedFinalVolume: 60,
    leftoverVolume: 61
  });
  assert.equal(result.error, '剩余不能大于冲后瓶内总量');
});

test('formatPartialIntakeLabel', () => {
  assert.equal(
    formatPartialIntakeLabel({ preparedFinalVolume: 155, leftoverVolume: 55, consumedBottleVolume: 100 }),
    '冲后 155 · 喝 100（剩 55）'
  );
  assert.equal(formatPartialIntakeLabel({ leftoverVolume: 0 }), '');
});
```

（实现时 `9.16` / `83.87` 以模块内 `roundValue` 为准；若测试用本地期望，直接 `assert.equal` 与 `roundValue` 结果一致。）

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test tests/feeding-record-v2-utils.test.js
```

Expected: FAIL（新函数未导出）

- [ ] **Step 3: 实现纯函数并导出**

在 `feedingRecordV2Utils.js` 增加（保持现有 `roundValue` / `toNumber` / `buildNutritionSummary`）：

```js
function estimatePreparedFinalVolume(components = []) {
  return roundValue((components || []).reduce((sum, c) => {
    if (c?.kind === 'breast_milk') return sum + toNumber(c.volume);
    if (c?.kind === 'formula_powder') return sum + toNumber(c.waterVolume);
    return sum;
  }, 0));
}

function scaleFormulaComponents(components = [], ratio) {
  const r = toNumber(ratio, 1);
  return (components || []).map((c) => {
    if (!c || typeof c !== 'object') return c;
    if (c.kind === 'breast_milk') {
      return { ...c, volume: roundValue(toNumber(c.volume) * r) };
    }
    if (c.kind === 'formula_powder') {
      return {
        ...c,
        waterVolume: roundValue(toNumber(c.waterVolume) * r),
        powderWeight: roundValue(toNumber(c.powderWeight) * r)
      };
    }
    return { ...c };
  });
}

function buildPartialIntakePreview({ components, preparedFinalVolume, leftoverVolume }) {
  const prepared = Array.isArray(components) ? components : [];
  const finalVol = toNumber(preparedFinalVolume);
  const leftoverRaw = leftoverVolume === '' || leftoverVolume === null || leftoverVolume === undefined
    ? 0
    : toNumber(leftoverVolume);
  if (finalVol <= 0) {
    return { ok: false, error: '请填写冲后瓶内总量', preparedFinalVolume: finalVol, leftoverVolume: leftoverRaw };
  }
  if (leftoverRaw < 0) {
    return { ok: false, error: '剩余不能为负数', preparedFinalVolume: finalVol, leftoverVolume: leftoverRaw };
  }
  if (leftoverRaw > finalVol) {
    return { ok: false, error: '剩余不能大于冲后瓶内总量', preparedFinalVolume: finalVol, leftoverVolume: leftoverRaw };
  }
  if (leftoverRaw === finalVol && leftoverRaw > 0) {
    return { ok: false, error: '还剩整瓶时请删除本顿或改剩余', preparedFinalVolume: finalVol, leftoverVolume: leftoverRaw };
  }
  const actualVolume = roundValue(finalVol - leftoverRaw);
  const intakeRatio = finalVol > 0 ? actualVolume / finalVol : 1;
  const scaledComponents = leftoverRaw > 0 ? scaleFormulaComponents(prepared, intakeRatio) : prepared;
  return {
    ok: true,
    error: '',
    preparedFinalVolume: roundValue(finalVol),
    leftoverVolume: roundValue(leftoverRaw),
    actualVolume,
    intakeRatio: roundValue(intakeRatio, 4),
    scaledComponents,
    nutritionSummary: buildNutritionSummary(scaledComponents)
  };
}

function buildPartialIntakeSavePayload({ preparedComponents, preparedFinalVolume, leftoverVolume }) {
  const leftoverRaw = leftoverVolume === '' || leftoverVolume === null || leftoverVolume === undefined
    ? 0
    : toNumber(leftoverVolume);
  const prepared = Array.isArray(preparedComponents) ? preparedComponents : [];

  if (!(leftoverRaw > 0)) {
    return {
      formulaComponents: prepared,
      nutritionSummary: buildNutritionSummary(prepared)
    };
  }

  const estimated = estimatePreparedFinalVolume(prepared);
  const finalVol = toNumber(preparedFinalVolume, estimated);
  const preview = buildPartialIntakePreview({
    components: prepared,
    preparedFinalVolume: finalVol,
    leftoverVolume: leftoverRaw
  });
  if (!preview.ok) {
    return { error: preview.error };
  }
  return {
    formulaComponents: preview.scaledComponents,
    nutritionSummary: preview.nutritionSummary,
    preparedComponents: prepared,
    preparedFinalVolume: preview.preparedFinalVolume,
    leftoverVolume: preview.leftoverVolume,
    intakeRatio: preview.intakeRatio,
    consumedBottleVolume: preview.actualVolume
  };
}

function formatPartialIntakeLabel(input = {}) {
  const leftover = toNumber(input.leftoverVolume);
  if (!(leftover > 0)) return '';
  const prepared = toNumber(input.preparedFinalVolume);
  const consumed = input.consumedBottleVolume !== undefined && input.consumedBottleVolume !== ''
    ? toNumber(input.consumedBottleVolume)
    : roundValue(prepared - leftover);
  if (!(prepared > 0) || !(consumed >= 0)) return '';
  return `冲后 ${roundValue(prepared)} · 喝 ${roundValue(consumed)}（剩 ${roundValue(leftover)}）`;
}
```

导出上述 5 个函数。`intakeRatio` 展示用 4 位、存库用同一 `roundValue(..., 4)`。

- [ ] **Step 4: 跑测试确认通过**

```bash
node --test tests/feeding-record-v2-utils.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/feedingRecordV2Utils.js tests/feeding-record-v2-utils.test.js
git commit -m "$(cat <<'EOF'
feat(milk): 部分喝奶按冲后体积比例折算纯函数

以瓶内冲后总量为分母、剩余 ml 求比例，统一缩放水量与粉重。
EOF
)"
```

---

### Task 2: 喂奶编辑页折叠 UI + 保存/回填

**Files:**
- Modify: `miniprogram/pkg-milk/milk-feeding-editor-v2/index.js`
- Modify: `miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml`
- Modify: `miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxss`
- Modify: `tests/milk-feeding-editor-v2.test.js`

**Interfaces:**
- Consumes: Task 1 全部导出函数
- Produces: 保存 payload 在 leftover > 0 时含 `preparedComponents` / `preparedFinalVolume` / `leftoverVolume` / `intakeRatio` / `consumedBottleVolume`；编辑回填优先 `preparedComponents`

- [ ] **Step 1: 追加页面契约测试（先写失败用例）**

在 `tests/milk-feeding-editor-v2.test.js` 增加：

1. **wxml 文案契约**：源码包含 `没喝完？按瓶内刻度折算`、`冲后瓶内约`、`还剩`、备注 placeholder `可选备注`（不再是「喝奶状态 / 剩余量」）
2. **保存全喝完**：`leftoverVolume` 空/0 时，`calls.saved` / `calls.updated` payload **没有** `preparedComponents`，`formulaComponents` 粉重不变
3. **保存部分喝**：冲后 155、剩 55 时，payload `consumedBottleVolume === 100`，粉重按比例缩小，且含 `preparedComponents`
4. **拦截整瓶剩余**：toast 为「还剩整瓶时请删除本顿或改剩余」，不调用 add/update
5. **编辑回填**：record 带 `preparedComponents` + `leftoverVolume > 0` 时，`milkEntries` 来自 prepared（未折算量），`partialIntakeExpanded === true`

测试写法对齐该文件现有 `loadV2Page` / `createPageInstance` 模式；对 `saveFeedingRecord` 直接调 page 方法。

- [ ] **Step 2: 跑相关测试确认失败**

```bash
node --test tests/milk-feeding-editor-v2.test.js
```

Expected: 新断言 FAIL

- [ ] **Step 3: 扩展 page data 与方法**

`data` 增加：

```js
partialIntakeExpanded: false,
preparedFinalVolumeInput: '',
leftoverVolumeInput: '',
preparedFinalVolumeTouched: false,
partialIntakePreview: {
  visible: false,
  actualVolumeText: '',
  percentText: '',
  summaryText: '',
  error: ''
},
estimatedFinalVolume: 0
```

方法（名称可微调，但行为必须一致）：

- `getEstimatedFinalVolume()` → `estimatePreparedFinalVolume(this.buildCurrentComponents())`
- `syncPartialIntakeDefaults()`：若 `!preparedFinalVolumeTouched`，把 `preparedFinalVolumeInput` 设为估算值；刷新 preview
- `togglePartialIntakePanel()`：展开时若总量为空则填估算
- `onPreparedFinalVolumeInput`：设 `preparedFinalVolumeTouched = true`，刷新 preview
- `onLeftoverVolumeInput`：刷新 preview；若 leftover > 0 自动 `partialIntakeExpanded = true`
- `onPartialIntakeQuickLeftoverHalf()`：`leftover = round(final/2)`
- `onPartialIntakeQuickFinished()`：清空 leftover，preview 显示全喝完
- `onRestoreEstimatedFinalVolume()`：`touched = false` 并恢复估算
- `refreshPartialIntakePreview()`：调用 `buildPartialIntakePreview`，写入 `partialIntakePreview` 文案：  
  `实喝 ${actual} ml（约 ${Math.round(ratio*100)}%）` + 蛋白摘要（可用现有 preview 数字）
- 在 `refreshNutritionPreview` / 成分变更后调用 `syncPartialIntakeDefaults`（注意：预览营养仍以**冲配量**为主显示「本次冲配」；折算摘要只在折叠面板内显示「按比例实喝」——避免主预览与面板两套数打架。主 `nutritionPreview` 在展开且 leftover>0 时改为显示 **scaled** 营养，与保存一致。）

**保存 `saveFeedingRecord`：**

```js
const preparedComponents = this.buildCurrentComponents();
// ... existing empty check ...
const leftoverVolume = this.data.leftoverVolumeInput;
const preparedFinalVolume = this.data.preparedFinalVolumeInput !== ''
  ? Number(this.data.preparedFinalVolumeInput)
  : estimatePreparedFinalVolume(preparedComponents);

const partial = buildPartialIntakeSavePayload({
  preparedComponents,
  preparedFinalVolume,
  leftoverVolume
});
if (partial.error) {
  wxApi.showToast({ title: partial.error, icon: 'none' });
  return false;
}

const payload = {
  babyUid: this.data.babyUid,
  date: this.data.selectedDate,
  startTime: this.data.startTime,
  endTime: this.data.endTime || '',
  startDateTime: buildDateTime(this.data.selectedDate, this.data.startTime),
  endDateTime: this.data.endTime ? buildDateTime(this.data.selectedDate, this.data.endTime) : null,
  formulaComponents: partial.formulaComponents,
  nutritionSummary: partial.nutritionSummary,
  basicInfoSnapshot: this.buildBasicInfoSnapshot(),
  notes: this.data.notes || '',
  ...(partial.preparedComponents ? {
    preparedComponents: partial.preparedComponents,
    preparedFinalVolume: partial.preparedFinalVolume,
    leftoverVolume: partial.leftoverVolume,
    intakeRatio: partial.intakeRatio,
    consumedBottleVolume: partial.consumedBottleVolume
  } : {})
};
```

**编辑回填 `applyEditingRecord`：**

```js
const prepared = Array.isArray(record.preparedComponents) && record.preparedComponents.length
  ? record.preparedComponents
  : (Array.isArray(record.formulaComponents) ? record.formulaComponents : []);
const leftover = toNumber(record.leftoverVolume);
const expanded = leftover > 0;
const finalVol = record.preparedFinalVolume !== undefined && record.preparedFinalVolume !== ''
  ? toInputValue(record.preparedFinalVolume)
  : '';
// milkEntries from prepared...
this.setData({
  // ...existing fields...
  milkEntries: this.normalizeMilkEntries(milkEntriesFromPrepared),
  partialIntakeExpanded: expanded,
  leftoverVolumeInput: expanded ? toInputValue(leftover) : '',
  preparedFinalVolumeInput: finalVol,
  preparedFinalVolumeTouched: expanded && finalVol !== '',
  notes: record.notes || ''
}, () => {
  this.syncPartialIntakeDefaults();
  this.refreshNutritionPreview();
});
```

- [ ] **Step 4: WXML / WXSS**

在 `save-preview-stack` 与备注卡之间插入：

```xml
<view class="section-card secondary-card partial-intake-card" wx:if="{{estimatedFinalVolume > 0 || milkEntries.length}}">
  <view class="partial-intake-toggle" bindtap="togglePartialIntakePanel">
    <view class="partial-intake-toggle-copy">
      <text class="partial-intake-title">没喝完？按瓶内刻度折算</text>
      <text class="partial-intake-sub">全喝完可忽略</text>
    </view>
    <text class="partial-intake-chevron">{{partialIntakeExpanded ? '收起' : '展开'}}</text>
  </view>
  <view wx:if="{{partialIntakeExpanded}}" class="partial-intake-body">
    <text class="partial-intake-help">按瓶刻度填；粉会占体积，通常比加水量略多</text>
    <view class="partial-intake-row">
      <text class="partial-intake-label">冲后瓶内约</text>
      <input class="compact-input" type="digit" value="{{preparedFinalVolumeInput}}" bindinput="onPreparedFinalVolumeInput" />
      <text class="partial-intake-unit">ml</text>
      <text class="partial-intake-restore" wx:if="{{preparedFinalVolumeTouched}}" bindtap="onRestoreEstimatedFinalVolume">恢复估算</text>
    </view>
    <view class="partial-intake-row">
      <text class="partial-intake-label">还剩</text>
      <input class="compact-input" type="digit" value="{{leftoverVolumeInput}}" bindinput="onLeftoverVolumeInput" />
      <text class="partial-intake-unit">ml</text>
    </view>
    <view class="partial-intake-quick">
      <view class="partial-intake-chip" bindtap="onPartialIntakeQuickLeftoverHalf">剩一半</view>
      <view class="partial-intake-chip" bindtap="onPartialIntakeQuickFinished">全喝完</view>
    </view>
    <view class="partial-intake-preview" wx:if="{{partialIntakePreview.actualVolumeText}}">
      <text>{{partialIntakePreview.actualVolumeText}}</text>
      <text wx:if="{{partialIntakePreview.summaryText}}">{{partialIntakePreview.summaryText}}</text>
    </view>
    <text class="partial-intake-error" wx:if="{{partialIntakePreview.error}}">{{partialIntakePreview.error}}</text>
  </view>
</view>
```

备注：

```xml
placeholder="可选备注"
```

样式：轻量次级卡片，勿做成主 CTA；对齐现有 `compact-input` / `secondary-card`。

- [ ] **Step 5: 跑测试**

```bash
node --test tests/milk-feeding-editor-v2.test.js tests/feeding-record-v2-utils.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pkg-milk/milk-feeding-editor-v2/index.js \
  miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml \
  miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxss \
  tests/milk-feeding-editor-v2.test.js
git commit -m "$(cat <<'EOF'
feat(milk): 喂奶编辑支持没喝完按瓶内刻度折算

默认收起入口；剩余 ml + 冲后总量保存时按比例缩放成分。
EOF
)"
```

---

### Task 3: 列表/卡片展示「冲后 · 喝 · 剩」

**Files:**
- Modify: `miniprogram/utils/dataRecordsV2Adapter.js`
- Modify: `miniprogram/components/feeding-record-item/feeding-record-item.js`
- Modify: `miniprogram/components/feeding-record-item/feeding-record-item.wxml`
- Modify: `miniprogram/components/feeding-record-item/feeding-record-item.wxss`（若需次要文案样式）
- Modify: `tests/feeding-record-item.test.js`
- 若存在 adapter 单测则追加；否则在 item 测试中覆盖字段透传

**Interfaces:**
- Consumes: `formatPartialIntakeLabel`
- Produces: display record 字段 `partialIntakeText`

- [ ] **Step 1: 写失败测试**

```js
// feeding-record-item.test.js
test('feeding-record-item shows partial intake secondary line', () => {
  const component = loadFeedingRecordItem();
  const instance = createComponentInstance(component);
  instance.updateDisplay({
    formattedStartTime: '09:30',
    milkSummaryItems: [{ badge: '普', name: '普奶', amountText: '84ml', badgeClass: 'regular', badgeStyle: '' }],
    partialIntakeText: '冲后 155 · 喝 100（剩 55）',
    nutritionDisplay: { calories: 100, carbs: 10, fat: 5 }
  });
  assert.equal(instance.data.partialIntakeText, '冲后 155 · 喝 100（剩 55）');
});
```

另加 adapter 源码或小型单测（若项目已有 `dataRecordsV2Adapter` 测试文件则追加；否则在 `tests/feeding-record-v2-utils.test.js` 旁新建 `tests/data-records-v2-adapter-partial.test.js`）：

```js
const { createFeedingDisplayFromV2 } = require('../miniprogram/utils/dataRecordsV2Adapter');

test('createFeedingDisplayFromV2 exposes partialIntakeText', () => {
  const display = createFeedingDisplayFromV2({
    startTime: '09:30',
    formulaComponents: [{ kind: 'breast_milk', volume: 40, nutritionSnapshot: {} }],
    nutritionSummary: { calories: 1, carbs: 0, fat: 0, naturalProtein: 0, specialProtein: 0 },
    preparedFinalVolume: 155,
    leftoverVolume: 55,
    consumedBottleVolume: 100
  });
  assert.equal(display.partialIntakeText, '冲后 155 · 喝 100（剩 55）');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node --test tests/feeding-record-item.test.js tests/data-records-v2-adapter-partial.test.js
```

- [ ] **Step 3: 实现**

`createFeedingDisplayFromV2`：

```js
partialIntakeText: formatPartialIntakeLabel({
  preparedFinalVolume: record.preparedFinalVolume,
  leftoverVolume: record.leftoverVolume,
  consumedBottleVolume: record.consumedBottleVolume,
  intakeRatio: record.intakeRatio
})
```

`feeding-record-item`：在 `milk-summary-row` 下增加：

```xml
<view class="partial-intake-row" wx:if="{{partialIntakeText}}">
  <text class="partial-intake-text">{{partialIntakeText}}</text>
</view>
```

`updateDisplay` 读取 `record.partialIntakeText`。

若 `feeding-record-card` 直接渲染同类信息，同样接 `partialIntakeText`；否则跳过。

- [ ] **Step 4: 跑测试**

```bash
node --test tests/feeding-record-item.test.js tests/data-records-v2-adapter-partial.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/dataRecordsV2Adapter.js \
  miniprogram/components/feeding-record-item/feeding-record-item.js \
  miniprogram/components/feeding-record-item/feeding-record-item.wxml \
  miniprogram/components/feeding-record-item/feeding-record-item.wxss \
  tests/feeding-record-item.test.js \
  tests/data-records-v2-adapter-partial.test.js
git commit -m "$(cat <<'EOF'
feat(milk): 喂奶列表展示冲后实喝剩余摘要

有剩余时显示「冲后 · 喝 · 剩」，主营养仍为折算后实际摄入。
EOF
)"
```

---

### Task 4: 回归 + spec 状态收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-partial-feeding-intake-design.md`（状态 → 已确认）
- Verify: 相关测试全绿

- [ ] **Step 1: 跑回归**

```bash
node --test \
  tests/feeding-record-v2-utils.test.js \
  tests/milk-feeding-editor-v2.test.js \
  tests/feeding-record-item.test.js \
  tests/data-records-v2-adapter-partial.test.js \
  tests/feeding-record-v2-model.test.js
```

Expected: PASS

- [ ] **Step 2: 更新 spec 状态**

将设计文档头部 `状态：待审阅` 改为 `状态：已确认`。

- [ ] **Step 3: 手动验收清单（写入 commit body 即可，不必新文档）**

- 新建一顿、不展开折算 → 保存后字段与改前一致  
- 水 130 + 粉，冲后改 155，剩 55 → 粉重 ×100/155，列表有摘要行  
- 剩 = 冲后总量 → 无法保存  
- 编辑旧记录（无 prepared 字段）不崩  
- 编辑有剩余的记录 → 回填冲配量而非已折算量  

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-partial-feeding-intake-design.md
git commit -m "$(cat <<'EOF'
docs: 确认部分喝奶折算设计状态为已确认
EOF
)"
```

---

## Spec coverage checklist

| Spec 要求 | Task |
|-----------|------|
| 冲后总体积为分母 | Task 1 |
| 剩余 ml 主输入 | Task 2 |
| 默认收起口语入口 | Task 2 |
| 全喝完不强制新字段 | Task 1 + 2 |
| 整瓶剩余禁止保存 | Task 1 + 2 |
| prepared* 落库 + 实际 components | Task 1 + 2 |
| 编辑回填 prepared | Task 2 |
| 列表次要文案 | Task 3 |
| 备注 placeholder | Task 2 |
| 不改日汇总算法 | （无任务，刻意不做） |
| 不联动用药 | （无任务，刻意不做） |
