const { getCachedUrl, invalidateCloudTempUrl, resolveCloudTempUrls } = require('../../../utils/cloudTempUrlCache');

const pendingCovers = new Map();

function loadCoverUrl(fileId) {
  const cached = getCachedUrl(fileId);
  if (cached) return Promise.resolve(cached);
  return new Promise(resolve => {
    if (!pendingCovers.size) {
      // 同次列表渲染共享一批临时链接请求。
      Promise.resolve().then(async () => {
        const batch = new Map(pendingCovers);
        pendingCovers.clear();
        const urls = await resolveCloudTempUrls([...batch.keys()]);
        batch.forEach((callbacks, id) => callbacks.forEach(callback => callback(urls.get(id) || '')));
      });
    }
    const callbacks = pendingCovers.get(fileId) || [];
    callbacks.push(resolve);
    pendingCovers.set(fileId, callbacks);
  });
}

Component({
  properties: {
    name: { type: String, value: '' },
    fileId: { type: String, value: '' },
    localPath: { type: String, value: '' },
    large: { type: Boolean, value: false },
    previewable: { type: Boolean, value: false }
  },
  data: { initial: '菜', imageSrc: '', imageReady: false },
  observers: {
    name(name) {
      this.setData({ initial: Array.from(String(name || '').trim())[0] || '菜' });
    },
    'fileId, localPath'(fileId, localPath) {
      const request = {};
      this._coverRequest = request;
      this._coverRetried = false;
      // 上传完成仅补上文件 ID 时，保留已加载的本地预览。
      if (localPath && localPath === this.data.imageSrc) return;
      this.setData({ imageSrc: localPath || '', imageReady: false });
      if (!localPath) this.resolveCover(fileId, request);
    }
  },
  lifetimes: {
    detached() { this._coverRequest = null; }
  },
  methods: {
    async resolveCover(fileId, request) {
      if (typeof fileId !== 'string' || !fileId.startsWith('cloud://')) return;
      const imageSrc = await loadCoverUrl(fileId);
      if (this._coverRequest === request) this.setData({ imageSrc, imageReady: false });
    },
    onImageLoad(e) {
      if (e.currentTarget.dataset.src === this.data.imageSrc) this.setData({ imageReady: true });
    },
    onImageError(e) {
      const src = e.currentTarget.dataset.src;
      if (src !== this.data.imageSrc || !this._coverRequest) return;
      this.setData({ imageSrc: '', imageReady: false });
      const { fileId, localPath } = this.properties;
      if (this._coverRetried || !fileId) return;
      this._coverRetried = true;
      // 本地预览失效可回读云端，临时链接失效时重新获取一次。
      if (src !== localPath) invalidateCloudTempUrl(fileId);
      this.resolveCover(fileId, this._coverRequest);
    },
    onPreview() {
      const { imageSrc, imageReady } = this.data;
      if (!this.properties.previewable || !imageSrc || !imageReady) return;
      wx.previewImage({ current: imageSrc, urls: [imageSrc] });
    }
  }
});
