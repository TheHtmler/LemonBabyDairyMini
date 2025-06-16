# 工具函数库使用说明

本目录包含了小程序项目中使用的通用工具函数，按功能模块组织。

## 文件结构

```
utils/
├── index.js           # 统一导出文件
├── feedingUtils.js    # 喂养相关工具函数
├── uiUtils.js         # UI界面工具函数  
├── dataUtils.js       # 数据处理工具函数
└── README.md          # 使用说明文档
```

## 使用方式

### 1. 统一导入（推荐）

```javascript
const { utils, calculator, dataManager, uiUtils, dataUtils } = require('../../utils/index');
```

### 2. 按需导入

```javascript
const { utils, calculator, dataManager } = require('../../utils/feedingUtils');
const uiUtils = require('../../utils/uiUtils');
const dataUtils = require('../../utils/dataUtils');
```

## 功能模块说明

### feedingUtils.js - 喂养相关工具

#### utils - 通用工具
- `formatTime(date)` - 格式化时间为 HH:MM
- `createTimeObject(timeStr)` - 从时间字符串创建Date对象
- `validateFeedingData(data)` - 验证喂奶数据
- `validateTimeData(startTime, endTime)` - 验证时间数据
- `handleError(error, defaultMessage)` - 统一错误处理
- `showSuccess(message)` - 显示成功提示

#### calculator - 计算工具
- `calculateSpecialMilk(naturalMilkVolume, totalVolume, calculation_params)` - 计算特奶量
- `calculateSpecialMilkPowder(specialMilkVolume, calculation_params)` - 计算特奶粉克重
- `calculateFormulaPowderWeight(naturalMilkVolume, calculation_params, proteinSourceType)` - 计算奶粉克重
- `calculateRecommendedVolume(weight, calculation_params, mealsPerDay)` - 计算建议奶量

#### dataManager - 数据管理
- `updateFeedingData(context, type, field, value)` - 更新喂奶数据
- `updateSpecialMilkForType(context, type)` - 更新特奶量

### uiUtils.js - UI界面工具

#### 基础UI操作
- `showLoading(title)` - 显示加载中
- `hideLoading()` - 隐藏加载中
- `showSuccess(title, duration)` - 显示成功提示
- `showError(title, duration)` - 显示错误提示
- `showConfirm(options)` - 显示确认对话框

#### 模态框管理
- `modalManager.show(context, modalName)` - 显示模态框
- `modalManager.hide(context, modalName)` - 隐藏模态框
- `modalManager.toggle(context, modalName)` - 切换模态框状态

#### 页面导航
- `navigation.navigateTo(url, params)` - 导航到页面
- `navigation.redirectTo(url, params)` - 重定向到页面
- `navigation.navigateBack(delta)` - 返回上一页

#### 数据格式化
- `formatters.formatTimeDisplay(date, format)` - 格式化时间显示
- `formatters.formatDateDisplay(date, format)` - 格式化日期显示
- `formatters.formatNumber(num, decimals)` - 格式化数字显示

#### 输入验证
- `validators.isPositiveNumber(value)` - 验证正数
- `validators.isNonNegativeNumber(value)` - 验证非负数
- `validators.isValidTimeFormat(timeStr)` - 验证时间格式
- `validators.isEmpty(value)` - 验证是否为空

### dataUtils.js - 数据处理工具

#### 本地存储
- `storage.set(key, value)` - 设置本地存储
- `storage.get(key, defaultValue)` - 获取本地存储
- `storage.remove(key)` - 删除本地存储
- `storage.clear()` - 清空本地存储

#### 数组操作
- `array.sortBy(arr, field, order)` - 按字段排序
- `array.sortByTime(arr, timeField, order)` - 按时间排序
- `array.groupBy(arr, field)` - 数组分组
- `array.unique(arr, field)` - 数组去重

#### 对象操作
- `object.deepClone(obj)` - 深拷贝
- `object.merge(target, ...sources)` - 对象合并
- `object.get(obj, path, defaultValue)` - 获取嵌套属性
- `object.set(obj, path, value)` - 设置嵌套属性

#### 时间处理
- `time.getTodayStart()` - 获取今天开始时间
- `time.getTodayEnd()` - 获取今天结束时间
- `time.getMinutesDiff(startTime, endTime)` - 计算时间差
- `time.formatDuration(minutes)` - 格式化持续时间
- `time.isSameDay(date1, date2)` - 检查是否同一天

#### 数据转换
- `convert.toNumber(str, defaultValue)` - 转换为数字
- `convert.toString(num, decimals)` - 转换为字符串
- `convert.toBoolean(value)` - 转换为布尔值

#### 数据验证
- `validate.required(value, fieldName)` - 验证必填字段
- `validate.numberRange(value, min, max, fieldName)` - 验证数字范围
- `validate.arrayLength(arr, min, max, fieldName)` - 验证数组长度

## 使用示例

### 基本用法

```javascript
// 导入工具函数
const { utils, calculator, uiUtils, dataUtils } = require('../../utils/index');

// 时间格式化
const currentTime = utils.formatTime(); // "14:30"

// 显示成功提示
uiUtils.showSuccess('操作成功');

// 数组排序
const sortedData = dataUtils.array.sortByTime(records, 'startTime');

// 计算特奶量
const result = calculator.calculateSpecialMilk(60, 120, params);
```

### 页面中的实际应用

```javascript
// 处理输入
onFeedingInput(e) {
  const { field } = e.currentTarget.dataset;
  const value = e.detail.value;
  dataManager.updateFeedingData(this, 'current', field, value);
},

// 显示模态框
showEditModal() {
  uiUtils.modalManager.show(this, 'Edit');
},

// 数据验证
validateData() {
  try {
    utils.validateFeedingData(this.data.currentFeeding);
    return true;
  } catch (error) {
    utils.handleError(error);
    return false;
  }
}
```

## 注意事项

1. **工具函数保持纯函数特性**：不依赖外部状态，相同输入产生相同输出
2. **错误处理统一**：使用 `utils.handleError` 统一处理错误
3. **类型安全**：所有函数都包含参数验证和类型检查
4. **可扩展性**：新增功能时优先考虑添加到对应的工具模块中
5. **向后兼容**：修改工具函数时保持API的向后兼容性

## 贡献指南

添加新的工具函数时，请遵循以下规范：

1. 选择合适的模块文件
2. 添加详细的JSDoc注释
3. 包含必要的参数验证
4. 更新此README文档
5. 确保函数的纯函数特性 