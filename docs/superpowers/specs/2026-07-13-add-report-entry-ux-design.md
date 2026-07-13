# 新建报告交互优化设计

## 背景

报告分析页「添加报告」直达 `add-report`，类型靠页内横滑 chip 切换。类型增至 6 种（含大生化）后，chip 更挤；大生化 28 项扁平列表无单位、无已填进度，长单录入负担明显。

本期做**最小包**：添加时先选类型 + 录入行显示单位 + 顶部已填计数。不分组、不做搜索/折叠。

## 目标

- 从「全部」筛选点添加时，先选报告类型再进入录入页。
- 档案已筛到具体类型时，添加仍直达该类型（不弹层）。
- 录入页每项展示 `unit`（有则显示）。
- 录入页展示「已填 x / 共 n」（按检测值非空计数）。
- 保留页内类型 chip，误选可切换（沿用现有清空确认）。

## 非目标

- 指标分组 / 折叠 / 搜索。
- 改 OCR、保存校验、参考范围逻辑。
- 新建独立选类型页面（用分析页弹层即可）。
- 改 FAB 以外的其他入口（若有深链带 `type=` 仍直达）。

## 用户流程

### 添加（筛选 = 全部）

1. 用户点 FAB「+」。
2. 弹出类型选择层：展示与 `add-report.reportTypes` 一致的 6 项（图标 + 名称）。
3. 用户点某一类型 → 关闭弹层 → `navigateTo`  
   `/pkg-report/add-report/index?mode=add&type=<key>`。
4. 用户可点遮罩或取消关闭弹层，不跳转。

### 添加（筛选 = 某具体类型）

1. 用户点 FAB。
2. **不弹层**，直接  
   `/pkg-report/add-report/index?mode=add&type=<selectedFilterType>`  
   （与现网行为一致）。

### 录入页

1. 顶部 meta（检测日期）下方或指标列表上方显示：`已填 {{filledCount}} / 共 {{totalCount}}`。
2. 每行指标名称旁或输入区旁显示 `indicator.unit`（空字符串则不渲染）。
3. 横滑类型 chip 保留；切换逻辑不变。

## 交互细节

### 类型选择层（分析页）

- 数据源：与录入页相同的类型列表（建议抽共享常量，或分析页本地维护一份与 `add-report` 同步的列表；本期允许分析页硬编码一份，须与 `add-report` 的 key/name/icon 一致）。
- UI：底部半屏或居中卡片均可；柠檬主题、清晰可点；不必过度动效。
- 关闭：点取消 / 点遮罩。

### 已填计数

- `totalCount = currentIndicators.length`
- `filledCount =` 当前 `indicatorData` 中 `value` trim 后非空的项数
- 在 `initIndicators` / `switchReportType` / 指标 value 的 input/blur 更新后刷新（可用轻量方法 `refreshFilledCount()`，避免多余 setData 时可做相等判断）

### 单位展示

- 使用 `ReportModel` 指标配置里的 `unit` 字段（大生化已有；其他类型多为空则不显示）。
- 录入页 WXML 增加单位节点即可；**不**要求本期给血/尿串联补全单位。

## 实现触点

| 区域 | 文件 | 改动 |
|------|------|------|
| 分析页 | `miniprogram/pages/analysis-report/index.js` | `onAddReport`：全部 → 打开类型弹层；有筛选类型 → 直达 |
| 分析页 | `miniprogram/pages/analysis-report/index.wxml` / `.wxss` | 类型选择弹层 UI |
| 录入 | `miniprogram/pkg-report/add-report/index.js` | `filledCount` / `totalCount`、`refreshFilledCount` |
| 录入 | `miniprogram/pkg-report/add-report/index.wxml` / `.wxss` | 已填进度、行内 unit |
| 测试 | `tests/add-report.test.js`、可选 `tests/analysis-report-flow.test.js` 或新建轻量源码断言 | 单位节点、已填计数接线、onAddReport 分支 |

## 验收标准

- [ ] 筛选「全部」点添加 → 出现类型选择；选「大生化」进入录入且类型已选中。
- [ ] 筛选「大生化」点添加 → 不弹层，直接进大生化录入。
- [ ] 大生化录入行可见单位（如 ALT 旁 `U/L`）。
- [ ] 填入一项检测值后，「已填」从 0 变为 1；切换类型后计数重置。
- [ ] 页内 chip 切换类型仍可用，且仍有未保存清空确认。
- [ ] 相关单测通过。
