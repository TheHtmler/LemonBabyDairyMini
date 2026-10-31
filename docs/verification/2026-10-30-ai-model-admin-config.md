# 管理员模型配置：验证与部署记录

> 2026-10-31 最新规则见 [调用与额度查询解耦记录](2026-10-31-ai-quota-decoupling.md)。下文涉及“超过 15 分钟暂停 AI”“先刷新额度再保存或调用”的内容是历史实现，现已撤销；配置持久生效，额度查询仅供查看。

> 2026-10-31 已按现有 Node.js 16.13 改为内置 HTTPS 查询，移除云端 CLI 依赖。最新故障证据和操作见 [额度刷新排查记录](2026-10-31-bailian-quota-refresh.md)；不要再按旧方案升级运行时或安装 CLI。

## 本轮实现

- 分支：codex/ai-model-admin-config。保留此前搜索交互未提交改动，不提交、不推送。
- 管理员菜单新增“AI 模型配置”，搜索和识别分别调整名单、启停及业务效果核验。
- 配置、免费额度快照、跨场景耗尽标记、最近运行模型独立保存。
- 参照官方 CLI 2.7.2 的固定北京网关协议查询同账号七个候选；管理页手动刷新和五分钟任务复用内置 HTTPS 采集器。已用用户本机授权做只读查询，不将本机登录等同云端授权。
- 搜索纠错与轮换共两次 HTTP 调用、10 秒总预算；识别共两次、25 秒总预算。每日业务次数规则保留。
- 同步失败保留上次成功数据；成功快照超过 15 分钟暂停管理策略下的 AI。百炼保护关闭、到期、零余额或已确认耗尽均跳过。

## 本机查询证据

CLI 2.7.2 查询成功；七个模型的 autoStop 均为 true。

| 模型 | 查询时剩余 Token | 到期日 |
| --- | ---: | --- |
| qwen3.5-122b-a10b | 797138 | 2027-01-08 |
| qwen3.7-plus | 349857 | 2027-01-08 |
| qwen3.8-max-0902 | 1000000 | 2027-01-08 |
| qwen3.8-max | 1000000 | 2027-01-08 |
| qwen3.7-max | 1000000 | 2027-01-08 |
| qwen3.7-max-2026-05-20 | 1000000 | 2027-01-08 |
| qwen3.7-plus-2026-05-26 | 1000000 | 2027-01-08 |

以上只是本机查询快照；未导入线上数据库，也未作为页面假数据。

## 已执行的代码检查

- `npm run build:search`：通过，生成共享模块副本。早期曾采用 CLI 入口，2026-10-31 已替换为不需要子进程和 CLI 依赖的 HTTPS 查询。
- `npm run check:search`：通过，共享源与构建产物一致。
- `npm run check:miniprogram-imports`：通过，68 个页面/组件、386 个文件、440 处引用。
- 10 个修改/新增入口 JS 的 `node --check`：通过。
- 5 个相关 JSON 的解析：通过。
- `git diff --check`：通过。
- 设计独立审阅：没有重要遗留问题。
- 代码独立审阅：发现静默轮询旧响应可覆盖刚保存配置；已增加请求代次失效和配置版本防倒退，修复后重新执行静态检查。未进行交互复现，按用户约定未新增单测。

依用户约定，不新增或修改单元测试，不运行界面、模拟交互、截图验收或临时服务。不将静态检查表述为真机或云端集成验证。

## 实施决策

- 未创建新 worktree，在独立功能分支保留已有未提交 UI 改动；本轮只改管理员和模型接入文件。
- 初次没有保存管理配置时维持现有环境变量策略；保存后以云端名单为准，关闭策略开关暂停新的 AI，不悄悄回退付费或旧名单。
- 新候选默认不参与轮换且未标记业务效果验证；型号和官方能力支持不能替代业务样本核验。
- 未取得精确到秒的百炼到期时间，按到期日期北京时间 00:00 保守停用。
- 免费耗尽标记只由实际错误写入，成功返回和旧余额同步均不解除该标记。
- 固定官方 HTTPS 网关、只读接口、候选编号及响应大小，查询与可选续期共用 25 秒总预算，不放宽构建检查器，不执行 shell 命令。
- 云端续期需专用访问凭证；未确认最小权限前，不创建 RAM 用户、不扩大权限、不配置主账号 AccessKey。
- 独立审阅暂不判断的云端权限、触发来源、续期与实际业务效果继续作为部署验证；同一请求编号的历史结果沿用原幂等语义，新请求与意图缓存使用管理版本。

## 部署前操作清单（本轮未执行）

### 1. 函数与运行时

需要更新 searchManager、recognizeNutritionLabel、featureFlagManager，新增 syncAiModelQuota；同步发布小程序管理员入口。构建命令为 `npm run build:search`。

额度查询支持 Node.js >=16.13，用户已确认的 Node.js 16.13 与 60 秒超时可以保留，不需要为此重建函数。查询及可选续期上限 25 秒，另留数据库保存时间，函数超时至少 35 秒；数据库租约为 45 秒。真实 Node.js 16.13.0 本机只读查询已通过，不能代替云端网络和权限验证。

featureFlagManager 和 syncAiModelQuota 已移除 bailian-cli，只保留原 wx-server-sdk 依赖。上传更新后的完整函数代码（含构建生成的 lib/ai），按云开发正常方式安装原依赖即可；不再安装 bailian-cli 或 bailian-cli-commands。不要通过本次开发擅自升级其他云函数依赖。

### 2. 云端凭证

只在 featureFlagManager 和 syncAiModelQuota 的私有环境配置：

| 名称 | 用途 |
| --- | --- |
| BAILIAN_QUOTA_ACCESS_TOKEN | 百炼控制台访问令牌，必需 |
| BAILIAN_QUOTA_ACCESS_KEY_ID | 自动续期的专用访问凭证 ID，可选 |
| BAILIAN_QUOTA_ACCESS_KEY_SECRET | 与 ID 成对配置，可选 |
| BAILIAN_QUOTA_SECURITY_TOKEN | 使用 STS 时的临时凭证，可选 |

这些不是已有模型调用的 DASHSCOPE_API_KEY。仅配置控制台令牌可以先查询，失效后会提示更新；要长期无人值守，需要验证专用凭证允许 GenerateCLIAccessToken 及后续免费额度查询。新采集器按官方签名协议实现可选续期，仅明确鉴权失败时续期一次并重试；新令牌只在当前实例内存，不应误以为浏览器登录会永久自动续期。

查询授权与业务函数的 DASHSCOPE_API_KEY 必须属于同一阿里云账号，业务调用也须使用北京免费额度对应的业务空间；其他账号的免费保护状态不能作为当前调用 Key 的依据。

本轮诊断仅由本机进程内部读取现有授权，以验证只读额度查询；不在输出、聊天、仓库、数据库中回显或保存令牌，不上传完整 CLI 配置。云端凭证由部署者经私有配置渠道注入。若需要创建专用 RAM 权限，应先确认阿里云支持的精确权限并获得用户授权，不能用全权限替代。

### 3. 数据权限与初次启用

复用 feature_flags 集合；部署前确认小程序端不可直接读写其中管理文档，读写应通过服务端管理员接口。若现有集合权限不满足，权限变更需用户明确授权后处理。

新增文档由云函数首次保存或同步创建：ai_model_config、ai_model_quota、ai_model_state_<模型>、ai_model_runtime_<场景>。不需要手工填额度，不清空其他开关数据。

业务函数继续使用原来的官方北京模型接口与调用 Key；BAILIAN_BASE_URL 的域名支持 dashscope.aliyuncs.com、{WorkspaceId}.cn-beijing.maas.aliyuncs.com 或 trial.cn-beijing.maas.aliyuncs.com，均使用 HTTPS 与 /compatible-mode/v1 路径。合法业务空间专属地址不需要改成共享地址。管理员配置函数不需要模型调用 Key；查询授权独立配置。

先完成云端只读额度查询、检查实际到期日及保护状态，再核验令牌续期。之后开启 syncAiModelQuota/config.json 的 sync-ai-model-quota 定时触发器，表达式为 `0 */5 * * * * *`。最后由管理员选择经过业务样本核验的模型并保存启用。

不得将手工构造 Timer 事件当作普通小程序可访问入口；代码拒绝带 OPENID 的调用。不要给该函数增加匿名 HTTP 触发器。

### 旧环境变量清理（迁移后）

以下清单依据当前代码读取关系整理，尚未读取或修改线上环境变量。先部署更新后的业务云函数、成功同步真实额度并保存管理员模型配置，再清理旧模型变量；首次保存前仍会使用旧环境策略。

| 云函数 | 迁移后可删除的旧模型变量 |
| --- | --- |
| searchManager | SEARCH_INTENT_MODEL、SEARCH_INTENT_FALLBACK_MODEL、AI_FREE_MODEL_ALLOWLIST、AI_FREE_ONLY_VERIFIED |
| recognizeNutritionLabel | BAILIAN_MODEL、NUTRITION_FALLBACK_MODEL、NUTRITION_FALLBACK_BASE_URL、NUTRITION_FALLBACK_API_KEY、AI_FREE_MODEL_ALLOWLIST、AI_FREE_ONLY_VERIFIED |

searchManager 与 recognizeNutritionLabel 均保留 DASHSCOPE_API_KEY 和 BAILIAN_BASE_URL。searchManager 继续保留 SEARCH_CURSOR_SECRET 与 SEARCH_DAILY_LIMIT；recognizeNutritionLabel 的 NUTRITION_DAILY_LIMIT 是未保存专用每日次数配置时的默认来源，本轮不清理它。管理员身份、云开发和其他业务参数保持原样。

featureFlagManager 与 syncAiModelQuota 配置 BAILIAN_QUOTA_ACCESS_TOKEN，以及按实际授权方式选择的 BAILIAN_QUOTA_ACCESS_KEY_ID、BAILIAN_QUOTA_ACCESS_KEY_SECRET、BAILIAN_QUOTA_SECURITY_TOKEN。查询授权无需重复放进两个模型调用函数，也不需要在查询函数配置旧主备名单。

当前 max_tokens、JSON 输出模式和 enable_thinking 均由调用代码设置，不是已迁移到管理页的任意生成参数。对于不在清单里的历史变量，应核对确切键名后再决定，不能按 MODEL、SEARCH 或 NUTRITION 前缀整批删除。清理线上环境变量仍需用户明确授权。

### 4. 尚未完成的验证

- 云端部署、外网访问、私有授权注入及续期权限（本机真实 Node.js 16.13.0 查询兼容性已通过）。
- 云端定时触发、真实额度同步入库及模型轮换集成验证。
- 脱敏业务样本的新候选质量评估。
- 小程序编译器、真机与界面交互验收（须用户另行同意）。

## 配置页反馈修正记录

用户反馈：开启后点击“立即刷新”，显示“暂无符合条件的模型”；要求精简页面，由用户自行进行界面验收。

代码层面确认的原因：页面把模型资格过滤结果直接显示为统一占位语，刷新失败仅提示“请查看同步状态”，无法区分未配置云端授权、失败、过期和未启用。配置保存接口此前也允许无有效快照或无可用模型时保存启用状态。以上不能据此确定线上查询具体失败原因；当前没有可访问的腾讯云日志工具，正在确认云端查询令牌是否配置。

- 页面改为紧凑模型列表，合并启用/核验操作，运行与部署说明默认收起，保存按钮固定在底部。
- “立即刷新”明确为“刷新额度”，按实际同步结果显示成功、缓存、进行中或具体失败。
- 云端保存补充有效快照与至少一个可用模型的校验，返回 AI_CONFIG_NOT_READY；关闭配置仍可正常保存。
- 同步结果保留结构化 syncCode；查询令牌缺失与续期凭证不完整分别报错，不覆盖原有成功额度。
- 云函数未部署、版本过旧、调用超时分别提供对应提示；不回显原始接口响应或任何密钥。
- 新增纯展示辅助模块，集中计算模型状态、额度格式和保存资格，不调用模型、不修改云端配置。
- 已执行共享代码重建、check:search、check:miniprogram-imports、git diff --check 和 WXML 标签配对静态检查。
- 未新增或修改单测，未执行界面、模拟交互、截图检查或腾讯云函数调用；界面由用户验收。后续故障排查执行过真实百炼只读额度查询，详见最新排查记录。

## 2026-10-31 配置页排版修正

用户提供的截图显示：启用和排序按钮横向撑开，模型状态挤成竖排，到期日期在日期内部断行，底部保存区占用较大。代码确认项目使用 style:v2，旧页面没有为各原生按钮完整覆盖默认宽度，禁用态也只依赖属性选择器。

- 仅修改 AI 配置页 WXML/WXSS 与纯展示文案，保留全部事件绑定、权限、保存校验、云端查询和模型切换逻辑。
- 按钮使用页面内限定样式、明确宽度及原生 mini 尺寸；排序按钮各固定 44px，关键按钮保留至少 44px 触控高度。禁用态增加绑定一致的样式类，覆盖原生默认样式。
- 模型标题、额度/到期日和状态分别排布，日期整体不拆行，较窄空间允许字段之间换行；长标题可省略，完整模型编号仍在可展开的说明中。
- 缩短状态卡片文案，统一暖色与字号层级，保存栏改为修改状态和按钮横排，保留安全区与页面底部留白。
- 已通过小程序静态依赖检查（68 个页面/组件、387 个文件、441 处引用）、WXML 标签配对和事件绑定静态检查、WXSS 声明/括号与关键按钮尺寸静态检查、git diff --check。
- 未新增或修改单测，未启动服务、调用云函数或模型，未做界面、模拟交互或截图验收。界面由用户重新编译小程序后验收；本轮无须更新云函数。

## 2026-10-31 首次启用按钮修正

用户反馈点击其他模型的“启用”没有反应。静态追踪确认：已核验基线可直接切换，新候选先调用 wx.showModal；此前 confirmText 为五字“已核验启用”，超过微信官方类型定义中四字符限制。fail 回调又直接 resolve(false)，将接口失败混同用户取消，导致无提示且不更改草稿。

- 将确认按钮改为四字“确认启用”，保留业务核验确认要求。
- 弹框调用失败时显示明确错误与提示，finally 释放忙碌状态，允许重试；取消或失败均不标记已核验、不启用模型。确认后仍需点击保存配置。
- 已通过该页 node --check、小程序静态依赖检查、基于语法树的原生弹窗按钮文字长度静态检查（两个文案均不超过四字符）、git diff --check。
- 未新增或修改单测，未调用页面处理器或模拟 wx 接口，未进行界面或交互验收，未部署或调用云函数。只需重新编译小程序，由用户验收。
- 接口约束依据：[微信官方 API 类型定义 ShowModalOption](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)。

## 2026-10-31 保存事务繁忙修正

用户截图错误为 document.get:fail -501001 / ResourceUnavailable.TransactionBusy。静态追踪保存路径：saveModelConfig 在同一 runTransaction 中调用 modelStates(transaction, ...)，该辅助函数使用 Promise.all 并行读取多个模型阻断文档；开启多个模型时产生同一事务重叠操作，与错误吻合。没有连接云数据库复现，因此不将代码修正表述为线上验收通过。

- 仅将保存事务中的模型阻断状态读取改为 for...of + await；事务外的管理页查询和业务选择仍保留并行读取，避免增加业务请求延迟。
- 保留 expectedVersion 校验、有效额度/免费保护/到期与耗尽校验、事务原子提交和 SDK 内置冲突重试；不把资格校验移到事务外，也不盲目重试版本冲突等业务错误。
- featureFlagManager 对保存时明确的 TransactionBusy 或 DATABASE_TRANSACTION_CONFLICT 返回 AI_CONFIG_BUSY 与可操作中文提示；客户端既有失败分支会保留草稿并释放保存按钮，不要求用户丢弃修改。
- 共享源已构建同步到四个云函数副本。已通过 build:search、check:search（含小程序静态依赖检查）、Node.js 16.13.0 的六个相关 JS 语法检查、保存函数语法树静态检查（无 Promise 并行调用或并行辅助函数调用）、git diff --check。
- 本次只需重新部署 featureFlagManager 完整代码（含 lib/ai）即可使用修正；页面保留当前选择，部署后再次保存。本轮不修改小程序代码，不代部署，不新增或修改单测，不执行模拟数据库/界面交互验收，不调用真实云数据库或模型。
- 参考：[CloudBase 事务操作](https://docs.cloudbase.net/database/transaction)。本机已安装 @cloudbase/database 的 dist/commonjs/transaction/index.js 明确对 DATABASE_TRANSACTION_CONFLICT 进行有限重试，其他错误不自动重试。

## 2026-10-31 搜索不可用诊断

用户截图显示 AI 总开关已开启，搜索启用 qwen3.8-max-0902，界面显示额度已同步、100 万 Token、2027-01-08 到期、免费保护开启。该截图只证明管理员展示与已保存配置就绪，不能证明 searchManager 已部署同版代码，或该函数的调用凭证和接口地址有效。最初未获得搜索云函数真实返回/日志，当时无法确定具体根因。

后续用户提供北京时间 2026-10-31 11:02:51 的真实日志：managed=true、configVersion=2、reason=ENDPOINT_INVALID、apiKeyConfigured=true、endpointValid=false、candidateCount=0。据此确认该次请求在调用模型前被地址校验拦截；Key 存在并不代表已验证其权限。用户随后确认两个业务函数都使用官方北京业务空间专属域名（ws-前缀业务空间）。旧校验只允许共享域名，误拒合法地址，是迁移代码遗漏；此前要求改成共享地址的建议已纠正。保持用户现有专属地址与 Key，由代码正确识别，chat/completions 仍由调用代码拼接。

同条日志 quotaCheckedAt=1793411853410，对应北京时间 09:57:33；请求时已过去 65 分 18 秒，超过 15 分钟快照有效期，因此即使修正接口地址，仍需先成功刷新额度。需确认 syncAiModelQuota 五分钟定时触发器启用且同步成功；现有日志不足以判定未更新是未启用、失败还是部署环境不同。本轮不代改云端环境变量或触发器，不将给出修正步骤表述为线上已恢复。

- 静态确认 resolveModelPolicy 除名单外仍检查业务函数自身的 DASHSCOPE_API_KEY、北京 BAILIAN_BASE_URL；搜索功能访问开关、每日业务次数、实际模型 HTTP 响应也可能阻止解析。额度查询令牌不代替模型调用 Key。
- 仅增加失败诊断，不改可用资格、接口限制、调用次数、降级或免费保护：策略拒绝时输出 [ai-model-policy]，包含固定原因、配置版本、凭证存在布尔值、接口合规布尔值、额度更新时间和可用候选数；传统策略未就绪也单独标记。
- 搜索降级前记录 [search-ai-unavailable]，仅记录既有错误码与数字 HTTP 状态，避免真实名称降级掩盖原错误。所有新增日志均不包含密钥、接口地址、用户输入、模型响应原文或宝宝资料。
- 诊断原因含 SERVICE_DISABLED、ENDPOINT_INVALID、API_KEY_MISSING、QUOTA_STALE、NO_ELIGIBLE_MODEL、LEGACY_POLICY_UNAVAILABLE。搜索函数须保留 DASHSCOPE_API_KEY 和合法官方北京 BAILIAN_BASE_URL，名单参数迁移不等于删除调用凭证。
- 已通过 build:search、check:search（含小程序静态依赖检查）、Node.js 16.13.0 的六个相关 JS 语法检查、git diff --check。未新增/修改单测，未执行界面/模拟交互、云函数调用或真实模型请求，未部署或修改线上环境变量。
- 待用户确认 searchManager 部署状态及必要变量是否保留；如需获取本轮诊断，应更新 searchManager 完整代码（含 lib/ai），复现后仅提供上述两类脱敏日志。不能将诊断增强称为线上故障已修复。

## 2026-10-31 北京专属域名迁移回归修正

用户质疑搜索与拍照同时不可用是否源自迁移。对比 HEAD 旧实现与当前代码确认：模型客户端此前接受 HTTPS 地址，新托管策略新增 beijingEndpoint，但错误地只允许 dashscope.aliyuncs.com。管理员名单已读取成功（真实日志 managed=true/version=2），不是旧模型变量必须恢复；当前代码中识别、准备与估算也均由管理策略选择模型后再注入请求配置，未要求恢复已迁移的 BAILIAN_MODEL 等变量。

- 依据阿里云官方北京接入说明，放行旧共享域名和单个合法 DNS 标签的 cn-beijing.maas.aliyuncs.com 域名，覆盖用户现有业务空间与官方试用域名。仍限制 HTTPS、兼容路径、无非默认端口/凭证/查询/片段，不允许国际地域、伪造域名后缀或任意代理；调用地址不被代码改写。
- 策略返回固定的 unavailableReason/unavailableMessage。拍照 capabilities 在 required=false 时也能获得真实阻断原因并记录脱敏日志，接口配置原因归 CONFIG_MISSING，关闭服务/额度过期/场景无模型归 AI_UNAVAILABLE，停止全部伪报“服务未准备好”。
- 搜索错误和真实名称降级保留固定的具体原因。免费保护、额度时效、余额、日期、业务核验、场景、调用次数及管理版本等规则保持；15 分钟过期快照仍须刷新，不以域名修复绕过。
- 管理页说明改为启用云端定时任务后每五分钟同步，避免将代码中的调度声明误当作已部署的任务。
- 已通过 build:search、check:search（含小程序静态依赖检查）、Node.js 16.13.0 九个相关 JS 语法检查、git diff --check；独立静态审阅未发现 Critical/Important，确认四份构建副本一致、原调用门槛保留且前端可显示返回原因。依用户约定不新增/修改单测，不调用模型/云端API，不运行处理器或模拟环境，不做界面验收，不部署或修改线上变量。
- 应更新 searchManager 与 recognizeNutritionLabel 完整代码（含 lib/ai），保留现有地址和 Key，再成功刷新额度后验证两场景。四个云函数的共享副本均已构建同步，其余查询函数可随同版本发布保持一致。云端恢复与定时同步成功尚未验收。
- 官方依据：[北京地域及接入域名](https://help.aliyun.com/zh/model-studio/beijing-access-information)、[Base URL 总览](https://help.aliyun.com/zh/model-studio/base-url)。

## 官方资料

- [百炼额度命令](https://help.aliyun.com/zh/model-studio/cli/usage-quota)
- [百炼安装与授权](https://help.aliyun.com/zh/model-studio/cli/installation)
- [官方 CLI 源码](https://github.com/modelstudioai/cli)
- [免费额度与用完即停规则](https://help.aliyun.com/zh/model-studio/new-free-quota)
- [云开发函数与定时触发配置](https://docs.cloudbase.net/api-reference/manager/node/function)
