# 食谱墙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在柠檬宝宝小程序中新增「食谱墙」：用户可发布宝宝辅食/低蛋白相关图文食谱，安全检测通过后上墙，其他用户可浏览与点赞，管理员可下架；列表展示「来自{宝宝昵称}{展示名}」。

**Architecture:** 云函数 `recipeWallManager` 统一处理 publish/list/detail/toggleLike/deleteOwn/takeDown；纯函数抽到可单测模块；前端独立分包 `pkg-recipe-wall`；入口挂在「我的 → 帮助与社区」。

**Tech Stack:** 微信小程序、云开发（云函数 + 云数据库 + 云存储）、`msgSecCheck` / `imgSecCheck`、`node:test`

**Spec:** `docs/superpowers/specs/2026-08-01-recipe-wall-design.md`

## Global Constraints

- 内容范围：仅宝宝辅食 / 低蛋白 / 特医友好；发布页强制选固定标签之一
- 互动 MVP：看 + 赞；不做评论、收藏、举报、编辑
- 发布：内容安全 API 全过才 `published`；失败/超时不放行
- 作者文案：`来自{babyName}{authorDisplayName}`（如「来自柠檬妈妈」）；缺宝宝名或展示名禁止发帖
- 不占用 TabBar；与个人「食谱管理」命名/入口分离
- 管理员身份复用 `miniprogram/config/developer.js` 的 `isDeveloperOpenid`（云函数侧维护同名单）
- 分支：从 `docs/recipe-wall-design` 切出 `feature/recipe-wall` 再改代码（勿在 `main` 直接改）

---

## File Structure

### Create

| File | Responsibility |
|------|----------------|
| `miniprogram/utils/recipeWallUtils.js` | 归属文案、标签白名单、payload 规范化/校验、列表卡片映射 |
| `cloudfunctions/recipeWallManager/index.js` | 云函数入口与各 action |
| `cloudfunctions/recipeWallManager/package.json` | 依赖 `wx-server-sdk` |
| `cloudfunctions/recipeWallManager/config.json` | 开通 `security.msgSecCheck` / `security.imgSecCheck` 等权限 |
| `miniprogram/pkg-recipe-wall/list/index.{js,wxml,wxss,json}` | 食谱墙列表 |
| `miniprogram/pkg-recipe-wall/detail/index.{js,wxml,wxss,json}` | 详情 |
| `miniprogram/pkg-recipe-wall/publish/index.{js,wxml,wxss,json}` | 发布 |
| `miniprogram/pkg-recipe-wall/mine/index.{js,wxml,wxss,json}` | 我的发布 |
| `miniprogram/pkg-recipe-wall/admin/index.{js,wxml,wxss,json}` | 开发者下架管理 |
| `tests/recipe-wall-utils.test.js` | 纯函数单测 |
| `tests/recipe-wall-manager.test.js` | 云函数 action 单测（mock db / openapi） |
| `tests/recipe-wall-pages.test.js` | 页面接线源码契约 |

### Modify

| File | Change |
|------|--------|
| `miniprogram/app.json` | 注册分包 `pkg-recipe-wall` 页面 |
| `miniprogram/pages/profile/index.js` | 「帮助与社区」增加食谱墙；开发者组增加下架管理 |

### Out of scope

- 评论 / 收藏 / 举报 / 搜索推荐 / 帖子编辑
- 占用 TabBar
- 改个人 `recipe-management` 业务逻辑

---

### Task 0: 建实现分支

**Files:** none（git only）

- [ ] **Step 1: 从设计分支切出实现分支**

```bash
git checkout docs/recipe-wall-design
git checkout -b feature/recipe-wall
```

Expected: 当前分支为 `feature/recipe-wall`，含已提交的 design spec。

- [ ] **Step 2: Commit（无代码则可跳过）**

无需 commit。

---

### Task 1: `recipeWallUtils` 纯函数

**Files:**
- Create: `miniprogram/utils/recipeWallUtils.js`
- Test: `tests/recipe-wall-utils.test.js`

**Interfaces:**
- Produces:
  - `RECIPE_WALL_TAG_OPTIONS = ['辅食', '低蛋白', '特医友好']`
  - `formatRecipeWallAuthorLabel({ babyName, authorDisplayName }) => string`
  - `normalizeIngredient(raw) => { name, amount } | null`
  - `normalizeStep(raw) => { text, imageFileId } | null`
  - `validatePublishPayload(input) => { ok: true, data } | { ok: false, message }`
  - `mapPostForCard(post, { likedPostIds?: Set|string[] }) => cardView`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECIPE_WALL_TAG_OPTIONS,
  formatRecipeWallAuthorLabel,
  validatePublishPayload,
  mapPostForCard
} = require('../miniprogram/utils/recipeWallUtils');

test('formatRecipeWallAuthorLabel joins baby name and display name', () => {
  assert.equal(
    formatRecipeWallAuthorLabel({ babyName: '柠檬', authorDisplayName: '妈妈' }),
    '来自柠檬妈妈'
  );
});

test('formatRecipeWallAuthorLabel returns empty when missing parts', () => {
  assert.equal(formatRecipeWallAuthorLabel({ babyName: '', authorDisplayName: '妈妈' }), '');
  assert.equal(formatRecipeWallAuthorLabel({ babyName: '柠檬', authorDisplayName: '' }), '');
});

test('validatePublishPayload requires cover title ingredients steps and whitelist tag', () => {
  const bad = validatePublishPayload({
    title: '南瓜泥',
    coverFileId: '',
    ingredients: [{ name: '南瓜', amount: '100g' }],
    steps: [{ text: '蒸熟捣碎' }],
    tags: ['辅食'],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(bad.ok, false);

  const good = validatePublishPayload({
    title: ' 南瓜泥 ',
    coverFileId: 'cloud://cover.png',
    ingredients: [{ name: '南瓜', amount: '100g' }],
    steps: [{ text: '蒸熟捣碎', imageFileId: 'cloud://s1.png' }],
    tags: ['辅食'],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(good.ok, true);
  assert.equal(good.data.title, '南瓜泥');
  assert.deepEqual(good.data.tags, ['辅食']);
  assert.ok(RECIPE_WALL_TAG_OPTIONS.includes('低蛋白'));
});

test('validatePublishPayload rejects unknown tag', () => {
  const res = validatePublishPayload({
    title: '菜',
    coverFileId: 'cloud://c.png',
    ingredients: [{ name: '菜', amount: '1' }],
    steps: [{ text: '煮' }],
    tags: ['火锅'],
    babyName: '柠檬',
    authorDisplayName: '爸爸',
    babyUid: 'b1'
  });
  assert.equal(res.ok, false);
});

test('mapPostForCard builds authorLabel and liked flag', () => {
  const card = mapPostForCard({
    _id: 'p1',
    title: '南瓜泥',
    coverFileId: 'cloud://c.png',
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    likeCount: 3,
    status: 'published'
  }, { likedPostIds: ['p1'] });
  assert.equal(card.authorLabel, '来自柠檬妈妈');
  assert.equal(card.liked, true);
  assert.equal(card.likeCount, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/recipe-wall-utils.test.js`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```js
// miniprogram/utils/recipeWallUtils.js
const RECIPE_WALL_TAG_OPTIONS = ['辅食', '低蛋白', '特医友好'];

function trimText(value = '', maxLen = 0) {
  const text = String(value || '').trim();
  if (!maxLen) return text;
  return text.slice(0, maxLen);
}

function formatRecipeWallAuthorLabel({ babyName = '', authorDisplayName = '' } = {}) {
  const baby = trimText(babyName, 20);
  const role = trimText(authorDisplayName, 12);
  if (!baby || !role) return '';
  return `来自${baby}${role}`;
}

function normalizeIngredient(raw = {}) {
  const name = trimText(raw.name, 40);
  const amount = trimText(raw.amount, 40);
  if (!name) return null;
  return { name, amount };
}

function normalizeStep(raw = {}) {
  const text = trimText(raw.text, 500);
  const imageFileId = trimText(raw.imageFileId, 300);
  if (!text) return null;
  return { text, imageFileId };
}

function validatePublishPayload(input = {}) {
  const title = trimText(input.title, 40);
  const coverFileId = trimText(input.coverFileId, 300);
  const babyName = trimText(input.babyName, 20);
  const authorDisplayName = trimText(input.authorDisplayName, 12);
  const babyUid = trimText(input.babyUid, 64);
  const authorAvatar = trimText(input.authorAvatar, 300);
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map(normalizeIngredient)
    .filter(Boolean);
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map(normalizeStep)
    .filter(Boolean);
  const tags = (Array.isArray(input.tags) ? input.tags : [])
    .map((t) => trimText(t, 20))
    .filter(Boolean);

  if (!babyUid) return { ok: false, message: '缺少宝宝信息' };
  if (!babyName || !authorDisplayName) {
    return { ok: false, message: '请先完善宝宝昵称与个人展示名称' };
  }
  if (!title) return { ok: false, message: '请填写标题' };
  if (!coverFileId) return { ok: false, message: '请上传封面图' };
  if (!ingredients.length) return { ok: false, message: '请至少添加一种材料' };
  if (!steps.length) return { ok: false, message: '请至少添加一步做法' };
  if (tags.length !== 1 || !RECIPE_WALL_TAG_OPTIONS.includes(tags[0])) {
    return { ok: false, message: '请选择辅食 / 低蛋白 / 特医友好标签' };
  }

  return {
    ok: true,
    data: {
      title,
      coverFileId,
      ingredients,
      steps,
      tags,
      babyName,
      authorDisplayName,
      babyUid,
      authorAvatar
    }
  };
}

function mapPostForCard(post = {}, options = {}) {
  const likedSet = options.likedPostIds instanceof Set
    ? options.likedPostIds
    : new Set(options.likedPostIds || []);
  const id = post._id || '';
  return {
    id,
    title: post.title || '',
    coverFileId: post.coverFileId || '',
    authorLabel: formatRecipeWallAuthorLabel(post),
    likeCount: Number(post.likeCount) || 0,
    liked: likedSet.has(id),
    status: post.status || '',
    tags: Array.isArray(post.tags) ? post.tags : [],
    createdAt: post.createdAt || null
  };
}

module.exports = {
  RECIPE_WALL_TAG_OPTIONS,
  formatRecipeWallAuthorLabel,
  normalizeIngredient,
  normalizeStep,
  validatePublishPayload,
  mapPostForCard
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/recipe-wall-utils.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/recipeWallUtils.js tests/recipe-wall-utils.test.js
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add publish payload and author label utils

EOF
)"
```

---

### Task 2: 云函数 `recipeWallManager` — publish + 内容安全

**Files:**
- Create: `cloudfunctions/recipeWallManager/index.js`
- Create: `cloudfunctions/recipeWallManager/package.json`
- Create: `cloudfunctions/recipeWallManager/config.json`
- Test: `tests/recipe-wall-manager.test.js`

**Interfaces:**
- Consumes: `validatePublishPayload`（可在云函数内复制同逻辑，或通过相对路径/拷贝保持一致；推荐云函数内 `require` 一份同步实现：把校验函数复制到 `cloudfunctions/recipeWallManager/recipeWallUtils.js`，与 miniprogram 保持字段一致，测试两边都覆盖核心规则）
- Produces: `exports.main({ action, ... })`  
  - `action: 'publish'` → `{ ok, postId?, message? }`

**注意：** 小程序端与云函数不能直接共享 `miniprogram/utils`。本任务在云函数目录放置同名校验副本：

- Create: `cloudfunctions/recipeWallManager/recipeWallUtils.js`（从 Task 1 文件复制，仅保留校验相关导出）

- [ ] **Step 1: Write failing cloud-function tests（mock db + security）**

在 `tests/recipe-wall-manager.test.js` 中按 `tests/member-management.test.js` 模式：

- mock `wx-server-sdk`：`getWXContext`、`database`、`openapi.security.msgSecCheck`、`openapi.security.imgSecCheck`、`downloadFile`、`deleteFile`
- 用例：
  1. 缺 openid → `{ ok: false }`
  2. payload 非法 → 不写库
  3. `msgSecCheck` 返回违规（errCode 87014）→ 不写库，并尝试 `deleteFile`
  4. 文本与图片均通过 → `recipe_wall_posts` 新增一条，`status: 'published'`，`likeCount: 0`，含 `babyName` / `authorDisplayName`

测试骨架关键断言示例：

```js
test('publish rejects when text security fails', async () => {
  const { main, writes, security } = loadRecipeWallManager({
    openid: 'user-1',
    msgSecCheck: async () => ({ errCode: 87014 })
  });
  const res = await main({
    action: 'publish',
    title: '违规',
    coverFileId: 'cloud://c.png',
    ingredients: [{ name: '南瓜', amount: '100g' }],
    steps: [{ text: '蒸' }],
    tags: ['辅食'],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(res.ok, false);
  assert.equal(writes.adds.length, 0);
  assert.ok(security.msgCalled);
});

test('publish writes published post when security passes', async () => {
  const { main, data } = loadRecipeWallManager({ openid: 'user-1' });
  const res = await main({
    action: 'publish',
    title: '南瓜泥',
    coverFileId: 'cloud://c.png',
    ingredients: [{ name: '南瓜', amount: '100g' }],
    steps: [{ text: '蒸熟捣碎' }],
    tags: ['辅食'],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(res.ok, true);
  assert.ok(res.postId);
  assert.equal(data.recipe_wall_posts[0].status, 'published');
  assert.equal(data.recipe_wall_posts[0].babyName, '柠檬');
  assert.equal(data.recipe_wall_posts[0].authorDisplayName, '妈妈');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/recipe-wall-manager.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement cloud function publish path**

`package.json`:

```json
{
  "name": "recipeWallManager",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  }
}
```

`config.json`（按项目其他开了 openapi 的云函数对齐，至少包含）：

```json
{
  "permissions": {
    "openapi": [
      "security.msgSecCheck",
      "security.imgSecCheck"
    ]
  }
}
```

`index.js` 要点：

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { validatePublishPayload } = require('./recipeWallUtils');

const DEVELOPER_OPENIDS = [
  'oYCao7fijm22dyl6C-tcYJo_G69A'
];

function isDeveloperOpenid(openid = '') {
  return DEVELOPER_OPENIDS.includes((openid || '').trim());
}

function isSecurityViolation(result = {}) {
  return result.errCode === 87014
    || result.errcode === 87014
    || result.code === 87014;
}

async function deleteFiles(fileList = []) {
  const list = [...new Set(fileList.filter(Boolean))];
  if (!list.length) return;
  try {
    await cloud.deleteFile({ fileList: list });
  } catch (e) {
    console.error('deleteFiles failed', e);
  }
}

async function checkText(content) {
  const res = await cloud.openapi.security.msgSecCheck({
    version: 2,
    scene: 3,
    openid: cloud.getWXContext().OPENID,
    content: String(content || '').slice(0, 2500)
  });
  if (isSecurityViolation(res)) {
    const err = new Error('TEXT_SECURITY_VIOLATION');
    err.code = 'TEXT_SECURITY_VIOLATION';
    throw err;
  }
  return res;
}

async function checkImage(fileID) {
  const fileRes = await cloud.downloadFile({ fileID });
  const lower = String(fileID || '').toLowerCase();
  const contentType = lower.endsWith('.png')
    ? 'image/png'
    : (lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
  const res = await cloud.openapi.security.imgSecCheck({
    media: { contentType, value: fileRes.fileContent }
  });
  if (isSecurityViolation(res)) {
    const err = new Error('IMAGE_SECURITY_VIOLATION');
    err.code = 'IMAGE_SECURITY_VIOLATION';
    throw err;
  }
  return res;
}

async function publish(event, openid) {
  const validated = validatePublishPayload(event);
  if (!validated.ok) return { ok: false, message: validated.message };

  const { data } = validated;
  const fileIds = [
    data.coverFileId,
    ...data.steps.map((s) => s.imageFileId).filter(Boolean)
  ];

  try {
    const textBlob = [
      data.title,
      ...data.ingredients.map((i) => `${i.name}${i.amount}`),
      ...data.steps.map((s) => s.text),
      ...data.tags
    ].join('\n');
    await checkText(textBlob);
    for (const fileID of fileIds) {
      await checkImage(fileID);
    }
  } catch (error) {
    await deleteFiles(fileIds);
    if (error.code === 'TEXT_SECURITY_VIOLATION' || error.code === 'IMAGE_SECURITY_VIOLATION') {
      return { ok: false, message: '含有违规内容，请修改后再发', code: error.code };
    }
    console.error('security check failed', error);
    return { ok: false, message: '内容安全检测失败，请稍后重试', code: 'SECURITY_CHECK_FAILED' };
  }

  const addRes = await db.collection('recipe_wall_posts').add({
    data: {
      ...data,
      status: 'published',
      likeCount: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
      // _openid 由云开发自动写入
    }
  });

  return { ok: true, postId: addRes._id };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, message: '缺少用户身份' };
  const action = event.action || '';
  try {
    if (action === 'publish') return await publish(event, OPENID);
    return { ok: false, message: '未知操作' };
  } catch (error) {
    console.error('recipeWallManager error', action, error);
    return { ok: false, message: '服务异常，请稍后重试' };
  }
};
```

说明：`msgSecCheck` version/scene 若与现网账号权限不符，实现时以微信文档与现有可运行环境为准；失败必须不写库。

- [ ] **Step 4: Run tests**

Run: `node --test tests/recipe-wall-manager.test.js`  
Expected: publish 相关用例 PASS

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/recipeWallManager tests/recipe-wall-manager.test.js
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add publish cloud function with content security

EOF
)"
```

---

### Task 3: 云函数 list / detail / toggleLike / deleteOwn / takeDown / listMine

**Files:**
- Modify: `cloudfunctions/recipeWallManager/index.js`
- Modify: `tests/recipe-wall-manager.test.js`

**Interfaces:**
- `list({ page=1, pageSize=10 })` → `{ ok, list, hasMore }`（仅 `published`；附带当前用户 `liked`）
- `detail({ postId })` → `{ ok, post, liked }`；非作者访问 `taken_down` → 不可用
- `toggleLike({ postId })` → `{ ok, liked, likeCount }`
- `deleteOwn({ postId })` → `{ ok }`（仅作者）
- `takeDown({ postId })` → `{ ok }`（仅 developer）
- `listMine({ page, pageSize })` → 当前用户全部状态帖子

- [ ] **Step 1: 扩展失败测试**

覆盖：

1. `list` 不返回 `taken_down`
2. `toggleLike` 首次点赞 `likeCount+1`，再次取消 `-1` 且不小于 0
3. `deleteOwn` 非作者失败
4. `takeDown` 非开发者失败；开发者成功后 `status=taken_down`
5. `detail` 他人看已下架 → `{ ok:false, code:'UNAVAILABLE' }`；作者可读

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tests/recipe-wall-manager.test.js`

- [ ] **Step 3: Implement actions**

要点：

```js
async function toggleLike(event, openid) {
  const postId = String(event.postId || '').trim();
  if (!postId) return { ok: false, message: '缺少帖子' };

  const postRes = await db.collection('recipe_wall_posts').doc(postId).get();
  const post = postRes.data;
  if (!post || post.status !== 'published') {
    return { ok: false, message: '帖子不可点赞' };
  }

  const likeRes = await db.collection('recipe_wall_likes').where({
    _openid: openid,
    postId
  }).limit(1).get();

  const existed = likeRes.data && likeRes.data[0];
  if (existed) {
    await db.collection('recipe_wall_likes').doc(existed._id).remove();
    const next = Math.max(0, (Number(post.likeCount) || 0) - 1);
    await db.collection('recipe_wall_posts').doc(postId).update({
      data: { likeCount: next, updatedAt: db.serverDate() }
    });
    return { ok: true, liked: false, likeCount: next };
  }

  await db.collection('recipe_wall_likes').add({
    data: { postId, createdAt: db.serverDate() }
  });
  const next = (Number(post.likeCount) || 0) + 1;
  await db.collection('recipe_wall_posts').doc(postId).update({
    data: { likeCount: next, updatedAt: db.serverDate() }
  });
  return { ok: true, liked: true, likeCount: next };
}
```

`list`：按 `createdAt` 倒序；`skip/limit` 分页；批量查当前用户 likes。  
`takeDown`：`if (!isDeveloperOpenid(openid)) return { ok:false, message:'无权限' }`。

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/recipe-wall-manager.test.js`

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/recipeWallManager/index.js tests/recipe-wall-manager.test.js
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add list detail like delete and takeDown actions

EOF
)"
```

---

### Task 4: 分包页面 — 列表 + 入口注册

**Files:**
- Create: `miniprogram/pkg-recipe-wall/list/index.js`
- Create: `miniprogram/pkg-recipe-wall/list/index.wxml`
- Create: `miniprogram/pkg-recipe-wall/list/index.wxss`
- Create: `miniprogram/pkg-recipe-wall/list/index.json`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/profile/index.js`
- Test: `tests/recipe-wall-pages.test.js`

**Interfaces:**
- 列表调用 `wx.cloud.callFunction({ name: 'recipeWallManager', data: { action: 'list', page, pageSize } })`
- 卡片用 `mapPostForCard`
- 导航：`/pkg-recipe-wall/detail/index?id=`、`/pkg-recipe-wall/publish/index`、`/pkg-recipe-wall/mine/index`

- [ ] **Step 1: Write page contract tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

test('app.json registers recipe-wall list subpackage page', () => {
  const app = read('miniprogram/app.json');
  assert.match(app, /pkg-recipe-wall/);
  assert.match(app, /list\/index/);
});

test('profile menu links to recipe wall under support group', () => {
  const js = read('miniprogram/pages/profile/index.js');
  assert.match(js, /食谱墙/);
  assert.match(js, /\/pkg-recipe-wall\/list\/index/);
});

test('list page loads via recipeWallManager list action', () => {
  const js = read('miniprogram/pkg-recipe-wall/list/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/list/index.wxml');
  assert.match(js, /recipeWallManager/);
  assert.match(js, /action:\s*['"]list['"]/);
  assert.match(js, /mapPostForCard/);
  assert.match(wxml, /authorLabel/);
  assert.match(wxml, /likeCount/);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tests/recipe-wall-pages.test.js`

- [ ] **Step 3: Implement list page + app.json + profile entry**

`app.json` 本任务只注册列表页（后续任务再追加页面，避免空页面占位）：

```json
{
  "root": "pkg-recipe-wall",
  "pages": [
    "list/index"
  ]
}
```

`profile` 的 `support` 组增加一项（放在意见反馈前）：

```js
{
  id: 23,
  name: '食谱墙',
  icon: 'add',
  path: '/pkg-recipe-wall/list/index',
  description: '分享宝宝辅食与低蛋白友好食谱'
}
```

列表页 UI 要点（柠檬主题）：

- 卡片：封面、标题、`{{item.authorLabel}}`、赞数
- 右上角 navigationBar 按钮或页内按钮：「发布」「我的」
- 下拉刷新、触底加载更多
- 空态：「还没有食谱，来发布第一条吧」

原生 button 若使用，遵循 `docs/miniprogram/ui-conventions.md`：`width:100%; margin:0; padding:0; box-sizing:border-box;` 并清 `::after`。

- [ ] **Step 4: Run contract tests — PASS**

Run: `node --test tests/recipe-wall-pages.test.js tests/recipe-wall-utils.test.js`

- [ ] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/pages/profile/index.js miniprogram/pkg-recipe-wall/list tests/recipe-wall-pages.test.js
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add list page and profile entry

EOF
)"
```

---

### Task 5: 详情页 + 点赞交互

**Files:**
- Create: `miniprogram/pkg-recipe-wall/detail/index.{js,wxml,wxss,json}`
- Modify: `tests/recipe-wall-pages.test.js`

- [ ] **Step 1: Extend contract test**

断言 detail 页：

- 调用 `action: 'detail'`
- 展示材料、步骤、`authorLabel`
- 点赞调用 `action: 'toggleLike'`
- 下架不可用态有文案「内容不可用」

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement detail and register in app.json**

在 `pkg-recipe-wall.pages` 追加 `"detail/index"`。

```js
async loadDetail() {
  const res = await wx.cloud.callFunction({
    name: 'recipeWallManager',
    data: { action: 'detail', postId: this.data.postId }
  });
  const result = res.result || {};
  if (!result.ok) {
    this.setData({ unavailable: true, message: result.message || '内容不可用' });
    return;
  }
  const post = result.post;
  this.setData({
    unavailable: false,
    post,
    authorLabel: formatRecipeWallAuthorLabel(post),
    liked: !!result.liked,
    likeCount: Number(post.likeCount) || 0
  });
}

async onToggleLike() {
  const prevLiked = this.data.liked;
  const prevCount = this.data.likeCount;
  const nextLiked = !prevLiked;
  this.setData({
    liked: nextLiked,
    likeCount: Math.max(0, prevCount + (nextLiked ? 1 : -1))
  });
  try {
    const res = await wx.cloud.callFunction({
      name: 'recipeWallManager',
      data: { action: 'toggleLike', postId: this.data.postId }
    });
    if (!res.result?.ok) throw new Error(res.result?.message || '点赞失败');
    this.setData({ liked: res.result.liked, likeCount: res.result.likeCount });
  } catch (e) {
    this.setData({ liked: prevLiked, likeCount: prevCount });
    wx.showToast({ title: '操作失败', icon: 'none' });
  }
}
```

列表页卡片上的点赞按钮可同样调用 `toggleLike`（可选，避免重复可只在详情赞；**MVP 要求列表可赞**，列表也接同一方法）。

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pkg-recipe-wall/detail tests/recipe-wall-pages.test.js miniprogram/pkg-recipe-wall/list
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add detail page and like toggle

EOF
)"
```

---

### Task 6: 发布页

**Files:**
- Create: `miniprogram/pkg-recipe-wall/publish/index.{js,wxml,wxss,json}`
- Modify: `tests/recipe-wall-pages.test.js`

- [ ] **Step 1: Contract test**

断言：

- 使用 `RECIPE_WALL_TAG_OPTIONS`
- 上传封面/步骤图到云存储（路径前缀建议 `recipe-wall/{openid}/`）
- 提交 `action: 'publish'`
- 缺展示名/宝宝名时引导去个人信息或宝宝信息
- 成功后 `navigateBack` 或跳转详情

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement publish UI and register in app.json**

在 `pkg-recipe-wall.pages` 追加 `"publish/index"`。

表单字段：

1. 封面（`wx.chooseMedia` + `wx.cloud.uploadFile`，上传前可压缩）
2. 标题
3. 标签单选：辅食 / 低蛋白 / 特医友好
4. 材料动态列表（name + amount，至少 1）
5. 步骤动态列表（text + 可选图，至少 1）
6. 页顶提示：「发布后将展示为「来自{宝宝昵称}{展示名}」，请确保内容与宝宝辅食/低蛋白相关」

提交前本地先 `validatePublishPayload`，再调云函数；用云函数返回 message 做 Toast。

从 `app.globalData` / 本地缓存读取 `babyUid`、`babyInfo.name`、个人 `displayName`（与 `personal-info` 缓存 key 一致：参考 `displayNameCacheKey(babyUid, role)`）。

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pkg-recipe-wall/publish tests/recipe-wall-pages.test.js
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add publish page with tag and media upload

EOF
)"
```

---

### Task 7: 我的发布 + 开发者下架页

**Files:**
- Create: `miniprogram/pkg-recipe-wall/mine/index.{js,wxml,wxss,json}`
- Create: `miniprogram/pkg-recipe-wall/admin/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/pages/profile/index.js`
- Modify: `tests/recipe-wall-pages.test.js`

- [ ] **Step 1: Contract tests**

- mine：`action: 'listMine'`；展示 `已下架`；删除调 `deleteOwn`
- admin：仅开发者菜单可见；`takeDown`；profile developer 组有入口

profile developer 组增加：

```js
{
  id: 24,
  name: '食谱墙管理',
  icon: 'setting',
  path: '/pkg-recipe-wall/admin/index',
  description: '下架违规食谱',
  showForDeveloper: true
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement mine + admin and register in app.json**

在 `pkg-recipe-wall.pages` 追加 `"mine/index"`、`"admin/index"`。扩展页面契约测试，断言 `app.json` 最终包含 list/detail/publish/mine/admin 五个页面。

admin 页：

- onShow 用 `isDeveloperOpenid` 校验，非开发者 `navigateBack`
- 列表拉 `list` 不够（只有 published）；增加云函数 `action: 'adminList'`（开发者可看 published，按时间倒序；已下架可用筛选）。为减少范围：adminList 默认列出最近 published，操作下架即可。

在 Task 3 若未加 `adminList`，本任务一并补上并补测：

```js
async function adminList(event, openid) {
  if (!isDeveloperOpenid(openid)) return { ok: false, message: '无权限' };
  // status in ['published'] for takedown queue; page/pageSize
}
```

- [ ] **Step 4: Run all related tests — PASS**

Run: `node --test tests/recipe-wall-utils.test.js tests/recipe-wall-manager.test.js tests/recipe-wall-pages.test.js`

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pkg-recipe-wall/mine miniprogram/pkg-recipe-wall/admin miniprogram/pages/profile/index.js cloudfunctions/recipeWallManager/index.js tests
git commit -m "$(cat <<'EOF'
feat(recipe-wall): add mine posts and developer takeDown admin

EOF
)"
```

---

### Task 8: 数据库索引与部署清单（文档步骤）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-recipe-wall-design.md`（追加「实现备注」小节）或  
- Create: `docs/superpowers/plans/2026-08-01-recipe-wall-ops.md`（短 ops 清单）

本任务不写业务代码，落地运维检查项，便于上线。

- [ ] **Step 1: 写 ops 清单文件**

`docs/miniprogram/recipe-wall-ops.md`：

```markdown
# 食谱墙上线检查

## 云开发控制台
1. 创建集合 `recipe_wall_posts`、`recipe_wall_likes`
2. 建议索引：
   - `recipe_wall_posts`: `status + createdAt`
   - `recipe_wall_posts`: `_openid + createdAt`
   - `recipe_wall_likes`: `_openid + postId`（唯一更好）
3. 上传并部署云函数 `recipeWallManager`（开通内容安全 openapi）
4. 云存储安全规则：仅登录用户可写自己的 `recipe-wall/{openid}/**`

## 权限 / 数据库安全规则
- `recipe_wall_posts` / `recipe_wall_likes`：读可对登录用户开放 published；写权限关闭客户端直写，仅云函数

## 提审
1. UGC 声明：文本+图片；内容安全 API + 管理员下架
2. 版本说明写明内容范围与安全接口
3. 准备审核账号可演示：发布、点赞、开发者下架
```

- [ ] **Step 2: Commit**

```bash
git add docs/miniprogram/recipe-wall-ops.md
git commit -m "$(cat <<'EOF'
docs(recipe-wall): add cloud deploy and audit checklist

EOF
)"
```

---

### Task 9: 手工验收

**Files:** none

- [ ] **Step 1: 本地/开发者工具验收清单**

1. 未设展示名 → 发布被拦截并引导  
2. 正常发布 → 列表出现，文案为「来自{宝宝名}{展示名}」  
3. 另一账号点赞/取消赞，计数正确  
4. 开发者下架后，普通用户列表/详情不可见；作者在「我的」见「已下架」  
5. 作者可删除自己的帖  
6. 云函数未部署时前端有友好错误提示  

- [ ] **Step 2: 跑全量相关单测**

Run: `node --test tests/recipe-wall-utils.test.js tests/recipe-wall-manager.test.js tests/recipe-wall-pages.test.js`  
Expected: 全部 PASS

- [ ] **Step 3: 若有修缺陷，单独 commit；否则无需 commit**

---

## Spec Coverage Checklist

| Spec 要求 | Task |
|-----------|------|
| 发布图文食谱 | 2, 6 |
| 安全检测后上墙 | 2 |
| 浏览 + 点赞 | 3, 4, 5 |
| 来自{宝宝昵称}{展示名} | 1, 4, 5, 6 |
| 管理员下架 | 3, 7 |
| 不做评论/收藏/举报 | Global Constraints |
| 分包入口不占 Tab | 4 |
| 与个人食谱管理分离 | 4（独立 pkg + 菜单文案） |
| 提审/UGC 说明 | 8 |

## 风险与实现注意

1. **`msgSecCheck` v2 需要用户 openid**：云函数内用 `getWXContext().OPENID`。  
2. **`imgSecCheck` 有大小限制**：前端压缩图片（建议长边 ≤ 1080，jpg quality ~0.8）。  
3. **客户端禁止直写集合**：数据库安全规则拒写，全部走云函数。  
4. **点赞计数非事务**：MVP 可接受极端并发误差；若后续放大再上事务/聚合。  
5. **云函数与小程序 utils 双份**：改校验规则时两边同步，单测两边都跑关键用例。
