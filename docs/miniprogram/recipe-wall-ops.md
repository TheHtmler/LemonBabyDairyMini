# 食谱墙上线检查

## 云开发控制台

1. 创建集合 `recipe_wall_posts`、`recipe_wall_likes`
2. 建议索引：
   - `recipe_wall_posts`: `status` + `createdAt`
   - `recipe_wall_posts`: `_openid` + `createdAt`
   - `recipe_wall_posts`: `status` + `tags` + `createdAt`（标签过滤）
   - `recipe_wall_posts`: `status` + `searchText`（若控制台支持文本检索/正则组合，按提示补）
   - `recipe_wall_likes`: `_openid` + `postId`（唯一更好）
3. 上传并部署云函数 `recipeWallManager`（开通内容安全 openapi：`security.msgSecCheck`、`security.imgSecCheck`）
4. 云存储：登录用户可写自己的 `recipe-wall/**` 路径

## 权限 / 数据库安全规则

- `recipe_wall_posts` / `recipe_wall_likes`：禁止客户端直写；读写发布/点赞一律走云函数
- 列表仅对 `status=published` 对普通用户可见（由云函数过滤）

## 提审

1. UGC 声明：文本 + 图片；内容安全 API + 管理员下架
2. 版本说明写明：
   - 仅宝宝辅食 / 低蛋白 / 特医友好食谱
   - 已接入 `msgSecCheck` / `imgSecCheck`
   - 开发者可下架违规内容
3. 准备审核演示账号：发布、点赞、开发者下架

## 入口

- 用户：`我的` → `食谱墙`
- 开发者：`我的` → `食谱墙管理`

## 发布页说明（当前）

- 标签可选（最多 2 个）：辅食 / 低蛋白 / 特医友好 / 加餐点心；用于列表过滤
- 发布时写入 `searchText`（标题+描述+食材+标签），供关键词搜索
- 用料必须从食物库选择，营养按食物库数据估算
- 调整用料支持上移 / 下移 / 删除（暂无拖拽）
- 流程：填写 → 预览（含营养）→ 确认发布
- 改云函数后需重新上传部署 `recipeWallManager`
