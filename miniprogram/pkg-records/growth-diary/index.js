const GrowthDiaryModel = require('../../models/growthDiary');
const {
  waitForAppInitialization,
  getBabyUid,
  getBabyInfo,
  getUserInfo,
  handleError,
  growthUtils
} = require('../../utils/index');
const {
  MAX_DIARY_PHOTOS,
  canEditDiaryEntry,
  normalizePhotos
} = require('../../utils/growthDiaryUtils');
const { prepareAndUploadDiaryPhoto } = require('../../utils/diaryImage');
const { resolveCloudTempUrls } = require('../../utils/cloudTempUrlCache');

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDateText(dateValue) {
  if (!dateValue) return '';
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
    return dateValue.slice(0, 10);
  }
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createEmptyForm(overrides = {}) {
  return {
    title: '',
    eventDate: getTodayDateKey(),
    notes: '',
    photos: [],
    ...overrides
  };
}

function makeLocalPhoto(localPath, index) {
  return {
    key: `local_${Date.now()}_${index}`,
    localPath,
    previewUrl: localPath,
    originalFileId: '',
    thumbFileId: ''
  };
}

function makeCloudPhoto(photo, previewUrl, index) {
  return {
    key: photo.thumbFileId || photo.originalFileId || `cloud_${index}`,
    localPath: '',
    previewUrl: previewUrl || '',
    originalFileId: photo.originalFileId || '',
    thumbFileId: photo.thumbFileId || '',
    width: photo.width == null ? null : photo.width,
    height: photo.height == null ? null : photo.height
  };
}

Page({
  data: {
    entries: [],
    loading: false,
    saving: false,
    showForm: false,
    editingId: '',
    maxPhotos: MAX_DIARY_PHOTOS,
    isCreator: false,
    babyName: '柠檬宝宝',
    shareEntryId: '',
    form: createEmptyForm()
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      const app = getApp();
      const userRole = (app.globalData && app.globalData.userRole) || wx.getStorageSync('user_role') || '';
      let babyName = '柠檬宝宝';
      try {
        const babyInfo = await getBabyInfo();
        babyName = babyInfo?.name || babyInfo?.nickname || babyName;
      } catch (e) {
        // ignore
      }
      this.setData({
        isCreator: userRole === 'creator',
        babyName
      });
      if (typeof wx.showShareMenu === 'function') {
        wx.showShareMenu({
          menus: ['shareAppMessage', 'shareTimeline']
        });
      }
    } catch (error) {
      handleError(error, { title: '初始化失败' });
    }
  },

  async onShow() {
    await this.loadEntries();
  },

  getActor(userInfo = {}) {
    const openid = userInfo.openid || getApp().globalData.openid || wx.getStorageSync('openid') || '';
    return {
      openid,
      isCreator: this.data.isCreator,
      userInfo
    };
  },

  async loadEntries() {
    try {
      this.setData({ loading: true });
      const babyUid = getBabyUid();
      if (!babyUid) {
        this.setData({ entries: [], loading: false });
        return;
      }

      const userInfo = await getUserInfo();
      const actor = this.getActor(userInfo);
      const list = await GrowthDiaryModel.listByBaby(babyUid);

      const thumbFileIds = [];
      list.forEach((entry) => {
        normalizePhotos(entry.photos)
          .slice(0, MAX_DIARY_PHOTOS)
          .forEach((photo) => {
            if (photo.thumbFileId) thumbFileIds.push(photo.thumbFileId);
          });
      });

      const urlMap = await resolveCloudTempUrls(thumbFileIds);

      const entries = list.map((entry) => {
        const photos = normalizePhotos(entry.photos).slice(0, MAX_DIARY_PHOTOS);
        const thumbUrls = photos
          .map((photo) => urlMap.get(photo.thumbFileId) || '')
          .filter(Boolean);
        return {
          ...entry,
          canEdit: canEditDiaryEntry(entry, actor),
          eventDateText: formatDateText(entry.eventDate),
          thumbUrls,
          originalFileIds: photos.map((photo) => photo.originalFileId).filter(Boolean),
          authorName: entry.userInfo?.nickName || entry.userInfo?.displayName || ''
        };
      });

      this.setData({ entries, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载成长日记失败' });
    }
  },

  openCreateForm() {
    this.setData({
      showForm: true,
      editingId: '',
      form: createEmptyForm()
    });
  },

  async openEditForm(e) {
    const id = e.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item._id === id);
    if (!entry || !entry.canEdit) {
      wx.showToast({ title: '无权编辑该日记', icon: 'none' });
      return;
    }

    const photos = normalizePhotos(entry.photos).slice(0, MAX_DIARY_PHOTOS);
    const thumbIds = photos.map((p) => p.thumbFileId).filter(Boolean);
    const urlMap = await resolveCloudTempUrls(thumbIds);

    this.setData({
      showForm: true,
      editingId: id,
      form: createEmptyForm({
        title: entry.title || '',
        eventDate: formatDateText(entry.eventDate) || getTodayDateKey(),
        notes: entry.notes || '',
        photos: photos.map((photo, index) =>
          makeCloudPhoto(photo, urlMap.get(photo.thumbFileId) || '', index)
        )
      })
    });
  },

  closeForm() {
    if (this.data.saving) return;
    this.setData({
      showForm: false,
      editingId: '',
      form: createEmptyForm()
    });
  },

  preventMove() {},

  prepareShare(e) {
    const id = e.currentTarget.dataset.id || '';
    this.setData({ shareEntryId: id });
  },

  buildSharePayload(entryId) {
    const id = entryId || this.data.shareEntryId;
    const entry = (this.data.entries || []).find((item) => item._id === id);
    const babyName = this.data.babyName || '柠檬宝宝';
    if (!entry) {
      return {
        title: `${babyName}的成长日记`,
        path: '/pkg-records/growth-diary/index',
        query: ''
      };
    }
    return {
      title: `${babyName} · ${entry.title}`,
      path: `/pkg-records/growth-diary/detail?id=${entry._id}`,
      query: `id=${entry._id}`
    };
  },

  onShareAppMessage() {
    const payload = this.buildSharePayload();
    return {
      title: payload.title,
      path: payload.path
    };
  },

  onShareTimeline() {
    const payload = this.buildSharePayload();
    return {
      title: payload.title,
      query: payload.query
    };
  },

  onFormInput(e) {
    const { field } = e.currentTarget.dataset;
    if (!field) return;
    this.setData({
      [`form.${field}`]: e.detail.value
    });
  },

  onFormDateChange(e) {
    this.setData({
      'form.eventDate': e.detail.value
    });
  },

  async pickPhotos() {
    const remain = MAX_DIARY_PHOTOS - (this.data.form.photos || []).length;
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_DIARY_PHOTOS} 张图片`, icon: 'none' });
      return;
    }

    try {
      let tempPaths = [];
      if (typeof wx.chooseMedia === 'function') {
        const res = await wx.chooseMedia({
          count: remain,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed']
        });
        tempPaths = (res.tempFiles || []).map((file) => file.tempFilePath).filter(Boolean);
      } else {
        const res = await wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera']
        });
        tempPaths = res.tempFilePaths || [];
      }

      if (!tempPaths.length) return;

      const nextPhotos = [...this.data.form.photos];
      tempPaths.slice(0, remain).forEach((path, index) => {
        nextPhotos.push(makeLocalPhoto(path, nextPhotos.length + index));
      });
      this.setData({ 'form.photos': nextPhotos.slice(0, MAX_DIARY_PHOTOS) });
    } catch (error) {
      if (error && /cancel/i.test(error.errMsg || '')) return;
      handleError(error, { title: '选择图片失败' });
    }
  },

  removeFormPhoto(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const photos = [...this.data.form.photos];
    photos.splice(index, 1);
    this.setData({ 'form.photos': photos });
  },

  async uploadFormPhotos(babyUid, entryKey) {
    const photos = this.data.form.photos || [];
    const uploaded = [];
    const ts = Date.now();

    for (let i = 0; i < photos.length; i += 1) {
      const photo = photos[i];
      if (photo.originalFileId && photo.thumbFileId && !photo.localPath) {
        uploaded.push({
          originalFileId: photo.originalFileId,
          thumbFileId: photo.thumbFileId,
          width: photo.width == null ? null : photo.width,
          height: photo.height == null ? null : photo.height
        });
        continue;
      }

      if (!photo.localPath) {
        throw new Error(`第 ${i + 1} 张图片无效`);
      }

      wx.showLoading({ title: `上传图片 ${i + 1}/${photos.length}`, mask: true });
      const result = await prepareAndUploadDiaryPhoto(photo.localPath, {
        babyUid,
        entryKey,
        index: i,
        ts
      });
      uploaded.push({
        originalFileId: result.originalFileId,
        thumbFileId: result.thumbFileId,
        width: null,
        height: null
      });
    }

    return uploaded;
  },

  async saveDiary() {
    if (this.data.saving) return;

    const { form, editingId } = this.data;
    const title = String(form.title || '').trim();
    if (!title) {
      wx.showToast({ title: '请输入里程碑标题', icon: 'none' });
      return;
    }
    if (!form.eventDate) {
      wx.showToast({ title: '请选择发生日期', icon: 'none' });
      return;
    }
    if ((form.photos || []).length > MAX_DIARY_PHOTOS) {
      wx.showToast({ title: `最多上传 ${MAX_DIARY_PHOTOS} 张图片`, icon: 'none' });
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    try {
      this.setData({ saving: true });
      wx.showLoading({ title: '保存中...', mask: true });

      const userInfo = await getUserInfo();
      const actor = this.getActor(userInfo);
      const entryKey = editingId || `tmp_${Date.now()}`;
      const photos = await this.uploadFormPhotos(babyUid, entryKey);
      const eventDate = growthUtils.parseDateString(form.eventDate) || form.eventDate;
      const payload = {
        title,
        notes: String(form.notes || '').trim(),
        eventDate,
        photos
      };

      const result = editingId
        ? await GrowthDiaryModel.update(editingId, babyUid, payload, actor)
        : await GrowthDiaryModel.create(babyUid, payload, actor);

      wx.hideLoading();

      if (!result.success) {
        wx.showToast({ title: result.message || '保存失败', icon: 'none' });
        this.setData({ saving: false });
        return;
      }

      this.setData({
        saving: false,
        showForm: false,
        editingId: '',
        form: createEmptyForm()
      });
      wx.showToast({ title: editingId ? '更新成功' : '记录成功', icon: 'success' });
      await this.loadEntries();
    } catch (error) {
      wx.hideLoading();
      this.setData({ saving: false });
      handleError(error, { title: '保存成长日记失败' });
    }
  },

  confirmDelete(e) {
    const id = e.currentTarget.dataset.id;
    const entry = this.data.entries.find((item) => item._id === id);
    if (!entry || !entry.canEdit) {
      wx.showToast({ title: '无权删除该日记', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '删除日记',
      content: `确定删除「${entry.title || '这篇日记'}」吗？`,
      confirmColor: '#d97757',
      success: async (res) => {
        if (!res.confirm) return;
        await this.deleteEntry(id);
      }
    });
  },

  async deleteEntry(id) {
    try {
      wx.showLoading({ title: '删除中...', mask: true });
      const babyUid = getBabyUid();
      const userInfo = await getUserInfo();
      const actor = this.getActor(userInfo);
      const result = await GrowthDiaryModel.softDelete(id, babyUid, actor);
      wx.hideLoading();

      if (!result.success) {
        wx.showToast({ title: result.message || '删除失败', icon: 'none' });
        return;
      }

      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadEntries();
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '删除失败' });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pkg-records/growth-diary/detail?id=${id}`
    });
  },

  onTapEntry(e) {
    this.goDetail(e);
  },

  previewThumbs(e) {
    const entryId = e.currentTarget.dataset.id;
    const thumbCurrent = e.currentTarget.dataset.current;
    const entry = (this.data.entries || []).find((item) => item._id === entryId);
    const thumbUrls = entry?.thumbUrls || e.currentTarget.dataset.urls || [];
    if (!thumbUrls.length) return;

    const openPreview = (urls) => {
      const currentIndex = Math.max(0, (entry?.thumbUrls || []).indexOf(thumbCurrent));
      wx.previewImage({
        current: urls[currentIndex] || urls[0],
        urls
      });
    };

    const originalIds = entry?.originalFileIds || [];
    if (!originalIds.length) {
      openPreview(thumbUrls);
      return;
    }

    resolveCloudTempUrls(originalIds)
      .then((urlMap) => {
        const urls = originalIds
          .map((id) => urlMap.get(id) || '')
          .filter(Boolean);
        openPreview(urls.length ? urls : thumbUrls);
      })
      .catch(() => openPreview(thumbUrls));
  }
});
