# 营养识别次数管理配置

日期：2026-10-20。

## 入口与行为

- 管理员进入“我的 → 配置 → 营养识别次数”，查看当前上限，填写 0～10000 的整数并保存。0 表示暂停新的营养识别。
- 同一上限适用于所有账号，各账号分别计数；食物、奶粉和单独发起的 AI 营养估算共用原有识别额度。北京时区每日换日规则不变。
- 修改上限不清空当天用量，也不修改其他账号的使用记录。调高后新请求可使用新增额度；调低后已超过上限的账号不能继续提交新调用。
- 管理员配置优先于识别云函数的 `NUTRITION_DAILY_LIMIT`。尚无管理配置时沿用该函数的环境值，环境变量未设置或无效则为 20。
- 页面读取实际识别云函数的配置，避免管理员云函数和识别云函数环境变量不同，导致首次显示的上限不准确。
- 服务端每次预检、准备、识图和显式估算都读取配置，无进程级缓存；配置查询不调用模型、不扣次数。相机短期可用状态缓存不能绕过实际请求的服务端额度校验。

## 实现与权限

- `packages/ai-access-core/nutritionQuota.js` 负责固定配置文档读取和边界校验。只有明确的文档不存在才使用原默认值；数据库错误和损坏配置不当作缺省值。
- 配置存于既有 `feature_flags` 集合的固定文档 `nutrition_daily_quota`，记录 `dailyLimit`、`version`、`updatedAt`、`updatedBy`。不需要新建集合。
- `featureFlagManager.updateNutritionQuota` 复用现有服务端管理员身份校验，在事务内比较版本后保存。非管理员请求被拒绝；旧页面不能覆盖其他管理员的新设置；网络中断后重复保存相同目标值可确认已有结果。
- `recognizeNutritionLabel.getDailyLimit` 向已登录用户返回公开上限、配置版本和是否已配置，不暴露操作人、用户用量或服务密钥。此只读接口不依赖宝宝权限或模型可用状态，便于管理员在暂停识别时仍能调整配置。
- 新页面 `pkg-misc/nutrition-quota-settings` 沿用管理员入口可见规则。输入为空、非整数或超出范围时不允许保存；保存失败保留输入；页面卸载或账号变化后丢弃异步结果。
- 客户端不直接写数据库，线上 `feature_flags` 应继续禁止客户端直写；本轮未读取或修改线上数据库权限。

## 验证

- `npm run build:nutrition`、`npm run build:search` 通过，公共模块已同步到部署目录。
- `npm run check:nutrition`、`npm run check:search` 通过；小程序静态依赖覆盖 66 个页面/组件、372 个文件、405 处引用。
- 修改文件的 JavaScript 语法、页面路由注册、JSON、模板 4 处事件绑定、17 处表达式、标签闭合与 `git diff --check` 通过。
- 仅进行代码层面检查。未新增或修改单元测试，未启动服务，未开展界面或模拟交互验收，未调用生产接口。
- 事务 API 对照[微信官方 wx-server-sdk 类型声明](https://github.com/wechat-miniprogram/wx-server-sdk/blob/master/index.d.ts)核验；未执行线上保存。

## 发布

本轮尚未部署。需要更新 `featureFlagManager` 和 `recognizeNutritionLabel` 两个云函数，并重新编译小程序。首次部署后打开配置页即可看到原有实际上限；保存管理配置之后，后续调整无需修改环境变量或重新部署。

相关修改前备份目录：`nutrition-admin-quota-garqi005`（系统临时目录）。保留工作区原有改动，未提交或推送。
