const { waitForAppInitialization, handleError } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');
const { resolveGroupQrcodeUrl } = require('../../utils/groupQrCode');

function formatDateTime(value) {
  if (!value) return '尚未保存';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未保存';
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    hasAccess: true,
    loading: true,
    saving: false,
    uploading: false,
    fileId: '',
    previewUrl: '',
    updatedAtText: '尚未保存',
    updatedByText: ''
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      const app = getApp();
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';

      if (!isDeveloperOpenid(openid)) {
        this.setData({
          hasAccess: false,
          loading: false
        });
        return;
      }

      await this.loadConfig();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载群二维码配置失败' });
    }
  },

  async callManager(data = {}) {
    const res = await wx.cloud.callFunction({
      name: 'appConfigManager',
      data
    });
    if (!res?.result?.ok) {
      throw new Error(res?.result?.message || '群二维码配置操作失败');
    }
    return res.result;
  },

  async loadConfig() {
    this.setData({ loading: true });
    try {
      const result = await this.callManager({
        action: 'getGroupQrcodeConfig'
      });
      await this.applyConfig(result.config || {});
    } finally {
      this.setData({ loading: false });
    }
  },

  async applyConfig(config = {}) {
    const fileId = config.fileId || '';
    const previewUrl = fileId ? await resolveGroupQrcodeUrl(fileId) : '';
    this.setData({
      fileId,
      previewUrl,
      updatedAtText: formatDateTime(config.updatedAt),
      updatedByText: config.updatedBy || ''
    });
  },

  async chooseImage() {
    if (this.data.uploading || this.data.saving) return;
    try {
      const chooseRes = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });
      const tempFilePath = chooseRes?.tempFilePaths?.[0];
      if (!tempFilePath) return;
      await this.uploadImage(tempFilePath);
    } catch (error) {
      if (error && /cancel/i.test(error.errMsg || '')) {
        return;
      }
      handleError(error, { title: '选择图片失败' });
    }
  },

  async uploadImage(tempFilePath) {
    this.setData({
      uploading: true,
      previewUrl: tempFilePath
    });

    try {
      wx.showLoading({ title: '上传中...', mask: true });
      const extMatch = (tempFilePath || '').match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '.jpg';
      const cloudPath = `app_config_images/group_qrcode_${Date.now()}${ext}`;
      const result = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      });

      if (!result?.fileID) {
        throw new Error('图片上传失败');
      }

      this.setData({ fileId: result.fileID });
      wx.hideLoading();
      wx.showToast({ title: '图片已上传', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      this.setData({
        fileId: '',
        previewUrl: ''
      });
      handleError(error, { title: '图片上传失败', hideLoading: false });
    } finally {
      this.setData({ uploading: false });
    }
  },

  previewImage() {
    const current = this.data.previewUrl;
    if (!current) return;
    wx.previewImage({
      current,
      urls: [current]
    });
  },

  async onSaveConfig() {
    if (this.data.saving || this.data.uploading) return;
    if (!this.data.fileId) {
      wx.showToast({
        title: '请先上传群二维码',
        icon: 'none'
      });
      return;
    }

    this.setData({ saving: true });
    try {
      const result = await this.callManager({
        action: 'updateGroupQrcode',
        fileId: this.data.fileId
      });
      await this.applyConfig(result.config || {});
      wx.showToast({
        title: '已保存',
        icon: 'success'
      });
    } catch (error) {
      handleError(error, { title: error?.message || '保存群二维码失败' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async onClearConfig() {
    if (this.data.saving || this.data.uploading) return;
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '清空群二维码？',
        content: '清空后加群讨论页将不再展示二维码。',
        confirmText: '清空',
        confirmColor: '#D93026',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;

    this.setData({ saving: true });
    try {
      const result = await this.callManager({
        action: 'clearGroupQrcode'
      });
      await this.applyConfig(result.config || {});
      wx.showToast({
        title: '已清空',
        icon: 'success'
      });
    } catch (error) {
      handleError(error, { title: error?.message || '清空群二维码失败' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
