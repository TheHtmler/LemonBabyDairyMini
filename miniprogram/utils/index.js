/**
 * 工具函数索引文件
 * 统一导出所有工具函数，方便使用
 */

const feedingUtils = require('./feedingUtils');
const uiUtils = require('./uiUtils');
const dataUtils = require('./dataUtils');

module.exports = {
  // 喂养相关工具
  ...feedingUtils,
  
  // UI工具
  uiUtils,
  
  // 数据工具
  dataUtils,
  
  // 为了保持兼容性，也可以单独导出
  feedingUtils,
}; 