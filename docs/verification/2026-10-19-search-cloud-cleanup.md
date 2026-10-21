# 搜索与拍照识别的云端资源精简

日期：2026-10-19。

## 范围与结论

用户确认项目仍在开发／测试，只需支持当前代码。因此本轮继续删除旧搜索接口的本地实现，不再为已退出前端的接口保留兼容链路。

搜索和识别相关的 5 个专属集合仍有当前消费者，不能整集合删除。可清理的是已过期的临时记录，以及旧查询专用的两组索引。尚未连接或更改真实云环境，本文不声称已完成云端删除、部署或数据清理。

## 云函数代码已精简

`searchManager` 仅保留当前客户端使用的 3 个操作：

- `capabilities`：功能开关、许可入口和版本。
- `search`：统一意图理解、资料／记录／指标查询、追问与分页。
- `preview`：重新读取和鉴权后展示资料详情。

移除 `interpret/execute/metricDates` 操作，删除 6 个专属模块：

- `cloudfunctions/searchManager/intentService.js`
- `cloudfunctions/searchManager/queryService.js`
- `cloudfunctions/searchManager/querySessionRepository.js`
- `cloudfunctions/searchManager/answerService.js`
- `cloudfunctions/searchManager/metricDates.js`
- `cloudfunctions/searchManager/cursor.js`

仍被当前链路使用的 `publicCandidate` 移入 `catalogAdapter`；签名密钥检查移入 `contextRepository`。旧历史扫描和候选分页已退出，现有记录读取器继续处理历史数据。旧模型提示、协议 1 校验及专用归一化已删除，协议 2、日期解析、营养比较和设置频率格式化保留。

`capabilities` 不再生成没有当前消费者的 `ai/scan` 返回，也不再为入口展示额外读取两类 AI 额度。识别页独立检查识别能力，实际模型调用仍执行权限、模型配置及事务额度校验。

构建标记更新为 `20261019-search-cleanup`，搜索协议仍为 2。公共源码修改已同步到各部署副本。

以下云函数仍有当前调用，不应整函数删除：`searchManager`、`recognizeNutritionLabel`、`lookupNutritionReference`、`confirmNutritionRecognition`、`getSystemFoodIndex`、`getSystemPowderIndex`。`featureFlagManager` 也承担现有管理员开关管理。

## 已移除的 3 个闲置云函数源码

检查全部代码、脚本、配置和当前动态调用入口后，以下函数已无调用，入口、包清单及已有锁文件共 8 个文件已删除：

| 云函数 | 当前替代路径／删除依据 |
| --- | --- |
| `checkPermission` | 当前 `miniprogram/app.js` 的同名客户端方法按账号与宝宝查询创建者／参与者关系，不调用这个云函数 |
| `decryptPhoneNumber` | 当前初始化使用 `getOpenid`，没有手机号授权或加密手机号数据消费路径 |
| `saveCreatorInfo` | 当前宝宝资料页直接创建／更新创建者记录，个人资料页直接更新展示名；旧强制手机号创建流程已无入口 |

`getOpenid` 云函数与 `baby_creators/baby_participants/baby_info` 集合继续保留。名称相同的 `app.checkPermission` 是有效客户端方法，未删除。

源码删除不等于已部署函数删除：目标开发／测试环境确认使用当前代码后，如云端还存在这 3 个函数，可按上述准确名称下线。本轮没有连接云环境或调用云端删除接口，不能声称已删除远端实例。

`migrate*`、`cleanFeedingRecords`、`rebuildDailySummaryV2` 等没有前端调用但承担迁移、初始化或修复用途，本轮保留；暂缓食谱墙仍有引用的 `recipeWallManager` 也保留。

## 集合保留及数据清理范围

| 集合 | 当前用途 | 可清理范围 |
| --- | --- | --- |
| `search_query_sessions` | 当前 `context/search_response_v2` 上下文和重复请求结果 | 30 分钟过期记录；旧 `state/candidate/page` 不再写入，过期后同样清理 |
| `ai_search_requests` | 搜索、识图、营养估算共用的请求幂等、状态、结果与用量 | 24 小时过期且没有有效调用租约的记录 |
| `ai_usage_counters` | 按账号、上海日期、`search/scan` 场景计数 | 7 天过期记录；删除当天计数会重置调用限额 |
| `nutrition_recognition_sessions` | 识别草稿、参考比较、目标绑定、确认保存及恢复回执 | 24 小时草稿／图片；保存回执保留 30 天，须按专用脚本处理 |
| `nutrition_reference` | 经核验的长期营养参考资料 | 不能当缓存删除；停用参考应按参考库维护流程处理 |

`search_query_sessions` 没有迁到另一个新集合。当前代码没有独立的 `search_contexts` 或 `search_requests` 集合，不能据猜测名称操作云数据库。

`food_catalog`、`powder_catalog`、`milk_nutrition_profiles`、`recipe_catalog` 及饮食、用药、饮水、成长等业务集合继续被当前查询读取。`feeding_records` 仍承载兼容读取的历史业务数据；停止兼容旧搜索接口不代表这些业务数据已迁移完毕。`baby_creators/baby_participants` 用于鉴权，`feature_flags` 用于开关控制，也继续保留。

这些专属集合没有自动建集合的初始化逻辑，误删后不能假设下一次请求会自动恢复。`expiresAt` 字段也不等于已有自动清理任务。

## 可退役的旧索引

当前搜索按文档 ID 读取上下文和请求结果，不再使用以下 `search_query_sessions` 候选排序索引：

1. `kind↑, sessionId↑, emitted↑, date↓, time↓, stableId↑`
2. `kind↑, sessionId↑, emitted↑, rank↑, name↑, stableId↑`

先部署新版 `searchManager`，确认测试环境不再运行旧版本，再核对云端索引名称及其他使用方后删除这两组索引。保留集合和默认 `_id` 索引。源码删除不会自动移除云端函数文件、索引或旧记录；上传应使用本地完整函数目录。

## 沿用现有清理工具

现有搜索清理脚本已覆盖当前与旧版类型，没有遗漏当前上下文。无需新建集合或再增加一套清理代码。

```sh
node "scripts/cleanup-search-requests.js" --input "/本地路径/search-export.json"
node "scripts/cleanup-nutrition-recognition.js" --input "/本地路径/recognition-export.json"
```

以上默认只对本地导出生成计划。搜索输入为包含 `ai_search_requests/ai_usage_counters/search_query_sessions` 数组的对象，识别输入为会话数组。实际执行使用 `--apply --env`，需先核对具体环境和计划中的记录 ID。

搜索删除时按 ID 在事务内重读过期和租约。识别先核对图片归属并删除图片，再压缩有效回执或删除过期会话；直接清空识别集合会丢失图片回收依据，不应以整表删除或直接按草稿过期时间配置 TTL 替代。

本轮没有运行任何 `--apply`、集合删除或索引删除操作。

## 本地验证

- 搜索构建及共享源码一致性检查通过。
- 小程序静态依赖检查：65 个页面／组件、366 个文件、399 处引用通过。
- 营养识别公共模块一致性及独立加载检查通过。
- 已修改 JS 文件语法检查通过；当前搜索模块可独立加载。
- 搜索／识别相关的 12 组既有测试共 78 项通过；另执行宝宝账号、绑定和个人资料 3 组既有测试共 17 项通过，合计 95 项。没有新增或修改单元测试。
- 旧搜索模块、旧协议函数与专属常量在 JS 中无残留引用，`git diff --check` 通过。

未执行真机、真实模型或云端数据验收，未提交、推送或部署。真实云端的函数列表、数据量和索引实例名称仍需在目标测试环境核对。
