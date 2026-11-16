# 管理员统一配置识别次数，云函数兜底

日期：2026-11-07
分支：`codex/recognition-quota-settings`

## 配置入口与行为

- 管理员配置入口由“营养识别次数”更名为“识别次数配置”，沿用现有路由。
- 页面提供两组独立设置：“食物与包装识别”和“报告识别”。食物、包装与单独发起的 AI 估算继续共用原有营养识别次数；报告独立计数，每张图片计一次。
- 每组均可设置每账号每日 0～10000 次，0 暂停该类新的识别；两组独立加载、保存和提示错误，一组加载失败不阻断另一组编辑。
- 优先级为：有效的管理员配置 → 对应识别云函数环境变量 → 默认 20 次。营养识别兜底变量为 `NUTRITION_DAILY_LIMIT`，报告为 `REPORT_OCR_DAILY_LIMIT`；环境变量空白或非法时使用默认值，明确填写 0 时保留暂停含义。
- 管理页分别从实际执行识别的函数读取当前值及版本，未配置时显示该函数真实的兜底值，不借用管理云函数的环境配置。只返回公开的上限及版本，不包含密钥或账号使用记录；无需先选宝宝或启用模型，管理员可在服务暂停期间调整。
- 报告权限预检与实际模型调用前均采用管理员报告上限；食物、包装及 AI 估算沿用已有的管理员营养上限读取链路。客户端传入的额度不能覆盖云端配置。
- 保存操作仍由 `featureFlagManager` 在云端验证管理员身份，并用事务及独立版本避免覆盖其他管理员修改；网络中断后重试相同目标值可确认既有保存结果。
- 识别次数配置不存在时才兜底。数据库读取错误或已存配置损坏时明确报错，避免读失败后使用默认值绕过管理员上限。
- 保留 `nutrition_daily_quota` 原有文档及版本，新增报告固定文档 `report_daily_quota`。代码不会自动初始化或覆盖云端设置；用户在管理页保存时才写入相应配置。
- 每账号按北京时间日期计数，修改上限不会重置当天已用次数；上限提高到高于已用次数后，后续请求可使用新增余量。搜索的既有额度规则保留。

## 主要改动

- `packages/ai-access-core/nutritionQuota.js`：共用固定文档读取及字段校验，增加独立报告额度读取。
- `packages/ai-access-core/policy.js`：识别环境变量仅作为兜底，空白值不再误判为暂停。
- `cloudfunctions/featureFlagManager/index.js`：共用额度保存事务，增加管理员报告额度保存入口。
- `cloudfunctions/recognizeReportCustom/index.js`：增加当前额度查询，预检及识别应用管理员配置，耗尽提示包含实际每日上限。
- `miniprogram/pkg-misc/nutrition-quota-settings/index.js/.wxml/.wxss/.json`：分别管理两组上限，保留输入校验、账号切换防护及版本冲突重新加载。
- `miniprogram/pkg-misc/developer-config/index.js`：更新菜单名称及说明。
- `cloudfunctions/{featureFlagManager,recognizeNutritionLabel,recognizeReportCustom,searchManager,syncAiModelQuota}/lib/ai`：同步共享模块部署副本。

## 验证

- `npm run build:search`、`npm run check:search`、`npm run check:nutrition` 通过，共享源与部署文件一致。
- 小程序静态依赖检查通过：72 个页面/组件、417 个文件、496 处引用。
- 16 个相关 JS 文件语法、4 处事件绑定、26 处模板表达式及页面 JSON 静态检查通过，没有执行页面逻辑。
- 管理页 WXML、WXSS 使用微信本机 `wcc`、`wcsc` 编译通过。
- `git diff --check` 通过，修改后刷新代码索引。

按用户约定未新增、修改或运行单元测试，未启动服务，未做界面、模拟交互或真实云端验收。两组独立加载、账号切换、权限、保存事务及兜底分支仅完成代码静态核查，尚未进行真实请求验证。

## 发布与配置

本轮没有提交、推送、部署、修改云端环境变量、保存生产配置或重置已用次数。

1. 执行 `npm run build:search` 后，完整更新 `featureFlagManager`、`recognizeNutritionLabel`、`recognizeReportCustom`、`searchManager`、`syncAiModelQuota`，包含各函数 `lib/ai` 副本；不要只上传入口文件。
2. 更新编译小程序，管理员进入“管理员配置 → 识别次数配置”，分别保存食物与包装、报告的目标上限。保存后新的请求读取管理员配置，无需再改云函数环境变量。
3. 尚未保存管理员上限时，才分别读取对应识别函数的环境变量或默认 20。若此前千问接入也尚未发布，依赖及模型设置按 `2026-11-07-report-qwen-ocr.md` 一并完成。
