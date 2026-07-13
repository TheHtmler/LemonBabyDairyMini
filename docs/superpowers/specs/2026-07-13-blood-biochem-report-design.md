# 大生化报告录入设计

## 背景

柠檬宝宝报告模块已支持血/尿串联质谱、血气、血常规、血氨。日常复查常见「大生化」化验单，目前无法按报告类型录入与对比。

本次在现有报告链路中新增 **大生化** 类型，指标以用户确认的医院单为准（共 28 项），第一版只做手动录入与档案/对比展示。

## 目标

- 新增报告类型：展示名「大生化」，类型 key `blood_biochem`。
- 支持手动录入上述 28 项指标（数值 + 参考范围），全部可选。
- 录入页扁平列表，不分组。
- 报告分析页可筛选、查看、编辑、对比该类型；档案卡展示约定关键摘要指标。
- 复用现有 `baby_reports_v2` 持久化与校验逻辑。

## 非目标

- 不做 OCR / 拍照识别（该类型不展示 OCR 入口；不扩展 lexicon / 云函数识别）。
- 不收录尿相关项：尿蛋白、尿白蛋白肌酐比、尿微量白蛋白、尿潜血。
- 不在录入页做「大生化 1/2/3」分组 UI。
- 不新建数据库集合，不做历史数据迁移。
- 不调整血气中已有同名电解质/血糖字段（血气与大生化仍是独立报告类型）。

## 用户流程

1. 用户在「报告分析」选择添加报告，或从档案筛选「大生化」后添加。
2. 进入 `add-report`，类型为大生化。
3. 填写检测日期等公共字段；按需填写任意指标的数值与参考范围。
4. 保存后进入 `baby_reports_v2`；档案卡、对比 Tab、详情页均可查看与编辑。

## 指标清单（28，全部 optional）

顺序与产品确认一致；`unit` 用于录入行展示，`abbr` 用于卡片/对比缩写。

| # | key | 名称 | unit | abbr |
|---|-----|------|------|------|
| 1 | `tp` | 总蛋白 | g/L | TP |
| 2 | `alb` | 白蛋白 | g/L | ALB |
| 3 | `alt` | 丙氨酸氨基转移酶 | U/L | ALT |
| 4 | `ast` | 天门冬氨酸氨基转移酶 | U/L | AST |
| 5 | `alp` | 碱性磷酸酶 | U/L | ALP |
| 6 | `ggt` | 谷氨酰转肽酶 | U/L | GGT |
| 7 | `dbil` | 直接胆红素 | μmol/L | DBil |
| 8 | `tbil` | 总胆红素 | μmol/L | TBil |
| 9 | `crea` | 肌酐 | μmol/L | CREA |
| 10 | `tba` | 总胆汁酸 | μmol/L | TBA |
| 11 | `ua` | 尿酸 | μmol/L | UA |
| 12 | `tc` | 总胆固醇 | mmol/L | TC |
| 13 | `tg` | 甘油三酯 | mmol/L | TG |
| 14 | `ldl` | 低密度脂蛋白 | mmol/L | LDL |
| 15 | `hdl` | 高密度脂蛋白 | mmol/L | HDL |
| 16 | `glu` | 空腹血糖 | mmol/L | Glu |
| 17 | `bun` | 尿素氮 | mmol/L | BUN |
| 18 | `egfr` | 肾小球滤过率 | ml/min | eGFR |
| 19 | `cysc` | 胱抑素C | mg/L | CysC |
| 20 | `na` | 钠 | mmol/L | Na |
| 21 | `k` | 钾 | mmol/L | K |
| 22 | `mg` | 镁 | mmol/L | Mg |
| 23 | `ca` | 钙 | mmol/L | Ca |
| 24 | `cl` | 氯 | mmol/L | Cl |
| 25 | `ck` | 肌酸激酶 | U/L | CK |
| 26 | `ck_mb` | 肌酸激酶同工酶 | U/L | CK-MB |
| 27 | `ctni` | 肌钙蛋白 | ng/mL | cTnI |
| 28 | `co2` | 二氧化碳 | mmol/L | CO₂ |

校验：沿用 `ReportModel.validateReportData()`。`optional: true` 时允许整项留空；若填写了数值，仍按现有规则要求参考范围齐全并计算 `status`。

保存约束：至少填入 **一项** 有数值的指标（若现有全局校验已允许「无指标空报告」，则与现有类型行为保持一致，不单独加严）。

## 关键摘要指标（档案卡 / 趋势优先）

暂定（用户确认先不换）：

- `alt`
- `ast`
- `crea`
- `k`
- `glu`

同步写入：

- `reportRepository.js` 的 `ARCHIVE_KEY_INDICATORS`、`TREND_METRIC_KEYS`
- `reportWorkbench.js` 的 `KEY_METRICS_BY_REPORT_TYPE`

## 实现触点

| 区域 | 文件 | 改动 |
|------|------|------|
| Schema | `miniprogram/models/report.js` | `REPORT_TYPES.BLOOD_BIOCHEM`、`BLOOD_BIOCHEM_INDICATORS`、`getIndicators`、`getReportTypeName` |
| 持久化摘要 | `miniprogram/models/reportRepository.js` | 关键 / 趋势 key 列表 |
| 工作台 | `miniprogram/utils/reportWorkbench.js` | `KEY_METRICS`、`REPORT_TYPE_FILTERS`；`splitIndicatorGroups` 可返回单组扁平或空分组（与血氨类似即可） |
| 录入 | `miniprogram/pkg-report/add-report/index.js` | `reportTypes` 增加「大生化」；当 `reportType === blood_biochem` 时不展示 OCR 入口（即使白名单用户） |
| 分析页 | `miniprogram/pages/analysis-report/index.js` | `COMPARE_TYPE_TABS` 增加大生化 |
| 测试 | `tests/report-model.test.js` 等 | 类型名、指标数量、optional、关键指标接线的源码/单元断言 |

详情页 `report-detail` 已按 `getIndicators(reportType)` 渲染，原则上无需特判。

## OCR 策略（本期）

- 大生化类型：**隐藏** OCR 入口。
- 不修改 `reportIndicatorLexicon.js`、不要求 `recognizeReportCustom` 识别该类型。
- 后续若要做 OCR，另开需求：补 lexicon 别名 + 云函数/解析验收。

## 风险与说明

- 指标较多（28），录入页会较长；接受扁平滚动，本期不分组。
- 血气与大生化均可能出现 Na/K/Ca/Cl/Glu，但分属不同 `reportType`，数据不合并。
- 肌钙蛋白单位按 `ng/mL`、CK-MB 按 `U/L`；若医院单不同，后续只改 `unit` 展示，不改 key。

## 验收标准

- [ ] 报告类型列表出现「大生化」。
- [ ] 录入页展示 28 项，均可单独留空；可只填部分项后保存成功。
- [ ] 大生化录入页不出现 OCR 入口。
- [ ] 分析页可筛选大生化；档案卡可见 ALT/AST/肌酐/钾/空腹血糖等已填摘要。
- [ ] 详情/编辑/删除行为与其他报告类型一致。
- [ ] 相关单测通过。
