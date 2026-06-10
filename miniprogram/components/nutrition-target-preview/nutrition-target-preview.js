Component({
  properties: {
    preview: {
      type: Object,
      value: null
    },
    title: {
      type: String,
      value: '目标提醒'
    },
    subtitle: {
      type: String,
      value: '按保存后全天摄入预估'
    },
    showProtein: {
      type: Boolean,
      value: true
    },
    showCalorie: {
      type: Boolean,
      value: true
    },
    emptyText: {
      type: String,
      value: '设置体重和目标系数后，可查看保存后的目标状态'
    }
  },
  methods: {}
});
