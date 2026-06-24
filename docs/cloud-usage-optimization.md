# 云开发「调用次数」消耗分析与优化梳理

> 状态：**分析文档，仅梳理，未改动任何业务代码**。
> 目标：定位当前小程序消耗微信云开发「调用次数」配额过快的原因，并给出分优先级的优化方案。
> 适用环境：`prod-7g5lap9xcf106dbf`（个人开发者，19.9 元/月基础套餐）。

---

## 0. TL;DR（结论先行）

- 「20 万次/月」是一个**合并指标**：数据库读 + 数据库写 + 云函数调用 + 云存储上传/下载，全部计入同一个池子。
- 本项目消耗**几乎全部来自「数据库读」**，云函数调用占比极小。
- 三大黑洞（按影响排序）：
  1. **报告页 `onShow` 每次全量拉历史**（`daily_summary_v2` 365 条 + `feeding_records_v2` 最多约 4000 条）。
  2. **各 Tab 的 `onShow` 无条件全量重载**（Tab 来回切、子页返回都触发）。
  3. **`getDailyRecordV2` 即使缓存命中也每次重读 6 个事件集合**（缓存只省了"算"，没省"读"）。
- 估算：单个活跃用户约 **2000~2500 次/天**，20 万/月只够约 **3 个日活用户**，与"几万次/天根本不够用"吻合。
- 优化 P0 三项做完，预计单用户降到 **200~400 次/天（降 80~90%）**，可支撑日活提升到 **15~25 人**。

---

## 1. 计费模型（口径澄清）

依据官方[计费说明](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/billing/price)，19.9 元基础套餐：

| 基础套餐 | 配额 |
|---|---|
| **调用次数** | **20 万次/月** |
| 容量 | 2GB |
| 云函数资源使用量 | 10 万 GBs |
| 云函数外网出流量 | 2GB |
| CDN 流量 / 回源流量 | 各 5GB |
| QPS | 500 |

「调用次数」**包含**：
- 数据库**读**操作 + 数据库**写**操作
- 云函数调用操作
- 云存储上传/下载操作

要点：
- **数据库读按返回记录条数计**：一次 `.get()` 返回 N 条 ≈ N 次调用。因此 `.limit(365)`、分页拉几千条这类操作单次就极贵。
- 超额后按 **0.5 元/万次** 计；不开按量付费则：读/写超限当天停服，云函数等超限到下个周期前停服。

---

## 2. 系统架构概览（与消耗相关）

- 客户端**直连数据库**（`wx.cloud.database()`）完成绝大多数读写，云函数很少。
- 运行时云函数（用户高频可触发的）：
  - `getOpenid`：每次冷启动调用 1 次（`miniprogram/app.js` `getOpenid`）。
  - `checkPermission`：云函数存在，但客户端权限校验主要走 `app.checkPermission` 直连数据库。
  - 其余（`accountCleanup` / `updateBabyAvatar` / `feedbackManager` / `getSystemFoodIndex` / 各 `migrate*`）为低频或迁移用途。
- 关键集合：`baby_creators`、`baby_participants`、`baby_info`、`feeding_records_v2`、`food_intake_records`、`medication_records`、`treatment_records`、`bowel_records`、`growth_records_v2`、`daily_summary_v2`、`medications`、报告集合。

---

## 3. 单用户单日消耗估算

按一个正常喂养的看护者（每天开 App 8~10 次、在三个 Tab 间来回切）估算：

| 来源 | 每次读写数（估） | 频率/天 | 小计 |
|---|---|---|---|
| 首页 `onShow`（看板 + 趋势） | ~55–65 | ~10 | ~600 |
| 数据记录页 `onShow` | ~38 | ~4 | ~150 |
| **报告页 `onShow`（最贵，随历史增长）** | **400–1000+** | 1–2 | **~1000** |
| App 冷启动（角色/权限/宝宝信息 + getOpenid） | ~7 | ~8 | ~56 |
| 写记录（喂奶/用药/食物，写 + markDirty 读写） | ~3/条 | ~20 条 | ~60 |
| **合计** | | | **~1900–2500/人·天** |

> 20 万/月 ÷ 2000/人·天 ≈ 100 人·天/月 ≈ 仅 ~3 个日活用户即可耗尽。报告页消耗还会随数据积累线性增长。

---

## 4. 问题清单（按影响排序）

### 🔴 P0-1　报告页每次进入都全量拉历史（单次最贵）

**位置**：`miniprogram/pages/analysis-report/index.js`
- `onShow()`（:161）每次都调 `loadReportData()`。
- `loadFeedingWindow()`（:255）：
  - `daily_summary_v2 .where({babyUid,status:'active'}).orderBy('date','desc').limit(365).get()`（:262）→ 最多 365 条读。
  - `loadV2MilkRecords()`（:299）分页拉 `feeding_records_v2` 近一年全部，安全上限 200 页 × 20 = **约 4000 条**（:316）。

**问题**：
1. 切回该 Tab 即重拉，重复消耗。
2. 趋势对照只需「两次化验之间」几十天的**每日营养系数**，却拉了 365 天 + 全量奶记录。
3. `feeding_records_v2` 的原始记录被重新计算营养，而 `daily_summary_v2.macroSummary` 已有同源汇总，重复劳动。

---

### 🔴 P0-2　各 Tab 的 `onShow` 无条件全量重载

微信里 Tab 间来回切、从子页返回都会触发 `onShow`，而各页 `onShow` 都直接发起网络请求，无"数据未变则不刷新"的判断：

- 首页：`miniprogram/pages/daily-feeding/index.js` `onShow`（:265）→ `loadDashboard({silent,rebuildTrend:false})` + `loadDeferredDashboardParts()`。
- 数据记录页：`miniprogram/pages/data-records-v2/index.js` `onShow`（:2668）→ `fetchDailyRecords` + `loadMedications` + `loadFoodCatalog`。
- 报告页：见 P0-1。
- 我的页：`miniprogram/pages/profile/index.js` `onShow`（:158）→ `getBabyInfo`（多数走缓存，影响较小）。

**问题**：用户随手点几下就是几百次读取。

#### 为什么当初要"每次 onShow 全刷"（设计意图）

`onShow` 全刷的**真实目的就是「保证数据最新」**：子页（喂奶/辅食/用药/治疗/大小便/体重编辑）保存后基本只做 `navigateBack()`（如 `milk-feeding-editor-v2/index.js:1053`），并不把新数据回传给 Tab 页，因此返回时只能靠 Tab 页 `onShow` 重新拉库才能看到刚写的记录。这是一个合理但"粗放"的初衷——**不能简单按时间节流砍掉**，否则"刚编辑完切回来看不到最新"就是 bug（正是这点要小心）。

#### 现状其实更微妙：已有"精准通知刷新"机制，但覆盖不全 + 与 onShow 重复

项目其实已经演进出一套**精准通知上一页刷新**的机制（写完只刷上一页、且 `silent`）：
- `meal-editor/index.js:1136`、`treatment-record/index.js:417`、`milk-feeding-editor-v2/index.js:991` 的 `notifyPreviousPageRefresh()`；
- `bowel-record/index.js:194` 的 `refreshPreviousPage()`。

它们的逻辑是：找栈里上一页，若有 `fetchDailyRecords` 就只刷当天；若上一页是首页则尝试调 `loadTodayData`。但实际接线存在两个问题：

1. **首页精准通知完全落空**：首页 `daily-feeding` **没有 `loadTodayData`，也没有 `fetchDailyRecords`**（它的刷新方法叫 `loadDashboard`）。所以从首页进编辑页保存返回时，精准通知什么都没调到 → **首页 100% 依赖 `onShow` 全刷**。这就是 `onShow` 全刷此刻删不得的根因。
2. **数据记录页双重刷新**：它有 `fetchDailyRecords`，从编辑页返回时被精准刷一次（仅当天、silent），紧接着 `onShow` 又全刷一次（`fetchDailyRecords` + `loadMedications` + `loadFoodCatalog`）→ 同一份数据读两遍，还多读了用药与食物目录。

#### 因此 P0-2 的最终方向：并入「方案甲」（详见 §9）

- ❌ 不用"距上次刷新 < N 分钟则不刷"的纯时间节流——用户编辑只花几秒，会被窗口挡住而看不到最新，破坏一致性。
- ❌ 也不用"客户端变更版本号 + `onShow` 跳过"——多端有延迟、各页 `bump` 注入分散难维护（§9.7 否决说明）。
- ✅ 最终采用**方案甲**：**不动 `onShow` 触发时机**，改让"每次刷新按需付费"——读取层 `getDailyRecordV2` 用 `daily_summary_v2` 的 `isDirty` + 版本戳 `rev` 判断当天数据变没变，没变就复用本地明细缓存、不读 6 集合。集中（两个单点）、多端一致、无延迟。
- 附带收益：数据页"精准刷 + `onShow` 全刷"的双读被缓存自然吸收。

---

### 🔴 P0-3　`daily_summary_v2` 缓存只省了"算"，没省"读"

**位置**：`miniprogram/utils/dailyRecordV2Service.js`
- `getDailyRecordV2()`（:311）即使 `cachedSummary.isDirty !== true`，仍**每次并行重读 6 个事件集合**：
  - `loadEventRecords()`（:124）= `feeding_records_v2` + `food_intake_records` + `medication_records` + `treatment_records` + `bowel_records` + `growth_records_v2`。
- `ensureGrowthRecordForDate()`（:255）在缺体重/身高时还会触发 `resolveBasicInfoSnapshot`（额外 1~3 读）+ `upsertGrowthRecordForDate`（写）。

**问题**：首页看板/趋势其实只需要 `summary` 的汇总数值（`macroSummary` / `recordCounts`），不需要逐条原始记录。当前每刷一次看板就把当天约 20 条明细全读出来，缓存对"读次数"形同虚设。逐条明细只在"数据记录页展开当天明细"时才需要。

---

### 🟠 P1-1　首页里重复读取「最近一天喂奶」

**位置**：`miniprogram/models/feedingRecordV2.js`
- `getRecentDayMealCount()`（:370）= `getRecentRecord`(读1) + `getRecordsByDate`(读N)。
- `getRecentDayRecords()`（:379）= `getRecentRecord`(读1，重复) + `getRecordsByDate`(读N，重复)。
- 二者在 `daily-feeding/index.js` `loadDashboard` 的 `Promise.all`（:429）里被同时调用。

**问题**：`getRecentDayMealCount` 完全可由 `getRecentDayRecords` 的 `records.length` 得到，省掉一整组重复查询。

---

### 🟠 P1-2　`getMedications` 重读 `baby_info`，但它已在缓存里

**位置**：`miniprogram/models/medication.js` `getMedications`（:22）
- 通过 `baby_info` 集合 `.where({babyUid}).get()`（:37）读出 `medicationSettings`。

**问题**：`app.globalData.babyInfo` / `wx.getStorageSync('baby_info')` 已缓存该条 `baby_info`，每次看板仍重新读库。

---

### 🟠 P1-3　启动阶段重复查 `baby_creators` / `baby_participants`

**位置**：`miniprogram/app.js`
- `getUserRole()`（:250）查 `baby_creators`，`validateBabyInfoFromDB`（:468）查 `baby_info`，`cacheBabyInfo → resolveBabyCaregiverInfo`（:406）再查 `baby_creators` + `baby_participants`。
- `validateBabyInfo()`（:519）再查 `baby_creators`（+ 可能 `baby_participants`）。
- 页面 `checkUserPermission → app.checkPermission`（:167）又查一遍。

**问题**：角色/权限/协作信息在一次会话内基本不变，却被读 4~6 遍。可会话级缓存，启动只查一次。

---

### 🟠 P1-4　`getRange` 无日期过滤、无 limit

**位置**：`miniprogram/models/dailySummaryV2.js` `getRange`（:100）
```
.where({ babyUid, status: 'active' }).orderBy('date','asc').get()  // 无 date 范围、无 limit
// 拉回后再用 JS filter(date >= start && date <= end)
```
**问题**：应把日期范围下推到 `where`，只取窗口内文档；否则随历史增长读满客户端默认上限（20 条），且语义错误。首页 `loadDashboard` / `loadDeferredDashboardParts` 都会调到它（`dailyRecordV2Service.getDailySummariesForRange`）。

---

### 🟡 P2（小项，顺手做）

- **`getOpenid` 每次冷启动调云函数**（`app.js` `initializeApp → getOpenid` :96）。openid 对同一用户恒定，可缓存到 storage，命中则跳过云函数，省 1 次云函数调用/启动。
- **`markDirty` = 读 + 写两次操作**（`dailySummaryV2.js` `markDirty` :77，先 `getByDate` 再 `update`）。每条记录写入都触发；可改为 `where().update()` 一步完成，或在批量写入时合并多次 `markDirty`。
- **头像 `getTempFileURL`**（`app.js` `resolveBabyAvatarUrl` :363）属存储下载计费，已有 7 天缓存；确认 `onShow` 路径不强制 `forceRefresh`。
- **`feedback-list` 的 `setInterval` 轮询云函数**（`miniprogram/pkg-misc/feedback-list/index.js:75`，仅开发者可见）。开着页面会持续烧云函数调用，建议拉长间隔或离开即停（已有 `onUnload` 停止，但驻留时仍持续）。

---

## 5. 专题：报告页「趋势对照」逻辑详解

### 5.1 概念
- **报告**：MMA 患儿化验报告（血/尿串联、血气、血氨），用户手动录入指标（`models/report.js`、`pkg-report/add-report`）。
- **报告页三视图**：档案 / 详情 / **趋势**（`previewMode`）。
- **趋势对照** = 趋势视图 `buildReportTrendPreview`（`utils/reportWorkbench.js:952`）。

### 5.2 趋势视图的三块内容
| 模块 | 内容 | 需要喂养数据？ |
|---|---|---|
| `compareCards` | 本次 vs 上次同类报告关键指标对比 | 否 |
| `trendMetrics` | 同类型最近 4 次报告指标折线 | 否 |
| `nutritionWindows` + `doctorSummary` | **营养窗口对照**（核心） | 是 |

### 5.3 营养窗口对照在算什么（`resolveTrendContext` :865）
- 区间 = 「上次同类化验日次日 ~ 本次化验日前一天」（`intervalStart~intervalEnd`）。
- 计算区间内**每天的营养系数**（天然蛋白系数、特殊蛋白系数、热卡系数、脂肪/碳水 g/kg/d）并求平均；另算「化验前 7 天」均值。
- 目的：把化验结果与化验前这段时间的实际营养执行并排，判断关联，供门诊沟通（`buildDoctorSummary`）。

### 5.4 数据来源与现状成本
- `loadFeedingWindow`（`analysis-report/index.js:255`）：`daily_summary_v2`（食物 + 体重）+ `feeding_records_v2`（奶）合成每日记录。
- `buildDailyNutritionMetric`（`reportWorkbench.js:576`）：用 `feedings`/`intakes` 逐条**重算**每日营养系数。
- 成本：每次 `onShow` 全量拉 365 + 约 4000 条，只为算几十天均值。

### 5.5 可优化点（精度几乎无损）
- `buildDailyNutritionMetric` 需要的 `naturalProtein / specialProtein / calories / weight / carbs|fat`，**`daily_summary_v2.macroSummary` + `basicInfo.weight` 已现成具备**（首页营养卡即直接读 `macroSummary`）。
- 因此趋势对照可改为：**只读 `daily_summary_v2`**，且**只拉「上次报告 ~ 本次报告」区间**（或固定近 30 天），**不再拉 `feeding_records_v2` 重算**。
- 预计该页单次从「几百~上千读」降到「几十读」。

### 5.6 界面渲染现状与「为什么常看不到系数」（核实结论）
该功能**在 WXML 中确实存在并渲染**：
- 营养窗口卡：`pages/analysis-report/index.wxml:203-223`，每张卡展示 4 行 `metric.label` = **天然蛋白系数 / 特殊蛋白系数 / 热卡系数 / 脂肪(或碳水)**（来源 `reportWorkbench.js:615-620`），分「区间摘要」「近检摘要」两张。
- 区间对比摘要卡：`index.wxml:225-238`（`doctorSummary`）。

但用户实际**常常看不到真实数值**，原因（需满足全部条件才显示非 `--`）：
1. **必须进入趋势视图**：仅 `previewMode === 'trend'` 渲染（`index.wxml:143`）。需在档案页选具体类型 → 「查看本类趋势」，停在「全部」档案页看不到。
2. **易混淆**：趋势上半部分「同类指标趋势」卡右上角的 `trend-overlay` 文案是 **"可结合查看：天然蛋白系数 / 热卡系数"**（`reportWorkbench.js:23`，`index.wxml:191`）——这只是**提示文字**，不是数值；真正的系数数值在下方营养窗口卡。
3. **数据前提，否则显示 `--`**：系数 = 蛋白/体重，体重为 0 直接返回 `--`（`reportWorkbench.js:590-593`）；区间内无喂养记录、当天无体重、或后台 `loadFeedingWindow` 未加载完/静默失败（`index.js` 内 `catch` 仅 `console.warn`），都会导致 `feedingRecordsCache` 为空 → 4 行系数全 `--`。

**优化含义**：`loadFeedingWindow` 的全量拉取（365 + 约 4000）**就是为了喂这两张卡**。若该比对实际用不到/经常 `--`，最划算的做法是**整段移除 `loadFeedingWindow` 与营养窗口卡**，直接消灭报告页最贵的读取路径（比优化更省）。

> **决策（用户 2026-06-23）**：报告页这块**暂不改动**，优先做首页/数据页的 `onShow` 与缓存（P0-2 + P0-3）。报告页 P0-1 留待后续单独评估（删除 vs 改为只读汇总）。

---

## 6. 优化方案与预期收益（分优先级）

| 优先级 | 改动 | 涉及位置 | 预期效果 |
|---|---|---|---|
| **P0-3 + P0-2（方案甲，§9）** | `getDailyRecordV2` 改"按需读取"：读 1 条 summary 探测 `isDirty`/`rev`，没变就复用本地明细缓存、不读 6 集合；**`onShow` 触发时机不动** | `models/dailySummaryV2.js`（加 `rev`）、`utils/dailyRecordV2Service.js`（缓存 + 按需读） | "无变更"刷新 ~22 读 → ~1 读，且多端一致 |
| ~~P0-2（独立）~~ | 原"变更信号 + onShow 跳过"**已否**（§9.7：多端延迟 + 注入分散），由方案甲在读取层统一解决 | — | 见上行 |
| ~~P0-1~~（**暂缓**） | 报告页趋势对照：方案 A 删除 `loadFeedingWindow` + 营养窗口卡；方案 B 改为只读 `daily_summary_v2` + 限定区间/近 30 天。`loadReportData` 改 `onLoad` 一次 + 按需刷新 | `pages/analysis-report`、`utils/reportWorkbench.js` | 单次 400~1000+ → 几十甚至 0 |
| P1-1 | 合并 `getRecentDayRecords` / `getRecentDayMealCount` 为一次 | `models/feedingRecordV2.js`、`pages/daily-feeding` | 省一组重复查询 |
| P1-2 | `getMedications` 优先用缓存的 `babyInfo.medicationSettings` | `models/medication.js` | 每次看板省 1 读 |
| P1-3 | 会话级缓存角色/权限/babyUid，启动只查一次 | `app.js`、各页 `checkUserPermission` | 每次冷启动省 3~5 读 |
| P1-4 | `getRange` 把日期范围下推 `where` + 限定窗口 | `models/dailySummaryV2.js` | 随历史增长不再膨胀 |
| P2 | 缓存 openid；`markDirty` 改一步写；轮询拉长/停止 | `app.js`、`models/dailySummaryV2.js`、`feedback-list` | 零散省量 |

**整体预估**：P0 三项做完，单活跃用户 ~2000+/天 → ~200~400/天（降 80~90%），日活承载 ~3 → ~15~25 人；叠加 P1 可再翻倍。

> 重要：**把读逻辑搬到云函数并不能省额度**——云端读数据库同样按条计费。真正省的是三件事：①用汇总替代逐条读取；②降低 `onShow` 刷新频率；③收紧范围查询返回条数。

---

## 7. 附录：主要数据库读取来源汇总

| 集合 | 主要读取触发点 | 频率 | 备注 |
|---|---|---|---|
| `baby_creators` / `baby_participants` | `app.js` 启动、`checkPermission`、`resolveBabyCaregiverInfo` | 每冷启动多次 | 可会话缓存（P1-3） |
| `baby_info` | `getBabyInfo`、`getMedications`、首页/数据页 | 高 | 多数可走本地缓存（P1-2） |
| `feeding_records_v2` | `getDailyRecordV2`、`getRecentDay*`、报告 `loadV2MilkRecords` | 极高 | 报告页全量拉（P0-1）、看板重复读（P0-3/P1-1） |
| `food_intake_records` | `getDailyRecordV2 → loadEventRecords` | 高 | 缓存命中也重读（P0-3） |
| `medication_records` | `getDailyRecordV2`、用药历史 | 高 | 同上 |
| `treatment_records` / `bowel_records` / `growth_records_v2` | `getDailyRecordV2 → loadEventRecords` | 高 | 同上 |
| `daily_summary_v2` | `getByDate` / `getRange` / 报告 `loadFeedingWindow(365)` | 极高 | 报告页（P0-1）、`getRange` 未限范围（P1-4） |
| `medications` | 首页 `getMedications`、数据页 `loadMedications` | 高 | 每 `onShow` 重读（P0-2） |
| 报告集合（primary + legacy） | `listReportsByBaby(limit 100)` | 中 | 双集合并行，各 100 |
| `food_catalog` / `system_food_catalog_meta` | `loadFoodCatalog` | 中 | 系统索引已本地缓存，仅 meta 校验 |

---

## 8. 下一步

- 本文档仅为分析梳理，**未改动业务代码**。
- 当前位于 `main` 分支。按项目规则，真正实施优化前需**先从当前状态切出工作分支**。
- 实施顺序（按讨论更新）：
  1. **P0-3（核心，推荐方案甲）**：改 `getDailyRecordV2` 为"按需读取"——用 `daily_summary_v2` 的 `isDirty`/`updatedAt` 判断，数据没变就复用本地明细缓存、不读 6 集合（详见 §9）。
  2. **P0-2**：放弃"客户端变更信号 + `onShow` 跳过"路线（多端延迟 + 注入分散，见 §9.4 否决说明）；改为「不动 `onShow` 触发时机、让刷新本身变便宜」，并入方案甲。
  3. P1 系列（`getMedications` 用缓存、合并 `getRecentDay`、`getRange` 限范围）配合方案甲让"每次刷"整体变便宜。
  4. **报告页 P0-1 暂缓**：后续单独评估删除（方案 A）或改只读汇总（方案 B）。
- 报告页相关待办：先确认「营养窗口对照（蛋白/热卡系数）」是否仍要保留——若保留再决定方案 B 的范围口径（近 30 天 / 两次化验区间）。

---

## 9. P0-2 / P0-3 合并方案（方案甲 · 定稿）：让刷新"按需付费"

> 状态：**设计定稿，待实施**。本方案同时覆盖原 P0-3（缓存不省读）与 P0-2（`onShow` 全刷）；**不**再走"客户端版本号 + onShow 跳过"路线（否决原因见 §9.7）。

### 9.1 路线与核心思想
- **不动 `onShow` 触发时机**：从而避免"频率控制"路线的两个毛病——多端延迟、各页分散注入。
- 改造数据访问层 `getDailyRecordV2`：每次先读 **1 条** `daily_summary_v2`，用它的 `isDirty` + 客户端版本戳 `rev` 判断"当天数据自上次以来变没变"——**没变 → 复用本地明细缓存、不读 6 集合；变了（含别端改动）→ 才读 6 集合并刷新缓存**。
- 信号收口在 `markDirty`（写入端）+ `getDailyRecordV2`（读取端）**两个单点**，任何页面都不需要手动通知；每次都读云端最新 `rev`，因此**多端一致、无延迟**。

### 9.2 现状成本根因
`getDailyRecordV2`（:311）无条件并行 `getByDate` + `loadEventRecords`（读 6 集合），缓存干净也照读——这是首页/数据页每次刷新约 20+ 条读的主因。

### 9.3 缓存机制（核心）
- **位置**：`dailyRecordV2Service.js` 模块级 `Map`（单例，首页/数据页共享）。
- **key**：`${babyUid}|${date}`。
- **value**：`{ rev, eventRecords, summary }`。
- **改造后的读取流程**：

```js
async function getDailyRecordV2(babyUid, date) {
  const summary = await getByDate(babyUid, date);          // 只读 1 条（探测）
  const key = `${babyUid}|${date}`;
  const cached = recordCache.get(key);

  // 命中：summary 干净 + 有缓存 + rev 一致 → 不读 6 集合
  if (summary && summary.isDirty !== true
      && cached && summary.rev != null && cached.rev === summary.rev) {
    return { summary, eventRecords: cached.eventRecords };
  }

  // 失效/未命中：才读 6 集合（必要时 rebuild 写回，并刷新 rev）
  const eventRecords = await loadEventRecords(babyUid, date);
  const ensured = await ensureGrowthRecordForDate(babyUid, date, eventRecords);
  const finalSummary = needRebuild(summary, ensured)
      ? await rebuildAndUpsert(babyUid, date, ensured, summary?._id)   // 写：含新 rev
      : summary;
  recordCache.set(key, { rev: finalSummary.rev, eventRecords: ensured, summary: finalSummary });
  return { summary: finalSummary, eventRecords: ensured };
}
```

- **三类时机**：

| 时机 | 判定 | 动作 |
|---|---|---|
| 命中 | `isDirty=false` + 有缓存 + `rev` 一致 | 复用明细，**0 次集合读** |
| 失效 | 任一不满足 | 读 6 集合，必要时 rebuild，**写回缓存** |
| 写回 | 走了"读 6 集合"分支后 | 用最新 `rev` + 明细更新 Map |

### 9.4 版本戳 `rev` 的设计（决定正确性，最关键）
- **为什么不用现成的 `updatedAt`**：它写入时是 `db.serverDate()` 占位对象，读回时是解析后的真实 `Date`，两者**格式不同、无法可靠 `===`**。硬比会"永远命中(用旧数据=bug)"或"永远不命中(白缓存)"。
- **做法（解法①）**：给 `daily_summary_v2` 增加一个**客户端可比对**的数值字段 `rev`：
  - `markDirty` 时：写入 `rev = Date.now()`（连同 `isDirty=true`）。
  - `upsertSummary`（rebuild）时：写入 `rev = Date.now()`。
  - 客户端读回的是普通数字，精确比对，无 serverDate 歧义。
- **旧数据兼容**：老文档无 `rev`（`undefined`）→ 命中判定里 `summary.rev != null` 不成立 → 走"读 6 集合 + rebuild"，rebuild 补上 `rev`，此后该天自然带 `rev`（懒迁移，无需脚本）。
- **多端正确性**：别端写 → 别端 `markDirty` 写入新 `rev` → 本端 `getByDate` 读到新 `rev ≠ cached.rev` → 失效重读。即便别端写后又 rebuild（`isDirty=false`），`rev` 仍是新值 → 本端照样失效重读，**绝不会误用旧缓存**。

### 9.5 自动失效场景（无需任何手动通知）
| 场景 | 为什么会自动刷新 / 跳过 |
|---|---|
| 本端写/删当天 | `markDirty` 置 `isDirty=true` 且换 `rev` → 失配 → 重读 |
| **别端（多端/家庭成员）写** | 云端 `rev` 变 → 本端探测读到新 `rev` → 重读（无延迟、零通知） |
| 子页只读返回 / Tab 来回切（无写） | `rev` 未变 + `isDirty=false` → 命中 → **不读 6 集合** |
| 跨天（过 0 点） | `key` 的 `date` 变 → 无缓存 → 重读 |
| 切换宝宝 / 重新登录 | `key` 的 `babyUid` 变 → 无缓存 → 重读 |
| 冷启动 / 页面重建丢内存缓存 | 无缓存 → 重读一次（正常，无副作用） |
| 设置类改动（用药方案/营养/宝宝信息，不动 summary） | 探测发现不了（局限，见 §9.6）→ 同端保存处主动失效缓存兜底 |

### 9.6 写放大与边界
- **写放大**：只有走"失效"分支且 `needRebuild` 为真时才 `upsertSummary`（写）；命中分支**不写**。沿用现有 `shouldRefreshCachedSummary` 判断，避免每次刷都写。
- **设置类写入的局限**：方案甲只感知"当天记录类"变更。用药方案 / 营养设置 / 宝宝信息这类**低频设置**改动不动 summary，需在对应保存成功处**主动 `recordCache` 失效或更新 `app.globalData.babyInfo`**（数量很少，远比"全量 bump"集中可控）。
- **`onShow` 触发时机不变**：所以"刚编辑完切回看不到最新"绝不会发生——返回时 `isDirty/rev` 已变，必然重读。
- **下拉刷新**：`onPullDownRefresh` 强制失效该 key 缓存后再读，作为多端 / 设置类的人工兜底。

### 9.7 已否方案：客户端变更版本号（频率控制）
- 思路：写入处 `bump` 全局版本号，`onShow` 版本没变就跳过整次刷新。
- **否决原因**：① 多端延迟——本端不知别端写过；② 注入分散——每个写入 / 设置页都要记得 `bump`，易漏难维护、不好控制。方案甲用"读端探测云端 `rev`"同时解决这两点。

### 9.8 消费端影响（首页 / 数据页基本零改动）
- `loadDashboard` / `fetchDailyRecords` 内部调 `getDailyRecordV2`，**自动受益**，逻辑不用动。
- **数据页首次双读**（`onLoad` + 首个 `onShow`）：第一次读 6 集合建缓存，第二次 `rev` 一致 → 命中、几乎 0 集合读，双读被缓存自然吸收。
- **编辑返回双读**（`notifyPreviousPageRefresh` + `onShow`）：精准刷那次因 `rev` 变会读 6 集合刷新缓存，随后 `onShow` 命中跳过——同样被吸收。

### 9.9 分步实施（每步可独立验证 / 回滚）
1. **加 `rev` 字段**：`dailySummaryV2.markDirty` / `upsertSummary` 写入 `rev = Date.now()`（**近乎零行为变化**，只多写一个字段）。
2. **加缓存层 + 改 `getDailyRecordV2` 为按需读**（核心，重点测命中 / 失效 / 多端 / 跨天）。
3. P1-2：`getMedications` 用缓存的 `babyInfo.medicationSettings`。
4. P1-1：合并 `getRecentDayMealCount` 到 `getRecentDayRecords`。
5. P1-4：`getRange` 日期范围下推 + 趋势按需。
- 1、2 是大头；每步独立提交、可回滚。

### 9.10 明确不改动的部分
- `onShow` 触发时机、各编辑页保存 / `navigateBack` / `notifyPreviousPageRefresh` 主体、报告页与我的页 `onShow`。

### 9.11 预期收益
- "数据没变"的刷新（Tab 来回切、只读返回、首次双读的第二次）：约 **20+ 读 → 1 读**（仅探测）。
- "数据变了"的刷新：仍读 6 集合（必要且正确）。
- 叠加 P1-1 / P1-2 / P1-4 后，首页一次"无变更"刷新趋近 **1~3 读**。
