# 成长日记短视频设计

## 背景

成长日记阶段 A 已支持最多 3 张配图（原图 + 缩略图、微信云存储、列表只刷 thumb）。产品希望里程碑可附带一段短视频，增强仪式感；同时仍受个人主体云开发套餐约束（容量 / CDN / 调用次数敏感）。

阶段 A 明确排除短视频；本期在**不引入外部 COS** 的前提下，以严格上限开通短视频能力。

## 目标

- 单条日记可附带 **0–1 个短视频**，与图片共用媒体名额。
- 媒体合计最多 **3**：例如 2 图 + 1 视频，或 3 图无视频。
- 视频限制：时长 **≤15s**、体积 **≤10MB**；超出拒传。
- 封面自动截取首帧；列表只展示封面 + 播放角标，**不拉视频流**；详情页再播放。
- 继续使用微信云存储与现有 `cloudTempUrlCache`；删除/换媒体时清理云文件。

## 非目标

- 长视频、多视频、列表内联播放。
- 腾讯云 COS / 外部 OSS、在线剪辑、用户手选封面流程（仅作首帧失败时的降级提示）。
- 公开社区、点赞评论。
- 放宽图片压缩策略或取消 thumb。

## 常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAX_DIARY_MEDIA` | 3 | 图 + 视频合计 |
| `MAX_DIARY_VIDEOS` | 1 | 单条最多视频数 |
| `MAX_VIDEO_DURATION_SEC` | 15 | 时长上限 |
| `MAX_VIDEO_BYTES` | 10 * 1024 * 1024 | 体积上限 |

图片单项仍沿用阶段 A：`original` + `thumb`，原图目标约 ≤500KB。

## 数据模型

### 推荐：统一 `media[]`

在 `growth_diary` 增加（或迁移为）`media` 数组：

```js
media: [
  {
    type: 'image' | 'video',
    // image
    originalFileId: string | null,
    thumbFileId: string | null,
    // video
    videoFileId: string | null,
    coverFileId: string | null,
    durationSec: number | null,
    sizeBytes: number | null,
    // common
    width: number | null,
    height: number | null
  }
]
```

校验：

- `media.length <= MAX_DIARY_MEDIA`
- `media.filter(m => m.type === 'video').length <= MAX_DIARY_VIDEOS`
- `type === 'image'` 必须有 `originalFileId` + `thumbFileId`
- `type === 'video'` 必须有 `videoFileId` + `coverFileId`

### 兼容旧数据

- 读路径：若仅有历史 `photos[]`，映射为 `type: 'image'` 的 `media` 项后再渲染。
- 写路径：新写入以 `media` 为准；实现期可短暂双写 `photos`（仅 image 子集）以降低半发布风险，稳定后停写 `photos`。
- 不强制批量迁移历史文档；惰性兼容即可。

### 云路径

```
growth-diary/{babyUid}/{entryKey}/{ts}_{i}_orig.jpg
growth-diary/{babyUid}/{entryKey}/{ts}_{i}_thumb.jpg
growth-diary/{babyUid}/{entryKey}/{ts}_{i}_video.mp4   // 或 chooseMedia 实际扩展名
growth-diary/{babyUid}/{entryKey}/{ts}_{i}_cover.jpg
```

## 上传与封面管线

公共能力建议扩展现有 `diaryImage.js` 或新增 `diaryMedia.js`（图片逻辑复用前者）：

1. `wx.chooseMedia`：`mediaType: ['image', 'video']`；`count` = 剩余名额；已有视频时 UI/逻辑禁止再选视频。
2. **图片**：沿用 `prepareAndUploadDiaryPhoto`（压原图 → 上传 → thumb → 上传）。
3. **视频**：
   - 校验 `duration`、本地文件 size；超限 toast 并丢弃该项。
   - `wx.cloud.uploadFile` 上传视频。
   - **自动截首帧**生成封面（优先用小程序可用的视频帧/缩略能力；以「最省事可落地」为准）。
   - 封面按图片链路压缩后上传 `cover`。
   - 首帧失败：**不入列该视频**，toast「无法生成封面，请换一段视频」（不要求用户另拍封面）。
4. 保存日记：全部新媒体上传成功后再写库（与阶段 A「全部成功再写」一致）。
5. 换媒体 / 软删：`deleteCloudFiles` 清理对应 `videoFileId`、`coverFileId`、`originalFileId`、`thumbFileId`；删除失败只记日志。

## 展示与交互

### 编辑页

- 预览区：图片 thumb + 视频封面（▶ /「视频」角标）；可删除单项。
- 上传中：loading / 禁用保存，直至当前批次完成或失败回滚。
- 已有 1 视频时：选择器不再接受 video，或选中后提示「每条日记最多 1 个视频」。

### 列表（时间线）

- 视频位只解析 `coverFileId` 的 temp URL（复用 `cloudTempUrlCache`）。
- 展示封面 + 播放角标；**禁止**在列表请求 `videoFileId` 的 temp URL。
- 点击进入详情（或现有详情/分享落地）后再播。

### 详情页

- `<video>`：`src` 为 video temp URL，`poster` 为封面 URL。
- 播放失败：提示「视频暂时无法播放」；可重试刷新 temp URL。

### 分享

- 分享卡片/落地页可展示封面与文字；非成员权限规则不变（不泄露正文）。
- 落地页若允许成员播放，同样按需取 video temp URL，不在分享卡片预拉视频文件。

## 错误处理

| 场景 | 处理 |
|------|------|
| 选媒体取消 | 静默 |
| 超时长 / 超大小 | 拒收该项并说明限制（15s / 10MB） |
| 合计将超过 3 | 前端拦截 |
| 第二段视频 | 前端拦截 |
| 上传失败 | 该项回滚，可重试；不写半残 media |
| 首帧失败 | 不保存该视频 |
| temp URL 过期 | 缓存失效后重新 `getTempFileURL` |
| 无编辑权限 | 隐藏操作；异常调用提示无权限 |

## 成本与配额护栏

- 列表 / 时间线：**只**用 cover / thumb，永不批量解析 video fileID。
- 视频体积与时长双上限，降低单条占用。
- 每条最多 1 视频，控制容量与 CDN 增长。
- 若后续套餐持续吃紧，再评估视频迁出至 COS（非本期）。

## 权限

与阶段 A 相同：参与者可读/可新增；仅作者可编辑删除；`legacy` 无作者时仅宝宝创建者可代管。视频字段不改变权限模型。

## 测试要点

- 工具/校验单测：`media` 合计 ≤3、视频 ≤1、时长/体积拒绝、旧 `photos` → `media` 映射。
- 上传管线 mock：视频上传成功 + 封面成功；首帧失败不入列；清理 fileID 调用。
- 页面行为：列表不请求 video temp URL；详情可播；已有视频时不可再选视频。
- 回归：纯图片日记创建/编辑/列表/分享行为与阶段 A 一致。

## 实现边界备忘

- 分支：从 `main` 拉独立工作分支（如 `feature/growth-diary-video`），不与食谱等功能分支混提。
- 首帧实现选型以基础库兼容与最少依赖为准；若某机型无可用 API，走「提示重选」降级即可。
- 不在本期做转码、多码率或服务端截帧。
