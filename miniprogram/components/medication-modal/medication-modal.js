Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: ''
    },
    medications: {
      type: Array,
      value: []
    },
    selectedMedicationIndex: {
      type: Number,
      value: 0
    },
    selectedMedicationName: {
      type: String,
      value: ''
    },
    showMedicationPicker: {
      type: Boolean,
      value: true
    },
    dosage: {
      type: String,
      value: ''
    },
    unit: {
      type: String,
      value: ''
    },
    time: {
      type: String,
      value: ''
    },
    frequency: {
      type: String,
      value: ''
    },
    notes: {
      type: String,
      value: ''
    },
    confirmText: {
      type: String,
      value: '保存'
    },
    cancelText: {
      type: String,
      value: '取消'
    }
  },
  methods: {
    handleMaskTap() {
      this.triggerEvent('close');
    },
    stop() {},
    handleMedicationChange(e) {
      const index = Number(e.detail.value) || 0;
      this.triggerEvent('medicationchange', { value: index });
    },
    handleDosageInput(e) {
      this.triggerEvent('dosagechange', { value: e.detail.value, field: 'dosage' });
    },
    handleNotesInput(e) {
      this.triggerEvent('noteschange', { value: e.detail.value, field: 'notes' });
    },
    handleTimeChange(e) {
      this.triggerEvent('timechange', { value: e.detail.value, field: 'time' });
    },
    handleCancel() {
      this.triggerEvent('close');
    },
    handleConfirm() {
      this.triggerEvent('confirm');
    }
  }
});
