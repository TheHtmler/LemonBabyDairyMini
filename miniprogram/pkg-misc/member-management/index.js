function trimText(value = '') {
  return String(value || '').trim();
}

function openidSuffix(openid = '') {
  const text = String(openid || '');
  return text ? text.slice(-6) : '';
}

function formatJoinedAt(value) {
  if (!value) return '加入时间未记录';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '加入时间未记录';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day} 加入`;
}

Page({
  data: {
    loading: true,
    babyUid: '',
    members: []
  },

  onLoad() {
    this.loadMembers();
  },

  onPullDownRefresh() {
    this.loadMembers().finally(() => {
      if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    });
  },

  onInviteMember() {
    wx.navigateTo({
      url: '/pkg-misc/share-data/index'
    });
  },

  formatParticipantMember(participant = {}, index = 0) {
    const creatorRemark = trimText(participant.creatorRemark);
    const selfDisplayName = trimText(participant.displayName);
    const displayName = creatorRemark || selfDisplayName || `参与者${index + 1}`;

    return {
      _id: participant._id,
      displayName,
      selfDisplayName,
      creatorRemark,
      openidSuffix: participant.openidSuffix || openidSuffix(participant._openid),
      joinedAtText: formatJoinedAt(participant.joinedAt || participant.createdAt)
    };
  },

  async loadMembers() {
    const app = getApp();
    const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || '';

    if (userRole !== 'creator' || !babyUid) {
      wx.showToast({ title: '只有创建者可以管理成员', icon: 'none' });
      this.setData({ loading: false, babyUid, members: [] });
      return;
    }

    this.setData({ loading: true, babyUid });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageParticipants',
        data: {
          action: 'list',
          babyUid
        }
      });
      const result = res && res.result;
      if (!result || !result.ok) {
        throw new Error(result?.message || '加载成员失败');
      }

      this.setData({
        loading: false,
        members: (result.participants || []).map((item, index) => (
          this.formatParticipantMember(item, index)
        ))
      });
    } catch (error) {
      console.error('加载成员失败:', error);
      this.setData({ loading: false });
      wx.showToast({ title: error.message || '加载成员失败', icon: 'none' });
    }
  },

  onEditRemark(e) {
    const member = this.data.members.find((item) => item._id === e.currentTarget.dataset.id);
    if (!member) return;

    wx.showModal({
      title: '修改成员备注',
      content: '备注只对创建者可见，用来区分家庭成员。',
      editable: true,
      placeholderText: '例如爸爸、外婆、保姆',
      confirmText: '保存',
      value: member.creatorRemark || '',
      success: async (res) => {
        if (!res.confirm) return;
        await this.saveRemark(member._id, res.content || '');
      }
    });
  },

  async saveRemark(participantId, creatorRemark) {
    try {
      wx.showLoading({ title: '保存中...', mask: true });
      const res = await wx.cloud.callFunction({
        name: 'manageParticipants',
        data: {
          action: 'updateRemark',
          babyUid: this.data.babyUid,
          participantId,
          creatorRemark
        }
      });
      const result = res && res.result;
      if (!result || !result.ok) {
        throw new Error(result?.message || '保存失败');
      }
      wx.hideLoading();
      wx.showToast({ title: '备注已保存', icon: 'success' });
      await this.loadMembers();
      await this.refreshBabyInfoCache();
    } catch (error) {
      wx.hideLoading();
      console.error('保存成员备注失败:', error);
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    }
  },

  onRemoveMember(e) {
    const member = this.data.members.find((item) => item._id === e.currentTarget.dataset.id);
    if (!member) return;

    wx.showModal({
      title: '解除参与者',
      content: `确认解除「${member.displayName}」吗？解除后对方不能再查看或记录该宝宝数据，历史记录不会删除。`,
      confirmText: '解除',
      confirmColor: '#D93025',
      success: async (res) => {
        if (!res.confirm) return;
        await this.removeMember(member._id);
      }
    });
  },

  async removeMember(participantId) {
    try {
      wx.showLoading({ title: '解除中...', mask: true });
      const res = await wx.cloud.callFunction({
        name: 'manageParticipants',
        data: {
          action: 'remove',
          babyUid: this.data.babyUid,
          participantId
        }
      });
      const result = res && res.result;
      if (!result || !result.ok) {
        throw new Error(result?.message || '解除失败');
      }
      wx.hideLoading();
      wx.showToast({ title: '已解除参与者', icon: 'success' });
      await this.loadMembers();
      await this.refreshBabyInfoCache();
    } catch (error) {
      wx.hideLoading();
      console.error('解除参与者失败:', error);
      wx.showToast({ title: error.message || '解除失败', icon: 'none' });
    }
  },

  async refreshBabyInfoCache() {
    const app = getApp();
    if (app.getBabyInfo) {
      await app.getBabyInfo({ forceDb: true, refreshAvatar: false }).catch(() => null);
    }
  }
});
