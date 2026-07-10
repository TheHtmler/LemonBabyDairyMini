const { isDeveloperOpenid } = require('../../config/developer');

const ACCOUNT_LOGGED_OUT_KEY = 'account_logged_out';
const CREATOR_CANCEL_CONFIRM_TEXT = '确认注销';
const AVATAR_SECURITY_RISK_MESSAGE = '头像含有违规内容，请更换后再试';
const AVATAR_SECURITY_CHECK_FAILED_MESSAGE = '头像安全检测失败，请稍后重试';

function canShowMenuItem(item = {}, context = {}) {
  const { userRole = '', isDeveloper = false } = context;
  if (item.showForCreator && userRole !== 'creator') return false;
  if (item.showForParticipant && userRole !== 'participant') return false;
  if (item.showForDeveloper && !isDeveloper) return false;
  return true;
}

function buildVisibleMenuGroups(menuGroups = [], context = {}) {
  return menuGroups
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => canShowMenuItem(item, context))
    }))
    .filter((group) => group.items.length > 0);
}

const MENU_GROUPS = [
  {
    id: 'account',
    title: '账号与宝宝',
    items: [
      {
        id: 1,
        name: '宝宝信息',
        icon: 'baby',
        path: '/pkg-misc/baby-info/index?from=profile'
      },
      {
        id: 15,
        name: '个人信息',
        icon: 'info',
        path: '/pkg-misc/personal-info/index',
        description: '查看身份、展示名称与账号状态'
      },
      {
        id: 16,
        name: '成员管理',
        icon: 'participant',
        path: '/pkg-misc/member-management/index',
        description: '邀请、备注或解除参与者',
        showForCreator: true
      }
    ]
  },
  {
    id: 'feeding',
    title: '喂养管理',
    items: [
      {
        id: 10,
        name: '奶粉管理',
        icon: 'setting',
        path: '/pkg-milk/powder-management/index',
        description: '维护母乳参数、我的奶粉与系统奶粉'
      },
      {
        id: 9,
        name: '食物管理',
        icon: 'add',
        path: '/pkg-milk/food-management/index',
        description: '维护常用食物，记录摄入更快捷'
      },
      {
        id: 3,
        name: '药物管理',
        icon: 'medicine',
        path: '/pkg-misc/medications/index'
      }
    ]
  },
  {
    id: 'records',
    title: '数据与成长',
    items: [
      {
        id: 4,
        name: '数据分析',
        icon: 'nutrition',
        path: '/pkg-report/data-analysis/index',
        description: '查看周、月维度的数据趋势'
      },
      {
        id: 10,
        name: '成长记录',
        icon: 'growth',
        path: '/pkg-records/growth-records/index',
        description: '身高体重曲线与成长里程碑'
      }
    ]
  },
  {
    id: 'support',
    title: '帮助与社区',
    items: [
      {
        id: 14,
        name: '应急支持',
        icon: 'info',
        path: '/pkg-misc/emergency-support/index',
        description: '查看急救卡与补液热量计算'
      },
      {
        id: 12,
        name: '意见反馈',
        icon: 'info',
        path: '/pkg-misc/feedback/index',
        description: '告诉我们问题、建议或想增加的功能'
      },
      {
        id: 20,
        name: '加群讨论',
        icon: 'info',
        path: '/pkg-misc/group-discussion/index',
        description: '扫码加入用户群，交流使用心得'
      }
    ]
  },
  {
    id: 'about',
    title: '关于',
    items: [
      {
        id: 6,
        name: '数据标识说明',
        icon: 'info',
        path: '/pkg-misc/about/index?section=auth'
      },
      {
        id: 7,
        name: '关于我们',
        icon: 'info',
        path: '/pkg-misc/about/index'
      }
    ]
  },
  {
    id: 'developer',
    title: '开发者',
    items: [
      {
        id: 13,
        name: '反馈列表',
        icon: 'info',
        path: '/pkg-misc/feedback-list/index',
        description: '查看用户提交的反馈并标记处理状态',
        showForDeveloper: true
      },
      {
        id: 18,
        name: '配置',
        icon: 'setting',
        path: '/pkg-misc/developer-config/index',
        description: '公告、OCR 白名单等开发者配置',
        showForDeveloper: true
      }
    ]
  },
  {
    id: 'account-action',
    title: '账号操作',
    items: [
      {
        id: 8,
        name: '注销账号',
        icon: 'logout',
        action: 'cancelCreatorAccount',
        description: '永久删除该宝宝记录和所有历史数据',
        showForCreator: true
      },
      {
        id: 17,
        name: '解绑',
        icon: 'logout',
        action: 'unbindParticipant',
        description: '解除你的参与者身份，不影响历史记录',
        showForParticipant: true
      }
    ]
  }
];

Page({
  data: {
    userInfo: {},
    babyInfo: {}, // 添加宝宝信息
    isLoggedIn: true,  // 默认设置为已登录
    isEditingProfile: false,
    tempNickName: '',
    userRole: '', // 用户角色
    isDeveloper: false,
    showInviteCode: false, // 是否显示邀请码（创建者可见）
    inviteCode: '', // 邀请码
    menuGroups: MENU_GROUPS,
    visibleMenuGroups: [],
    defaultAvatarUrl: '/images/LemonLogo.png',
    showAvatarCropper: false,
    avatarCropSrc: '',
    latestAvatarUrl: '',
    lastSafeAvatarUrl: '',
    uploadingAvatar: false
  },

  onLoad: function () {
    // 确保有默认的头像路径
    this.setData({
      defaultAvatarUrl: '/images/LemonLogo.png'
    });

    this.refreshIdentityState();
    this.getBabyInfo();
  },

  onShow: function () {
    this.refreshIdentityState();
    if (this.data.uploadingAvatar) return;
    this.getBabyInfo();
  },

  refreshIdentityState() {
    const app = getApp();
    const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
    const openid = app.globalData.openid || wx.getStorageSync('openid') || '';
    const isDeveloper = isDeveloperOpenid(openid);
    this.setData({
      userRole,
      isDeveloper,
      visibleMenuGroups: buildVisibleMenuGroups(this.data.menuGroups, { userRole, isDeveloper })
    });
    return { app, userRole, openid };
  },

  getAvatarCacheKey(babyUid) {
    return getApp().getAvatarCacheKey(babyUid);
  },

  async resolveAvatarUrl(babyInfo) {
    if (this.data.latestAvatarUrl) {
      return this.data.latestAvatarUrl;
    }
    return getApp().resolveBabyAvatarUrl(babyInfo);
  },

  // 获取宝宝信息
  async getBabyInfo(force = false) {
    if (!force && this.data.uploadingAvatar && this.data.latestAvatarUrl) {
      return;
    }
    try {
      const app = getApp();

      // 获取角色信息
      const userRole = app.globalData.userRole || wx.getStorageSync('user_role');
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!userRole || !babyUid) {
        console.log('缺少角色或宝宝UID信息');
        this.getUserInfo(); // 回退到使用用户信息
        return;
      }

      const babyInfo = await app.getBabyInfo({
        forceDb: force,
        refreshAvatar: true,
        forceRefreshAvatar: force
      });

      if (babyInfo && babyInfo.babyUid) {
        this.setData({
          babyInfo: {
            ...babyInfo,
            avatarUrl: this.data.latestAvatarUrl || babyInfo.avatarUrl || this.data.defaultAvatarUrl
          },
          showInviteCode: userRole === 'creator' && !!babyInfo.inviteCode,
          inviteCode: babyInfo.inviteCode || ''
        });
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
  async uploadAvatarToCloud(tempFilePath, options = {}) {
    try {
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到宝宝信息，无法上传头像',
          icon: 'none'
        });
        return;
      }

      // 将临时文件上传到云存储
      const extMatch = (tempFilePath || '').match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '.jpg';
      const timestamp = Date.now();
      const cloudPath = `baby_avatars/${babyUid}_${timestamp}${ext}`;
      // 标记最新头像，防止其他刷新覆盖
      this.setData({ latestAvatarUrl: tempFilePath, uploadingAvatar: true });
      app.globalData.userInfo = { ...(app.globalData.userInfo || {}), avatarUrl: tempFilePath };
      app.globalData.babyInfo = { ...(app.globalData.babyInfo || {}), avatarUrl: tempFilePath };

      const result = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });
      if (result.fileID) {
        try {
          await this.verifyUploadedAvatarSafety(result.fileID);
        } catch (error) {
          if (wx.cloud.deleteFile) {
            wx.cloud.deleteFile({ fileList: [result.fileID] }).catch(() => null);
          }
          throw error;
        }

        // 先用本地临时路径让界面立即刷新
        this.setData({
          'userInfo.avatarUrl': tempFilePath,
          'babyInfo.avatarUrl': tempFilePath,
          latestAvatarUrl: tempFilePath,
          uploadingAvatar: true
        });
        app.globalData.userInfo = {
          ...(app.globalData.userInfo || {}),
          avatarUrl: tempFilePath
        };
        app.globalData.babyInfo = {
          ...(app.globalData.babyInfo || {}),
          avatarUrl: tempFilePath
        };

        // 获取可访问的URL
        const fileList = [{ fileID: result.fileID, maxAge: 604800 }];
        const { fileList: fileUrlList } = await wx.cloud.getTempFileURL({
          fileList: fileList,
        });
        const avatarUrl = fileUrlList[0].tempFileURL;
        // 更新本地头像并保存到用户信息
        this.setData({
          'userInfo.avatarUrl': avatarUrl,
          'babyInfo.avatarUrl': avatarUrl,
          'babyInfo.avatarFileId': result.fileID,
          latestAvatarUrl: avatarUrl,
          uploadingAvatar: false
        });
        // 保存到应用的全局数据和数据库
        const updatedInfo = {
          ...app.globalData.userInfo,
          avatarUrl: avatarUrl,
        };
        await app.updateUserProfile(updatedInfo);
        wx.setStorageSync('userInfo', updatedInfo);
        app.globalData.userInfo = updatedInfo;

        const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
        const updateRes = await wx.cloud.callFunction({
          name: 'updateBabyAvatar',
          data: {
            babyUid,
            avatarUrl,
            avatarFileId: result.fileID
          }
        });
        if (!updateRes?.result?.ok) {
          wx.hideLoading();
          wx.showToast({
            title: updateRes?.result?.message || '头像同步失败',
            icon: 'none'
          });
          return;
        }

        const updatedBabyInfo = {
          ...(app.globalData.babyInfo || {}),
          ...this.data.babyInfo,
          avatarUrl,
          avatarFileId: result.fileID
        };
        app.globalData.babyInfo = updatedBabyInfo;
        wx.setStorageSync('baby_info', updatedBabyInfo);

        const cacheKey = this.getAvatarCacheKey(babyUid);
        wx.removeStorageSync(cacheKey);
        wx.setStorageSync(cacheKey, {
          fileId: result.fileID,
          url: avatarUrl,
          expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000
        });

        wx.hideLoading();
        wx.showToast({
          title: '头像已更新',
          icon: 'success',
        });
        this.setData({
          uploadingAvatar: false,
          latestAvatarUrl: avatarUrl,
          lastSafeAvatarUrl: avatarUrl
        });
        if (options.closeAfter) {
          this.hideAvatarCropper();
        }
        // 上传完成后强制刷新一次宝宝信息，拿最新DB数据
        this.getBabyInfo(true);
      }
    } catch (error) {
      const safeAvatarUrl = this.data.lastSafeAvatarUrl
        || this.data.babyInfo.avatarUrl
        || this.data.userInfo.avatarUrl
        || this.data.defaultAvatarUrl;
      const app = getApp();
      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        avatarUrl: safeAvatarUrl
      };
      app.globalData.babyInfo = {
        ...(app.globalData.babyInfo || {}),
        avatarUrl: safeAvatarUrl
      };
      wx.hideLoading();
      wx.showToast({
        title: error.message || '上传失败，请重试',
        icon: 'none',
      });
      this.setData({
        'userInfo.avatarUrl': safeAvatarUrl,
        'babyInfo.avatarUrl': safeAvatarUrl,
        latestAvatarUrl: '',
        uploadingAvatar: false
      });
      if (options.closeAfter) {
        this.hideAvatarCropper();
      }
    }
  },

  async verifyUploadedAvatarSafety(avatarFileId) {
    const res = await wx.cloud.callFunction({
      name: 'checkAvatarSecurity',
      data: {
        avatarFileId
      }
    });
    const result = res && res.result;
    if (!result || !result.ok) {
      const isRisk = result?.code === 'AVATAR_SECURITY_RISK';
      const error = new Error(result?.message || (isRisk
        ? AVATAR_SECURITY_RISK_MESSAGE
        : AVATAR_SECURITY_CHECK_FAILED_MESSAGE));
      error.code = isRisk ? 'AVATAR_SECURITY_RISK' : 'AVATAR_SECURITY_CHECK_FAILED';
      throw error;
    }
    return true;
  },
  
  // 处理选择头像按钮点击
  onAvatarClick: function() {
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

  hideAvatarCropper() {
    this.setData({
      showAvatarCropper: false,
      avatarCropSrc: ''
    });
  },

  onAvatarCropped(e) {
    const tempFilePath = e.detail.tempFilePath;
    const finish = (path) => {
      const lastSafeAvatarUrl = this.data.babyInfo.avatarUrl
        || this.data.userInfo.avatarUrl
        || this.data.defaultAvatarUrl;
      // 本地先刷新头像
      this.setData({
        'userInfo.avatarUrl': path,
        'babyInfo.avatarUrl': path,
        latestAvatarUrl: path,
        lastSafeAvatarUrl,
        uploadingAvatar: true
      });
      const app = getApp();
      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        avatarUrl: path
      };
      app.globalData.babyInfo = {
        ...(app.globalData.babyInfo || {}),
        avatarUrl: path
      };
      wx.showLoading({
        title: '正在处理...'
      });
      this.uploadAvatarToCloud(path, { closeAfter: true });
    };

    const ext = (tempFilePath.split('.').pop() || '').toLowerCase();
    const needConvert = ['heic', 'heif', 'webp'].includes(ext);

    // 尝试压缩/转码为兼容格式，避免 HEIC/WebP 黑屏
    wx.compressImage({
      src: tempFilePath,
      quality: 80,
      success: (res) => {
        // compressImage 会转成 JPG，优先用转码后的
        finish(res.tempFilePath || tempFilePath);
      },
      fail: () => {
        // 如果不是需转码的格式，直接用原图
        if (!needConvert) {
          finish(tempFilePath);
          return;
        }
        // 简易兜底：复制原路径（仍可能失败，但不会卡住）
        finish(tempFilePath);
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

  // 处理菜单点击
  handleMenuClick: function(e) {
    const item = e.currentTarget.dataset.item;
    
    if (item.action === 'cancelCreatorAccount') {
      this.handleCreatorAccountCancellation();
    } else if (item.action === 'unbindParticipant') {
      this.handleParticipantUnbind();
    } else if (item.path) {
      wx.navigateTo({
        url: item.path
      });
    }
  },

  showConfirmModal(options = {}) {
    return new Promise((resolve) => {
      wx.showModal({
        ...options,
        success: (res) => resolve(res),
        fail: () => resolve({ confirm: false })
      });
    });
  },

  async handleCreatorAccountCancellation() {
    const firstConfirm = await this.showConfirmModal({
      title: '确认注销账号？',
      content: '注销后将永久删除宝宝资料、喂养/用药/成长等历史记录，并解除所有参与者访问。此操作不可恢复。',
      confirmText: '继续注销',
      confirmColor: '#D93026',
      cancelText: '取消'
    });
    if (!firstConfirm.confirm) return;

    const secondConfirm = await this.showConfirmModal({
      title: `请输入“${CREATOR_CANCEL_CONFIRM_TEXT}”完成注销`,
      editable: true,
      placeholderText: `请输入：${CREATOR_CANCEL_CONFIRM_TEXT}`,
      confirmText: '确认注销',
      confirmColor: '#D93026',
      cancelText: '取消'
    });
    if (!secondConfirm.confirm) return;

    if (String(secondConfirm.content || '').trim() !== CREATOR_CANCEL_CONFIRM_TEXT) {
      wx.showToast({
        title: '确认文字不正确',
        icon: 'none'
      });
      return;
    }

    await this.executeAccountCleanup({
      action: 'cancelCreatorAccount',
      loadingTitle: '正在注销...',
      successTitle: '注销成功',
      errorTitle: '注销失败，请重试'
    });
  },

  async handleParticipantUnbind() {
    const confirmed = await this.showConfirmModal({
      title: '确认解绑？',
      content: '解绑后你将不再作为参与者查看或记录该宝宝数据。宝宝资料和历史记录会保留，创建者和其他参与者不受影响。如需重新加入，需要创建者的邀请码。',
      confirmText: '确认解绑',
      confirmColor: '#D93026',
      cancelText: '取消'
    });
    if (!confirmed.confirm) return;

    await this.executeAccountCleanup({
      action: 'unbindParticipant',
      loadingTitle: '正在解绑...',
      successTitle: '已解绑',
      errorTitle: '解绑失败，请重试'
    });
  },

  async executeAccountCleanup({ action, loadingTitle, successTitle, errorTitle }) {
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    if (!babyUid) {
      wx.showToast({
        title: '当前未绑定宝宝记录',
        icon: 'none'
      });
      return;
    }

    try {
      wx.showLoading({
        title: loadingTitle,
        mask: true
      });

      const res = await wx.cloud.callFunction({
        name: 'accountCleanup',
        data: {
          action,
          babyUid
        }
      });
      const result = res && res.result;
      if (!result || !result.ok) {
        throw new Error(result?.message || errorTitle);
      }

      this.clearLocalStorage();
      this.resetGlobalData();

      wx.hideLoading();
      wx.showToast({
        title: successTitle,
        icon: 'success',
        duration: 1200,
        success: () => {
          setTimeout(() => {
            wx.reLaunch({
              url: '/pages/role-selection/index'
            });
          }, 1200);
        }
      });
    } catch (error) {
      console.error('账号清理失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: error.message || errorTitle,
        icon: 'none'
      });
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
      wx.setStorageSync(ACCOUNT_LOGGED_OUT_KEY, true);
      
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
      cloudEnvId: cloudEnvId,
      isInitialized: false,
      initError: null
    };
    // 作废已缓存的初始化 Promise，确保角色选择页重新走一次完整初始化，
    // 否则会拿到注销前「已登录」的旧结果而错误跳回首页。
    app.initReady = null;
  },

  // 复制邀请码
  onCopyInviteCode() {
    wx.setClipboardData({
      data: this.data.inviteCode,
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
    const shareInfo = InvitationModel.getShareInfo(this.data.inviteCode, this.data.babyInfo.name);
    
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
            const openid = wx.getStorageSync('openid');
            
            const result = await InvitationModel.refreshInviteCode(this.data.babyInfo.babyUid, openid);
            
            wx.hideLoading();
            
            if (result.success) {
              this.setData({
                inviteCode: result.inviteCode
              });
              
              // 更新全局数据
              const app = getApp();
              if (app.globalData.babyInfo) {
                app.globalData.babyInfo.inviteCode = result.inviteCode;
                app.globalData.babyInfo.inviteCodeExpiry = result.expiry;
              }
              
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
  },

  onShareAppMessage() {
    return {
      title: '柠檬宝宝喂养记录',
      path: '/pages/role-selection/index',
      imageUrl: '/images/LemonLogo.png'
    };
  }

}) 
