Page({
  data: {
    supportCards: [
      {
        id: 'emergency-card',
        title: '急救卡',
        description: '查看固定急救信息，便于就诊时快速展示给医生。',
        status: '可查看'
      }
    ],
    concentrationPresets: [
      { label: '5%', value: '5' },
      { label: '10%', value: '10' },
      { label: '12.5%', value: '12.5' },
      { label: '20%', value: '20' }
    ],
    concentrationReference: [
      { label: 'D5', concentration: '5%', kcalPerMl: '0.17', note: '100 mL 约 17 kcal' },
      { label: 'D10', concentration: '10%', kcalPerMl: '0.34', note: '100 mL 约 34 kcal' },
      { label: 'D12.5', concentration: '12.5%', kcalPerMl: '0.425', note: '100 mL 约 42.5 kcal' },
      { label: 'D20', concentration: '20%', kcalPerMl: '0.68', note: '100 mL 约 68 kcal' }
    ],
    calculationExamples: [
      {
        title: '例 1',
        description: 'D10 500 mL',
        result: '葡萄糖 50 g，约 170 kcal'
      },
      {
        title: '例 2',
        description: '10 kg，D10 40 mL/h',
        result: 'GIR 约 6.67 mg/kg/min'
      }
    ],
    selectedPreset: '10',
    calculatorForm: {
      weight: '',
      concentration: '10',
      volume: '',
      rate: ''
    },
    calculatorResult: {
      dextroseGrams: 0,
      totalCalories: 0,
      kcalPerKg: 0,
      kcalPerMl: 0,
      gir: 0
    }
  },

  handleCardTap(e) {
    const { id = '' } = e.currentTarget.dataset || {};
    if (id === 'emergency-card') {
      wx.navigateTo({
        url: '/pages/emergency-card/index'
      });
      return;
    }

    wx.showToast({
      title: '下一步继续完善',
      icon: 'none'
    });
  },

  onWeightInput(e) {
    this.updateCalculatorField('weight', e.detail.value || '');
  },

  onConcentrationInput(e) {
    this.setData({ selectedPreset: '' });
    this.updateCalculatorField('concentration', e.detail.value || '');
  },

  onVolumeInput(e) {
    this.updateCalculatorField('volume', e.detail.value || '');
  },

  onRateInput(e) {
    this.updateCalculatorField('rate', e.detail.value || '');
  },

  onPresetTap(e) {
    const { value = '' } = e.currentTarget.dataset || {};
    if (!value) return;

    this.setData({
      selectedPreset: value,
      'calculatorForm.concentration': value
    });
    this.calculateFluidCalories();
  },

  updateCalculatorField(field, value) {
    this.setData({
      [`calculatorForm.${field}`]: value
    });
    this.calculateFluidCalories();
  },

  calculateFluidCalories() {
    const weight = Number(this.data.calculatorForm.weight) || 0;
    const concentration = Number(this.data.calculatorForm.concentration) || 0;
    const volume = Number(this.data.calculatorForm.volume) || 0;
    const rate = Number(this.data.calculatorForm.rate) || 0;

    const dextroseGrams = volume > 0 && concentration > 0
      ? (concentration * volume) / 100
      : 0;
    const totalCalories = dextroseGrams * 3.4;
    const kcalPerKg = weight > 0 ? totalCalories / weight : 0;
    const kcalPerMl = concentration > 0 ? concentration * 0.034 : 0;
    const gir = weight > 0 && concentration > 0 && rate > 0
      ? (concentration * rate * 10) / weight / 60
      : 0;

    this.setData({
      calculatorResult: {
        dextroseGrams: this.roundTo(dextroseGrams, 1),
        totalCalories: this.roundTo(totalCalories, 1),
        kcalPerKg: this.roundTo(kcalPerKg, 1),
        kcalPerMl: this.roundTo(kcalPerMl, 3),
        gir: this.roundTo(gir, 2)
      }
    });
  },

  roundTo(value, digits = 1) {
    const factor = Math.pow(10, digits);
    return Math.round((Number(value) || 0) * factor) / factor;
  }
});
