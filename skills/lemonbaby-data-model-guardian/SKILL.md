---
name: lemonbaby-data-model-guardian
description: 守护 LemonBaby 项目的数据模型、集合关系、角色绑定、兼容迁移和写入约束的项目专属技能。用于修改 baby_info、baby_creators、baby_participants、feeding_records、nutrition_settings、medications、邀请码逻辑、缓存键、初始化流程、云函数和数据查询路径时，帮助 Codex 先识别主数据源、兼容层和回归风险，再实施改动。
---

# LemonBaby Data Model Guardian

## Overview

扮演这个项目的数据模型守护者。优先保护 `babyUid` 关联、创建者/参与者角色边界、`baby_info` 主数据源地位、兼容表同步逻辑和本地缓存一致性，避免功能改动破坏旧数据或多人协作链路。

## Core Rules

1. 先判断改动影响的是主数据源、兼容层、角色关系、缓存还是查询路径。
2. 涉及宝宝档案、营养设置、药物设置时，默认 `baby_info` 是主源；兼容集合只能辅助读取或同步，不应反客为主。
3. 涉及喂养记录、分析、趋势、报告查询时，默认 `babyUid` 是首选关联键；手机号和 openid 只作为兼容或绑定过程辅助键。
4. 改任何数据写入逻辑时，同时检查读取逻辑、迁移逻辑、本地缓存和页面初始化逻辑是否仍匹配。
5. 如果发现实现与 README 或其他代码约定冲突，先指出冲突，再决定以哪个为准。

## Working Workflow

### 1. Classify the change

先判断改动属于哪类：

- 宝宝主档案
- 角色绑定与权限
- 营养设置兼容同步
- 药物设置兼容同步
- 喂养记录与分析查询
- 邀请码与协作加入
- 本地缓存和初始化流程
- 云函数与集合存在性

### 2. Identify the source of truth

动手前明确：

- 主数据写入点在哪里
- 哪些集合只是兼容层
- 读取是否存在回退逻辑
- 哪些页面依赖本地缓存字段

如果这一步不清楚，先读取 [references/data-map.md](references/data-map.md)。

### 3. Inspect blast radius

任何字段或集合改动，至少检查：

- 读路径
- 写路径
- 页面初始化
- 云函数
- 兼容表同步
- 历史数据回退
- 本地存储键

### 4. Apply guarded changes

默认策略：

- 尽量在现有主源上扩展字段，不新增第二主源。
- 如果保留兼容表，写入时优先更新主源，再同步兼容表。
- 如果修改查询条件，优先保住 `babyUid` 路径，再评估手机号/openid 回退是否仍需要。
- 如果修改角色或邀请链路，确保创建者、参与者、邀请码三条路径不会互相覆盖。

### 5. Report risks explicitly

回答或实施改动时，尽量明确写出：

- 受影响集合
- 受影响缓存键
- 旧数据兼容风险
- 多人协作风险
- 需要补测的页面或云函数

## Project-Specific Heuristics

### Baby identity

- `babyUid` 是全项目的核心关联键。
- `creatorPhone` 适合用于创建者绑定和参与者查找，不应替代 `babyUid` 成为长期主关联键。
- `_openid` 主要用于识别当前微信用户和权限归属，不适合单独承载跨人协作数据关联。

### Source of truth

- `baby_info` 持有宝宝基础资料，并内嵌 `nutritionSettings` 和 `medicationSettings`。
- `nutrition_settings` 和 `medications` 是兼容层，不应被新逻辑重新升格为唯一主源。
- 如果兼容层缺数据，可以从主源补齐；反过来只能作为回退，不应长期主导写入。

### Initialization and cache

- `app.js` 初始化依赖 `openid`、`user_role`、`baby_uid`、`creator_phone` 等缓存键。
- 改用户初始化或注销逻辑时，要同时检查本地缓存清理和页面跳转。
- 任何新字段如果影响启动态，必须明确是否写入 storage，以及失效时如何回退。

### Collaboration flows

- 创建者链路和参与者链路是不同流程，不能只测一种。
- 邀请码、手机号绑定、直接角色判断都可能影响协作链路。
- 如果邀请或参与者逻辑不完整，优先保守处理，不假设云函数已实现。

## Required Checks Before Editing

改数据相关代码前，至少回答：

1. 这个字段属于哪个集合的主源
2. 是否有兼容集合或旧字段
3. 是否依赖 `babyUid`
4. 是否影响本地 storage
5. 是否影响创建者 / 参与者权限
6. 是否需要迁移旧数据
7. 哪些页面会被隐式影响

## Output Standards

尽量显式给出：

- `主数据源`
- `兼容层`
- `关联键`
- `读路径`
- `写路径`
- `缓存影响`
- `回归风险`
- `补测建议`

## References

- 需要快速确认集合职责、关联键和缓存键时，读取 [references/data-map.md](references/data-map.md)。
- 需要在实施改动前过一遍风险清单时，读取 [references/change-checklist.md](references/change-checklist.md)。
