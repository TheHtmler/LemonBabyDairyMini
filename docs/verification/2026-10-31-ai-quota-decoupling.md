# AI 模型调用与额度查询解耦

## 用户要求与根因

用户明确要求 AI 配置仅用于手动查看额度和切换模型，配置保存后应持续生效，不能要求管理员反复刷新才能使用搜索或拍照。

静态追踪确认旧实现存在三处耦合：共享 modelRegistry 的 eligibility 将超过 15 分钟的快照判为不可用；saveModelConfig 在保存事务中要求新鲜快照和可用模型；客户端展示模块也按快照新鲜度禁用保存。由此即使模型配置未变、额度未耗尽，只要定时同步未持续成功，15 分钟后就会停止服务。不能仅延长时限或要求管理员重启定时任务来满足此次要求。

本轮修正旧设计，不再把“先成功刷新额度”作为部署业务函数后的使用步骤。实际云端定时任务是否运行不是本轮已确认事实，也无需用它维持模型配置有效。

## 修改

- packages/ai-access-core/modelRegistry.js：运行策略只读取持久配置与模型接口确认的耗尽状态；移除额度快照读取和 QUOTA_STALE 拦截。配置保存只校验名单格式、业务核验、启用时至少有一个选中模型及版本号事务，不依赖额度快照或运行可用状态。
- cloudfunctions/searchManager/intentV2Service.js、cloudfunctions/recognizeNutritionLabel/index.js：同步策略接口签名，移除不再使用的快照判断时间参数，保留拍照能力查询的 required=false 行为。
- miniprogram/utils/aiModelSettingsPresentation.js：额度新旧程度仅用于显示，不参与模型顺序、摘要和保存资格。已加入调用顺序与实际接口拒绝分别显示；额度缺失、旧快照、查询失败不再要求刷新后使用。
- miniprogram/pkg-misc/ai-model-settings/index.wxml：明确查询与调用独立，展示查询时免费保护状态；撤销“15 分钟未同步暂停 AI”的说明。
- 共享源同步到 searchManager、recognizeNutritionLabel、featureFlagManager、syncAiModelQuota 四个函数的 lib/ai/modelRegistry.js；设计文档更新，旧排查记录标注规则已被替换。

## 仍然有效的行为

总开关、场景能力、业务效果核验、北京接口限制和模型密钥检查仍有效。接口返回 FREE_QUOTA_EXHAUSTED 时持久标记并尝试下一个已启用候选；刷新额度和成功请求不会清除耗尽标记。已耗尽的模型仍可保存在名单中，但调用时跳过；模型全部被接口确认耗尽时仍会报告不可用。

每日业务次数、一次请求最多两次模型尝试、原有总时间预算、管理员权限及保存版本冲突处理保持。保存和业务调用都不会发起额度查询，定时同步仍可独立更新展示数据。

免费用完即停由百炼端已有保护开关执行。本轮不操作该开关、不更改模型地址和密钥；本地不再根据查询快照拦截调用，不能将模型入选当作免费保护已开启的证明。查询快照中的余额、到期日、保护状态均只是查询时的数据。

## 发布范围

更新 searchManager、recognizeNutritionLabel、featureFlagManager 的完整代码（含 lib/ai），并重新编译发布小程序配置页；syncAiModelQuota 的共享副本可随版本同步。已保存配置继续使用，无需重新保存、手动刷新或恢复模型名单环境变量。

本轮只修改工作区，没有部署、提交、推送、修改云端设置或调用生产 API；发布后的真实云端行为尚待验证。

## 验证

已通过：

- npm run build:search：仅更新四份 modelRegistry.js 生成副本。
- npm run check:search：共享源与产物一致；小程序静态依赖检查通过，覆盖 68 个页面/组件、387 个文件、442 处引用。
- npm run check:nutrition：营养公共模块与部署产物一致，独立加载通过。
- 本轮八个修改的 JavaScript 文件 node --check；语法树调用关系检查确认 saveModelConfig 与 resolveModelPolicy 不依赖 readModelQuota、quotaFresh 或额度查询函数，两个业务入口的参数签名一致。
- AI 配置页 WXML 标签配对静态检查；代码索引检索未再发现 QUOTA_STALE、旧快照有效期常量或要求先刷新再启用的 JavaScript 分支。
- git diff --check；修改后刷新代码索引。

按用户约定未新增或修改单元测试，未运行数据库模拟或界面交互验收，未启动服务。上述代码层面的检查不替代微信真机及真实云端验证。
