const GrowthDiaryModel = require('../../models/growthDiary');
const {
  waitForAppInitialization,
  getBabyUid,
  getBabyInfo,
  getUserInfo,
  handleError
} = require('../../utils/index');
const {
  MAX_DIARY_MEDIA,
  MAX_DIARY_VIDEOS,
  MAX_VIDEO_DURATION_SEC,
  MAX_AUTHOR_ROLE_LEN,
  DIARY_ROLE_PRESETS,
  canEditDiaryEntry,
  normalizeMedia,
  listPreviewFileIds,
  hasAuthorDisplayName,
  normalizeAuthorDisplayName,
  validateAuthorDisplayName,
  formatDiaryPublishMeta,
  normalizeEventDateKey,
  formatDiaryEventAgeText
} = require('../../utils/growthDiaryUtils');
const {
  prepareAndUploadDiaryPhoto,
  prepareAndUploadDiaryVideo,
  validateDiaryVideoLocal
} = require('../../utils/diaryImage');
const { resolveCloudTempUrls } = require('../../utils/cloudTempUrlCache');

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDateText(dateValue) {
  return normalizeEventDateKey(dateValue);
}

function createEmptyForm(overrides = {}) {
  return {
    title: '',
    eventDate: getTodayDateKey(),
    notes: '',
    media: [],
    ...overrides
  };
}

function countFormVideos(media = []) {
  return (media || []).filter((item) => item.type === 'video').length;
}

function makeLocalImage(localPath, index) {
  return {
    key: `local_img_${Date.now()}_${index}`,
    type: 'image',
    localPath,
    coverLocalPath: '',
    previewUrl: localPath,
    durationSec: null,
    sizeBytes: null,
    originalFileId: '',
    thumbFileId: '',
    videoFileId: '',
    coverFileId: '',
    width: null,
    height: null
  };
}

function makeLocalVideo(file, index) {
  const coverLocalPath = String(file?.thumbTempFilePath || '').trim();
  return {
    key: `local_vid_${Date.now()}_${index}`,
    type: 'video',
    localPath: String(file?.tempFilePath || '').trim(),
    coverLocalPath,
    previewUrl: coverLocalPath,
    durationSec: Number(file?.duration) || null,
    sizeBytes: Number(file?.size) || null,
    originalFileId: '',
    thumbFileId: '',
    videoFileId: '',
    coverFileId: '',
    width: null,
    height: null
  };
}

function makeCloudMedia(item, previewUrl, index) {
  if (item.type === 'video') {
    return {
      key: item.coverFileId || item.videoFileId || `cloud_v_${index}`,
      type: 'video',
      localPath: '',
      coverLocalPath: '',
      previewUrl: previewUrl || '',
      durationSec: item.durationSec == null ? null : item.durationSec,
      sizeBytes: item.sizeBytes == null ? null : item.sizeBytes,
      originalFileId: '',
      thumbFileId: '',
      videoFileId: item.videoFileId || '',
      coverFileId: item.coverFileId || '',
      width: item.width == null ? null : item.width,
      height: item.height == null ? null : item.height
    };
  }
  return {
    key: item.thumbFileId || item.originalFileId || `cloud_i_${index}`,
    type: 'image',
    localPath: '',
    coverLocalPath: '',
    previewUrl: previewUrl || '',
    durationSec: null,
    sizeBytes: null,
    originalFileId: item.originalFileId || '',
    thumbFileId: item.thumbFileId || '',
    videoFileId: '',
    coverFileId: '',
    width: item.width == null ? null : item.width,
    height: item.height == null ? null : item.height
  };
}

Page({
  data: {
    entries: [],
    loading: false,
    saving: false,
    showForm: false,
    editingId: '',
    maxMedia: MAX_DIARY_MEDIA,
    maxRoleLen: MAX_AUTHOR_ROLE_LEN,
    rolePresets: DIARY_ROLE_PRESETS,
    isCreator: false,
    userRole: '',
    babyName: '柠檬宝宝',
    authorDisplayName: '',
    shareEntryId: '',
    showRoleModal: false,
    roleGateAction: '', // enter | create
    roleDraft: '',
    selectedRolePreset: '',
    accessDenied: false,
    accessDeniedTitle: '',
    accessDeniedSubtitle: '',
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
        userRole,
        babyName
      });
      await this.refreshAuthorDisplayName();
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
    const access = await this.checkDiaryAccess();
    if (!access.ok) {
      this.setData({
        accessDenied: true,
        accessDeniedTitle: access.title || '无权限访问',
        accessDeniedSubtitle: access.subtitle || '请先加入家庭后再查看成长日记。',
        showRoleModal: false,
        showForm: false,
        entries: [],
        loading: false
      });
      return;
    }

    this.setData({
      accessDenied: false,
      accessDeniedTitle: '',
      accessDeniedSubtitle: ''
    });
    await this.loadEntries();
    await this.ensureAuthorRole({ action: 'enter' });
  },

  async checkDiaryAccess() {
    const babyUid = getBabyUid();
    const userRole = this.data.userRole
      || getApp().globalData.userRole
      || wx.getStorageSync('user_role')
      || '';
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';

    if (!openid) {
      return {
        ok: false,
        title: '无权限访问',
        subtitle: '请先登录微信后再查看成长日记。'
      };
    }
    if (!babyUid || (userRole !== 'creator' && userRole !== 'participant')) {
      return {
        ok: false,
        title: '无权限访问',
        subtitle: '你还不是该家庭成员，无法查看成长日记。'
      };
    }

    const relation = await this.loadRelationRecord();
    if (!relation) {
      return {
        ok: false,
        title: '无权限访问',
        subtitle: '未找到家庭成员身份，请确认已加入后再试。'
      };
    }
    return { ok: true };
  },

  getActor(userInfo = {}) {
    const openid = userInfo.openid || getApp().globalData.openid || wx.getStorageSync('openid') || '';
    const authorDisplayName = this.data.authorDisplayName || '';
    return {
      openid,
      isCreator: this.data.isCreator,
      authorDisplayName,
      userInfo: {
        ...userInfo,
        displayName: authorDisplayName || userInfo.displayName || ''
      }
    };
  },

  getRelationCollectionName(userRole = this.data.userRole) {
    if (userRole === 'creator') return 'baby_creators';
    if (userRole === 'participant') return 'baby_participants';
    return '';
  },

  displayNameCacheKey(babyUid, userRole) {
    return babyUid && userRole ? `personal_display_name_${babyUid}_${userRole}` : '';
  },

  async loadRelationRecord() {
    const babyUid = getBabyUid();
    const userRole = this.data.userRole
      || getApp().globalData.userRole
      || wx.getStorageSync('user_role')
      || '';
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    const collectionName = this.getRelationCollectionName(userRole);
    if (!babyUid || !openid || !collectionName) return null;

    try {
      const db = wx.cloud.database();
      const res = await db.collection(collectionName).where({
        _openid: openid,
        babyUid
      }).limit(1).get();
      return (res.data && res.data[0]) || null;
    } catch (error) {
      console.warn('读取家庭角色失败:', error);
      return null;
    }
  },

  async refreshAuthorDisplayName() {
    const babyUid = getBabyUid();
    const userRole = this.data.userRole
      || getApp().globalData.userRole
      || wx.getStorageSync('user_role')
      || '';
    const cacheKey = this.displayNameCacheKey(babyUid, userRole);
    const cached = cacheKey ? wx.getStorageSync(cacheKey) : '';
    const relation = await this.loadRelationRecord();
    const name = normalizeAuthorDisplayName(relation?.displayName || cached || '');
    this.setData({
      userRole,
      authorDisplayName: name
    });
    return name;
  },

  async ensureAuthorRole({ action = 'enter' } = {}) {
    // 无权限访客不拦角色，交给无权限兜底
    if (this.data.accessDenied) return false;
    const access = await this.checkDiaryAccess();
    if (!access.ok) {
      this.setData({
        accessDenied: true,
        accessDeniedTitle: access.title || '无权限访问',
        accessDeniedSubtitle: access.subtitle || '你还不是该家庭成员，无法查看成长日记。',
        showRoleModal: false
      });
      return false;
    }

    const name = await this.refreshAuthorDisplayName();
    if (hasAuthorDisplayName(name)) return true;
    this.setData({
      showRoleModal: true,
      roleGateAction: action,
      roleDraft: '',
      selectedRolePreset: ''
    });
    return false;
  },

  async loadFamilyDisplayNameMap(babyUid) {
    const map = {};
    if (!babyUid) return map;
    try {
      const db = wx.cloud.database();
      const [creatorsRes, participantsRes] = await Promise.all([
        db.collection('baby_creators').where({ babyUid }).limit(20).get(),
        db.collection('baby_participants').where({ babyUid }).limit(50).get()
      ]);
      const rows = [...(creatorsRes.data || []), ...(participantsRes.data || [])];
      rows.forEach((row) => {
        const openid = String(row._openid || '').trim();
        const name = normalizeAuthorDisplayName(row.displayName || '');
        if (openid && name) map[openid] = name;
      });
    } catch (error) {
      console.warn('加载家庭角色映射失败:', error);
    }
    return map;
  },

  async loadEntries() {
    try {
      this.setData({ loading: true });
      const babyUid = getBabyUid();
      if (!babyUid) {
        this.setData({ entries: [], loading: false });
        return;
      }

      await this.refreshAuthorDisplayName();
      const userInfo = await getUserInfo();
      const actor = this.getActor(userInfo);
      const [list, displayNameByOpenid, babyInfo] = await Promise.all([
        GrowthDiaryModel.listByBaby(babyUid),
        this.loadFamilyDisplayNameMap(babyUid),
        getBabyInfo().catch(() => null)
      ]);
      const birthday = babyInfo?.birthday || '';

      // 当前用户有角色时补进映射，覆盖未落库署名的旧日记
      if (actor.openid && actor.authorDisplayName) {
        displayNameByOpenid[actor.openid] = actor.authorDisplayName;
      }

      const previewFileIds = [];
      list.forEach((entry) => {
        const media = normalizeMedia(entry.media, entry.photos).slice(0, MAX_DIARY_MEDIA);
        listPreviewFileIds(media).forEach((id) => previewFileIds.push(id));
      });

      const urlMap = await resolveCloudTempUrls(previewFileIds);

      const entries = list.map((entry) => {
        const media = normalizeMedia(entry.media, entry.photos).slice(0, MAX_DIARY_MEDIA);
        const mediaThumbs = media
          .map((item) => {
            const url = item.type === 'video'
              ? (urlMap.get(item.coverFileId) || '')
              : (urlMap.get(item.thumbFileId) || '');
            if (!url) return null;
            return {
              url,
              isVideo: item.type === 'video',
              originalFileId: item.type === 'image' ? item.originalFileId : ''
            };
          })
          .filter(Boolean);
        return {
          ...entry,
          canEdit: canEditDiaryEntry(entry, actor),
          eventDateText: formatDateText(entry.eventDate),
          eventAgeText: formatDiaryEventAgeText(entry.eventDate, birthday),
          mediaThumbs,
          thumbUrls: mediaThumbs.map((item) => item.url),
          originalFileIds: media
            .filter((item) => item.type === 'image')
            .map((item) => item.originalFileId)
            .filter(Boolean),
          publishMetaText: formatDiaryPublishMeta(entry, { displayNameByOpenid })
        };
      });

      this.setData({ entries, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载成长日记失败' });
    }
  },

  async openCreateForm() {
    const ready = await this.ensureAuthorRole({ action: 'create' });
    if (!ready) return;
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

    const media = normalizeMedia(entry.media, entry.photos).slice(0, MAX_DIARY_MEDIA);
    const previewIds = listPreviewFileIds(media);
    const urlMap = await resolveCloudTempUrls(previewIds);

    this.setData({
      showForm: true,
      editingId: id,
      form: createEmptyForm({
        title: entry.title || '',
        eventDate: formatDateText(entry.eventDate) || getTodayDateKey(),
        notes: entry.notes || '',
        media: media.map((item, index) => {
          const previewUrl = item.type === 'video'
            ? (urlMap.get(item.coverFileId) || '')
            : (urlMap.get(item.thumbFileId) || '');
          return makeCloudMedia(item, previewUrl, index);
        })
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

  closeRoleModal() {
    // 进页拦截：未设置角色则返回上一页
    if (!hasAuthorDisplayName(this.data.authorDisplayName)) {
      wx.navigateBack({
        fail: () => {
          this.setData({
            showRoleModal: false,
            roleGateAction: '',
            roleDraft: '',
            selectedRolePreset: ''
          });
        }
      });
      return;
    }
    this.setData({
      showRoleModal: false,
      roleGateAction: '',
      roleDraft: '',
      selectedRolePreset: ''
    });
  },

  onSelectRolePreset(e) {
    const role = e.currentTarget.dataset.role || '';
    this.setData({
      selectedRolePreset: role,
      roleDraft: role
    });
  },

  onRoleDraftInput(e) {
    const value = String(e.detail.value || '').slice(0, MAX_AUTHOR_ROLE_LEN);
    const matched = DIARY_ROLE_PRESETS.includes(value) ? value : '';
    this.setData({
      roleDraft: value,
      selectedRolePreset: matched
    });
  },

  async confirmRoleModal() {
    const validation = validateAuthorDisplayName(this.data.roleDraft);
    if (!validation.isValid) {
      wx.showToast({ title: validation.errors[0] || '请填写角色', icon: 'none' });
      return;
    }

    const displayName = validation.normalized;
    const babyUid = getBabyUid();
    const userRole = this.data.userRole
      || getApp().globalData.userRole
      || wx.getStorageSync('user_role')
      || '';
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    const collectionName = this.getRelationCollectionName(userRole);

    if (!babyUid || !openid || !collectionName) {
      wx.showToast({ title: '当前未绑定宝宝记录', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '保存角色...', mask: true });
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

      const cacheKey = this.displayNameCacheKey(babyUid, userRole);
      if (cacheKey) wx.setStorageSync(cacheKey, displayName);

      const shouldOpenCreate = this.data.roleGateAction === 'create';
      this.setData({
        authorDisplayName: displayName,
        showRoleModal: false,
        roleGateAction: '',
        roleDraft: '',
        selectedRolePreset: '',
        showForm: shouldOpenCreate,
        editingId: shouldOpenCreate ? '' : this.data.editingId,
        form: shouldOpenCreate ? createEmptyForm() : this.data.form
      });
      wx.hideLoading();
      wx.showToast({ title: '角色已设置', icon: 'success' });
      if (!shouldOpenCreate) {
        await this.loadEntries();
      }
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '保存角色失败' });
    }
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

  async pickMedia() {
    const current = this.data.form.media || [];
    const remain = MAX_DIARY_MEDIA - current.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_DIARY_MEDIA} 个媒体`, icon: 'none' });
      return;
    }

    const hasVideo = countFormVideos(current) >= MAX_DIARY_VIDEOS;
    const mediaType = hasVideo ? ['image'] : ['image', 'video'];

    try {
      let nextMedia = [...current];

      if (typeof wx.chooseMedia === 'function') {
        const res = await wx.chooseMedia({
          count: remain,
          mediaType,
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          maxDuration: MAX_VIDEO_DURATION_SEC
        });
        const files = (res.tempFiles || []).slice(0, remain);
        for (const file of files) {
          if (nextMedia.length >= MAX_DIARY_MEDIA) break;
          const fileType = String(file.fileType || '').toLowerCase();
          const isVideo = fileType === 'video';
          if (isVideo) {
            if (countFormVideos(nextMedia) >= MAX_DIARY_VIDEOS) {
              wx.showToast({ title: `每条日记最多 ${MAX_DIARY_VIDEOS} 个视频`, icon: 'none' });
              continue;
            }
            const localVideo = makeLocalVideo(file, nextMedia.length);
            const check = validateDiaryVideoLocal({
              durationSec: localVideo.durationSec,
              sizeBytes: localVideo.sizeBytes,
              coverLocalPath: localVideo.coverLocalPath
            });
            if (!check.ok) {
              wx.showToast({ title: check.message || '视频不符合要求', icon: 'none' });
              continue;
            }
            nextMedia.push(localVideo);
          } else if (file.tempFilePath) {
            nextMedia.push(makeLocalImage(file.tempFilePath, nextMedia.length));
          }
        }
      } else {
        const res = await wx.chooseImage({
          count: remain,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera']
        });
        (res.tempFilePaths || []).slice(0, remain).forEach((path, index) => {
          nextMedia.push(makeLocalImage(path, nextMedia.length + index));
        });
      }

      this.setData({ 'form.media': nextMedia.slice(0, MAX_DIARY_MEDIA) });
    } catch (error) {
      if (error && /cancel/i.test(error.errMsg || '')) return;
      handleError(error, { title: '选择媒体失败' });
    }
  },

  removeFormMedia(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const media = [...(this.data.form.media || [])];
    media.splice(index, 1);
    this.setData({ 'form.media': media });
  },

  async uploadFormMedia(babyUid, entryKey) {
    const media = this.data.form.media || [];
    const uploaded = [];
    const ts = Date.now();

    for (let i = 0; i < media.length; i += 1) {
      const item = media[i];
      if (item.type === 'video') {
        if (item.videoFileId && item.coverFileId && !item.localPath) {
          uploaded.push({
            type: 'video',
            videoFileId: item.videoFileId,
            coverFileId: item.coverFileId,
            durationSec: item.durationSec == null ? null : item.durationSec,
            sizeBytes: item.sizeBytes == null ? null : item.sizeBytes,
            width: item.width == null ? null : item.width,
            height: item.height == null ? null : item.height
          });
          continue;
        }
        if (!item.localPath || !item.coverLocalPath) {
          throw new Error(`第 ${i + 1} 个视频无效或缺少封面`);
        }
        wx.showLoading({ title: `上传视频 ${i + 1}/${media.length}`, mask: true });
        const result = await prepareAndUploadDiaryVideo({
          videoLocalPath: item.localPath,
          coverLocalPath: item.coverLocalPath,
          durationSec: item.durationSec,
          sizeBytes: item.sizeBytes,
          babyUid,
          entryKey,
          index: i,
          ts
        });
        uploaded.push({
          type: 'video',
          videoFileId: result.videoFileId,
          coverFileId: result.coverFileId,
          durationSec: result.durationSec,
          sizeBytes: result.sizeBytes,
          width: null,
          height: null
        });
        continue;
      }

      if (item.originalFileId && item.thumbFileId && !item.localPath) {
        uploaded.push({
          type: 'image',
          originalFileId: item.originalFileId,
          thumbFileId: item.thumbFileId,
          width: item.width == null ? null : item.width,
          height: item.height == null ? null : item.height
        });
        continue;
      }

      if (!item.localPath) {
        throw new Error(`第 ${i + 1} 张图片无效`);
      }

      wx.showLoading({ title: `上传图片 ${i + 1}/${media.length}`, mask: true });
      const result = await prepareAndUploadDiaryPhoto(item.localPath, {
        babyUid,
        entryKey,
        index: i,
        ts
      });
      uploaded.push({
        type: 'image',
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
    if ((form.media || []).length > MAX_DIARY_MEDIA) {
      wx.showToast({ title: `最多上传 ${MAX_DIARY_MEDIA} 个媒体`, icon: 'none' });
      return;
    }
    if (countFormVideos(form.media) > MAX_DIARY_VIDEOS) {
      wx.showToast({ title: `每条日记最多 ${MAX_DIARY_VIDEOS} 个视频`, icon: 'none' });
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

      await this.refreshAuthorDisplayName();
      const userInfo = await getUserInfo();
      const actor = this.getActor(userInfo);
      if (!hasAuthorDisplayName(actor.authorDisplayName)) {
        wx.hideLoading();
        this.setData({ saving: false });
        await this.ensureAuthorRole({ action: 'create' });
        return;
      }

      const entryKey = editingId || `tmp_${Date.now()}`;
      const media = await this.uploadFormMedia(babyUid, entryKey);
      const payload = {
        title,
        notes: String(form.notes || '').trim(),
        eventDate: form.eventDate,
        media,
        authorDisplayName: actor.authorDisplayName
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
    const isVideo = !!e.currentTarget.dataset.isVideo;
    if (isVideo) {
      this.goDetail(e);
      return;
    }

    const thumbCurrent = e.currentTarget.dataset.current;
    const entry = (this.data.entries || []).find((item) => item._id === entryId);
    const imageThumbs = (entry?.mediaThumbs || []).filter((item) => !item.isVideo);
    const thumbUrls = imageThumbs.map((item) => item.url).filter(Boolean);
    if (!thumbUrls.length) return;

    const openPreview = (urls) => {
      const currentIndex = Math.max(0, thumbUrls.indexOf(thumbCurrent));
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
