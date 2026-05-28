# 奶粉 v2 数据迁移执行说明

本文档用于把线上旧配奶/喂奶数据复制到 v2 集合。迁移采用“复制新集合，不改旧集合”的方式，旧页面和旧数据仍可回退使用。

## 迁移对象

需要部署并执行三个云函数：

- `migrateNutritionProfiles`：把旧配奶设置复制为 `milk_nutrition_profiles`。
- `migrateFeedingRecordsV2`：把旧 `feeding_records.feedings[]` 拆分复制为 `feeding_records_v2`。
- `backfillGrowthRecordsV2`：把旧身高体重清洗补齐到 `growth_records_v2`。

执行顺序必须是：

1. `migrateNutritionProfiles`
2. `migrateFeedingRecordsV2`
3. `backfillGrowthRecordsV2`

因为喂奶记录迁移需要先读取 `milk_nutrition_profiles` 中的 `普奶` / `特奶` 档案。

## 上线前检查

执行前确认云数据库已存在这些集合：

- `baby_info`
- `nutrition_settings`
- `milk_nutrition_profiles`
- `feeding_records`
- `feeding_records_v2`
- `growth_records_v2`

确认已部署云函数：

- `migrateNutritionProfiles`
- `migrateFeedingRecordsV2`
- `backfillGrowthRecordsV2`

确认当前版本的 v2 页面可以读取：

- 配奶管理 v2：`pages/nutrition-profile-settings/index`
- 喂奶记录 v2：`pages/milk-feeding-editor-v2/index`

## 第一步：配奶档案 dry-run

先选择一个测试宝宝，只预览不写入。

调用云函数：`migrateNutritionProfiles`

参数：

```json
{
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "pageSize": 20
}
```

检查返回值：

- `migrated`：预计会迁移的配奶档案数量。
- `skipped`：跳过的宝宝数量。
- `logs`：应出现目标宝宝的迁移日志。
- `dryRun`：必须是 `true`。

如果 `migrated` 为 0，先检查该宝宝是否已有 `baby_info.nutritionSettings` 或 `nutrition_settings`。

## 第二步：正式迁移配奶档案

确认 dry-run 无误后，仍建议先只跑同一个测试宝宝。

调用云函数：`migrateNutritionProfiles`

参数：

```json
{
  "dryRun": false,
  "babyUid": "替换为测试宝宝 babyUid",
  "pageSize": 20
}
```

执行后在 `milk_nutrition_profiles` 检查：

- 有该 `babyUid` 的文档。
- `formulaPowders` 里旧普奶默认名称是 `普奶`。
- `formulaPowders` 里旧特奶默认名称是 `特奶`。
- `breastMilk.nutritionPer100ml` 有母乳参数。

## 第三步：喂奶记录 dry-run

配奶档案迁移成功后，再预览喂奶记录迁移。

调用云函数：`migrateFeedingRecordsV2`

参数：

```json
{
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 10,
  "maxBatches": 1,
  "offset": 0
}
```

检查返回值：

- `migrated`：预计会复制到 `feeding_records_v2` 的喂奶条数。
- `skipped`：跳过数量，可能包括无喂奶明细、临时记录、无有效奶量的旧记录。
- `existingSkipped`：已迁移过的条数。
- `processedBatches`：本次实际处理的批次数。
- `hasMore`：是否还有下一批历史记录未处理。
- `nextOffset`：下一批继续执行时传入的 `offset`。
- `warnings`：需要人工判断的数据问题。
- `errors`：必须先处理，不能带 error 正式迁移。

如果返回 `missing_milk_nutrition_profile`，说明该宝宝还没有先完成配奶档案迁移。

如果云函数 60 秒超时，不要调大 `pageSize`。改用更小批次：

```json
{
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 5,
  "maxBatches": 1,
  "offset": 0
}
```

如果返回 `hasMore: true`，下一次把 `offset` 改成返回的 `nextOffset` 继续 dry-run。

## 第四步：正式迁移喂奶记录

确认 dry-run 的 `errors` 为空，`warnings` 可接受后执行。

调用云函数：`migrateFeedingRecordsV2`

参数：

```json
{
  "dryRun": false,
  "babyUid": "替换为测试宝宝 babyUid",
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 10,
  "maxBatches": 1,
  "offset": 0
}
```

执行后检查 `feeding_records_v2`：

- 每条记录都有 `source: "legacy_migration"`。
- 每条记录都有 `legacyRecordId`。
- 每条记录都有 `legacyFeedingIndex`。
- 每条记录都有 `migrationVersion: "milk-v2-20260528"`。
- 每条记录的 `date` 是 `YYYY-MM-DD` 字符串，例如 `2026-05-27`，不能是云数据库 Date 类型。
- `formulaComponents` 中普奶/特奶组件保留旧记录的粉量；旧记录缺粉量时才按冲配比例估算。
- `nutritionAccuracy` 默认为 `estimated_current_profile`。

如果返回 `hasMore: true`，继续用返回的 `nextOffset` 执行下一批。使用同一个 `migrationVersion` 重跑不会重复插入已迁移记录。

## 可选：修复已迁移记录的日期类型

如果历史迁移记录中的 `feeding_records_v2.date` 被写成云数据库 Date 类型，页面会按 `YYYY-MM-DD` 字符串查询不到。先部署新版 `migrateFeedingRecordsV2`，再执行修复模式。

先 dry-run：

```json
{
  "repairExistingDates": true,
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 40,
  "maxBatches": 1,
  "offset": 0
}
```

确认返回的 `errors` 为空，并且 `repaired` 是预计要修复的条数后正式执行：

```json
{
  "repairExistingDates": true,
  "dryRun": false,
  "babyUid": "替换为测试宝宝 babyUid",
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 40,
  "maxBatches": 1,
  "offset": 0
}
```

如果返回 `hasMore: true`，继续用返回的 `nextOffset` 作为下一次 `offset`，直到 `hasMore: false`。

## 第五步：回填身高体重到 growth_records_v2

`backfillGrowthRecordsV2` 用于把旧 `feeding_records.basicInfo` 中的身高体重清洗到 `growth_records_v2`。它只写 v2 集合，不修改旧 `feeding_records`。

回填规则：

- 只针对有旧数据记录的业务日期回填，不会无脑铺满日历。
- 当天有真实 `basicInfo` 时，写为 `source: "legacy_feeding_basic_info"`、`carryForward: false`、`sourceDate: 当天日期`。
- 当天没有身高体重时，沿用最近一次可用值，写为 `source: "carry_forward_backfill"`、`carryForward: true`、`sourceDate: 最近真实值日期`。
- 当天已有 `growth_records_v2` 时，不覆盖已有字段，只补空字段。

先 dry-run：

```json
{
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "pageSize": 50,
  "maxBatches": 1,
  "offset": 0,
  "includeBabyInfoInitial": true
}
```

确认 `errors` 为空，并检查：

- `planned`：本批预计新增或补齐的成长记录数。
- `skipped`：日期缺失或不在时间范围内的旧记录数量。
- `nextOffset`：下一批继续传入的 offset。
- `hasMore`：是否还需要继续下一批。

正式执行：

```json
{
  "dryRun": false,
  "babyUid": "替换为测试宝宝 babyUid",
  "pageSize": 50,
  "maxBatches": 1,
  "offset": 0,
  "includeBabyInfoInitial": true
}
```

如果项目存在旧成长记录集合，可以显式传入：

```json
{
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "pageSize": 50,
  "maxBatches": 1,
  "offset": 0,
  "legacyGrowthCollections": ["growth_records"]
}
```

如果返回 `hasMore: true`，继续用返回的 `nextOffset` 作为下一次 `offset`，直到 `hasMore: false`。

## 可选：历史换奶时间段规则

只有用户明确说明“某段时间用旧奶粉，某段时间换成新奶粉”时，才传 `powderVersionRules`。

前提：

- 先在 `milk_nutrition_profiles.formulaPowders` 里创建好历史奶粉档案。
- 记录下每个历史奶粉的 `id`。

示例：

```json
{
  "dryRun": true,
  "babyUid": "替换为测试宝宝 babyUid",
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 20,
  "powderVersionRules": {
    "regular_formula": [
      {
        "id": "regular-old-rule",
        "powderId": "regular_old",
        "startDate": "2026-01-01",
        "endDate": "2026-03-31"
      },
      {
        "id": "regular-current-rule",
        "powderId": "regular_current",
        "startDate": "2026-04-01",
        "endDate": null
      }
    ],
    "special_formula": [
      {
        "id": "special-old-rule",
        "powderId": "special_old",
        "startDate": "2026-01-01",
        "endDate": "2026-02-28"
      },
      {
        "id": "special-current-rule",
        "powderId": "special_current",
        "startDate": "2026-03-01",
        "endDate": null
      }
    ]
  }
}
```

命中规则的迁移记录会标记：

- `nutritionAccuracy: "matched_powder_version_rule"`
- `migrationPowderRules.<category>.matched: true`
- `migrationPowderRules.<category>.ruleId`

没命中规则会回退默认 `普奶` / `特奶`，并在 `warnings` 中返回原因。

## 全量迁移

单宝宝验证完成后，再考虑全量。

配奶档案全量 dry-run：

```json
{
  "dryRun": true,
  "pageSize": 50
}
```

配奶档案全量正式执行：

```json
{
  "dryRun": false,
  "pageSize": 50
}
```

喂奶记录全量 dry-run：

```json
{
  "dryRun": true,
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 20,
  "maxBatches": 1,
  "offset": 0
}
```

喂奶记录全量正式执行：

```json
{
  "dryRun": false,
  "migrationVersion": "milk-v2-20260528",
  "pageSize": 20,
  "maxBatches": 1,
  "offset": 0
}
```

全量喂奶迁移也建议按 `nextOffset` 分批推进，不建议一次跑完整历史。

## 回滚与重复执行

旧集合不会被修改：

- `feeding_records` 不更新、不删除。
- `baby_info` 不更新、不删除。
- `nutrition_settings` 不更新、不删除。

如果 v2 页面有问题，可以先隐藏 v2 入口，继续使用旧入口。

`migrateFeedingRecordsV2` 是按以下字段判断是否已迁移：

- `babyUid`
- `legacyRecordId`
- `legacyFeedingIndex`
- `migrationVersion`

同一个 `migrationVersion` 重复执行不会重复新增同一条历史喂奶记录。

如果确实要重跑一版迁移，应使用新的 `migrationVersion`，并在确认后按旧版本号清理旧迁移数据。

## 风险清单

正式迁移前必须确认：

- dry-run 的 `errors` 为空。
- `warnings` 已人工看过，尤其是 `missing_milk_nutrition_profile`、`empty_formula_components`、`multiple_rules_matched`。
- 新旧汇总页不会同时把同一条旧喂奶和迁移后的 v2 喂奶重复计入。
- 历史换奶用户如果没有提供时间段规则，历史营养值只能标记为按当前档案估算。
- 迁移期间如果用户继续在旧入口新增喂奶记录，需要迁移后再跑一次相同 `migrationVersion` 的增量迁移。

## 推荐执行节奏

1. 部署两个云函数。
2. 选一个测试宝宝跑配奶档案 dry-run。
3. 正式迁移该测试宝宝配奶档案。
4. 跑该测试宝宝喂奶记录 dry-run。
5. 正式迁移该测试宝宝喂奶记录。
6. 打开 v2 页面核对配奶档案、历史喂奶记录、营养汇总。
7. 再扩大到全量 dry-run。
8. 全量正式迁移。
9. 迁移后再跑一次同版本增量，覆盖迁移期间新增的旧记录。
