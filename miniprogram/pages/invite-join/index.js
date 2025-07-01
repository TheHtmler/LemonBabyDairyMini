const InvitationModel = require('../../models/invitation');

Page({
  data: {
    inviteCode: '', // 邀请码
    isFormValid: false, // 表单是否有效
    errorMessage: '', // 错误信息
    isSubmitting: false, // 是否正在提交
    userRole: 'participant' // 用户角色
  },

  onLoad(options) {
    if (options.role) {
      this.setData({
        userRole: options.role
      });
      
      // 如果有角色参数，保存到全局和本地
      const app = getApp();
      app.globalData.userRole = options.role;
      wx.setStorageSync('user_role', options.role);
      wx.setStorageSync('has_selected_role', true);
    }
  },
  
  // 处理邀请码输入
  onInviteCodeInput(e) {
    const code = e.detail.value.replace(/\s/g, ''); // 移除空格
    
    // 验证邀请码格式
    const isValid = InvitationModel.validateInviteCodeFormat(code);
    
    this.setData({
      inviteCode: code,
      isFormValid: isValid,
      errorMessage: isValid ? '' : '请输入8位数字邀请码'
    });
  },
  
  // 加入宝宝记录
  async joinBaby() {
    if (!this.data.isFormValid) {
      this.setData({
        errorMessage: '请输入正确的8位数字邀请码'
      });
      return;
    }
    
    this.setData({ 
      isSubmitting: true, 
      errorMessage: '' 
    });
    
    wx.showLoading({
      title: '验证中...',
      mask: true
    });
    
    try {
      // 查找宝宝信息
      const result = await InvitationModel.findBabyByInviteCode(this.data.inviteCode);
      
      if (!result.success) {
        throw new Error(result.message);
      }

      // 获取当前用户openid
      const app = getApp();
      let openid = app.globalData.openid || wx.getStorageSync('openid');
      
      if (!openid) {
        try {
          openid = await app.openidReady;
          console.log('通过app.openidReady获取到openid:', openid);
        } catch (error) {
          console.error('获取openid失败:', error);
          throw new Error('无法获取用户信息，请重新授权');
        }
      }

      if (!openid) {
        throw new Error('无法获取用户信息，请检查网络后重试');
      }

      // 添加参与者
      const joinResult = await InvitationModel.addParticipant(result.babyInfo.babyUid, openid);
      
      if (!joinResult.success) {
        throw new Error(joinResult.message);
      }

      // 保存宝宝信息到本地和全局
      const babyInfo = result.babyInfo;
      wx.setStorageSync('baby_uid', babyInfo.babyUid);
      wx.setStorageSync('baby_info_completed', true);
      app.globalData.babyUid = babyInfo.babyUid;
      app.globalData.babyInfo = babyInfo;

      wx.hideLoading();
      
      // 显示成功提示
      wx.showToast({
        title: '成功加入宝宝记录！',
        icon: 'success',
        duration: 2000
      });

      // 跳转到主页面
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/daily-feeding/index'
        });
      }, 2000);

    } catch (error) {
      wx.hideLoading();
      console.error('加入失败:', error);
      
      this.setData({
        errorMessage: error.message || '验证失败，请重试',
        isSubmitting: false
      });
      
      // 清空输入框让用户重新输入
      this.setData({
        inviteCode: '',
        isFormValid: false
      });
    }
  },

  // 点击首页icon返回角色选择页
  onLogoClick() {
    console.log('===onLogoClick===');
    // 清除角色选择相关的缓存数据
    wx.removeStorageSync('user_role');
    wx.removeStorageSync('has_selected_role');
    wx.removeStorageSync('baby_info_completed');
    wx.removeStorageSync('baby_uid');
    
    // 清除全局数据
    const app = getApp();
    app.globalData.userRole = '';
    app.globalData.babyInfo = null;
    app.globalData.babyUid = null;
    
    // 跳转回角色选择页
    wx.reLaunch({
      url: '/pages/role-selection/index'
    });
  },

  // 格式化邀请码显示（添加空格）
  formatInviteCode(code) {
    if (!code) return '';
    // 每4位添加一个空格
    return code.replace(/(\d{4})(?=\d)/g, '$1 ');
  },

  // 处理邀请码粘贴
  onInviteCodeBlur(e) {
    const code = e.detail.value.replace(/\s/g, ''); // 移除所有空格
    if (code !== this.data.inviteCode) {
      this.onInviteCodeInput({ detail: { value: code } });
    }
  }
}); 