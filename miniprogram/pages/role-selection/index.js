Page({
  /**
   * 页面的初始数据
   */
  data: {
    selectedRole: '',  // 存储选中的角色
    isPageLoaded: false, // 标记页面是否已加载完成
    isInitializing: true // 初始化状态标记
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow: function () {
    console.log('===角色选择页面显示===');
    // 如果不是初始加载（如返回到本页），需要重新检查状态
    if (this.data.isPageLoaded && !this.data.isInitializing) {
      console.log('页面已加载且非初始化状态，重新检查');
      this.initializeApp();
    }
  },

  onReady: function() {
    console.log('===角色选择页面渲染完成===');
    // 获取app实例并保存为实例变量
    this.app = getApp();
    this.setData({
      isPageLoaded: true
    });
    this.initializeApp();
  },
  
  /**
   * 初始化应用流程
   * 1. 获取openid
   * 2. 检查用户角色
   * 3. 检查是否已完成宝宝信息填写
   * 4. 根据状态决定导航
   */
  async initializeApp() {
    console.log('===开始初始化应用流程===');
    this.setData({ isInitializing: true });
    
    try {
      // 1. 获取openid
      await this.getOpenid();
      
      // 2. 检查用户角色选择状态
      const userRole = await this.getUserRole();
      
      // 3. 检查宝宝信息完成状态
      const babyInfoCompleted = await this.checkBabyInfo();
      
      // 设置初始化完成
      this.setData({ isInitializing: false });
      
      // 4. 根据状态决定导航
      this.handleNavigation(userRole, babyInfoCompleted);
    } catch (error) {
      console.error('初始化应用失败:', error);
      this.setData({ isInitializing: false });
    }
  },
  
  /**
   * 获取openid
   */
  async getOpenid() {
    try {
      console.log('===角色选择页-获取openid开始===');
      // 使用实例变量替代重复调用getApp()
      
      // 检查是否已有openid
      const cachedOpenid = wx.getStorageSync('openid');
      if (cachedOpenid) {
        console.log("本地缓存中找到openid，无需调用云函数");
        this.app.globalData.openid = cachedOpenid;
        return cachedOpenid;
      }
      
      // 使用云函数获取openid
      console.log("===开始调用GetOpenid云函数获取openid===");
      try {
        const { result } = await wx.cloud.callFunction({
          name: 'getOpenid',
          config: {
            env: this.app.globalData.cloudEnvId
          }
        });
        
        if (result && result.openid) {
          console.log("获取Openid成功", result);
          const openid = result.openid;
          this.app.globalData.openid = openid;
          wx.setStorageSync('openid', openid);
          console.log("===getOpenid函数正常结束===");
          return openid;
        } else {
          console.error('获取openid失败：返回结果异常');
          return null;
        }
      } catch (err) {
        console.error('调用云函数获取openid失败：', err);
        return null;
      }
      
    } catch (error) {
      console.error('角色选择页面：获取openid失败', error);
      throw error;
    }
  },
  
  /**
   * 获取用户角色
   */
  async getUserRole() {
    try {
      console.log('===角色选择页-获取用户角色开始===');
      // 使用实例变量替代重复调用getApp()
      const userRole = wx.getStorageSync('user_role');
      const hasSelectedRole = wx.getStorageSync('has_selected_role');
      
      console.log('角色选择页 - 已保存的角色:', userRole, '是否已选择角色:', hasSelectedRole);
      
      if (userRole && hasSelectedRole) {
        // 更新全局状态
        this.app.globalData.userRole = userRole;
        console.log('===角色选择页-获取用户角色结束：', userRole);
        return userRole;
      }
      
      console.log('===角色选择页-获取用户角色结束：未选择角色');
      return null;
    } catch (error) {
      console.error('获取用户角色失败:', error);
      return null;
    }
  },
  
  /**
   * 检查宝宝信息状态
   */
  async checkBabyInfo() {
    try {
      console.log('===角色选择页-检查宝宝信息开始===');
      // 使用实例变量替代重复调用getApp()
      
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
      
      // 检查是否有任何宝宝标识符
      const hasBabyIdentifier = !!(babyUid || creatorPhone || boundCreatorPhone);
      
      // 如果本地已标记完成或有标识符
      if (babyInfoCompleted || hasBabyIdentifier) {
        // 确保全局变量也更新
        if (babyUid) this.app.globalData.babyUid = babyUid;
        if (creatorPhone) this.app.globalData.creatorPhone = creatorPhone;
        
        // 如果有标识符但未标记完成，设置标记
        if (hasBabyIdentifier && !babyInfoCompleted) {
          wx.setStorageSync('baby_info_completed', true);
          console.log('检测到宝宝标识符，已设置完成标记');
        }
        
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
    
    // 如果已选择角色但未完成宝宝信息
    if (userRole && !babyInfoCompleted) {
      console.log('已选择角色但未完成宝宝信息，导航到相应页面');
      if (userRole === 'creator') {
        wx.redirectTo({
          url: '/pages/baby-info/index?firstLogin=true&role=creator',
          success: () => {
            console.log('成功跳转到宝宝信息页面');
          }
        });
      } else if (userRole === 'participant') {
        wx.redirectTo({
          url: '/pages/bind-phone/index?firstLogin=true&role=participant',
          success: () => {
            console.log('成功跳转到手机号绑定页面');
          }
        });
      }
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