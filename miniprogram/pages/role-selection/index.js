Page({
  /**
   * 页面的初始数据
   */
  data: {
    selectedRole: '',  // 存储选中的角色
    isPageLoaded: false, // 标记页面是否已加载完成
    isInitializing: true, // 初始化状态标记
    loadingText: '正在初始化...',
    initFailed: false, // 初始化失败标记
    initProgress: 0 // 初始化进度
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {
    // 如果不是初始加载（如返回到本页），需要重新检查状态
    if (this.data.isPageLoaded && !this.data.isInitializing) {
      console.log('页面已加载且非初始化状态，重新检查');
      this.checkAndInitialize();
    }
  },

  onReady: function() {
    // 获取app实例并保存为实例变量
    this.app = getApp();
    this.setData({
      isPageLoaded: true
    });
    // 首次加载时执行完整初始化
    this.initializeApp();
  },
  
  /**
   * 检查并初始化（用于onShow中的重新检查）
   */
  async checkAndInitialize() {
    try {
      // 快速检查app是否已初始化
      if (this.app.globalData.isInitialized) {
        // 如果app已初始化，直接处理导航
        const initResult = {
          openid: this.app.globalData.openid,
          userRole: this.app.globalData.userRole,
          babyInfoValid: await this.app.validateBabyInfo()
        };
        this.handleNavigation(initResult);
      } else {
        // 如果app未初始化，执行完整初始化
        this.initializeApp();
      }
    } catch (error) {
      console.error('检查初始化状态失败:', error);
      // 如果检查失败，执行完整初始化
      this.initializeApp();
    }
  },
  
  /**
   * 初始化应用流程
   * 使用app.js的统一初始化流程
   */
  async initializeApp() {
    const startTime = Date.now();
    const minLoadingTime = 1000; // 最小loading时间1000ms
    
    this.setData({ 
      isInitializing: true,
      loadingText: '正在初始化...',
      initProgress: 0,
      initFailed: false
    });
    
    try {
      // 更新进度
      this.setData({ 
        loadingText: '正在获取用户信息...',
        initProgress: 20
      });
      
      // 等待app.js完成初始化
      const initResult = await this.app.waitForInitialization();
      
      // 更新进度
      this.setData({ 
        loadingText: '正在验证用户状态...',
        initProgress: 60
      });
      
      // 确保最小loading时间
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < minLoadingTime) {
        await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsedTime));
      }
      
      // 更新进度
      this.setData({ 
        loadingText: '初始化完成',
        initProgress: 100
      });
      
      // 设置初始化完成
      this.setData({ 
        isInitializing: false,
        loadingText: ''
      });
      
      // 根据初始化结果决定导航
      this.handleNavigation(initResult);
      
    } catch (error) {
      console.error('初始化应用失败:', error);
      
      // 确保最小loading时间
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < minLoadingTime) {
        await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsedTime));
      }
      
      this.setData({ 
        isInitializing: false,
        loadingText: '初始化失败',
        initFailed: true,
        initProgress: 0
      });
      
      // 显示错误提示
      wx.showToast({
        title: error.message || '初始化失败，请重试',
        icon: 'none',
        duration: 3000
      });
    }
  },
  
  /**
   * 重试初始化
   */
  retryInitialization() {
    this.setData({
      initFailed: false,
      loadingText: '正在重新初始化...',
      initProgress: 0
    });
    this.initializeApp();
  },
  
  /**
   * 处理导航逻辑
   * 基于app.js初始化结果决定页面跳转
   */
  handleNavigation(initResult) {
    console.log('处理导航，初始化结果:', initResult);
    
    const { userRole, babyInfoValid } = initResult;
    
    // 如果已经选择角色且完成宝宝信息，直接进入主页面
    if (userRole && babyInfoValid) {
      console.log('用户已完成设置，跳转到主页面');
      wx.switchTab({
        url: '/pages/daily-feeding/index',
      });
      return;
    }
    
    // 如果已选择角色但未完成宝宝信息，清除角色选择状态，让用户重新选择
    if (userRole && !babyInfoValid) {
      console.log('用户已选择角色但未完成宝宝信息，清除状态重新选择');
      // 清除角色选择状态
      this.app.globalData.userRole = '';
      wx.removeStorageSync('user_role');
      wx.removeStorageSync('has_selected_role');
      
      // 清除相关的宝宝信息
      wx.removeStorageSync('baby_uid');
      wx.removeStorageSync('creator_phone');
      wx.removeStorageSync('bound_creator_phone');
      wx.removeStorageSync('baby_info_completed');
      
      // 重置全局数据
      this.app.globalData.babyUid = null;
      this.app.globalData.creatorPhone = '';
      
      // 重新初始化app
      this.app.reinitializeApp();
      return;
    }
    
    // 如果未选择角色，留在当前页面等待用户选择
    console.log('未选择角色，保持在角色选择页面');
  },
  
  /**
   * 选择角色
   */
  selectRole: function (e) {
    // 获取选中的角色
    const role = e.currentTarget.dataset.role;
    
    // 存储选中的角色
    this.setData({
      selectedRole: role
    });
    
    // 将角色信息存储到全局数据和本地存储
    this.app.globalData.userRole = role;
    wx.setStorageSync('user_role', role);
    wx.setStorageSync('has_selected_role', true);
    
    // 显示加载中提示
    wx.showLoading({
      title: '加载中...',
      mask: true
    });
    
    // 根据角色跳转到不同页面
    setTimeout(() => {
      wx.hideLoading();
      if (role === 'creator') {
        // 创建者跳转到宝宝信息页面
        wx.redirectTo({
          url: '/pages/baby-info/index?firstLogin=true&role=creator',
        });
      } else {
        // 参与者跳转到绑定手机号页面
        wx.redirectTo({
          url: '/pages/bind-phone/index?firstLogin=true&role=participant',
        });
      }
    }, 500);
  }
}) 