# 食谱墙上线检查

## 云开发控制台

1. 创建集合 `recipe_wall_posts`、`recipe_wall_likes`
2. 建议索引：
   - `recipe_wall_posts`: `status` + `createdAt`
   - `recipe_wall_posts`: `authorOpenid`（「我发布的」；云函数写入需显式带 `authorOpenid`，勿手动写 `_openid`）
   - `recipe_wall_posts`: `_openid`（若平台自动注入则兼容查询）
   - `recipe_wall_posts`: `status` + `searchText`（若控制台支持文本检索/正则组合，按提示补）
   - `recipe_wall_likes`: `userOpenid` + `postId`（唯一更好；云函数写入需显式带 userOpenid）
   - `recipe_wall_likes`: `userOpenid` + `createdAt`（「我赞过的」列表）
3. 上传并部署云函数 `recipeWallManager`（开通内容安全 openapi：`security.msgSecCheck`、`security.imgSecCheck`）
4. 云存储：登录用户可写自己的 `recipe-wall/**` 路径

## 权限 / 数据库安全规则

- `recipe_wall_posts` / `recipe_wall_likes`：禁止客户端直写；读写发布/点赞一律走云函数
- 列表仅对 `status=published` 对普通用户可见（由云函数过滤）

## 提审

1. UGC 声明：文本 + 图片；内容安全 API + 管理员下架
2. 版本说明写明：
   - 面向 0-10 岁孩子的日常食谱分享（含辅食、低蛋白等）
   - 已接入 `msgSecCheck` / `imgSecCheck`
   - 开发者可下架违规内容
3. 准备审核演示账号：发布、点赞、开发者下架

## 入口

- 用户：`我的` → `喂养管理` → `食谱墙`
- 开发者：`我的` → `食谱墙管理`

## 发布页说明（当前）

- 标签仅用于发布展示/搜索辅助（可选自定义）；广场页不做标签过滤
- 广场过滤：`全部` / `我赞过的` / `我发布的`；另支持关键词搜索
- 草稿：`status=draft`，仅「我发布的」可见；发布页可「存草稿」或直接「发布」；改云函数后需部署含 `saveDraft` / `getOwn` 的版本
- 已发布/已下架：作者可覆盖编辑（`publish` 带 `postId`），赞数保留；编辑时不显示「存草稿」（直接「保存发布」）
- 发布成功后回到广场列表
- 发布时写入 `searchText`（标题+描述+食材+标签），供关键词搜索
- 用料必须从食物库选择且份量必填，营养按食物库数据估算
- 调整用料支持上移 / 下移 / 删除（暂无拖拽）
- 流程：填写 → 确认弹窗 → 发布
- 广场卡片封面角标：取用户标签前 2 个
- 改云函数后需重新上传部署 `recipeWallManager`（`config.json` 超时 60s + 内容安全 openapi）

## 发布失败排查（「请确认已部署云函数」）

客户端该提示表示 `wx.cloud.callFunction` 本身失败（非业务 `{ ok:false }`）。新版预览页会弹出更具体原因。常见项：

1. **未部署 / 环境不对**：开发者工具右键 `cloudfunctions/recipeWallManager` → 上传并部署（云端安装依赖）
2. **超时 / 图片过大**：多图 + `imgSecCheck` 易超时；云函数超时 60s；发布页选图会自动压到约 1MB（`imgSecCheck` 限制），仍过大再换图
3. **集合未建**：创建 `recipe_wall_posts`、`recipe_wall_likes`
4. **内容安全未开通**：云函数权限需含 `security.msgSecCheck` / `security.imgSecCheck`；控制台开通内容安全
5. 看云函数日志：开发者工具 → 云开发 → 云函数 → `recipeWallManager` → 日志
