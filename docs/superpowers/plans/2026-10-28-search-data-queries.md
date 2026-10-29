# 搜索数据能力扩展实施计划

> 执行方式：依照已在聊天确认的范围推进；独立的查询执行器可并行实现，根代理统一集成、构建并审查。用户关于不增改单元测试、不执行界面验收、不提交代码的约定优先于技能默认流程。

**目标：**接通第一批成长、睡眠、尿布查询及模糊名称分组检索。

**架构：**沿用能力注册 → 结构化意图 → 计划编译 → 固定只读执行器 → 既有结果展示。新增执行器复用当前 reader，统一继承宝宝过滤、预算、一致性与分页上下文。

**技术栈：**原生微信小程序、JavaScript、现有云数据库 SDK，不新增依赖。

**设计：**`docs/superpowers/specs/2026-10-28-search-data-queries-design.md`

## 全局约束

- 所有新增注释和文档使用中文；不覆盖用户原有改动。
- 不增改单元测试；不进行页面／浏览器／模拟交互验收；不调用生产数据、不提交、推送或部署。
- 只读查询不得通过页面服务补写成长或汇总；来源失败不返回“没有记录”。
- 协议结果继续使用 `list/scalar/series/comparison`，每项保留来源、日期和定位；新分组字段为附加信息。

## 审查重点

- 自动沿用的成长数据、重复日期、未来记录及缺少两次测量的增量。
- 跨日、未结束及缺少结束依据的睡眠；请求截止时间为当前上海时间。
- 大便／小便包含混合记录但不重复计数；定性值不做数值合计。
- 分组名称输入不遗漏食谱配料命中、只在相关记录领域检索；查看全部不带入其它组条件。
- 新域在编译器、执行器、客户端定位与共享构建之间完整对应，权限失效和迟到请求不能泄露旧结果。

## 任务 1：注册表、意图及编译约束

文件：`packages/search-core/{capabilities,intentV2}.js`、`cloudfunctions/searchManager/{intentV2Service,planCompiler,entityResolver,orchestrator,recordQueryService,metricQueryService}.js`。

- [x] 注册 `growth/sleep/bowel` 领域、受限指标、成长 `change` 聚合、尿布属性筛选及 `catalog.browse`。
- [x] 提示从注册表生成；明确最近变化默认近 30 天、完整名称浏览与属性／实际记录的区别。
- [x] 编译器先校验各域允许的指标、筛选及聚合，再解析日期和必要澄清；浏览查找不按严格对象名称截断召回。
- [x] 通过 `node --check` 和共享能力的纯代码复核确认合法与非法查询边界。

## 任务 2：成长查询执行器

新建：`cloudfunctions/searchManager/growthQueryService.js`。

接口：`queryGrowth({ reader, plan, now, offset = 0 })`，返回现有结果协议；消费编译后 `plan` 和 `reader.collection/budget`，不直接访问全局 SDK。

- [x] 读取宝宝有效成长记录，复用自动沿用来源定义，过滤未来及无效值，日期去重。
- [x] 完成列表、最新／趋势、测量均值／最值／期间增量及两段时间比较；保留测量日期和 `growth` 定位。
- [x] 语法检查及纯服务端数据复核，覆盖空值、真实测量、沿用、重复日期、单次测量和两段日期缺数据。

## 任务 3：睡眠与尿布执行器

新建：`cloudfunctions/searchManager/careQueryService.js`。

接口：`queryCare({ reader, plan, now, offset = 0 })`；只使用 reader 读取和现有纯日期／时长工具，返回列表、数值、序列或对比。

- [x] 睡眠按上海日期裁剪已结束区间，未结束和依据缺失单独呈现，完整统计不得悄悄补零。
- [x] 尿布仅接受注册的类型／性状／颜色筛选，混合记录口径明确；统计记录次数和按日序列。
- [x] 为新记录生成 `sleep/bowel` 定位，分页 20 项；执行语法及纯服务端边界复核。

## 任务 4：名称分组检索

新建：`cloudfunctions/searchManager/browseQueryService.js`；修改 `entityResolver.js` 与 `orchestrator.js`。

接口：`queryBrowse({ reader, plan, now })`；每组 3 项，统一 `list` 返回；各组首项附 `groupId/groupLabel/groupTotal/groupHasMore`。

- [x] 资料、食谱按完整关键词匹配；根据实际命中类型选择近 30 天相关记录，复用现有记录公开结构，避免无关领域扫描。
- [x] 固定 `browse:<组名>` 命令限定同一组完整结果；服务端白名单核对上下文，保留同一匹配方式与冻结日期，并支持既有游标与解释快照。
- [x] 确保无命中、单组、多组、已删除对象和来源失败的返回清楚且不生成虚假答案。

## 任务 5：展示、定位与构建

文件：`miniprogram/pkg-milk/search/index.{js,wxml,wxss}`、`miniprogram/utils/searchSession.js`、`scripts/build-search-functions.js`。

- [x] 结果内展示组名和查看全部；新域有正确的类型、单位、日期与明细跳转，不恢复筛选表单。
- [x] 日期序列和统计继续显示缺少依据及覆盖情况，拍照返回仍保留完整解释快照。
- [x] 同步所需纯计算依赖及共享副本；运行 `build:search`、`check:search`、语法、模板静态引用和 `git diff --check`。

## 任务 6：独立审查与记录

- [x] 只读审查实际变更和关联调用，按上方五项重点修正重要问题。
- [x] 记录代码检查、能力边界、后续阶段与发布依赖；刷新索引。
- [x] 如实交付未提交状态，注明尚未进行真实模型、云环境与界面验收。
