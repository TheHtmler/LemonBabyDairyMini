# 部分喝奶按比例折算设计

日期：2026-08-11  
状态：已确认  
分支：`feat/partial-feeding-intake-design`

## 背景

用户反馈：有时一顿奶冲好后宝宝喝不完。当前喂奶编辑页（`milk-feeding-editor-v2`）只录入冲配成分，备注虽有「喝奶状态 / 剩余量」占位，但不会进入蛋白/热量统计。

柠檬宝宝一顿常为母乳 + 多种奶粉（及偶发兑入药液）混合。喝不完时家长难以手工拆各成分；若只改总量不按比例缩粉重，天然/特殊蛋白会失真。

另有实务细节：录入习惯按**加水量 + 粉重**，但冲泡后瓶内体积会因粉体占位变大。宝宝按瓶刻度喝了 X ml 时，比例分母必须是**冲后总体积**，不能用加水量，否则摄入会被估高。

## 目标

- 支持「没喝完」时按瓶内实喝比例，折算各成分实际摄入
- 蛋白 / 热量 / 日汇总仍只依赖折算后的实际量，现有汇总链路尽量不动
- 全喝完时路径与现在一致（零额外负担）
- 冲后总体积入口克制、不抢主流程，需要时再展开

## 非目标（YAGNI）

- 不按成分分别记剩余（「只喝了母乳、特奶没动」）
- 不做冲配浪费分析报表
- 不改日汇总 / 云函数聚合算法（仍读实际 `formulaComponents` + `nutritionSummary`）
- 本期不自动联动用药记录折算左卡/精氨酸（若药兑进同瓶，可在备注提示；用药集合改造另开需求）

## 方案选择

采用 **冲配成分 +（可选）冲后总体积 + 剩余 ml → 统一比例折算后落库**。

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 只手改各成分 | 已有编辑能力，家长心算拆分 | 否：易错 |
| B. 仅按加水量做分母 | 实现简单 | 否：冲后体积变大时蛋白偏高 |
| C. 冲后总体积 + 剩余（推荐） | 与瓶刻度一致 | 采用；冲后体积放折叠入口 |

## 交互

页面：`pkg-milk/milk-feeding-editor-v2`

### 主流程（不变）

1. 选时间、添加母乳 / 奶粉，填水量与粉重  
2. 看营养预览，保存  

### 「没喝完」折算（默认收起）

在营养预览与备注之间，增加一条低干扰入口（文案偏口语，避免「高级设置」）：

- 收起态文案：**没喝完？按瓶内刻度折算**  
- 副文案（一行灰字）：全喝完可忽略  
- 点击展开后：

| 控件 | 说明 |
|------|------|
| 冲后瓶内约 ___ ml | 看瓶刻度；有默认估算，可改 |
| 还剩 ___ ml | 主输入；空或 0 = 全喝完 |
| 快捷 | 「剩一半」「全喝完」（基于冲后总量） |
| 即时预览 | `实喝 YYY ml（约 ZZ%）」+ 折算后母乳/粉重/蛋白摘要 |

折叠逻辑：

- 默认收起  
- 若 `leftoverVolume > 0`（含编辑回填），自动展开  
- 未展开且剩余为空：按全喝完保存，与现网一致  

### 冲后总量默认值

展开时若用户未改过冲后总量，默认：

```text
estimatedFinalVolume = Σ 母乳 volume + Σ 配方粉 waterVolume + Σ 本顿录入的药液 ml（若有）
```

当前喂奶模型无药液成分时，即「母乳 + 各粉水量」。  
提示一句：粉会占体积，瓶内刻度通常更大，可按实际修改。

用户一旦手动改过冲后总量，切换成分时**不覆盖**其输入（可提供「恢复估算」小链接）。

### 校验

- 冲配液量合计为 0：不展示折算入口  
- 冲后总量 ≤ 0：拦截  
- 剩余 > 冲后总量：toast「剩余不能大于冲后瓶内总量」  
- 剩余 < 0：拦截  

### 备注

placeholder 改为普通备注（如「可选备注」），不再承担剩余量语义。

## 计算

```text
preparedFinalVolume = 用户确认的冲后瓶内总量（ml）
leftoverVolume      = 剩余 ml（默认 0）
actualVolume        = max(0, preparedFinalVolume - leftoverVolume)
intakeRatio r       = preparedFinalVolume > 0 ? actualVolume / preparedFinalVolume : 1

对每个 formulaComponent：
  breast_milk.volume          *= r
  formula_powder.waterVolume  *= r
  formula_powder.powderWeight *= r

nutritionSummary = buildNutritionSummary(折算后的 components)
```

展示用「今日喝了多少 ml」以 **actualVolume（瓶内实喝）** 为准更贴近家长感知；落库的 `nutritionSummary.totalVolume` 仍由现有规则（母乳 volume + 各粉 waterVolume）对折算后成分计算。二者在「冲后体积 > 加水量」时可能略有差别：

- **蛋白 / 粉重**：以 `powderWeight × r` 为准（准确，优先）  
- **体积展示**：记录卡片优先展示「冲后实喝 actualVolume」；成分明细展示折算后的水/母乳  

若实现时发现 `totalVolume` 与瓶内实喝差过大影响首页，可在 `nutritionSummary` 增加可选 `consumedBottleVolume`（= actualVolume），首页奶量优先读它；无该字段时回退 `totalVolume`。

## 数据模型

集合：现有 `feeding_records_v2`（不新建集合）

| 字段 | 类型 | 说明 |
|------|------|------|
| `formulaComponents` | array | **折算后的实际摄入**（汇总逻辑不变） |
| `nutritionSummary` | object | 基于折算后成分重算 |
| `preparedComponents` | array \| 省略 | 冲配原样；全喝完且无折算时可省略或与实际相同 |
| `preparedFinalVolume` | number \| 省略 | 冲后瓶内总量 ml；全喝完未用折算时可省略 |
| `leftoverVolume` | number | 剩余 ml；默认 0；>0 表示启用了折算 |
| `intakeRatio` | number | `actualVolume / preparedFinalVolume`，范围 0–1；全喝完为 1 或省略 |
| `consumedBottleVolume` | number \| 省略 | 瓶内实喝 ml（= preparedFinalVolume - leftover）；可选，便于展示 |

旧记录无上述字段：编辑时把当前 `formulaComponents` 当作冲配量，剩余默认 0，冲后总量用估算值。

### 保存策略

1. 表单内始终编辑「冲配量」+ 可选折算字段  
2. 保存时：用冲配量生成 `preparedComponents`；若 `leftoverVolume > 0`（或 r < 1），按 r 生成实际 `formulaComponents`；否则实际 = 冲配  
3. `nutritionSummary` 只基于实际 `formulaComponents`  

## 展示

- `feeding-record-item` / `feeding-record-card`：当 `leftoverVolume > 0`（或 `intakeRatio < 1`）时，增加一行次要文案：  
  `冲后 155 · 喝 100（剩 55）`  
- 主数字仍表示实际摄入（蛋白、实喝相关量）  
- 列表不展示冲配成分明细，除非进入编辑  

## 文案

| 位置 | 文案 |
|------|------|
| 折叠入口 | 没喝完？按瓶内刻度折算 |
| 冲后总量 label | 冲后瓶内约 |
| 剩余 label | 还剩 |
| 帮助（一行） | 按瓶刻度填；粉会占体积，通常比加水量略多 |
| 校验 | 剩余不能大于冲后瓶内总量 |

避免使用：「高级设置」「比例系数」「intakeRatio」等开发用语。

## 测试要点

- 全喝完（不展开 / 剩余 0）：写入结果与现网一致，无强制新字段  
- 水 130 + 粉，冲后改 155，剩 55：粉重与水量均 × (100/155)  
- 剩余 = 冲后总量：实喝 0，蛋白 0（或产品选择禁止保存并提示）——建议 **禁止保存**并 toast「还剩整瓶时请删除本顿或改剩余」  
- 旧记录编辑回填不崩  
- 日汇总天然/特殊蛋白随折算后粉重变化  

## 实现范围（供后续 plan）

1. `feedingRecordV2Utils`：比例折算纯函数 + 单测  
2. `milk-feeding-editor-v2`：折叠 UI、校验、保存组装  
3. 展示适配：`dataRecordsV2Adapter` / record card 次要文案  
4. 备注 placeholder 调整  

不修改 `daily_summary_v2` 合并逻辑（除非增加 `consumedBottleVolume` 展示优先级）。
