# 报告拍照识别辅助录入 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `add-report` 录入页新增"拍照识别"入口，通过微信云开发内置的通用印刷体识别能力，自动识别检测报告照片里的指标名称、检测值、参考范围并预填表单，用户仍需逐项核对后才保存。

**背景 / 已有能力盘点：**
- `ReportRepository.getHistoricalRanges` 已经实现"记住上次同类型报告的参考范围"，新建报告时自动带出。
- `add-report/index.js` 的 `calculateRatioIndicators` 已经实现血串联 C3/C0、C3/C2 比值自动计算。
- 因此本方案只聚焦"拍照识别自动填值"这一项。

**Architecture:**
- 识别调用必须在云函数里发起（`cloud.openapi.ocr.printedText` 是云调用 openapi，客户端 SDK 不能直接调），客户端只负责拍照/选图、上传临时文件、调用云函数、展示结果。
- 云函数只做"调用微信 OCR + 原样返回文本块"，不做业务解析，保持薄。
- 指标匹配/数值抽取放在纯 JS 工具模块 `miniprogram/utils/reportOcrParser.js`，不依赖 `wx` 全局对象，可用 `node --test` 直接单测，覆盖率友好。
- 录入页只做“状态编排”：拿到解析结果 → 合并进 `indicatorData` → 标记 `ocrPendingKeys`（未核对）→ 复用现有 `recalculateAllIndicators`。
- 识别结果永远不静默覆盖用户已手填的字段；用户碰过的字段自动从"待核对"列表移除；保存时如果还有未核对项，弹窗二次确认。

**Tech Stack:** 微信云开发云函数（wx-server-sdk, `cloud.openapi.ocr.printedText`）、WeChat Mini Program 页面、纯 JS 工具模块、Node 内置测试运行器。

---

### Task 1: 纯识别解析模块（先写失败测试）

**Files:**
- Create: `miniprogram/utils/reportOcrParser.js`
- Create: `tests/report-ocr-parser.test.js`

- [x] 定义每种报告类型指标的匹配别名表（中文名/英文缩写/常见报告写法，如 `methylmalonic_acid` → `['甲基丙二酸', 'mma']`）。
- [x] 实现 `groupOcrItemsIntoLines(items)`：把云 OCR 返回的 `{text, pos}` 列表按纵坐标临近关系合并成"行"，兼容一行被拆成多个文本块的情况。
- [x] 实现 `parseNumbersFromLine(text)`：从一行文字里抽取检测值 + 参考范围（支持 `50-300`、`50~300`、`(50.0-300.0)`、单独数值等常见写法）。
- [x] 实现 `matchIndicatorLine(line, indicatorConfigs)`：把行文本和指标别名表做模糊匹配（忽略大小写/全角半角/常见分隔符），并跳过紧跟在别名后面的括号缩写注释，避免缩写里的数字污染检测值。
- [x] 实现主入口 `parseReportOcrResult({ items, reportType })`，返回 `{ [indicatorKey]: { value, minRange, maxRange, sourceText } }`。
- [x] 覆盖测试：单指标单行、指标名和数值分属不同文本块、无法识别的噪声行、同一报告类型多指标行都能各自匹配、比值指标（c3_c0/c3_c2）不参与识别（由现有自动计算负责）。
- [x] 运行 `node --test tests/report-ocr-parser.test.js` 确认先失败再实现通过。

### Task 2: 云函数 `recognizeReportImage`

**Files:**
- Create: `cloudfunctions/recognizeReportImage/index.js`
- Create: `cloudfunctions/recognizeReportImage/config.json`
- Create: `cloudfunctions/recognizeReportImage/package.json`

- [x] `config.json` 声明 `permissions.openapi: ["ocr.printedText"]`。
- [x] `index.js`：接收 `event.imgUrl`（客户端按现有代码约定自己用 `wx.cloud.getTempFileURL` 换好临时地址再传入，云函数不重复换），调用 `cloud.openapi.ocr.printedText({ imgUrl })`，把 `items`（文本+位置）原样返回给客户端；捕获异常返回 `{ ok: false, code, message }` 而不是抛出，方便客户端展示友好提示。
- [x] 图片过大（云 OCR 限制 2M）时给出明确的错误信息（`errMsg` 包含 size 相关关键字时转成"图片过大，请重新拍摄"）。
- [x] **应用层 OCR 限额**（`quotaConfig.js` + `quota.js`）：在调用微信 OCR 前计数，默认全站日 90 次、每宝宝日 5 次、每宝宝月 20 次、每操作者日 15 次。报告录入场景下日限额够重拍纠错，月限额防滥用且远低于微信月额度。可在 `app_config` 热更新 `{ key: 'report_ocr_quota', value: { ... } }`。云函数成功/失败时返回 `quota` 剩余次数，录入页展示提示。

### Task 3: 录入页接入识别入口

**Files:**
- Modify: `miniprogram/pkg-report/add-report/index.js`
- Modify: `miniprogram/pkg-report/add-report/index.wxml`
- Modify: `miniprogram/pkg-report/add-report/index.wxss`
- Test: `tests/add-report.test.js`（新增识别相关用例，可拆到 `tests/add-report-ocr.test.js`）

- [x] 新增 `data.ocrPendingKeys`（数组）、`data.ocrRecognizing`（loading 态）。
- [x] 新增 `onRecognizeReportPhoto`：`wx.chooseMedia`（camera/album，单图）→ `wx.cloud.uploadFile` + `wx.cloud.getTempFileURL` → `wx.cloud.callFunction('recognizeReportImage', { imgUrl })` → 用 `reportOcrParser.parseReportOcrResult` 解析 → 合并进 `indicatorData`（只填空字段，不覆盖已有值）→ 更新 `ocrPendingKeys` → toast 提示"识别到 N 项，请核对"；识别完成后删除云端临时图片。
- [x] `onIndicatorValueInput` 里：字段被用户编辑时把该 key 从 `ocrPendingKeys` 移除，并同步清掉 `indicatorData[key].ocrPending`。
- [x] `onSaveReport` 前：若 `ocrPendingKeys.length > 0`，`wx.showModal` 二次确认"还有 N 项识别结果未核对，确定要保存吗？"（拆出 `performSaveReport` 承载原保存逻辑）。
- [x] WXML：报告类型区域上方加"拍照识别"入口按钮 + 识别中态；`indicator-row` 命中 `indicatorData[key].ocrPending` 时加 `pending-ocr` 样式 + "识别待核对"角标（没有在 WXML 里用数组方法判断，避免依赖未经验证的表达式支持）。
- [x] WXSS：`.ocr-entry`、`.indicator-row.pending-ocr`、`.ocr-pending-tag` 样式。
- [x] 补充测试（`tests/add-report-ocr.test.js`）：识别结果只填空字段不覆盖已填值；用户编辑后对应 key 从待核对列表移除；保存时有未核对项会先二次确认；拍照识别全流程编排；用户取消选图静默返回。

### Task 4: 全量验证

**Files:** 验证为主

- [x] 运行 `node --test tests/*.test.js`，确认全部通过（522 passed）。
- [x] 检查 `analysis-report`、`report-workbench-preview` 相关页面未被无关改动影响（未修改，测试仍通过）。
- [x] 在 `docs/miniprogram/analysis-report/readme.md` 补充说明新增的拍照识别入口和"仅供参考，请核对"边界。

**部署提醒（无法由代码自动完成，需要在微信开发者工具里手动操作一次）：**
- 用微信开发者工具右键新建的 `recognizeReportImage` 云函数目录 → "上传并部署：云端安装依赖"。
- 首次部署后云函数会自动带上 `config.json` 里声明的 `ocr.printedText` 权限，无需额外去公众平台后台加插件。
