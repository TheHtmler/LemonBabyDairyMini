# LemonBabyDairyMini 微信小程序拍照识别接入文档

版本日期：2026-10-09。模型：`qwen3.7-plus`，百炼北京地域。

功能：在“添加食物”“添加奶粉”表单中增加拍照／相册识别，回填营养字段，用户核对后通过现有方法保存。本文为开发接入约定，新增识别代码尚未落入项目。

## 1. 文件接入位置

项目根目录：`/Users/randyhsu_m4/Documents/workspace/MyProjects/LemonBabyDairyMini`。

| 文件 | 改动 |
| --- | --- |
| `cloudfunctions/recognizeNutritionLabel/index.js`，新增 | 鉴权、读取图片、调用百炼、校验与换算、返回结果 |
| `cloudfunctions/recognizeNutritionLabel/package.json`，新增 | 声明 `wx-server-sdk` 等实际使用的依赖 |
| `cloudfunctions/recognizeNutritionLabel/config.json`，新增 | 超时60秒、内存512MB |
| `miniprogram/utils/nutritionRecognition.js`，新增 | 选图、压缩、上传、调用、状态管理 |
| `miniprogram/pkg-milk/food-management/index.js/.wxml/.wxss` | 识别按钮、结果提示、回填 `formData` |
| `miniprogram/pkg-milk/powder-management/index.js/.wxml/.wxss` | 识别按钮、输入同步、回填 `powderDraft` |

复用 `miniprogram/app.js` 的 `wx.cloud.init` 和 `app.globalData.cloudEnvId`。图片上传、函数部署与调用使用同一环境。

## 2. 云函数配置

在云开发控制台的识别函数“配置 → 环境变量”中设置：

| 变量 | 值 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 北京地域的百炼普通 API Key |
| `BAILIAN_BASE_URL` | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，替换真实业务空间ID |
| `BAILIAN_MODEL` | `qwen3.7-plus` |

密钥只放云函数。代码分别从 `process.env` 读取上述变量；缺少配置时返回 `CONFIG_MISSING`，不发起模型请求。Base URL与密钥地域、业务空间保持一致。[官方接入说明](https://help.aliyun.com/zh/model-studio/vision)

`config.json`：

```json
{
  "timeout": 60,
  "memorySize": 512
}
```

百炼请求在代码中设置25秒总时限；超时需主动终止底层请求。小程序使用普通事件云函数 `wx.cloud.callFunction`。[微信云函数调用说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)

## 3. 小程序 → 云函数接口

函数名：`recognizeNutritionLabel`。

### 请求

```typescript
interface RecognitionRequest {
  requestId: string; // 一次识别操作的唯一ID
  babyUid: string;   // 用于检查现有宝宝访问权限，不传给百炼
  mode: 'food_label' | 'powder_label' | 'food_object';
  fileIDs: string[]; // 当前云环境中上传的图片ID，1～3张
}
```

模式：`food_label` 提取包装食品营养表；`powder_label` 提取奶粉营养表和冲调说明；`food_object` 只识别食物名称，再由小程序匹配现有系统食物库。

### 成功返回

```typescript
interface RecognitionSuccess {
  ok: true;
  requestId: string;
  mode: RecognitionRequest['mode'];
  patch: FoodPatch | PowderPatch;
  missingFields: string[]; // 缺失字段路径，例如 nutritionPer100g.protein
  warnings: string[];      // 单位、计量基准或图片不清晰等提示
  evidence: Record<string, { imageIndex: number; text: string }>;
  originalBasis: {
    quantity: number | null;
    unit: string | null;
    material: 'food' | 'dry_powder' | 'prepared_formula' | 'unknown';
  };
  usage: { inputTokens: number; outputTokens: number };
}

interface FoodPatch {
  name?: string | null;
  category?: string | null;
  categoryLevel2?: string | null;
  unit?: string | null;
  baseQuantity?: number | null;
  calories?: number | null;
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
  fiber?: number | null;
  sodium?: number | null;
}

interface PowderPatch {
  name?: string | null;
  nutritionPer100g?: {
    calories?: number | null;
    protein?: number | null;
    fat?: number | null;
    carbs?: number | null;
    fiber?: number | null;
  };
  mixRatio?: { powder?: number | null; water?: number | null };
}
```

`patch` 为云函数校验后的白名单字段，不是模型原始输出。证据的 `imageIndex` 从0开始，与请求图片顺序一致；缺失值返回 `null` 或省略，不返回虚构数字。奶粉分类与 `proteinRole` 由现有分类流程维护，不直接由模型回填。

### 失败返回

```typescript
interface RecognitionFailure {
  ok: false;
  requestId: string;
  code: 'CONFIG_MISSING' | 'INVALID_INPUT' | 'FORBIDDEN'
    | 'FREE_QUOTA_EXHAUSTED' | 'MODEL_TIMEOUT'
    | 'MODEL_UNAVAILABLE' | 'INVALID_MODEL_RESULT';
  message: string;
}
```

失败时不修改表单。百炼返回 `AllocationQuota.FreeTierOnly` 时映射为 `FREE_QUOTA_EXHAUSTED`，不自动切换其他模型。

## 4. 云函数 → 百炼接口

请求：`POST ${BAILIAN_BASE_URL}/chat/completions`。

请求头：`Authorization: Bearer ${DASHSCOPE_API_KEY}`、`Content-Type: application/json`。

图片由云函数读取并编码为 `data:image/jpeg;base64,...` 或 `data:image/png;base64,...`。不能把微信 `fileID` 或手机临时路径直接传给百炼。

请求体构造：

```javascript
// imageDataUrls 是云函数读取图片后生成的Base64数据地址数组。
function buildModelRequest(imageDataUrls, prompt) {
  return {
    model: process.env.BAILIAN_MODEL,
    enable_thinking: false,
    stream: false,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...imageDataUrls.map(url => ({
          type: 'image_url',
          image_url: { url }
        }))
      ]
    }]
  };
}
```

`qwen3.7-plus` 默认开启思考，因此必须显式传 `enable_thinking: false`。[思考模式配置](https://help.aliyun.com/zh/model-studio/vision)

提示词按 `mode` 生成，至少要求：

- 输出JSON；仅抽取图片可见信息，无法确认的值为 `null`。
- 返回名称、所需营养字段、原始单位、营养计量基准和对应图片文字证据。
- 奶粉区分干粉与冲调液；冲配比区分粉重、加水量、成品体积和每勺克数。
- `food_object` 只返回候选食物名称，不生成营养值。

解析 `choices[0].message.content`，检查 `finish_reason`，拒绝截断、不可解析或字段类型错误的结果。JSON模式不保证数据真实，仍需服务端校验。[结构化输出说明](https://help.aliyun.com/zh/model-studio/qwen-structured-output)

服务端在调用前获取 `cloud.getWXContext().OPENID`，复用现有宝宝访问权限逻辑；校验图片属于允许访问的用户／宝宝路径和当前环境。限制实际图片为JPEG／PNG、单张不超过3MB、最多3张。日志只记录请求ID、耗时、用量和错误码。

## 5. 单位校验与字段回填

| 识别内容 | 回填目标 | 单位／规则 |
| --- | --- | --- |
| 食物名称、分类 | `formData.name/category/categoryLevel2` | 分类匹配页面已有选项 |
| 食物营养基准 | `formData.unit/baseQuantity` | 保留每100g、每100ml或每份；单位映射为现有表单值 |
| 食物热量 | `formData.calories` | kcal；若包装为kJ，除以4.184 |
| 食物蛋白、脂肪、碳水、纤维 | `formData.protein/fat/carbs/fiber` | g，相对于上述营养基准 |
| 食物钠 | `formData.sodium` | mg，必要时由g换算为mg |
| 奶粉名称 | `powderDraft.name` | 可组合包装上明确的品牌、系列、段位 |
| 奶粉营养 | `powderDraft.nutritionPer100g` | 每100g干粉；热量kcal，其余g |
| 冲配粉量 | `powderDraft.mixRatio.powder` | g，可使用明确每勺克数×勺数计算 |
| 冲配水量 | `powderDraft.mixRatio.water` | 加水量ml，不能用成品体积替代 |

仅有每100ml冲调液营养时，缺少可靠粉重与成品体积就不换算为每100g干粉。g与ml没有可靠密度时不互换。字段缺失与确认值0分别处理。

前端合并 `patch` 时：

1. 只接收白名单路径，非空有效数值转为表单字符串；0保留，`null` 不回填。
2. 默认填入空字段和未被手动修改的上次识别字段；覆盖已有手填值需用户明确选择。
3. 奶粉输入目前主要通过 `e.detail.value` 在提交时读取，需为名称、营养、冲配比增加 `bindinput`，同步 `powderDraft` 并记录修改状态；保留现有输入的 `name` 属性。
4. 回填基准、名称和营养字段应作为一组处理。保留旧营养值时，不能自动改成另一计量基准；冲配粉量、水量也应成组核对。
5. 对照当前 `requestId` 和表单状态，丢弃切换条目或关闭表单后到达的结果。
6. 展示缺失项和核对提示，不自动保存；必填项缺失时补拍，不用0通过校验。

食物继续使用 `saveFood()`；奶粉继续使用 `savePowderDraft(e)`。母乳编辑状态不显示拍照识别入口。`food_object` 复用系统食物库的搜索／加入流程，匹配不唯一时让用户点选。

保留识别证据和缺失标记：当前部分营养归一化逻辑会将空值转为0，展示时不能把缺失项目描述为确认值0。

## 6. 调用与部署顺序

小程序选图、压缩、上传云存储后调用：

```javascript
// 以下变量由当前识别操作和图片上传结果提供。
const { result } = await wx.cloud.callFunction({
  name: 'recognizeNutritionLabel',
  data: { requestId, babyUid, mode, fileIDs }
});
```

识别期间禁用重复提交。上传／调用异常及成功返回后均在 `finally` 中恢复操作状态；页面级等待超时只结束界面等待，不等于取消云端请求，因此不自动重试。

1. 实现第1节的新文件及两个页面接入。
2. 在微信开发者工具选中与 `app.js` 一致的云环境，上传识别函数并云端安装依赖。
3. 在该函数配置第2节的环境变量、超时和内存。
4. 使用目标模型当前有效免费额度时，在百炼为 `qwen3.7-plus` 开启“免费额度用完即停”，确认生效后调用。
5. 云函数部署就绪后上传小程序体验版，核对图片读取、字段回填、单位换算和原有保存流程，再按项目发布流程上线。

本接入使用现有云开发环境和普通云函数调用，无需配置小程序直接请求百炼的域名。
