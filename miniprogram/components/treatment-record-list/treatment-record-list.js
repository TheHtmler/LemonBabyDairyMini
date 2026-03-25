Component({
  properties: {
    title: {
      type: String,
      value: '治疗记录'
    },
    actionText: {
      type: String,
      value: '新增'
    },
    records: {
      type: Array,
      value: []
    },
    emptyText: {
      type: String,
      value: '暂无治疗记录'
    }
  },

  methods: {
    handleAdd() {
      this.triggerEvent('add');
    },

    handleEdit(e) {
      this.triggerEvent('edit', {
        recordId: e.currentTarget.dataset.recordId
      });
    },

    handleDelete(e) {
      this.triggerEvent('delete', {
        recordId: e.currentTarget.dataset.recordId
      });
    }
  }
});
