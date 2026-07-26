# 睡眠记录分类设计

日期：2026-07-26  
状态：已确认  
分支：`feature/sleep-records`

## 背景

柠檬宝宝日记已有喂奶、食物、用药、治疗、尿布、喝水等日维度分类，缺少睡眠记录。家长需要按次记录入睡/醒来时间，并在首页与数据记录中统一查看。

## 目标

- 新增「睡眠」记录分类，与现有分类体验一致
- 支持每次睡眠的起止时间、可选备注、跨午夜、进行中（先记开始）
- 对「忘了填结束时间」提供首页提醒 + 开新记录拦截

## 非目标（YAGNI）

- 不做睡眠质量评分、深浅睡类型、夜醒次数结构化字段
- 不做睡眠分析图表 / 报告页（可后续迭代）
- 不把睡眠塞进喂奶集合或仅本地存储

## 方案选择

采用 **独立集合 `sleep_records`**：独立 model、记录页，并接入 Tab / 时间轴 / 日汇总。  
不采用喂奶 `recordType` 复用，也不做本地-only 首版。

## 数据模型

集合：`sleep_records`  
一条记录 = 一次睡眠。

| 字段 | 类型 | 说明 |
|------|------|------|
| `babyUid` | string | 宝宝标识 |
| `date` / `dateKey` | string | 归属日 = **开始日期** `YYYY-MM-DD` |
| `startTime` | string | `HH:MM`，必填 |
| `endTime` | string \| null | `HH:MM`，可空（进行中） |
| `startDateTime` | Date | 由归属日 + `startTime` 拼出 |
| `endDateTime` | Date \| null | 有结束时间时拼出；跨午夜落在次日 |
| `durationMinutes` | number \| null | 仅已结束时计算；进行中为空 |
| `notes` | string | 可选备注 |
| `status` | string | 与现有记录一致（如 `active`） |
| `createdAt` / `updatedAt` | Date | 审计 |
| `createdBy` / `updatedBy` | string | 审计 |

### 跨午夜规则

- 允许 `endDateTime` 落在 `startDateTime` 次日
- 整段记录只挂在 **开始日期**
- 时长按真实起止计算，不按午夜切开

### `endDateTime` 拼装

有结束时间时：

1. 先用归属日 + `endTime` 拼出同日候选结束时间
2. 若与 `startDateTime` **同一分钟** → 无效（不滚次日，避免约 24h；挡住「立刻醒来」误写）
3. 若同日候选严格晚于开始 → 采用同日
4. 若结束钟点早于开始 → 改用 **次日** + `endTime`（跨午夜，例如 22:00 → 06:00）
5. 仍不满足「严格晚于开始」→ 校验失败（不保存）

表单校验以拼装后的 Date 为准，**不要**用「结束钟点必须大于开始钟点」拦掉合法跨午夜。

### 校验

- 开始时间必填
- 有结束时间时：拼装后的 `endDateTime` 必须严格晚于 `startDateTime`
- 未选宝宝 / 未登录：与现有记录页同样拦截，不写库

## 日汇总

在 `daily_summary_v2` 增加 `sleep` 段：

| 字段 | 说明 |
|------|------|
| `totalRecords` | 该日睡眠条数（含进行中） |
| `totalDurationMinutes` | 仅累计已结束记录的时长 |
| `ongoingCount` | 进行中条数 |

写入 / 更新 / 删除后 `markDirty`；云函数 `rebuildDailySummaryV2` 同步支持重建。

## 页面与入口

### 记录页

路径：`pkg-records/sleep-record`（仿 `water-record` / 喂奶紧凑表单）

- 开始时间（必填，默认当前时间）
- 结束时间（可空；空则保存为进行中）
- 备注（可选）
- 保存 / 取消；编辑已有记录同页

### 全量接入

1. **今日记录**：快捷入口「睡眠」
2. **时间轴**：筛选增加「睡眠」；进行中展示「睡觉中」
3. **数据记录**：Tab 增加 `sleep` / 「睡眠」；列表展示起止、时长、备注

Tab 常量：`recordTabsPreference.js` 增加 `{ key: 'sleep', label: '睡眠' }`。  
时间轴：`TIMELINE_TABS` 增加睡眠筛选 key。

## 「未结束」兜底

1. **首页置顶提醒**：存在进行中睡眠时，显示「宝宝还在睡 · 点此醒来」  
   - 默认用当前时间按上述规则拼装并写入结束时间  
   - **时间异常**定义：用当前时间拼装失败（含与开始同一分钟、或拼装后仍不晚于开始）→ 进入编辑页手选结束时间  
   - 用户也可主动进入编辑页调整
2. **开新睡眠拦截**：已有未结束记录时，弹窗选项：  
   - 补结束并继续新建  
   - 先去结束上一段  
   - 取消  
3. **列表态**：进行中显示「睡觉中」，可点进补结束

「进行中」查询范围：当前宝宝下 `status=active` 且 `endTime` / `endDateTime` 为空的记录（通常 0～1 条；拦截逻辑按「存在任意进行中」处理）。

## 数据流

```
记录页 / 一键醒来
    → SleepRecordModel（CRUD → sleep_records）
    → DailySummaryV2Model.markDirty
    → 今日记录时间轴 / 数据记录 Tab / 首页进行中提醒
```

主要接入文件（实现时按现有喝水路径对齐）：

- `miniprogram/models/sleepRecord.js`（新建）
- `miniprogram/pkg-records/sleep-record/`（新建）
- `miniprogram/utils/recordTabsPreference.js`
- `miniprogram/utils/dailyRecordV2Service.js`
- `miniprogram/utils/dailySummaryV2Utils.js`
- `cloudfunctions/rebuildDailySummaryV2/index.js`
- `miniprogram/pages/daily-feeding/`（快捷入口、时间轴、banner）
- `miniprogram/pages/data-records-v2/`（Tab 列表与跳转）
- `miniprogram/app.json`（分包页面注册）

## 错误处理

| 场景 | 行为 |
|------|------|
| 结束 ≤ 开始 | Toast，不保存 |
| 云写入失败 | Toast 失败，保留表单可重试 |
| 一键醒来时间异常（拼装后 end ≤ start） | 进入编辑页手选结束时间 |
| 删除 | 与现有记录删除策略一致（软删或等价） |

## 测试范围

- Model：创建进行中、补结束、跨午夜时长与归属日、进行中查询
- UI：保存校验、开新睡眠拦截、一键醒来
- Tab / 时间轴：偏好含 `sleep`，筛选与列表正常
- 汇总：已结束时长累计正确，`ongoingCount` 正确

## 成功标准

- 可新增 / 编辑 / 删除睡眠记录，并在三个入口（快捷入口、时间轴、数据记录 Tab）可见
- 跨午夜记录挂在开始日，时长正确
- 进行中可保存；首页可一键醒来；开新记录时会被拦截处理未结束项
- 日汇总 sleep 段与重建云函数一致
