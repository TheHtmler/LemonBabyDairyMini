# 首页搜索与智能扫描实施计划

> 执行说明：使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development` 按任务推进；执行者先阅读本计划与设计文档，以复选框记录完成情况。遵守用户约束：不新增、修改或扩充单元测试，不自行提交、推送或部署。

**目标：** 首页提供统一搜索与直接拍照入口，完成普通搜索、自然语言条件搜索、自动识别预览及用户确认后新增资料。

**架构：** 普通查询与 AI 解析共用受限查询协议，云端负责鉴权、历史快照判断和分页。自动扫描复用现有营养识别服务，分离预览、目标绑定与确认保存。纯逻辑从共享源构建到运行目录，服务端策略不进入小程序包。

**技术栈：** 微信小程序原生 JavaScript/WXML/WXSS、云开发 Node.js 云函数、现有 wx-server-sdk、百炼兼容接口；不增加向量库、全文检索服务或第三方运行依赖。

**设计依据：** [首页搜索与智能扫描设计](../specs/2026-10-14-home-search-scan-design.md)。用户已整体认可设计，本文件补充工程接口与实施顺序。

**状态：** 2026-10-14 本地实现完成，构建、既有回归及三路独立审查通过。尚未部署、调用真实模型或进行微信真机验收。勾选表示已完成的本地工作；含真实环境验收或尚未逐项模拟的条目保留未勾选。详细证据见[验收记录](../../verification/2026-10-14-home-search-scan.md)与[部署清单](../../verification/2026-10-14-home-search-scan-deployment.md)。

## 全局约束

- 只覆盖功能入口、食物、奶粉、食谱、历史饮食；不接入其他记录内容、文档、联网问答或自动饮食建议。
- 历史条件使用当时快照与实际摄入；食谱支持名称、备注、配料搜索，排除严格的每 100 克营养筛选。
- 查询协议版本 1；原句最多 300 字符、关键词最多 100 字符、AND 条件最多 6 个；字段和操作符严格白名单。
- 统一 `Asia/Shanghai`，周一开周；无日期的历史查询显示“近 30 天”，支持全部历史。最近搜索本地保存最多 10 条，按账号与宝宝隔离。
- 每页默认 20 条命中；每次执行最多读取 200 个原始文档、处理 200 个展开候选，两项上限分别计数；这是单次工作预算，不是历史上限。
- 搜索主模型 `qwen3.5-122b-a10b`，视觉主模型 `qwen3.7-plus`；备用候选 `qwen3.5-plus-2026-02-15`。主备搜索共用 10 秒期限、500 输出 Token；视觉共用 25 秒期限，先验证现有 1500 输出 Token 容量。
- 每账号每日默认 50 次搜索解析、20 次识别提交；服务端事务预占、请求幂等。只有明确的免费额度不可用才允许一次已确认免费的备用；不自动转付费模型。
- 免费用完即停保护未核实时，AI 保持关闭；普通查询和手动筛选可用。原有估算仍仅限用户显式操作及现有可估算对象。
- 预览可缺项，保存前补齐；新增扫描流程只新增资料，不覆盖已有条目、不创建食用记录或分类。
- 所有云端动作从登录上下文取身份并重验宝宝权限；客户端、模型、游标中携带的身份均不能代替鉴权。
- 保留当前工作区既有修改；只编辑共享源，生成副本由构建脚本同步；每次修改后刷新 code-index。中文文档、界面文案及必要注释。
- 默认不新增或修改单测；采用既有检查、离线操作验收、微信端手动验收。云端集合、索引、规则、环境变量、部署、生产调用及 Git 提交另行确认。

## 重点审查条件

1. 标签真实零、旧数据默认零、微量和缺失容易混淆：只有可证明的已知值参加比较，任务 1、2 验收。
2. 第 201 条才命中、同日大量记录、旧文档内数组超过预算：翻页不漏项、不把中途零命中称为最终无结果，任务 3 验收。
3. 新旧迁移重复与已删除新记录：删除不能使旧记录复活；缺少迁移映射时不能宣称覆盖完整，任务 2、3 验收。
4. 切宝宝、改类型、补拍及慢请求返回：旧请求不能覆盖新状态或改变保存归属，任务 6、7、8 验收。
5. 模型调用或保存已经发出但连接中断：同请求不再次付费或重复新增，状态不明不当作确定失败，任务 4、7、8 验收。

## 共同接口与分工

### 查询协议

- `QueryPlan`：`schemaVersion/status/intent/scope/keyword/source/period/conditions/powderBasis/sort`。`source` 为 `all/system/mine`；`scope` 为 `feature/food/powder/recipe` 的非空数组，意图区分查资料与查历史。`powderBasis` 为 `dry/prepared/null`，奶粉比较未明确基准时必须补充；来源筛选只约束资料，不能将历史快照替换成当前系统资料。
- `intent` 为设计中的四种意图；`status` 为 `ready/needs_clarification/unsupported`。非 ready 结果带受限 `reasonCode` 与需补充的字段，不执行查询。
- `period` 支持 `today/yesterday/current_calendar_week/previous_calendar_week/last_n_days/current_month/range/all`；自定义日期使用 `startDate/endDateExclusive`，相对日期在首次执行时冻结。
- `Condition` 为 `{field, operator, value, unit, basisQuantity, basisUnit}`；营养字段与运算符沿用设计。能量单位为 kcal，其余规范单位为 g，钠规范单位为 mg；数值有限且非负，基准为正，单位不匹配不得猜测换算。
- `SearchCandidate` 为 `{id,type,source,sourceId,groupKey,name,date,time,actualQuantity,actualUnit,nutritionBasis,nutrients,provenance,locator}`；每个营养项为 `{state,value,unit,reason}`，state 为三态之一。
- `Locator` 为 `{kind,babyUid,date,recordId,mealBatchId,legacyIntakeId,sourceId}` 的按类型裁剪对象；客户端通过固定路由映射导航，不执行模型或服务器返回的任意 URL。
- `SearchPage` 为 `{items,nextCursor,scanComplete,partial,warnings,queryPlan,effectivePeriod,excludedScopes}`；后三项回显规范化条件、冻结的日期边界及被排除类型。`partial` 表示工作未完成或来源读取失败，warnings 使用固定代码。读取失败的来源不标记为耗尽，不伪造完整结果或全量总数。
- 云函数响应沿用项目形式：成功 `{ok:true,...结果字段}`，失败 `{ok:false,code,message}`。所有实际查询条件都回传供界面展示，包括默认日期及已排除类型。

### 云端边界

- `searchManager`：`capabilities({babyUid})`、`interpret({babyUid,requestId,query})`、`execute({babyUid,queryPlan,cursor,pageSize})`、`preview({babyUid,type,source,sourceId})`。
- `capabilities` 返回三个功能开关、允许的功能 ID、模型可用状态和应用额度状态，不返回密钥、白名单账号或宝宝历史。
- 普通名称在“全部”页拆成资料类别与历史类别查询，每组保留自己的条件和游标；功能匹配本地执行，但只使用服务端允许的功能 ID。复杂意图只查询其明确范围。
- `prepare` 新增 `purpose:'preview', mode:'auto'`；仍带 `babyUid/imageCount/requestId`。`recognize` 仍带 `babyUid/sessionId/requestId/fileIDs`，不删去现有上传文件校验参数。
- `bindTarget({babyUid,sessionId,targetType,requestId,comparisonVersion})` 返回绑定版本；目标类型只能是 `food/powder`，预览流程拒绝客户端指定已有 targetId。
- `confirmNutritionRecognition` 新增 `action:'getStatus'`；确认保存使用 `action:'confirm'`，原编辑表单无 action 的调用继续执行原确认业务。状态查询只读，不发起模型或保存。

## 任务 1：建立查询协议与三态营养计算

**文件：** 新增 `packages/search-core/{contracts,period,nutrition,match,index}.js`、`scripts/build-search-functions.js`；修改 `package.json`。

**接口：** 导出 `validateQueryPlan(input)`、`resolvePeriod(period,now)`、`normalizeNutrients(raw,evidence,basis)`、`matchCandidate(candidate,query)`、`rankCatalogCandidate(candidate,keyword)`。校验返回合法对象或抛出带 code 的错误；匹配返回 `{state:'matched'|'unmatched'|'unknown',reasons}`。

- [x] 在 contracts 定义上述精确协议及所有枚举；拒绝额外字段、非法组合、OR/嵌套逻辑、任意集合名/代码/正则/身份字段，禁止通过静默裁剪改变用户含义。
- [x] 实现日期与单位运算：首日含、末日不含；g 与 ml 无密度不转；干粉与冲调液必须显式区分；只有明确每份重量才换算每 100g。
- [x] 保留真实零和缺失证据；旧版写死的零没有可信字段状态时标为 missing；食谱密度条件返回排除原因，仅食谱范围直接 unsupported。
- [x] 构建纯模块到 `cloudfunctions/searchManager/lib/search` 与 `miniprogram/pkg-milk/search/lib/search`；新增 `build:search/check:search` 命令，检查模式只读并比较源与产物。服务端模块不复制到客户端。
- [x] 离线直接调用上述接口，记录结果到验收文档：2026-10-14 的上周应为 10-05 至 10-12（末日不含）；0.9 命中 `<1`、1 不命中；缺失/微量/无密度 ml 不命中；字段注入被拒绝。此步骤不创建或扩充测试文件。

**通过标准：** `npm run build:search` 后 `npm run check:search` 退出 0；相关 JS 语法检查通过，操作样例符合预期。

## 任务 2：实现资料与历史数据适配器

**文件：** 新增 `cloudfunctions/searchManager/{repository,catalogAdapter,dietAdapter,access}.js`；修改 `cloudfunctions/getSystemFoodIndex/index.js`、`cloudfunctions/getSystemPowderIndex/index.js`、`miniprogram/utils/systemFoodIndex.js`、`miniprogram/pkg-milk/utils/systemPowderIndex.js`。

**接口：** `assertSearchAccess(db,openid,babyUid)` 返回服务端授权上下文；`scanSource({accessContext,query,position,readLimit})` 返回 `{documents,nextPosition,exhausted,readCount}`；`expandDocument(document,memberPosition)` 可从子条目恢复；`normalizeCandidate(raw)` 生成任务 1 的候选；`previewSource(accessContext,selector)` 返回实时只读详情。

- [x] 资料读取对接 `food_catalog`、`powder_catalog`、`milk_nutrition_profiles` 内的自定义奶粉及 `recipe_catalog`；投影仅取检索字段、权限、版本和证据。按原模型核实奶粉档案字段，禁止因标题相同混合品牌/系列/段数。
- [x] 历史读取对接准确集合 `food_intake_records`、`feeding_records_v2`、`feeding_records`；旧 date 为日期字符串与 Date 的记录使用独立扫描源，再按上海业务日期归一化。
- [x] 食物用历史快照及 quantity；奶粉用实际 formulaComponents；不读取当前资料补历史营养、不使用 planned/prepared 数据、不重复乘完成比例。食谱条目不得当作独立吃过每项原料。
- [x] 迁移查询按 `legacySource.collection/recordId/intakeId` 建映射，包含软删除新记录；结合现有迁移标识压制旧来源。缺少映射的硬删除历史列入上线数据核查，不凭空重建或回填。
- [x] 两类系统索引增加营养字段状态、原始基准及来源证据，版本从 1 升到 2；云函数投影和客户端缓存同时更新，版本由代码决定，不能照抄调用者的 indexSchemaVersion。原显示路径保留其现有语义，搜索比较读取显式状态。
- [x] 私有资料与详情重验所属宝宝；系统来源只读允许公开的 active 条目。仅食谱营养条件返回明确不支持，混合查询附排除说明。
- [ ] 离线模拟数据库返回值，人工核对快照变更、部分喝完、真实零、同名不同品牌、软删除迁移、旧日期两种格式；不写入云端。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** 适配器不依赖 `wx`；无权限数据不进入候选；快照与缺失口径符合设计。确认各查询真实 where/orderBy 后记录所需索引到任务 10 的部署清单。

## 任务 3：完成普通查询、稳定游标与详情

**文件：** 新增 `cloudfunctions/searchManager/{index,queryService,cursor,querySessionRepository}.js`、`cloudfunctions/searchManager/package.json`；修改任务 2 的 repository。

**接口：** `executeSearch({accessContext,queryPlan,cursor,pageSize,now}) -> SearchPage`；`encodeCursor(state,secret)`、`decodeCursor(token,expectedContext,secret)`。游标用服务端环境变量 `SEARCH_CURSOR_SECRET` 做 HMAC 签名，默认有效期 30 分钟，密钥缺失时返回配置错误，不使用硬编码密钥或返回无法翻页的部分结果。

- [x] 实现 capabilities/execute/preview 路由，unknown action 拒绝；无 AI 配置也可完成名称和手动条件查询。
- [x] 游标绑定 openid、babyUid、条件摘要、协议与索引版本、冻结日期、查询开始时间及有效期；保存每个来源的扫描位置、旧文档子项位置和未消费边界，不嵌入私有正文。
- [x] 日期与 ID 稳定排序后跨源合并；历史展示遵守日期、时间、原 ID 顺序。若一个来源在当前日期仍有未知候选，先继续扫描该日期再放出较早结果，不能让预取的较旧记录越过未扫描边界。
- [x] 统一使用 `search_query_sessions` 保存短期扫描状态，客户端只持签名会话游标。状态与待排序候选位置按独立文档保存，使用 kind 区分；候选仅存来源定位、排序键和匹配状态，不存图片或原记录正文。当前日期尚未扫完时可返回空页和继续扫描状态，按排序键取出已完成日期的命中，避免巨大日期分组挤入一个游标或一个数据库文档。同一页号重复请求返回一致页结果，防止并发推进丢项。
- [x] 同时执行 200 文档读取和 200 候选处理预算，迁移查询及额外预取也计入读取预算；20 命中即停止输出，其余候选保留可恢复位置。扫描到预算但 0 命中时仍返回 nextCursor。
- [x] 资料按精确名、别名、部分匹配和稳定 ID 排序；历史返回稳定 groupKey 与逐次依据，由客户端合并“吃过的食物”，不伪造总数。数据改变后详情重读，不声称拥有数据库快照隔离。
- [ ] 离线手动验收：第 201 条命中、同日期超过 200 条、单旧文档超过 200 个子项、多来源缓冲、重复请求同游标、篡改游标、切宝宝、权限撤销、来源暂时失败；每项都检查不重不漏或明确刷新/重试提示。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** 全部来源结束才 scanComplete；部分失败可恢复，不能展示最终无结果。`node --check` 与 `npm run check:search` 通过。

## 任务 4：接入意图解析、独立开关与免费额度控制

**文件：** 新增 `packages/ai-access-core/{policy,usage,index}.js`、`cloudfunctions/searchManager/{intentService,modelClient}.js`（请求仓储统一收敛到共享 `packages/ai-access-core/usage.js`）；修改 `cloudfunctions/featureFlagManager/index.js`、`scripts/build-search-functions.js`、`scripts/build-nutrition-functions.js`；新增 `scripts/cleanup-search-requests.js`。

**接口：** `getAiPolicy({scene,openid,babyUid})`；`reserveInvocation({openid,babyUid,scene,requestId,requestHash,now})` 返回 cached/running/reserved/denied；`completeInvocation(reservation,outcome)` 保存状态和实际 usage；`interpretQuery({accessContext,query,requestId,now})` 返回已校验 QueryPlan。

- [x] 给 featureFlagManager 增加管理员专用 `getSearchScanConfig/updateSearchScanConfig` action，管理三个独立开关；缺记录默认开放、支持显式关闭及可选范围限制；不改变报告 OCR 开关。普通 capabilities 仅返回该账号可用结果，各业务 action 服务端重验对应开关。
- [x] 服务端配置 `SEARCH_INTENT_MODEL/SEARCH_INTENT_FALLBACK_MODEL`，默认模型采用设计值；视觉保留既有配置。免费保护核验配置为 `AI_FREE_ONLY_VERIFIED=true` 与逗号分隔的 `AI_FREE_MODEL_ALLOWLIST` 精确模型 ID，任一缺失则 AI 不可用，备用未列入时禁用；此配置只是运营确认记录，不能替代平台“用完即停”。
- [x] `ai_search_requests` 保存摘要、结果、状态和实际用量，24 小时过期；`ai_usage_counters` 按账号/上海日期/场景事务预占，保留 7 天。相同 requestId 不同摘要返回冲突；重复正在执行请求返回 running，不再调用模型。
- [x] 模型只接收查询句、受限 schema 和日期语义，不接收宝宝历史；非思考、JSON 输出、最多 500 Token。严格校验字段和语义，不明确阈值或奶粉基准返回补充条件。
- [x] 主备共享 10 秒期限；仅精确免费额度错误允许备用一次；403、429、超时、截断、非法 JSON 分别映射原因。主备在同次提交中合计应用次数一次，但分别记录实际 token 用量。
- [x] 已发出模型请求即计次；调用前失败可释放预占；连接中断或执行租约过期保持未知/失败状态，不自动重新调用。识图在任务 6 复用同一策略，主包不打包服务端库。
- [x] 清理脚本默认 dry-run，显式执行才清理过期解析请求与 30 分钟过期的查询会话及候选位置；不输出原句、图片或密钥。生产执行另行确认，不将清理脚本自动接入生产调度。
- [ ] 使用本地模拟响应人工核对正常 JSON、300 字符限制、歧义、额度耗尽、429、超时、主备共用期限、重复/冲突 requestId、并发额度预占；记录实际调用次数与预期一致。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** AI 关闭/不可用时普通 execute 不受影响；不会以错误类型不明为由切备用。真实免费额度、准确率与延迟留待授权测试环境验证。

## 任务 5：完成搜索页与结果导航

**文件：** 新增 `miniprogram/pkg-milk/search/index.{js,json,wxml,wxss}`、`miniprogram/utils/{searchService,searchFeatureCatalog,searchSession}.js`；修改 `miniprogram/app.json`、`miniprogram/pages/data-records-v2/index.js`；如资料页需要定位，修改 `pkg-milk/food-management/index.js`、`pkg-milk/powder-management/index.js`、`pkg-records/recipe-management/index.js`。

**接口：** searchService 封装任务 3、4 的四个 action；`searchFeatures(keyword,allowedFeatureIds)` 只匹配维护的功能字典；`createSearchSession({accountKey,babyUid})` 管理 epoch、每分类游标、滚动和最近搜索；`openSearchLocator(locator)` 映射固定路径。

- [x] 实现全部/功能/食物/奶粉/食谱/饮食记录分类、可编辑条件标签、名称建议、普通提交、显式智能搜索、补充条件、资料只读预览及加载更多。全部页每类先显示少量，再进入对应类别续查。
- [x] 输入仅本地建议；只有可明确识别的名称或功能走规则，复杂/不确定表达提交一次 interpret；手动改条件只 execute。AI 不可用时保留原句和手动筛选，不把复杂语句错误当成名称查询后宣称无结果。
- [x] 明确当前宝宝、默认近 30 天、营养比较基准及来源；需要干粉/冲调液或阈值时让用户选择；未知数据与食谱排除原因可见。区分“继续查找”“部分来源暂不可用”“最终无结果”。
- [x] 最近搜索最多 10 条并可清除；每分类保留条件和滚动。切宝宝、退出账号、权限失败清理私有结果；所有异步响应检查 session epoch。
- [x] 餐次沿用 `date + mealBatchId`；奶类沿用实际记录 ID。进入 tab 记录页使用一次性内存导航上下文，在 onShow 的提前返回分支前消费；`wx.switchTab` 不携带查询参数。旧记录无法直达时打开正确日期并说明。
- [x] 详情/管理页按 ID 定位需再次核对当前宝宝与资料身份；被删除、权限撤销时提示刷新，不跳今天。功能字典维护角色限制，后台入口不能仅凭客户端 userRole 放行。
- [ ] 微信开发者工具人工验收输入、清除、条件修改、来回切分类、返回恢复、首次/后台记录页导航和断网；本地模拟慢响应验证切宝宝不会回填旧结果。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** 普通名称查询的模型调用数为 0；复杂查询提交一次，改筛选不增加；展示顺序、历史依据及导航与结果一致。

## 任务 6：增加自动扫描与中立预览协议

**文件：** 修改 `packages/nutrition-recognition-core/{contracts,normalize,server,index}.js`、`cloudfunctions/recognizeNutritionLabel/{index,sessionRepository,modelClient}.js`、`cloudfunctions/lookupNutritionReference/index.js`；新增 `cloudfunctions/recognizeNutritionLabel/targetBinding.js`。

**接口：** 扩展现 `prepareSession(db,openid,event,env,now,allocateFileIds,onStage)`；新增 `bindPreviewTarget({db,openid,event,now})`。识别结果新增 resolvedMode 与字段证据，保留固定模式已有调用签名。

- [x] auto prepare 只创建预览草稿与上传位置，不读取/绑定奶粉档案；禁止 preview 携带已有编辑目标。原 food_label/powder_label/food_object 表单流程继续运行。
- [x] 一次视觉请求同时分类并提取身份、营养、基准和证据；resolvedMode 只取五个约定值；多产品、品牌/段数冲突和无法判定时进入待核对，不凭置信度猜测。
- [x] 识别前按任务 4 策略预占每日 20 次提交额度；现有固定模式识别也使用同一识别额度，不能通过入口差异绕过。增加开始时间和执行租约，超时进度可恢复，但不自动再次请求模型。
- [x] lookup 仅在身份明确后执行；无参考保持缺项，不自动估算。保持原普通食材显式估算资格限制和服务端来源验证。
- [x] bindTarget 只在主动加入资料时读取目标档案最新版本；保存 `targetProfileVersion` 或食物目标版本，并绑定身份摘要、基准、comparisonVersion。预览新增食物不可指向已有 foodId；发现相同资料提供查看。
- [x] 新图片、改类型、重新识别、参考选择或营养比较版本改变后使旧绑定失效；改类型必须重新识别，不能复用旧归一化结果。
- [x] 离线模拟单次模型返回，人工核对三类成功、uncertain、unsupported、多产品冲突、部分营养、重复识别及过期租约；运行原构建同步，不手改生成副本。

**通过标准：** preview/lookup 不写业务资料；普通一次识别只发起一次主调用；`npm run build:nutrition`、`npm run check:nutrition` 通过，1500 Token 截断有明确错误处理。

## 任务 7：补齐确认保存幂等与状态恢复

**文件：** 修改 `cloudfunctions/confirmNutritionRecognition/{index,saveRepository}.js`、`miniprogram/utils/nutritionRecognition.js`、`scripts/cleanup-nutrition-recognition.js`；新增 `cloudfunctions/confirmNutritionRecognition/confirmationRepository.js`。

**接口：** `beginConfirmation({openid,babyUid,sessionId,operationId,requestHash})`、`getConfirmationStatus({openid,babyUid,sessionId,operationId})`；结果状态为 `not_submitted/processing/saved/failed/unknown`。原 `createConfirmationHandler({db,context,now})` 增加 action 路由。

- [x] 确认前重验所有权、绑定类型、目标/比较版本、身份和字段来源；preview 仅新增。目标版本冲突保留草稿并提示重新绑定，不覆盖新档案。
- [x] 发起保存前持久化 operationId 与请求摘要；业务保存及最终回执同事务提交。同编号同摘要返回原结果，不同摘要拒绝；检查放在已 saved 的快捷返回之前。
- [x] getStatus 只读并重新鉴权；网络断开使用原 operationId 查询，处理中不重复写入。确认服务返回确定失败才允许修正后新操作，unknown 保留原提交供恢复。
- [x] 草稿和上传图片沿用 24 小时清理；成功/已提交操作的精简回执保留 30 天，不保留图片和完整营养正文。状态读取区分草稿过期与回执有效；过期后查不到不能宣称从未提交。
- [x] 本地持久化待确认提交的最小定位信息并绑定账号/宝宝；恢复只关联原宝宝，账号退出清理本地展示。用户切宝宝后收到保存成功不能更新新宝宝资料缓存。
- [ ] 离线模拟双击保存、相同编号不同内容、成功后连接中断、保存中途进程退出、版本冲突、草稿过期及回执过期；验证只有一次业务写入，状态提示与事实一致。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** 恢复查询不会发起模型或保存；不因清理草稿丢失仍承诺可查的保存回执；构建一致性及语法检查通过。

## 任务 8：完成独立扫描页及复用组件

**文件：** 新增 `miniprogram/pkg-milk/nutrition-scan/index.{js,json,wxml,wxss}`；修改 `miniprogram/pkg-milk/components/nutrition-recognition/{index.js,index.wxml,index.wxss,workflow.js,dialogState.js}`、`miniprogram/app.json`。

**接口：** 组件增加预览用途与 auto 模式；工作流分别暴露预览结果、绑定目标、保存及恢复状态。页面只管理路由、相机和所属宝宝，复用既有字段选择及校验逻辑。

- [x] 首次进入直接调相机，取消后保留重新拍照/相册入口；拒绝相机权限不循环弹窗。沿用最多 3 张、质量与单图大小约束。
- [x] 覆盖等待图片、上传、识别、待确认类型、预览、补齐资料、保存中、已保存、可重试错误；上传/识别进度真实反映步骤，不伪造完成。
- [x] 预览可仅有名称或部分营养；缺项明确显示，不提前执行保存必填校验或新建分类。主动加入后 bindTarget，再使用原字段核对和必填校验。
- [x] 补拍与类型纠正需用户提交新识别；旧结果标过期并清理依赖。页面卸载、返回、切宝宝或重新拍照均提升 epoch，忽略过期响应。
- [x] 保存中展示归属宝宝、禁止重复提交和本页切换；中断后走任务 7 的只读恢复。查看已有条目不会覆盖它；成功后刷新原宝宝资料缓存，不创建饮食记录。
- [ ] 微信端逐项手动验收相机/相册、取消、拒绝权限、补拍、缺项预览、保存补齐、改类型、返回、断网恢复；既有食物/奶粉编辑表单各做一次识别与取消回归。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** 相机和图片权限由真实微信端确认；模拟结果只证明逻辑，不作为真机验收。纯预览全过程无业务资料写入。

## 任务 9：首页入口、公告弱化与本地结果失效

**文件：** 修改 `miniprogram/pages/daily-feeding/index.{js,wxml,wxss}`、任务 5 的 searchSession；按写入入口接入 `miniprogram/models/{food,foodIntakeRecord,feedingRecordV2,nutritionProfile,recipe}.js`、`miniprogram/pkg-milk/models/powderCatalog.js` 及识别确认成功回调。

**接口：** `invalidateSearchForBaby(babyUid,reason)` 维护本机查询修订号；页面 onShow 对比修订号并提示刷新。公告已读 key 由账号与内容摘要组成。

- [x] 按 capabilities 显示通栏与独立扫描点击区；首页仅导航分包，不引用分包组件。搜索关闭时维持原首页可用；扫描关闭时不露出可点击的失效入口。
- [x] 用“搜索食物、记录、功能”占位；公告缩成“查看更新”，沿用 visible/text 配置，完整内容仍可查看，新内容才显示未读。
- [x] 本机新增/编辑/删除相关资料或记录成功后提升对应宝宝修订号；失败不误报成功。查询返回前检查 session 与修订号，旧游标作废并显示刷新提示。
- [ ] 手动验收搜索与扫描点击区、长公告、小屏幕、较大系统字体、返回首页、账号与宝宝切换；检查原宝宝卡、统计和快捷记录不受布局影响。 **部分完成：本地验证范围见验收记录，其余环境或并发场景仍需补验。**

**通过标准：** 首页事件不串触；公告完整可读；普通查询、扫描和各自关闭状态都有可用入口与提示。

## 任务 10：整体验证、部署清单及交付

**文件：** 新增 `docs/verification/2026-10-14-home-search-scan.md`、`docs/verification/2026-10-14-home-search-scan-deployment.md`；更新本计划复选框与设计完成状态。

- [x] 保存实现前已有工作区状态与相关既有检查结果；区分本次新增问题和既有失败，不修改测试去消除失败。
- [x] 对本次全部 JS 源与生成文件逐一执行 `node --check`，JSON 可解析、页面注册/组件路径可解析；运行 `npm run check:search`、`npm run check:nutrition`、`git diff --check`。根项目没有统一 lint/typecheck 命令，不虚构通过记录。
- [x] 按改动运行既有离线用例：`node --test "tests/food-intake-record-model.test.js" "tests/feeding-record-v2-model.test.js" "tests/feeding-record-v2-utils.test.js" "tests/daily-record-v2-service.test.js"`；其余既有回归按实际影响选择，保持测试文件不变。
- [x] 将设计第 10 节 12 项验收逐项记录为通过/失败/待环境验证，并附命令或操作证据；邀请独立代理审查权限、快照、分页、幂等和模型调用边界，修复后针对性复验。
- [x] 部署清单列出新增/更新云函数、所有集合及精确复合索引、仅服务端可读写规则、24 小时/30 天清理策略、环境变量名与默认开放的可选开关；不写入密钥。明确列出 `search_query_sessions`、30 分钟过期及服务端独占规则，包含其状态/候选/已生成页回执的清理范围。
- [x] 列出测试环境验证素材与步骤：授权账号、旧新迁移映射、三类图片、真实模型 JSON/延迟/Token 截断、免费额度用完即停与备用精确 ID、微信端真机体验。使用敏感图片或生产 API 前获取相应授权。
- [x] 先交付可审查的本地代码与部署清单，再就具体云端变更按用户要求确认；发布顺序为测试环境验证、验证普通搜索、完成免费保护配置后验证 AI 解析与扫描；无需创建三条功能开关记录。关闭 AI 开关不影响手动业务。

**通过标准：** 本地实现与可执行检查均完成、未决环境项明确列出；未部署不能宣称上线。`check:babyinfo-duplicates` 与 `check:caregiver-roles` 会访问云端数据库，不作为默认离线检查执行。

## 顺序、评审与计划自查

- 执行依赖：1 → 2 → 3 → 4 → 5；6 依赖 4；7 依赖 6；8 依赖 6、7；9 集成 5、8；10 验收整体。纯只读调研与独立审查可以并行，公共协议与生成脚本修改由同一执行者整合。
- 推荐由主代理按任务连续实现，再做独立整体审查：搜索和扫描共享权限、额度、会话与构建规则，统一整合可减少接口偏差；也可选择每任务独立实施和审查的方式。
- 设计覆盖自查：设计第 3、8 节对应 5、9；第 4、5 节对应 1–5；第 6 节对应 6–8；第 7 节对应 4、6、7；第 9、10 节对应各任务文件清单与任务 10。
- 接口自查：页面/云函数使用同一 QueryPlan 与 SearchPage；识别保留 babyUid/fileIDs；绑定锁定 comparisonVersion；保存状态始终沿用 operationId。五项重点审查均有归属任务和具体验收输入。
- 相较设计新增的工程决定：查询会话及游标默认 30 分钟、保存精简回执保留 30 天、系统索引版本 2、旧日期两类扫描源。它们不改变用户确认的范围与业务口径；真实部署前按清单确认配置。

## 实施后的工程备注

- 原始文档与候选处理上限为代码常量 200；扫描循环分别预留最终重读预算（读取阈值 160、展开阈值 180）。当前没有对应环境变量。
- 游标绑定协议及索引结构版本 `1:2:2`，不绑定实时系统资料数据版本；本地写入以宝宝修订号失效，跨设备数据更新没有快照隔离保证。
- 搜索、扫描及显式估算共用请求仓储；显式估算计入每日扫描额度。三个通用功能缺记录默认开放，已有显式配置优先。
- 清理脚本依赖显式提供本地导出，并按 ID 重读复核；没有自动全库扫描、TTL 或定时调度。本地文档完成不代表已部署。

- 后续用户明确要求通用功能默认开放：未创建 `feature_flags` 三条记录时等效于全部开放，AI 免费保护、调用额度和宝宝权限继续执行。
