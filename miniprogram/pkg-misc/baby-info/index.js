const ACCOUNT_LOGGED_OUT_KEY = 'account_logged_out';

Page({
  data: {
    babyInfo: {
      name: '',
      gender: 'male', // 默认男孩
      birthday: '',
      weight: '',
      height: '',
      condition: 'MMA', // 默认甲基丙二酸血症
      notes: '',
      avatarUrl: '', // 添加头像URL字段
      babyUid: '', // 宝宝唯一标识
      inviteCode: '', // 邀请码
      inviteCodeExpiry: null // 邀请码过期时间
    },
    genders: ['男孩', '女孩'],
    genderIndex: 0,
    conditions: ['甲基丙二酸血症', '丙酸血症', '其他'],
    conditionIndex: 0,
    isFormValid: false,
    isFormSubmitting: false,
    redirectUrl: '',
    firstLogin: false,
    isOwner: true,        // 标记当前用户是否为信息所有者
    ownerNickname: '',    // 宝宝信息所有者的昵称
    fromInvite: false,    // 标记是否从邀请页面进入
    userRole: '',          // 用户角色：creator 或 participant
    defaultAvatarUrl: '/images/LemonLogo.png', // 默认头像路径
    showInviteCode: false, // 是否显示邀请码信息
    showAvatarCropper: false,
    avatarCropSrc: '',
    uploadingAvatar: false,
    // 新用户首次填写、尚未生成 babyUid 时，先把裁剪后的本地头像暂存这里，
    // 等点「保存」生成 babyUid 后再随表单一起上传落库。
    pendingAvatarPath: ''
  },

  onLoad(options) {
    // 获取app实例并保存为实例变量
    this.app = getApp();
    
    // 处理重定向URL
    this.handleRedirect(options);
    
    // 处理用户角色
    this.handleUserRole(options);
    
    // 执行初始化流程
    this.initialize();
  },

  onShow() {
    if (this.app) {
      this.loadBabyInfo();
    }
  },

  getAvatarCacheKey(babyUid) {
    return this.app.getAvatarCacheKey(babyUid);
  },

  async resolveAvatarUrl(babyInfo) {
    return this.app.resolveBabyAvatarUrl(babyInfo);
  },
  
  // 处理重定向URL
  handleRedirect(options) {
    if (options.redirect) {
      this.setData({
        redirectUrl: decodeURIComponent(options.redirect),
        firstLogin: options.firstLogin === 'true'
      });
    }
  },
  
  // 处理用户角色
  handleUserRole(options) {
    let role = '';
    
    if (options && options.role) {
      role = options.role;
      // 保存角色信息
      this.setUserRole(role);
    } else {
      // 尝试获取已存在的角色
      role = this.getUserRole();
    }
    
    // 如果有角色，设置到data中
    if (role) {
      this.setData({
        userRole: role
      });
      
      // 统一设置页面标题
      wx.setNavigationBarTitle({
        title: '完善宝宝信息'
      });
    }
  },
  
  // 获取用户角色的辅助方法
  getUserRole() {
    return this.app.globalData.userRole || wx.getStorageSync('user_role');
  },
  
  // 设置用户角色的辅助方法
  setUserRole(role) {
    this.app.globalData.userRole = role;
    wx.removeStorageSync(ACCOUNT_LOGGED_OUT_KEY);
    wx.setStorageSync('user_role', role);
    wx.setStorageSync('has_selected_role', true);
  },
  
  // 执行初始化流程
  async initialize() {
    try {
      console.log('===initialize===');
      // 顺序执行初始化操作
      await this.checkLoginStatus();
      await this.checkUserPermission();
      await this.loadBabyInfo();
    } catch (error) {
      console.error('初始化失败:', error);
    }
  },

  // 检查登录状态
  async checkLoginStatus() {
    // 检查是否有openid
    let openid = this.app.globalData.openid || wx.getStorageSync('openid');
    
    if (!openid) {
      console.log('未检测到openid，尝试自动获取');
      
      try {
        // 等待app.js的openidReady Promise
        openid = await this.app.openidReady;
        console.log('通过app.openidReady获取到openid:', openid);
      } catch (error) {
        console.error('自动获取openid失败:', error);
        
        // 显示提示但继续允许用户填写表单
        wx.showToast({
          title: '数据同步可能受限',
          icon: 'none',
          duration: 2000
        });
      }
    }
  },

  // 检查用户权限
  async checkUserPermission() {
    try {
      // 如果应用已检查过权限，直接使用全局数据
      if (this.app.globalData.permission) {
        this.setData({
          isOwner: this.app.globalData.isOwner
        });
      } else {
        // 检查app.checkPermission方法是否存在
        if (typeof this.app.checkPermission !== 'function') {
          console.error('app.checkPermission方法不存在，默认设置为拥有者权限');
          // 设置默认权限
          this.app.globalData.isOwner = true;
          this.app.globalData.permission = true;
          this.setData({
            isOwner: true
          });
          return;
        }
        
        // 否则手动检查权限
        await this.app.checkPermission();
        this.setData({
          isOwner: this.app.globalData.isOwner
        });
      }
    } catch (error) {
      console.error('检查用户权限失败:', error);
      // 出错时设置默认权限
      this.setData({
        isOwner: true
      });
    }
  },

  // 加载宝宝信息
  async loadBabyInfo() {
    try {
      // 获取babyUid
      const babyUid = this.app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.log('未找到宝宝UID，显示默认表单');
        return;
      }
      
      wx.showLoading({
        title: '加载信息...',
      });
      
      const db = wx.cloud.database({
        env: this.app.globalData.cloudEnvId
      });
      
      // 查询宝宝信息
      const babyRes = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();

      if (babyRes.data && babyRes.data.length > 0) {
        const babyInfo = await this.app.cacheBabyInfo(babyRes.data[0]);
        
        // 保存宝宝UID到本地和全局
        if (babyInfo.babyUid) {
          wx.setStorageSync('baby_uid', babyInfo.babyUid);
          this.app.globalData.babyUid = babyInfo.babyUid;
          console.log('加载到宝宝ID:', babyInfo.babyUid);
        }
        
        // 处理索引和配置
        const indexes = this.processInfoIndexes(babyInfo);
        const inviteConfig = await this.processInviteCodeConfig(babyInfo);
        this.setData({
          babyInfo: {
            name: babyInfo.name || '',
            gender: babyInfo.gender || 'male',
            birthday: babyInfo.birthday || '',
            weight: babyInfo.weight || '',
            height: babyInfo.height || '',
            condition: babyInfo.condition || 'MMA',
            notes: babyInfo.notes || '',
            avatarUrl: babyInfo.avatarUrl || this.data.defaultAvatarUrl,
            avatarFileId: babyInfo.avatarFileId || '',
            babyUid: babyInfo.babyUid || '',
            inviteCode: inviteConfig.inviteCode,
            inviteCodeExpiry: inviteConfig.inviteCodeExpiry
          },
          genderIndex: indexes.genderIndex,
          conditionIndex: indexes.conditionIndex,
          showInviteCode: inviteConfig.showInviteCode,
          isFormValid: this.checkFormValid({
            name: babyInfo.name,
            weight: babyInfo.weight,
            birthday: babyInfo.birthday
          })
        });
      }
    } catch (error) {
      console.error('加载宝宝信息失败:', error);
    } finally {
      wx.hideLoading();
    }
  },

  // 处理索引值计算
  processInfoIndexes(babyInfo) {
    // 设置疾病类型索引
    let conditionIndex = 0;
    if (babyInfo.condition === 'MMA') {
      conditionIndex = 0;
    } else if (babyInfo.condition === 'PA') {
      conditionIndex = 1;
    } else {
      conditionIndex = 2;
    }

    // 设置性别索引
    const genderIndex = babyInfo.gender === 'male' ? 0 : 1;

    return {
      conditionIndex,
      genderIndex
    };
  },
  
  // 处理邀请码配置
  async processInviteCodeConfig(babyInfo) {
    // 如果是创建者且有宝宝信息，显示邀请码
    if (this.data.userRole === 'creator' && babyInfo.babyUid) {
      return {
        showInviteCode: true,
        inviteCode: babyInfo.inviteCode || '',
        inviteCodeExpiry: babyInfo.inviteCodeExpiry
      };
    }
    
    return {
      showInviteCode: false,
      inviteCode: '',
      inviteCodeExpiry: null
    };
  },

  // 表单输入处理
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    const { value } = e.detail;
    
    this.setData({
      [`babyInfo.${field}`]: value,
      isFormValid: this.checkFormValid({
        ...this.data.babyInfo,
        [field]: value
      })
    });
  },

  // 性别选择处理
  onGenderChange(e) {
    const genderIndex = e.detail.value;
    const gender = genderIndex == 0 ? 'male' : 'female';
    
    this.setData({
      genderIndex,
      'babyInfo.gender': gender
    });
  },

  // 疾病类型选择处理
  onConditionChange(e) {
    const conditionIndex = e.detail.value;
    let condition = 'MMA';
    
    if (conditionIndex == 0) {
      condition = 'MMA';
    } else if (conditionIndex == 1) {
      condition = 'PA';
    } else {
      condition = 'other';
    }
    
    this.setData({
      conditionIndex,
      'babyInfo.condition': condition
    });
  },

  // 选择生日
  onBirthdayChange(e) {
    this.setData({
      'babyInfo.birthday': e.detail.value,
      isFormValid: this.checkFormValid({
        ...this.data.babyInfo,
        birthday: e.detail.value
      })
    });
  },

    // 更新验证表单逻辑
  checkFormValid(formData) {
    // 简化表单验证，只验证基本必填项
    return formData.name && formData.weight && formData.birthday;
  },

  // 生成唯一宝宝ID
  generateBabyUid() {
    // 生成时间戳+随机数作为唯一ID
    const timestamp = new Date().getTime();
    const randomNum = Math.floor(Math.random() * 10000);
    return `baby_${timestamp}_${randomNum}`;
  },

  getTimestampValue(value) {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object' && typeof value.toDate === 'function') {
      const date = value.toDate();
      return date instanceof Date ? date.getTime() : 0;
    }
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  },

  sortDocumentsByFreshness(records = []) {
    return [...(records || [])].sort((left = {}, right = {}) => {
      const rightTime = this.getTimestampValue(right.updatedAt || right.createdAt);
      const leftTime = this.getTimestampValue(left.updatedAt || left.createdAt);
      return rightTime - leftTime;
    });
  },

  async findBabyInfoByUid(db, babyUid) {
    if (!db || !babyUid) return null;
    const res = await db.collection('baby_info').where({ babyUid }).get();
    return (res.data && res.data[0]) || null;
  },

  async resolveBabyUidForSave(db, openid) {
    const localBabyUid = this.data.babyInfo.babyUid
      || (this.app.globalData && this.app.globalData.babyUid)
      || (typeof wx !== 'undefined' && wx.getStorageSync ? wx.getStorageSync('baby_uid') : '');
    if (localBabyUid) return localBabyUid;
    if (!db || !openid) return '';

    const creatorRes = await db.collection('baby_creators').where({
      _openid: openid
    }).get();
    const creators = this.sortDocumentsByFreshness(creatorRes.data || []);
    for (const creator of creators) {
      if (creator.babyUid && await this.findBabyInfoByUid(db, creator.babyUid)) {
        return creator.babyUid;
      }
    }

    // 兼容历史数据：早期 baby_info 直接依赖系统自动写入的 _openid。
    const babyInfoRes = await db.collection('baby_info').where({
      _openid: openid
    }).get();
    const babyInfos = this.sortDocumentsByFreshness(babyInfoRes.data || []);
    return (babyInfos[0] && babyInfos[0].babyUid) || '';
  },

  // 创建默认的配奶设置
  createDefaultNutritionSettings() {
    return {
      natural_protein_coefficient: '',
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      natural_milk_fat: 4.0,
      natural_milk_carbs: 6.8,
      natural_milk_fiber: 0,
      formula_milk_protein: '',
      formula_milk_calories: '',
      formula_milk_ratio: {
        powder: '',
        water: ''
      },
      special_milk_protein: '',
      special_milk_ratio: {
        powder: '',
        water: ''
      }
    };
  },

  // 保存宝宝信息
  async saveBabyInfo() {
    if (this.data.isFormSubmitting) {
      return;
    }

    // 检查表单有效性
    if (!this.data.isFormValid) {
      wx.showToast({
        title: '请填写必填项',
        icon: 'none'
      });
      return;
    }

    this.setData({ isFormSubmitting: true });

    wx.showLoading({
      title: '保存中...',
      mask: true
    });

    try {
      // 获取openid
      let openid = this.app.globalData.openid || wx.getStorageSync('openid');
      
      // 如果没有openid，等待app.js的openidReady Promise
      if (!openid) {
        try {
          openid = await this.app.openidReady;
          console.log('通过app.openidReady获取到openid:', openid);
        } catch (error) {
          console.error('获取openid失败:', error);
          throw new Error('无法获取用户ID，请重新授权');
        }
      }

      if (!openid) {
        throw new Error('无法获取用户ID，请检查网络后重试');
      }

      // 确保数据库集合已初始化
      try {
        console.log('开始确保数据库集合已初始化');
        const collectionResult = await this.ensureCollectionsExist(['baby_creators', 'baby_info', 'baby_participants']);
        console.log('数据库集合初始化结果:', collectionResult);
        
        // 等待一段时间确保集合可用
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('等待后继续执行');
      } catch (initError) {
        console.warn('初始化数据库集合失败，但将继续尝试保存:', initError);
      }

      // 获取云环境ID
      const cloudEnvId = this.app.globalData.cloudEnvId;
      
      // 使用正确的环境ID初始化数据库
      const db = wx.cloud.database({
        env: cloudEnvId
      });

      // 如果是创建者，生成邀请码（新记录）或保持现有邀请码（更新记录）
      let inviteCode = this.data.babyInfo.inviteCode;
      let inviteCodeExpiry = this.data.babyInfo.inviteCodeExpiry;
      
      if (this.data.userRole === 'creator' && !inviteCode) {
        // 导入邀请码模型
        const InvitationModel = require('../../models/invitation');
        inviteCode = InvitationModel.generateInviteCode();
        inviteCodeExpiry = InvitationModel.getInviteCodeExpiry();
        console.log('为新宝宝生成邀请码:', inviteCode);
      }

      // 使用现有的宝宝UID；本地丢失时先从云端创建者关系恢复，最后才生成新的。
      const babyUid = await this.resolveBabyUidForSave(db, openid) || this.generateBabyUid();
      console.log('使用宝宝ID:', babyUid);

      // 头像处理：新用户在 onAvatarCropped 时把本地头像暂存到 pendingAvatarPath，
      // 此刻才有了 babyUid，随表单一起上传落库；上传失败则回退默认头像，不阻塞保存。
      let avatarUrl = this.data.babyInfo.avatarUrl || this.data.defaultAvatarUrl;
      let avatarFileId = this.data.babyInfo.avatarFileId || '';
      if (this.data.pendingAvatarPath) {
        try {
          const uploaded = await this.uploadAvatarFile(this.data.pendingAvatarPath, babyUid);
          avatarUrl = uploaded.avatarUrl;
          avatarFileId = uploaded.avatarFileId;
          this.writeAvatarCache(babyUid, avatarUrl, avatarFileId);
        } catch (avatarErr) {
          console.warn('保存时上传头像失败，回退默认头像:', avatarErr);
          avatarUrl = this.data.defaultAvatarUrl;
          avatarFileId = '';
        }
      }

      // 创建默认的配奶设置
      const nutritionSettings = this.data.babyInfo.nutritionSettings || this.createDefaultNutritionSettings();

      const babyInfo = {
        name: this.data.babyInfo.name,
        gender: this.data.babyInfo.gender,
        birthday: this.data.babyInfo.birthday,
        weight: this.data.babyInfo.weight,
        height: this.data.babyInfo.height,
        condition: this.data.babyInfo.condition,
        notes: this.data.babyInfo.notes,
        updatedAt: db.serverDate(),
        avatarUrl: avatarUrl, // 保存头像URL
        avatarFileId: avatarFileId,
        babyUid: babyUid, // 添加宝宝唯一ID
        nutritionSettings: nutritionSettings, // 添加默认配奶设置
        nutritionSettingsConfirmed: this.data.userRole !== 'creator', // 只有创建者需要确认设置
        // 如果是创建者，添加邀请码
        ...(this.data.userRole === 'creator' && {
          inviteCode: inviteCode,
          inviteCodeExpiry: inviteCodeExpiry
        })
      };

      // 查询是否已有宝宝信息记录
      const res = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();

      if (res.data && res.data.length > 0) {
        // 更新现有记录
        await db.collection('baby_info').doc(res.data[0]._id).update({
          data: babyInfo
        });
        console.log('更新宝宝信息成功');
      } else {
        // 创建新记录
        await db.collection('baby_info').add({
          data: {
            ...babyInfo,
            createdAt: db.serverDate()
          }
        });
        console.log('创建宝宝信息成功');
      }

      // 如果是创建者，需要更新或创建creator记录
      if (this.data.userRole === 'creator') {
        // 查询是否已存在创建者记录
        const creatorRes = await db.collection('baby_creators').where({
          _openid: openid
        }).get();

        if (creatorRes.data && creatorRes.data.length > 0) {
          // 更新现有创建者记录
          await db.collection('baby_creators').doc(creatorRes.data[0]._id).update({
            data: {
              updatedAt: db.serverDate(),
              babyUid: babyUid // 添加关联的宝宝UID
            }
          });
        } else {
          // 创建新的创建者记录（_openid会自动添加）
          await db.collection('baby_creators').add({
            data: {
              babyUid: babyUid, // 添加关联的宝宝UID
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
        }
        
        // 保存宝宝UID到本地
        wx.setStorageSync('baby_uid', babyUid);
        this.app.globalData.babyUid = babyUid;
      }

      // 设置宝宝信息已完成标志
      wx.setStorageSync('baby_info_completed', true);
      
      // 保存全局宝宝信息
      await this.app.cacheBabyInfo(babyInfo);

      // 头像已随保存上传落库：同步到本页数据并清掉待上传标记
      this.setData({
        'babyInfo.babyUid': babyUid,
        'babyInfo.avatarUrl': avatarUrl,
        'babyInfo.avatarFileId': avatarFileId,
        pendingAvatarPath: ''
      });

      wx.hideLoading();
      
      // 显示成功提示，然后询问是否前往设置营养参数
      wx.showToast({
        title: '保存成功',
        icon: 'success',
        success: () => {
          // 只有创建者角色才引导去完善配奶设置信息
          if (this.data.userRole === 'creator') {
            const confirmContent = '建议完善天然蛋白浓度与奶粉档案，是否立即前往配奶设置？';
            wx.showModal({
              title: '完善配奶设置',
              content: confirmContent,
              confirmText: '去设置',
              cancelText: '稍后设置',
              success: (res) => {
                if (res.confirm) {
                  // 标记“需要在首页之上打开配奶设置页”，随后切到首页（会关闭宝宝信息页）。
                  // 由首页 onShow 消费该标记后再 navigateTo 配奶设置页，
                  // 这样页面栈是 [首页, 配奶设置页]，从配奶设置页点左上角返回会回到首页，
                  // 而不是已经保存过的宝宝信息填写页。
                  // （switchTab 后紧跟 navigateTo 在微信里时序不稳定，故改由首页触发跳转。）
                  this.app.globalData.pendingNutritionSetup = true;
                  wx.switchTab({
                    url: '/pages/daily-feeding/index',
                    fail: (err) => {
                      console.error('跳转首页失败:', err);
                      this.app.globalData.pendingNutritionSetup = false;
                      this.navigateToMainPage();
                    }
                  });
                } else {
                  // 用户点击"稍后设置"，直接进入首页
                  this.navigateToMainPage();
                }
              }
            });
          } else {
            // 参与者角色直接跳转到首页
            console.log('参与者角色，直接跳转到首页');
            this.navigateToMainPage();
          }
        }
      });
      
      this.setData({ isFormSubmitting: false });
    } catch (error) {
      console.error('保存宝宝信息失败:', error);
      wx.hideLoading();
      
      // 提供更详细的错误信息
      let errorMsg = '保存宝宝信息失败';
      if (error.errCode === -502005) {
        errorMsg = '保存宝宝信息失败: 数据库集合不存在，请联系客服';
      } else if (error.message) {
        errorMsg = error.message;
      }
      
      wx.showToast({
        title: errorMsg,
        icon: 'none',
        duration: 3000
      });
      
      this.setData({ isFormSubmitting: false });
    }
  },
  
  // 导航到主页面
  navigateToMainPage() {
    wx.switchTab({
      url: '/pages/daily-feeding/index',
      success: () => {
        console.log('跳转到首页成功');
      },
      fail: (err) => {
        console.error('跳转到首页失败:', err);
      }
    });
  },
  
  // 确保数据库集合存在
  async ensureCollectionsExist(collectionNames) {
    try {
      console.log(`开始确保集合存在: ${collectionNames.join(', ')}`);
      
      // 删除云函数调用，直接使用手动创建集合的方式
      console.log('尝试手动创建集合');
      
      // 尝试手动创建集合
      const db = wx.cloud.database({
        env: this.app.globalData.cloudEnvId
      });
      const results = {};
      
      for (const name of collectionNames) {
        // 对每个集合尝试3次
        let success = false;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!success && attempts < maxAttempts) {
          attempts++;
          try {
            console.log(`尝试创建集合 ${name}，第${attempts}次尝试`);
            
            // 先检查集合是否存在
            try {
              const countResult = await db.collection(name).count();
              console.log(`集合 ${name} 已存在, 记录数: ${countResult.total}`);
              results[name] = '已存在';
              success = true;
            } catch (countError) {
              // 如果集合不存在，尝试创建
              if (countError.errCode === -502005) {
                try {
                  await db.createCollection(name);
                  console.log(`成功创建集合: ${name}`);
                  results[name] = '创建成功';
                  success = true;
                } catch (createError) {
                  if (createError.errCode === -501001) {
                    // 集合已存在，这是正常的
                    console.log(`集合 ${name} 已存在 (创建时检测)`);
                    results[name] = '已存在';
                    success = true;
                  } else {
                    console.error(`创建集合失败: ${name}，错误码: ${createError.errCode}，错误信息: ${createError.errMsg || createError.message || '未知错误'}`);
                    
                    if (attempts < maxAttempts) {
                      console.log(`将在0.5秒后重试创建集合: ${name}`);
                      await new Promise(resolve => setTimeout(resolve, 500));
                    } else {
                      results[name] = `创建失败: ${createError.errMsg || createError.message || '未知错误'}`;
                    }
                  }
                }
              } else {
                console.error(`检查集合是否存在时出错: ${name}，错误码: ${countError.errCode}，错误信息: ${countError.errMsg || countError.message || '未知错误'}`);
                
                if (attempts < maxAttempts) {
                  console.log(`将在0.5秒后重试检查集合: ${name}`);
                  await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                  results[name] = `检查失败: ${countError.errMsg || countError.message || '未知错误'}`;
                }
              }
            }
          } catch (error) {
            console.error(`处理集合时出现意外错误: ${name}`, error);
            
            if (attempts < maxAttempts) {
              console.log(`将在0.5秒后重试: ${name}`);
              await new Promise(resolve => setTimeout(resolve, 500));
            } else {
              results[name] = `意外错误: ${error.errMsg || error.message || '未知错误'}`;
            }
          }
        }
      }
      
      console.log('手动创建集合结果:', results);
      
      // 即使部分集合创建失败，我们也返回成功，让程序继续尝试操作
      return {
        success: true,
        message: '完成集合初始化过程'
      };
    } catch (err) {
      console.error('确保数据库集合存在过程出错:', err);
      // 即使出错，我们也返回成功，让程序继续尝试操作
      return {
        success: true,
        message: '集合初始化过程出错，但继续尝试操作',
        error: err
      };
    }
  },

  // 点击头像更换（与「我的」页一致：从相册/相机选图 → 裁剪 → 上传）
  onAvatarClick() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '仅信息所有者可更换头像', icon: 'none' });
      return;
    }
    if (this.data.uploadingAvatar) return;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = (res.tempFilePaths && res.tempFilePaths[0]) || '';
        if (!path) return;
        wx.showLoading({ title: '准备图片...' });
        const ext = (path.split('.').pop() || '').toLowerCase();
        const needConvert = ['webp', 'heic', 'heif'].includes(ext);
        const startCropper = (p) => {
          this.setData({
            showAvatarCropper: true,
            avatarCropSrc: p
          });
          wx.hideLoading();
        };
        if (needConvert) {
          wx.compressImage({
            src: path,
            quality: 80,
            success: (r) => startCropper(r.tempFilePath || path),
            fail: () => startCropper(path)
          });
        } else {
          startCropper(path);
        }
      }
    });
  },

  // 兼容旧入口：微信原生 open-type="chooseAvatar" 按钮回调
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail || {};
    if (!avatarUrl) return;
    this.setData({
      showAvatarCropper: true,
      avatarCropSrc: avatarUrl
    });
  },

  hideAvatarCropper() {
    this.setData({
      showAvatarCropper: false,
      avatarCropSrc: ''
    });
  },

  onAvatarCropped(e) {
    const tempFilePath = e.detail.tempFilePath;
    const finish = (path) => {
      const babyUid =
        this.data.babyInfo.babyUid ||
        this.app.globalData.babyUid ||
        wx.getStorageSync('baby_uid');
      if (babyUid) {
        // 已落库的宝宝：即时上传 + 同步（与「我的」页一致）
        this.setData({ uploadingAvatar: true });
        wx.showLoading({ title: '正在处理...' });
        this.uploadAvatarToCloud(path, { closeAfter: true });
      } else {
        // 新用户尚未保存（无 babyUid）：先本地预览，待点「保存」生成 babyUid 后再上传落库
        this.setData({
          'babyInfo.avatarUrl': path,
          pendingAvatarPath: path
        });
        this.hideAvatarCropper();
        wx.showToast({ title: '头像已选择，保存后生效', icon: 'none' });
      }
    };
    const ext = (tempFilePath.split('.').pop() || '').toLowerCase();
    const needConvert = ['heic', 'heif', 'webp'].includes(ext);
    // 尝试压缩/转码为兼容格式，避免 HEIC/WebP 黑屏
    wx.compressImage({
      src: tempFilePath,
      quality: 80,
      success: (res) => finish(res.tempFilePath || tempFilePath),
      fail: () => finish(tempFilePath)
    });
  },

  // 把本地头像文件上传到云存储并取可访问 URL；不写库、不校验权限，
  // 供「即时上传」和「保存时随表单上传」两条路径复用。
  async uploadAvatarFile(localPath, babyUid) {
    const cloudEnvId = this.app.globalData.cloudEnvId;
    const extMatch = (localPath || '').match(/\.[a-zA-Z0-9]+$/);
    const ext = extMatch ? extMatch[0] : '.jpg';
    const cloudPath = `baby_avatars/${babyUid}_${Date.now()}${ext}`;
    const result = await wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath,
      config: { env: cloudEnvId }
    });
    if (!result.fileID) {
      throw new Error('上传失败');
    }
    const { fileList } = await wx.cloud.getTempFileURL({
      fileList: [{ fileID: result.fileID, maxAge: 604800 }],
      config: { env: cloudEnvId }
    });
    return { avatarUrl: fileList[0].tempFileURL, avatarFileId: result.fileID };
  },

  // 写头像缓存键（让首页/我的页能立即拿到新头像）
  writeAvatarCache(babyUid, avatarUrl, avatarFileId) {
    const cacheKey = this.getAvatarCacheKey(babyUid);
    wx.removeStorageSync(cacheKey);
    wx.setStorageSync(cacheKey, {
      fileId: avatarFileId,
      url: avatarUrl,
      expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000
    });
  },

  // 即时上传头像并落库（仅用于已存在 babyUid 的宝宝）
  async uploadAvatarToCloud(tempFilePath, options = {}) {
    try {
      const babyUid =
        this.data.babyInfo.babyUid ||
        this.app.globalData.babyUid ||
        wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到宝宝信息，无法上传头像',
          icon: 'none'
        });
        this.setData({ uploadingAvatar: false });
        if (options.closeAfter) this.hideAvatarCropper();
        return;
      }

      const { avatarUrl, avatarFileId } = await this.uploadAvatarFile(tempFilePath, babyUid);
      // 更新本地头像
      this.setData({
        'babyInfo.avatarUrl': avatarUrl,
        'babyInfo.avatarFileId': avatarFileId
      });

      const updateRes = await wx.cloud.callFunction({
        name: 'updateBabyAvatar',
        data: {
          babyUid,
          avatarUrl,
          avatarFileId
        }
      });
      if (!updateRes?.result?.ok) {
        wx.hideLoading();
        wx.showToast({
          title: updateRes?.result?.message || '头像同步失败',
          icon: 'none'
        });
        this.setData({ uploadingAvatar: false });
        if (options.closeAfter) this.hideAvatarCropper();
        return;
      }

      const appInstance = getApp();
      const updatedBabyInfo = {
        ...(appInstance.globalData.babyInfo || {}),
        ...this.data.babyInfo,
        avatarUrl,
        avatarFileId
      };
      appInstance.globalData.babyInfo = updatedBabyInfo;
      wx.setStorageSync('baby_info', updatedBabyInfo);

      this.writeAvatarCache(babyUid, avatarUrl, avatarFileId);

      wx.hideLoading();
      wx.showToast({
        title: '头像已更新',
        icon: 'success',
      });
      this.setData({ uploadingAvatar: false });
      if (options.closeAfter) this.hideAvatarCropper();
    } catch (error) {
      console.error('上传头像失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '上传失败，请重试',
        icon: 'none',
      });
      this.setData({ uploadingAvatar: false });
      if (options.closeAfter) this.hideAvatarCropper();
    }
  },

  // 复制邀请码
  onCopyInviteCode(e) {
    const inviteCode = e.currentTarget.dataset.text;
    wx.setClipboardData({
      data: inviteCode,
      success: () => {
        wx.showToast({
          title: '邀请码已复制',
          icon: 'success'
        });
      }
    });
  },

  // 分享邀请码
  onShareInviteCode() {
    const InvitationModel = require('../../models/invitation');
    const shareInfo = InvitationModel.getShareInfo(this.data.babyInfo.inviteCode, this.data.babyInfo.name);
    
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    });
    
    // 设置分享内容
    wx.onShareAppMessage(() => {
      return shareInfo;
    });
    
    wx.showToast({
      title: '请点击右上角分享',
      icon: 'none'
    });
  },

  // 刷新邀请码
  async onRefreshInviteCode() {
    wx.showModal({
      title: '刷新邀请码',
      content: '刷新后原邀请码将失效，确定要刷新吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({
              title: '刷新中...',
              mask: true
            });

            const InvitationModel = require('../../models/invitation');
            const openid = this.app.globalData.openid || wx.getStorageSync('openid');
            
            const result = await InvitationModel.refreshInviteCode(this.data.babyInfo.babyUid, openid);
            
            wx.hideLoading();
            
            if (result.success) {
              this.setData({
                'babyInfo.inviteCode': result.inviteCode,
                'babyInfo.inviteCodeExpiry': result.expiry
              });
              
              wx.showToast({
                title: '邀请码已刷新',
                icon: 'success'
              });
            } else {
              throw new Error(result.message);
            }
          } catch (error) {
            wx.hideLoading();
            wx.showToast({
              title: error.message || '刷新失败',
              icon: 'none'
            });
          }
        }
      }
    });
  }
}); 
