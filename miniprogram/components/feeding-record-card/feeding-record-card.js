Component({
  properties: {
    record: {
      type: Object,
      value: {}
    },
    index: {
      type: Number,
      value: -1
    },
    recordId: {
      type: String,
      value: ''
    },
    showLabel: {
      type: Boolean,
      value: false
    },
    showActions: {
      type: Boolean,
      value: true
    },
    showEdit: {
      type: Boolean,
      value: true
    },
    showDelete: {
      type: Boolean,
      value: true
    }
  },
  methods: {
    handleRecordTap() {
      this.triggerEvent('recordtap', { index: this.data.index, id: this.data.recordId });
    },
    handleEdit() {
      this.triggerEvent('edit', { index: this.data.index, id: this.data.recordId });
    },
    handleDelete() {
      this.triggerEvent('delete', { index: this.data.index, id: this.data.recordId });
    }
  }
});
