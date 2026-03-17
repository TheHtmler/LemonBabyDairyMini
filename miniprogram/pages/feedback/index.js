const { waitForAppInitialization, getBabyUid, handleError } = require('../../utils/index');

const FEEDBACK_TYPES = ['功能建议', '问题反馈', '体验吐槽', '其他'];

Page({
  data: {
    feedbackTypes: FEEDBACK_TYPES,
    selectedType: FEEDBACK_TYPES[0],
    content: '',
    contact: '',
    submitting: false,
    groupQrUrl: ''
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      this.loadGroupQrCode();
    } catch (error) {
      handleError(error, { title: '初始化失败' });
    }
  },

  async loadGroupQrCode() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('app_config').where({ key: 'group_qrcode' }).limit(1).get();
      if (res.data && res.data.length > 0 && res.data[0].fileId) {
        const { fileList } = await wx.cloud.getTempFileURL({
          fileList: [res.data[0].fileId]
        });
        if (fileList && fileList[0] && fileList[0].tempFileURL) {
          this.setData({ groupQrUrl: fileList[0].tempFileURL });
        }
      }
    } catch (err) {
      console.warn('加载群二维码失败:', err);
    }
  },

  previewQrCode() {
    if (!this.data.groupQrUrl) return;
    wx.previewImage({
      current: this.data.groupQrUrl,
      urls: [this.data.groupQrUrl]
    });
  },

  onTypeTap(e) {
    const { type } = e.currentTarget.dataset || {};
    if (!type) return;
    this.setData({ selectedType: type });
  },

  onContentInput(e) {
    this.setData({
      content: e.detail.value || ''
    });
  },

  onContactInput(e) {
    this.setData({
      contact: e.detail.value || ''
    });
  },

  async submitFeedback() {
    const content = (this.data.content || '').trim();
    const contact = (this.data.contact || '').trim();

    if (!content) {
      wx.showToast({ title: '请先填写反馈内容', icon: 'none' });
      return;
    }

    if (content.length < 5) {
      wx.showToast({ title: '反馈内容至少 5 个字', icon: 'none' });
      return;
    }

    if (this.data.submitting) {
      return;
    }

    try {
      this.setData({ submitting: true });
      wx.showLoading({ title: '提交中...', mask: true });

      const app = getApp();
      const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
      const babyUid = getBabyUid() || '';
      const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
      const babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
      const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
      const pages = getCurrentPages ? getCurrentPages() : [];
      const currentPage = pages.length ? pages[pages.length - 1] : null;

      const res = await wx.cloud.callFunction({
        name: 'feedbackManager',
        data: {
          action: 'submit',
          type: this.data.selectedType,
          content,
          contact,
          babyUid,
          userRole,
          appVersion: '1.0.0',
          source: 'miniprogram',
          userNickname: userInfo.nickName || '',
          babyName: babyInfo.name || '',
          submitRoute: currentPage?.route || '',
          systemInfo: {
            brand: systemInfo.brand || '',
            model: systemInfo.model || '',
            platform: systemInfo.platform || '',
            system: systemInfo.system || '',
            language: systemInfo.language || '',
            version: systemInfo.version || '',
            SDKVersion: systemInfo.SDKVersion || ''
          },
          miniProgramInfo: {
            envVersion: accountInfo?.miniProgram?.envVersion || '',
            version: accountInfo?.miniProgram?.version || ''
          }
        }
      });

      if (!res?.result?.ok) {
        throw new Error(res?.result?.message || '反馈提交失败');
      }

      wx.hideLoading();
      wx.showToast({ title: '反馈已提交', icon: 'success' });
      this.setData({
        submitting: false,
        content: '',
        contact: ''
      });

      setTimeout(() => {
        wx.navigateBack({
          delta: 1
        });
      }, 600);
    } catch (error) {
      wx.hideLoading();
      this.setData({ submitting: false });
      handleError(error, {
        title: error?.message || '提交失败',
        hideLoading: false
      });
    }
  }
});
