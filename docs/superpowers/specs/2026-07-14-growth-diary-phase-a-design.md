# 成长日记阶段 A 设计

## 背景

现有「成长记录」页同时承载身高体重曲线与文字里程碑，里程碑缺少配图与仪式感，也不利于家庭成员共同记录。产品希望在合规前提下（个人主体不做公开社区）提供家庭内时光轴体验，并控制云存储/CDN 成本。

本期为**阶段 A**：独立「成长日记」入口、里程碑迁入新集合、最多 3 张配图（压图 + 缩略图）、单条微信分享。不做公开社区、点赞评论、多图相册（>3）与视频。

## 目标

- 新建 **成长日记** 页面：时间线展示里程碑（标题、日期、备注、0–3 张图）。
- 新建云库集合 `growth_diary`；旧 `growth_milestones` 数据经**本地 JSON 导出 → 转换 → 导入**迁入，客户端停写旧集合。
- 原「成长记录」仅保留测量与曲线，文案统一为 **成长曲线**（去掉里程碑 UI）。
- 入口：今日快捷记录 **仅一个**「成长日记」快捷项；「我的 → 数据与成长」同时保留「成长日记」与「成长曲线」。
- 图片：上传前压缩；每张保留 `original` + `thumb`；列表用缩略图。
- 单条日记可 `onShareAppMessage` 分享到微信好友/群；小程序内无点赞评论。
- 权限：参与者均可新增；仅作者可编辑/删除自己的条目；无作者的历史（legacy）仅创建者可代管。

## 非目标

- 公开社区 / 病友广场 / 点赞评论。
- 单条超过 3 张图、独立相册、短视频。
- 自由日记类型（非里程碑正文）；阶段 A 内容形态仍是里程碑。
- 云函数批量迁移脚本（迁移由开发者本地完成）。
- 今日页额外情感大卡片（首页只保留快捷入口一处）。

## 信息架构

| 产品名 | 路径（建议） | 职责 |
|--------|--------------|------|
| 成长日记 | `pkg-records/growth-diary/index` | 里程碑时间线 CRUD、配图、分享 |
| 成长曲线 | `pkg-records/growth-records/index`（现有页瘦身） | 测量录入 + WS/T 曲线；无里程碑 |

「我的」菜单：将原「成长记录」拆为两项或改名为「成长曲线」并新增「成长日记」。

今日页：在快捷记录中增加「成长日记」一项即可（可与「成长曲线」并存为两个不同快捷项；**日记本身在首页只出现一次**，不加第二张入口卡片）。

## 数据模型

### 集合 `growth_diary`

| 字段 | 类型 | 说明 |
|------|------|------|
| `babyUid` | string | 宝宝维度 |
| `eventDate` | Date | 发生日期 |
| `title` | string | 里程碑标题（必填） |
| `notes` | string | 备注（可选） |
| `photos` | array | 最多 3 项，见下 |
| `createdByOpenid` | string | 作者 openid；编辑/删除校验用 |
| `userInfo` | object | 展示用（昵称等），与现有写入习惯对齐 |
| `migratedFromId` | string? | 旧 `growth_milestones._id`，便于核对 |
| `legacy` | boolean? | 迁移时无法解析作者则为 `true` |
| `status` | string | 默认 `active`；删除可用软删 `deleted` 或硬删（实现时二选一，推荐软删） |
| `createdAt` / `updatedAt` | Date | 时间戳 |

### `photos[]` 元素

```js
{
  originalFileId: string, // 云存储 fileID
  thumbFileId: string,
  width: number | null,
  height: number | null
}
```

无图里程碑：`photos: []`。

### 权限规则

| 操作 | 规则 |
|------|------|
| 读列表/详情 | 当前宝宝的参与者 |
| 新增 | 任意参与者；写入 `createdByOpenid = 当前 openid` |
| 编辑/删除 | `createdByOpenid === 当前 openid`；若 `legacy === true` 且无有效作者，仅宝宝创建者可改 |
| 分享落地 | 非成员不展示他人日记内容，走现有无权限/邀请逻辑 |

客户端写操作须带 openid 校验；关键写路径建议走云函数或安全规则（若现有里程碑为客户端直写 DB，阶段 A 可先保持直写 + 前端校验，与现网一致，并在实现计划中注明后续加固）。

## 迁移（本地 JSON，无云函数）

1. 微信云开发控制台导出 `growth_milestones`。
2. 本地转换：映射字段 → `growth_diary`；`photos: []`；`createdByOpenid` 优先取 `userInfo.openid`；否则 `legacy: true`；写入 `migratedFromId`。
3. 控制台导入 `growth_diary`。
4. 发版后客户端只读写 `growth_diary`；旧集合只读备份，不再写入。
5. 仓库提供：`scripts/migrate-growth-milestones-to-diary.js`（可选，仅本地 Node）+ 简短 README 步骤；**不部署为云函数**。

`accountCleanup` 等清理逻辑需同步纳入 `growth_diary`（并从清理列表视角处理旧集合策略：可保留清理旧集合以免残留）。

## 图片管线

公共工具（建议 `miniprogram/utils/diaryImage.js`）：

1. 选择图片，总数不超过 3。
2. 每张：压缩原图（目标约 ≤500KB，可参考 `add-report` 的 quality 阶梯）→ 上传 `original`。
3. 再生成缩略图（最长边约 400 或二次低 quality）→ 上传 `thumb`。
4. 云路径：`growth-diary/{babyUid}/{entryIdOrTemp}/{ts}_{i}_orig.jpg` 与 `_thumb.jpg`。
5. 列表/`getTempFileURL` 优先 `thumb`，复用现有 temp URL 缓存；预览用 `original`。
6. 换图成功后再删旧 fileID；删除失败只记日志。

## 用户流程

### 浏览

1. 从今日快捷入口或「我的」进入成长日记。
2. 按 `eventDate` 倒序看时间线；有图则展示最多 3 张缩略图。

### 新增

1. 点「新增」→ 填标题、日期、备注 → 可选 1–3 张图。
2. 保存：压图上传 → 写入 `growth_diary`。

### 编辑 / 删除

1. 仅作者（或 legacy 下的创建者）看到编辑/删除。
2. 删除：软删或硬删 + 尽量清理云文件。

### 分享

1. 条目「分享」触发 `onShareAppMessage`（标题含宝宝名/里程碑名，path 带 diary id 或列表锚点）。
2. 被分享人若非成员：不泄露正文，引导加入/无权限页。

### 成长曲线

1. 打开原成长记录页：仅测量与图表。
2. 移除里程碑列表与「新增里程碑」。

## 错误处理

- 选图取消：静默。
- 单张上传失败：提示第 N 张失败，整单可不提交半残 `photos`（全部成功再写库，或成功子集需用户确认——推荐**全部成功再写**）。
- 超 3 张：前端拦截。
- 无编辑权限：隐藏操作；异常调用提示无权限。

## 测试要点

- Model/工具单测：最多 3 图、作者校验、legacy 规则、压缩/上传 mock。
- 本地迁移脚本：样例 JSON → 新结构字段断言。
- 页面：曲线页无里程碑；日记 CRUD 与分享 path；入口文案（成长日记 / 成长曲线）。
- 清理：`accountCleanup` 包含 `growth_diary`。

## 实现边界备忘

- 阶段 A 不引入社交类目能力；分享仅微信原生会话，小程序内无 UGC 互动。
- 成本：3 图/条 + 缩略图仍依赖压图；列表禁刷原图。
- 后续阶段（非本期）：多图相册、家庭内互动、公开社区（需主体与类目升级）。
