# 成长日记阶段 A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立「成长日记」时光轴（新集合 `growth_diary`、最多 3 张压图+缩略图、单条分享），并将原「成长记录」瘦身为「成长曲线」。

**Architecture:** 纯逻辑放 `growthDiaryUtils`（校验、权限、迁移映射）便于 Node 单测；`GrowthDiaryModel` 负责云库 CRUD（软删 `status: active`）；`diaryImage` 负责选图压图上传；列表页 + 详情页（分享落地带 `id`）；本地 Node 脚本做 JSON 迁移，不部署云函数。

**Tech Stack:** 微信小程序原生、云开发数据库/云存储、`wx.compressImage`、现有 `cloudTempUrlCache`、Node `node:test`

**Spec:** `docs/superpowers/specs/2026-07-14-growth-diary-phase-a-design.md`

**Branch:** `feature/growth-diary-phase-a`（勿在 `main` 直接提交）

**锁定决策（来自 spec 评审）：**
- 删除用软删：`status: 'deleted'`，列表/详情只查 `status: 'active'`
- 分享落地：独立详情页 `pkg-records/growth-diary/detail?id=<diaryId>`
- 迁移：控制台导出 → 本地脚本转换 → 导入；发版后若旧端仍写过 `growth_milestones`，再补迁一次

---

## File map

| File | Responsibility |
|------|----------------|
| `miniprogram/utils/growthDiaryUtils.js` | 校验 payload、photos≤3、`canEditDiaryEntry`、展示格式化、迁移字段映射 |
| `miniprogram/utils/diaryImage.js` | 构建云路径、压缩原图/缩略图、上传并返回 `{ originalFileId, thumbFileId }` |
| `miniprogram/models/growthDiary.js` | `growth_diary` 集合 list/get/create/update/softDelete |
| `miniprogram/pkg-records/growth-diary/index.*` | 时间线列表 + 新增/编辑表单 |
| `miniprogram/pkg-records/growth-diary/detail.*` | 详情预览 + `onShareAppMessage` |
| `miniprogram/pkg-records/growth-records/*` | 去掉里程碑 UI/逻辑；标题改为成长曲线 |
| `miniprogram/pages/daily-feeding/*` | 快捷记录增加「成长日记」一项（首页日记入口仅此一处） |
| `miniprogram/pages/profile/index.js` | 菜单：成长日记 + 成长曲线 |
| `miniprogram/app.json` | 注册子包页面 |
| `cloudfunctions/accountCleanup/index.js` | `BABY_SCOPED_COLLECTIONS` 增加 `growth_diary` |
| `scripts/migrate-growth-milestones-to-diary.js` | 本地 JSON 转换 |
| `scripts/README-migrate-growth-diary.md` | 导出/导入步骤 |
| `tests/growth-diary-utils.test.js` | utils + 迁移映射 |
| `tests/growth-diary-model.test.js` | model 行为（mock db）或源码契约 |
| `tests/account-cleanup.test.js` | 断言含 `growth_diary` |
| `tests/growth-diary-ui.test.js` | 入口文案、曲线页无里程碑、分包路径 |

---

### Task 1: `growthDiaryUtils`（校验 / 权限 / 迁移映射）

**Files:**
- Create: `miniprogram/utils/growthDiaryUtils.js`
- Create: `tests/growth-diary-utils.test.js`

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_DIARY_PHOTOS,
  validateDiaryPayload,
  canEditDiaryEntry,
  mapMilestoneToDiary
} = require('../miniprogram/utils/growthDiaryUtils');

test('MAX_DIARY_PHOTOS is 3', () => {
  assert.equal(MAX_DIARY_PHOTOS, 3);
});

test('validateDiaryPayload rejects empty title', () => {
  const r = validateDiaryPayload({ title: '  ', eventDate: '2026-01-01', photos: [] });
  assert.equal(r.isValid, false);
});

test('validateDiaryPayload rejects more than 3 photos', () => {
  const photos = [1, 2, 3, 4].map((i) => ({
    originalFileId: `cloud://o${i}`,
    thumbFileId: `cloud://t${i}`
  }));
  const r = validateDiaryPayload({ title: '会坐', eventDate: '2026-01-01', photos });
  assert.equal(r.isValid, false);
});

test('canEditDiaryEntry allows author', () => {
  assert.equal(canEditDiaryEntry({ createdByOpenid: 'a' }, { openid: 'a', isCreator: false }), true);
});

test('canEditDiaryEntry denies non-author', () => {
  assert.equal(canEditDiaryEntry({ createdByOpenid: 'a' }, { openid: 'b', isCreator: true }), false);
});

test('canEditDiaryEntry allows creator for legacy without author', () => {
  assert.equal(
    canEditDiaryEntry({ legacy: true, createdByOpenid: '' }, { openid: 'c', isCreator: true }),
    true
  );
  assert.equal(
    canEditDiaryEntry({ legacy: true, createdByOpenid: '' }, { openid: 'c', isCreator: false }),
    false
  );
});

test('mapMilestoneToDiary fills photos empty and migratedFromId', () => {
  const out = mapMilestoneToDiary({
    _id: 'old1',
    babyUid: 'b1',
    title: '满月',
    notes: 'n',
    eventDate: '2026-01-01T00:00:00.000Z',
    userInfo: { openid: 'o1', nickName: '爸' },
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(out.migratedFromId, 'old1');
  assert.deepEqual(out.photos, []);
  assert.equal(out.createdByOpenid, 'o1');
  assert.equal(out.legacy, false);
  assert.equal(out.status, 'active');
  assert.equal(out.title, '满月');
});

test('mapMilestoneToDiary marks legacy when no openid', () => {
  const out = mapMilestoneToDiary({
    _id: 'old2',
    babyUid: 'b1',
    title: 'x',
    eventDate: '2026-01-01',
    userInfo: {}
  });
  assert.equal(out.legacy, true);
  assert.equal(out.createdByOpenid, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/growth-diary-utils.test.js`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `growthDiaryUtils.js`**

```js
const MAX_DIARY_PHOTOS = 3;

function normalizePhotos(photos = []) {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p) => ({
      originalFileId: String(p?.originalFileId || '').trim(),
      thumbFileId: String(p?.thumbFileId || '').trim(),
      width: p?.width == null ? null : Number(p.width),
      height: p?.height == null ? null : Number(p.height)
    }))
    .filter((p) => p.originalFileId && p.thumbFileId);
}

function validateDiaryPayload(payload = {}) {
  const errors = [];
  const title = String(payload.title || '').trim();
  if (!title) errors.push('请输入里程碑标题');
  const eventDate = payload.eventDate;
  if (!eventDate) errors.push('请选择发生日期');
  const photos = normalizePhotos(payload.photos);
  if ((payload.photos || []).length > MAX_DIARY_PHOTOS || photos.length > MAX_DIARY_PHOTOS) {
    errors.push(`最多上传 ${MAX_DIARY_PHOTOS} 张图片`);
  }
  return {
    isValid: errors.length === 0,
    errors,
    normalized: {
      title,
      notes: String(payload.notes || '').trim(),
      eventDate,
      photos
    }
  };
}

function canEditDiaryEntry(entry = {}, actor = {}) {
  const openid = String(actor.openid || '').trim();
  if (!openid) return false;
  const author = String(entry.createdByOpenid || '').trim();
  if (author && author === openid) return true;
  if (entry.legacy && !author && actor.isCreator) return true;
  return false;
}

function mapMilestoneToDiary(milestone = {}) {
  const openid = String(milestone.userInfo?.openid || milestone._openid || '').trim();
  return {
    babyUid: milestone.babyUid,
    eventDate: milestone.eventDate,
    title: String(milestone.title || '').trim(),
    notes: String(milestone.notes || '').trim(),
    photos: [],
    createdByOpenid: openid,
    userInfo: milestone.userInfo || {},
    migratedFromId: milestone._id || '',
    legacy: !openid,
    status: 'active',
    createdAt: milestone.createdAt || null,
    updatedAt: milestone.updatedAt || null
  };
}

function formatDiaryForDisplay(entry = {}) {
  return {
    ...entry,
    canEdit: false, // page 填充
    eventDateText: '', // page 用现有 formatDate
    thumbUrls: [],
    originalUrls: []
  };
}

module.exports = {
  MAX_DIARY_PHOTOS,
  normalizePhotos,
  validateDiaryPayload,
  canEditDiaryEntry,
  mapMilestoneToDiary,
  formatDiaryForDisplay
};
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test tests/growth-diary-utils.test.js`

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/growthDiaryUtils.js tests/growth-diary-utils.test.js
git commit -m "feat: 成长日记校验与里程碑迁移映射工具"
```

---

### Task 2: 本地迁移脚本

**Files:**
- Create: `scripts/migrate-growth-milestones-to-diary.js`
- Create: `scripts/README-migrate-growth-diary.md`
- Modify: `tests/growth-diary-utils.test.js`（可加「脚本 require mapMilestoneToDiary」契约，或独立测脚本 CLI）

- [ ] **Step 1: Implement CLI**

脚本读取 `process.argv[2]` 输入 JSON 路径，写出 `process.argv[3]` 或默认 `growth_diary.import.json`：

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { mapMilestoneToDiary } = require('../miniprogram/utils/growthDiaryUtils');

const input = process.argv[2];
const output = process.argv[3] || path.join(process.cwd(), 'growth_diary.import.json');
if (!input) {
  console.error('Usage: node scripts/migrate-growth-milestones-to-diary.js <milestones.json> [out.json]');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const list = Array.isArray(raw) ? raw : (raw.data || raw.list || []);
const mapped = list.map(mapMilestoneToDiary);
fs.writeFileSync(output, JSON.stringify(mapped, null, 2));
console.log(`Wrote ${mapped.length} records to ${output}`);
```

README 写清：控制台导出 → 本脚本 → 控制台导入新集合 → 发版后停写旧集合 → 可选补迁。

- [ ] **Step 2: Smoke with fixture**

Create temp fixture in test or run:

```bash
node -e 'require("fs").writeFileSync("/tmp/ms.json", JSON.stringify([{_id:"1",babyUid:"b",title:"t",eventDate:"2026-01-01",userInfo:{openid:"o"}}]))'
node scripts/migrate-growth-milestones-to-diary.js /tmp/ms.json /tmp/diary.json
node -e 'const d=require("/tmp/diary.json"); if(d[0].migratedFromId!=="1") process.exit(1)'
```

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-growth-milestones-to-diary.js scripts/README-migrate-growth-diary.md
git commit -m "chore: 本地 JSON 迁移成长里程碑到成长日记"
```

---

### Task 3: `diaryImage` 压图与上传工具

**Files:**
- Create: `miniprogram/utils/diaryImage.js`
- Create: `tests/diary-image.test.js`（纯函数：路径构建、质量阶梯；wx API 用注入 mock）

- [ ] **Step 1: Failing tests for path builder**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiaryCloudPaths } = require('../miniprogram/utils/diaryImage');

test('buildDiaryCloudPaths returns orig and thumb paths', () => {
  const p = buildDiaryCloudPaths({ babyUid: 'b1', entryKey: 'tmp', index: 0, ts: 1000 });
  assert.match(p.originalCloudPath, /growth-diary\/b1\/tmp\/1000_0_orig\.jpg/);
  assert.match(p.thumbCloudPath, /growth-diary\/b1\/tmp\/1000_0_thumb\.jpg/);
});
```

- [ ] **Step 2: Implement**

核心 API（页面调用）：

```js
async function prepareAndUploadDiaryPhoto(localPath, { babyUid, entryKey, index, uploadFile, compressImage }) {
  // 1) compressImage quality 阶梯至约 <= 500KB（可复用 add-report 思路，简化为 quality 70 再失败降级）
  // 2) upload original
  // 3) compressImage quality ~40 作为 thumb（若平台无 compressedWidth，二次 compress 即可）
  // 4) upload thumb
  // 5) return { originalFileId, thumbFileId }
}
```

`uploadFile` / `compressImage` 默认绑 `wx.cloud.uploadFile` / `wx.compressImage`，测试时注入 mock。

另提供 `deleteCloudFiles(fileIds, { deleteFile })`：失败只 `console.warn`，不抛错。编辑换图成功后、软删成功后调用，清理旧 `originalFileId`/`thumbFileId`。

- [ ] **Step 3: Test with mocks — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 成长日记配图压缩与上传工具"
```

---

### Task 4: `GrowthDiaryModel`

**Files:**
- Create: `miniprogram/models/growthDiary.js`
- Create: `tests/growth-diary-model.test.js`

模式对齐 `dayCalendarMark.js`：客户端直写 DB + utils 校验。

- [ ] **Step 1: Tests（源码契约 + 可选 mock）**

至少断言：
- 集合名 `growth_diary`
- `listByBaby` where 含 `status: 'active'`
- `create` 写入 `createdByOpenid`、`photos`、`status: 'active'`
- `update` / `softDelete` 前需能配合 `canEditDiaryEntry`（model 方法接收 `actor`，无权限返回 `{ success: false }`）

- [ ] **Step 2: Implement model**

方法：
- `listByBaby(babyUid)` — `eventDate` desc，`status: 'active'`
- `getById(id)` — 返回记录；调用方若 `status !== 'active'` 按无权限/已删除处理（详情不展示正文）
- `create(babyUid, payload, actor)` — actor 含 openid / userInfo
- `update(id, babyUid, payload, actor)` — 先 get 再 `canEditDiaryEntry`；换图成功后 `deleteCloudFiles` 清理被替换的旧 fileID
- `softDelete(id, babyUid, actor)` — `status: 'deleted'`；成功后尽量 `deleteCloudFiles` 清理 photos（失败只打日志）

阶段 A 与现网里程碑一致：客户端直写 DB + 前端/`canEditDiaryEntry` 校验；后续再视需要加固云函数或安全规则。

- [ ] **Step 3: Tests PASS → Commit**

```bash
git commit -m "feat: GrowthDiaryModel 云库读写与软删"
```

---

### Task 5: 成长日记列表页

**Files:**
- Create: `miniprogram/pkg-records/growth-diary/index.js`
- Create: `miniprogram/pkg-records/growth-diary/index.wxml`
- Create: `miniprogram/pkg-records/growth-diary/index.wxss`
- Create: `miniprogram/pkg-records/growth-diary/index.json`
- Modify: `miniprogram/app.json`（`pkg-records` pages 增加 `growth-diary/index`）

- [ ] **Step 1: Register page in `app.json`**

```json
"growth-diary/index",
"growth-diary/detail"
```

（detail 可在 Task 6 一并注册）

- [ ] **Step 2: Implement list UI**

- `navigationBarTitleText`: `成长日记`
- onShow：`GrowthDiaryModel.listByBaby` → `canEditDiaryEntry` → `resolveCloudTempUrls` 批量解析 **thumb** fileIds
- 时间线：日期、标题、备注、最多 3 缩略图；作者可编辑/删除；「分享」跳转详情或 `button open-type="share"`（详情页分享更稳，列表可 `navigateTo detail`）
- 新增表单：标题、日期、备注、选图（≤3），保存走 `diaryImage` 全成功再 `create`
- 柠檬色活泼风格，贴近现有成长页

- [ ] **Step 3: Manual smoke in devtools**（无宝宝数据时可先空列表）

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 成长日记时间线列表与新增编辑"
```

---

### Task 6: 详情页 + 分享

**Files:**
- Create: `miniprogram/pkg-records/growth-diary/detail.js|wxml|wxss|json`

- [ ] **Step 1: Implement detail**

- onLoad `id` → `getById`；校验 `babyUid` 与当前宝宝一致，否则提示无权限
- 展示原图（点缩略进 `wx.previewImage`）
- `onShareAppMessage`：

```js
return {
  title: `${babyName} · ${entry.title}`,
  path: `/pkg-records/growth-diary/detail?id=${entry._id}`
};
```

- 非成员/宝宝不匹配：不渲染正文，提示需加入家庭（复用现有文案习惯）

- [ ] **Step 2: List「分享」→ 进详情，详情启用分享菜单**

```js
wx.showShareMenu({ menus: ['shareAppMessage'] });
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 成长日记详情页与微信分享落地"
```

---

### Task 7: 成长曲线瘦身（去里程碑）

**Files:**
- Modify: `miniprogram/pkg-records/growth-records/index.js` — 删除 loadMilestones / saveMilestone / 相关 data 与表单方法
- Modify: `miniprogram/pkg-records/growth-records/index.wxml` — 删除里程碑区块与「新增里程碑」按钮
- Modify: `miniprogram/pkg-records/growth-records/index.wxss` — 可删无用样式
- Modify: `miniprogram/pkg-records/growth-records/index.json` — `navigationBarTitleText`: `成长曲线`

- [ ] **Step 1: Remove milestone UI/logic**（保留测量与图表）

- [ ] **Step 2: UI 契约测试**

```js
// tests/growth-diary-ui.test.js
const fs = require('fs');
const path = require('path');
const growthWxml = fs.readFileSync(path.join('miniprogram/pkg-records/growth-records/index.wxml'), 'utf8');
assert.doesNotMatch(growthWxml, /里程碑/);
const growthJson = fs.readFileSync(path.join('miniprogram/pkg-records/growth-records/index.json'), 'utf8');
assert.match(growthJson, /成长曲线/);
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: 成长记录页瘦身为成长曲线"
```

---

### Task 8: 入口（今日快捷 + 我的）

**Files:**
- Modify: `miniprogram/pages/daily-feeding/index.wxml` — 快捷记录增加一项「成长日记」→ `/pkg-records/growth-diary/index`（**不要**再加情感大卡片）
- Modify: `miniprogram/pages/profile/index.js` — `MENU_SECTIONS`：原「成长记录」改为「成长曲线」；新增「成长日记」项

建议「我的」两项：

```js
{ name: '成长日记', path: '/pkg-records/growth-diary/index', description: '里程碑时光轴与配图' },
{ name: '成长曲线', path: '/pkg-records/growth-records/index', description: '身高体重曲线与测量' }
```

- [ ] **Step 1: Wire entries**

- [ ] **Step 2: Extend `tests/growth-diary-ui.test.js`**

断言 profile 含两路径；daily-feeding wxml 含 `growth-diary` 恰好一处入口（或至少包含快捷 path，且无第二张日记卡片文案）。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 接入成长日记首页快捷与我的入口"
```

---

### Task 9: accountCleanup 纳入 `growth_diary`

**Files:**
- Modify: `cloudfunctions/accountCleanup/index.js`
- Modify: `tests/account-cleanup.test.js`

- [ ] **Step 1: Add `'growth_diary'` to `BABY_SCOPED_COLLECTIONS`**（建议紧挨 `growth_milestones`；旧集合可保留清理以免残留）

- [ ] **Step 2: Update test that lists collection names**

- [ ] **Step 3: Run**

`node --test tests/account-cleanup.test.js tests/growth-diary-utils.test.js tests/growth-diary-ui.test.js`

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: 账号清理覆盖 growth_diary 集合"
```

---

### Task 10: 人工验收与迁移 checklist

- [ ] **Step 1: DevTools 验收**

1. 空列表 → 新增无图里程碑 → 列表可见  
2. 编辑加 3 张图 → 列表出缩略图 → 预览原图  
3. 第 4 张被拦截  
4. 软删后：列表不可见；详情/分享落地不展示正文  
5. 另一参与者账号：能新增，不能改他人  
6. 分享卡片打开详情（同家庭）；非成员无正文  
7. 成长曲线页无里程碑；入口文案正确  

- [ ] **Step 2: 数据迁移（发布前）**

按 `scripts/README-migrate-growth-diary.md` 导出/转换/导入；抽查 `migratedFromId` 与条数。

- [ ] **Step 3: 发版后**

确认客户端无 `growth_milestones` 写入；若有窗口期新数据，再跑一次补迁。

- [ ] **Step 4: Final commit if any polish**

```bash
git commit -m "chore: 成长日记阶段 A 验收微调"
```

---

## 测试命令汇总

```bash
node --test tests/growth-diary-utils.test.js
node --test tests/diary-image.test.js
node --test tests/growth-diary-model.test.js
node --test tests/growth-diary-ui.test.js
node --test tests/account-cleanup.test.js
```

## 风险与注意

- 云库需在控制台**新建集合** `growth_diary`（权限与现网 `growth_milestones` 对齐即可；勿在计划外改全局安全规则）。
- 阶段 A 客户端直写 + 前端权限校验（与旧里程碑一致）；非服务端强鉴权，后续可加固。
- 图片费用：列表禁止批量拉 original；换图/软删尽量删旧云文件。
- 个人主体：不做评论点赞；分享仅微信会话。
