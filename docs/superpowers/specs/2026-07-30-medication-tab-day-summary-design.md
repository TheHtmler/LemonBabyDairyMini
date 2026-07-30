# 用药 Tab 当日汇总设计

日期：2026-07-30  
状态：已确认  
分支：`feature/medication-tab-day-summary`

## 背景

数据记录页（`pages/data-records-v2`）中，水量 / 尿布 / 睡眠 Tab 在操作栏下方、列表上方都有 `*-stats-row` 汇总条；用药 Tab 目前只有扁平列表，缺少同风格的「今天吃了哪些药、各多少」一眼汇总。

代码里 `processMedicationData` 已调用 `MedicationRecordModel.groupRecordsByMedication`，但 WXML 未使用，也未合计剂量。

## 目标

- 在「用药」Tab 内增加与水量 / 尿布 / 睡眠一致的汇总模块
- 范围：当前选中日（与列表同一天）
- 每种药展示：药名、当日总剂量（含单位）、服用次数
- 基于已加载的当日 `medicationRecords` 本地聚合，不额外云调用

## 非目标（YAGNI）

- 不改顶部「当日汇总数据」卡片
- 不做日期区间汇总
- 不对照药物方案目标次数（如「2/2」）
- 不扩展 `daily_summary_v2.medication` 存按药剂量明细（本需求不需要）
- 不改药物方案配置页、首页打卡清单

## 方案选择

采用 **列表加载后同程本地聚合**：在现有 `processMedicationData` 中根据当日记录生成 `medicationStats`，与列表一次 `setData`。

不采用：

- 单独再查库 / 再请求（会多消耗调用次数）
- 先写汇总表再读（库内用药汇总目前只有条数与 `takenMedicationIds`，不够按药剂量）

## UI

位置：用药 Tab → 操作栏（导入 / 补充）下方 → 明细列表上方。

形态：`medication-stats-row` + 每种药一个 `medication-stat-pill`，样式对齐 `water-stats-row` / `bowel-stats-row` / `sleep-stats-row`。

| 元素 | 内容 |
|------|------|
| 标签 | 药名 |
| 主数值 | 总剂量文案 + 单位（如 `3.0 ml`） |
| 副信息 | 服用次数（如 `2次`） |

行为：

- Tab 加载中：不显示汇总行
- 无用药记录：不显示汇总行，只保留空态「暂无用药记录」
- 药种较多：pill 横向换行
- 下方明细列表保持现状（仍按时间扁平列表）

## 数据流

1. 切 Tab / 换日期 → 照旧拉取当日 `medicationRecords`
2. `processMedicationData(records)` 排序列表，并调用纯函数生成 `medicationStats`
3. `setData({ medicationRecords, medicationStats, ... })` 一次渲染
4. 增删改用药后再次走 `processMedicationData`，汇总自动更新

无新增云函数、无新增集合字段、无额外 `findByDate`。

## 汇总数据结构

`medicationStats` 为数组，每项：

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | string | 分组键：`medicationId` 优先，否则 `medicationName` |
| `medicationName` | string | 展示名 |
| `totalDosage` | number | 同单位剂量之和；无法合计时为 `null` |
| `dosageText` | string | 展示用剂量（如 `3.0`）；无法合计时为空 |
| `unit` | string | 单位；无法合计时为空 |
| `count` | number | 该组记录条数 |

建议抽纯函数 `buildMedicationDayStats(records)`（可放在 `utils/` 或模型旁），便于单测；页面只消费返回值。

## 聚合规则

1. **分组**：`medicationId`（非空）优先；否则 `medicationName`
2. **剂量合计**：组内所有记录 `unit` 相同（trim 后）时，对 `dosage` 数值求和；否则 `totalDosage = null`，pill 只强调次数（不硬加不同单位）
3. **非法剂量**：非数字 / 空视为 `0`
4. **排序**：按 `medicationName` 稳定排序（与现有 `groupRecordsByMedication` 一致）
5. **展示名**：取组内第一条非空 `medicationName`，缺省时可用「未命名药物」

可顺带让现有 `groupedMedicationRecords` 带上合计字段，或仅保留 `medicationStats` 给 UI；以 WXML 只绑 `medicationStats` 为准，避免两套展示数据分叉。

## 测试

针对 `buildMedicationDayStats`（或等价纯函数）：

- 空列表 → `[]`
- 同药同单位多条 → 剂量相加、次数正确
- 按 `medicationId` 分组（同名不同 id 不合并）
- 同组单位不一致 → `totalDosage` 为 `null`，`count` 仍正确
- 剂量缺失 / 非数字 → 按 0 处理

## 涉及文件（预期）

| 文件 | 变更 |
|------|------|
| `miniprogram/pages/data-records-v2/index.wxml` | 用药 Tab 增加 stats-row |
| `miniprogram/pages/data-records-v2/index.wxss` | 复用/轻量对齐现有 stats pill 样式 |
| `miniprogram/pages/data-records-v2/index.js` | `processMedicationData` 写入 `medicationStats` |
| 新建 util（如 `utils/medicationDayStats.js`） | `buildMedicationDayStats` |
| `tests/...` | 上述纯函数单测 |

## 成功标准

- 选中有用药记录的日期，进入用药 Tab，顶部可见按药汇总（名称、总剂量、次数）
- 与列表数据一致；增删改后汇总同步
- 网络层面相对改造前不多一次用药查询
