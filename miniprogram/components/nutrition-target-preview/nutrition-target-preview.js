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
    },
    emptyTitle: {
      type: String,
      value: '还没有设置蛋白目标'
    },
    setupText: {
      type: String,
      value: '去设置目标'
    },
    actionText: {
      type: String,
      value: '修改目标'
    },
    showSetupAction: {
      type: Boolean,
      value: true
    },
    setupMode: {
      type: String,
      value: ''
    }
  },
  data: {
    settingsModalVisible: false,
    settingsModalMode: 'protein'
  },
  methods: {
    resolveSetupMode() {
      if (this.data.setupMode === 'protein' || this.data.setupMode === 'calorie') {
        return this.data.setupMode;
      }
      return !this.data.showProtein && this.data.showCalorie ? 'calorie' : 'protein';
    },

    handleSetupTap() {
      this.setData({
        settingsModalVisible: true,
        settingsModalMode: this.resolveSetupMode()
      });
    },

    closeSettingsModal() {
      this.setData({ settingsModalVisible: false });
    },

    handleSettingsSaved(e) {
      this.triggerEvent('targetssaved', e.detail || {});
    }
  }
});
