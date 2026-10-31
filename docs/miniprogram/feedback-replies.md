# 反馈回复功能使用与发布说明

当前持续追问功能在 `codex/feedback-follow-up` 分支实现。本文及规则文件仅为发布资料，不会自动修改云端环境。

## 功能入口

- 用户：我的 → 意见反馈 → 我的反馈 → 反馈详情。
- 管理员：我的 → 反馈列表 → 回复用户／查看回复。
- 用户提交后进入当前反馈详情，可直接补充情况，也可点击某条管理员回复的“针对这条回复继续追问”。每次追问都追加到同一工单，不覆盖此前记录。
- 管理员可“提交回复”或“回复并标记已处理”，每次回复都是新的处理记录。最新回复继续作为列表摘要，完整处理过程在详情中查看。
- 已处理的反馈收到用户新补充时重新进入“未处理”，并恢复管理员待办；一条工单仍按一条待办计数，不按补充条数累加。
- 未填写回复不能新标记已处理；历史已处理但无回复的记录继续显示原状态和“暂无回复说明”。
- 新回复联动底部“我的”、意见反馈入口、我的反馈标签、具体反馈条目的红点。
- 管理员还有独立的待处理提示：反馈列表入口和列表内“未处理”筛选显示红点及数量（超过 99 显示 99+）；底部“我的”汇总个人未读回复与管理员待处理反馈。
- 管理员提示按 `status = new` 统计，进入列表或只保存回复不会清除；标记已处理或删除后刷新，恢复未处理后重新显示。全部待处理清空后，若个人还有未读回复，底部红点继续保留。
- 进入列表不会确认已读，详情的回复区域进入可视范围才确认对应版本；还有其他未读反馈时保留上级红点。
- 普通用户只能查看本人提交的反馈；同一宝宝的其他照护者无权查看。

## 云端数据与权限

复用集合 `feedback_messages`，新增字段：

| 字段 | 用途 |
| --- | --- |
| `replyContent` | 最新回复正文，1–1000 字 |
| `repliedAt` / `repliedBy` | 最近一次追加管理员回复的服务端时间和管理员身份 |
| `replyVersion` / `readReplyVersion` | 回复版本与提交者已读版本 |
| `hasUnreadReply` | 用于未读统计的事务内同步字段 |

新增主记录摘要字段：`conversationVersion`、`followUpCount`、`lastUserContent`、`lastUserEntryAt`、`lastAdminEntryAt`、`lastMessageContent`、`lastMessageRole`、`lastMessageAt`。`replyVersion` 现在表示管理员回复序号，每次追加回复递增；`conversationVersion` 在任意一方追加记录后递增，用于防止旧页面覆盖新处理状态。

新增 **`feedback_thread_entries` 集合**，每条补充或回复单独存储：`feedbackId`、`sequence`、`role`、`content`、`createdAt`、`replyVersion`、`replyTo`、`requestFingerprint`。记录 ID 由反馈、当前微信身份和提交标识确定；返回客户端时不包含请求指纹。`replyTo` 仅保存同一工单内被引用记录的标识、角色和最多 160 字摘要。

原反馈正文继续保存在主记录。既有反馈的最近一次管理员回复在首次追加时事务内归档；此前被旧功能覆盖的更早回复无法恢复。历史记录无须批量回填。用户列表仍按 `createdAt` 与 `_id` 倒序分页，每页 20 条；缺少 `createdAt` 的手动导入记录不在此范围。详情每次读取最近 30 条追加记录，更早记录按 `sequence` 游标向前加载。

在云开发控制台为 **`feedback_messages` 集合**配置 `feedback-messages.rules.json` 中的规则：客户端直读和直写均禁止，所有请求通过 `feedbackManager`。不要把这份集合规则用于云函数调用权限，否则会阻断正常调用。

为 **`feedback_thread_entries` 集合**配置同目录的 `feedback-thread-entries.rules.json`，同样禁止客户端直读直写。读取处理记录、引用记录和追加记录均先核对主记录所有者或固定管理员身份，不能用共享宝宝的权限代替本人权限。

云函数使用微信上下文 `OPENID` 验证提交者和既有管理员白名单；客户端传入的视图、用户身份或角色不能代替服务端授权。普通用户响应只返回反馈内容、状态、时间及回复字段，不返回联系方式、设备、管理员身份或保存请求标识。

规则语法参考：[CloudBase 数据库安全规则](https://docs.cloudbase.net/database/security-rules)、[安全规则介绍](https://docs.cloudbase.net/rule/introduce)。本次未读取或修改线上权限，上线前需在实际环境确认。

## 索引

在 `feedback_messages` 上准备下列非唯一索引；若已有同字段、同顺序索引，复用即可。

| 用途 | 字段与顺序 |
| --- | --- |
| 我的反馈分页 | `openid` 升序、`createdAt` 降序、`_id` 降序 |
| 未读计数 | `openid` 升序、`hasUnreadReply` 升序 |
| 管理员按状态筛选及待处理计数 | `status` 升序、`createdAt` 降序（计数使用 `status` 前缀） |
| 管理员全部列表 | `createdAt` 降序 |
| 管理员按最近处理活动排序 | `lastMessageAt` 降序 |
| 管理员状态与最近活动 | `status` 升序、`lastMessageAt` 降序 |

`feedback_thread_entries` 新增非唯一索引：`feedbackId` 升序、`sequence` 降序。详情与引用的单条记录按默认 `_id` 索引访问。管理员列表合并“最新创建”和“最近活动”两个最多 100 条的查询，再按活动时间取前 100 条，使旧反馈的新追问也能进入列表；旧记录以创建时间参与合并。

详情和事务按默认 `_id` 索引访问。用户分页固定绑定当前 OPENID，用时间和文档 ID 组合游标避免同一毫秒记录翻页遗漏；游标不会改变查询身份。索引说明参考：[CloudBase 数据库索引](https://docs.cloudbase.net/database/data-index)。

## 接口和并发规则

当前接口为 `submit`、`listMine`、`list`、`getDetail`、`listEntries`、`appendEntry`、`getUnreadCount`、`markReplyRead`、`updateStatus`、`delete`。旧的覆盖式 `saveReply` 已移除；云函数与小程序必须配套发布。

`getUnreadCount` 返回个人未读 `count` 和管理员待处理 `adminPendingCount`。后者由云端白名单判断，普通用户固定返回 0，不查询全局待办。管理员待处理数量独立查询整个集合，不从最多 100 条的列表中计算。首页与消息中心沿用此前的汇总方式，追加记录不会将同一反馈重复计数。

- `appendEntry` 携带 `id`、`view`、`content`、`mode`、`baseConversationVersion`、`requestId` 及可选 `replyToId`；用户视图只允许补充，管理员视图由服务端验证身份后允许回复和处理。
- 相同请求标识、正文、引用、模式和基础版本重试只产生一条记录。并发记录变更时返回 `CONFLICT`，前端刷新并保留草稿。每个工单同一角色两次成功提交至少间隔 3 秒。
- “回复并标记已处理”在同一事务内追加记录、递增版本和更新状态；用户补充在同一事务内重新打开反馈。
- `updateStatus` 必须携带所见 `baseConversationVersion`，事务内拒绝旧版本操作，避免管理员旧列表将用户刚追加的追问误标为已处理。
- 已读确认只提交实际展示的版本，与并发回复通过同一文档事务协调，保留更晚版本的未读状态。
- 未读缓存按账号隔离，30 秒内复用并合并请求；前台恢复、下拉刷新和已读写入会刷新。用户端和管理员端均不定时轮询，30 秒仅为缓存有效期，不会定时发请求。
- 管理员列表在首次进入、返回页面、切换筛选、下拉刷新及处理操作后更新；停留在页面不会持续拉取。列表最多显示最近活动的 100 条，本功能未扩展管理员工单列表的分页。
- 删除反馈先在事务中锁定主记录，禁止继续追加，再每批清理 40 条处理记录，最后删除主记录；失败时管理员可从原列表重试。成功后用户列表和红点在下次刷新时更新。

## 功能与审核边界

本功能实际限定为“提交者与固定管理员围绕一条问题的封闭反馈工单”，只支持文字补充、引用回复与处理状态。没有用户互相发现、匹配、任意私信、公开讨论、群聊、语音、在线状态或输入状态。不能通过改名或隐藏入口规避应适用的规则，类目与审核要求仍须按完整小程序的实际服务确认；本次无法直接读取微信官方规范正文，没有得出免审或无需相关类目的结论。

初始反馈和每次新增补充、回复均通过服务端 `security.msgSecCheck` v2，检查通过才写入；违规、待审或检查不可用均阻止写入并保留草稿。云函数的 `config.json` 已声明 `security.msgSecCheck` 权限，发布前需确认目标小程序可调用该能力。官方核对入口：[平台规范](https://developers.weixin.qq.com/miniprogram/product/)、[类目说明](https://developers.weixin.qq.com/miniprogram/product/material.html)、[文本安全接口](https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html)。这些链接为后续核对入口，本次没有读取到有效正文。

## 发布顺序

1. 经用户确认后创建 `feedback_thread_entries` 集合，设置两份集合安全规则及上述索引，等待索引可用。本文和本地代码不会自动创建或修改线上资源。
2. 确认文本安全权限已可用，部署包含 `thread.js` 与 `config.json` 的 `cloudfunctions/feedbackManager`；沿用现有依赖版本，不升级 `wx-server-sdk`。
3. 配套发布新版小程序。新增 `appendEntry` / `listEntries` 替换旧覆盖式回复，旧客户端在切换窗口无法继续使用旧 `saveReply`；需要安排受控发布窗口。
4. 经用户另行同意后，验收用户补充、引用、管理员回复、追问重开、通知计数、权限隔离、旧记录归档、分页与并发冲突。本次未执行单元测试、界面或线上验收，未部署云函数或更改数据库。

云部署和数据库配置更新需另行执行；代码提交、推送及合并状态以 Git 记录为准。完整小程序编译及真机表现仍需微信开发者工具确认；本地只执行语法和静态检查。
