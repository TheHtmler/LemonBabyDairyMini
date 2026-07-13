# 血五分类CRP报告录入设计

## 背景

日常复查常见新华医院「血五分类 + CRP」检验单（白细胞五分类、红系、血小板系及 CRP）。现有「血常规」字段偏少且不含 CRP，不宜硬塞进旧类型。本期新增独立报告类型 **血五分类CRP**，指标以用户确认的化验单为准（24 项），并支持 OCR 辅助录入。

## 目标

- 新增类型：展示名「血五分类CRP」，key `blood_cbc_crp`。
- 支持手动录入 24 项（数值 + 可选参考范围），全部 `optional: true`；整单至少 1 项有值才可保存（同大生化）。
- 录入页扁平列表；导航栏标题为类型名；无页内类型 chip（沿用现有录入交互）。
- 白名单用户可见 OCR 入口（**不**加入 `blood_biochem` 的 OCR 黑名单）。
- 接入档案筛选、对比 Tab、关键摘要指标。

## 非目标

- 不合并/替换现有 `blood_cbc`（血常规）类型与历史数据。
- 不改云函数 `recognizeReportCustom`（无类型注册表）。
- 不分组 UI、不做肝肾/同型半胱氨酸（另开需求）。
- 不为 RDW-SD / PCT 等「请结合临床」项单独做无范围校验例外（沿用现网：optional 有值可不填范围）。

## 指标清单（24，全部 optional）

| # | key | 名称 | unit | abbr |
|---|-----|------|------|------|
| 1 | `crp` | CRP | mg/L | CRP |
| 2 | `wbc` | 白细胞计数 | 10^9/L | WBC |
| 3 | `neut_pct` | 中性粒细胞% | % | NEUT% |
| 4 | `lym_pct` | 淋巴细胞% | % | LYM% |
| 5 | `mono_pct` | 单核细胞% | % | MONO% |
| 6 | `eos_pct` | 嗜酸粒细胞% | % | EOS% |
| 7 | `baso_pct` | 嗜碱粒细胞% | % | BASO% |
| 8 | `neut_abs` | 中性粒细胞绝对值 | 10^9/L | NEUT# |
| 9 | `mono_abs` | 单核细胞绝对值 | 10^9/L | MONO# |
| 10 | `lym_abs` | 淋巴细胞绝对值 | 10^9/L | LYM# |
| 11 | `eos_abs` | 嗜酸粒细胞绝对值 | 10^9/L | EOS# |
| 12 | `baso_abs` | 嗜碱粒细胞绝对值 | 10^9/L | BASO# |
| 13 | `rbc` | 红细胞计数 | 10^12/L | RBC |
| 14 | `hgb` | 血红蛋白 | g/L | HGB |
| 15 | `hct` | 红细胞压积 | % | HCT |
| 16 | `mcv` | 平均红细胞体积 | fL | MCV |
| 17 | `mch` | 平均血红蛋白量 | pg | MCH |
| 18 | `mchc` | 平均血红蛋白浓度 | g/L | MCHC |
| 19 | `rdw_cv` | 红细胞分布宽度(CV) | % | RDW-CV |
| 20 | `rdw_sd` | 红细胞分布宽度(SD) | fL | RDW-SD |
| 21 | `plt` | 血小板计数 | 10^9/L | PLT |
| 22 | `mpv` | 平均血小板体积 | fL | MPV |
| 23 | `pct` | 血小板压积 | % | PCT |
| 24 | `pdw` | 血小板分布宽度 | fL | PDW |

说明：与 `blood_cbc` 中同名字段（如 `hgb`/`wbc`）**语义相近但分属不同 `reportType`**，数据不合并。

### 校验

1. 单项：沿用 `validateReportData`；optional 有值不强制参考范围。
2. 整单：`blood_cbc_crp` 至少 1 项 `value` 非空（与大生化相同提示风格，文案为「请至少填写一项血五分类CRP指标」）。

## 关键摘要指标

配置优先 key（档案卡仍受现网 2–3 条截断限制）：

- `crp`、`wbc`、`hgb`、`plt`、`neut_pct`

写入：`reportRepository` 的 `ARCHIVE_KEY_INDICATORS` / `TREND_METRIC_KEYS`，以及 `reportWorkbench` 的 `KEY_METRICS_BY_REPORT_TYPE`。

## OCR

- **启用**：该类型参与 `ocrEntryVisible`（仅排除 `blood_biochem`）。
- 解析：`reportOcrParser` 通用，依赖 `getIndicators('blood_cbc_crp')`。
- 别名：在 `reportIndicatorLexicon.js` 的 `EXTRA_ALIASES` 为新 key 补充医院常见写法，至少覆盖：
  - CRP：`CRP`、`C反应蛋白`、`超敏CRP`、`hs-CRP`
  - 五分类百分比/绝对值：中文全称、NEUT/LYM/MONO/EOS/BASO 及 `#`/`%` 变体
  - 红系/血小板：RBC、HGB/Hb、HCT、MCV、MCH、MCHC、RDW-CV、RDW-SD、PLT、MPV、PCT、PDW
- 对已与血常规共用的 key（`hgb`/`wbc`/`plt`/`neut_*`/`hct`/`lym_pct`/`mcv`），复用既有别名即可，缺则补全。
- 云函数：不改。
- 测试：`tests/report-ocr-parser.test.js` 增加至少 1 条 `blood_cbc_crp` 样例（含 CRP + 若干 CBC 项）。

## 实现触点

| 区域 | 文件 |
|------|------|
| Schema | `miniprogram/models/report.js` |
| 类型入口 | `miniprogram/constants/reportTypes.js` |
| OCR 别名 | `miniprogram/utils/reportIndicatorLexicon.js` |
| 摘要/筛选 | `reportRepository.js`、`reportWorkbench.js`、`analysis-report/index.js` |
| 测试 | `report-model`、`add-report-entry-ux` / `blood-cbc-crp`、`report-ocr-parser` |

`splitIndicatorGroups`：不为该类型加分支（默认单组「全部指标」）。

## 验收标准

- [ ] 类型选择与筛选/对比出现「血五分类CRP」。
- [ ] 录入 24 项；全可选；至少填 1 项可保存；全空不可保存。
- [ ] 导航标题为「血五分类CRP」；无页内类型 chip。
- [ ] 白名单用户可见 OCR；拍照后可回填 CRP 等项（需人工核对）。
- [ ] 档案摘要优先展示已填的 CRP/WBC/HGB 等。
- [ ] 相关单测通过。
