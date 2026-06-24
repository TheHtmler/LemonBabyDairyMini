# v2 升级收尾：v1 残留清理 + 营养计算收敛方案

> 状态：**分析与计划文档**。基于 2026-06-24 全库只读调查（奶 / 食物 / 营养设置三维度）。
> 用户已确认的前提（2026-06-24）：
> - 奶 v2 迁移（`migrateFeedingRecordsV2` + `backfillGrowthRecordsV2`）已全量执行完成；
> - 食物 v2 迁移（`migrateFoodIntakeRecordsV2`）已全量执行完成；
> - 线上不会再有「未升级到 v2 的旧版本小程序」用户；
> - 不需要保留「回滚到旧配奶设置页」的能力。

---

## 0. TL;DR（结论先行）

- **奶**、**食物**两条升级线的「写入 / 读取 / 汇总」三条主路径**均已切到 v2**，功能层面升级完成。
- **但仍有 3 类 v1 在线上活跃运行，不能无脑删**（详见 §2）：
  1. 历史体重/身高仍从旧集合 `feeding_records.basicInfo` 读取（报告分析、成长曲线）；
  2. 营养设置仍**双写**旧集合 `nutrition_settings`（兼容层）；
  3. `legacyFoodIntakes` UI 是「条件活跃」——它展示的是**无 `mealBatchId` 的 v2 记录**，不是 v1 库里的 intakes。
- 清理分三级：**已完成**（profile 死代码）/ **可删**（迁移工具、迁移云函数、脚本、过时文档/规则、孤儿旧页、`data-records-v2` 死分支）/ **需先迁移再删**（上面 3 类活路径）。
- 营养汇总有**三套实现**，建议收敛为 `buildDailySummaryV2` 单一来源；主体是**零数据写入风险**的读取层重构（详见 §4）。

---

## 1. v2 升级完成度（按维度核实）

| 升级线 | 写入 | 读取/展示 | 汇总（daily_summary_v2） | 结论 |
|---|---|---|---|---|
| **奶** | ✅ `feeding_records_v2`（`models/feedingRecordV2.js:230-276`） | ✅ v2（`data-records-v2/index.js:3634-3637`、首页 `DailyRecordV2Service`） | ✅ v2（`dailyRecordV2Service.js:133`、`rebuildDailySummaryV2/index.js:402`） | 主路径完全升级 |
| **食物** | ✅ `food_intake_records`（`meal-editor/index.js:1185`） | ✅ v2（`FoodIntakeRecordModel.findByDate`） | ✅ v2（`dailyRecordV2Service.js:134`，`usesLegacyFoodIntakes:false`；`rebuildDailySummaryV2/index.js:403`） | 主路径完全升级 |
| **营养设置** | ⚠️ 主写 `milk_nutrition_profiles`，**仍双写旧 `nutrition_settings`**（`models/nutrition.js:233-271`） | ✅ 新档案（`includeLegacyFallback:false`） | — | 主路径 v2，兼容层仍活 |

关键证据：`data-records-v2/index.js:6394` 固定 `Page(createDataRecordsPageConfig({ recordSource: 'v2' }))`，`isV2RecordsSource()`（:3315-3317）恒为 `true`，因此页面内所有 `if (!isV2RecordsSource())` / legacy `fetchDailyRecords` 分支均为不可达死代码。

---

## 2. 仍在线上活跃的 v1 残留（删前必须先迁移/改造）

| # | 残留 | 位置 | 影响 | 处置方向 |
|---|---|---|---|---|
| 1 | 历史体重/身高读旧集合 | `pkg-report/data-analysis/index.js:1148`、`pkg-records/growth-records/index.js:268` 读 `feeding_records.basicInfo` | 删 `feeding_records` 依赖会导致老用户体重曲线出现历史缺口 | 先把历史体重统一到 `growth_records_v2` + `daily_summary_v2.basicInfo`，再撤掉 v1 读 |
| 2 | `nutrition_settings` 双写兼容层 | `models/nutrition.js`（`updateNutritionSettings` 双写）、`models/nutritionProfile.js` 的 `includeLegacyFallback` | `nutrition.js` 被 data-analysis / analysis-report / data-records-v2 引用，属活路径 | 确认所有宝宝已有 `milk_nutrition_profiles` 后，改为只读/只写 v2，去掉双写与 fallback |
| 3 | `legacyFoodIntakes` 条件活跃 UI | `data-records-v2/index.js:957`（`getLegacyFoodIntakes`）、`index.wxml:246-259` | 展示「无 `mealBatchId` 的 v2 记录」，非 v1 intakes；若库里存在无餐次 v2 记录，删 UI 会让用户失去其编辑/删除入口 | 先确认库内无 `mealBatchId:''` 的 active `food_intake_records`（或为其补 batch），再删该 UI 与编辑链 |

> 注：单条食物写入 `saveFoodIntake`（`data-records-v2/index.js:2502+`）会产出**无 `mealBatchId`** 的 v2 记录，是 #3「无餐次记录」的来源之一，清理时需一并评估。

---

## 3. v1 清理清单

### 3.1 已完成（本次，零风险纯死代码）

- ✅ `pages/profile/index.js`：删除被覆盖的第一个 `handleMenuClick`（含对未定义 `handleMigration()` 的调用）。
- ✅ `pages/profile/index.wxml`：移除 `migration-item` class 绑定（menuList 中已无 `action:'migration'` 项）。
- ✅ `pages/profile/index.wxss`：删除 `.migration-item` 相关样式。

### 3.2 可删（前提已满足，待执行 —— 建议分批、每批跑测试）

**迁移工具 / 入口**
- `pages/milk-migration-tool/`（文件头自注「临时·上线前删除」，无 UI 入口）+ `app.json` 注册
- `pages/meal-editor-v2/`（纯 `redirectTo` 兼容层）+ `app.json` 注册 —— 确认无外部旧分享链接后删
- 孤儿旧页 `pkg-milk/nutrition-settings/` + `app.json` 注册 —— 需同步修改 `tests/nutrition-profile-settings-entry.test.js`、`tests/nutrition-settings-formula-powders.test.js`（去掉「旧页存在」断言）

**一次性迁移云函数**（`cloudfunctions/`）
- `migrateFeedingRecordsV2`、`migrateFoodIntakeRecordsV2`、`migrateNutritionProfiles`、`migrateNutritionSettings`、`backfillGrowthRecordsV2`
- `migrateProteinQuality`、`migrateFoodType` —— 需先确认 `food_catalog` 对应字段已全量写入

**迁移脚本 / 配置**
- `scripts/run-milk-v2-migration.js`、`scripts/milk-v2-migration-wx-console.js`、`scripts/lib/milk-v2-migration-cli.js`、`scripts/milk-v2-migration.env.example`
- `package.json` 的 `migrate:milk-v2` / `migrate:milk-v2:execute`（删后确认 `@cloudbase/node-sdk` devDep 是否还有其他用途）

**过时文档 / 规则**（建议归档到 `docs/archive/` 而非硬删）
- `docs/miniprogram/milk-v2-launch-playbook.md`、`docs/miniprogram/milk-v2-migration-runbook.md`
- `.cursor/rules/daily-summary-v2-food-cleanup.mdc`（过渡期提醒，内容已与现状不符）
- `README.md` 中「feeding_records 为主 + 兼容表」的 v1 数据模型描述需更新

**`data-records-v2/index.js` 死分支**（最大块，建议单独 PR、逐块删、强测试护栏）
- legacy 整段 `fetchDailyRecords`（约 `:3640-3840`）、`loadLegacyDailyRecordResult`、`mergeV2FeedingWithLegacySecondaryData`（无调用）
- 死弹窗链：`showAddFeedingModal` / `saveNewFeeding` / `openEditFeedingModal` / `saveEditedFeeding`（对应 WXML `:475-488`、`:628-641`）
- legacy 删除分支：`:1797-1823`、`:2438-2462`、`deleteLegacyFoodIntakes`（`:2375-2401`，无调用）
- `utils/feedingRecordStore.js`（整文件，调用链全在死分支）
- `utils/dailyRecordV2Service.js` 的 `loadLegacyFoodIntakes` / `extractLegacyFoodIntakes`（已 export、无调用）
- `meal-editor/index.js` 的 `getMergedDayRecord`（`:967-991`，无调用）
- 关联测试需随之调整：`tests/migrate-*.test.js`、`tests/backfill-growth-records-v2.test.js`、`tests/milk-v2-migration-script.test.js`（**勿删** `tests/rebuild-daily-summary-v2.test.js`）

### 3.3 删除前提（已由用户确认 ✅）

- ✅ 奶/食物 v2 数据已全量迁移；
- ✅ 无未升级旧版本小程序用户；
- ✅ 无需保留旧配奶页 rollback。
- ⏳ 建议补做一次：抽查云端 `feeding_records.intakes` 是否仍有未进 `food_intake_records` 的食物（orphan 检查）；按日期范围 dry-run 一次 `rebuildDailySummaryV2` 确认历史汇总口径已是纯 v2。

### 3.4 应保留（运维 / 活路径，勿删）

- 云函数：`rebuildDailySummaryV2`（运维重建，非一次性）、`cleanFeedingRecords`（数据修复）、`migrateSystemFoods`（系统食物库灌库）、`accountCleanup`（注销清理，仍需删 `nutrition_settings` 数据）
- `models/nutritionProfile.js`（v2 权威模型）、`models/nutrition.js`（精简后保留 normalize / 默认值）
- `docs/cloud-usage-optimization.md`（运维分析，非迁移手册）、`.cursor/rules/.cursorrules`（项目主规则）
- §2 的三类活路径，迁移改造完成前保留

---

## 4. 营养 / 汇总计算收敛方案

### 4.1 三套实现现状

| 实现 | 位置 | 角色 |
|---|---|---|
| 权威 | `dailySummaryV2Utils.js` `buildDailySummaryV2`（:447）→ `buildMacroSummary`（:399） | 写入 `daily_summary_v2` 的标准算法（奶/食物均用快照） |
| 页面本地 | `data-records-v2/index.js` `calculateMacroSummary`（:970）+ `calculateIntakeOverview`（:379） | 数据页本地算/兜底（v2 奶记录经 `calculateMilkNutrition` 也走快照，:240-254） |
| 报告 | `reportWorkbench.js` `calculateMacroSummary`（:397） | 报告趋势逐日重算（含 `premiumProtein/regularProtein` 维度） |

### 4.2 真实不一致风险（经核实，v2 奶记录三套均用快照，配奶参数变更不会致奶量漂移）

1. **食物蛋白「天然/特殊」拆分兜底逻辑不同**：权威用 `resolveFoodProteinSplit`（`dailySummaryV2Utils.js:226`），页面用 `typeof intake.naturalProtein === 'number'` + `proteinSource`。仅在字段缺失的老数据上结果可能不同。
2. **`premiumProtein/regularProtein` 仅报告页有**：权威源不产出，导致报告页只能另算一套。
3. **删除/编辑后局部乐观刷新用本地算法**（`data-records-v2/index.js:1798`、`:2440`），短暂与库内权威汇总不一致，直到下次完整刷新对齐。
4. **最现实的是「演进漂移」**：三套并存，改一处算法易漏改其他，页面间口径长期偏移（维护性风险）。

### 4.3 收敛方案

- 目标：**`buildDailySummaryV2` 为唯一计算源，所有展示数字从 `daily_summary_v2` 派生。**
- 抽公共底层到共享 util（如 `utils/nutritionMath.js`），三处 import 同一份。
- 报告趋势改为只读 `daily_summary_v2.macroSummary`，删 `reportWorkbench` 逐日重算（与 `cloud-usage-optimization.md` 省调用次数方向一致）。若保留优质蛋白维度，把 `premiumProtein` 加进权威 `buildMacroSummary` 统一产出。
- 数据页删除/编辑后改为 `markDirty` + 走 service 重读，不再本地重算覆盖。
- `calculateIntakeOverview`（分组明细）如需保留，复用共享底层函数保证口径一致。

### 4.4 数据风险分级（"能不碰线上数据就不碰"）

- **🟢 A 类（零线上数据写入风险）**：抽公共函数、报告页改只读 summary、数据页删除后走 service 重读。只改读取/展示，有测试护栏，可灰度可回滚。**收敛主体属此类。**
- **🟠 B 类（写/重建 summary，需谨慎）**：给 `buildMacroSummary` 加 `premiumProtein` 字段（向后兼容，低风险）；**全量 rebuild `daily_summary_v2`**（覆盖文档，需 dry-run + 按 babyUid/日期分批 + 备份；`rebuildDailySummaryV2` 已支持 dry-run）。
- **🔴 C 类（改写入逻辑 / 删 legacy 集合，本次避免）**：计算收敛不应碰写入路径；删 `feeding_records` 集合数据放到最后单独评估。

### 4.5 改前清单

1. 确认迁移完成（§3.3）；2. dry-run 全量 rebuild 看新旧口径差异；3. 先做 A 类读取层、跑全套测试；4. 自己账号灰度，肉眼核对首页/数据页/报告页同一天数字一致；5. B/C 类另行评估。

---

## 5. 建议执行顺序

1. ✅ **本次**：profile 死代码清理 + 本文档。
2. **第二批（低风险删除）**：迁移工具页 / 迁移云函数 / 脚本 / 过时文档规则 / 孤儿旧营养页（同步改测试）。删前补做 orphan 检查 + dry-run rebuild。
3. **第三批（中风险）**：`data-records-v2` legacy 死分支 + `feedingRecordStore` + service legacy 函数（单独 PR、逐块删、强测试）。
4. **第四批（需先迁移）**：§2 三类活路径——历史体重统一到 v2、去 `nutrition_settings` 双写、清理 `legacyFoodIntakes` UI。
5. **并入调用次数优化**：营养计算收敛（§4）与 `cloud-usage-optimization.md` 方案甲一起做。
