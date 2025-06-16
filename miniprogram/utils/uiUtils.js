/**
 * 通用UI工具函数
 * 用于处理用户界面相关的通用功能
 */

const uiUtils = {
  // 显示加载中
  showLoading(title = '加载中...') {
    wx.showLoading({
      title,
      mask: true
    });
  },

  // 隐藏加载中
  hideLoading() {
    wx.hideLoading();
  },

  // 显示成功提示
  showSuccess(title = '操作成功', duration = 2000) {
    wx.showToast({
      title,
      icon: 'success',
      duration
    });
  },

  // 显示错误提示
  showError(title = '操作失败', duration = 2000) {
    wx.showToast({
      title,
      icon: 'none',
      duration
    });
  },

  // 显示确认对话框
  showConfirm(options = {}) {
    const defaultOptions = {
      title: '提示',
      content: '确认执行此操作？',
      confirmText: '确定',
      cancelText: '取消',
      showCancel: true
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    return new Promise((resolve) => {
      wx.showModal({
        ...finalOptions,
        success: (res) => {
          resolve(res.confirm);
        },
        fail: () => {
          resolve(false);
        }
      });
    });
  },

  // 模态框管理器
  modalManager: {
    show(context, modalName) {
      const updateData = {};
      updateData[`show${modalName}Modal`] = true;
      context.setData(updateData);
    },

    hide(context, modalName) {
      const updateData = {};
      updateData[`show${modalName}Modal`] = false;
      context.setData(updateData);
    },

    toggle(context, modalName) {
      const currentState = context.data[`show${modalName}Modal`];
      const updateData = {};
      updateData[`show${modalName}Modal`] = !currentState;
      context.setData(updateData);
    }
  },

  // 页面导航
  navigation: {
    // 导航到指定页面
    navigateTo(url, params = {}) {
      let fullUrl = url;
      
      // 如果有参数，拼接参数
      if (Object.keys(params).length > 0) {
        const queryString = Object.keys(params)
          .map(key => `${key}=${encodeURIComponent(params[key])}`)
          .join('&');
        fullUrl = `${url}?${queryString}`;
      }
      
      wx.navigateTo({
        url: fullUrl,
        fail: (error) => {
          console.error('页面导航失败:', error);
          uiUtils.showError('页面跳转失败');
        }
      });
    },

    // 重定向到指定页面
    redirectTo(url, params = {}) {
      let fullUrl = url;
      
      if (Object.keys(params).length > 0) {
        const queryString = Object.keys(params)
          .map(key => `${key}=${encodeURIComponent(params[key])}`)
          .join('&');
        fullUrl = `${url}?${queryString}`;
      }
      
      wx.redirectTo({
        url: fullUrl,
        fail: (error) => {
          console.error('页面重定向失败:', error);
          uiUtils.showError('页面跳转失败');
        }
      });
    },

    // 返回上一页
    navigateBack(delta = 1) {
      wx.navigateBack({
        delta,
        fail: (error) => {
          console.error('页面返回失败:', error);
        }
      });
    }
  },

  // 数据格式化
  formatters: {
    // 格式化时间显示
    formatTimeDisplay(date, format = 'HH:MM') {
      if (!date) return '';
      
      const d = date instanceof Date ? date : new Date(date);
      const hours = d.getHours().toString().padStart(2, '0');
      const minutes = d.getMinutes().toString().padStart(2, '0');
      const seconds = d.getSeconds().toString().padStart(2, '0');
      
      switch (format) {
        case 'HH:MM:SS':
          return `${hours}:${minutes}:${seconds}`;
        case 'HH:MM':
        default:
          return `${hours}:${minutes}`;
      }
    },

    // 格式化日期显示
    formatDateDisplay(date, format = 'YYYY-MM-DD') {
      if (!date) return '';
      
      const d = date instanceof Date ? date : new Date(date);
      const year = d.getFullYear();
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      
      switch (format) {
        case 'YYYY年MM月DD日':
          return `${year}年${month}月${day}日`;
        case 'MM-DD':
          return `${month}-${day}`;
        case 'YYYY-MM-DD':
        default:
          return `${year}-${month}-${day}`;
      }
    },

    // 格式化数字显示
    formatNumber(num, decimals = 0) {
      if (num === null || num === undefined || isNaN(num)) return '0';
      return Number(num).toFixed(decimals);
    }
  },

  // 输入验证
  validators: {
    // 验证是否为正数
    isPositiveNumber(value) {
      const num = parseFloat(value);
      return !isNaN(num) && num > 0;
    },

    // 验证是否为非负数
    isNonNegativeNumber(value) {
      const num = parseFloat(value);
      return !isNaN(num) && num >= 0;
    },

    // 验证时间格式 HH:MM
    isValidTimeFormat(timeStr) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      return timeRegex.test(timeStr);
    },

    // 验证是否为空字符串
    isEmpty(value) {
      return !value || value.toString().trim() === '';
    }
  }
};

module.exports = uiUtils; 