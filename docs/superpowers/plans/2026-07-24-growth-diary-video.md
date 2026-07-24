# Growth Diary Short Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成长日记支持每条最多 1 个 ≤15s/≤10MB 短视频，与图片合计最多 3 个媒体；列表只显示封面，详情页播放。

**Architecture:** 在 `growthDiaryUtils` 统一 `media[]`（兼容旧 `photos`）；`diaryImage` 扩展视频上传与封面（优先用 `chooseMedia` 的 `thumbTempFilePath`）；model 双写 `media` + image 子集 `photos`；列表只 resolve cover/thumb，详情再 resolve video。

**Tech Stack:** 微信小程序原生、云开发存储、`wx.chooseMedia`、`wx.compressImage`、Node `node:test`

**Spec:** `docs/superpowers/specs/2026-07-24-growth-diary-video-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `miniprogram/utils/growthDiaryUtils.js` | `MAX_DIARY_MEDIA` / video 常量、`normalizeMedia`、`validateDiaryPayload` media 校验、`mediaToPhotos`、`collectMediaFileIds` |
| `miniprogram/utils/diaryImage.js` | `buildDiaryVideoCloudPaths`、`validateDiaryVideoLocal`、`prepareAndUploadDiaryVideo` |
| `miniprogram/models/growthDiary.js` | create/update/softDelete 读写 `media`，双写 `photos`，清理全部 media fileID |
| `miniprogram/pkg-records/growth-diary/index.*` | 选图/视频、表单预览角标、上传、列表封面 |
| `miniprogram/pkg-records/growth-diary/detail.*` | `<video>` + poster |
| `tests/growth-diary-utils.test.js` 等 | TDD 覆盖 |

---

### Task 1: media 校验与兼容映射

**Files:**
- Modify: `miniprogram/utils/growthDiaryUtils.js`
- Test: `tests/growth-diary-utils.test.js`

- [ ] **Step 1: 写失败测试** — `MAX_DIARY_MEDIA===3`、`MAX_DIARY_VIDEOS===1`、media 合计超限、双视频拒绝、旧 photos→media、validate 产出 `media`+`photos`
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 normalize/validate**
- [ ] **Step 4: 测试通过并 commit**

### Task 2: 视频上传管线

**Files:**
- Modify: `miniprogram/utils/diaryImage.js`
- Test: `tests/diary-image.test.js`

- [ ] **Step 1: 写失败测试** — 路径 `_video`/`_cover`；时长/体积拒绝；上传视频+封面成功；无封面抛错
- [ ] **Step 2–4: 实现、通过、commit**

封面策略：调用方传入 `coverLocalPath`（来自 `chooseMedia` 的 `thumbTempFilePath`）；无封面则失败。

### Task 3: Model 读写 media

**Files:**
- Modify: `miniprogram/models/growthDiary.js`
- Test: `tests/growth-diary-model.test.js`

- [ ] create/update 写 `media` + 双写 image `photos`；softDelete/替换清理 video+cover+image fileIDs
- [ ] 测试通过并 commit

### Task 4: 列表/编辑页

**Files:**
- Modify: `growth-diary/index.js|wxml|wxss`
- Test: `tests/growth-diary-ui.test.js`（静态断言）

- [ ] `chooseMedia` 支持 image+video；名额与单视频限制；表单 `media`；列表 `mediaThumbs`（url + isVideo）；列表不 resolve videoFileId
- [ ] commit

### Task 5: 详情页播放

**Files:**
- Modify: `growth-diary/detail.js|wxml|wxss`

- [ ] 解析 cover + video temp URL；`<video>`；失败 toast
- [ ] commit

### Task 6: 全量回归

- [ ] 跑相关测试套件全部通过
- [ ] 推送分支（若用户要求）

---

## 执行说明

用户已要求直接实现 → **Inline Execution**（本会话按任务推进，不另行询问 subagent/inline）。
