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
      phone: '', // 添加手机号字段
      avatarUrl: '', // 添加头像URL字段
      babyUid: '', // 宝宝唯一标识
      proteinSourceType: 'breastMilk' // 天然蛋白摄入方式，默认母乳
    },
    genders: ['男孩', '女孩'],
    genderIndex: 0,
    conditions: ['甲基丙二酸血症', '丙酸血症', '其他'],
    conditionIndex: 0,
    proteinSources: ['母乳', '普通奶粉'],
    proteinSourceIndex: 0,
    isFormValid: false,
    isFormSubmitting: false,
    redirectUrl: '',
    firstLogin: false,
    isSharedInfo: false,  // 标记是否为共享的宝宝信息
    isOwner: true,        // 标记当前用户是否为信息所有者
    ownerNickname: '',    // 宝宝信息所有者的昵称
    fromInvite: false,    // 标记是否从邀请页面进入
    userRole: '',          // 用户角色：creator 或 participant
    phoneValid: false, // 手机号验证状态
    phoneErrorMsg: '', // 手机号错误信息
    defaultAvatarUrl: '/images/LemonLogo.png', // 默认头像路径
    phoneDisabled: false // 新增：标记手机号是否禁止修改
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

  // 检查登录状态，确保有openid
  async checkLoginStatus() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      console.log('未检测到openid，尝试自动获取');
      
      try {
        // 尝试获取openid
        await this.app.getOpenid();
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
        const babyInfo = babyRes.data[0];
        
        // 保存宝宝UID到本地和全局
        if (babyInfo.babyUid) {
          wx.setStorageSync('baby_uid', babyInfo.babyUid);
          this.app.globalData.babyUid = babyInfo.babyUid;
          console.log('加载到宝宝ID:', babyInfo.babyUid);
        }
        
        // 处理索引和配置
        const indexes = this.processInfoIndexes(babyInfo);
        const phoneConfig = await this.processPhoneConfig(babyInfo);
        
        this.setData({
          babyInfo: {
            name: babyInfo.name || '',
            gender: babyInfo.gender || 'male',
            birthday: babyInfo.birthday || '',
            weight: babyInfo.weight || '',
            height: babyInfo.height || '',
            condition: babyInfo.condition || 'MMA',
            notes: babyInfo.notes || '',
            phone: phoneConfig.phone, // 使用获取到的手机号
            avatarUrl: babyInfo.avatarUrl || this.data.defaultAvatarUrl,
            babyUid: babyInfo.babyUid || '',
            proteinSourceType: babyInfo.proteinSourceType || 'breastMilk'
          },
          genderIndex: indexes.genderIndex,
          conditionIndex: indexes.conditionIndex,
          proteinSourceIndex: indexes.proteinSourceIndex,
          phoneDisabled: phoneConfig.phoneDisabled, // 设置手机号是否禁止修改
          isFormValid: this.checkFormValid({
            name: babyInfo.name,
            weight: babyInfo.weight,
            birthday: babyInfo.birthday,
            phone: phoneConfig.phone // 使用获取到的手机号
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

    // 设置天然蛋白来源索引
    let proteinSourceIndex = 0;
    if (babyInfo.proteinSourceType === 'breastMilk') {
      proteinSourceIndex = 0;
    } else if (babyInfo.proteinSourceType === 'formulaMilk') {
      proteinSourceIndex = 1;
    }
    
    return {
      conditionIndex,
      genderIndex,
      proteinSourceIndex
    };
  },
  
  // 处理手机号配置
  async processPhoneConfig(babyInfo) {
    // 尝试获取手机号，优先使用creatorPhone，其次使用phone，最后尝试从本地存储获取
    let phone = '';
    let phoneDisabled = false; // 标记手机号是否禁止修改
    
    if (babyInfo.creatorPhone) {
      phone = babyInfo.creatorPhone;
      console.log('从宝宝信息中获取creatorPhone:', phone);
      // 如果是创建者且已有手机号，则禁止修改
      if (this.data.userRole === 'creator') {
        phoneDisabled = true;
      }
    } else if (babyInfo.phone) {
      phone = babyInfo.phone;
      console.log('从宝宝信息中获取phone:', phone);
      // 如果是创建者且已有手机号，则禁止修改
      if (this.data.userRole === 'creator') {
        phoneDisabled = true;
      }
    } else if (this.data.userRole === 'creator') {
      // 如果是创建者角色，尝试从本地存储获取
      phone = wx.getStorageSync('creator_phone') || '';
      console.log('从本地存储获取creator_phone:', phone);
      // 如果本地已有保存的手机号，也禁止修改
      if (phone) {
        phoneDisabled = true;
      }
    } else if (this.data.userRole === 'participant') {
      // 如果是参与者角色，尝试从本地存储获取绑定的创建者手机号
      phone = wx.getStorageSync('bound_creator_phone') || '';
      console.log('从本地存储获取bound_creator_phone:', phone);
      // 参与者始终不能修改创建者手机号
      phoneDisabled = true;
    }

    // 从全局状态获取创建者手机号
    if (!phone && this.app.globalData.creatorPhone) {
      phone = this.app.globalData.creatorPhone;
      console.log('从全局状态获取创建者手机号:', phone);
      if (this.data.userRole === 'creator' && phone) {
        phoneDisabled = true;
      }
    }
    
    return {
      phone,
      phoneDisabled
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

  // 处理手机号输入
  onPhoneInput(e) {
    // 如果手机号已禁用，不处理输入
    if (this.data.phoneDisabled) {
      return;
    }
    
    const phone = e.detail.value;
    const phoneValid = this.validatePhone(phone);
    
    this.setData({
      'babyInfo.phone': phone,
      phoneValid: phoneValid,
      phoneErrorMsg: phoneValid ? '' : '请输入正确的11位手机号，用于标识和关联家庭数据',
      isFormValid: this.checkFormValid({
        ...this.data.babyInfo,
        phone: phone
      })
    });
  },
  
  // 验证手机号码
  validatePhone(phone) {
    const phoneRegex = /^1[3-9]\d{9}$/;
    return phoneRegex.test(phone);
  },
  
  // 更新验证表单逻辑
  checkFormValid(formData) {
    // 如果手机号已禁用，则说明已有有效手机号，不需要再验证
    if (this.data.phoneDisabled) {
      return formData.name && formData.weight && formData.birthday;
    }
    
    // 创建者需要验证手机号，参与者不需要
    if (this.data.userRole === 'creator') {
      return formData.name && formData.weight && formData.birthday && this.validatePhone(formData.phone);
    } else {
      return formData.name && formData.weight && formData.birthday;
    }
  },

  // 生成唯一宝宝ID
  generateBabyUid() {
    // 生成时间戳+随机数作为唯一ID
    const timestamp = new Date().getTime();
    const randomNum = Math.floor(Math.random() * 10000);
    return `baby_${timestamp}_${randomNum}`;
  },

  // 创建默认的营养设置
  createDefaultNutritionSettings() {
    // 根据天然蛋白来源设置不同的默认值
    const proteinConcentration = this.data.babyInfo.proteinSourceType === 'breastMilk' ? 1.1 : 2.1;

    return {
      natural_protein_coefficient: 1.2,  // 天然蛋白系数 g/kg
      natural_milk_protein: proteinConcentration, // 根据来源设置不同的蛋白质含量 g/100ml
      special_milk_protein: 13.1,       // 特奶蛋白质含量 g/100g
      special_milk_ratio: {
        powder: 13.5,                   // 特奶粉量 g
        water: 90                       // 特奶水量 ml
      }
    };
  },

  // 创建默认的药物设置
  createDefaultMedicationSettings() {
    // 不再使用硬编码的默认药物设置
    return [];
  },

  // 保存宝宝信息
  async saveBabyInfo() {
    // 检查表单有效性
    if (!this.data.isFormValid) {
      let errorMsg = '请填写必填项';
      
      // 只有当手机号未被禁用且为创建者时，才需验证手机号
      if (!this.data.phoneDisabled && this.data.userRole === 'creator' && !this.validatePhone(this.data.babyInfo.phone)) {
        errorMsg = '请填写正确的手机号，用于标识家庭数据';
      }
      
      wx.showToast({
        title: errorMsg,
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
      let openid = wx.getStorageSync('openid');
      
      // 如果没有openid，尝试通过app获取
      if (!openid) {
        try {
          await this.app.getOpenid();
          openid = wx.getStorageSync('openid');
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

      // 如果是创建者，需要获取手机号
      let creatorPhone = '';
      
      if (this.data.userRole === 'creator') {
        creatorPhone = this.data.babyInfo.phone;
        
        // 保存创建者信息到云函数
        try {
          const saveCreatorResult = await wx.cloud.callFunction({
            name: 'saveCreatorInfo',
            data: {
              phone: creatorPhone,
              name: this.data.babyInfo.name
            }
          });
          
          if (!saveCreatorResult.result || !saveCreatorResult.result.success) {
            console.error('保存创建者信息失败:', saveCreatorResult.result);
            throw new Error(saveCreatorResult.result?.message || '保存创建者信息失败');
          }
          
          console.log('保存创建者信息成功');
        } catch (error) {
          console.warn('保存创建者信息失败，但将继续尝试保存宝宝信息:', error);
        }
      } else if (this.data.userRole === 'participant') {
        // 如果是参与者，使用绑定的创建者手机号
        creatorPhone = wx.getStorageSync('bound_creator_phone');
      }

      // 使用现有的宝宝UID或生成新的
      const babyUid = this.data.babyInfo.babyUid || this.generateBabyUid();
      console.log('使用宝宝ID:', babyUid);

      // 创建默认的营养设置和药物设置
      const nutritionSettings = this.data.babyInfo.nutritionSettings || this.createDefaultNutritionSettings();
      const medicationSettings = this.data.babyInfo.medicationSettings || this.createDefaultMedicationSettings();

      const babyInfo = {
        name: this.data.babyInfo.name,
        gender: this.data.babyInfo.gender,
        birthday: this.data.babyInfo.birthday,
        weight: this.data.babyInfo.weight,
        height: this.data.babyInfo.height,
        condition: this.data.babyInfo.condition,
        notes: this.data.babyInfo.notes,
        updatedAt: db.serverDate(),
        creatorPhone: creatorPhone, // 添加创建者手机号字段
        avatarUrl: this.data.babyInfo.avatarUrl || this.data.defaultAvatarUrl, // 保存头像URL
        babyUid: babyUid, // 添加宝宝唯一ID
        nutritionSettings: nutritionSettings, // 添加默认营养设置
        medicationSettings: medicationSettings, // 添加默认药物设置
        nutritionSettingsConfirmed: this.data.userRole !== 'creator', // 只有创建者需要确认设置
        proteinSourceType: this.data.babyInfo.proteinSourceType || 'breastMilk'
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
              phone: this.data.babyInfo.phone,
              updatedAt: db.serverDate(),
              babyUid: babyUid // 添加关联的宝宝UID
            }
          });
        } else {
          // 创建新的创建者记录
          await db.collection('baby_creators').add({
            data: {
              _openid: openid,
              phone: this.data.babyInfo.phone,
              babyUid: babyUid, // 添加关联的宝宝UID
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          });
        }
        
        // 将手机号和宝宝UID保存到本地
        wx.setStorageSync('creator_phone', this.data.babyInfo.phone);
        wx.setStorageSync('baby_uid', babyUid);
        this.app.globalData.babyUid = babyUid;
        this.app.globalData.creatorPhone = this.data.babyInfo.phone;
      }

      // 设置宝宝信息已完成标志
      wx.setStorageSync('baby_info_completed', true);
      
      // 保存全局宝宝信息
      this.app.globalData.babyInfo = babyInfo;

      wx.hideLoading();
      
      // 显示成功提示，然后询问是否前往设置营养参数
      wx.showToast({
        title: '保存成功',
        icon: 'success',
        success: () => {
          // 只有创建者角色才引导去完善营养设置信息
          if (this.data.userRole === 'creator') {
            // 根据蛋白质来源类型显示不同的提示
            let confirmContent = '';
            if (this.data.babyInfo.proteinSourceType === 'breastMilk') {
              confirmContent = '您选择了母乳作为天然蛋白来源，需要设置母乳的蛋白质浓度(默认为1.1g/100ml)，是否前往设置？';
            } else {
              confirmContent = '您选择了普通奶粉作为天然蛋白来源，需要设置奶粉的蛋白质浓度和冲配比例，是否前往设置？';
            }
            
            wx.showModal({
              title: '设置营养参数',
              content: confirmContent,
              confirmText: '去设置',
              cancelText: '稍后设置',
              success: (res) => {
                if (res.confirm) {
                  // 用户点击"去设置"，跳转到营养设置页面，并传递蛋白质来源类型
                  const proteinSource = this.data.babyInfo.proteinSourceType === 'breastMilk' ? '母乳' : '普通奶粉';
                  wx.navigateTo({
                    url: `/pages/nutrition-settings/index?proteinSource=${encodeURIComponent(proteinSource)}&fromSetup=true`,
                    success: () => {
                      console.log('成功跳转到营养设置页面');
                    },
                    fail: (err) => {
                      console.error('跳转到营养设置页面失败:', err);
                      // 跳转失败时，直接进入首页
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
      
      // 先尝试通过云函数初始化
      let callFunctionSuccess = false;
      
      try {
        const result = await this.app.initCollections();
        console.log('云函数初始化集合结果:', result);
        
        if (result && result.success) {
          callFunctionSuccess = true;
          console.log('通过云函数成功初始化集合');
        } else {
          console.warn('通过云函数初始化集合返回非成功状态');
        }
      } catch (cloudError) {
        console.error('通过云函数初始化集合出错:', cloudError);
      }
      
      // 如果云函数调用失败，尝试手动创建集合
      if (!callFunctionSuccess) {
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
      }
      
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

  // 处理选择头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    
    // 显示加载中提示
    wx.showLoading({
      title: '正在处理...',
    });
    
    // 上传头像到云存储
    this.uploadAvatarToCloud(avatarUrl);
  },
  
  // 上传头像到云存储
  async uploadAvatarToCloud(tempFilePath) {
    try {
      // 获取云环境ID
      const cloudEnvId = this.app.globalData.cloudEnvId;
      
      // 将临时文件上传到云存储
      const cloudPath = `baby_avatars/${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const result = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
        config: {
          env: cloudEnvId
        }
      });
      if (result.fileID) {
        // 获取可访问的URL
        const fileList = [result.fileID];
        const { fileList: fileUrlList } = await wx.cloud.getTempFileURL({
          fileList: fileList,
          config: {
            env: cloudEnvId
          }
        });
        const avatarUrl = fileUrlList[0].tempFileURL;
        // 更新本地头像
        this.setData({
          'babyInfo.avatarUrl': avatarUrl,
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '头像已更新',
          icon: 'success',
        });
      }
    } catch (error) {
      console.error('上传头像失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '上传失败，请重试',
        icon: 'none',
      });
    }
  },

  // 天然蛋白来源选择处理
  onProteinSourceChange(e) {
    const index = e.detail.value;
    let sourceType = 'breastMilk'; // 默认是母乳
    
    if (index == 1) {
      sourceType = 'formulaMilk'; // 普通奶粉
    }
    
    this.setData({
      proteinSourceIndex: index,
      'babyInfo.proteinSourceType': sourceType
    });
  },

  // 获取手机号
  getPhoneNumber (e) {
    console.log(e.detail.code)  // 动态令牌
    console.log(e.detail.errMsg) // 回调信息（成功失败都会返回）
    console.log(e.detail.errno)  // 错误码（失败时返回）
  },
}); 