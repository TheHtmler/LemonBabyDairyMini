# 千问已授权模型动态同步实施计划

> 执行方式：使用 superpowers:executing-plans，在当前会话逐项实现。

**目标：** AI 配置自动拉取当前业务空间已授权的千问模型，不再维护固定模型编号名单。

**方案依据：** 用户已确认自动同步、能力归类、保留启用状态和排序、新模型默认停用、提供手动刷新。

**架构：** 服务端分页查询官方模型授权及能力接口，缓存完整成功快照；管理员选择与上游名单分开保存。业务请求仅读取缓存，不查询上游目录。额度沿用原查询渠道，改用动态模型编号。

**技术栈：** 现有 Node.js HTTPS、CloudBase 文档事务、微信小程序，不新增依赖。

## 全局约束

- 使用功能分支 codex/dynamic-qwen-models，保留此前所有未提交改动。
- 不新增、修改或扩充单元测试；仅执行语法、静态检查和构建。
- 不启动服务、不进行界面或交互验收，不提交、推送或部署。
- 新模型默认未启用、未核验；原模型的选择和排序保持。
- 名单查询使用服务端 DASHSCOPE_API_KEY；不向前端、日志或数据库输出密钥。

## 审查重点

- 分页、授权查询或能力查询任一步失败，保留上次完整成功快照。
- 上游新模型、撤权和能力变化不覆盖管理员草稿或静默启用模型。
- 刷新名单与保存配置并发时，不能接受任意前端注入的模型编号。
- 旧共享地址缺少业务空间 ID 时，明确提示，已有业务配置仍可读取。
- 新 OCR 模型遵守输出上限，免费额度耗尽时可使用已启用的备用模型。

## 实施任务

- [x] 新增 packages/ai-access-core/modelDiscovery.js：可信北京地址、分页查询、响应校验、能力归类。
- [x] 修改 modelRegistry.js 并新增 modelCatalogSync.js：独立缓存、同步租约、旧配置合并、服务端名单校验和运行资格。
- [x] 修改 quotaSync.js：动态额度查询名单；接入 featureFlagManager 和定时入口。
- [x] 修改 AI 设置页面和展示计算：自动同步状态、手动刷新、动态名称、草稿合并和撤权状态。
- [x] 修改报告 OCR 调用：采用已核验动态模型、输出上限和备用切换。
- [x] 运行共享模块构建、语法及静态检查，刷新索引，记录实际结果和部署要求。

## 官方接口

- [已授权模型](https://help.aliyun.com/zh/model-studio/list-model-permissions)：GET /api/v1/models/permissions，authorization_scope=AUTHORIZED，action=INFERENCE。
- [模型能力](https://help.aliyun.com/zh/model-studio/list-models)：GET /api/v1/models，读取输入输出模态、结构化输出能力及输出上限。

## 验证与交付

- 对修改的 JavaScript 执行 node --check。
- 执行 npm run build:search、npm run check:search、npm run check:miniprogram-imports。
- 检查生成副本与共享源一致，审查差异及未授权文件的改动情况。
- 本地无法代替云端真实授权验证；交付时注明未部署、未进行界面验收及真实接口调用。

## 实施记录

- 已在用户确认范围后于当前会话完成实现；按用户规则不采用技能中的新增单测、自动提交或界面验收步骤。
- 已保留现有工作区改动，并对同文件中的血液报告两阶段流程采用增量接入。
- 独立审查指出的权限/能力异常快照及固定提示词 OCR 协议问题已修正；重新执行构建和静态检查通过。
- 验证结果与发布清单见 `docs/verification/2026-11-08-dynamic-qwen-models.md`。
