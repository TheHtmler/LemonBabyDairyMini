# 图片识别与营养参考比对技术实施方案

> **执行要求：** 按任务使用 `superpowers:executing-plans` 执行；若用户选择分任务实施及独立审查，则使用 `superpowers:subagent-driven-development`。通过复选框记录进度，实施方式由用户审阅后确定。

**目标：** 食物、奶粉拍照解析后匹配可信营养参考，用户确认最终值，再保存到现有业务集合并保留来源证据。

**架构：** 图片解析、参考查询与确认保存分别由三个云函数负责。参考快照只读，识别草稿与业务条目分开；纯数据校验、单位换算和比对逻辑共享一份实现。小程序保留现有表单保存入口，接入识别、核对及保存结果刷新。

**技术栈：** 原生微信小程序、CommonJS、Node.js内置 `https`、`wx-server-sdk`、CloudBase服务端SDK、云数据库及云存储。验证使用语法/静态检查、构建检查、现有回归用例和手动验收；沿用现有SDK版本，不升级项目核心依赖。

**设计依据：** [微信小程序拍照识别接入文档](../../LemonBabyDairyMini_微信开发者接入文档.md)，尤其第2、3、5、7节。

## 全局约束

- 分支：`codex/wechat-photo-recognition`；项目根目录：`/Users/randyhsu_m4/Documents/workspace/MyProjects/LemonBabyDairyMini`。
- 主模型 `qwen3.7-plus`；推荐备用 `qwen3-vl-flash`，最终通过云端环境变量配置。仅 `AllocationQuota.FreeTierOnly` 触发一次备用调用。
- 主备模型共同使用25秒总时限；超时销毁底层请求。识别函数配置60秒、512MB。
- 图片只接收当前云环境中的JPEG/PNG，1～3张，单张实际内容不超过3MB；校验文件内容，不仅看扩展名。
- 每次操作校验 `OPENID + babyUid`；识别草稿只能由发起者操作。密钥与接口地址只在云端配置。
- `food_object` 仅识别身份，营养来自已核验参考；模型不能为缺失字段生成推测数字。
- 比较同食物/产品、同制备状态、同营养定义的数据；不在缺少密度时互换g与ml，不把NRV当含量。
- 未确认草稿24小时过期；保存后的必要证据随业务条目保留。保存失败保留前端核对状态。
- 食物主集合 `food_catalog`；奶粉主集合 `milk_nutrition_profiles`，目标字段 `formulaPowders`；不新增旧营养设置集合的并行写入。
- 代码注释、文档和新增界面文案使用中文。每次文件修改后刷新项目索引。
- 按最新用户规范，默认不新增、修改或扩充单元测试；即使技能要求TDD，也不能自行覆盖此偏好。确需编写单测时，先说明具体原因并取得用户明确同意。允许运行现有用例，不改测试文件。
- 依改动执行语法/静态检查、构建和手动验收；有适用的类型检查时运行现有检查命令。手动验收记录输入、预期行为及实际输出，不以自动化单测脚本替代手动验收。
- 本计划不执行提交、推送、生产集合创建、数据导入、云端环境配置或部署；这些操作分别取得明确授权后执行。

## 重点审查输入

1. 同名或泛称食物、制备状态未知：只能返回候选或不匹配，不能自动采用错误参考；任务四验证。
2. 空值、微量标记、未知历史0及NRV列：不能归一化为确认营养0；任务一、二验证。
3. 图片路径含他人身份、跨环境文件、伪装文件类型：不能读取或发给模型；任务三验证。
4. 核对期间切换宝宝、关闭弹窗或手动改值：迟到响应不能覆盖其他表单；任务六验证。
5. 重复提交、多人编辑及奶粉档案整份更新：不能重复新增或覆盖更新；任务五验证，并检查同档案的其他写入口。

## 文件职责与公共契约

公共模块放在 `packages/nutrition-recognition-core/`，包含 `contracts.js`、`normalize.js`、`reference.js`、`selection.js`、`index.js`。`scripts/build-nutrition-functions.js` 将这份源码同步到三个函数目录的 `lib/core/`，函数只引用本目录内模块；生成文件由构建脚本维护，部署前检查产物与源文件一致，避免云端依赖项目根目录文件。

每个新增云函数都包含自己的 `index.js`、`package.json`、`config.json`；声明实际使用的SDK依赖，不借用项目根目录的开发依赖。页面交互集中在共享工具内，不重构两页已有的食物分类、蛋白角色或母乳逻辑。

核心数据结构用 `contracts.js` 的白名单和校验函数固定，字段说明如下：

```text
Basis = { quantity: number|null, unit: g|ml|portion|null,
          material: food|dry_powder|prepared_formula|unknown }
NutrientValue = { value: number|null, state: present|missing|trace|below_limit|unverified,
                  unit: string, definition: string,
                  evidence: { imageIndex: number, text: string }|null }
Nutrients = { calories, protein, fat, carbs, fiber, sodium } // 值均为NutrientValue
Identity = { name, aliases, preparation, brand, series, stage, barcode }
Observation = { identityCandidates: Identity[], basis: Basis, nutrients: Nutrients,
                formula: { powderGrams, addedWaterMl, preparedVolumeMl,
                           scoopCount, scoopGrams }, missingFields, warnings }
Reference = { referenceId, identity: Identity, basis: Basis, nutrients: Nutrients,
              source: { provider, recordId, url, dataType, version, verified } }
FieldDecision = { path: string, source: label|reference|manual, value?: string|number }
Comparison = { version: number, referenceId: string|null,
               status: matched|ambiguous|not_found|unavailable,
               fields: [{ path, observed, reference, delta, deltaPercent,
                          state: comparable|missing_observed|missing_reference|
                                 incompatible_basis|incompatible_definition }], warnings }
```

热量单位固定kcal，蛋白/脂肪/碳水/纤维为g，钠为mg；`quantity` 不确定时禁止自动生成营养回填。`definition` 按数据源字段字典维护，未知定义不用于跨定义差异判断。制备状态使用设计文档中的枚举；产品身份缺失保留 `null`。模型原始值、规范值和用户最终值分别保留。

会话文档 `_id` 由服务端使用发起者、宝宝和 `requestId` 计算，避免重复请求创建多份草稿。状态包含识别中、已解析、身份已选、已比对/无参考、待保存、已保存、失败；保存后封存。重复识别请求返回已有状态，不再次调用模型。

三个接口统一返回 `{ ok: true, ... }` 或 `{ ok: false, code, message }`。解析错误使用设计文档已有错误码；参考和保存阶段另外使用 `SESSION_EXPIRED`、`REFERENCE_UNAVAILABLE`、`COMPARISON_STALE`、`VERSION_CONFLICT`、`VALIDATION_FAILED`、`SAVE_FAILED`。

## 任务一：数据校验与单位换算

**文件：** 新建公共模块的 `contracts.js`、`normalize.js`、`index.js`；新建构建脚本并在 `.gitignore` 中登记生成目录。验收记录统一写入 `docs/verification/nutrition-recognition.md`，不创建测试文件。

**产出接口：** `normalizeObservation(raw, { mode, imageCount }) -> Observation`；`toComparableBasis(observation, reference) -> { observed, reference, warnings }`；`validateFinalPatch(mode, patch) -> { valid, missingFields, errors }`。输入结构、允许字段和缺失状态来自公共契约。

- [ ] 实现上述接口；检查非负有限数值、图片证据下标、合法路径及计量基准。奶粉只有可靠粉重与成品体积才从冲调液换算；每勺克数只能与明确勺数相乘得到粉重，不能把成品体积当加水量。
- [ ] 对公共模块运行 `node --check` 语法检查；在本地控制台逐项调用接口，确认0保留而缺失/微量/无效值不转成0；`418.4 kJ`换为`100 kcal`，`0.1 g`钠换为`100 mg`，每份50g蛋白5g换为每100g蛋白10g；无密度ml/g不可比，NRV不进入营养patch。
- [ ] 手动验收奶粉换算、未知基准、截断/错误类型及精度，记录实际输出；使用合成数值时明确注明，不写成真实产品标准。
- [ ] 先执行 `node "scripts/build-nutrition-functions.js"` 生成当前已实现的公共模块，再执行 `node "scripts/build-nutrition-functions.js" --check` 验证产物可独立加载且没有越过云函数目录的导入；后续任务新增模块时重新构建，不导出未实现模块。
- [ ] 复核差异、更新进度；若要提交，先取得用户明确确认。

## 任务二：可信营养参考数据导入

**文件：** 新建公共模块 `reference.js`；新建 `scripts/import-nutrition-reference.js`、`scripts/nutrition-reference-adapters/china-food-table.js`、`scripts/nutrition-reference-adapters/usda-fdc.js`；更新统一验收记录，不创建测试文件。

**消费接口：** 任务一的单位、字段和缺失校验。

**产出接口：** `normalizeReferenceRecord(raw, { provider, version, sourceUrl, usageVerified }) -> Reference`；`buildReferenceImport(records, options) -> { records, rejected, report }`。记录键由来源、原始记录ID和版本组成，不因同名互相覆盖。

- [ ] 实现两个来源适配器和质量报告；中国数据需核验原始来源、版本与使用范围，现有JSON中的来源标签不足以证明核验完成。无法恢复的历史0标记 `unverified`。
- [ ] 导入命令默认仅输出规范数据和质量报告；显式发布参数与目标环境用于后续经授权的导入。手动验收仅使用本地合成/合规样本，本阶段不连接生产环境。
- [ ] 运行脚本语法检查及本地导入预览，逐项核对原始记录ID、版本、营养定义、制备状态和食部基准；确认缺失不转成0、未核验来源不能发布、不同版本ID独立、USDA品牌条目保留标签来源。
- [ ] 形成 `nutrition_reference` 访问与索引配置说明，客户端禁止写入；保存导入质量报告和手动核对结果。
- [ ] 复核差异并记录进度；生产导入单独等待明确授权。

## 任务三：图片识别、主备模型与草稿

**文件：** 新建 `cloudfunctions/recognizeNutritionLabel/{index.js,modelClient.js,imageReader.js,sessionRepository.js,package.json,config.json}`、`scripts/cleanup-nutrition-recognition.js`；更新统一验收记录，不创建测试文件。

**消费接口：** `normalizeObservation()` 及公共错误码/字段契约。

**产出接口：** 云函数接收设计文档的 `RecognitionRequest`，返回 `RecognitionSuccess`；依赖通过 `createRecognitionHandler({ cloud, db, imageReader, modelClient, now })` 注入，便于离线调试与手动模拟错误。`callRecognitionModel({ images, mode, primary, fallback, deadline })` 返回规范响应及实际模型用量。

- [ ] 校验真实身份、当前环境和对象归属；上传路径与存储写规则共同限制用户/宝宝归属，不能仅检查客户端可伪造的路径字符串。下载后校验实际字节和文件签名。
- [ ] 原子创建识别中的草稿并使用稳定ID防止重复模型调用；使用内置 `https` 设置总截止时间，在请求超时、阶段结束或错误时销毁连接并清理计时器。外部备用地址必须使用专用密钥，禁止转发主密钥。
- [ ] 按模式构造固定JSON提示词和原始数据结构；检查 `finish_reason` 和字段类型后调用任务一接口。实物响应不含模型生成营养。保存24小时草稿，返回sessionId；失败保存错误状态，日志不含密钥、图片或识别原文。
- [ ] 实现草稿及识别临时图片清理工具，默认只输出清理预览；仅处理已过期会话及其归属明确的识别图片，不处理业务食物图片、活跃会话或业务条目。手动验收24小时边界及清理失败不影响已保存业务数据；实际删除单独取得授权。
- [ ] 运行函数文件语法检查；在离线调试中逐项模拟未绑定宝宝、他人图片、跨环境fileID、类型伪装、超过3MB/3张，核对均在模型请求前拒绝。
- [ ] 手动模拟主模型成功、免费额度错误、备用失败、错误密钥、限流、超时及重复请求，核对主备总时限25秒、仅额度错误切换一次、无重复模型调用；不使用真实额度制造异常。
- [ ] 构建并检查独立函数产物，记录调试输入、响应和耗时；部署及云端环境变量配置等待授权。

## 任务四：食物身份匹配与同口径比对

**文件：** 新建 `cloudfunctions/lookupNutritionReference/{index.js,referenceRepository.js,package.json,config.json}`；完善公共模块 `reference.js`；更新统一验收记录，不创建测试文件。

**消费接口：** 识别草稿、`Reference`、`toComparableBasis()`。

**产出接口：** `matchReferenceCandidates(identity, references) -> { status, candidates }`；`compareNutrition(observation, reference, version) -> Comparison`。云函数支持 `action: 'search'|'select'`，输入 `sessionId`、`babyUid`、确认身份及选定参考ID，返回候选/参考快照/比对版本。

- [ ] 按产品编码/维护好的食物编码映射、规范名称/别名、制备状态筛选；模糊检索仅排序候选，英语别名使用维护的映射，不用模型临时翻译认定唯一匹配。
- [ ] 选定参考后使用固定版本快照比对；计算差值和参考值大于0时的差异百分比，参考0不除零，缺失或口径不一致标记不可比。更改身份/参考/基准时递增比对版本，旧版本不能保存。
- [ ] 运行语法检查，并在本地控制台手动验收“青菜”多候选返回 `ambiguous`、生熟状态不一致、奶粉系列/段位不同、无可信参考返回 `not_found`。
- [ ] 手动验收观察/参考缺失、不同碳水定义、未知密度、参考0、多来源同名及第三方不可用；包装标签完整且用户确认时可记录未比对状态，实物无参考不能生成营养。
- [ ] 复核来源、版本和缺失状态完整保留，记录各案例实际输出和进度。

## 任务五：确认落库、来源元数据与并发

**文件：** 新建公共模块 `selection.js`；新建 `cloudfunctions/confirmNutritionRecognition/{index.js,saveRepository.js,package.json,config.json}`；修改 `miniprogram/models/food.js`、`miniprogram/pkg-milk/models/powderCatalog.js`、`miniprogram/utils/formulaPowderUtils.js`、`miniprogram/models/nutritionProfile.js`；更新统一验收记录，不改测试文件。

**消费接口：** 草稿中的Observation、已选Reference、Comparison及任务一校验。

**产出接口：** `buildConfirmedPatch({ observation, reference, decisions, targetBasis }) -> { patch, recognitionMeta }`；`confirmRecognition({ sessionId, operationId, babyUid, comparisonVersion, decisions, targetId, expectedVersion }) -> { itemId, finalValues, version }`。云端读取观察值和参考快照，客户端只能提交选值与手填值。

- [ ] 生成最终白名单patch与字段来源；分组校验身份/基准/营养和粉水量。核对标签、参考和手填值使用同一目标基准，缺失项仍保留缺失标记。
- [ ] 在服务端事务中读取草稿、目标条目及预期业务版本，提交食物或奶粉后将草稿封存并保存结果。重复调用包括变更operationId均返回原结果；失败不把草稿标为成功。
- [ ] 用户食物创建/更新宝宝专属条目；系统食物沿用快照语义并保留来源关联。奶粉仅更新目标formulaPowders项，保留其他奶粉、母乳及生命周期，不写历史营养集合。
- [ ] 增加recognitionMeta读写、归一化及必要快照透传；手动验收保存并重新加载后仍保留证据、参考版本、字段来源和缺失标记。
- [ ] 为目标条目和共享档案定义统一的整数业务版本；旧文档首次编辑版本视为0。检查所有更新同档案的入口，使普通手填保存和其他档案写入也进行版本检查；迁移/初始化入口不能用旧内容绕过版本检查。并发冲突返回 `VERSION_CONFLICT`，不自动覆盖。
- [ ] 运行语法检查；离线调试逐项验收过期/他人草稿、旧比对版本、非法字段、缺失必填项和伪造来源被拒绝；明确确认0可保存，缺失不能被0绕过。
- [ ] 使用隔离验收环境手动核对重复提交只产生一条、保存中断原子回滚、多人编辑冲突、其他奶粉保留、系统来源去重和权限；环境写入先取得授权。可运行既有 `nutrition-profile-model`、`system-food-library`、`system-powder-library` 用例，不修改或扩充测试文件。
- [ ] 复核数据库访问规则与索引需求；集合配置、历史数据修复和生产部署等待授权。

## 任务六：两个表单的核对与保存交互

**文件：** 新建 `miniprogram/utils/nutritionRecognition.js`、`miniprogram/utils/nutritionComparison.js`；修改食物和奶粉管理页的 `index.js`、`index.wxml`、`index.wxss`；更新统一验收记录，不改测试文件。

**消费接口：** 三个云函数及其错误码，现有 `saveFood()`、`savePowderDraft(e)` 页面入口。

**产出接口：** `startRecognition({ babyUid, mode, formSessionId, onState }) -> RecognitionSuccess`；`buildFormMerge({ current, decisions, touchedFields, lastRecognized, basis }) -> { updates, conflicts }`；`cancelRecognition(formSessionId)` 使迟到回填失效，不声称取消了云端请求。

- [ ] 统一选择1～3张图片、压缩、上传与状态恢复；前端调用等待上限45秒，超时使请求失效且不自动重试。进入/关闭编辑、切换条目或宝宝时变更formSessionId，保存期间禁用重复按钮。
- [ ] 加入候选身份选择、参考来源/版本、标签值/参考值/差异展示、分组选值和缺失提示；实物显示“参考营养”，未完成比对不能显示“官方校验通过”。母乳编辑隐藏识别入口，蛋白类别仍由原流程维护。
- [ ] 两页现有保存入口提交确认选择并处理版本冲突、草稿过期和保存失败；成功刷新我的库，并沿用FoodModel目录失效标记。字段修改使相应的来源/比对状态重新核对。
- [ ] 通过开发者工具核对bindinput同步draft且保留input的name、0保留、空字段回填和手填保护；手动模拟取消、上传/调用失败、超时、关闭后迟到响应、跨宝宝结果及必填未补齐。
- [ ] 运行语法、现有静态/类型检查及函数构建检查；可执行受影响的现有回归用例，不因用例失败直接修改测试。用开发者工具和真机验收新建、编辑、系统条目加入、母乳原路径以及保存后重新加载，保留验收记录。
- [ ] 更新接入文档的实际接口、部署产物和验收记录；完整验证后再请求部署或提交授权。

## 数据及上线前提

参考数据来源、版本和使用范围需在发布前完成核验。实现和离线调试可先推进，但未经核验的数据不能靠现有来源标签自动发布。正式参考不足时，实物模式必须真实显示未匹配状态，不用模型推测填补。

数据库权限说明随实现提供：参考数据仅服务端发布；会话只允许发起者操作；业务数据按宝宝访问权限读写；服务端写入仍需显式鉴权。业务版本统一覆盖所有相关写入口后才开放并发确认保存。

模型密钥、免费额度用完即停、备用计费方式、函数部署和集合发布均在可审阅产物完成后处理。本计划未执行这些外部变更，也未运行任何计费模型请求。

## 计划自检

- 设计文档的三种识别模式、主备模型、单位换算、参考比对、缺失与0、手填保护、来源追踪、宝宝权限、幂等及并发分别由任务一至六覆盖。
- 公共类型与接口集中定义；共享模块部署产物在任务一、三检查。页面不复制云端的参考判定或使用未定义接口。
- 参考来源不足与版本冲突有明确产品行为，不留自动猜测或未经确认覆盖路径。
- 默认不新增、修改或扩充单元测试；每个任务均列明检查、构建或手动验收方法，特殊单测需求先取得用户同意。
- 当前产物仅为技术实施计划；开始编码前审阅任务范围及执行方式。

## 本次执行状态

六项任务的实现代码已完成，沿用当前分支和工作目录。公共核心、三云函数、参考导入/清理、两页共用组件和现有写入口版本保护均已接入；详细逐项验证见 [验收记录](../../verification/nutrition-recognition.md)。

用户后续明确允许调整现有单测，因此适配了既有数据库桩及旧断言，未新增用例。相关59项回归全部通过，全量940项中934通过；6项现存页面/加载图断言失败与本次改动无关，保持原样。独立审查发现的8项关键/重要问题已修复并离线复核。

尚未提交、推送、创建生产集合、导入正式营养数据、修改云端环境或部署。云数据库规则、索引、真实模型与真机验收仍是上线前提，计划中涉及这些环境的验收复选框不视为已通过。
