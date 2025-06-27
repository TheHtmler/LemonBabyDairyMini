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
    cloudEnvId: 'prod-7g5lap9xcf106dbf',
    isInitialized: false,
    initError: null
  },

  // 添加openid就绪的Promise
  openidReady: null,
  // 新增：完整的初始化Promise
  initReady: null,

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
    
    // 创建完整的初始化Promise
    this.initReady = this.initializeApp();
  },
  
  /**
   * 完整的应用初始化流程
   * 1. 获取openid
   * 2. 获取用户角色
   * 3. 验证宝宝信息
   */
  async initializeApp() {
    try {
      console.log('=== 开始应用初始化 ===');
      
      // 1. 获取openid
      console.log('步骤1: 获取openid...');
      const openid = await this.getOpenid();
      console.log('openid获取成功:', openid);
      
      // 2. 获取用户角色
      console.log('步骤2: 获取用户角色...');
      const userRole = await this.getUserRole();
      console.log('用户角色获取完成:', userRole);
      
      // 3. 验证宝宝信息（如果用户角色存在）
      let babyInfoValid = false;
      if (userRole) {
        console.log('步骤3: 验证宝宝信息...');
        babyInfoValid = await this.validateBabyInfo();
        console.log('宝宝信息验证完成:', babyInfoValid);
      } else {
        console.log('步骤3: 跳过宝宝信息验证（无用户角色）');
      }
      
      // 标记初始化完成
      this.globalData.isInitialized = true;
      this.globalData.initError = null;
      
      console.log('=== 应用初始化完成 ===');
      return {
        openid,
        userRole,
        babyInfoValid,
        success: true
      };
      
    } catch (error) {
      console.error('应用初始化失败:', error);
      this.globalData.initError = error.message || '初始化失败';
      this.globalData.isInitialized = false;
      
      throw error;
    }
  },
  
  // 获取openid
  async getOpenid() {
    try {
      console.log('调用云函数获取openid...');
      const result = await wx.cloud.callFunction({
        name: 'getOpenid'
      });
      
      if (result && result.result && result.result.openid) {
        console.log('===getOpenid成功===', result.result);
        const openid = result.result.openid;
        this.globalData.openid = openid;
        wx.setStorageSync('openid', openid);
        return openid;
      } else {
        throw new Error('云函数返回的openid为空');
      }
    } catch (error) {
      console.error('获取openid失败:', error);
      throw new Error(`获取openid失败: ${error.message}`);
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
        cloudEnvId: cloudEnvId,
        isInitialized: false,
        initError: null
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
      const openid = this.globalData.openid;
      if (!openid) {
        console.error('getUserRole: openid为空，无法获取用户角色');
        return null;
      }
      
      console.log('开始查询用户角色，openid:', openid);
      const db = wx.cloud.database();
      
      // 首先检查是否是创建者
      console.log('检查用户是否为创建者...');
      const creatorResult = await db.collection('baby_creators').where({
        _openid: openid
      }).get();
      
      if (creatorResult.data && creatorResult.data.length > 0) {
        console.log('从数据库识别用户为创建者');
        const detectedRole = 'creator';
        
        // 从数据库获取创建者相关信息
        const creatorInfo = creatorResult.data[0];
        
        // 检查是否完成宝宝信息（从数据库验证）
        const babyInfoValid = await this.validateBabyInfoFromDB(openid, creatorInfo.babyUid);
        
        if (babyInfoValid) {
          // 保存到本地缓存和全局状态
          this.globalData.userRole = detectedRole;
          wx.setStorageSync('user_role', detectedRole);
          wx.setStorageSync('has_selected_role', true);
          
          // 同时保存创建者相关信息
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
        
        // 从数据库获取参与者相关信息
        const participantInfo = participantResult.data[0];
        
        // 检查是否完成宝宝信息（从数据库验证）
        const babyInfoValid = await this.validateBabyInfoFromDB(openid, participantInfo.babyUid);
        
        if (babyInfoValid) {
          // 保存到本地缓存和全局状态
          this.globalData.userRole = detectedRole;
          wx.setStorageSync('user_role', detectedRole);
          wx.setStorageSync('has_selected_role', true);
          
          // 同时保存参与者相关信息
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
      throw new Error(`获取用户角色失败: ${error.message}`);
    }
  },

  /**
   * 从数据库验证宝宝信息
   * 初始化时使用，确保数据是最新的
   */
  async validateBabyInfoFromDB(openid, babyUid) {
    try {
      if (!openid || !babyUid) {
        console.log('validateBabyInfoFromDB: 缺少openid或babyUid');
        return false;
      }

      console.log('从数据库验证宝宝信息:', { openid, babyUid });
      const db = wx.cloud.database();
      
      // 检查宝宝信息表
      const babyInfoResult = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      if (babyInfoResult.data && babyInfoResult.data.length > 0) {
        const babyInfo = babyInfoResult.data[0];
        
        // 验证宝宝信息是否完整
        if (babyInfo.name && babyInfo.birthday && babyInfo.weight) {
          console.log('宝宝信息验证成功，信息完整');
          
          // 更新本地缓存
          wx.setStorageSync('baby_info_completed', true);
          wx.setStorageSync('baby_uid', babyUid);
          
          // 更新全局数据
          this.globalData.babyUid = babyUid;
          this.globalData.babyInfo = babyInfo;
          
          return true;
        } else {
          console.log('宝宝信息不完整:', babyInfo);
          return false;
        }
      } else {
        console.log('数据库中未找到宝宝信息');
        return false;
      }
      
    } catch (error) {
      console.error('从数据库验证宝宝信息失败:', error);
      return false;
    }
  },

  /**
   * 验证宝宝信息
   * 检查本地存储的宝宝信息是否与数据库一致
   * 主要用于页面逻辑中的快速检查
   */
  async validateBabyInfo() {
    try {
      const openid = this.globalData.openid;
      if (!openid) {
        console.error('validateBabyInfo: openid为空，无法验证宝宝信息');
        return false;
      }

      // 检查本地存储状态
      const babyInfoCompleted = wx.getStorageSync('baby_info_completed');
      const babyUid = wx.getStorageSync('baby_uid');
      const creatorPhone = wx.getStorageSync('creator_phone');
      const boundCreatorPhone = wx.getStorageSync('bound_creator_phone');
      
      console.log('宝宝信息验证状态:', {
        babyInfoCompleted,
        hasBabyUid: !!babyUid,
        hasCreatorPhone: !!creatorPhone,
        hasBoundCreatorPhone: !!boundCreatorPhone
      });
      
      // 如果本地没有标记完成，直接返回false
      if (!babyInfoCompleted) {
        console.log('本地未标记宝宝信息完成');
        return false;
      }

      // 如果有babyUid，验证数据库中的信息
      if (babyUid) {
        const db = wx.cloud.database();
        
        // 检查创建者表
        const creatorResult = await db.collection('baby_creators').where({
          _openid: openid,
          babyUid: babyUid
        }).get();
        
        if (creatorResult.data && creatorResult.data.length > 0) {
          console.log('宝宝信息验证成功：创建者');
          return true;
        }
        
        // 检查参与者表
        const participantResult = await db.collection('baby_participants').where({
          _openid: openid,
          babyUid: babyUid
        }).get();
        
        if (participantResult.data && participantResult.data.length > 0) {
          console.log('宝宝信息验证成功：参与者');
          return true;
        }
        
        console.log('数据库验证失败：未找到对应的宝宝信息');
        return false;
      }
      
      // 如果没有babyUid但有手机号，可能是新用户
      if (creatorPhone || boundCreatorPhone) {
        console.log('有手机号但无babyUid，可能是新用户');
        return false;
      }
      
      console.log('宝宝信息验证失败：缺少必要信息');
      return false;
      
    } catch (error) {
      console.error('验证宝宝信息失败:', error);
      return false;
    }
  },

  /**
   * 等待应用初始化完成
   * 供页面调用的方法
   */
  async waitForInitialization() {
    if (this.globalData.isInitialized) {
      return {
        openid: this.globalData.openid,
        userRole: this.globalData.userRole,
        success: true
      };
    }
    
    if (this.initReady) {
      return await this.initReady;
    }
    
    // 如果initReady不存在，重新初始化
    this.initReady = this.initializeApp();
    return await this.initReady;
  },

  /**
   * 获取宝宝信息
   * 主要用于页面逻辑中的快速读取
   */
  async getBabyInfo() {
    try {
      // 首先检查本地缓存
      const babyUid = wx.getStorageSync('baby_uid');
      const babyInfoCompleted = wx.getStorageSync('baby_info_completed');
      if (babyUid && babyInfoCompleted) {
        // 尝试从本地缓存获取完整信息
        const cachedBabyInfo = wx.getStorageSync('baby_info');
        if (cachedBabyInfo) {
          console.log('从本地缓存获取宝宝信息');
          return cachedBabyInfo;
        }
      }
      
      // 如果本地缓存不存在或不完整，从数据库获取
      if (babyUid) {
        console.log('从数据库获取宝宝信息');
        const db = wx.cloud.database();
        const babyInfoResult = await db.collection('baby_info').where({
          babyUid: babyUid
        }).get();

        if (babyInfoResult.data && babyInfoResult.data.length > 0) {
          const babyInfo = babyInfoResult.data[0];
          
          // 更新本地缓存
          wx.setStorageSync('baby_info', babyInfo);
          this.globalData.babyInfo = babyInfo;
          
          return babyInfo;
        }
      }
      
      return null;
    } catch (error) {
      console.error('获取宝宝信息失败:', error);
      return null;
    }
  },

  /**
   * 重新初始化应用
   * 用于错误恢复
   */
  async reinitializeApp() {
    console.log('重新初始化应用...');
    this.globalData.isInitialized = false;
    this.globalData.initError = null;
    this.initReady = this.initializeApp();
    return await this.initReady;
  },
});
