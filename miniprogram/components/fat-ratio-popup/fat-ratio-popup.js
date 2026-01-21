Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '脂肪供能占比参考'
    },
    lines: {
      type: Array,
      value: []
    },
    confirmText: {
      type: String,
      value: '知道了'
    }
  },
  methods: {
    stopBubble() {},
    handleClose() {
      this.triggerEvent('close');
    }
  }
});
