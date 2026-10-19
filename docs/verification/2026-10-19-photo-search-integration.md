# 搜索、拍照识别与长辈模式整合结论

日期：2026-10-19。

## 分支与整合范围

主项目目录已切换到 `codex/wechat-photo-recognition`，在该分支合入 `main` 的长辈模式。
整合前的两个版本分别是拍照／搜索 `bc51a47`、主分支 `1f1db81`。
本次只完成本地整合，没有推送、修改远端 main 或部署云函数。

## 搜索和识别的关系

搜索中的拍照入口、食物添加中的识别、奶粉添加中的识别，共用一个
`miniprogram/pkg-milk/components/nutrition-recognition` 组件及其工作流。
这部分复用在原 photo 分支已经实现，本次保留该结构，无需再复制一套识别算法。

- 搜索页的拍照入口跳转 `pkg-milk/nutrition-scan/index`，以 `auto` 模式自动判别类型，先预览，用户确认后保存资料。
- 食物管理以 `food_label` 模式识别，结果进入当前食物表单。
- 奶粉管理以 `powder_label` 模式识别，结果进入当前奶粉表单。
- 三个入口共用 `recognizeNutritionLabel`、`lookupNutritionReference`、`confirmNutritionRecognition`，分别负责识别、参考营养查询和确认保存。
- 识别保存成功或恢复已保存结果时，调用 `invalidateSearchForBaby` 使搜索会话失效，后续查询读取更新后的资料。

文字搜索仍由 `searchManager` 和 `packages/search-core` 负责查询已有资料及记录。
它与图片识别是两个职责，通过共用资料库、搜索失效通知和同一套识别入口衔接。

## 39 个本地文件的归属

这 39 个文件是 `packages/nutrition-recognition-core` 的部署副本：
三个营养云函数各 10 个，小程序识别组件 9 个（不含服务端模块）。
它们由 `npm run build:nutrition` 生成。初次整合时沿用 photo 的 `.gitignore` 规则，未将副本提交；后续按用户确认调整为随源码一起纳入版本管理，详见下方补充记录。
核对切换前后的内容，39 个产物及 `project.private.config.json` 共 40 个本地文件的哈希均未变化。

## 合并冲突处理

- `miniprogram/pages/data-records-v2/index.js`：先执行长辈模式跳转，再执行搜索记录定位；保留初始化期间防止重复加载的判断。
- `miniprogram/utils/dailyRecordV2Service.js`：保留搜索的只读查询与错误处理，同时透传长辈模式的 `allRecords`、`strictErrors`，避免失败被误显示成没有记录。
- 保留首页搜索／拍照入口、搜索与扫描页面注册，以及长辈主页、用药打卡等页面注册。

## 验证结果

- `npm run build:nutrition`、`npm run build:search` 成功。
- `npm run check:nutrition` 成功：共享源码与部署副本一致，独立加载通过。
- `npm run check:search` 成功：65 个页面／组件、377 个文件、417 处静态引用通过检查。
- `node --test tests/*.test.js`：940 项，934 项通过、6 项失败；没有新增或修改单元测试。
- 在合并前的 `bc51a47` 临时归档目录重跑失败用例所在的 5 个测试文件，失败集合与本次完全一致：记录页排便入口、两项加载图资源检查、营养目标提示、两项提醒入口检查。
- `git diff --check` 通过。

以上是本地构建、静态检查和已有测试结果，不代表微信编译器、真机或真实云端识别已经验收。
云端部署仍应按[已有部署清单](2026-10-14-home-search-scan-deployment.md)完整上传搜索和营养识别的相关函数及生成依赖，不能只上传搜索云函数。

## 营养识别部署副本纳入版本管理（2026-10-19 补充）

- 用户确认保留 39 个运行所需的部署副本，并将它们提交到 photo 分支，避免新检出后因漏执行构建而缺少模块。
- 移除 `.gitignore` 的四条 `lib/core` 目录规则，同时移除本机 `.git/info/exclude` 中此前增加的对应规则。
- 保留 `packages/nutrition-recognition-core` 为公共逻辑的维护入口，修改后执行 `npm run build:nutrition` 和 `npm run check:nutrition`，将源码与副本一同提交。
- 仅拉取完整提交或切换到包含这些副本的分支，无需再手动生成这 39 个文件；云函数上传仍应携带完整的 `lib/core` 目录。
- 本次验证：`npm run check:nutrition`、`npm run check:search` 通过；从暂存内容导出干净副本，未执行构建即通过营养模块一致性、独立加载和 39 个文件的 JS 语法检查。未新增或修改单元测试，未执行微信预览或云端部署。
