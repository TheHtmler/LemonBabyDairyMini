/**
 * 工具函数索引文件
 * 统一导出所有工具函数，方便使用
 */

const feedingUtils = require('./feedingUtils');
const uiUtils = require('./uiUtils');
const dataUtils = require('./dataUtils');
const growthUtils = require('./growthUtils');

/**
 * 等待应用初始化完成
 * 供其他页面使用的工具函数
 * @param {Function} onProgress 进度回调函数
 * @returns {Promise} 初始化结果
 */
async function waitForAppInitialization(onProgress) {
  const app = getApp();
  
  try {
    // 如果已经初始化完成，直接返回
    if (app.globalData.isInitialized) {
      if (onProgress) onProgress(100, '初始化完成');
      return {
        openid: app.globalData.openid,
        userRole: app.globalData.userRole,
        success: true
      };
    }
    
    // 显示初始进度
    if (onProgress) onProgress(0, '正在初始化...');
    
    // 等待初始化完成
    const result = await app.waitForInitialization();
    
    // 显示完成进度
    if (onProgress) onProgress(100, '初始化完成');
    
    return result;
  } catch (error) {
    console.error('等待应用初始化失败:', error);
    throw error;
  }
}

/**
 * 检查用户权限
 * @param {string} requiredRole 需要的角色 ('creator' | 'participant' | null)
 * @returns {Promise<boolean>} 是否有权限
 */
async function checkUserPermission(requiredRole = null) {
  try {
    const app = getApp();
    
    // 等待初始化完成
    await waitForAppInitialization();
    
    // 检查是否有openid
    if (!app.globalData.openid) {
      console.error('用户未登录');
      return false;
    }
    
    // 如果指定了角色要求，检查角色
    if (requiredRole) {
      if (app.globalData.userRole !== requiredRole) {
        console.error(`用户角色不匹配，需要: ${requiredRole}，实际: ${app.globalData.userRole}`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error('检查用户权限失败:', error);
    return false;
  }
}

/**
 * 获取用户信息
 * @returns {Promise<Object>} 用户信息
 */
async function getUserInfo() {
  try {
    const app = getApp();
    await waitForAppInitialization();
    
    return {
      openid: app.globalData.openid,
      userRole: app.globalData.userRole,
      babyUid: app.globalData.babyUid,
      creatorPhone: app.globalData.creatorPhone,
      isOwner: app.globalData.isOwner,
      permission: app.globalData.permission
    };
  } catch (error) {
    console.error('获取用户信息失败:', error);
    throw error;
  }
}

/**
 * 获取宝宝信息
 * 优先从本地缓存获取，如果缓存不存在则从数据库获取
 * @returns {Promise<Object|null>} 宝宝信息
 */
async function getBabyInfo() {
  try {
    const app = getApp();
    await waitForAppInitialization();
    
    return await app.getBabyInfo();
  } catch (error) {
    console.error('获取宝宝信息失败:', error);
    return null;
  }
}

/**
 * 获取宝宝UID的统一方法
 * @returns {string|null} 宝宝UID
 */
function getBabyUid() {
  const app = getApp();
  const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
  if (!babyUid) {
    console.warn('未找到宝宝UID');
  }
  return babyUid;
}

/**
 * 显示初始化错误提示
 * @param {Error} error 错误对象
 */
function showInitError(error) {
  wx.showModal({
    title: '初始化失败',
    content: error.message || '应用初始化失败，请重试',
    showCancel: true,
    cancelText: '取消',
    confirmText: '重试',
    success: (res) => {
      if (res.confirm) {
        // 重新初始化
        const app = getApp();
        app.reinitializeApp().catch(err => {
          showInitError(err);
        });
      }
    }
  });
}

/**
 * 统一的错误处理方法
 * @param {Error} error 错误对象  
 * @param {Object} options 配置选项
 * @returns {Object} 处理结果
 */
function handleError(error, options = {}) {
  const defaultOptions = {
    title: '操作失败',
    showToast: true,
    hideLoading: true,
    logError: true,
    duration: 2000
  };
  
  const finalOptions = { ...defaultOptions, ...options };
  
  // 隐藏加载状态
  if (finalOptions.hideLoading) {
    wx.hideLoading();
  }
  
  // 记录错误日志
  if (finalOptions.logError) {
    console.error('错误处理:', {
      title: finalOptions.title,
      error: error,
      timestamp: new Date().toISOString()
    });
  }
  
  // 显示错误提示
  if (finalOptions.showToast) {
    wx.showToast({
      title: finalOptions.title,
      icon: 'none',
      duration: finalOptions.duration
    });
  }
  
  // 返回错误信息，便于后续处理
  return {
    handled: true,
    error: error,
    title: finalOptions.title
  };
}

module.exports = {
  // 喂养相关工具
  ...feedingUtils,
  
  // UI工具
  uiUtils,
  
  // 数据工具
  dataUtils,

  // 生长曲线工具
  growthUtils,
  
  // 为了保持兼容性，也可以单独导出
  feedingUtils,
  
  // 初始化相关工具函数
  waitForAppInitialization,
  checkUserPermission,
  getUserInfo,
  getBabyInfo,
  showInitError,
  
  // 从feedingUtils中导出的工具函数
  utils: feedingUtils.utils,
  calculator: feedingUtils.calculator,
  dataManager: feedingUtils.dataManager,
  modalManager: feedingUtils.modalManager,
  
  // 从uiUtils中导出的工具函数
  formatters: uiUtils.formatters,
  
  // 从dataUtils中导出的工具函数
  array: dataUtils.array,
  storage: dataUtils.storage,
  validation: dataUtils.validation,

  // 从growthUtils中导出的工具函数
  growth: growthUtils,
  
  // 新增的通用工具函数
  handleError,
  getBabyUid
}; 
