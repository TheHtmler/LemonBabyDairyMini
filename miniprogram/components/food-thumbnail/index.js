const { getFoodIllustration, isRemoteImage } = require('../../utils/foodIllustrations');
const { getCachedFoodImage, loadFoodImage, invalidateFoodImage } = require('../../utils/foodImageCache');

Component({
  properties: { food: { type: Object, value: {} } },
  data: { src: '', imageLabel: '食物图片', placeholderText: '', imageReady: false, loadingImage: false },
  observers: { food(value) { this.prepareImage(value || {}); } },
  lifetimes: {
    attached() { this._attached = true; this.prepareImage(this.properties.food || {}); },
    ready() {
      try {
        this._observer = this.createIntersectionObserver();
        this._observer.relativeToViewport({ top: 120, bottom: 120 }).observe('.food-thumbnail', result => {
          this._visible = result.intersectionRatio > 0;
          if (this._visible) this.loadImage();
        });
      } catch (error) {
        // 不支持可见性观察的运行环境只加载已渲染的少量卡片，不遍历整个目录。
        this._visible = true;
        this.loadImage();
      }
    },
    detached() {
      this._attached = false;
      this._epoch = (this._epoch || 0) + 1;
      if (this._observer) this._observer.disconnect();
    }
  },
  methods: {
    prepareImage(food) {
      const descriptor = getFoodIllustration(food);
      if (this._descriptor && this._descriptor.source === descriptor.source) {
        // 份量、选择状态等数据刷新时保留同一张已显示图片，避免重新加载闪烁。
        this._descriptor = descriptor;
        this.setData({ imageLabel: descriptor.label, placeholderText: descriptor.placeholderText });
        return;
      }
      this._epoch = (this._epoch || 0) + 1;
      this._descriptor = descriptor;
      this._loadingEpoch = 0;
      this._decodeRetries = 0;
      const remote = isRemoteImage(descriptor.source);
      const src = remote ? getCachedFoodImage(descriptor.source) : descriptor.source;
      this.setData({
        src,
        imageLabel: descriptor.label,
        placeholderText: descriptor.placeholderText,
        imageReady: false,
        loadingImage: !!descriptor.source
      });
      if (this._attached && this._visible) this.loadImage();
    },
    async loadImage() {
      const descriptor = this._descriptor;
      const epoch = this._epoch;
      if (!descriptor || !isRemoteImage(descriptor.source) || this._loadingEpoch === epoch) return;
      this._loadingEpoch = epoch;
      const isCurrent = () => this._attached && this._epoch === epoch;
      try {
        const src = await loadFoodImage(descriptor.source, { isActive: () => isCurrent() && this._visible });
        if (src && isCurrent() && src !== this.data.src) this.setData({ src, imageReady: false, loadingImage: true });
        else if (isCurrent() && !src) this._loadingEpoch = 0;
      } catch (error) {
        if (!isCurrent()) return;
        this._loadingEpoch = 0;
        if (!this.data.imageReady) this.setData({ src: descriptor.fallback, loadingImage: !!descriptor.fallback });
      }
    },
    onImageLoad(event) {
      if (event.currentTarget.dataset.src === this.data.src) this.setData({ imageReady: true, loadingImage: false });
    },
    onImageError(event) {
      if (event.currentTarget.dataset.src !== this.data.src) return;
      const remote = isRemoteImage(this._descriptor?.source);
      if (remote) invalidateFoodImage(this._descriptor.source);
      const retry = remote && this._decodeRetries < 1;
      if (retry) this._decodeRetries++;
      // 只自动重取一次，避免损坏的远程内容反复下载；离屏时等待再次可见。
      this._loadingEpoch = retry ? 0 : this._epoch;
      const next = this._descriptor?.fallback;
      const src = next && next !== this.data.src ? next : '';
      this.setData({ src, imageReady: false, loadingImage: !!src || retry });
      if (retry && this._attached && this._visible) this.loadImage();
    },
    async previewImage() {
      const epoch = this._epoch;
      let current = this.data.src;
      if (!this.data.imageReady || !current) return;
      const isCurrent = () => this._attached && this._epoch === epoch;
      if (isRemoteImage(this._descriptor?.source) && current !== this._descriptor.fallback) {
        try {
          // 图片可能已被容量淘汰；预览前重新确认文件仍可用。
          current = await loadFoodImage(this._descriptor.source, { isActive: isCurrent }) || current;
        } catch (error) {
          // 旧缓存可能已被淘汰，不能继续把失效路径交给预览接口。
          if (!isCurrent()) return;
          current = this._descriptor.fallback;
          this.setData({ src: current, imageReady: false, loadingImage: !!current });
          if (!current) wx.showToast({ title: '图片暂时无法加载', icon: 'none' });
        }
      }
      if (current && isCurrent()) wx.previewImage({ current, urls: [current] });
    }
  }
});
