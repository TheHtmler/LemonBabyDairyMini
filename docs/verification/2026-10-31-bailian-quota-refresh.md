# 百炼免费额度刷新失败排查

> 本文记录额度查询适配器修复。后续已按用户要求解除额度查询与模型调用、配置保存之间的依赖，详见 [调用与额度查询解耦记录](2026-10-31-ai-quota-decoupling.md)。手动刷新仅用于查看额度，不再是使用 AI 的恢复步骤。

## 结论与处理

用户确认 featureFlagManager 使用 Node.js 16.13、60 秒超时。原云端查询会启动 bailian-cli 2.7.2，其要求 Node.js >=18.17，存在已确认的运行时冲突；60 秒已足够。腾讯云经典 SCF 的运行时创建后不可直接修改，不再要求用户升级或重建函数。

最终改为 Node.js 内置 HTTPS 调用官方 CLI 使用的固定网关。featureFlagManager 与 syncAiModelQuota 均支持现有 Node.js 16.13，移除 bailian-cli 依赖，只保留原 wx-server-sdk。沿用已配置的 BAILIAN_QUOTA_ACCESS_TOKEN，不需要新服务器或重新创建模型调用 Key。

本机真实 Node.js 16.13.0 的新代码只读查询已经成功；腾讯云端尚未部署验证，不能据此声称线上刷新已恢复。

## 已取得证据

- 本机官方 CLI 2.7.2 可查询七个候选；免费保护全部为 true，到期日均 2027-01-08。
- 临时下载 Node.js 官方 v16.13.0 darwin-arm64 归档，逐字节核对官方 SHASUMS256.txt 的 SHA256 后解压到临时目录，不修改项目依赖、PATH 或全局安装。
- 同一个真实 Node.js v16.13.0 执行原 CLI 2.7.2 的 --version，退出 1，明确报 ERR_UNKNOWN_BUILTIN_MODULE / No such built-in module: node:readline/promises；旧依赖在查询前已无法加载，而非仅依据 engines 声明推断不兼容。
- 用该真实 Node.js v16.13.0 执行 packages/ai-access-core/quotaSync.js 的 queryFreeQuota，以本机现有控制台授权只读查询真实接口，进程退出 0：返回 7 个模型、allProtected=true、dates=["2027-01-08"]。
- 验证只访问免费余额与免费保护两个查询接口；不调用模型、不写云数据库、不修改保护开关、不上传完整凭证。原始令牌、授权配置和接口原文均不输出。
- 本机未提供专用 AK/SK，因此自动续期仅按官方源码进行静态核对，尚无权限和真实续期证据。
- 用户贴出的 ok:true、config.key=report_ocr_access 是默认 OCR 白名单 action 的返回；缺省 action 可在新旧版本中返回此配置，不能据此判断旧部署或额度查询成功。

## 最终实现

- 固定 bailian-cs.console.aliyun.com 的北京网关，仅查询目录内七个模型的 queryFreeTierQuota 和 queryFreeTierOnlyStatus；不接受前端接口或凭证输入。
- 两个只读 API 并发且均成功才接受快照。严格校验返回层级、余额/总额整数、到期日及免费保护布尔值。到期时间转换为北京时间日期，保留原来的到期日 00:00 保守停用规则。
- HTTPS 保留证书验证、不跟随任意地址跳转；单份响应最多 1 MiB，查询和可选续期共用 25 秒总截止时间。
- 去掉子进程、CLI 及临时凭证文件；无需安装曾出现 ETARGET 的 bailian-cli-commands。
- 令牌首尾空白可去除；Bearer 前缀、外层引号或内部空白返回明确格式错误。续期凭证必须成对配置。
- 仅明确鉴权失败且配置专用凭证时按官方 ACS3 协议续期一次，再重试两项查询；新令牌仅缓存于当前函数实例内存，不写入数据库、环境变量或日志。冷启动后仍依赖原始令牌或专用续期凭证。
- 区分授权、DNS、TLS、连接、HTTP 网关、超时、格式等错误。quotaDiagnostics.js 只输出固定类别、阶段、适配器版本、Node 版本和数字 HTTP 状态，不输出请求头、响应原文或任何凭证。
- 独立代码审阅发现网关包装层失败标记与内层鉴权码可能被忽略；已拒绝 successResponse:false、failed:true 及失败 ret，并在固定层级汇总错误码后再判定，避免外层失败遮蔽 NotLogined。四份生成副本已同步，复核后无剩余 Critical/Important。未为此新增或修改单测。
- 查询失败保留上次成功快照；45 秒数据库租约合并并发，成功后 60 秒手动刷新缓存、5 分钟定时同步缓存。未改变模型轮换、免费保护或每日业务次数规则。

## 用户更新步骤

1. 更新 featureFlagManager 和 syncAiModelQuota 的完整代码，必须包含 npm run build:search 生成的 lib/ai。按云开发正常方式安装原 wx-server-sdk 依赖，不再安装百炼 CLI。
2. 保留 Node.js 16.13、60 秒超时及两个查询函数已配置的 BAILIAN_QUOTA_ACCESS_TOKEN。不需要改业务 searchManager、recognizeNutritionLabel 的模型 Key 或运行时来修复本问题。
3. 发布对应的小程序配置页更新后，由管理员进入 AI 模型配置，点击“刷新额度”。本轮不代替用户部署或验收界面。
4. 若使用云函数测试面板，参数须为 {"action":"refreshAiModelQuota"}，且调用身份具备管理员权限。测试面板没有 OPENID 时会被拒绝，应改用小程序管理员页面调用。
5. 正确刷新返回包含 sync 与 view，而非 OCR 白名单 config；本次真正同步成功应有 sync.refreshed=true、sync.status=success、view.quota.syncStatus=success。处于 60 秒缓存时 refreshed=false/status=cached 属正常情况，应检查已有快照时间。
6. 若仍失败，仅查看或发送脱敏错误及 syncCode/syncDiagnostic，不发送令牌、密钥或完整环境配置。云端外网、账号权限与实际部署版本仍需按新诊断确认。

## 验证边界

已通过 npm run build:search、npm run check:search（含小程序静态依赖检查：68 个页面/组件、387 个文件、441 处引用）、真实 Node.js 16.13.0 的 63 个相关 JS 语法检查、两个查询函数 package.json 解析及移除 CLI 依赖检查、git diff --check。

不新增或修改单元测试；不启动服务，不执行界面、模拟交互或截图验收；未部署、提交、推送或修改线上设置。真实查询仅证明本机 Node.js 16.13 协议与解析可运行，云端调用和专用凭证续期仍待部署者验证。

## 官方依据

- [百炼 CLI 安装与授权](https://help.aliyun.com/zh/model-studio/cli/installation)：CLI 要求 Node.js >=18.17。
- [百炼官方 CLI 源码](https://github.com/modelstudioai/cli)：固定网关、两项只读接口及 ACS3 续期协议的来源。
- [腾讯云 SCF 更新函数配置](https://cloud.tencent.com/document/api/583/18580)：经典函数的 Runtime 创建时指定，目前不支持修改。
- [Node.js 16.13.0 官方校验和](https://nodejs.org/dist/v16.13.0/SHASUMS256.txt)。
