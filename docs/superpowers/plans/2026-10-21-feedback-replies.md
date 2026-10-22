# 反馈回复功能实施计划

> 执行方式：使用 superpowers:executing-plans 在当前会话逐项实现，完成后使用 superpowers:requesting-code-review 做独立代码审查。用户已授权实现，按用户约定跳过单测编写、界面验收和自动提交。

**目标：** 管理员回复反馈，提交者在小程序查看，并通过四层红点发现新回复。

**架构：** `feedbackManager` 统一执行权限校验、游标分页、回复和已读事务；客户端共享模块维护身份隔离的未读摘要；用户和管理员复用详情页，通过服务端校验区分视图。

**技术栈：** 原生微信小程序 JavaScript / WXML / WXSS，现有 wx-server-sdk，不升级依赖。

**设计：** `docs/superpowers/specs/2026-10-21-feedback-reply-design.md`。

## 全局约束

- 仅在 `codex/feedback-replies` 分支实现，不提交、不推送、不部署。
- 不新增、修改、扩充单元测试；不启动服务，不操作界面，不截图验收。
- 回复 1–1000 字，反馈 5–500 字；按 JavaScript 字符串长度统一计数。
- 每条只保留最新回复；状态使用 `new` / `processed`；无回复不能新标记已处理。
- 页面及接口使用中文；不新增订阅消息、聊天、用户追问或营销提醒。
- 云端身份来自 OPENID，用户只能查看本人反馈，管理操作必须通过白名单。

## 审查重点

1. 越权详情、回复、已读与非法游标：身份条件不可被客户端覆盖。
2. 已读和回复并发：旧版本确认不清除新回复；重复保存不重复递增版本。
3. 身份变化和过期请求：不把旧账号数据或旧未读数写回新视图。
4. 编辑草稿与加载失败：刷新不覆盖草稿，失败不能展示成功，重试沿用请求 ID。
5. 老记录、删除、下拉分页和缓存失效：正常历史反馈可读，列表不混页，红点按真实未读更新。

## 任务 1：云函数

- [x] 修改 `cloudfunctions/feedbackManager/index.js`，保留既有操作并新增 `listMine`、`getDetail`、`getUnreadCount`、`saveReply`、`markReplyRead`。
- [x] 统一返回 `{ok, data?, code?, message?}`；用户详情返回白名单；列表返回 `data` 数组与 `nextCursor`。
- [x] `saveReply` 接收 `id/replyContent/mode/baseReplyVersion/requestId`，mode 为 `reply` 或 `process`；事务返回最新版记录。`markReplyRead` 接收 `id/seenReplyVersion`。
- [x] 补齐字段默认值、同正文无新未读、并发冲突、仅服务端时间、原子状态和删除不存在处理。
- [x] 运行 `node --check cloudfunctions/feedbackManager/index.js`，记录实际结果。

## 任务 2：共享客户端服务

- [x] 新建 `miniprogram/utils/feedback.js`，提供 `callFeedback(action, data)`、`refreshUnread({force})`、`refreshUnreadSilently`、`subscribeUnread(listener)`、`resetFeedbackState()`、`invalidateUnread()`、`acknowledgeReply(id, seenReplyVersion)`、`normalizeFeedback(item)`、`createReplyRequestId()`。
- [x] 未读快照包含 `count/known/identity/revision`；30 秒内缓存、请求合并、写后失效、旧响应隔离、导航红点重试与账号退出清理。
- [x] 所有页面只依赖共享模块，不直接改写数据库或凭本地角色取得权限。
- [x] 运行新模块语法检查。

## 任务 3：用户列表与共享详情

- [x] 修改 `miniprogram/pkg-misc/feedback/index.{js,wxml,wxss,json}`：标签、分页、错误与空态、提交后进入列表、未读摘要及滚动位置保持。
- [x] 新建 `miniprogram/pkg-misc/feedback-detail/index.{js,wxml,wxss,json}`：原问题、回复、管理员编辑区、只对前台已显示版本确认已读、冲突和草稿保护。
- [x] 在 `miniprogram/app.json` 注册详情页，视图参数 `view=admin` 仅作请求意图，服务端决定能否编辑。
- [x] 运行 JS 语法、JSON 解析与 WXML 静态结构检查。

## 任务 4：管理员入口与四层红点

- [x] 修改 `miniprogram/pkg-misc/feedback-list/index.{js,wxml,wxss}` 增加回复摘要和详情入口，状态更新使用共享服务，无回复时跳转填写。
- [x] 修改 `miniprogram/pages/profile/index.{js,wxml,wxss}` 增加入口提示、订阅清理及进入我的反馈标签的参数。
- [x] 修改 `miniprogram/app.js` 和四个底部导航页生命周期，身份就绪/前台/页面切换时刷新，注销清空；不改变原有主功能执行顺序。
- [x] 运行所有改动 JS 的语法检查和本地引用/路由静态检查。

## 任务 5：交付配置、审查和验证

- [x] 编写 `docs/miniprogram/feedback-replies.md`，记录操作、待部署云函数、数据库索引/权限配置与发布顺序；提供可检查的本地配置，不访问生产数据。
- [x] 独立代理只读审查工作区全部改动，修复重要问题，不编写单测或操作界面。
- [x] 重新运行语法、JSON、模板与引用静态检查、`git diff --check`；如本地无小程序编译工具，明确说明未执行完整小程序编译。
- [x] 刷新代码索引，记录完成项及剩余部署/验收限制。

## 执行记录

### 提交与合并授权

- 用户明确授权：提交并推送 `codex/feedback-replies`，随后合并到 `main` 并推送。
- 提交前再次完成 10 个 JS 语法、4 个 JSON、4 个 WXML 及 31 个事件绑定、4 个 WXSS、74 个本地引用与差异格式检查，均通过；未新增单测、未执行界面验收。
- 云函数部署、数据库权限和索引配置不包含在此次 Git 操作内；提交与合并结果以 Git 记录为准。

### 后续调整：移除管理员轮询

- 用户明确管理员也不需要轮询：移除列表的定时器、启动／停止逻辑及仅用于轮询的可见状态。
- 保留首次进入、返回页面、切换筛选、下拉刷新与处理操作后的更新，以及账号变更隔离和卸载取消订阅。
- 同步更新空态文案和发布说明；未读模块的 30 秒缓存保留，仅由页面或操作事件触发请求。
- 验证完成：管理员列表和共享提醒模块未检索到定时器或轮询残留；JS 语法、WXML 结构及 `git diff --check` 通过，独立只读复核未发现悬空调用或生命周期回归。未执行界面验收或部署。

### 后续补充：管理员待处理红点

- 用户追加要求：管理员的反馈列表也显示红点。
- 实施口径：以 `status = new` 为待处理；“保存回复”不自动清除，标记已处理或删除后刷新；与个人未读分别计数，底部“我的”按任一来源有提醒显示。
- 步骤：云函数增加仅管理员可见的待处理统计 → 共享缓存合并两种提醒 → 入口和列表筛选显示 → 更新写后失效、静态检查与只读审查。
- 延续已有功能分支，不新增集合或数据库字段，不编写单测、不执行界面验收、不部署。
- 补充实现已完成：管理员待处理统计、入口及筛选红点、底部汇总与写后刷新均已接入；独立只读审查未发现需修复问题。
- 本轮验证通过：10 个 JS 语法、4 个 JSON 解析、4 个 WXML 结构及 31 个事件绑定、4 个 WXSS 括号、74 个本地引用、`git diff --check`。未进行界面或线上验收，尚未部署。

- 2026-10-21：确认功能分支正确；保留已有 AGENTS.md 与设计文档。
- 决定：继续使用用户已建立的功能分支和当前工作区，不另外创建工作树；不运行技能中的自动提交、单测及清理脚本。
- 接口预检查：任务 3/4 依赖任务 2 的统一调用和未读快照，任务 2 依赖任务 1 的动作、错误码及版本字段；接口约定一致。

- 实现完成：云函数、用户列表与详情、管理员回复入口、共享未读服务和四层红点已接入；未升级依赖。
- 静态验证：10 个 JavaScript 文件通过 `node --check`；4 个 JSON 解析成功；4 个 WXML 标签结构与 31 个事件绑定通过检查；4 个 WXSS 括号检查通过；74 个本地依赖与 3 个反馈路由存在；`git diff --check` 通过。
- 独立只读审查发现并修复：并发统计重复扣减未读、跨版本已读确认遗漏、切回标签不刷新、重试分页模式错误、多页返回覆盖新阅读回执。返回列表刷新已加载范围，避免丢掉已加载分页。
- 重要决策：条目按服务端阅读回执及时更新，总数重新向云端统计；不在本地猜测递减，避免错误清除其他未读反馈的红点。
- 已补充 `docs/miniprogram/feedback-replies.md` 和 `feedback-messages.rules.json`，仅为发布资料，尚未修改线上集合权限或索引。
- 验证限制：未新增或修改单元测试，未执行界面、真机或线上事务验收；本地未安装 miniprogram-ci，未执行完整微信小程序编译。本地安装 SDK 3.0.1 的事务回调返回值已由源码确认，云函数声明仍为既有 ~2.6.3，精确部署版本未在线核验。
- 交付状态：保持 `codex/feedback-replies` 分支，未提交、推送或部署。上线需先配置数据库权限与索引、部署 feedbackManager，再发布小程序；界面验收仍需用户单独授权。
