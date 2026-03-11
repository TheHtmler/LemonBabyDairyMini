# LemonBaby 数据模型地图

只在处理数据模型、集合关系、初始化或协作权限时读取。

## 核心实体

### baby_info

角色：

- 宝宝主档案主数据源
- 营养设置主数据源
- 药物设置主数据源
- 邀请码和分享协作的核心载体

关键字段：

- `babyUid`
- `creatorPhone`
- `nutritionSettings`
- `medicationSettings`
- `inviteCode`
- `inviteCodeExpiry`

## 角色集合

### baby_creators

角色：

- 识别创建者
- 记录创建者手机号与 `babyUid` 的绑定关系

关键字段：

- `_openid`
- `phone`
- `babyUid`

### baby_participants

角色：

- 识别参与者
- 记录参与者与 `babyUid` 的关系
- 可能同时承接手机号绑定或邀请码加入结果

关键字段：

- `_openid`
- `phone`
- `creatorPhone`
- `babyUid`

注意：

- 当前仓库里 `saveParticipant` 云函数目录缺少实现文件，说明参与者链路可能不完整或已迁移到前端/其他路径，修改前必须先确认真实调用链。

## 业务集合

### feeding_records

角色：

- 存储每日喂养记录
- 分析、趋势、统计页面的重要数据来源

关键字段：

- `date`
- `babyUid`
- `feedings`
- `medications`
- `weight`
- `userInfo`

规则：

- 查询优先按 `babyUid`
- 日期字段存在字符串兼容处理

### nutrition_settings

角色：

- 配奶设置兼容集合

规则：

- 新逻辑应优先读写 `baby_info.nutritionSettings`
- 兼容集合可作为回退和同步目标

### medications

角色：

- 药物设置兼容集合

规则：

- 新逻辑应优先读写 `baby_info.medicationSettings`
- 独立集合更新失败时，不应覆盖主源成功状态

## 缓存与初始化

来自 `app.js` 的关键本地键：

- `openid`
- `user_role`
- `baby_uid`
- `creator_phone`
- `bound_creator_phone`
- `baby_info_completed`
- `has_selected_role`

规则：

- 改初始化流程时，同时检查设置、读取、清理三处
- 改字段名时，同时考虑 storage 命名兼容

## 已知实现特征

- `nutrition.js` 明确把 `baby_info` 当作主集合，并在读取时可用兼容集合补字段。
- `medication.js` 同样优先写 `baby_info.medicationSettings`，再尝试同步独立 `medications` 集合。
- README 和代码都表明项目处于“新结构 + 兼容旧结构”并存阶段，任何重构都不能假设旧表已废弃。
