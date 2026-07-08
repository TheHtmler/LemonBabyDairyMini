const { waitForAppInitialization, handleError } = require('../../utils/index');
const { loadGroupQrcode } = require('../../utils/groupQrCode');

Page({
  data: {
    loading: true,
    groupQrUrl: ''
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      await this.loadGroupQrCode();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载群二维码失败' });
    }
  },

  async loadGroupQrCode() {
    this.setData({ loading: true });
    try {
      const result = await loadGroupQrcode();
      this.setData({
        groupQrUrl: result.url || ''
      });
    } catch (error) {
      console.warn('[group-discussion] loadGroupQrCode failed', error);
      this.setData({ groupQrUrl: '' });
    } finally {
      this.setData({ loading: false });
    }
  },

  previewQrCode() {
    if (!this.data.groupQrUrl) return;
    wx.previewImage({
      current: this.data.groupQrUrl,
      urls: [this.data.groupQrUrl]
    });
  }
});
