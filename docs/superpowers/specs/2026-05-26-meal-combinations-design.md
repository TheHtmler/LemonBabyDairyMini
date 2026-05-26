# 菜谱与本顿实际摄入比例设计

## 背景

当前 v2 食物记录已经从旧的 `feeding_records.intakes` 拆出到 `food_intake_records`，并通过 `mealBatchId` 表达同一顿里的多项食物。`meal-editor-v2` 支持逐个添加食物和份量，但常见场景里，同一组食物会反复出现，例如“米粉 + 苹果泥 + 牛油果”。每次都重新选择食物和输入份量，会增加重复操作。

同时，宝宝实际吃完的量常常不是准备量。用户希望保存本顿时记录“吃了多少百分比”，默认 `100%`。如果本顿吃了 `50%`，当天热量、蛋白、碳水、脂肪等汇总指标应按本顿总量的 `50%` 计入，但历史记录仍能看出原本准备了哪些食物和份量。

## 目标

- UI 功能名统一为“菜谱”。
- 支持把一组固定食物及其默认份量保存为菜谱。
- 添加本顿食物时，可以从菜谱一键加入多项食物。
- 从菜谱加入后，仍允许编辑单项食物份量、删除单项食物或继续添加其他食物。
- 保存本顿时支持 `completionPercent`，默认 `100`。
- 历史记录保留计划份量和计划营养，实际汇总按完成比例计算。
- v2 食物继续写入 `food_intake_records`，不回写旧 `feeding_records`。

## 非目标

- 不实现真正的“食谱步骤”、制作说明或烹饪流程。
- 不迁移旧版 `feeding_records.intakes` 中的历史餐次为菜谱。
- 不把菜谱做成新的食物库条目。菜谱是食物搭配模板，不是单个食物。
- 不改变 `food_catalog` 的营养字段定义。
- 不改变奶类记录和治疗记录的汇总口径。

## 命名

### 面向用户

- 一级入口或页面标题：`菜谱`
- 添加入口：`从菜谱添加`
- 保存入口：`保存为菜谱`
- 空状态文案：`把常吃的一组食物和份量保存下来，下次一键加入本顿`

### 内部命名

- 集合：`meal_combinations`
- 模型：`MealCombinationModel`
- 页面状态：`mealCombinations`、`selectedCombinationId`
- 食物记录来源字段：`mealCombinationSource`

使用“菜谱”作为对外名称，是为了让用户更容易理解这是一份可复用的食物搭配模板；底层仍沿用 `meal_combinations` 数据结构，避免迁移成本。

## 用户流程

### 创建菜谱

入口建议放在 `meal-editor-v2`，因为用户通常是在搭好一顿饭之后才意识到“以后还会这样吃”。

1. 用户在本顿中添加多个食物并输入份量。
2. 点击 `保存为菜谱`。
3. 输入菜谱名称，例如 `上午米粉菜谱`。
4. 系统把当前本顿的食物、默认份量、单位、食物快照保存为一个菜谱。
5. 当前本顿不因保存菜谱而自动保存为历史记录，两个动作保持独立。

后续可以在单独的 `菜谱` 管理页支持新增、编辑、删除。本期可以先在 `meal-editor-v2` 内完成最小闭环。

### 从菜谱添加

1. 用户进入 `meal-editor-v2`。
2. 点击 `从菜谱添加`。
3. 选择一个菜谱。
4. 系统把菜谱内的所有食物加入当前 `mealDraft.items`。
5. 如果当前本顿已有食物，不覆盖，追加到当前列表。
6. 用户可以继续编辑单项份量或删除单项食物。

### 保存本顿

1. `completionPercent` 默认为 `100`。
2. 用户可把本顿改为 `50`、`80` 等百分比。
3. 保存时每条食物记录都写入同一个 `mealBatchId` 和同一个 `completionPercent`。
4. 每条记录保留计划值，同时把实际值写入当前汇总使用的字段。

## 数据模型

### `meal_combinations`

```js
{
  schemaVersion: 1,
  recordType: 'meal_combination',
  status: 'active',

  babyUid: 'baby_xxx',
  name: '上午米粉菜谱',
  description: '',
  tags: ['早餐'],

  items: [
    {
      foodId: 'food_xxx',
      foodName: '米粉',
      foodSnapshot: {
        name: '米粉',
        category: 'grain',
        proteinSource: 'natural',
        nutritionPerUnit: {
          calories: 360,
          protein: 7,
          fat: 1,
          carbs: 80,
          fiber: 2,
          sodium: 0
        },
        baseQuantity: 100,
        baseUnit: 'g'
      },
      plannedQuantity: 20,
      unit: 'g',
      sortOrder: 0,
      notes: ''
    }
  ],

  usageCount: 0,
  lastUsedAt: null,
  createdBy: 'openid_xxx',
  createdAt: db.serverDate(),
  updatedAt: db.serverDate()
}
```

菜谱只保存默认计划，不保存 `completionPercent`。吃完比例属于某一次真实餐次，不属于模板。

从菜谱添加到本顿时，优先使用当前 `food_catalog` 中同 `foodId` 的最新食物数据来计算计划营养；如果食物已被删除或当前宝宝不可见，则使用 `foodSnapshot` 作为回退。快照必须至少包含 `baseQuantity`、`baseUnit` 和 `nutritionPerUnit`，这样脱离食物库后仍能还原默认份量和营养预览。

### `food_intake_records` 扩展

现有记录继续保留 `quantity` 和 `nutrition` 作为实际摄入值，因为 `dailySummaryV2Utils.mergeFoodNutrition()` 已经按这些字段汇总。新增计划字段用于回看和编辑。

```js
{
  // existing fields
  quantity: 10,
  nutrition: {
    calories: 36,
    protein: 0.7,
    naturalProtein: 0.7,
    specialProtein: 0,
    fat: 0.1,
    carbs: 8,
    fiber: 0.2
  },

  // new fields
  plannedQuantity: 20,
  plannedNutrition: {
    calories: 72,
    protein: 1.4,
    naturalProtein: 1.4,
    specialProtein: 0,
    fat: 0.2,
    carbs: 16,
    fiber: 0.4
  },
  completionPercent: 50,
  mealCombinationSource: {
    combinationId: 'combo_xxx',
    combinationName: '上午米粉菜谱'
  }
}
```

这个设计让现有日汇总逻辑保持稳定：实际吃进去多少，`quantity` 和 `nutrition` 就是多少。计划值只用于展示和编辑，不参与汇总。

## 计算规则

### 单项计划营养

仍使用现有 `FoodModel.calculateNutrition(food, plannedQuantity)`。

### 本顿实际摄入

保存时按本顿完成比例统一缩放每个食物：

```js
factor = completionPercent / 100
quantity = plannedQuantity * factor
nutrition[key] = plannedNutrition[key] * factor
```

存储字段不要过早把热量舍入为整数。保存 `food_intake_records.nutrition` 时，热量、蛋白、碳水、脂肪、纤维都保留 2 位小数；`daily_summary_v2` 汇总后再按页面展示规则显示。这样多食物餐次在 `50%`、`75%` 等比例下不会因为逐项整数舍入产生明显累计偏差。

公开展示数值延续当前精度：

- 热量：页面展示为整数 kcal
- 蛋白、天然蛋白、特殊蛋白、碳水、脂肪、纤维：保留 2 位小数

### 编辑已有餐次

编辑已有 v2 餐次时：

- 优先用 `plannedQuantity` 和 `plannedNutrition` 还原编辑界面。
- 从同一 `mealBatchId` 下的记录恢复 `completionPercent`。正常情况下同一顿所有记录的比例一致。
- 如果同一 `mealBatchId` 下出现多个不同的 `completionPercent`，页面使用第一条有效记录的比例，并在保存时统一重写为当前页面比例。
- 如果旧记录没有计划字段，则用当前 `quantity` 和 `nutrition` 作为计划值，`completionPercent` 默认为 `100`。
- 用户修改单项计划份量后，重新计算该项 `plannedNutrition`，再按当前 `completionPercent` 计算实际 `quantity` 和 `nutrition`。
- 保存后重写该 `mealBatchId` 下的记录，并标记 `daily_summary_v2` dirty。

### 展示口径

本顿编辑页建议同时展示两层信息：

- `准备量`：按计划份量合计。
- `实际计入`：按完成比例缩放后的合计。

数据记录页列表建议优先简洁展示：

- `吃了 50% · 实际 36 kcal · 蛋白 0.7g`
- 可在详情或次要文案里显示：`准备 20g，实际按 10g 计入`

`data-records` 的 v2 转换层需要透传 `plannedQuantity`、`plannedNutrition`、`completionPercent` 和 `mealCombinationSource`。这些字段不参与汇总，但用于列表、编辑跳转和后续详情展示。

## 页面改动建议

### `meal-editor-v2`

新增状态：

- `completionPercent: 100`
- `plannedMealSummary`
- `actualMealSummary`
- `mealCombinations`
- `combinationDrawerVisible`

新增入口：

- 餐次设置区增加 `吃完比例` 输入或快捷按钮：`100%`、`75%`、`50%`、`自定义`
- 本顿食物区增加 `从菜谱添加`
- 本顿食物区或备注区附近增加 `保存为菜谱`

保存本顿时：

- `mealDraft.items` 存计划值。
- `buildV2FoodIntakePayload()` 负责把计划值和 `completionPercent` 转成实际写入值。
- `saveV2Meal()` 继续写 `food_intake_records` 并标记 `daily_summary_v2` dirty。

### 菜谱管理

本期最小闭环可以只做选择和从当前餐次保存。若需要完整管理页，建议新增：

- `pages/meal-combinations/index`

页面能力：

- 查看所有菜谱。
- 编辑菜谱名称。
- 删除菜谱。
- 查看菜谱内食物和份量。

如果控制本期范围，可以先不做完整管理页，只在选择抽屉里提供删除按钮。

## 模型与工具

### 新增 `miniprogram/models/mealCombination.js`

导出：

```js
module.exports = {
  createMealCombination,
  updateMealCombination,
  deleteMealCombination,
  findByBaby,
  incrementUsage,
  normalizeMealCombination
};
```

### 新增纯函数

建议在 `meal-editor-v2` 附近或独立工具中沉淀：

- `calculateActualMealItems(items, completionPercent)`
- `scaleNutrition(nutrition, factor)`
- `buildMealCombinationFromDraft(mealDraft)`
- `buildMealItemsFromCombination(combination, foodCatalog)`

这些函数应覆盖单元测试，避免比例计算分散在页面事件里。

## 测试计划

新增测试：

- `tests/meal-combination-model.test.js`
  - 创建、更新、删除、按宝宝读取菜谱。
  - 归一化菜谱内食物快照和默认份量。
- `tests/meal-editor-v2-combinations.test.js`
  - 从菜谱添加多项食物到当前本顿。
  - 从当前本顿保存为菜谱。
  - 菜谱添加不会覆盖已有食物。
- `tests/meal-editor-v2-completion-percent.test.js`
  - 默认 `100%` 时实际值等于计划值。
  - `50%` 时 `quantity` 和 `nutrition` 按比例保存。
  - 计划字段保留原始份量和营养。
  - 编辑旧记录缺少计划字段时按 `100%` 兼容。
  - 编辑已有带 `completionPercent` 的 v2 餐次时能恢复比例和计划值。
  - 完成比例边界值校验：拒绝空值、`0`、负数和大于 `100` 的值。
  - 多食物餐次按比例保存时，存储热量保留 2 位小数，汇总后再展示为整数。
- 扩展 `tests/data-records-v2-food-intakes.test.js`
  - v2 数据记录页透传并展示 `plannedQuantity`、`plannedNutrition`、`completionPercent` 和 `mealCombinationSource`。
- 扩展 `tests/daily-summary-v2-utils.test.js`
  - 汇总继续使用实际 `nutrition`，不使用 `plannedNutrition`。

验证命令：

```bash
node --test tests/meal-combination-model.test.js
node --test tests/meal-editor-v2-combinations.test.js
node --test tests/meal-editor-v2-completion-percent.test.js
node --test tests/data-records-v2-food-intakes.test.js
node --test tests/daily-summary-v2-utils.test.js
```

## Rollout

1. 先加 `meal_combinations` 模型和测试。
2. 在 `meal-editor-v2` 加完成比例，确保现有保存路径仍通过测试。
3. 加从菜谱添加和保存为菜谱。
4. 加数据记录页的完成比例展示。
5. 手动验证一顿包含多项食物、吃完 `50%` 后，日汇总只计入实际摄入。

## Open Questions

- 是否需要独立的菜谱管理页，还是先只在 `meal-editor-v2` 里完成选择、保存、删除？
- 完成比例是否只允许 `0-100`，还是允许超过 `100` 用来表达“又加吃了一些”？本期建议限制 `1-100`。
- 从菜谱添加时，如果当前本顿已有同一个食物，是否合并份量？本期建议不合并，直接追加，避免自动合并造成误解。
