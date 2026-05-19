# 小程序数据 Schema 设计规范

本文档记录云数据库集合与嵌套业务对象的基础字段约定。后续新增集合、新增可长期引用的子对象时，应优先遵循这里的字段设计。

## 文档级基础字段

每个新集合文档建议包含：

```js
{
  schemaVersion: 1,
  createdAt: db.serverDate(),
  updatedAt: db.serverDate()
}
```

- `schemaVersion`：用于后续结构升级、迁移和兼容读取。
- `createdAt`：文档首次创建时间，创建后不应被普通编辑覆盖。
- `updatedAt`：文档最近一次业务更新或迁移更新时间。

## 子对象基础字段

如果集合文档内维护可被历史记录引用的子对象，例如配方粉档案、方案项、可复用配置项，建议包含：

```js
{
  id: 'stable_item_id',
  status: 'active',
  source: 'user',
  createdAt: db.serverDate(),
  updatedAt: db.serverDate(),
  deletedAt: null
}
```

- `id`：稳定业务 ID。历史记录应引用这个 ID，不要引用数组下标。
- `status`：状态字段，优先使用字符串枚举。当前推荐：
  - `active`：可继续被新记录选择或使用。
  - `archived`：用户视角已删除或停用，但保留给历史追溯。
- `source`：数据来源，例如 `user`、`legacy`、`system`。
- `createdAt`：子对象创建时间。
- `updatedAt`：子对象最近一次编辑、状态变更或迁移时间。
- `deletedAt`：归档或软删除时间；未删除时为 `null`。

## 删除语义

会被历史记录引用的数据，不建议物理删除。推荐软删除：

```js
{
  status: 'archived',
  deletedAt: db.serverDate(),
  updatedAt: db.serverDate()
}
```

业务查询规则：

- 新增记录、下拉选择、可用列表只展示 `status === 'active'` 的数据。
- 历史记录展示优先使用记录内保存的快照字段。
- 兼容旧记录回算时，如果没有 `active` 配置，可以使用 `archived` 配置兜底，但不要让它重新出现在新增入口。

不推荐只使用 `deleted: true/false`。布尔值缺少状态扩展能力，也无法表达删除时间；如果已经有 `deletedAt`，通常不需要再维护 `deleted`。

## 历史快照

当记录引用可编辑配置时，应保存必要快照，避免后续配置变更影响历史展示。例如喂奶记录引用配方粉时，应保存：

```js
{
  powderId: 'powder_1',
  powderName: '普奶 A',
  category: 'regular_formula',
  proteinRole: 'natural',
  nutritionSnapshot: {
    protein: 10.6,
    calories: 505,
    fat: 26,
    carbs: 55,
    fiber: 0
  }
}
```

这样即使配方粉后续被编辑或归档，历史记录仍可按当时参数展示和计算。
