# 识别结果匹配本地分类与蛋白类型

**目标：** 拍照识别及营养估算同时返回分类、蛋白类型建议，分类必须匹配本地目录；不存在时由用户创建或选择已有分类。沿用当前分支、当前会话执行。

**需求来源：** 用户直接要求结合本地分类，缺少分类时提示创建，蛋白来源跟随营养参数返回。现有三类为天然蛋白（优质）、天然蛋白（普通）、特殊蛋白。

**实现约定：** prepare冻结本地分类选项，识别与估算复用其JSON数据；模型返回classification={category,proteinSource,proteinQuality}。服务端只接受有效枚举，并绑定食物身份，分类通过明确名称／已定义别名匹配本地值。无匹配仅提示，不静默创建。已有分类和蛋白选择保留，推荐可明确采用；特殊蛋白仅建议，须明确采用，不根据蛋白克数或为0自动判断。

**边界：** 食物允许创建宝宝自定义分类；奶粉继续使用固定本地分类和角色，不扩展任意奶粉分类。本轮不新增或修改单测，不提交、推送、部署、调用真实模型／生产数据库，不启动微信工具。维持使用结果才回填、外层保存才落库；用户点击创建分类是独立且明确的分类写入，取消识别不会删除已创建分类。

## Task 1：云端分类建议与共享约定

**文件：** packages/nutrition-recognition-core/classification.js、index.js；cloudfunctions/recognizeNutritionLabel/{sessionRepository,index,modelClient,estimateService}.js。

**接口：** normalizeCategoryCatalog(options) → [{value,label}]；matchCategory(name,options) → 选项或null；normalizeClassification(raw,identity,catalog,{allowSpecial}) → 带身份和来源的建议；分类建议独立于营养数值、标签证据，不进入营养选值白名单。

- [x] 规范本地分类、唯一匹配及蛋白枚举，保留未知；模型目录最多100项，新分类名称最长60字符，完整旧目录标识不裁切。
- [x] prepare冻结分类，图片识别及文字估算在原调用中返回建议，不新增模型调用。
- [x] 识别响应classification、estimate.classification均绑定当前身份；普通食材文字估算不能建议特殊蛋白。

## Task 2：本地匹配、创建与回填

**文件：** miniprogram/pkg-milk/components/nutrition-recognition/{dialogState,workflow,index}.js、index.wxml/.wxss；miniprogram/pkg-milk/food-management/index.js/.wxml。

**接口：** applyClassification(state,suggestion)管理独立分类／蛋白建议与手选保护；创建分类复用FoodCategoryModel.addCategory；categorycreated事件只同步目录，不回填父表单；一次使用结果继续输出category和proteinTypeIndex。

- [x] 自动预选匹配的本地分类和有效天然蛋白建议，保留已有／用户手选项；支持明确采用新建议。
- [x] 不存在的分类提示创建或选择已有项，创建失败不选中；成功同步当前宝宝分类目录，异步取消不回填表单，切宝宝不回显。
- [x] 名称变更清除不匹配的旧自动建议；特殊蛋白需明确采用，奶粉沿用固定分类。

## Task 3：验证、文档和一次审查

- [x] 使用临时合成输入验证云端请求及返回、本地匹配、非法枚举、未知分类、创建成功／失败、手选保护、迟到响应和保存类型映射。
- [x] 构建、独立加载、语法、WXML结构和diff检查，运行相关既有回归；不编写项目单测。
- [x] 更新接入／验收文档，执行一次独立审查及必要修复，记录本地验证边界。

## Review Focus

- 模型返回任意新分类不得直接进入表单，必须匹配本地或经创建；重名及别名歧义不误匹配。
- 蛋白来源与质量不能混淆，特殊蛋白、未知和非法枚举不能自动选为某种天然蛋白。
- 改名、取消、切宝宝及重试不得应用旧分类／蛋白建议；创建完成不得污染新表单。
- 已有选择不覆盖；创建事件仅更新目录，未使用结果时父表单零patch。
- 共享模块继续采用顶层静态require，云函数目录内可独立加载，旧营养来源／版本规则保持有效。
