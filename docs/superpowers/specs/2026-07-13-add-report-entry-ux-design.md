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
- 编辑模式同样显示单位与已填计数。

## 非目标

- 指标分组 / 折叠 / 搜索。
- 改 OCR、保存校验、参考范围逻辑。
- 新建独立选类型页面（用分析页弹层即可）。
- 改深链带 `type=` 的直达行为。

## 用户流程

### 添加（档案 Tab + 筛选 = 全部）

1. 用户点 FAB「+」。
2. 弹出类型选择层：展示与 `add-report.reportTypes` 一致的 6 项（图标 + 名称）。
3. 用户点某一类型 → 关闭弹层 → `navigateTo`  
   `/pkg-report/add-report/index?mode=add&type=<key>`。
4. 用户可点遮罩或取消关闭弹层，不跳转。

### 添加（档案 Tab + 筛选 = 某具体类型）

1. 用户点 FAB。
2. **不弹层**，直接  
   `/pkg-report/add-report/index?mode=add&type=<selectedFilterType>`。

### 添加（对比 Tab）

- FAB 在对比 Tab 仍可见时：用当前 `compareReportType` **直达**该类型录入（不弹层）。
- 不因对比 Tab 隐藏 FAB（本期不改 FAB 显隐规则）。

### 录入 / 编辑页

1. 顶部 meta（检测日期）下方或指标列表上方显示：`已填 {{filledCount}} / 共 {{totalCount}}`。
2. 每行在检测值 input 旁展示 `indicator.unit`（空则不渲染；对齐 `report-detail` 的 value-unit 习惯）。
3. 横滑类型 chip 保留；切换逻辑不变。编辑模式（`mode=edit`）同样生效单位与计数。

## 交互细节

### 类型选择层（分析页）状态机

| 状态 / 方法 | 行为 |
|-------------|------|
| `typePickerVisible` | `false` 默认；全部筛选下点 FAB 置 `true` |
| `onAddReport` | 见下方分支 |
| `onCloseTypePicker` | `typePickerVisible = false`（遮罩 / 取消） |
| `onSelectReportType(typeKey)` | 关闭弹层 → `navigateToAddReport(typeKey)` |
| `navigateToAddReport(typeKey)` | `wx.navigateTo` 到 `add-report?mode=add&type=` |

`onAddReport` 分支：

1. 若 `mainTab === 'compare'` → `navigateToAddReport(compareReportType)`。
2. 否则若 `selectedFilterType` 存在且 `!== 'all'` → `navigateToAddReport(selectedFilterType)`。
3. 否则 → `typePickerVisible = true`。

UI：底部 sheet + 遮罩（可参考 `pkg-misc/medications` 的 mask+sheet）；**z-index > 30**（FAB 当前为 30），避免被 FAB 盖住。

类型列表：优先抽到 `miniprogram/constants/reportTypes.js`（`key/name/icon`），`analysis-report` 与 `add-report` 共同 `require`；若本期不抽文件，则两处硬编码必须一致，并由单测强制断言 key/name/icon 一致。

### 已填计数

- `totalCount = currentIndicators.length`
- `filledCount`：**仅**统计 `currentIndicators` 各 `key` 在 `indicatorData[key].value` trim 后非空的项数（忽略 `indicatorData` 中残留的其他 key）
- `refreshFilledCount()`：相等则可不 `setData`
- **必须**在以下时机调用：
  - `initIndicators` 完成后
  - `switchReportType` 的 `setData` / `initIndicators` 后
  - `loadReportData`（编辑）加载完成后
  - 指标 `value` 的 `input` / `blur` 后
  - OCR 回填 `setData` 后
  - 血串联比值自动计算更新 value 后（若有）

### 单位展示

- 使用指标配置 `unit`；大生化已有，其他类型多为空则不显示。
- 位置：检测值 input 右侧（与详情页 value-unit 一致）。
- 本期不强制给血/尿串联补单位文案。

## 实现触点

| 区域 | 文件 | 改动 |
|------|------|------|
| 常量（推荐） | `miniprogram/constants/reportTypes.js` | 导出 6 项 `key/name/icon` |
| 分析页 | `miniprogram/pages/analysis-report/index.js` | `onAddReport` 分支、弹层方法、`navigateToAddReport` |
| 分析页 | `miniprogram/pages/analysis-report/index.wxml` / `.wxss` | 类型选择 sheet + 遮罩 |
| 录入 | `miniprogram/pkg-report/add-report/index.js` | 共用类型列表、`filledCount`/`totalCount`、`refreshFilledCount` |
| 录入 | `miniprogram/pkg-report/add-report/index.wxml` / `.wxss` | 已填进度、行内 unit |
| 测试 | `tests/add-report.test.js`、`tests/analysis-report-flow.test.js` 或 `tests/add-report-entry-ux.test.js` | 类型列表一致、`onAddReport` 三分支、单位节点、已填计数接线（**必做**） |

## 验收标准

- [ ] 档案 Tab + 筛选「全部」点添加 → 出现类型选择；选「大生化」进入且类型已选中。
- [ ] 档案 Tab + 筛选「大生化」点添加 → 不弹层，直接进大生化录入。
- [ ] 对比 Tab 点添加 → 不弹层，直达当前 `compareReportType`。
- [ ] 大生化录入行检测值旁可见单位（如 `U/L`）；编辑模式同样可见。
- [ ] 填入一项检测值后，「已填」从 0 变为 1；切换类型后计数按新列表重置。
- [ ] 页内 chip 切换类型仍可用，且仍有未保存清空确认。
- [ ] 类型弹层 z-index 高于 FAB；取消/遮罩可关闭。
- [ ] 相关单测通过（含两页类型列表一致性）。
