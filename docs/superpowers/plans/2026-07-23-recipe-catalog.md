# Recipe Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地独立「食谱管理」与本顿「选食谱成品按克数记录」，营养走现有 `food_intake_records` → `daily_summary_v2.food`，并删除旧 `meal_combination` 残留。

**Architecture:** 纯函数 `recipeNutritionUtils` 负责浓度与按克缩放；`RecipeModel` 读写 `recipe_catalog`（含 `steps` 等扩展空字段）；本顿添加先出分流弹层再进 `food-picker` / `recipe-picker`；intake 用顶层 `sourceType: 'recipe'` + `recipeSource`，不污染 `foodSnapshot.sourceType`。

**Tech Stack:** 微信小程序、云开发 DB、`node:test` 单测、现有 `FoodModel` / `FoodIntakeRecordModel` / meal-editor

**Spec:** `docs/superpowers/specs/2026-07-23-recipe-catalog-design.md`

---

## File map

| 文件 | 职责 |
|------|------|
| `miniprogram/utils/recipeNutritionUtils.js` | 原料营养合计、每 100g、按食用克数缩放、proteinSource 推导、弱提示判断 |
| `miniprogram/models/recipe.js` | `recipe_catalog` CRUD、normalize、软删、usage 更新 |
| `miniprogram/models/foodIntakeRecord.js` | 去掉 `mealCombinationSource`；支持 `recipeSource` / `sourceType: 'recipe'` |
| `miniprogram/pkg-records/recipe-management/*` | 列表 + 新建/编辑/详情（区块 A/B；C 制作过程一期隐藏） |
| `miniprogram/pkg-records/recipe-picker/*` | 选食谱 + 填食用克数，回写 meal-editor |
| `miniprogram/pkg-records/meal-editor/*` | 添加分流弹层；草稿支持食谱行（`localId`） |
| `miniprogram/pages/data-records-v2/*` | 删旧 combination/recipeGroups；展示 `recipeSource` |
| `miniprogram/pages/profile/index.js` | 平级「食谱管理」入口 |
| `miniprogram/app.json` | 注册新页面 |
| `cloudfunctions/accountCleanup/index.js` | `recipe_catalog` 纳入宝宝作用域清理 |
| 删除 `models/mealCombination.js`、`utils/mealCombinationUtils.js` | 旧逻辑清理 |
| `tests/recipe-nutrition-utils.test.js` 等 | 计算、模型契约、清理、页面入口 |

---

### Task 1: 旧 meal_combination 清理

**Files:**
- Delete: `miniprogram/models/mealCombination.js`
- Delete: `miniprogram/utils/mealCombinationUtils.js`
- Modify: `miniprogram/models/foodIntakeRecord.js`（移除 `normalizeMealCombinationSource` 及 create/update 中对该字段的处理）
- Modify: `miniprogram/pages/data-records-v2/index.js`（移除 combination 归一化、`recipeGroups` 分组、`mealCombinationSourceText`、toggle recipe expand 等；本 Task 先删旧路径，新 `recipeSource` 展示放 Task 6）
- Modify: `tests/audit-fields-utils.test.js`（`meal_combinations` 集合名改为任意仍存在的集合如 `food_intake_records`，测试的是 audit helper 而非业务）
- Modify: `tests/daily-record-v2-service.test.js`（去掉 `mealCombinationSource` fixture 或改为无关字段）

- [ ] **Step 1: 写失败测试锁定「无旧引用」**

Create: `tests/meal-combination-cleanup.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('meal combination model and utils files are removed', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'miniprogram/models/mealCombination.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'miniprogram/utils/mealCombinationUtils.js')), false);
});

test('miniprogram js no longer references mealCombination APIs', () => {
  const miniRoot = path.join(ROOT, 'miniprogram');
  const stack = [miniRoot];
  const hits = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!name.endsWith('.js')) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (/mealCombinationSource|normalizeMealCombinationSource|meal_combinations|mealCombinationUtils|recipeGroups/.test(source)) {
        hits.push(path.relative(ROOT, full));
      }
    }
  }
  assert.deepEqual(hits, []);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `node --test tests/meal-combination-cleanup.test.js`  
Expected: FAIL（文件仍存在或源码仍有引用）

- [ ] **Step 3: 删除文件并剥离引用**

按 File 列表删除/修改。`data-records-v2` 中原 `recipeGroups` 相关 UI 绑定若 wxml 已无引用，只清 JS；若仍有死代码一并删。临时历史展示可只显示普通食物项，Task 6 再接 `recipeSource`。

- [ ] **Step 4: Run test — expect PASS**

Run: `node --test tests/meal-combination-cleanup.test.js tests/audit-fields-utils.test.js tests/daily-record-v2-service.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: remove unused meal_combination recipe leftovers

EOF
)"
```

---

### Task 2: recipeNutritionUtils（纯计算）

**Files:**
- Create: `miniprogram/utils/recipeNutritionUtils.js`
- Test: `tests/recipe-nutrition-utils.test.js`

- [ ] **Step 1: 写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyNutrition,
  addNutrition,
  scaleNutrition,
  buildIngredientNutrition,
  summarizeRecipeNutrition,
  shouldWarnYieldMismatch,
  deriveProteinSource
} = require('../miniprogram/utils/recipeNutritionUtils');

test('summarizeRecipeNutrition builds per-100g from yield weight', () => {
  const ingredients = [
    {
      nutrition: {
        calories: 100, protein: 10, naturalProtein: 10, specialProtein: 0,
        fat: 2, carbs: 8, fiber: 1, sodium: 0
      }
    },
    {
      nutrition: {
        calories: 50, protein: 5, naturalProtein: 0, specialProtein: 5,
        fat: 1, carbs: 0, fiber: 0, sodium: 200
      }
    }
  ];
  const result = summarizeRecipeNutrition(ingredients, 200);
  assert.equal(result.totalNutrition.protein, 15);
  assert.equal(result.totalNutrition.naturalProtein, 10);
  assert.equal(result.totalNutrition.specialProtein, 5);
  assert.equal(result.nutritionPer100g.protein, 7.5);
  assert.equal(result.nutritionPer100g.calories, 75);
  assert.equal(result.proteinSource, 'mixed');
});

test('scaleNutrition by eaten grams uses per-100g', () => {
  const per100 = {
    calories: 75, protein: 7.5, naturalProtein: 5, specialProtein: 2.5,
    fat: 1.5, carbs: 4, fiber: 0.5, sodium: 100
  };
  const ate = scaleNutrition(per100, 60); // 60/100
  assert.equal(ate.protein, 4.5);
  assert.equal(ate.naturalProtein, 3);
  assert.equal(ate.specialProtein, 1.5);
});

test('shouldWarnYieldMismatch only when all units are g', () => {
  assert.equal(shouldWarnYieldMismatch([
    { quantity: 100, unit: 'g' },
    { quantity: 50, unit: 'g' }
  ], 200), true);
  assert.equal(shouldWarnYieldMismatch([
    { quantity: 100, unit: 'g' },
    { quantity: 10, unit: 'ml' }
  ], 200), false);
});
```

- [ ] **Step 2: Run — expect FAIL**（模块不存在）

Run: `node --test tests/recipe-nutrition-utils.test.js`

- [ ] **Step 3: 实现 utils**

关键 API（数值统一 `roundNumber(x, 2)`）：

```js
function emptyNutrition() {
  return {
    calories: 0, protein: 0, naturalProtein: 0, specialProtein: 0,
    fat: 0, carbs: 0, fiber: 0, sodium: 0
  };
}

function addNutrition(a = {}, b = {}) { /* 逐字段相加 */ }

function scaleNutrition(nutritionPer100g, ateG) {
  const factor = Number(ateG) / 100;
  // 逐字段 * factor，保留 2 位
}

function splitProtein(protein, proteinSource, proteinSplit) {
  // 与 meal-editor 一致：special / mixed / natural
}

function buildIngredientNutrition(food, quantity) {
  // 调用方可注入 calculateNutrition；默认 require FoodModel 时注意测试可注入
}

function summarizeRecipeNutrition(ingredients, yieldWeightG) {
  // total = Σ ingredient.nutrition
  // per100 = total / yieldWeightG * 100
  // proteinSource = deriveProteinSource(total)
}

function shouldWarnYieldMismatch(ingredients, yieldWeightG) {
  if (!ingredients.every(i => String(i.unit || '').toLowerCase() === 'g')) return false;
  const sum = ingredients.reduce((s, i) => s + Number(i.quantity || 0), 0);
  if (!(yieldWeightG > 0) || !(sum > 0)) return false;
  const ratio = Math.abs(sum - yieldWeightG) / yieldWeightG;
  return ratio >= 0.25; // 差异 ≥25% 弱提示阈值，可常量导出
}

function deriveProteinSource(nutrition) {
  const n = Number(nutrition.naturalProtein) || 0;
  const s = Number(nutrition.specialProtein) || 0;
  if (n > 0 && s > 0) return 'mixed';
  if (s > 0) return 'special';
  return 'natural';
}

module.exports = { /* ... */ };
```

说明：`buildIngredientNutrition` 为避免单测拉起 `wx`，接受可选 `deps.calculateNutrition`；页面侧传入 `FoodModel.calculateNutrition.bind(FoodModel)`，再补 `naturalProtein`/`specialProtein`。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add miniprogram/utils/recipeNutritionUtils.js tests/recipe-nutrition-utils.test.js
git commit -m "$(cat <<'EOF'
feat: add recipe nutrition concentration helpers

EOF
)"
```

---

### Task 3: RecipeModel

**Files:**
- Create: `miniprogram/models/recipe.js`
- Modify: `cloudfunctions/accountCleanup/index.js`（`BABY_SCOPED_COLLECTIONS` 增加 `recipe_catalog`）
- Modify: `tests/account-cleanup.test.js`（若有集合列表断言则同步）
- Test: `tests/recipe-model.test.js`

- [ ] **Step 1: 写模型契约测试（读源码 + 纯 normalize 若可导出）**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('recipe model targets recipe_catalog with soft delete and usage fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/models/recipe.js'),
    'utf8'
  );
  assert.match(source, /recipe_catalog/);
  assert.match(source, /steps/);
  assert.match(source, /coverImageFileId/);
  assert.match(source, /prepTimeSec/);
  assert.match(source, /yieldWeightG/);
  assert.match(source, /nutritionPer100g/);
  assert.match(source, /usageCount/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async softDelete|status:\s*'deleted'/);
  assert.match(source, /listActiveByBaby/);
  assert.match(source, /touchUsage/);
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: 实现 RecipeModel**

对齐 `foodIntakeRecord` / `waterRecord` 的审计字段模式：

- `normalizeRecipe(doc)`：补齐 `steps: []`、`coverImageFileId: ''`、`prepTimeSec: null`、营养对象、`status`
- `create(recipe)` / `update(id, patch)`：保存前用 `summarizeRecipeNutrition` 重算 `totalNutrition` / `nutritionPer100g` / `proteinSource`；校验 name、yieldWeightG>0、ingredients 非空且 quantity>0
- `softDelete(id, babyUid)`：`status: 'deleted'`
- **方法名固定为** `listActiveByBaby(babyUid)`（与契约测试一致）：`status == 'active'`
- `touchUsage(id)`：`usageCount += 1`、`lastUsedAt = serverDate()`（仅本顿保存成功且食谱仍 active 时调用）

原料写入时：`foodSnapshot = FoodModel.buildFoodSnapshot(food)`，`nutrition` 用 utils 算好。

- [ ] **Step 4: accountCleanup 加入 `recipe_catalog`**

- [ ] **Step 5: Run tests PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add recipe_catalog model and cleanup scope

EOF
)"
```

---

### Task 4: 食谱管理页（列表 / 新建编辑 / 详情）

**Files:**
- Create: `miniprogram/pkg-records/recipe-management/index.js|wxml|wxss|json`
- Optional: 同目录 `edit` 子页或页内 mode=`list|edit|detail`（优先单页 + `mode`，减少注册；若文件过大再拆 `recipe-edit`）
- Modify: `miniprogram/pkg-records/food-picker/*`（支持 `from=recipe-management` → 回写 `recipe_ingredient_picker_selection`）
- Modify: `miniprogram/app.json`（`pkg-records.pages` 增加 `recipe-management/index`）
- Modify: `miniprogram/pages/profile/index.js`（喂养管理组、食物管理旁增加食谱管理）
- Test: `tests/recipe-management-page.test.js`（源码契约：入口 path、yieldWeightG、隐藏 steps UI）

- [ ] **Step 1: 注册页面 + profile 入口**

profile item 示例：

```js
{
  id: 11,
  name: '食谱管理',
  icon: 'add',
  path: '/pkg-records/recipe-management/index',
  description: '维护成品菜配方，按食用克数记录营养'
}
```

- [ ] **Step 2: 列表 UI**

空状态文案自拟一句即可（例如：「把常做的菜存成食谱，记本顿时按吃的克数算营养」）。卡片：名称、原料数、成品总重、每 100g 蛋白/热量、**最近使用**（`lastUsedAt` 格式化；无则显示「未使用」；可按 `lastUsedAt`/`usageCount` 排序）。

- [ ] **Step 3: 新建/编辑表单（区块 A/B；C 隐藏）**

- 名称、备注  
- **添加原料（路径写死）**：`wx.navigateTo` → `/pkg-records/food-picker/index`，使用独立 storage key `recipe_ingredient_picker_selection`（**禁止**复用 `meal_food_picker_selection`）。food-picker 增加对 query/`from=recipe-management` 的分支：回写该 key 后 `navigateBack`。  
- 每条原料份量输入；删除原料  
- 成品总重 g；若 `shouldWarnYieldMismatch` 则 `wx.showToast` 弱提示仍可保存  
- 实时预览 total / per100g（含天然/特殊蛋白）  
- **原食物不可用**：编辑时若 `foodId` 在库中查不到，保留行内 `foodSnapshot` 展示名称/单位，用快照 `nutritionPerBasis` 重算该行 nutrition，并 `wx.showToast` 或行内提示「原食物已不可用，营养按快照」  
- 保存调用 `RecipeModel.create/update`

- [ ] **Step 4: 详情**

只读原料表 + 营养；编辑/删除按钮。制作过程区块不渲染（或 `wx:if="{{false}}"` 占位注释）。

- [ ] **Step 5: 契约测试 + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add recipe management pages and profile entry

EOF
)"
```

---

### Task 5: 本顿分流弹层 + recipe-picker + meal-editor 全路径

**依赖：** 本 Task 保存前须先完成 Task 6 Step 1（`foodIntakeRecord.normalizeRecipeSource`），或在本 Task 内同步改 `foodIntakeRecord`，避免 create 时丢掉 `recipeSource`。

**Files:**
- Create: `miniprogram/pkg-records/recipe-picker/index.js|wxml|wxss|json`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pkg-records/meal-editor/index.js|wxml|wxss`
- Modify: `miniprogram/models/foodIntakeRecord.js`（至少先加 `recipeSource` 归一化，详见 Task 6 Step 1）
- Test: `tests/meal-editor-recipe-entry.test.js`

- [ ] **Step 1: meal-editor 添加分流弹层**

将原直接 `openFoodDrawer` / `navigateTo food-picker` 的「添加」入口改为：

1. `showAddTypeSheet: true`  
2. 两张大卡片：食物 / 食谱（短描述按 spec）  
3. 选食物 → 现有 `openFoodDrawer()`  
4. 选食谱 → `navigateTo /pkg-records/recipe-picker/index`

- [ ] **Step 2: recipe-picker → 草稿 merge**

- 列表 `RecipeModel.listActiveByBaby`  
- 选中后输入食用克数 `> 0`  
- 确认后 `wx.setStorageSync('meal_recipe_picker_selection', { items: [{ localId, recipeId, recipeName, quantity, unit:'g', nutritionPer100g, proteinSource, yieldWeightG, ingredientsSnapshot, sourceType:'recipe' }] })` 并 `navigateBack`  
- meal-editor `onShow` 读取并 merge 进 `mealDraft.items`：`sourceType: 'recipe'`、稳定 `localId`、`foodId: ''`、`nutrition = scaleNutrition(nutritionPer100g, quantity)`、挂好 `foodSnapshot.nutritionPerBasis`（**省略** `foodSnapshot.sourceType`）与 `recipeSource`

- [ ] **Step 3: 改 `buildMealIntakes`（关键，否则保存丢来源）**

现有 `buildMealIntakes`（约 `meal-editor/index.js:1123`）对每项写 `foodId`/`foodSnapshot`/`sourceType`。必须分支：

```js
if (item.sourceType === 'recipe') {
  return {
    ...baseFields,
    foodId: '',
    foodName: item.recipeName || item.nameSnapshot,
    category: '食谱成品',
    sourceType: 'recipe',
    foodSnapshot: {
      name: item.recipeName || item.nameSnapshot,
      category: '食谱成品',
      nutritionBasis: { quantity: 100, unit: 'g' },
      nutritionPerBasis: item.nutritionPer100g,
      proteinSource: item.proteinSource
      // 不要写 sourceType
    },
    recipeSource: {
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      yieldWeightG: item.yieldWeightG,
      ingredientsSnapshot: item.ingredientsSnapshot || []
    },
    quantity: item.quantity,
    unit: 'g',
    nutrition: item.nutrition, // 已含 natural/special
    naturalProtein: item.nutrition.naturalProtein,
    specialProtein: item.nutrition.specialProtein
  };
}
```

下游 `FoodIntakeRecordModel` 批量写入必须透传 `recipeSource`（Task 6 normalize）。

- [ ] **Step 4: 编辑回载 + 改克数（禁止走空 foodId 的食物草稿路径）**

现有 `editMealItem` → `buildMealItemFromFoodDraft` 在 `!foodId` 时会 toast「请选择食物」——**食谱行绝不能走这条路径**。

- 加载已有餐次（`loadMeal` / 等价）：若 intake `sourceType === 'recipe'` 或有 `recipeSource`，还原为草稿食谱行（保留 `nutritionPer100g`、`recipeSource`、`localId`/`originalIntakeId`）。  
- `editMealItem`：若 `target.sourceType === 'recipe'`，打开**食谱克数编辑**（仅改 `quantity`，用 `scaleNutrition` 更新 `nutrition` 与预览），不要打开食物 drawer。  
- 批量改份量、确认草稿等其它调用 `buildMealItemFromFoodDraft` 的路径：对食谱行 early-return 到 `updateRecipeMealItemQuantity` 一类 helper。

- [ ] **Step 5: 保存后 touchUsage**

保存成功后：对每个仍 active 的 `recipeId` 调 `RecipeModel.touchUsage`；软删或不存在则跳过（草稿仍按快照保存）。

- [ ] **Step 6: 测试（源码断言）+ Commit**

断言：分流弹层、`meal_recipe_picker_selection`、`buildMealIntakes` 含 `recipeSource`、`editMealItem` 对 recipe 分支、无「请选择食物」依赖空 foodId。

```bash
git commit -m "$(cat <<'EOF'
feat: add meal recipe picker flow with entry sheet

EOF
)"
```

---

### Task 6: foodIntakeRecord 收尾 + 历史展示 + 汇总验收

**说明：** `normalizeRecipeSource` 若已在 Task 5 落地，本 Task Step 1 改为核对测试补齐即可。

**Files:**
- Modify: `miniprogram/models/foodIntakeRecord.js`（`normalizeRecipeSource`、create/update 保留 `recipeSource`；`sourceType` 可写 `recipe`）
- Modify: `miniprogram/pages/data-records-v2/index.js|wxml|wxss`
- Test: `tests/food-intake-recipe-source.test.js`、`tests/data-records-recipe-display.test.js`
- 可选：扩展现有 `daily-record-v2-service` / summary 测试，断言含 `sourceType:'recipe'` 的 intake 营养计入 `food` 段（若 merge 只读 nutrition，补一条 fixture 即可）

- [ ] **Step 1: normalizeRecipeSource（若 Task 5 未做则此处完成）**

```js
function normalizeRecipeSource(source = {}) {
  if (!source || typeof source !== 'object') return null;
  const recipeId = String(source.recipeId || '').trim();
  const recipeName = String(source.recipeName || '').trim();
  if (!recipeId && !recipeName) return null;
  return {
    recipeId,
    recipeName,
    yieldWeightG: Number(source.yieldWeightG) || 0,
    ingredientsSnapshot: Array.isArray(source.ingredientsSnapshot)
      ? source.ingredientsSnapshot
      : []
  };
}
```

挂载到 `normalizeFoodIntakeRecord` / `normalizeFoodIntakeUpdate`（对标原 `mealCombinationSource` 挂载点：有则 normalize 写入，无则不写）。

- [ ] **Step 2: data-records-v2 展示**

- 识别：`sourceType === 'recipe'` 或合法 `recipeSource`  
- 文案：`来自食谱：{recipeName}`  
- 主行：成品名 + 克数 + 营养  
- 展开：按 `quantity / yieldWeightG` 缩放 `ingredientsSnapshot` 展示（只读）  
- **不要**复活 `mealCombination*` / `recipeGroups` 旧结构；可用更简单的 `expanded` 挂在 meal group item 上

- [ ] **Step 3: 汇总回归测试**

构造两条 intake（普通食物 + 食谱成品）nutrition，调用现有 merge/summary helper，断言加总正确（60g / 200g ⇒ 0.3 × total）。

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: persist recipe intake source and show history breakdown

EOF
)"
```

---

### Task 7: 手工验收清单 + 全量相关测试

- [ ] **Step 1: 跑相关测试**

```bash
node --test \
  tests/meal-combination-cleanup.test.js \
  tests/recipe-nutrition-utils.test.js \
  tests/recipe-model.test.js \
  tests/recipe-management-page.test.js \
  tests/meal-editor-recipe-entry.test.js \
  tests/food-intake-recipe-source.test.js \
  tests/data-records-recipe-display.test.js \
  tests/account-cleanup.test.js \
  tests/daily-record-v2-service.test.js \
  tests/audit-fields-utils.test.js
```

Expected: all PASS

- [ ] **Step 2: 真机/开发者工具手工点验**

1. 我的 → 食谱管理 → 新建番茄炒蛋（原料+成品总重）→ 见每 100g  
2. 本顿添加 → 分流选食谱 → 选成品填 60g → 保存  
3. 今日/数据记录：一条成品、来源文案、展开成分  
4. 再改食谱配方 → 旧记录营养不变  
5. 软删食谱 → picker 不见；草稿已有项仍可保存且 usage 不增加  
6. 确认无「食物|食谱」嵌套在 food-picker Tab 上

- [ ] **Step 3: Final commit if needed**

```bash
git commit -m "$(cat <<'EOF'
test: cover recipe catalog end-to-end contracts

EOF
)"
```

---

## 实现注意

- 分支：勿在 `main` 直接改；本计划在 `feature/recipe-catalog-design` 或后续 `feature/recipe-catalog` 上执行。  
- UI：原生 button 通栏对齐见 `docs/miniprogram/ui-conventions.md`；份量控件优先 `compact-input` / `compact-picker`。  
- YAGNI：不写 steps 录入 UI；但 create 时写入 `steps: []` 等字段。  
- 云库：首次上线前在控制台创建 `recipe_catalog` 集合（及权限与 `food_catalog` 用户数据一致）。
