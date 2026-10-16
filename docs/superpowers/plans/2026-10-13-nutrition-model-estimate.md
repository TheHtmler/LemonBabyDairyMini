# 食物营养AI估算实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标签或可信参考缺少指标时，按用户明确操作生成普通食材的AI估算，逐字段核对选用，并保存独立来源。

**Architecture:** 复用三个营养云函数、已有Qwen主备配置及识别草稿；识别函数新增estimate操作，读取服务端已核对身份和比较版本，估算与原标签、参考快照分开存放。确认保存仅采用服务端估算值，客户端不传可信数值，身份、基准或比较版本变更会使估算失效。

**Tech Stack:** 微信原生小程序、Node.js、CloudBase事务、百炼OpenAI兼容接口。

**Spec:** 本会话用户于2026-10-13明确同意“标签或可信参考优先，查不到时提供AI估算，用户核对后采用并保存”；原识别计划为 `docs/superpowers/plans/2026-10-12-nutrition-recognition.md`。

## Global Constraints

- 延续当前分支与会话逐项实现；不新增、修改或扩充单元测试；执行构建、既有回归、离线手工验收与实际微信编译。
- 不提交、推送、部署，不修改云端变量、数据库结构或权限，不调用真实模型或生产数据接口。
- 估算基准固定为每100g可食部分，可换算到表单的克数基准；不估照片重量、不做无密度的g/ml换算。
- 普通食物两种图片模式都可在确认身份后申请估算。奶粉、母乳、特医食品、明确品牌产品及泛称不开放估算；状态必须明确为生鲜、水煮或炒制。
- 只估算当前标签和已选参考都无可采用数值的字段，不自动覆盖手填，不把AI估算写进标签证据或可信参考集合。
- 主备共享25秒，仅免费额度明确不可用时切换一次；重复请求复用相同比较版本的结果。
- 保存 `fieldSources.model_estimate`、模型、生成时间、身份、基准、假设和数值快照；用户逐项选用后才参加现有营养统计。

## Review Focus

- 客户端伪造估算数值、字段来源、身份或版本时，服务端不得采信。
- 可采用的标签或参考字段不得被估算替代；真实0仍是可采用数值。
- 估算请求期间修改身份、基准、参考、关闭表单或切宝宝，迟到结果不得生效。
- 两次并发估算、同请求重发和确认保存重发不应造成重复模型调用或业务条目。
- 模型输出不完整、负数、错误单位、错误身份或缺失字段不得伪装为有效营养数据；奶粉和特医场景在服务端拒绝。

### Task 1: 估算规则及结构

**Files:** 新增 `packages/nutrition-recognition-core/estimate.js`，修改 `index.js`、`selection.js`。

**Interfaces:** 提供 `estimateEligibility`、`normalizeModelEstimate`、`validateEstimateBinding`；`buildConfirmedPatch`增加estimate参数和model_estimate来源。

- [x] 明确普通食材资格、克数基准、优先级与字段白名单。
- [x] 校验模型估算身份、100g基准、单位、数值、缺失及假设；估算与标签原值分层。
- [x] 本地合成输入验证优先级、真实0、非法输出及绑定，不保存为单测。

### Task 2: 云端按需估算

**Files:** 新增 `cloudfunctions/recognizeNutritionLabel/estimateService.js`，修改识别入口、modelClient、lookup入口、共享server。

**Interfaces:** `recognizeNutritionLabel({action:'estimate',sessionId,babyUid,requestId,comparisonVersion})`；结果包含estimate及comparisonVersion。

- [x] 新增仅文字的营养估算调用，复用配置、传输和免费额度切换。
- [x] 冻结已核对身份与比较版本，用事务声明请求并保存结果；重复调用返回现有结果。
- [x] 参考重新核对清除旧估算，后台旧请求完成时检查请求及版本，不落入新草稿。
- [x] 模拟并发、失败、超时和主备响应，确认未发起真实网络请求。

### Task 3: 确认保存与来源追踪

**Files:** 修改确认入口、必要的来源处理与食物列表展示。

- [x] 确认保存再次检查估算版本、身份、基准和可估字段，取服务端数值。
- [x] 保存独立估算快照和字段来源，不新增业务集合；保留食物和奶粉既有主源。
- [x] 列表标记仍采用AI估算的食物，普通编辑保留未修改字段来源；手填覆盖记录为manual。
- [x] 模拟估算采纳、伪造拒绝、多人版本变化和重复确认。

### Task 4: 核对组件

**Files:** 修改 `pkg-milk/components/nutrition-recognition/index.js/.wxml/.wxss`，必要时调整食物页。

- [x] 新增按需生成按钮、明确的AI估算提示和逐字段选用按钮，沿用现有暖色界面。
- [x] 普通实物无标签基准且表单为空时，提供100g参考口径；不把它当照片重量。
- [x] 名称、制备、基准和参考变更使估算及其已选字段失效，手填保留；切表单或宝宝隔离迟到结果。
- [x] 微信页面交互由用户自行验证；用户已明确要求停止启动微信工具，本地改为核对组件响应和选值检查。

### Task 5: 验收与交付

- [x] 运行公共模块构建、一致性、JS语法、diff检查及受影响既有回归。
- [x] 更新接入文档与验收记录，明确本地完成及云端未部署边界。
- [x] 按执行技能完成一次独立审查，处理实质问题，再报告实际验证结果。

## 执行裁定

- 用户已在同一会话批准功能并保留逐项实现方式，直接实施，不重复请求设计或执行方式确认。
- 用户单测规则优先于技能中的TDD要求，本次使用本地手工输入、既有回归及真实编译；不新增单测。
- 提交、生产数据库操作和部署继续等待用户明确授权，不作为本地实现的前置条件。
