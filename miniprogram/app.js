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

  // 添加openid就绪的Promise
  openidReady: null,

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
    
    // 创建openid就绪的Promise
    this.openidReady = this.getOpenid().then((openid) => {
      console.log('app.js: openid获取完成');
      return openid;
    }).catch(error => {
      console.error('app.js: 获取openid失败:', error);
      throw error;
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
        name: 'getOpenid'
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
  
  // 获取用户角色
  async getUserRole() {
    try {
      // 首先从本地缓存读取
      const userRole = wx.getStorageSync('user_role');
      const hasSelectedRole = wx.getStorageSync('has_selected_role');
      
      console.log('app - 本地缓存的角色:', userRole, '是否已选择角色:', hasSelectedRole);
      
      if (userRole && hasSelectedRole) {
        // 更新全局状态
        this.globalData.userRole = userRole;
        console.log('===app.getUserRole结束：从本地缓存获取===');
        return userRole;
      }
      
      // 本地缓存没有角色信息，从数据库查询
      console.log('本地缓存无角色信息，开始从数据库查询用户角色');
      
      // 确保有openid
      const openid = this.globalData.openid || wx.getStorageSync('openid');
      if (!openid) {
        console.log('没有openid，无法查询数据库');
        return null;
      }
      
      const db = wx.cloud.database();
      
      // 首先检查是否是创建者
      console.log('检查用户是否为创建者...');
      const creatorResult = await db.collection('baby_creators').where({
        _openid: openid
      }).get();
      
      if (creatorResult.data && creatorResult.data.length > 0) {
        console.log('从数据库识别用户为创建者');
        const detectedRole = 'creator';
        
        // 检查是否完成宝宝信息
        const babyInfoCompleted = wx.getStorageSync('baby_info_completed');
        
        // 只有在完成宝宝信息时才设置has_selected_role
        if (babyInfoCompleted) {
          // 保存到本地缓存和全局状态
          this.globalData.userRole = detectedRole;
          wx.setStorageSync('user_role', detectedRole);
          wx.setStorageSync('has_selected_role', true);
          
          // 同时保存创建者相关信息
          const creatorInfo = creatorResult.data[0];
          if (creatorInfo.phone) {
            wx.setStorageSync('creator_phone', creatorInfo.phone);
            this.globalData.creatorPhone = creatorInfo.phone;
          }
          if (creatorInfo.babyUid) {
            wx.setStorageSync('baby_uid', creatorInfo.babyUid);
            this.globalData.babyUid = creatorInfo.babyUid;
          }
          
          console.log('===app.getUserRole结束：从数据库获取创建者（已完成宝宝信息）===');
          return detectedRole;
        } else {
          console.log('===app.getUserRole结束：从数据库获取创建者（未完成宝宝信息）===');
          return null;
        }
      }
      
      // 然后检查是否是参与者
      console.log('检查用户是否为参与者...');
      const participantResult = await db.collection('baby_participants').where({
        _openid: openid
      }).get();
      
      if (participantResult.data && participantResult.data.length > 0) {
        console.log('从数据库识别用户为参与者');
        const detectedRole = 'participant';
        
        // 检查是否完成宝宝信息
        const babyInfoCompleted = wx.getStorageSync('baby_info_completed');
        
        // 只有在完成宝宝信息时才设置has_selected_role
        if (babyInfoCompleted) {
          // 保存到本地缓存和全局状态
          this.globalData.userRole = detectedRole;
          wx.setStorageSync('user_role', detectedRole);
          wx.setStorageSync('has_selected_role', true);
          
          // 同时保存参与者相关信息
          const participantInfo = participantResult.data[0];
          if (participantInfo.creatorPhone) {
            wx.setStorageSync('bound_creator_phone', participantInfo.creatorPhone);
            this.globalData.creatorPhone = participantInfo.creatorPhone;
          }
          if (participantInfo.babyUid) {
            wx.setStorageSync('baby_uid', participantInfo.babyUid);
            this.globalData.babyUid = participantInfo.babyUid;
          }
          
          console.log('===app.getUserRole结束：从数据库获取参与者（已完成宝宝信息）===');
          return detectedRole;
        } else {
          console.log('===app.getUserRole结束：从数据库获取参与者（未完成宝宝信息）===');
          return null;
        }
      }
      
      // 数据库中也没有找到用户角色信息
      console.log('===app.getUserRole结束：数据库中未找到用户角色信息===');
      return null;
      
    } catch (error) {
      console.error('app.getUserRole失败:', error);
      return null;
    }
  },
});
