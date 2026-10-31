# 管理员 AI 模型配置实施计划

> 执行方式：当前会话按 superpowers:executing-plans 顺序实施；保持未提交的搜索界面改动。用户不授权新增单测、界面验收、提交、推送和部署。

**目标：** 管理员可管理场景模型名单，查看真实免费额度，后端在有效期与免费保护边界内轮换。

**架构：** 共享层维护目录、配置、额度和运行状态；featureFlagManager 提供管理员接口；独立定时函数通过内置 HTTPS 查询官方 CLI 使用的网关；两个业务云函数使用同一选择器。

**技术栈：** 微信小程序 WXML/WXSS/JS、微信云开发 Node.js >=16.13、wx-server-sdk、内置 HTTPS/crypto；网关协议参照官方 CLI 2.7.2。

**设计：** ../specs/2026-10-30-ai-model-admin-design.md

## 全局约束

- 所有文案、注释和文档中文；不改本轮之外的搜索页面。
- 不新增或修改单测，不运行 UI 或交互验收。
- 不复制本机凭证上云；不修改线上数据或模型；云端授权属于部署步骤。
- 查询限于国内北京固定网关和目录内模型，凭证只在服务端私有环境与实例内存，不运行 CLI、不创建临时凭证文件。
- 保留原每日次数、搜索两次调用总预算、10 秒/25 秒截止时间。

## 重点审查

- 普通用户调用管理或刷新接口，应被服务端身份检查拒绝。
- 同步失败或缺失凭证不能抹掉成功快照，也不能伪报实时余额。
- 并发收到耗尽与成功结果时，成功不得解除另一个请求写下的耗尽标记。
- 候选模态、验证状态、保护状态、到期和快照新鲜度任一不合格都不得调用。
- 搜索纠错和备用不能突破两次 HTTP 调用；保存策略后缓存版本必须变化。

## 任务一：共享模型配置与状态

文件：新增 packages/ai-access-core/modelRegistry.js，修改 packages/ai-access-core/index.js、policy.js。

接口：readModelConfig(db)、saveModelConfig(db,input,openid)、readModelQuota(db)、getModelAdminView(db,env)、resolveModelPolicy(db,scene,env,now)、markModelUnavailable(db,model,reason)、recordModelSuccess(db,scene,model,reason)。

- [x] 实现七个精确候选及适用场景；新候选默认未验证。
- [x] 实现固定文档和版本事务、额度快照校验、跨场景阻断状态与最近运行记录。
- [x] 实现管理策略启用后严格资格过滤，未配置时沿用当前环境策略。
- [x] 对新增 JS 执行 node --check，并静态检查过期和并发状态更新路径。

## 任务二：额度查询及定时入口

文件：新增 packages/ai-access-core/quotaSync.js、bailianQuotaGateway.js、quotaDiagnostics.js；新增 cloudfunctions/syncAiModelQuota/index.js、package.json、config.json；修改 featureFlagManager/index.js、package.json；修改 scripts/build-search-functions.js。

接口：syncModelQuota(db,env,{force}) 返回规范化配额结果；管理 action 获取、保存、刷新均要求服务端管理员身份。

- [x] 用数据库租约合并重复刷新，成功快照 60 秒缓存。
- [x] 固定网关、接口与候选名单；余额和保护并发查询，25 秒总截止时间及 1 MiB 响应上限，脱敏错误诊断。
- [x] 校验余额、总额、到期和 autoStop；查询失败仅更新同步错误分类。
- [x] 补齐独立定时入口身份约束和五分钟触发配置。
- [x] 2026-10-31 移除云端 CLI 依赖，保留原 wx-server-sdk，适配现有 Node.js 16.13；用官方校验和验证的真实 Node.js 16.13.0 只读查询七个模型成功。

## 任务三：搜索和识别轮换

文件：修改 cloudfunctions/searchManager/intentV2Service.js、modelClient.js，cloudfunctions/recognizeNutritionLabel/index.js、modelClient.js。

- [x] 两个入口读取共享管理策略，保留每日业务额度计数。
- [x] 模型调用使用已过滤的有序名单，明确耗尽才永久阻断，按总预算轮换。
- [x] 成功记录实际模型，状态写失败时停止轮换；缓存加入配置版本。
- [x] 重新构建共享副本，执行 check:search 与相关语法检查。

## 任务四：管理员菜单与页面

文件：新增 miniprogram/pkg-misc/ai-model-settings/index.js、index.json、index.wxml、index.wxss；修改 miniprogram/pkg-misc/developer-config/index.js、miniprogram/app.json。

- [x] 复用管理员身份、账号变化和异步返回保护。
- [x] 显示同步状态、额度、免费保护、预计与最近实际模型、切换原因。
- [x] 支持场景切换、顺序、启停、核验与版本保存，不输入凭证。
- [x] 处理同步未配置、加载失败、权限拒绝与保存冲突；不把缺失值显示成零。
- [x] 运行小程序导入检查、JSON 解析和 JS 语法检查，不做页面验收。

## 任务五：代码验证与部署说明

文件：新增 docs/verification/2026-10-30-ai-model-admin-config.md。

- [x] 执行 build:search、check:search、check:miniprogram-imports、git diff --check。
- [x] 检查实际改动清单和秘密信息输出路径，不新增测试文件。
- [x] 记录检查结果、尚未执行的云端授权/续期和 UI 验收。
- [x] 列出部署者需要配置的凭证、运行时、触发器及数据库权限；此轮不部署。

## 执行结果

本地代码实现及计划内静态检查已完成。设计与代码均完成独立审阅，已修复轮询旧响应覆盖保存结果的问题。云端授权、依赖运行兼容、续期、部署及界面验收未执行，详见验证记录。按用户约定不执行 TDD、提交、推送或 UI 验收；本轮实施决策与验证记录作为执行台账。
