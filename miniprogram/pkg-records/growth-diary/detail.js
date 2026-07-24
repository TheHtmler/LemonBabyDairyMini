const GrowthDiaryModel = require('../../models/growthDiary');
const {
  waitForAppInitialization,
  getBabyUid,
  getBabyInfo,
  handleError
} = require('../../utils/index');
const {
  MAX_DIARY_MEDIA,
  normalizeMedia,
  formatDiaryPublishMeta,
  normalizeEventDateKey,
  formatDiaryEventAgeText
} = require('../../utils/growthDiaryUtils');
const { resolveCloudTempUrls } = require('../../utils/cloudTempUrlCache');

function formatDateText(dateValue) {
  return normalizeEventDateKey(dateValue);
}

Page({
  data: {
    loading: true,
    visible: false,
    emptyTitle: '',
    emptySubtitle: '',
    babyName: '柠檬宝宝',
    entry: null,
    eventDateText: '',
    eventAgeText: '',
    thumbUrls: [],
    originalUrls: [],
    imageItems: [],
    videoUrl: '',
    videoPoster: '',
    publishMetaText: ''
  },

  async onLoad(options = {}) {
    const id = String(options.id || '').trim();
    try {
      await waitForAppInitialization();
      await this.loadDetail(id);
    } catch (error) {
      this.setData({
        loading: false,
        visible: false,
        emptyTitle: '无权限访问',
        emptySubtitle: '加载失败，请稍后重试。'
      });
      handleError(error, { title: '加载日记详情失败' });
    }
  },

  async loadDetail(id) {
    this.setData({ loading: true });

    if (!id) {
      this.showDenied('无权限访问', '缺少日记信息，无法查看。');
      return;
    }

    const babyUid = getBabyUid();
    const userRole = getApp().globalData.userRole || wx.getStorageSync('user_role') || '';
    const openid = getApp().globalData.openid || wx.getStorageSync('openid') || '';
    const entry = await GrowthDiaryModel.getById(id);

    if (!openid) {
      this.showDenied('无权限访问', '请先登录微信后再查看。');
      return;
    }

    if (!entry) {
      this.showDenied('无权限访问', '日记不存在或无权查看。');
      return;
    }

    if (entry.status !== 'active') {
      this.showDenied('内容已删除', '这篇成长日记已删除，无法继续查看。');
      return;
    }

    // 非家庭成员 / 未绑定：直接无权限兜底，不进入角色设置
    if (!babyUid || (userRole !== 'creator' && userRole !== 'participant') || entry.babyUid !== babyUid) {
      this.showDenied('无权限访问', '你还不是该家庭成员，无法查看这篇成长日记。');
      return;
    }

    const hasRelation = await this.hasFamilyRelation(openid, babyUid, userRole);
    if (!hasRelation) {
      this.showDenied('无权限访问', '你还不是该家庭成员，无法查看这篇成长日记。');
      return;
    }

    const media = normalizeMedia(entry.media, entry.photos).slice(0, MAX_DIARY_MEDIA);
    const images = media.filter((item) => item.type === 'image');
    const video = media.find((item) => item.type === 'video') || null;
    const thumbFileIds = images.map((p) => p.thumbFileId).filter(Boolean);
    const originalFileIds = images.map((p) => p.originalFileId).filter(Boolean);
    const coverFileId = video?.coverFileId || '';
    const videoFileId = video?.videoFileId || '';
    const urlMap = await resolveCloudTempUrls([
      ...thumbFileIds,
      ...originalFileIds,
      coverFileId,
      videoFileId
    ].filter(Boolean));

    const thumbUrls = images
      .map((photo) => urlMap.get(photo.thumbFileId) || '')
      .filter(Boolean);
    const originalUrls = images
      .map((photo) => urlMap.get(photo.originalFileId) || urlMap.get(photo.thumbFileId) || '')
      .filter(Boolean);
    const videoUrl = videoFileId ? (urlMap.get(videoFileId) || '') : '';
    const videoPoster = coverFileId
      ? (urlMap.get(coverFileId) || '')
      : '';

    let babyName = '柠檬宝宝';
    let birthday = '';
    try {
      const babyInfo = await getBabyInfo();
      babyName = (babyInfo && (babyInfo.name || babyInfo.babyName)) || babyName;
      birthday = (babyInfo && babyInfo.birthday) || '';
    } catch (error) {
      // keep fallback name
    }

    let displayNameByOpenid = {};
    try {
      const db = wx.cloud.database();
      const [creatorsRes, participantsRes] = await Promise.all([
        db.collection('baby_creators').where({ babyUid: entry.babyUid }).limit(20).get(),
        db.collection('baby_participants').where({ babyUid: entry.babyUid }).limit(50).get()
      ]);
      [...(creatorsRes.data || []), ...(participantsRes.data || [])].forEach((row) => {
        const openid = String(row._openid || '').trim();
        const name = String(row.displayName || '').trim().slice(0, 5);
        if (openid && name) displayNameByOpenid[openid] = name;
      });
    } catch (error) {
      // ignore map failures
    }

    this.setData({
      loading: false,
      visible: true,
      emptyTitle: '',
      emptySubtitle: '',
      babyName,
      entry,
      eventDateText: formatDateText(entry.eventDate),
      eventAgeText: formatDiaryEventAgeText(entry.eventDate, birthday),
      thumbUrls,
      originalUrls,
      imageItems: images,
      videoUrl,
      videoPoster,
      publishMetaText: formatDiaryPublishMeta(entry, { displayNameByOpenid })
    });

    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  async hasFamilyRelation(openid, babyUid, userRole) {
    const collectionName = userRole === 'creator'
      ? 'baby_creators'
      : (userRole === 'participant' ? 'baby_participants' : '');
    if (!collectionName || !openid || !babyUid) return false;
    try {
      const db = wx.cloud.database();
      const res = await db.collection(collectionName).where({
        _openid: openid,
        babyUid
      }).limit(1).get();
      return !!(res.data && res.data[0]);
    } catch (error) {
      return false;
    }
  },

  showDenied(emptyTitle, emptySubtitle) {
    this.setData({
      loading: false,
      visible: false,
      emptyTitle,
      emptySubtitle,
      entry: null,
      thumbUrls: [],
      originalUrls: [],
      imageItems: [],
      videoUrl: '',
      videoPoster: ''
    });
  },

  onVideoError() {
    wx.showToast({ title: '视频暂时无法播放', icon: 'none' });
  },

  async previewPhotos(e) {
    const index = Number(e.currentTarget.dataset.index);
    let urls = this.data.originalUrls || [];

    if (!urls.length) {
      const images = (this.data.imageItems || []).length
        ? this.data.imageItems
        : normalizeMedia(this.data.entry?.media, this.data.entry?.photos)
          .filter((item) => item.type === 'image')
          .slice(0, MAX_DIARY_MEDIA);
      const originalFileIds = images.map((p) => p.originalFileId).filter(Boolean);
      if (originalFileIds.length) {
        const urlMap = await resolveCloudTempUrls(originalFileIds);
        urls = images
          .map((photo) => urlMap.get(photo.originalFileId) || '')
          .filter(Boolean);
        this.setData({ originalUrls: urls });
      }
    }

    if (!urls.length && this.data.thumbUrls.length) {
      urls = this.data.thumbUrls;
    }
    if (!urls.length) return;

    const current = Number.isNaN(index) ? urls[0] : urls[index] || urls[0];
    wx.previewImage({
      current,
      urls
    });
  },

  onShareAppMessage() {
    const entry = this.data.entry;
    if (!this.data.visible || !entry || !entry._id) {
      return {
        title: '成长日记',
        path: '/pkg-records/growth-diary/index'
      };
    }

    const babyName = this.data.babyName || '柠檬宝宝';
    return {
      title: `${babyName} · ${entry.title}`,
      path: `/pkg-records/growth-diary/detail?id=${entry._id}`
    };
  },

  onShareTimeline() {
    const entry = this.data.entry;
    if (!this.data.visible || !entry || !entry._id) {
      return {
        title: '成长日记',
        query: ''
      };
    }
    const babyName = this.data.babyName || '柠檬宝宝';
    return {
      title: `${babyName} · ${entry.title}`,
      query: `id=${entry._id}`
    };
  }
});
