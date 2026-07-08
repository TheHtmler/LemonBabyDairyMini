const { waitForAppInitialization } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');

const CONFIG_ITEMS = [
  {
    id: 'notice',
    name: '首页公告配置',
    description: '控制首页顶部跑马灯公告的显示与文案',
    path: '/pkg-misc/notice-settings/index'
  },
  {
    id: 'ocr-access',
    name: 'OCR 白名单配置',
    description: '配置拍照识别白名单或全量开放',
    path: '/pkg-misc/ocr-access-settings/index'
  },
  {
    id: 'group-qrcode',
    name: '群二维码配置',
    description: '上传并更新加群讨论页展示的用户群二维码',
    path: '/pkg-misc/group-qrcode-settings/index'
  }
];

Page({
  data: {
    hasAccess: true,
    loading: true,
    configItems: CONFIG_ITEMS
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      const app = getApp();
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';
      this.setData({
        hasAccess: isDeveloperOpenid(openid),
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false });
    }
  },

  onItemTap(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    wx.navigateTo({ url: path });
  }
});
