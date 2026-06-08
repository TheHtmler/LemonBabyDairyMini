const APP_VERSION = '1.0.0';

function roleText(role) {
  if (role === 'creator') return '创建者';
  if (role === 'participant') return '参与者';
  return '未绑定';
}

function roleDescription(role) {
  if (role === 'creator') return '可管理宝宝信息与邀请参与者';
  if (role === 'participant') return '已加入共享记录，可协助记录数据';
  return '当前未绑定宝宝记录';
}

function defaultDisplayName(role) {
  if (role === 'creator') return '创建者';
  if (role === 'participant') return '参与者';
  return '未绑定用户';
}

function displayNameCacheKey(babyUid, role) {
  return babyUid && role ? `personal_display_name_${babyUid}_${role}` : '';
}

function formatSystemInfo(systemInfo = {}) {
  const parts = [
    systemInfo.brand,
    systemInfo.model,
    systemInfo.platform,
    systemInfo.system
  ].filter(Boolean);

  const suffix = [
    systemInfo.version ? `微信 ${systemInfo.version}` : '',
    systemInfo.SDKVersion ? `基础库 ${systemInfo.SDKVersion}` : ''
  ].filter(Boolean);

  return [...parts, ...suffix].join(' | ') || '未获取';
}

function getCurrentRouteText() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const currentPage = pages && pages.length ? pages[pages.length - 1] : null;
  return currentPage?.route || 'pkg-misc/personal-info/index';
}

Page({
  data: {
    loading: true,
    saving: false,
    babyInfo: null,
    babyName: '暂无记录',
    babyUid: '',
    userRole: '',
    roleLabel: '未绑定',
    roleDescription: '当前未绑定宝宝记录',
    bindingStatus: '未绑定宝宝记录',
    displayName: '',
    displayNameInput: '',
    creatorInfoText: '未记录',
    participantsInfoText: '0 位参与者',
    currentRouteText: 'pkg-misc/personal-info/index',
    systemInfoText: '未获取',
    appVersion: APP_VERSION
  },

  onLoad() {
    this.loadPersonalInfo();
  },

  onShow() {
    this.loadPersonalInfo();
  },

  async loadPersonalInfo() {
    const app = getApp();
    const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || '';
    const fallbackBabyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || null;
    let babyInfo = fallbackBabyInfo;

    if (babyUid && app.getBabyInfo) {
      babyInfo = await app.getBabyInfo({ refreshAvatar: false }).catch(() => fallbackBabyInfo);
    }

    const relation = babyUid ? await this.loadRelationInfo(userRole, babyUid) : null;
    const cacheKey = displayNameCacheKey(babyUid, userRole);
    const cachedDisplayName = cacheKey ? wx.getStorageSync(cacheKey) : '';
    const displayName = relation?.displayName || cachedDisplayName || defaultDisplayName(userRole);
    const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    const creatorInfoText = babyInfo?.creatorInfo?.displayName || '未记录';
    const participantsInfo = babyInfo?.participantsInfo || {};
    const participantNames = participantsInfo.displayNames || [];
    const participantsInfoText = participantNames.length
      ? `${participantsInfo.count || participantNames.length} 位：${participantNames.join('、')}`
      : `${participantsInfo.count || 0} 位参与者`;

    this.setData({
      loading: false,
      babyInfo,
      babyName: babyInfo?.name || '暂无记录',
      babyUid,
      userRole,
      roleLabel: roleText(userRole),
      roleDescription: roleDescription(userRole),
      bindingStatus: babyUid ? '已绑定宝宝记录' : '未绑定宝宝记录',
      displayName,
      displayNameInput: displayName,
      creatorInfoText,
      participantsInfoText,
      currentRouteText: getCurrentRouteText(),
      systemInfoText: formatSystemInfo(systemInfo)
    });
  },

  async loadRelationInfo(userRole, babyUid) {
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    if (!openid || !babyUid || !userRole) return null;

    const collectionName = userRole === 'creator'
      ? 'baby_creators'
      : (userRole === 'participant' ? 'baby_participants' : '');
    if (!collectionName) return null;

    try {
      const db = wx.cloud.database();
      const res = await db.collection(collectionName).where({
        _openid: openid,
        babyUid
      }).limit(1).get();
      return (res.data && res.data[0]) || null;
    } catch (error) {
      console.error('读取个人身份信息失败:', error);
      return null;
    }
  },

  onDisplayNameInput(e) {
    this.setData({
      displayNameInput: e.detail.value || ''
    });
  },

  async saveDisplayName() {
    const displayName = String(this.data.displayNameInput || '').trim();
    if (!displayName) {
      wx.showToast({ title: '请输入展示名称', icon: 'none' });
      return;
    }
    if (displayName.length > 12) {
      wx.showToast({ title: '展示名称最多12个字', icon: 'none' });
      return;
    }

    const { userRole, babyUid } = this.data;
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    const collectionName = userRole === 'creator'
      ? 'baby_creators'
      : (userRole === 'participant' ? 'baby_participants' : '');

    if (!openid || !babyUid || !collectionName) {
      wx.showToast({ title: '当前未绑定宝宝记录', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection(collectionName).where({
        _openid: openid,
        babyUid
      }).limit(1).get();
      const relation = res.data && res.data[0];
      if (!relation) {
        throw new Error('未找到身份记录');
      }

      await db.collection(collectionName).doc(relation._id).update({
        data: {
          displayName,
          updatedAt: db.serverDate()
        }
      });

      const cacheKey = displayNameCacheKey(babyUid, userRole);
      if (cacheKey) {
        wx.setStorageSync(cacheKey, displayName);
      }

      this.setData({
        displayName,
        displayNameInput: displayName,
        saving: false
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      console.error('保存展示名称失败:', error);
      this.setData({ saving: false });
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    }
  },

  copyAccountStatus() {
    const lines = [
      '账号状态',
      `当前记录：${this.data.babyName || '暂无记录'}`,
      `当前身份：${this.data.roleLabel}`,
      `展示名称：${this.data.displayName || defaultDisplayName(this.data.userRole)}`,
      `创建者：${this.data.creatorInfoText}`,
      `参与者：${this.data.participantsInfoText}`,
      `绑定状态：${this.data.bindingStatus}`,
      `排查标识：${this.data.babyUid || '未绑定'}`,
      `当前页面：${this.data.currentRouteText}`,
      `设备信息：${this.data.systemInfoText}`,
      `小程序版本：${this.data.appVersion}`
    ];

    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => {
        wx.showToast({ title: '账号状态已复制', icon: 'success' });
      }
    });
  }
});
