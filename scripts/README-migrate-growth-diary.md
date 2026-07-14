# 成长里程碑 → 成长日记 本地迁移

将云库集合 `growth_milestones` 的历史数据，经本地 JSON 转换后导入新集合 `growth_diary`。本流程**仅在本地 Node 环境执行**，不部署为云函数。

## 前置条件

- 已在微信云开发控制台**新建集合** `growth_diary`（权限建议与 `growth_milestones` 对齐）。
- 本仓库已包含 `miniprogram/utils/growthDiaryUtils.js` 中的 `mapMilestoneToDiary` 映射逻辑。
- 本地已安装 Node.js（无需额外依赖）。

## 迁移步骤

### 1. 控制台导出旧数据

1. 打开 [微信云开发控制台](https://console.cloud.tencent.com/tcb) → 数据库。
2. 选择环境，进入集合 `growth_milestones`。
3. 使用「导出」功能，将全量记录导出为 JSON 文件（例如 `growth_milestones.export.json`）。

> 注意：云开发导出常为 **NDJSON**（每行一条 JSON），不是 `[...]` 数组。迁移脚本已同时支持 NDJSON 与 JSON 数组。

### 2. 本地运行转换脚本

在项目根目录执行：

```bash
node scripts/migrate-growth-milestones-to-diary.js <导出的 milestones.json> [输出路径]
```

示例：

```bash
node scripts/migrate-growth-milestones-to-diary.js ./growth_milestones.export.json ./growth_diary.import.json
```

- 第一个参数：控制台导出的 JSON 路径（必填）。
- 第二个参数：输出文件路径（可选，默认写入当前目录下的 `growth_diary.import.json`）。
- 输出为 **JSON Lines**（每行一条 JSON），与云开发控制台「导入」格式一致；不要用带缩进的 `[...]` 数组。

脚本会逐条调用 `mapMilestoneToDiary`，完成字段映射，主要包括：

- `photos` 置为 `[]`（旧里程碑无图片字段，阶段 A 不迁图）。
- `createdByOpenid` 优先取 `userInfo.openid`；若无 openid 则标记 `legacy: true`。
- `migratedFromId` 写入原 `growth_milestones._id`，便于核对与补迁。
- 其余字段（`babyUid`、`title`、`notes`、`eventDate` 等）按工具函数规则保留。

### 3. 控制台导入新集合

1. 回到云开发控制台 → 集合 `growth_diary`。
2. 使用「导入」功能，选择步骤 2 生成的 `growth_diary.import.json`。
3. 导入完成后，抽查条数是否与导出一致，并随机核对若干条的 `migratedFromId`、`babyUid`、`eventDate`。

### 4. 发版后停写旧集合

客户端新版本上线后：

- **只读写** `growth_diary`。
- `growth_milestones` 保留为只读备份，**不再写入**新数据。

### 5. 可选：补迁

若发版前仍有少量新里程碑写入旧集合，可在停写后：

1. 再次从 `growth_milestones` 导出增量（或全量重导）。
2. 重新运行本脚本生成导入文件。
3. 在导入前过滤掉 `migratedFromId` 已存在于 `growth_diary` 的记录，或仅在控制台导入新增部分，避免重复。

## 快速验证（本地 smoke）

```bash
node -e 'require("fs").writeFileSync("/tmp/ms.json", JSON.stringify([{_id:"1",babyUid:"b",title:"t",eventDate:"2026-01-01",userInfo:{openid:"o"}}]))'
node scripts/migrate-growth-milestones-to-diary.js /tmp/ms.json /tmp/diary.json
node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/diary.json","utf8").trim().split(/\n/)[0]); if(d.migratedFromId!=="1") process.exit(1)'
```

预期：三条命令均退出码为 0，且 `/tmp/diary.json` 首行记录的 `migratedFromId` 为 `"1"`。
