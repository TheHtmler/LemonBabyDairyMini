# 首页搜索与智能扫描部署清单

日期：2026-10-14。状态：本地代码、构建与独立审查完成，**本清单尚未在云端执行**。

2026-10-19 更新：用户确认项目仍在开发／测试，只支持当前搜索实现。`searchManager` 仅保留 `capabilities/search/preview`，旧 `interpret/execute/metricDates` 已从本地代码退役。云端资源处理见[云函数与集合精简记录](2026-10-19-search-cloud-cleanup.md)。

本地证据见[验收记录](2026-10-14-home-search-scan.md)。集合创建、索引、权限、云端变量、部署、真实模型调用及实际清理均需按用户要求另行确认；本文不包含密钥。

## 1. 构建与部署文件

在项目根执行并确认退出 0：

```sh
npm run build:search
npm run build:nutrition
npm run check:search
npm run check:nutrition
```

营养识别的 39 个 `lib/core` 部署副本已纳入版本管理，新检出即可取得。上面的构建命令用于同步公共源码修改；仅拉取完整提交时无需为补齐这些文件而重新构建，但上传前仍需运行检查。修改 `packages/nutrition-recognition-core` 后，将源码和构建后的副本一起提交，不直接编辑副本。

上传完整云函数目录及构建生成的 `lib`：

- `searchManager`：`capabilities` 能力查询、`search` 统一搜索及 `preview` 资料预览。
- 更新 `featureFlagManager`：三个独立开关的管理员管理接口。
- 更新 `getSystemFoodIndex`、`getSystemPowderIndex`：版本 2 的营养状态与原始基准。
- 更新 `recognizeNutritionLabel`：自动识别、额度、目标绑定及显式估算。
- 更新 `lookupNutritionReference`：自动类型后的参考查询与比较版本。
- 更新 `confirmNutritionRecognition`：确认幂等、状态恢复与新增资料结果。
- 上传包含新搜索页、扫描页、原识别组件修改及首页入口的小程序包。

后三个营养云函数位于本轮开始时已有的未提交工作区中；应作为本次兼容实现一起核对部署，不能只上传新增搜索函数。依赖沿用仓库声明的 `wx-server-sdk`、`@cloudbase/node-sdk`，不要在部署时顺便升级核心依赖。

云运行时需支持当前代码使用的 `base64url`、`Object.fromEntries`、`crypto`、HTTPS 和 CloudBase 事务。云函数超时需留出模型期限及数据库操作余量；当前搜索编排及读取使用 22 秒预算，视觉模型主备共 25 秒，不要把函数超时设置得比相应内部期限更短。实际运行时与超时配置待测试环境核对。

## 2. 集合、权限与保留期限

新增集合：

- `search_query_sessions`：当前以 `kind=context/search_response_v2` 保存上下文与请求结果，30 分钟过期。旧 `state/candidate/page` 类型不再写入，过期后按现有脚本清理；集合本身继续保留。
- `ai_search_requests`：搜索、识图及显式估算的请求摘要、结果、状态和用量，24 小时过期，调用租约 60 秒。
- `ai_usage_counters`：按账号、上海日期和 `search/scan` 场景计数，7 天过期。估算计入 `scan`。

识别继续使用 `nutrition_recognition_sessions`：草稿及上传图片 24 小时；已开始确认的操作在同集合保留精简回执 30 天，不另建回执集合。

上述四个集合应拒绝小程序客户端直接读写，只允许经过服务端鉴权的云函数访问。普通搜索、预览、扫描草稿、绑定及保存状态均从云上下文取得账号，并重新校验所属宝宝。不要因增加搜索而把既有业务集合改为公开。

读取依赖：`baby_creators`、`baby_participants`、`feature_flags`、`food_catalog`、`powder_catalog`、`milk_nutrition_profiles`、`recipe_catalog`、`food_intake_records`、`feeding_records_v2`、`feeding_records`、`nutrition_reference`。确认保存继续使用原食物/奶粉资料集合及现有权限。

存储仍使用受会话校验的 `nutrition_recognition/<账号>/<宝宝>/...` 路径；不能开放跨账号任意上传或读取。实际云存储规则与图片回收需在测试环境验收。

## 3. 按实际查询核对索引

以下为代码查询字段及排序对应的候选索引清单，`↑` 表示升序、`↓` 表示降序，同一行是一个索引。先检查已有索引，避免重复创建；实际 OR、数组及不等过滤的执行计划须在测试环境确认，不能把本地审查当作索引已经生效。

```text
baby_creators
  _openid↑, babyUid↑
baby_participants
  _openid↑, babyUid↑
feature_flags
  key↑

food_catalog
  sourceType↑, _id↑
  ownerType↑, _id↑
  isSystem↑, _id↑
  babyUid↑, _id↑
  sharedBabyUids↑, _id↑
  babyUid↑, name↑
  sourceType↑, sourceFoodCode↑

powder_catalog
  sourceType↑, _id↑
  sourceType↑, powderCode↑
  powderCode↑

milk_nutrition_profiles
  babyUid↑, _id↑
recipe_catalog
  babyUid↑, _id↑

food_intake_records
  babyUid↑, date↓, _id↓
  babyUid↑, legacySource.collection↑, legacySource.recordId↑, legacySource.intakeId↑
feeding_records_v2
  babyUid↑, date↓, _id↓
feeding_records
  babyUid↑, date↓, _id↓

nutrition_reference
  status↑, source.verified↑, identity.barcode↑
  status↑, source.verified↑, searchTerms↑
  status↑, source.verified↑, identity.name↑
```

补充约束：

- `food_catalog` 私有来源还包含 `sourceType/ownerType/isSystem` 的不等过滤；`sharedBabyUids` 是数组字段。需验证多分支查询与剩余过滤的成本，不保证上述索引在任何数据分布下均高效。
- `food_catalog` 的 `babyUid + name` 用于绑定时检查已有资料；`sourceType + sourceFoodCode`、`sourceType + powderCode` 用于原系统索引函数。
- 当前记录读取仍支持 `feeding_records` 的字符串日期和 Date 日期；旧搜索接口退役不代表历史业务数据已完成迁移，不能据此删除该集合。
- `nutrition_reference` 名称兜底是未锚定、不区分大小写的正则；名称索引不保证该分支能快速定位，需用真实参考库规模验证。
- AI 请求、计数器及搜索上下文／请求结果按 `_id` 访问，不需要额外业务复合索引。现有清理脚本按 ID 重读，不依赖 `expiresAt` 查询索引。
- 新版 `searchManager` 部署并停用旧版本后，可删除 `search_query_sessions` 的旧候选索引：`kind↑, sessionId↑, emitted↑, date↓, time↓, stableId↑` 和 `kind↑, sessionId↑, emitted↑, rank↑, name↑, stableId↑`。默认 `_id` 索引保留；本地删除源码不会删除云端索引。

## 4. 服务端环境变量

普通搜索也必须在 `searchManager` 配置 `SEARCH_CURSOR_SECRET`：无默认值，至少 32 字符，使用独立随机密钥；轮换后旧游标失效，用户需重新查询。密钥只在服务端保存。

搜索与识别按需配置下列变量；模型能力、精确 ID、地域、账号额度及平台免费保护需先核实。

| 变量 | 配置语义 |
| --- | --- |
| `AI_FREE_ONLY_VERIFIED` | 只有字符串 `true` 生效，缺失默认禁用 AI；仅表示运营已核验，不会替平台开启免费保护 |
| `AI_FREE_MODEL_ALLOWLIST` | 逗号分隔精确模型 ID；默认空，主模型不在其中则 AI 不可用 |
| `DASHSCOPE_API_KEY` | 必填，无默认值，只放服务端 |
| `BAILIAN_BASE_URL` | 必填，无默认值；HTTPS 接口，不含用户名、密码、查询参数或片段 |
| `SEARCH_INTENT_MODEL` | 默认 `qwen3.5-122b-a10b` |
| `SEARCH_INTENT_FALLBACK_MODEL` | 默认无备用；候选 `qwen3.5-plus-2026-02-15` 需显式配置并加入免费白名单 |
| `BAILIAN_MODEL` | 扫描策略默认 `qwen3.7-plus`，部署时应显式设置；既有视觉客户端配置校验要求该变量存在 |
| `NUTRITION_FALLBACK_MODEL` | 默认无备用；必须免费白名单允许且不同于主模型 |
| `NUTRITION_FALLBACK_BASE_URL` | 未配置时沿用主接口 |
| `NUTRITION_FALLBACK_API_KEY` | 同接口时可沿用主密钥；更换接口时必须有备用专用密钥 |
| `SEARCH_DAILY_LIMIT` | 未设置或无效时默认 50；允许 0–10000 整数 |
| `NUTRITION_DAILY_LIMIT` | 管理员尚未保存界面配置时使用；未设置或无效时默认 20；识图与显式估算共享；允许 0–10000 整数 |
| `DEVELOPER_OPENIDS` | 可追加现有开发者名单；沿用既有管理员鉴权，不把管理员权限交给客户端 |

额度变量留空字符串会被转换成 0，表示不允许新调用；要采用默认值应不设置该变量，或显式填写 50/20。普通搜索不依赖模型密钥和额度，但需要游标签名密钥与查询集合就绪；未配置功能开关记录时默认开放。

营养识别次数现支持在“我的 → 配置 → 营养识别次数”设置。管理员保存后，`feature_flags/nutrition_daily_quota` 中的上限优先于 `NUTRITION_DAILY_LIMIT`；每个账号分别计数，修改上限不清空当天用量。入口、权限、构建与部署说明见 [营养识别次数管理配置](2026-10-20-admin-nutrition-quota.md)。

云环境取值沿用微信上下文 `ENV`，再取 `TCB_ENV` 或 `SCF_NAMESPACE`；没有有效环境时拒绝启动。不要在本地误填生产环境来执行验收。

当前统一搜索输出上限 1400 Token，视觉输出上限 1500 Token；只在精确错误 `AllocationQuota.FreeTierOnly` 时允许一次备用，429、超时、非法 JSON 和截断不自动切备用。应用内日次数不能保障服务商不收费，必须另行核实各主备模型“免费额度用完即停”。无法核实时保持 AI 关闭。

## 5. 默认开放与可选开关

三个通用功能默认开放，**无需在 `feature_flags` 新增这三条记录**。如需临时关闭或限制范围，仍可使用以下可选配置；它们不是环境变量：

- `home_search_enabled`：首页搜索与普通查询。
- `ai_search_enabled`：自然语言解析。
- `nutrition_scan_enabled`：营养识别与首页扫描，包含已有固定表单的识别调用。

记录缺失时等效于 `enabled=true, scope=all, allowOpenids=[]`。已有记录优先：显式关闭仍关闭，已有白名单仍限制范围。管理员 `getSearchScanConfig` 返回相同默认值；`updateSearchScanConfig` 仅在需要覆盖默认行为时使用。若先前已创建限制记录，可将其改为 `enabled=true, scope=all`，无需删除记录。下面仅示例临时关闭普通搜索的请求格式，常规部署不需要执行：

```json
{
  "action": "updateSearchScanConfig",
  "key": "home_search_enabled",
  "enabled": false,
  "scope": "all",
  "allowOpenids": []
}
```

默认开放不等于绕过 AI 配置：免费保护、精确模型准入及应用额度仍决定 AI 是否可调用。无需创建用户白名单；宝宝访问权限仍由服务端检查。显式关闭 AI 或扫描不影响手动维护资料，也不改变既有报告 OCR 开关。

## 6. 清理方式

脚本默认 dry-run，只读取显式提供的本地导出文件，不主动导出云数据，不自动扫全库，也没有设置 TTL 或定时任务。

```sh
node "scripts/cleanup-search-requests.js" --input "/本地路径/search-export.json"
node "scripts/cleanup-nutrition-recognition.js" --input "/本地路径/recognition-export.json"
```

搜索导出结构为包含 `ai_search_requests`、`ai_usage_counters`、`search_query_sessions` 三个数组的对象；识别导出为会话数组。导出可能含用户数据，需在授权范围内保存和处理。

实际执行另外需要 `--apply --env`，属于需确认的云端删除操作。执行会按 ID 重新读取并复核过期及租约；搜索清理同时覆盖当前 `context/search_response_v2` 与遗留 `state/candidate/page` 的过期记录。识别先清理属于该会话的图片，再压缩回执或移除到期会话；有效回执只保留身份、操作摘要、状态和结果定位，不保留完整营养正文。

不要给识别会话直接配置按 `expiresAt` 删除的 TTL，否则会跳过图片回收并提前删除仍在 30 天承诺期内的回执。首次部署后需要明确清理负责人或另行设计调度；仅写入过期时间不会自动删除云端数据。

## 7. 测试环境验收顺序

1. 确认测试环境与授权账号，核对现有集合、索引、运行时、事务支持、存储规则及可用模型精确 ID；准备脱敏资料，避免用生产宝宝历史或未经授权的图片验证。
2. 核查旧新迁移关系：软删除新记录仍压制旧来源；若硬删除导致映射消失，先查明实际数据，不能声称完整去重或擅自回填。
3. 创建所需集合/索引并部署完整云函数；无需预建三条功能开关记录；AI 免费保护确认前保留禁用的 AI 配置。核对 capabilities 在模型未配置时不会阻断首页其余功能。
4. 验证默认开放的普通搜索：检查功能角色、资料归属、名称/配料、每 100 克条件、历史快照、真实零/缺失、干粉/冲调液、大于 200 条分页、空中间页、同游标重放及权限撤销。
5. 平台确认免费用完即停后配置精确主备模型；验证 AI 搜索可用状态。检查示例原句、歧义补充、上海日期、1400 Token 输出容量、搜索总预算内的模型主备期限、实际用量与重复请求。通过授权测试方式验证免费错误边界，不能为了测试耗尽而无上限调用。
6. 准备食物包装标签、奶粉包装/营养表、普通实物三类图片，以及模糊、多产品、部分营养缺失样本；检查同次判类提取、1500 Token 容量、25 秒期限、来源标记、用户主动估算与日额度共享。
7. 开发者工具及真机验证相机权限、相册、取消、补拍、纠正类型、仅预览、加入资料、分类必填、双击保存、并发版本变化、保存后断网恢复、固定表单恢复、切账号/宝宝、返回、小屏和大字体。
8. 导出脱敏临时记录验证两项清理计划，确认 24 小时草稿/图片、30 分钟查询、7 天计数和 30 天回执边界；实际清理需另行确认。
9. 全部通过后发布小程序，三个通用功能默认对有权限的用户开放。出现问题可分别关闭开关；不要通过删除业务资料回滚功能。

## 8. 已知实现边界

- 搜索直接读取服务端原始目录及历史；系统索引云函数供资料页面使用。当前分页令牌绑定账号、宝宝、上下文及查询计划，读取前后核对来源摘要；详情会重新读取。这不等同数据库快照事务。
- 目录每页最多 20 条命中，当前读取器默认最多 5,000 次记录／摘要读取预算、22 秒期限；超出预算返回需缩短查询范围的状态。旧执行器的 200 条扫描预算已退役。
- 食谱支持名称、备注和配料，严格营养密度筛选明确排除；旧记录缺少快照或营养证据时不会从当前资料补值。
- 本清单不证明免费额度仍有效、模型质量合格、云端索引可用或真机通过。对应结果需追加到验收记录后才能宣称环境验收完成。

## 默认行为调整记录

- 用户明确要求通用功能默认开放；缺少三条功能开关记录时不再阻断搜索或识别。
- 本次调整仅需重新部署 `searchManager`、`recognizeNutritionLabel`、`featureFlagManager`，完整携带构建后的 `lib/ai`。本次没有前端改动；若前一版前端尚未上传，仍需完成原部署步骤。
- 本地验证完成后更新验收记录；实际云端开关、环境变量与部署尚未代为修改。
