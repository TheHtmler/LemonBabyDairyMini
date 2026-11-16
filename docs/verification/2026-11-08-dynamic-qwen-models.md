# 千问模型名单动态同步

## 已实现行为

- AI 配置页面读取当前业务空间已授权推理的千问模型，并结合官方能力信息生成候选名单。
- 名单不再依赖固定模型编号数组；搜索、食物识别按文本/图片输入及结构化输出能力筛选，报告按 OCR 协议筛选。
- 授权与能力接口均处理完整分页；字段异常、分页不完整或任一步失败时保留上次完整成功快照。
- 模型目录写入 `feature_flags/ai_model_catalog`；管理员选择继续写入 `ai_model_config`，目录更新不增加配置版本或自动修改启用状态。
- 保留原启用状态、核验记录和排序；新发现模型默认停用并追加。旧模型撤权后仍保留配置，但不进入实际调用候选。
- 进入页面或原有定时任务时自动同步，普通同步间隔 5 分钟；“同步模型”可主动刷新，15 秒内合并重复请求。
- 页面刷新目录时保留草稿选择和顺序，追加的新模型保持停用。
- 额度查询使用动态模型编号，名单同步与额度查询分别展示结果。
- 报告 OCR 不再限定单一模型编号，按动态输出上限请求；免费额度耗尽或暂时不可用时最多尝试一个已启用备用模型。

## 接入及发布要求

- 服务端复用 `DASHSCOPE_API_KEY`，不向小程序发送密钥。
- `BAILIAN_BASE_URL` 推荐配置为 `https://<业务空间ID>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。
- 若保留 `https://dashscope.aliyuncs.com/compatible-mode/v1`，需在负责同步的云函数配置 `BAILIAN_WORKSPACE_ID`，供官方授权接口使用。
- 共享 AI 源通过 `npm run build:search` 生成到五个云函数，不手工修改生成副本。
- 需更新云函数 `featureFlagManager`、`syncAiModelQuota`、`searchManager`、`recognizeNutritionLabel`、`recognizeReportCustom` 及小程序。
- 已将仓库内 `featureFlagManager` 超时配置调整为 35 秒、`syncAiModelQuota` 调整为 40 秒；发布时需使云端配置一致。

## 兼容决策

- 未保存过管理员配置时，原有搜索/食物识别环境变量策略仍保留；报告仍须明确启用。
- 未完成首次成功同步时，已保存旧配置可继续读取，避免因新增目录功能立即中断既有业务。
- 较新 VL 文档解析快照采用固定提示词协议，暂不列入当前报告字段抽取候选；此处保留协议版本边界，不维护业务模型编号名单。
- 保留现有血液报告两阶段识别流程；旧 VL OCR 在映射阶段继续携带图像，其图片输入仍产生用量，本次未承诺降低 token 消耗。

## 验证记录

- `npm run build:search`：通过，共享源同步及小程序静态依赖检查通过。
- `npm run check:search`：通过，共享源与生成副本一致。
- `npm run check:miniprogram-imports`：通过，72 个入口、420 个文件、508 处引用。
- 修改的 JavaScript 已执行 `node --check`；两个云函数 JSON 配置已解析校验。
- `git diff --check`：通过。
- 独立代码审查发现的两项问题已处理：异常权限/能力数据拒绝发布；固定提示词 OCR 协议不作为通用报告候选。
- 按用户规则未新增或修改单测，未进行界面验收、真实接口调用、部署、提交或推送。

## 官方依据

- [查询模型授权](https://help.aliyun.com/zh/model-studio/list-model-permissions)
- [查询模型列表及能力](https://help.aliyun.com/zh/model-studio/list-models)
- [Qwen OCR 参数与使用限制](https://help.aliyun.com/zh/model-studio/qwen-vl-ocr)
- [新版 VL 文档解析固定提示词协议](https://help.aliyun.com/zh/model-studio/qwen-vl-ocr-2026-09-28)

## “返回不完整或格式异常”排查补充

- 用户已授权使用本机千问认证配置，只读查询官方模型授权及能力接口；未调用模型、修改云端配置或输出凭证。
- 真实能力目录返回 114 个千问模型，`qwen3-vl-embedding`、`qwen2.5-vl-embedding` 的输出模态是空数组，属于向量模型的合法结构。
- 原代码对所有授权模型执行非空输出模态校验，导致此类不适用的模型也能阻断整次同步；现改为先按 TG / Reasoning / VU 能力筛选，再严格校验业务候选。
- 新增分页、授权字段、模型能力、目录合并及响应包的具体诊断码，并在云函数日志输出 `[bailian-model-catalog]` 脱敏诊断。
- 页面原有错误说明将附带诊断阶段、字段或模型编号，失败仍保留上次成功快照。
- 本机认证空间的 AUTHORIZED 查询返回 0 个模型，云端密钥与空间尚未直接读取；以上确认了代码缺陷，但尚不能断言云端本次报错的具体触发字段。
- 需更新 `featureFlagManager` 与 `syncAiModelQuota` 云函数后重试；无须为本次修复修改小程序代码。

## 动态额度刷新及耗尽自动停用补充

- 用户反馈刷新额度返回 `QUOTA_STATUS_INVALID`；原实现要求每个模型都有正整数有效期和对应保护记录，不能表达动态名单中的缺失信息。
- 额度网关现保留完整请求名单：余额/总额均未提供时标记 `quotaStatus=not_provided`，不伪造为零；有效期未提供或为零、保护状态未提供时保存为 `null`。
- 负数、非整数、总额小于余额、畸形日期、重复模型及非请求模型仍拒绝整份结果，失败保留旧快照；诊断细化到余额、有效期或保护字段。
- 页面分别显示“未返回免费额度”“有效期未提供”“免费保护：未提供”，不将未知状态显示成已保护。
- 实际调用确认 `FREE_QUOTA_EXHAUSTED` 后，在同一事务写入阻断状态并关闭该模型各场景的启用开关，保留顺序和核验记录，配置版本随之增加。
- 配置页会补齐旧版本中 `blocked=true` 但仍启用的模型；旧草稿不能再次启用已确认耗尽的模型。
- 自动停用原因由服务端保存为 `disabledReason=FREE_QUOTA_EXHAUSTED`，后续识别仍能给出明确的模型额度耗尽提示；手动停用的模型不混入该原因判断。
- 额度查询缺失、查询失败或未知免费保护状态不会触发自动停用，也不会自动启用备用模型；仅使用管理员已启用、已核验的候选。
- 用户已明确授权只读额度及免费保护查询，但本机控制台令牌返回 `QUERY_AUTH_FAILED / CONSOLE_AUTH_REJECTED`，未取得本次云端原始额度响应；因此不声称已核实云端具体触发字段或线上恢复。
- 已按用户要求完成独立代码审查，修正自动停用后丢失明确额度提示的问题；不新增或修改单测，不进行界面验收。
- 本轮需要更新小程序和五个携带 AI 共享模块的云函数：`featureFlagManager`、`syncAiModelQuota`、`searchManager`、`recognizeNutritionLabel`、`recognizeReportCustom`。
