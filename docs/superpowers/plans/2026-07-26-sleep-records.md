# Sleep Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立集合 `sleep_records` 的睡眠分类：起止时间、可选备注、跨午夜、进行中、首页一键醒来与开新拦截，并接入 Tab / 时间轴 / 日汇总。

**Architecture:** 镜像喝水记录路径——`SleepRecordModel` + `pkg-records/sleep-record` 页面 + `daily_summary_v2.sleep` + 首页/数据记录全量入口。跨午夜 `endDateTime` 拼装与时长计算抽到纯函数 `sleepRecordUtils.js`，便于单测；删除与喝水一致走硬删 `.remove()`。

**Tech Stack:** 微信小程序、云开发 DB、`node:test`、现有 `DailySummaryV2Model` / `dailyRecordV2Service` / `homeDashboard`

**Spec:** `docs/superpowers/specs/2026-07-26-sleep-records-design.md`

---

## File Structure

### Create
| File | Responsibility |
|------|----------------|
| `miniprogram/utils/sleepRecordUtils.js` | 拼装起止 Date、时长、展示文案、进行中判断 |
| `miniprogram/models/sleepRecord.js` | `sleep_records` CRUD、`findOngoing`、`completeSleep`、markDirty |
| `miniprogram/pkg-records/sleep-record/index.{js,wxml,wxss,json}` | 记录/编辑页（紧凑表单，无 canvas） |
| `tests/sleep-record-utils.test.js` | 跨午夜 / 时长 / 进行中纯函数 |
| `tests/sleep-record.test.js` | model + summary 源码契约（仿 water） |
| `tests/sleep-record-page.test.js` | 页面关键字符串契约 |

### Modify
| File | Change |
|------|--------|
| `miniprogram/app.json` | 注册 `sleep-record/index` |
| `miniprogram/utils/recordTabsPreference.js` | Tab `{ key: 'sleep', label: '睡眠' }` |
| `miniprogram/utils/dailySummaryV2Utils.js` | empty / normalize / `buildSleepSummary` / counts |
| `miniprogram/utils/dailyRecordV2Service.js` | load + tab `sleep` + overview |
| `cloudfunctions/rebuildDailySummaryV2/index.js` | load/aggregate sleep |
| `cloudfunctions/accountCleanup/index.js` | `sleep_records` |
| `miniprogram/utils/homeDashboard.js` | timeline sleep events |
| `miniprogram/pages/daily-feeding/index.{js,wxml,wxss}` | Tab、快捷入口、banner、醒来、拦截 |
| `miniprogram/pages/data-records-v2/index.{js,wxml,wxss}` | Tab 列表、导航、删除、overview |
| `tests/record-tabs-preference.test.js` | length 6→7 |
| `tests/daily-summary-v2-utils.test.js` | sleep 聚合用例 |
| `tests/rebuild-daily-summary-v2.test.js` | mock `sleep_records` |
| `tests/daily-record-v2-service.test.js` | sleep 加载 |
| `tests/home-dashboard.test.js` | sleep timeline |
| `tests/account-cleanup.test.js` | 集合列表 |

### Out of repo (manual note in final commit message / PR)
- 云开发控制台新建集合 `sleep_records`（建议索引：`babyUid+date`、`babyUid+startDateTime`）

---

### Task 1: sleepRecordUtils 纯函数

**Files:**
- Create: `miniprogram/utils/sleepRecordUtils.js`
- Test: `tests/sleep-record-utils.test.js`

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDateTime,
  resolveEndDateTime,
  computeDurationMinutes,
  isOngoingSleep,
  formatDurationLabel
} = require('../miniprogram/utils/sleepRecordUtils');

test('resolveEndDateTime keeps same day when end after start', () => {
  const start = buildDateTime('2026-07-26', '08:00');
  const end = resolveEndDateTime('2026-07-26', '08:00', '09:30');
  assert.equal(end.getDate(), 26);
  assert.equal(computeDurationMinutes(start, end), 90);
});

test('resolveEndDateTime rolls to next day for cross-midnight', () => {
  const start = buildDateTime('2026-07-26', '22:00');
  const end = resolveEndDateTime('2026-07-26', '22:00', '06:00');
  assert.equal(end.getDate(), 27);
  assert.equal(computeDurationMinutes(start, end), 8 * 60);
});

test('resolveEndDateTime rejects same-minute end (no 24h roll)', () => {
  assert.equal(resolveEndDateTime('2026-07-26', '22:10', '22:10'), null);
});

test('resolveEndDateTime returns null when endTime empty', () => {
  assert.equal(resolveEndDateTime('2026-07-26', '22:00', ''), null);
  assert.equal(resolveEndDateTime('2026-07-26', '22:00', null), null);
});

test('isOngoingSleep detects missing end', () => {
  assert.equal(isOngoingSleep({ startTime: '22:00' }), true);
  assert.equal(isOngoingSleep({ startTime: '22:00', endTime: '06:00' }), false);
});

test('formatDurationLabel', () => {
  assert.equal(formatDurationLabel(90), '1小时30分');
  assert.equal(formatDurationLabel(45), '45分');
  assert.equal(formatDurationLabel(null), '');
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test tests/sleep-record-utils.test.js
```

Expected: FAIL (module missing)

- [ ] **Step 3: Implement utils**

```js
// miniprogram/utils/sleepRecordUtils.js
function buildDateTime(dateKey, timeString = '00:00') {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  const [hours, minutes] = String(timeString || '00:00').split(':').map(Number);
  return new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(month) ? month - 1 : 0,
    Number.isFinite(day) ? day : 1,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
}

function resolveEndDateTime(dateKey, startTime, endTime) {
  const endStr = String(endTime || '').trim();
  if (!endStr) return null;
  const startDateTime = buildDateTime(dateKey, startTime);
  const sameDayEnd = buildDateTime(dateKey, endStr);
  // 同分钟：无效（避免滚到次日变成约 24h，挡住「立刻醒来」）
  if (sameDayEnd.getTime() === startDateTime.getTime()) return null;
  if (sameDayEnd > startDateTime) return sameDayEnd;
  // 结束钟点早于开始 → 跨午夜滚次日
  const next = new Date(startDateTime.getFullYear(), startDateTime.getMonth(), startDateTime.getDate() + 1);
  const nextKey = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  const endDateTime = buildDateTime(nextKey, endStr);
  if (!(endDateTime > startDateTime)) return null;
  return endDateTime;
}

function computeDurationMinutes(startDateTime, endDateTime) {
  if (!(startDateTime instanceof Date) || !(endDateTime instanceof Date)) return null;
  const ms = endDateTime.getTime() - startDateTime.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

function isOngoingSleep(record = {}) {
  const endTime = record.endTime;
  const endDateTime = record.endDateTime;
  const hasEndTime = endTime != null && String(endTime).trim() !== '';
  const hasEndDateTime = endDateTime != null && endDateTime !== '';
  return !hasEndTime && !hasEndDateTime;
}

function formatDurationLabel(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h <= 0) return `${rem}分`;
  if (rem === 0) return `${h}小时`;
  return `${h}小时${rem}分`;
}

module.exports = {
  buildDateTime,
  resolveEndDateTime,
  computeDurationMinutes,
  isOngoingSleep,
  formatDurationLabel
};
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test tests/sleep-record-utils.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/sleepRecordUtils.js tests/sleep-record-utils.test.js
git commit -m "feat(sleep): add sleep datetime utils with cross-midnight support"
```

---

### Task 2: SleepRecordModel

**Files:**
- Create: `miniprogram/models/sleepRecord.js`
- Test: `tests/sleep-record.test.js`

- [ ] **Step 1: Write failing source-contract test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sleepRecord model covers CRUD ongoing and dirty', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'models', 'sleepRecord.js'), 'utf8');
  assert.match(source, /sleep_records/);
  assert.match(source, /startTime/);
  assert.match(source, /endTime/);
  assert.match(source, /durationMinutes/);
  assert.match(source, /findOngoing/);
  assert.match(source, /completeSleep/);
  assert.match(source, /markDirty/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async delete/);
  assert.match(source, /resolveEndDateTime/);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test tests/sleep-record.test.js
```

- [ ] **Step 3: Implement model**

Mirror `miniprogram/models/waterRecord.js`:

- `collection('sleep_records')`
- `buildPayload`:
  - require `startTime`
  - `date`/`dateKey` = 开始日（`data.date || data.dateKey || today`）
  - `startDateTime = buildDateTime(dateKey, startTime)`
  - if `endTime` provided: `endDateTime = resolveEndDateTime(...)`; if null throw `结束时间无效`
  - else `endTime: null`, `endDateTime: null`, `durationMinutes: null`
  - `durationMinutes = computeDurationMinutes(...)` when ended
  - `notes` 同 water 清空语义
  - `status: 'active'`
- `findByDate`: prefer `startDateTime` day range + `status:'active'`, fallback `date` + status; `orderBy('startDateTime','desc')`
- `findOngoing(babyUid)`: `where({ babyUid, status:'active' })` then filter `isOngoingSleep` in memory（云开发对「字段不存在」查询不稳时更稳妥）；也可先查后滤。返回 `{ success, data: records }`
- `completeSleep(id, endTimeOptional)`:
  - load record; if not ongoing, return success noop or message
  - `endTime = endTimeOptional || now HH:MM`
  - build end via `resolveEndDateTime(dateKey, startTime, endTime)`
  - if null → `{ success:false, code:'INVALID_END', message:'结束时间无效' }`（供一键醒来跳编辑页）
  - else `update(id, { endTime })`
- create/update/delete + markDirty 完全抄 water（改字段名）

Export: `module.exports = new SleepRecordModel();`

- [ ] **Step 4: Run tests PASS**

```bash
node --test tests/sleep-record-utils.test.js tests/sleep-record.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/models/sleepRecord.js tests/sleep-record.test.js
git commit -m "feat(sleep): add SleepRecordModel for sleep_records"
```

---

### Task 3: dailySummaryV2Utils sleep 段

**Files:**
- Modify: `miniprogram/utils/dailySummaryV2Utils.js`
- Modify: `tests/daily-summary-v2-utils.test.js`（或扩展 `tests/sleep-record.test.js`）
- Test: add assertions in `tests/sleep-record.test.js` for utils source + one behavioral test if utils are require-able without wx

- [ ] **Step 1: Add failing behavioral test**

In `tests/sleep-record.test.js` (or daily-summary file):

```js
const { buildDailySummaryV2 } = require('../miniprogram/utils/dailySummaryV2Utils');

test('buildDailySummaryV2 aggregates sleep duration and ongoing', () => {
  const summary = buildDailySummaryV2({
    babyUid: 'b1',
    date: '2026-07-26',
    sleepRecords: [
      { status: 'active', durationMinutes: 90, endTime: '09:30' },
      { status: 'active', startTime: '22:00' } // ongoing
    ]
  });
  assert.equal(summary.sleep.totalRecords, 2);
  assert.equal(summary.sleep.totalDurationMinutes, 90);
  assert.equal(summary.sleep.ongoingCount, 1);
  assert.equal(summary.recordCounts.sleep, 2);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement in `dailySummaryV2Utils.js`**

1. `createEmptyDailySummaryV2`:
```js
sleep: { totalRecords: 0, totalDurationMinutes: 0, ongoingCount: 0 },
// recordCounts.sleep: 0
// sourceUpdatedAt.sleep: null
```

2. Add `buildSleepSummary(records)`:
```js
function buildSleepSummary(records = []) {
  const valid = (records || []).filter((r) => (r?.status || 'active') === 'active');
  let totalDurationMinutes = 0;
  let ongoingCount = 0;
  valid.forEach((r) => {
    const endEmpty = r.endTime == null || String(r.endTime).trim() === '';
    if (endEmpty && (r.endDateTime == null || r.endDateTime === '')) {
      ongoingCount += 1;
    } else {
      totalDurationMinutes += toNumber(r.durationMinutes);
    }
  });
  return {
    totalRecords: valid.length,
    totalDurationMinutes: roundValue(totalDurationMinutes, 0),
    ongoingCount
  };
}
```

3. Wire into `normalizeDailySummaryV2` + `buildDailySummaryV2` (`sleepRecords` input, `recordCounts.sleep`, `sourceUpdatedAt.sleep`).

4. Export `buildSleepSummary` only if other tests need it; otherwise keep private.

- [ ] **Step 4: Run PASS**

```bash
node --test tests/sleep-record.test.js tests/daily-summary-v2-utils.test.js
```

Fix any existing tests that deep-equal empty summary shapes if they break.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/dailySummaryV2Utils.js tests/sleep-record.test.js tests/daily-summary-v2-utils.test.js
git commit -m "feat(sleep): add sleep segment to daily_summary_v2 utils"
```

---

### Task 4: Cloud rebuild + accountCleanup

**Files:**
- Modify: `cloudfunctions/rebuildDailySummaryV2/index.js`
- Modify: `cloudfunctions/accountCleanup/index.js`
- Modify: `tests/rebuild-daily-summary-v2.test.js`
- Modify: `tests/account-cleanup.test.js`

- [ ] **Step 1: Extend rebuild tests** to expect `sleep_records` load and `summary.sleep` fields（仿 water mock）。

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement cloud parity**

In `rebuildDailySummaryV2/index.js` mirror water:

- `SLEEP_RECORDS_COLLECTION = 'sleep_records'`
- empty summary sleep fields
- `buildSleepSummary`（与客户端相同语义）
- `loadSleepRecords(babyUid, dateKey)`：`startDateTime` 日区间优先，fallback `date`
- include in `loadEventRecords` / `buildDailySummaryForDate`

In `accountCleanup/index.js` add `'sleep_records'` to `BABY_SCOPED_COLLECTIONS`（紧挨 `water_records`）。

Update `tests/account-cleanup.test.js` expected list.

- [ ] **Step 4: Run PASS**

```bash
node --test tests/rebuild-daily-summary-v2.test.js tests/account-cleanup.test.js
```

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/rebuildDailySummaryV2/index.js cloudfunctions/accountCleanup/index.js tests/rebuild-daily-summary-v2.test.js tests/account-cleanup.test.js
git commit -m "feat(sleep): rebuild summary and cleanup for sleep_records"
```

---

### Task 5: dailyRecordV2Service

**Files:**
- Modify: `miniprogram/utils/dailyRecordV2Service.js`
- Modify: `tests/daily-record-v2-service.test.js`

- [ ] **Step 1: Update service tests** to mock `sleep_records` / expect `sleepRecords` on daily result and tab details `case 'sleep'`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Wire service**

- `require('../models/sleepRecord')`
- `loadEventRecords`: `SleepRecordModel.findByDate` → `sleepRecords`
- overview / buildServiceResult 挂载 `sleepRecords` 与 `summary.sleep`
- `getDailyRecordTabDetails`:
```js
case 'sleep':
  return {
    tab: 'sleep',
    sleepRecords: unwrapResult(await SleepRecordModel.findByDate(date, babyUid))
  };
```

- [ ] **Step 4: Run PASS**

```bash
node --test tests/daily-record-v2-service.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/dailyRecordV2Service.js tests/daily-record-v2-service.test.js
git commit -m "feat(sleep): load sleep records in dailyRecordV2Service"
```

---

### Task 6: sleep-record 页面

**Files:**
- Create: `miniprogram/pkg-records/sleep-record/index.js`
- Create: `miniprogram/pkg-records/sleep-record/index.wxml`
- Create: `miniprogram/pkg-records/sleep-record/index.wxss`
- Create: `miniprogram/pkg-records/sleep-record/index.json`
- Modify: `miniprogram/app.json` — add `"sleep-record/index"` under `pkg-records`
- Test: `tests/sleep-record-page.test.js`

**UI 约定：** 复用 `compact-picker` / `compact-input`；原生 button 必须 `width:100%; margin:0; padding:0; box-sizing:border-box;` 并清 `::after`。见 `docs/miniprogram/ui-conventions.md`。表单结构可参考 `bowel-record`（全页表单），**不要**抄 water canvas。

- [ ] **Step 1: Write page contract test**

```js
test('sleep-record page has start/end pickers and save flow', () => {
  const dir = path.join(__dirname, '..', 'miniprogram', 'pkg-records', 'sleep-record');
  const js = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8');
  assert.match(js, /SleepRecordModel/);
  assert.match(js, /startTime/);
  assert.match(js, /endTime/);
  assert.match(js, /findOngoing/);
  assert.match(wxml, /开始/);
  assert.match(wxml, /结束/);
  assert.match(wxml, /备注/);
});
```

- [ ] **Step 2: Implement page**

`index.json`:
```json
{
  "navigationBarTitleText": "睡眠记录",
  "usingComponents": {}
}
```

`index.js` 行为：
- `onLoad`: `date` → `dateKey`；`id` → 编辑加载
- form: `startTime`（默认 now）、`endTime`（默认 `''`）、`notes`
- 保存：校验 start；调 create/update；失败 Toast；成功 `refreshPreviousPage`（抄 water：上一页 `forceRefreshData`）后 `navigateBack`
- **开新拦截**（仅新建且无 `id`）：`findOngoing` 若有记录，`wx.showModal` / `showActionSheet`：
  1. 补结束并继续新建：对 ongoing `completeSleep`（当前时间），成功后继续保存新表单；若 `INVALID_END` 则跳编辑该 ongoing
  2. 先去结束上一段：`navigateTo` 编辑页 `?id=ongoingId`
  3. 取消
- 清除结束：允许把 `endTime` 置空保存为进行中（编辑时）
- 删除：编辑态提供删除，确认后 `SleepRecordModel.delete`

`index.wxml`：开始 picker、结束 picker（可显示「未结束」占位 + 清除按钮）、备注、保存/取消

- [ ] **Step 3: Register in app.json**

- [ ] **Step 4: Run PASS**

```bash
node --test tests/sleep-record-page.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pkg-records/sleep-record miniprogram/app.json tests/sleep-record-page.test.js
git commit -m "feat(sleep): add sleep-record editor page"
```

---

### Task 7: recordTabsPreference

**Files:**
- Modify: `miniprogram/utils/recordTabsPreference.js`
- Modify: `tests/record-tabs-preference.test.js`

- [ ] **Step 1: Update tests** — `ALL_RECORD_TABS.length` 6→7；所有写死 6 个 key 的数组末尾加 `'sleep'`。

- [ ] **Step 2: Run FAIL**

- [ ] **Step 3: Append tab**

```js
{ key: 'sleep', label: '睡眠' }
```

同步 `DEFAULT_ORDERED_KEYS`（若从 ALL 派生则自动）。

- [ ] **Step 4: Run PASS**

```bash
node --test tests/record-tabs-preference.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/recordTabsPreference.js tests/record-tabs-preference.test.js
git commit -m "feat(sleep): add sleep tab to record tabs preference"
```

---

### Task 8: data-records-v2 接入

**Files:**
- Modify: `miniprogram/pages/data-records-v2/index.js`
- Modify: `miniprogram/pages/data-records-v2/index.wxml`
- Modify: `miniprogram/pages/data-records-v2/index.wxss`

Mirror water handlers：

- `createEmptyIntakeOverview` → `sleep: { durationMinutes: 0, count: 0, ongoingCount: 0 }`
- `formatSleepRecordsForDisplay`：起止、`durationLabel` / 「睡觉中」、notes
- `navigateToSleepRecord` / `openEditSleepRecord` / `deleteSleepRecord`
- `buildIntakeOverviewFromDailySummary` 读 `summary.sleep`
- `hasRecord` keys 含 `'sleep'`
- `applyDailyRecordTabDetails` `tab === 'sleep'`
- wxml：`activeTab === 'sleep'` 列表块（统计行：次数 / 总时长 / 进行中）
- wxss：柠檬色列表样式，对齐 water/bowel 间距

手动在开发者工具点通：数据记录 → 睡眠 Tab → 新增/编辑/删除。

- [ ] **Step 1: Implement JS/WXML/WXSS wiring**（可对照 `navigateToWaterRecord` 全文搜索 `water` 在该页的命中逐条加 sleep）

- [ ] **Step 2: Smoke — 若有源码契约测可补一条 data-records 含 `navigateToSleepRecord`；否则跳过自动化**

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/data-records-v2
git commit -m "feat(sleep): integrate sleep tab in data-records-v2"
```

---

### Task 9: 首页时间轴 + 快捷入口 + 进行中兜底

**Files:**
- Modify: `miniprogram/utils/homeDashboard.js`
- Modify: `miniprogram/pages/daily-feeding/index.js`
- Modify: `miniprogram/pages/daily-feeding/index.wxml`
- Modify: `miniprogram/pages/daily-feeding/index.wxss`
- Modify: `tests/home-dashboard.test.js`

- [ ] **Step 1: Timeline test**

按 `tests/home-dashboard.test.js` 现有写法：`buildTimeline(...)` **直接返回事件数组**（不是 `{ events }`）。补一条含 `sleepRecords` 的用例，断言存在 `type === 'sleep'` 且标题含「睡眠」/「睡觉中」。

- [ ] **Step 2: Implement homeDashboard**

```js
(sleepRecords || []).forEach((record = {}) => {
  const ongoing = isOngoingSleep(record);
  const durationLabel = formatDurationLabel(record.durationMinutes);
  pushEvent(events, {
    type: 'sleep',
    time: resolveTimeLabel(record.startTime, record.startDateTime),
    title: ongoing ? '睡眠 · 睡觉中' : (durationLabel ? `睡眠 · ${durationLabel}` : '睡眠'),
    desc: String(record.notes || '').trim()
  });
});
```

- [ ] **Step 3: daily-feeding**

1. `TIMELINE_TABS` 加 `{ key: 'sleep', label: '睡眠' }`
2. 传 `sleepRecords` 给 `buildTimeline`；筛选字段用现有 `timelineCategory`（加 `TIMELINE_TABS` + `type:'sleep'` 后走现有 `filterTimeline`）
3. wxml 快捷入口「记睡眠」→ `navigateToSleepRecord`
4. **进行中 banner**：`onShow`/刷新数据后 `SleepRecordModel.findOngoing` → `ongoingSleep`  
   - 展示「宝宝还在睡 · 点此醒来」  
   - `wakeOngoingSleep`：`completeSleep(id)`；若 `INVALID_END` → 跳编辑页；成功则刷新
5. `navigateToSleepRecord`：若有 ongoing，先弹与记录页相同的三选项；否则 `navigateTo` 新建页
6. wxss：`.tl-node.sleep`、`.qa-ic.sleep`、banner 样式（柠檬主色，克制）

- [ ] **Step 4: Run PASS**

```bash
node --test tests/home-dashboard.test.js
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/homeDashboard.js miniprogram/pages/daily-feeding tests/home-dashboard.test.js
git commit -m "feat(sleep): home timeline shortcut and ongoing wake banner"
```

---

### Task 10: 全量回归 + 收尾

- [ ] **Step 1: Run related tests**

```bash
node --test \
  tests/sleep-record-utils.test.js \
  tests/sleep-record.test.js \
  tests/sleep-record-page.test.js \
  tests/record-tabs-preference.test.js \
  tests/daily-summary-v2-utils.test.js \
  tests/rebuild-daily-summary-v2.test.js \
  tests/daily-record-v2-service.test.js \
  tests/home-dashboard.test.js \
  tests/account-cleanup.test.js
```

Expected: all PASS

- [ ] **Step 2: Manual checklist（开发者工具）**

- [ ] 云库已建 `sleep_records`
- [ ] 新建进行中睡眠 → 首页 banner 出现
- [ ] 一键醒来成功；跨午夜 22:00→06:00 时长 8h、归属开始日
- [ ] 有进行中时点「记睡眠」弹出拦截
- [ ] 数据记录睡眠 Tab 列表/编辑/删除
- [ ] 时间轴可筛睡眠

- [ ] **Step 3: Final commit if any fixups**

```bash
git add -A
git status
# commit only if there are leftover fixes
```

---

## Execution notes

- 分支：`feature/sleep-records`（已存在，勿回到 main 直接改）
- 每任务一次 commit；失败的测试先红后绿
- UI 对齐柠檬主题；button 对齐 `docs/miniprogram/ui-conventions.md`
- 删除策略：硬删（与 water 一致），覆盖设计稿「软删或等价」
