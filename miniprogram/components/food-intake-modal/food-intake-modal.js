Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '添加食物记录'
    },
    step: {
      type: String,
      value: 'select'
    },
    searchQuery: {
      type: String,
      value: ''
    },
    categories: {
      type: Array,
      value: []
    },
    activeCategory: {
      type: String,
      value: ''
    },
    options: {
      type: Array,
      value: []
    },
    selectedFoodId: {
      type: String,
      value: ''
    },
    foodExperiment: {
      type: Object,
      value: {}
    },
    confirmDisabled: {
      type: Boolean,
      value: false
    },
    selectCancelText: {
      type: String,
      value: '取消'
    },
    selectConfirmText: {
      type: String,
      value: '确定'
    },
    formCancelText: {
      type: String,
      value: '上一步'
    },
    formConfirmText: {
      type: String,
      value: '保存'
    },
    timeLabel: {
      type: String,
      value: '时间'
    },
    nutritionLayout: {
      type: String,
      value: 'list'
    }
  },
  methods: {
    stopBubble() {},
    handleClose() {
      this.triggerEvent('close');
    },
    handleOpenFoodManage() {
      this.triggerEvent('openmanage');
    },
    handleSearchInput(e) {
      this.triggerEvent('searchinput', { value: e.detail.value });
    },
    handleCategoryTap(e) {
      const { category } = e.currentTarget.dataset;
      this.triggerEvent('categorytap', { category });
    },
    handleOptionTap(e) {
      const { id } = e.currentTarget.dataset;
      this.triggerEvent('optiontap', { id });
    },
    handleConfirmSelect() {
      this.triggerEvent('confirmselect');
    },
    handleBackToSelect() {
      this.triggerEvent('backtoselect');
    },
    handleQuantityInput(e) {
      this.triggerEvent('quantityinput', { value: e.detail.value });
    },
    handleNotesInput(e) {
      this.triggerEvent('notesinput', { value: e.detail.value });
    },
    handleRecordTimeChange(e) {
      this.triggerEvent('timechange', { value: e.detail.value });
    },
    handleFormCancel() {
      this.triggerEvent('formcancel');
    },
    handleFormSave() {
      this.triggerEvent('formsave');
    }
  }
});
