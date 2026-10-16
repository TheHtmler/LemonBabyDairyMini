# 自然语言搜索 V2 发布说明

状态：发布准备材料，尚未执行部署、配置变更、集合操作或线上请求。

本次增量须同步发布完整 `cloudfunctions/searchManager` 和小程序包。只刷新前端或只上传某个 JS 不足以启用 V2。首批首页搜索及扫描若也未发布，仍需同时核对 [原部署清单](2026-10-14-home-search-scan-deployment.md) 中已有功能的依赖。

## 构建和版本

在项目根执行：

```sh
npm run build:search
npm run check:search
```

本次协议为 `2`，能力版本 `search-2.0.0`，构建标识 `20261015-v2`。新客户端先检查服务端协议，版本不匹配时提示服务尚未就绪，不悄悄走旧解析链路。

共享源在 `packages/search-core`，构建同步到搜索云函数、小程序主包工具、搜索分包以及已有系统食物/奶粉云函数的 `lib/search`。只读日汇总工具由构建脚本从现有小程序纯计算源生成到 `searchManager/lib/intake`；不要手工只改生成副本。

涉及的主要文件：

- `searchManager/index.js`、`orchestrator.js`：统一入口、版本、状态与诊断。
- `intentV2Service.js`、`modelClient.js`：能力注册提示、严格 JSON 校验、有限修复及既有免费策略。
- `entityResolver.js`、`planCompiler.js`、`readRepository.js`、`contextRepository.js`：真实对象、权限内只读加载、编译、选择与分页上下文。
- `catalogQueryService.js`、`recordQueryService.js`、`metricQueryService.js`：资料、记录、实际系数与比较。
- 小程序 `utils/searchService.js`、搜索页 JS/WXML/WXSS，以及共享计算入口 `reportWorkbench.js`、`recipeNutritionUtils.js`、`dailySummaryV2Utils.js`、功能目录。
- 本轮未额外改变 `featureFlagManager` 的开关策略。缺省开放及显式关闭/范围限制沿用既有工作区逻辑，没有为 V2 放宽开关、宝宝权限或模型额度。

## 服务端前置条件

- 既有 `SEARCH_CURSOR_SECRET` 必须配置；已有签名用途区分分页与 V2 上下文，不把密钥放入小程序。
- 模型仍由既有 `DASHSCOPE_API_KEY`、`BAILIAN_BASE_URL`、免费白名单与已验证开关控制；`SEARCH_INTENT_MODEL`、可选免费备选模型、每日额度沿用现有配置。没有新增付费兜底或取消限额。
- 没有模型配置时，已确认的名称和完整语法仍可用；其它自然语言问题明确显示智能解析不可用。
- `search_query_sessions` 复用已有集合，新增 `context/search_response_v2` 类型，30 分钟过期；旧清理脚本按过期时间仍适用。模型账本复用 `ai_search_requests/ai_usage_counters`。客户端不得直接读写这些集合。
- V2 除既有资料外会读取 `medication_records`、`water_records`、`treatment_records`、`growth_records_v2`、`baby_info`，以及新旧饮食、喂奶记录；这些业务集合只读。
- 查询涉及 `babyUid + 日期字段 + _id` 分页及 `babyUid + updatedAt` 来源标记。资料包含系统来源、宝宝与共享范围过滤。请在测试环境核对实际 OR、Date/string 兼容查询及索引计划，不能把离线内存数据库当作云端索引验证。
- 运行时与函数超时须给 22 秒内部查询预算留余量，客户端 25 秒超时；沿用当前支持 `crypto/base64url/Object.fromEntries` 的运行时。

## 发布与验收顺序

1. 保留当前已发布包和云函数版本快照，核对生产实际版本，不直接删除旧入口。
2. 构建并上传完整 `searchManager`（包含全部 `lib`），在授权测试环境确认 capabilities 返回本次版本。
3. 按验收语料运行真实模型及数据读取验收，确认索引、额度、上下文与来源失败状态。
4. 上传匹配的小程序包，由用户使用合法 AppID 预览；核对“左卡摄入频次”、实际次数、系数序列/日均、重名选择及键盘布局。
5. 通过后按现有发布流程上线。需要恢复时使用保留的前后端版本组合，避免混用不兼容版本。

本轮没有执行上述线上步骤。

## 2026-10-16 增量更新

当前构建标识改为 `20261016-semantic-first`，协议仍为 2。自然问句改为模型优先，名称直查及明确降级仍保留；需同步完整搜索云函数和小程序包。页面控制台 `[search-version]` 可核对客户端及服务端构建。本轮仍未部署，详情见 [本次验收](2026-10-16-search-semantic-first.md)。
