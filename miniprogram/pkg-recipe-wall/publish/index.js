const {
  RECIPE_WALL_TAG_OPTIONS,
  validatePublishPayload,
  formatRecipeWallAuthorLabel
} = require('../../utils/recipeWallUtils');

function displayNameCacheKey(babyUid, role) {
  return babyUid && role ? `personal_display_name_${babyUid}_${role}` : '';
}

Page({
  data: {
    tagOptions: RECIPE_WALL_TAG_OPTIONS,
    selectedTag: '辅食',
    title: '',
    coverFileId: '',
    coverTempPath: '',
    ingredients: [{ name: '', amount: '' }],
    steps: [{ text: '', imageFileId: '', imageTempPath: '' }],
    babyUid: '',
    babyName: '',
    authorDisplayName: '',
    authorAvatar: '',
    previewAuthorLabel: '',
    submitting: false,
    tipText: ''
  },

  onShow() {
    this.loadAuthorContext();
  },

  loadAuthorContext() {
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || '';
    const userRole = app.globalData.userRole || wx.getStorageSync('user_role') || '';
    const babyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
    const babyName = (babyInfo.name || '').trim();
    const cacheKey = displayNameCacheKey(babyUid, userRole);
    const cachedDisplayName = cacheKey ? wx.getStorageSync(cacheKey) : '';
    const authorDisplayName = String(cachedDisplayName || '').trim();
    const authorAvatar = app.globalData.userInfo?.avatarUrl || '';
    const previewAuthorLabel = formatRecipeWallAuthorLabel({ babyName, authorDisplayName });

    this.setData({
      babyUid,
      babyName,
      authorDisplayName,
      authorAvatar,
      previewAuthorLabel,
      tipText: previewAuthorLabel
        ? `发布后将展示为「${previewAuthorLabel}」，请确保内容与宝宝辅食/低蛋白相关`
        : '请先完善宝宝昵称与个人展示名称后再发布'
    });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value || '' });
  },

  onSelectTag(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    this.setData({ selectedTag: tag });
  },

  onIngredientInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const key = `ingredients[${index}].${field}`;
    this.setData({ [key]: e.detail.value || '' });
  },

  addIngredient() {
    this.setData({
      ingredients: this.data.ingredients.concat([{ name: '', amount: '' }])
    });
  },

  removeIngredient(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.ingredients.length <= 1) return;
    const ingredients = this.data.ingredients.filter((_, i) => i !== index);
    this.setData({ ingredients });
  },

  onStepInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`steps[${index}].text`]: e.detail.value || '' });
  },

  addStep() {
    this.setData({
      steps: this.data.steps.concat([{ text: '', imageFileId: '', imageTempPath: '' }])
    });
  },

  removeStep(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.steps.length <= 1) return;
    const steps = this.data.steps.filter((_, i) => i !== index);
    this.setData({ steps });
  },

  async chooseCover() {
    const fileID = await this.chooseAndUploadImage('cover');
    if (!fileID) return;
    this.setData({ coverFileId: fileID.fileID, coverTempPath: fileID.tempPath });
  },

  async chooseStepImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    const fileID = await this.chooseAndUploadImage(`step-${index}`);
    if (!fileID) return;
    this.setData({
      [`steps[${index}].imageFileId`]: fileID.fileID,
      [`steps[${index}].imageTempPath`]: fileID.tempPath
    });
  },

  chooseAndUploadImage(prefix) {
    return new Promise((resolve) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: async (res) => {
          const file = (res.tempFiles || [])[0];
          if (!file?.tempFilePath) {
            resolve(null);
            return;
          }
          try {
            wx.showLoading({ title: '上传中', mask: true });
            const ext = (file.tempFilePath.split('.').pop() || 'jpg').toLowerCase();
            const cloudPath = `recipe-wall/${Date.now()}-${prefix}.${ext}`;
            const uploadRes = await wx.cloud.uploadFile({
              cloudPath,
              filePath: file.tempFilePath
            });
            resolve({ fileID: uploadRes.fileID, tempPath: file.tempFilePath });
          } catch (error) {
            console.error('upload image failed', error);
            wx.showToast({ title: '上传失败', icon: 'none' });
            resolve(null);
          } finally {
            wx.hideLoading();
          }
        },
        fail: () => resolve(null)
      });
    });
  },

  goPersonalInfo() {
    wx.navigateTo({ url: '/pkg-misc/personal-info/index' });
  },

  goBabyInfo() {
    wx.navigateTo({ url: '/pkg-misc/baby-info/index?from=profile' });
  },

  async onSubmit() {
    if (this.data.submitting) return;

    if (!this.data.babyName || !this.data.authorDisplayName) {
      wx.showModal({
        title: '请先完善资料',
        content: '发布需要宝宝昵称和个人展示名称（如妈妈/爸爸）',
        confirmText: '去完善',
        success: (res) => {
          if (res.confirm) {
            if (!this.data.babyName) this.goBabyInfo();
            else this.goPersonalInfo();
          }
        }
      });
      return;
    }

    const payload = {
      title: this.data.title,
      coverFileId: this.data.coverFileId,
      ingredients: this.data.ingredients,
      steps: this.data.steps,
      tags: [this.data.selectedTag],
      babyName: this.data.babyName,
      authorDisplayName: this.data.authorDisplayName,
      babyUid: this.data.babyUid,
      authorAvatar: this.data.authorAvatar
    };

    const localCheck = validatePublishPayload(payload);
    if (!localCheck.ok) {
      wx.showToast({ title: localCheck.message, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'recipeWallManager',
        data: { action: 'publish', ...localCheck.data }
      });
      const result = res.result || {};
      if (!result.ok) {
        throw new Error(result.message || '发布失败');
      }
      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => {
        if (result.postId) {
          wx.redirectTo({ url: `/pkg-recipe-wall/detail/index?id=${result.postId}` });
        } else {
          wx.navigateBack();
        }
      }, 400);
    } catch (error) {
      wx.showToast({ title: error.message || '发布失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
