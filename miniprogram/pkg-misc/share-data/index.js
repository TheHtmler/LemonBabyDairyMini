const InvitationModel = require('../../models/invitation');

Page({
  data: {
    babyInfo: null,
    babyName: '宝宝',
    babyUid: '',
    inviteCode: '',
    inviteCodeExpiry: null,
    loading: true,
    hasInviteCode: false,
    generating: false
  },

  onLoad: function (options) {
    this.loadShareData();
  },

  // 下拉刷新
  onPullDownRefresh: function () {
    this.loadShareData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 加载分享数据
  async loadShareData() {
    try {
      wx.showLoading({
        title: '加载中...',
        mask: true
      });

      const app = getApp();
      const babyUid = (app.globalData && app.globalData.babyUid) || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        throw new Error('未找到宝宝信息，请返回成员管理页重试');
      }

      const db = wx.cloud.database();
      const result = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();

      if (result.data.length === 0) {
        throw new Error('未找到宝宝信息');
      }

      const babyInfo = result.data[0];
      const hasInviteCode = !!(babyInfo.inviteCode && babyInfo.inviteCodeExpiry);
      
      // 检查邀请码是否过期
      let validInviteCode = false;
      if (hasInviteCode) {
        const now = new Date();
        const expiry = new Date(babyInfo.inviteCodeExpiry);
        validInviteCode = now < expiry;
      }

      // 格式化过期时间
      let formattedExpiry = '';
      if (validInviteCode && babyInfo.inviteCodeExpiry) {
        const expiry = new Date(babyInfo.inviteCodeExpiry);
        const year = expiry.getFullYear();
        const month = String(expiry.getMonth() + 1).padStart(2, '0');
        const day = String(expiry.getDate()).padStart(2, '0');
        const hours = String(expiry.getHours()).padStart(2, '0');
        const minutes = String(expiry.getMinutes()).padStart(2, '0');
        formattedExpiry = `${year}-${month}-${day} ${hours}:${minutes}`;
      }

      this.setData({
        babyInfo: babyInfo,
        babyName: babyInfo.name || babyInfo.babyName || '宝宝',
        babyUid: babyUid,
        inviteCode: validInviteCode ? babyInfo.inviteCode : '',
        inviteCodeExpiry: formattedExpiry,
        hasInviteCode: validInviteCode,
        loading: false
      });

      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      console.error('加载分享数据失败:', error);
      wx.showModal({
        title: '加载失败',
        content: error.message || '加载分享数据失败，请重试',
        showCancel: false,
        success: () => {
          wx.navigateBack();
        }
      });
    }
  },

  // 生成邀请码
  async generateInviteCode() {
    if (this.data.generating) return;

    try {
      this.setData({ generating: true });
      wx.showLoading({
        title: '生成邀请码...',
        mask: true
      });

      const db = wx.cloud.database();
      const babyUid = this.data.babyUid
        || (getApp().globalData && getApp().globalData.babyUid)
        || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        throw new Error('未找到宝宝信息，请返回成员管理页重试');
      }
      const newInviteCode = InvitationModel.generateInviteCode();
      const newExpiry = InvitationModel.getInviteCodeExpiry();

      const updateResult = await db.collection('baby_info').where({
        babyUid: babyUid
      }).update({
        data: {
          inviteCode: newInviteCode,
          inviteCodeExpiry: newExpiry,
          updatedAt: db.serverDate()
        }
      });

      if (updateResult.stats.updated > 0) {
        // 格式化过期时间
        const expiry = new Date(newExpiry);
        const year = expiry.getFullYear();
        const month = String(expiry.getMonth() + 1).padStart(2, '0');
        const day = String(expiry.getDate()).padStart(2, '0');
        const hours = String(expiry.getHours()).padStart(2, '0');
        const minutes = String(expiry.getMinutes()).padStart(2, '0');
        const formattedExpiry = `${year}-${month}-${day} ${hours}:${minutes}`;

        // 更新页面数据
        this.setData({
          inviteCode: newInviteCode,
          inviteCodeExpiry: formattedExpiry,
          hasInviteCode: true
        });

        const app = getApp();
        if (app.globalData.babyInfo) {
          app.globalData.babyInfo.inviteCode = newInviteCode;
          app.globalData.babyInfo.inviteCodeExpiry = newExpiry;
        }
        if (app.getBabyInfo) {
          app.getBabyInfo({ forceDb: true, refreshAvatar: false }).catch(() => null);
        }

        wx.hideLoading();
        wx.showToast({
          title: '邀请码生成成功',
          icon: 'success'
        });
      } else {
        throw new Error('生成邀请码失败');
      }
    } catch (error) {
      wx.hideLoading();
      console.error('生成邀请码失败:', error);
      wx.showToast({
        title: error.message || '生成邀请码失败',
        icon: 'none'
      });
    } finally {
      this.setData({ generating: false });
    }
  },

  // 复制邀请码
  onCopyInviteCode() {
    if (!this.data.inviteCode) {
      wx.showToast({
        title: '暂无邀请码',
        icon: 'none'
      });
      return;
    }

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

  // 刷新邀请码
  onRefreshInviteCode() {
    wx.showModal({
      title: '刷新邀请码',
      content: '刷新后原邀请码将失效，确定要刷新吗？',
      confirmText: '刷新',
      success: (res) => {
        if (res.confirm) {
          this.generateInviteCode();
        }
      }
    });
  },

  // 页面分享配置
  onShareAppMessage() {
    if (!this.data.inviteCode) {
      return {
        title: '柠檬宝宝喂养记录',
        path: '/pages/role-selection/index'
      };
    }

    const babyName = this.data.babyName || '宝宝';
    return {
      title: `邀请您一起记录${babyName}的喂养数据`,
      desc: `邀请码：${this.data.inviteCode}`,
      path: `/pages/role-selection/index?inviteCode=${this.data.inviteCode}`,
      imageUrl: '/images/LemonLogo.png'
    };
  }
}); 