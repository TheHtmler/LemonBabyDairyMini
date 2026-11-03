Component({
  properties: { disabled: Boolean },
  data: { open: false, positioned: false, left: 0, top: 0, width: 288, maxHeight: 300, arrowLeft: 24, placement: 'below' },
  observers: { disabled(value) { if (value) this.close(); } },
  lifetimes: { detached() { this._epoch = (this._epoch || 0) + 1; } },
  pageLifetimes: { hide() { this.close(); }, resize() { this.close(); } },
  methods: {
    toggle() {
      if (this.data.open) { this.close(); return; }
      if (this.properties.disabled) return;
      const epoch = this._epoch = (this._epoch || 0) + 1;
      wx.createSelectorQuery().in(this).select('.protein-help-trigger').boundingClientRect().exec(results => {
        const anchor = results && results[0];
        if (!anchor || epoch !== this._epoch || this.properties.disabled) return;
        const windowInfo = wx.getWindowInfo();
        const edge = 12;
        const width = Math.min(288, windowInfo.windowWidth - edge * 2);
        const left = Math.max(edge, Math.min(anchor.right - width, windowInfo.windowWidth - width - edge));
        this.setData({ open: true, positioned: false, left, top: edge, width,
          maxHeight: windowInfo.windowHeight - edge * 2 }, () => {
          // 浮层挂到页面根节点后再测量，避免弹窗transform与滚动区裁切影响定位。
          wx.nextTick(() => {
            if (epoch !== this._epoch || !this.data.open) return;
            wx.createSelectorQuery().in(this).select('.protein-help-popover').boundingClientRect().exec(rects => {
              if (epoch !== this._epoch || !this.data.open) return;
              const height = Math.min(rects && rects[0] && rects[0].height || 180, windowInfo.windowHeight - edge * 2);
              const below = windowInfo.windowHeight - anchor.bottom - edge;
              const placement = below >= height + 8 || below >= anchor.top - edge ? 'below' : 'above';
              const preferredTop = placement === 'below' ? anchor.bottom + 8 : anchor.top - height - 8;
              const top = Math.max(edge, Math.min(preferredTop, windowInfo.windowHeight - height - edge));
              const arrowLeft = Math.max(20, Math.min((anchor.left + anchor.right) / 2 - left, width - 20));
              this.setData({ top, arrowLeft, placement, positioned: true });
            });
          });
        });
      });
    },
    close() { this._epoch = (this._epoch || 0) + 1; if (this.data.open) this.setData({ open: false, positioned: false }); },
    stopEvent() {}
  }
});
