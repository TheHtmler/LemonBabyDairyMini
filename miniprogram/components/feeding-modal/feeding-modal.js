Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: '添加喂奶记录'
    },
    feedingData: {
      type: Object,
      value: {}
    },
    showGoalHint: {
      type: Boolean,
      value: false
    },
    quickGoalTarget: {
      type: String,
      value: 'protein'
    },
    quickGoalSuggestion: {
      type: Object,
      value: {}
    },
    naturalProteinCoefficientInput: {
      type: String,
      value: ''
    },
    specialProteinCoefficientInput: {
      type: String,
      value: ''
    },
    calorieCoefficientInput: {
      type: String,
      value: ''
    },
    confirmText: {
      type: String,
      value: '确认记录'
    },
    cancelText: {
      type: String,
      value: '取消'
    }
  },
  methods: {
    stopBubble() {},
    handleClose() {
      this.triggerEvent('close');
    },
    handleConfirm() {
      this.triggerEvent('confirm');
    },
    handleTimeChange(e) {
      this.triggerEvent('timechange', { value: e.detail.value });
    },
    handleInputChange(e) {
      const { field } = e.currentTarget.dataset;
      this.triggerEvent('inputchange', {
        field,
        value: e.detail.value
      });
    },
    handleAdjust(e) {
      const { field, action } = e.currentTarget.dataset;
      this.triggerEvent('adjust', { field, action });
    },
    handleMilkTypeChange(e) {
      const { type } = e.currentTarget.dataset;
      this.triggerEvent('typechange', { type });
    },
    handleGoalTargetChange(e) {
      const { mode } = e.currentTarget.dataset;
      this.triggerEvent('goaltarget', { mode });
    },
    handleCoefficientInput(e) {
      const { field } = e.currentTarget.dataset;
      this.triggerEvent('coefficient', {
        field,
        value: e.detail.value
      });
    }
  }
});
