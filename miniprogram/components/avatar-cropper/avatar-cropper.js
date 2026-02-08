Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    imageSrc: {
      type: String,
      value: ''
    },
    cropSize: {
      type: Number,
      value: 300
    }
  },
  data: {
    imgWidth: 0,
    imgHeight: 0,
    scale: 1,
    minScale: 1,
    offsetX: 0,
    offsetY: 0,
    lastX: 0,
    lastY: 0,
    lastDistance: 0,
    lastScale: 1,
    resolvedSrc: ''
  },
  observers: {
    imageSrc(src) {
      if (src) {
        this.initImage(src);
      }
    },
    visible(val) {
      if (val && this.properties.imageSrc) {
        this.initImage(this.properties.imageSrc);
      }
    }
  },
  methods: {
    stop() {},
    handleClose() {
      this.triggerEvent('close');
    },
    async initImage(src) {
      try {
        const resolvedSrc = await this.resolveSource(src);
        if (!resolvedSrc) {
          return;
        }
        const info = await wx.getImageInfo({ src: resolvedSrc });
        const imgWidth = info.width;
        const imgHeight = info.height;
        const cropSize = this.properties.cropSize;
        const minScale = Math.max(cropSize / imgWidth, cropSize / imgHeight);
        const scale = minScale;
        const offsetX = (cropSize - imgWidth * scale) / 2;
        const offsetY = (cropSize - imgHeight * scale) / 2;
        this.setData({
          imgWidth,
          imgHeight,
          scale,
          minScale,
          offsetX,
          offsetY,
          resolvedSrc
        });
        this.draw();
      } catch (error) {
        console.error('加载头像失败:', error);
      }
    },
    resolveSource(src) {
      if (!src) return Promise.resolve('');
      if (!/^data:image\/[a-zA-Z]+;base64,/.test(src)) {
        return Promise.resolve(src);
      }
      const match = src.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.*)$/);
      if (!match) return Promise.resolve('');
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const base64Data = match[2] || '';
      const buffer = wx.base64ToArrayBuffer(base64Data);
      const filePath = `${wx.env.USER_DATA_PATH}/avatar_crop_${Date.now()}.${ext}`;
      const fs = wx.getFileSystemManager();
      return new Promise((resolve) => {
        fs.writeFile({
          filePath,
          data: buffer,
          encoding: 'binary',
          success: () => resolve(filePath),
          fail: () => resolve('')
        });
      });
    },
    clampOffsets(offsetX, offsetY, scale) {
      const { cropSize } = this.properties;
      const { imgWidth, imgHeight } = this.data;
      const width = imgWidth * scale;
      const height = imgHeight * scale;
      const minX = cropSize - width;
      const minY = cropSize - height;
      const clampedX = Math.min(0, Math.max(minX, offsetX));
      const clampedY = Math.min(0, Math.max(minY, offsetY));
      return { offsetX: clampedX, offsetY: clampedY };
    },
    draw() {
      const ctx = wx.createCanvasContext('cropCanvas', this);
      const { cropSize } = this.properties;
      const { imgWidth, imgHeight, scale, offsetX, offsetY, resolvedSrc } = this.data;
      if (!resolvedSrc || !imgWidth || !imgHeight) return;
      ctx.clearRect(0, 0, cropSize, cropSize);
      ctx.drawImage(resolvedSrc, offsetX, offsetY, imgWidth * scale, imgHeight * scale);
      ctx.draw();
    },
    onTouchStart(e) {
      const touches = e.touches || [];
      if (touches.length === 1) {
        this.setData({
          lastX: touches[0].x,
          lastY: touches[0].y
        });
      } else if (touches.length >= 2) {
        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        this.setData({
          lastDistance: distance,
          lastScale: this.data.scale
        });
      }
    },
    onTouchMove(e) {
      const touches = e.touches || [];
      const { cropSize } = this.properties;
      if (touches.length === 1) {
        const dx = touches[0].x - this.data.lastX;
        const dy = touches[0].y - this.data.lastY;
        let offsetX = this.data.offsetX + dx;
        let offsetY = this.data.offsetY + dy;
        const clamped = this.clampOffsets(offsetX, offsetY, this.data.scale);
        this.setData({
          offsetX: clamped.offsetX,
          offsetY: clamped.offsetY,
          lastX: touches[0].x,
          lastY: touches[0].y
        });
        this.draw();
        return;
      }

      if (touches.length >= 2) {
        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!this.data.lastDistance) return;
        let scale = (distance / this.data.lastDistance) * this.data.lastScale;
        scale = Math.max(scale, this.data.minScale);
        const prevScale = this.data.scale;
        const scaleRatio = scale / prevScale;
        const centerX = (touches[0].x + touches[1].x) / 2;
        const centerY = (touches[0].y + touches[1].y) / 2;
        let offsetX = centerX - (centerX - this.data.offsetX) * scaleRatio;
        let offsetY = centerY - (centerY - this.data.offsetY) * scaleRatio;
        const clamped = this.clampOffsets(offsetX, offsetY, scale);
        this.setData({
          scale,
          offsetX: clamped.offsetX,
          offsetY: clamped.offsetY
        });
        this.draw();
      }
    },
    onTouchEnd() {
      this.setData({ lastDistance: 0 });
    },
    handleConfirm() {
      const { cropSize } = this.properties;
      wx.canvasToTempFilePath({
        canvasId: 'cropCanvas',
        width: cropSize,
        height: cropSize,
        destWidth: cropSize,
        destHeight: cropSize,
        success: (res) => {
          this.triggerEvent('confirm', { tempFilePath: res.tempFilePath });
        },
        fail: (err) => {
          console.error('裁剪失败:', err);
          wx.showToast({ title: '裁剪失败', icon: 'none' });
        }
      }, this);
    }
  }
});
