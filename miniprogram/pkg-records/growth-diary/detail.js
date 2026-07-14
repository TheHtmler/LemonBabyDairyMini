const GrowthDiaryModel = require('../../models/growthDiary');
const {
  waitForAppInitialization,
  getBabyUid,
  getBabyInfo,
  handleError
} = require('../../utils/index');
const {
  MAX_DIARY_PHOTOS,
  normalizePhotos,
  formatDiaryPublishMeta
} = require('../../utils/growthDiaryUtils');
const { resolveCloudTempUrls } = require('../../utils/cloudTempUrlCache');

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

Page({
  data: {
    loading: true,
    visible: false,
    emptyTitle: '',
    emptySubtitle: '',
    babyName: '柠檬宝宝',
    entry: null,
    eventDateText: '',
    thumbUrls: [],
    originalUrls: [],
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
    const entry = await GrowthDiaryModel.getById(id);

    if (!entry) {
      this.showDenied('无权限访问', '日记不存在或无权查看。');
      return;
    }

    if (entry.status !== 'active') {
      this.showDenied('内容已删除', '这篇成长日记已删除，无法继续查看。');
      return;
    }

    if (!babyUid || entry.babyUid !== babyUid) {
      this.showDenied('无权限访问', '该日记不属于当前宝宝，请确认已加入对应家庭。');
      return;
    }

    const photos = normalizePhotos(entry.photos).slice(0, MAX_DIARY_PHOTOS);
    const thumbFileIds = photos.map((p) => p.thumbFileId).filter(Boolean);
    const originalFileIds = photos.map((p) => p.originalFileId).filter(Boolean);
    const urlMap = await resolveCloudTempUrls([...thumbFileIds, ...originalFileIds]);

    const thumbUrls = photos
      .map((photo) => urlMap.get(photo.thumbFileId) || '')
      .filter(Boolean);
    const originalUrls = photos
      .map((photo) => urlMap.get(photo.originalFileId) || urlMap.get(photo.thumbFileId) || '')
      .filter(Boolean);

    let babyName = '柠檬宝宝';
    try {
      const babyInfo = await getBabyInfo();
      babyName = (babyInfo && (babyInfo.name || babyInfo.babyName)) || babyName;
    } catch (error) {
      // keep fallback name
    }

    this.setData({
      loading: false,
      visible: true,
      emptyTitle: '',
      emptySubtitle: '',
      babyName,
      entry,
      eventDateText: formatDateText(entry.eventDate),
      thumbUrls,
      originalUrls,
      publishMetaText: formatDiaryPublishMeta(entry)
    });

    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
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
      originalUrls: []
    });
  },

  async previewPhotos(e) {
    const index = Number(e.currentTarget.dataset.index);
    let urls = this.data.originalUrls || [];

    if (!urls.length) {
      const photos = normalizePhotos(this.data.entry?.photos).slice(0, MAX_DIARY_PHOTOS);
      const originalFileIds = photos.map((p) => p.originalFileId).filter(Boolean);
      if (originalFileIds.length) {
        const urlMap = await resolveCloudTempUrls(originalFileIds);
        urls = photos
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
