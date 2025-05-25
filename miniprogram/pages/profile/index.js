Page({
  data: {
    userInfo: {},
    babyInfo: {}, // 添加宝宝信息
    isLoggedIn: true,  // 默认设置为已登录
    isEditingProfile: false,
    tempNickName: '',
    menuList: [
      {
        id: 1,
        name: '宝宝信息',
        icon: 'baby',
        path: '/pages/baby-info/index?from=profile'
      },
      {
        id: 2,
        name: '营养设置',
        icon: 'setting',
        path: '/pages/nutrition-settings/index'
      },
      {
        id: 3,
        name: '药物设置',
        icon: 'medicine',
        path: '/pages/medications/index'
      },
      {
        id: 4,
        name: '数据标识说明',
        icon: 'info',
        path: '/pages/about/index?section=auth'
      },
      {
        id: 5,
        name: '关于我们',
        icon: 'info',
        path: '/pages/about/index'
      },
      {
        id: 6,
        name: '注销账户',
        icon: 'logout',
        action: 'logout'
      }
    ],
    defaultAvatarUrl: '/images/LemonLogo.png'
  },

  onLoad: function () {
    // 确保有默认的头像路径
    this.setData({
      defaultAvatarUrl: '/images/LemonLogo.png'
    });

    // 获取宝宝信息
    this.getBabyInfo();
  },

  onShow: function () {
    // 刷新宝宝信息
    this.getBabyInfo();
  },

  // 获取宝宝信息
  async getBabyInfo() {
    try {
      const app = getApp();
      
      // 如果全局有宝宝信息，直接使用
      if (app.globalData.babyInfo) {
        this.setData({
          babyInfo: app.globalData.babyInfo
        });
        return;
      }
      
      // 获取角色和手机号
      const userRole = app.globalData.userRole || wx.getStorageSync('user_role');
      const creatorPhone = app.globalData.creatorPhone || wx.getStorageSync('creator_phone') || wx.getStorageSync('bound_creator_phone');
      
      if (!userRole || !creatorPhone) {
        console.log('缺少角色或手机号信息');
        this.getUserInfo(); // 回退到使用用户信息
        return;
      }
      
      // 从数据库查询宝宝信息
      const db = wx.cloud.database();
      const openid = wx.getStorageSync('openid');
      
      let query = {};
      if (userRole === 'creator') {
        // 创建者根据自己的openid查询
        query = { _openid: openid };
      } else if (userRole === 'participant' && creatorPhone) {
        // 参与者根据绑定的创建者手机号查询
        query = { creatorPhone: creatorPhone };
      }
      
      // 查询宝宝信息
      const res = await db.collection('baby_info').where(query).limit(1).get();
      
      if (res.data && res.data.length > 0) {
        const babyInfo = res.data[0];
        this.setData({
          babyInfo: {
            name: babyInfo.name || '柠檬宝宝',
            avatarUrl: babyInfo.avatarUrl || this.data.defaultAvatarUrl,
            // 其他宝宝信息...
            birthday: babyInfo.birthday || '',
            gender: babyInfo.gender || 'male'
          }
        });
        
        // 缓存到app全局
        app.globalData.babyInfo = babyInfo;
      } else {
        // 没找到宝宝信息，回退到使用用户信息
        console.log('未找到宝宝信息，使用用户信息');
        this.getUserInfo();
      }
    } catch (error) {
      console.error('获取宝宝信息失败:', error);
      // 出错时使用用户信息
      this.getUserInfo();
    }
  },

  getUserInfo: function() {
    // 从本地存储获取用户信息
    const userInfo = wx.getStorageSync('userInfo') || this.getDefaultUserInfo();
    const app = getApp();
    
    // 设置全局和页面数据
    app.globalData.userInfo = userInfo;
    this.setData({
      userInfo: userInfo
    });
  },
  
  // 获取默认用户信息
  getDefaultUserInfo: function() {
    const defaultInfo = {
      nickName: '柠檬宝宝',
      avatarUrl: this.data.defaultAvatarUrl
    };
    
    // 保存到本地存储
    wx.setStorageSync('userInfo', defaultInfo);
    return defaultInfo;
  },

  // 处理昵称输入变化
  handleNickNameInput: function(e) {
    this.setData({
      tempNickName: e.detail.value
    });
  },
  
  // 处理编辑按钮点击
  handleLogin: function() {
    // 进入编辑模式
    this.setData({
      isEditingProfile: true,
      tempNickName: this.data.userInfo.nickName || ''
    });
  },
  
  // 上传头像到云存储
  async uploadAvatarToCloud(tempFilePath) {
    try {
      // 将临时文件上传到云存储
      const cloudPath = `avatars/${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const result = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });
      if (result.fileID) {
        // 获取可访问的URL
        const fileList = [result.fileID];
        const { fileList: fileUrlList } = await wx.cloud.getTempFileURL({
          fileList: fileList,
        });
        const avatarUrl = fileUrlList[0].tempFileURL;
        // 更新本地头像并保存到用户信息
        this.setData({
          'userInfo.avatarUrl': avatarUrl,
        });
        // 保存到应用的全局数据和数据库
        const app = getApp();
        const updatedInfo = {
          ...app.globalData.userInfo,
          avatarUrl: avatarUrl,
        };
        await app.updateUserProfile(updatedInfo);
        wx.setStorageSync('userInfo', updatedInfo);
        app.globalData.userInfo = updatedInfo;
        wx.hideLoading();
        wx.showToast({
          title: '头像已更新',
          icon: 'success',
        });
      }
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: '上传失败，请重试',
        icon: 'none',
      });
    }
  },
  
  // 处理选择头像按钮点击
  onAvatarClick: function() {
    // 提供选择头像的方式
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        // 显示加载中提示
        wx.showLoading({
          title: '正在处理...',
        });
        
        // 上传头像到云存储
        this.uploadAvatarToCloud(res.tempFilePaths[0]);
      }
    });
  },
  
  // 保存用户资料
  saveUserProfile: function() {
    if (!this.data.tempNickName.trim()) {
      wx.showToast({
        title: '昵称不能为空',
        icon: 'none'
      });
      return;
    }
    const app = getApp();
    const updatedInfo = {
      ...this.data.userInfo,
      nickName: this.data.tempNickName
    };
    wx.showLoading({
      title: '保存中...',
    });
    app.updateUserProfile(updatedInfo).then(() => {
      wx.hideLoading();
      this.setData({
        isEditingProfile: false,
        userInfo: updatedInfo
      });
      wx.setStorageSync('userInfo', updatedInfo);
      app.globalData.userInfo = updatedInfo;
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    });
  },
  
  // 取消编辑
  cancelEdit: function() {
    this.setData({
      isEditingProfile: false
    });
  },

  handleMenuClick: function (e) {
    const item = e.currentTarget.dataset.item;
    
    // 处理注销账户
    if (item.action === 'logout') {
      this.handleLogout();
      return;
    }
    
    // 跳转到对应页面
    wx.navigateTo({
      url: item.path
    });
  },
  
  // 处理注销账户
  handleLogout: function() {
    wx.showModal({
      title: '注销账户',
      content: '确定要注销账户吗？注销后将清除所有数据，需要重新选择角色。',
      success: (res) => {
        if (res.confirm) {
          this.clearUserData();
        }
      }
    });
  },

  // 清除用户数据并跳转到角色选择页
  async clearUserData() {
    try {
      wx.showLoading({
        title: '正在注销...',
        mask: true
      });

      const app = getApp();
      const openid = app.globalData.openid || wx.getStorageSync('openid');
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      let dbClearSuccess = true;
      
      if (openid) {
        // 清除数据库中的用户数据
        try {
          await this.clearDatabaseData(openid, babyUid);
        } catch (dbError) {
          console.error('数据库清理出错:', dbError);
          dbClearSuccess = false;
        }
      }

      // 如果数据库清理成功，则手动清理本地存储和全局数据
      if (dbClearSuccess) {
        // 清除本地缓存
        this.clearLocalStorage();
        
        // 重置全局数据
        this.resetGlobalData();

        wx.hideLoading();
        
        // 显示成功提示
        wx.showToast({
          title: '注销成功',
          icon: 'success',
          duration: 1500,
          success: () => {
            // 跳转至角色选择页
            setTimeout(() => {
              wx.reLaunch({
                url: '/pages/role-selection/index'
              });
            }, 1500);
          }
        });
      } else {
        // 如果数据库清理失败，则使用app.logout作为备选方案
        wx.hideLoading();
        
        // 调用全局logout方法
        const logoutSuccess = await app.logout();
        
        if (logoutSuccess) {
          wx.showToast({
            title: '注销成功',
            icon: 'success'
          });
        } else {
          wx.showToast({
            title: '注销过程中出现错误',
            icon: 'none'
          });
        }
      }
    } catch (error) {
      console.error('注销账户失败:', error);
      wx.hideLoading();
      
      wx.showToast({
        title: '注销失败，请重试',
        icon: 'none'
      });
    }
  },

  // 清除数据库中的用户数据
  async clearDatabaseData(openid, babyUid) {
    if (!openid) return;
    
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      const app = getApp();
      
      // 获取用户角色
      const userRole = app.globalData.userRole || wx.getStorageSync('user_role');
      
      if (userRole === 'creator' && babyUid) {
        // 如果是创建者，删除相关记录
        
        // 1. 删除宝宝信息
        const babyInfoRes = await db.collection('baby_info').where({
          babyUid: babyUid
        }).get();
        
        if (babyInfoRes.data && babyInfoRes.data.length > 0) {
          await db.collection('baby_info').doc(babyInfoRes.data[0]._id).remove();
        }
        
        // 2. 删除创建者信息
        const creatorRes = await db.collection('baby_creators').where({
          _openid: openid
        }).get();
        
        if (creatorRes.data && creatorRes.data.length > 0) {
          await db.collection('baby_creators').doc(creatorRes.data[0]._id).remove();
        }
        
        // 3. 删除所有相关的喂养记录
        await db.collection('feeding_records').where({
          babyUid: babyUid
        }).remove();
        
        // 4. 删除所有相关的药物记录
        await db.collection('medication_records').where({
          babyUid: babyUid
        }).remove();
      } else if (userRole === 'participant' && babyUid) {
        // 如果是参与者，仅删除参与者信息
        const participantRes = await db.collection('baby_participants').where({
          _openid: openid
        }).get();
        
        if (participantRes.data && participantRes.data.length > 0) {
          await db.collection('baby_participants').doc(participantRes.data[0]._id).remove();
        }
      }
    } catch (error) {
      console.error('清除数据库数据失败:', error);
      // 即使数据库清除失败，我们也继续注销过程
    }
  },

  // 清除本地存储
  clearLocalStorage() {
    try {
      // 保留某些系统级别的存储，其他全部清除
      const openid = wx.getStorageSync('openid'); // 暂时保留openid
      
      wx.clearStorageSync();
      
      // 恢复openid，仅用于标识用户
      if (openid) {
        wx.setStorageSync('openid', openid);
      }
      
      // 清除角色选择状态
      wx.removeStorageSync('has_selected_role');
      wx.removeStorageSync('user_role');
      wx.removeStorageSync('baby_uid');
      wx.removeStorageSync('creator_phone');
      wx.removeStorageSync('bound_creator_phone');
      wx.removeStorageSync('baby_info_completed');
    } catch (error) {
      console.error('清除本地存储失败:', error);
    }
  },

  // 重置全局数据
  resetGlobalData() {
    const app = getApp();
    
    // 只保留openid和云环境ID
    const openid = app.globalData.openid;
    const cloudEnvId = app.globalData.cloudEnvId;
    
    // 重置全局数据
    app.globalData = {
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
  }
}) 