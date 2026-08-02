# Recipe Wall Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布页可「存草稿」或「预览并发布」；云端 `status=draft` 仅在「我发布的」可见，可回填编辑并转正发布。

**Architecture:** 草稿与正式帖共用 `recipe_wall_posts`。云函数新增 `saveDraft` / `getOwn`，扩展 `publish(postId)` 将草稿改为 `published`。前端发布页双按钮 + `?id=` 回填；列表 mine 态展示草稿并跳转编辑。

**Tech Stack:** 微信小程序 + 云函数 `recipeWallManager` + `recipeWallUtils` + Node test runner

## Global Constraints

- 存草稿：标题必填（≤40）；不做安全检测；不要求作者展示名齐全
- 发布：完整 `validatePublishPayload` + `msgSecCheck` / `imgSecCheck`
- `saveDraft` 不得把 `published` / `taken_down` 改回 `draft`
- 广场 `all` / `liked` 仅 `published`；`mine` 含全部状态
- 显式写 `authorOpenid`；归属兼容 `_openid`

## File Map

| File | Role |
|------|------|
| `miniprogram/utils/recipeWallUtils.js` | `normalizeDraftPayload`（标题必填的宽松 normalize） |
| `cloudfunctions/recipeWallManager/recipeWallUtils.js` | 与小程序 utils 同步 |
| `cloudfunctions/recipeWallManager/index.js` | `saveDraft` / `getOwn` / `publish` 支持 postId |
| `tests/recipe-wall-manager.test.js` | 云函数单测 |
| `tests/recipe-wall-*.test.js` | 页面契约测 |
| `miniprogram/pkg-recipe-wall/publish/*` | 双按钮、存草稿、按 id 回填 |
| `miniprogram/pkg-recipe-wall/preview/index.js` | publish 带 postId |
| `miniprogram/pkg-recipe-wall/list/*` | 草稿态、点草稿进编辑、隐藏赞 |
| `docs/miniprogram/recipe-wall-ops.md` | 部署说明一行 |

---

### Task 1: Utils + 云函数草稿读写与发布转正

**Files:**
- Modify: `miniprogram/utils/recipeWallUtils.js`
- Modify: `cloudfunctions/recipeWallManager/recipeWallUtils.js`（同步）
- Modify: `cloudfunctions/recipeWallManager/index.js`
- Test: `tests/recipe-wall-manager.test.js`

**Interfaces:**
- Produces: `normalizeDraftPayload(input) → { ok, message?, data? }`
- Produces: `saveDraft(event, openid)` → `{ ok, postId }`
- Produces: `getOwn(event, openid)` → `{ ok, post }`（仅作者 draft/published/taken_down）
- Produces: `publish` 接受可选 `postId`；草稿属主则 update→published

- [x] **Step 1:** 写失败测：`saveDraft` 无标题失败；有标题成功且 `status=draft`；再次 save 同 id 更新；对 published 拒绝；`publish` 带 draft postId 转正；`getOwn` 非作者失败
- [x] **Step 2:** 实现 `normalizeDraftPayload` + 云函数 actions，跑测通过
- [x] **Step 3:** 同步云函数内 `recipeWallUtils.js` 副本

### Task 2: 发布页双按钮 + 草稿回填

**Files:**
- Modify: `miniprogram/pkg-recipe-wall/publish/index.{js,wxml,wxss}`
- Modify: `miniprogram/pkg-recipe-wall/preview/index.js`
- Test: `tests/recipe-wall-pages.test.js`

**Interfaces:**
- Consumes: `saveDraft` / `getOwn` / local draft key 增加 `postId`
- Produces: 底部「存草稿」「预览并发布」；`onLoad` 读 `options.id`

- [x] **Step 1:** 页面契约测：wxml 含存草稿；js 含 `saveDraft` / `getOwn`；preview publish 含 `postId`
- [x] **Step 2:** 实现 UI 与逻辑：存草稿成功后 `setData({ postId })`；preview `publish` 带上 `postId`

### Task 3: 列表「我发布的」草稿体验

**Files:**
- Modify: `miniprogram/pkg-recipe-wall/list/index.{js,wxml,wxss}`
- Modify: `docs/miniprogram/recipe-wall-ops.md`
- Test: `tests/recipe-wall-pages.test.js`

- [x] **Step 1:** `statusText` 支持草稿；mine 下点草稿进 publish；草稿隐藏点赞
- [x] **Step 2:** ops 注明 `status=draft`；全量相关测通过

---

**Execution:** 本会话 Inline 连续实现 Task 1→3。
