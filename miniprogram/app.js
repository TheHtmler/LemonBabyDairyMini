// app.js
App({
  globalData: {
    userInfo: null,
    openid: null,
    permission: false,
    isOwner: false,
    isLoggedIn: true,
    babyInfo: null,
    babyUid: null,
    userRole: '',
    creatorPhone: '',
    cloudEnvId: 'prod-7g5lap9xcf106dbf'
  },

  onLaunch: function() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    
    // 初始化云环境
    const cloudEnvId = 'prod-7g5lap9xcf106dbf';
    this.globalData.cloudEnvId = cloudEnvId;
    
    wx.cloud.init({
      env: cloudEnvId,
      traceUser: true,
    });
    
    // 初始化时尝试获取openid
    this.getOpenid().then(() => {
      console.log('已获取openid');
    }).catch(error => {
      console.error('获取openid失败:', error);
    });
  },
  
  // 获取openid
  async getOpenid() {
    try {
      // 先从缓存中获取
      let openid = this.globalData.openid || wx.getStorageSync('openid');
      if (openid) {
        this.globalData.openid = openid;
        return openid;
      }
      
      // 如果缓存中没有，则通过云函数获取
      const result = await wx.cloud.callFunction({
        name: 'login'
      });
      
      if (result && result.result && result.result.openid) {
        console.log('===getOpenid===', result);
        openid = result.result.openid;
        this.globalData.openid = openid;
        wx.setStorageSync('openid', openid);
        return openid;
      } else {
        throw new Error('获取openid失败');
      }
    } catch (error) {
      console.error('获取openid出错:', error);
      throw error;
    }
  },
  
  // 注销账户
  async logout() {
    try {
      // 清除全局数据（保留openid和云环境ID）
      const openid = this.globalData.openid;
      const cloudEnvId = this.globalData.cloudEnvId;
      
      // 重置全局数据
      this.globalData = {
        userInfo: null,
        openid: openid,
        permission: false,
        isOwner: false,
        isLoggedIn: false,
        babyInfo: null,
        babyUid: null,
        userRole: '',
        creatorPhone: '',
        cloudEnvId: cloudEnvId
      };
      
      // 重置用户的角色选择状态
      wx.removeStorageSync('has_selected_role');
      wx.removeStorageSync('user_role');
      wx.removeStorageSync('baby_uid');
      wx.removeStorageSync('creator_phone');
      wx.removeStorageSync('bound_creator_phone');
      wx.removeStorageSync('baby_info_completed');
      
      // 跳转到角色选择页面
      wx.reLaunch({
        url: '/pages/role-selection/index'
      });
      
      return true;
    } catch (error) {
      console.error('注销失败:', error);
      return false;
    }
  },
  
  // 检查用户权限
  async checkPermission() {
    console.log('===app.checkPermission开始===');
    try {
      // 获取openid
      const openid = this.globalData.openid || wx.getStorageSync('openid');
      if (!openid) {
        console.log('未找到openid，无法检查权限');
        this.globalData.permission = false;
        this.globalData.isOwner = false;
        return false;
      }
      
      // 获取宝宝ID
      const babyUid = this.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.log('未找到宝宝ID，默认为创建者权限');
        this.globalData.isOwner = true;
        this.globalData.permission = true;
        return true;
      }
      
      // 查询数据库判断用户角色
      const db = wx.cloud.database({
        env: this.globalData.cloudEnvId
      });
      
      // 检查是否为创建者
      const creatorRes = await db.collection('baby_creators').where({
        _openid: openid,
        babyUid: babyUid
      }).get();
      
      if (creatorRes.data && creatorRes.data.length > 0) {
        console.log('用户是创建者');
        this.globalData.isOwner = true;
        this.globalData.permission = true;
        return true;
      }
      
      // 检查是否为参与者
      const participantRes = await db.collection('baby_participants').where({
        _openid: openid,
        babyUid: babyUid
      }).get();
      
      if (participantRes.data && participantRes.data.length > 0) {
        console.log('用户是参与者');
        this.globalData.isOwner = false;
        this.globalData.permission = true;
        return true;
      }
      
      // 默认没有权限
      console.log('用户无权限访问当前宝宝');
      this.globalData.isOwner = false;
      this.globalData.permission = false;
      return false;
    } catch (error) {
      console.error('检查权限失败:', error);
      this.globalData.isOwner = false;
      this.globalData.permission = false;
      return false;
    }
  },
  
  // 初始化数据库集合
  async initCollections() {
    try {
      // 调用云函数初始化集合
      const result = await wx.cloud.callFunction({
        name: 'initAllCollections'
      });
      
      return result.result || { success: false, message: '初始化集合失败' };
    } catch (error) {
      console.error('初始化集合失败:', error);
      return { success: false, message: error.message || '初始化集合失败' };
    }
  },
  
  // 更新用户资料
  async updateUserProfile(userInfo) {
    try {
      if (!userInfo) return false;
      
      this.globalData.userInfo = userInfo;
      
      // 保存到本地
      wx.setStorageSync('userInfo', userInfo);
      
      return true;
    } catch (error) {
      console.error('更新用户资料失败:', error);
      return false;
    }
  },
});
