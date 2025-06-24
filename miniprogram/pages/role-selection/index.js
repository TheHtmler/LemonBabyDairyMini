Page({
  /**
   * 页面的初始数据
   */
  data: {
    selectedRole: '',  // 存储选中的角色
    isPageLoaded: false, // 标记页面是否已加载完成
    isInitializing: true, // 初始化状态标记
    loadingText: '正在初始化...',
    initFailed: false // 初始化失败标记
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {
    // 如果不是初始加载（如返回到本页），需要重新检查状态
    if (this.data.isPageLoaded && !this.data.isInitializing) {
      console.log('页面已加载且非初始化状态，重新检查');
      this.initializeApp();
    }
  },

  onReady: function() {
    // 获取app实例并保存为实例变量
    this.app = getApp();
    this.setData({
      isPageLoaded: true
    });
    this.initializeApp();
  },
  
  /**
   * 初始化应用流程
   * 1. 等待openid（app.js已获取）
   * 2. 检查用户角色
   * 3. 检查是否已完成宝宝信息填写
   * 4. 根据状态决定导航
   */
  async initializeApp() {
    const startTime = Date.now();
    const minLoadingTime = 800; // 最小loading时间800ms
    
    this.setData({ 
      isInitializing: true,
      loadingText: '正在初始化...'
    });
    
    try {
      // 1. 等待openid（app.js的onLaunch中已获取）
      this.setData({ loadingText: '正在获取用户信息...' });
      await this.waitForOpenid();
      
      // 2. 检查用户角色
      this.setData({ loadingText: '正在检查用户角色...' });
      const userRole = await this.app.getUserRole();
      
      // 3. 检查宝宝信息完成状态
      this.setData({ loadingText: '正在检查宝宝信息...' });
      const babyInfoCompleted = await this.checkBabyInfo();
      
      // 确保最小loading时间
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < minLoadingTime) {
        await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsedTime));
      }
      
      // 设置初始化完成
      this.setData({ 
        isInitializing: false,
        loadingText: ''
      });
      
      // 4. 根据状态决定导航
      this.handleNavigation(userRole, babyInfoCompleted);
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
        initFailed: true
      });
      
      // 显示错误提示
      wx.showToast({
        title: '初始化失败，请重试',
        icon: 'none',
        duration: 2000
      });
    }
  },
  
  /**
   * 重试初始化
   */
  retryInitialization() {
    this.setData({
      initFailed: false,
      loadingText: '正在重新初始化...'
    });
    this.initializeApp();
  },
  
  /**
   * 等待openid可用
   */
  async waitForOpenid() {
    try {
      // 首先检查是否已经有openid
      let openid = this.app.globalData.openid || wx.getStorageSync('openid');
      if (openid) {
        console.log('已有openid:', openid);
        return openid;
      }
      
      // 如果没有openid，等待app.js的openidReady Promise
      console.log('等待app.js获取openid...');
      openid = await this.app.openidReady;
      console.log('app.js openid获取完成:', openid);
      return openid;
    } catch (error) {
      console.error('等待openid失败:', error);
      throw new Error('获取openid失败');
    }
  },
  
  /**
   * 检查宝宝信息状态
   */
  async checkBabyInfo() {
    try {
      console.log('===角色选择页-检查宝宝信息开始===');
      
      // 检查本地存储状态
      const babyInfoCompleted = wx.getStorageSync('baby_info_completed');
      const babyUid = wx.getStorageSync('baby_uid');
      const creatorPhone = wx.getStorageSync('creator_phone');
      const boundCreatorPhone = wx.getStorageSync('bound_creator_phone');
      
      console.log('宝宝信息状态:', {
        babyInfoCompleted,
        hasBabyUid: !!babyUid,
        hasCreatorPhone: !!creatorPhone,
        hasBoundCreatorPhone: !!boundCreatorPhone
      });
      
      // 只有当明确标记为完成时才认为宝宝信息已完成
      if (babyInfoCompleted) {
        // 确保全局变量也更新
        if (babyUid) this.app.globalData.babyUid = babyUid;
        if (creatorPhone) this.app.globalData.creatorPhone = creatorPhone;
        
        console.log('===角色选择页-检查宝宝信息结束：已完成===');
        return true;
      }
      
      console.log('===角色选择页-检查宝宝信息结束：未完成===');
      return false;
    } catch (error) {
      console.error('检查宝宝信息状态失败:', error);
      return false;
    }
  },
  
  /**
   * 处理导航逻辑
   */
  handleNavigation(userRole, babyInfoCompleted) {
    console.log('===角色选择页-处理导航逻辑===', {userRole, babyInfoCompleted});
    
    // 如果已经选择角色且完成宝宝信息，直接进入主页面
    if (userRole && babyInfoCompleted) {
      console.log('已有角色和宝宝信息，导航到主页面');
      wx.switchTab({
        url: '/pages/daily-feeding/index',
        success: () => {
          console.log('成功跳转到主页面');
        },
        fail: (err) => {
          console.error('跳转到主页面失败:', err);
        }
      });
      return;
    }
    
    // 如果已选择角色但未完成宝宝信息，清除角色选择状态，让用户重新选择
    if (userRole && !babyInfoCompleted) {
      console.log('已选择角色但未完成宝宝信息，清除角色状态让用户重新选择');
      
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
      
      // 保持在当前页面，让用户重新选择角色
      console.log('清除角色状态，保持在角色选择页面');
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
    
    console.log('用户选择角色:', role);
    
    // 存储选中的角色
    this.setData({
      selectedRole: role
    });
    
    // 将角色信息存储到全局数据和本地存储
    // 使用实例变量替代重复调用getApp()
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
          complete: () => {
            console.log('已跳转到宝宝信息页面');
          }
        });
      } else {
        // 参与者跳转到绑定手机号页面
        wx.redirectTo({
          url: '/pages/bind-phone/index?firstLogin=true&role=participant',
          complete: () => {
            console.log('已跳转到手机号绑定页面');
          }
        });
      }
    }, 500);
  }
}) 