Page({
  data: {
    slides: [
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/01_角色与建档.png', title: '角色与建档', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/02_奶粉设置.png', title: '奶粉设置', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/03_喂奶记录.png', title: '喂奶记录', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/04_添加食物.png', title: '添加食物', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/05_用药管理.png', title: '用药管理', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/06_数据记录.png', title: '数据记录', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/07_趋势分析.png', title: '趋势分析', src: '' },
      { fileId: 'cloud://prod-7g5lap9xcf106dbf.7072-prod-7g5lap9xcf106dbf-1354414001/onboard/08_报告与分享.png', title: '报告与分享', src: '' }
    ],
    scales: [1, 1, 1, 1, 1, 1, 1, 1]
  },
  onLoad() {
    this.resolveSlideUrls();
  },
  async resolveSlideUrls() {
    try {
      const app = getApp();
      const fileList = this.data.slides.map(item => ({
        fileID: item.fileId,
        maxAge: 86400
      }));
      const res = await wx.cloud.getTempFileURL({
        fileList,
        config: { env: app.globalData.cloudEnvId }
      });
      const urlMap = new Map();
      (res.fileList || []).forEach(item => {
        urlMap.set(item.fileID, item.tempFileURL || item.fileID);
      });
      const slides = this.data.slides.map(item => ({
        ...item,
        src: urlMap.get(item.fileId) || item.fileId
      }));
      this.setData({ slides });
    } catch (error) {
      console.error('获取引导图链接失败:', error);
      const slides = this.data.slides.map(item => ({
        ...item,
        src: item.fileId
      }));
      this.setData({ slides });
    }
  },
  onSlideChange(e) {
    const idx = e.detail.current || 0;
    this.resetScale(idx);
  },
  onScale(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const scale = e.detail.scale;
    if (!Number.isFinite(idx)) return;
    const scales = this.data.scales.slice();
    scales[idx] = scale;
    this.setData({ scales });
  },
  onImageTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const now = Date.now();
    if (!this._lastTapTime || this._lastTapIndex !== idx) {
      this._lastTapTime = now;
      this._lastTapIndex = idx;
      return;
    }
    const delta = now - this._lastTapTime;
    this._lastTapTime = now;
    this._lastTapIndex = idx;
    if (delta > 300) return;
    const scales = this.data.scales.slice();
    const current = scales[idx] || 1;
    scales[idx] = current > 1 ? 1 : 2;
    this.setData({ scales });
  },
  resetScale(activeIndex) {
    const scales = this.data.scales.slice();
    for (let i = 0; i < scales.length; i += 1) {
      if (i === activeIndex) {
        if (!scales[i] || scales[i] < 1) scales[i] = 1;
      } else {
        scales[i] = 1;
      }
    }
    this.setData({ scales });
  }
});
