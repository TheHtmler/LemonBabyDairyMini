# 食谱目录（成品菜）设计

## 背景

现有能力已覆盖：

- `food_catalog`：系统库 / 我的食物库
- `meal-editor` + `food-picker`：本顿多食物录入
- `food_intake_records` → `daily_summary_v2.food`：辅食营养汇总

缺口是「成品菜」：例如番茄炒蛋，由番茄、鸡蛋、油、盐等原料按份量组成，用户填写出锅/成品总重后得到每 100g 营养；记本顿时选择该成品并填写本次食用克数，按比例计入汇总。

历史上曾有两套半成品概念：

- 已回滚的 `recipe_catalog` / recipe-management（2026-04）
- `meal_combinations`「菜谱组合」与 `mealCombinationSource`（2026-05）；当前 **无 CRUD、无管理页**，`models/mealCombination.js` 为空壳，仅残留 intake 字段归一化与 `data-records-v2` 展示分组逻辑

本期以新的独立食谱模块落地，并 **删除旧 meal_combination / 旧菜谱残留逻辑**。

## 目标

- 与「食物管理」平级提供「食谱管理」（独立集合、独立页面）
- 创建食谱：从 `food_catalog` 选原料 + 份量 + **成品总重** → 计算并保存每 100g 营养
- 记本顿：添加时先分流「食物 / 食谱」，进入对应页面；选食谱成品后填本次食用克数
- 一条 intake 表示一份成品；日汇总继续只消费最终 `nutrition`
- 清理 `meal_combinations` / `mealCombinationSource` 相关死代码与测试桩

## 非目标（一期不做，但见「扩展口子」）

- 不把食谱同步生成/写入 `food_catalog`
- **一期不做**烹饪步骤、多步骤流程的录入与展示（数据与页面预留扩展位，见下文）
- 不做系统预置食谱库
- 不做「从本顿一键存为食谱」（可二期）
- 不把本顿按比例拆成多条原料 intake
- 不迁移或回填历史 `mealCombinationSource` 数据（有则忽略，展示不再依赖）

## 命名

| 面向用户 | 内部 |
|---------|------|
| 食谱 / 食谱管理 | `recipe_catalog`、`RecipeModel` |
| 添加时的「食谱」模块 | `recipe-picker` |
| 来源文案：来自食谱：xxx | `recipeSource` |

不使用「菜谱」「meal_combination」作为新功能对外或对内主命名。

## 架构概览

```
食物管理 (food_catalog)     食谱管理 (recipe_catalog)   [我的 · 平级入口]
         │                            │
         │ 原料引用                    │ 成品浓度
         ▼                            ▼
              meal-editor
                   │
         添加 → 分流弹层（食物 | 食谱）
                   │
          ┌────────┴────────┐
          ▼                 ▼
     food-picker      recipe-picker
          │                 │
          └────────┬────────┘
                   ▼
         food_intake_records
                   │
                   ▼
          daily_summary_v2.food
```

## 数据模型

### `recipe_catalog`

```js
{
  schemaVersion: 1,
  recordType: 'recipe',
  status: 'active', // active | deleted
  babyUid: '',
  name: '番茄炒蛋',
  notes: '',
  yieldWeightG: 200, // 成品总重（g），营养浓度分母
  // —— 制作过程扩展位（一期默认空，读写兼容，UI 不展示）——
  steps: [
    // 二期示例，一期恒为 []
    // { sortOrder: 0, text: '热锅少油', imageFileId: '', durationSec: null }
  ],
  coverImageFileId: '', // 预留封面；一期不采集
  prepTimeSec: null,    // 预留备菜/总耗时；一期不采集
  ingredients: [
    {
      foodId: '',
      foodName: '番茄',
      quantity: 100,
      unit: 'g',
      sortOrder: 0,
      foodSnapshot: {}, // FoodModel.buildFoodSnapshot
      nutrition: {
        calories: 0,
        protein: 0,
        naturalProtein: 0,
        specialProtein: 0,
        fat: 0,
        carbs: 0,
        fiber: 0,
        sodium: 0
      }
    }
  ],
  totalNutrition: { /* 同上，Σ ingredients.nutrition */ },
  nutritionPer100g: { /* totalNutrition / yieldWeightG * 100 */ },
  proteinSource: 'natural', // natural | special | mixed
  usageCount: 0,
  lastUsedAt: null
  // + 标准审计字段
}
```

### 计算规则

1. 每条原料：`FoodModel.calculateNutrition(food, quantity)`，并按原料 `proteinSource` 拆分 `naturalProtein` / `specialProtein`（与 `meal-editor` 一致）。
2. `totalNutrition = Σ ingredients.nutrition`。
3. `yieldWeightG > 0` 必填；不强制等于原料克数之和（允许失水等）；若与原料重量和差异很大，可弱提示但不拦截。
4. `nutritionPer100g[k] = totalNutrition[k] / yieldWeightG * 100`（存库保留 2 位小数）。
5. 本顿食用 `ateG`：`nutrition[k] = nutritionPer100g[k] * ateG / 100`。
6. `proteinSource`：若 `naturalProtein` 与 `specialProtein` 均 > 0 则为 `mixed`；仅特殊为 `special`；否则 `natural`。

### `food_intake_records`（食谱成品一条）

```js
{
  foodId: '', // 食谱成品不对应 food_catalog；保持空字符串
  foodName: '番茄炒蛋',
  quantity: 60,
  unit: 'g',
  nutrition: { /* 按 ateG 算出的实际摄入 */ },
  // 顶层判别：普通食物用既有值（如 manual_food）；食谱成品固定 'recipe'
  // 不要把 'recipe' 写入 foodSnapshot.sourceType（该字段仅表示食物库来源：system / user_custom / user_override）
  sourceType: 'recipe',
  foodSnapshot: {
    name: '番茄炒蛋',
    category: '食谱成品',
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { /* 保存当时的 nutritionPer100g */ },
    proteinSource: 'natural' | 'special' | 'mixed'
    // 故意省略 sourceType，避免与食物库语义冲突
  },
  recipeSource: {
    recipeId: '',
    recipeName: '番茄炒蛋',
    yieldWeightG: 200,
    ingredientsSnapshot: [
      { foodName, quantity, unit, nutrition }
    ]
  },
  mealBatchId: '', // 与同顿其他项共用
  // 不再写入 mealCombinationSource
}
```

展示与编辑一律以顶层 `sourceType === 'recipe'`（或存在合法 `recipeSource.recipeId`）识别食谱成品。

本顿草稿中食谱行使用稳定 `localId`（或等价客户端键）标识，**禁止**按空 `foodId` 去重或回查 `food_catalog`。

日汇总路径不变：`food_intake_records.nutrition` → `mergeFoodNutrition` → `daily_summary_v2.food`。食谱 **不另开汇总通道**。

### 原料单位与成品总重

- 原料 `unit` 跟随食物库（允许 `g` / `ml` 等）；营养仍按该食物的 `nutritionBasis` 换算。
- `yieldWeightG` 与本顿食用克数 **始终以克** 计。
- 「与原料重量和差异很大」的弱提示：仅当全部原料 `unit === 'g'` 时，用原料克数之和与 `yieldWeightG` 比较；存在非 `g` 单位时跳过该提示，不拦截保存。

### 扩展口子：制作过程（二期+）

一期页面仍是「配方计算器」：原料 + 成品总重 + 营养。为避免二期大改模型/布局，约定：

1. **数据**：`recipe_catalog` 一期即写入并读回 `steps: []`、`coverImageFileId: ''`、`prepTimeSec: null`；Model normalize 时缺省补齐，旧文档无字段视为空。
2. **营养无关**：`steps` / 封面 / 耗时 **不参与** `totalNutrition` / `nutritionPer100g` / 本顿摄入计算；以后加步骤也不会改变汇总口径。
3. **页面结构**（新建/编辑/详情同一信息架构）：
   - 区块 A：基本信息（名称、备注）
   - 区块 B：原料与成品总重 + 营养预览（一期核心）
   - 区块 C：**制作过程**（一期隐藏或占位折叠「即将支持」；二期在此挂步骤列表/图文，无需重排营养区块）
4. **详情 vs 本顿**：制作过程只出现在食谱管理/详情；`recipe-picker` 与 intake 快照一期仍只带营养相关字段；二期若要在历史展开做法，再决定是否把 `steps` 快照进 `recipeSource`（默认不必进汇总链路）。
5. **schemaVersion**：制作过程字段扩充时优先加可选字段；仅在不兼容时再升 `schemaVersion`。

## 用户流程

### 食谱管理（平级入口）

- 「我的」与「食物管理」平级增加「食谱管理」
- 路径：`/pkg-records/recipe-management/index`
- 列表：名称、原料数、成品总重、每 100g 蛋白/热量、最近使用
- 新建/编辑：名称、备注、添加原料（只进食物库）、原料份量、成品总重、实时预览总营养与每 100g；页面预留「制作过程」区块位（一期不实现录入）
- 详情：原料表 + 营养汇总为主；制作过程区块一期可隐藏
- 删除：软删；选食器不再展示；历史 intake 靠快照

### 本顿添加（分流弹层，避免深层 Tab）

点「添加」时先弹层两个大模块（含简短描述）：

| 模块 | 描述（示意） | 进入 |
|------|-------------|------|
| 食物 | 从食物库选，按克/毫升记录 | 现有 `food-picker`（仍保留我的/系统） |
| 食谱 | 选已做好的菜，按本次吃的克数记营养 | 新 `recipe-picker` |

不在 `food-picker` 顶层再加「食物|食谱」Tab。本顿草稿可混合普通食物项与食谱成品项。

### 保存本顿

- 普通食物：现有逻辑
- 食谱：用保存时快照的 `nutritionPerBasis` 计算 `nutrition`；写 `sourceType: 'recipe'` + `recipeSource`
- 成功后更新该食谱 `usageCount` / `lastUsedAt`
- `markDirty` / rebuild 与普通辅食一致

### 编辑与历史

- 改食用克数：按 **intake 内快照** 重算，不读最新食谱配方
- 历史主展示：成品名 + 克数 + 营养；可展开只读成分（`ingredientsSnapshot` 按 `ateG / yieldWeightG` 缩放展示）
- 文案：`来自食谱：{recipeName}`

## 旧逻辑清理（本期必做）

确认现状：`meal_combinations` 集合无在用 CRUD；无管理入口。

删除或剥离包括但不限于：

| 项 | 处理 |
|----|------|
| `miniprogram/models/mealCombination.js` | 删除 |
| `miniprogram/utils/mealCombinationUtils.js` | 删除 |
| `foodIntakeRecord` 中 `mealCombinationSource` 归一化 | 删除；不再读写该字段 |
| `data-records-v2` 中 combination / recipeGroups /「来自菜谱」分组 | 删除旧路径；新食用 `recipeSource` |
| 相关测试（audit 集合名桩、daily-record 中 combination fixture 等） | 改为新模型或删除过时断言 |

云库若曾有 `meal_combinations` 文档：不必做迁移任务；客户端不再读写即可。

## 错误处理

| 场景 | 处理 |
|------|------|
| 成品总重 ≤ 0 / 原料为空 / 原料份量 ≤ 0 | 禁止保存食谱 |
| 编辑时原食物已不可用 | 用 `foodSnapshot` 展示与重算，并提示 |
| 食谱已软删 | 选食器列表不出现；若本顿草稿已包含该项，**允许用草稿内快照继续保存**（与历史快照隔离一致），不强制移除；保存时不更新该食谱 `usageCount` / `lastUsedAt` |
| 食用克数 ≤ 0 | 禁止加入本顿 |
| 写入失败 | Toast，保留草稿，不更新 usageCount |

## 测试要点

1. 浓度：`nutritionPer100g = totalNutrition / yieldWeightG * 100`
2. 录入：成品 200g、吃 60g ⇒ `nutrition = totalNutrition * 0.3`
3. 蛋白拆分：原料含 natural + special 时，成品与本次摄入均按比例带上
4. 汇总：同日普通食物 + 食谱成品 ⇒ `daily_summary_v2.food` 为二者之和
5. 快照隔离：改食谱后旧 intake 营养不变
6. 分流入口：添加 → 食物/食谱弹层 → 各进独立页
7. 软删后选食器不可见，历史仍可展示
8. 软删食谱仍在本顿草稿中时可保存成功，且不更新 `usageCount` / `lastUsedAt`
9. 旧 `mealCombination*` 代码与测试已移除，构建/测试无引用

## 实现落点（规划用）

- `miniprogram/models/recipe.js`（或 `recipeCatalog.js`）
- `miniprogram/utils/recipeNutritionUtils.js`（浓度与按克数缩放）
- `miniprogram/pkg-records/recipe-management/*`
- `miniprogram/pkg-records/recipe-picker/*`
- `meal-editor`：添加分流弹层 + 草稿支持食谱项
- `foodIntakeRecord`：支持 `recipeSource` / `sourceType: 'recipe'`
- `data-records-v2`：食谱来源展示（替换旧 combination 分组）
- `profile` / 入口配置：平级「食谱管理」
- 清理 meal_combination 残留
- 单测覆盖计算、录入缩放、汇总、清理后无旧引用
