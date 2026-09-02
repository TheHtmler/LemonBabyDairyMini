const { getBabyUid } = require('../../utils/index');
const {
  getGlucoseCalorieCoefficient,
  saveGlucoseCalorieCoefficient
} = require('../../utils/glucoseCaloriePreference');
const {
  DEFAULT_GLUCOSE_CALORIE_COEFFICIENT,
  GLUCOSE_CALORIE_OPTIONS,
  normalizeGlucoseCalorieCoefficient,
  formatGlucoseCalorieKey,
  calculateDextroseFluidCalories,
  buildDextroseConcentrationReference,
  buildDextroseCalculationExamples
} = require('../../utils/treatmentUtils');

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
    glucoseCalorieOptions: GLUCOSE_CALORIE_OPTIONS,
    glucoseCalorieCoefficient: DEFAULT_GLUCOSE_CALORIE_COEFFICIENT,
    glucoseCalorieKey: formatGlucoseCalorieKey(DEFAULT_GLUCOSE_CALORIE_COEFFICIENT),
    concentrationReference: buildDextroseConcentrationReference(DEFAULT_GLUCOSE_CALORIE_COEFFICIENT),
    calculationExamples: buildDextroseCalculationExamples(DEFAULT_GLUCOSE_CALORIE_COEFFICIENT),
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

  async onLoad() {
    await this.loadGlucoseCaloriePreference();
  },

  async onShow() {
    await this.loadGlucoseCaloriePreference();
  },

  async loadGlucoseCaloriePreference() {
    const coefficient = await getGlucoseCalorieCoefficient(getBabyUid());
    this.applyGlucoseCalorieCoefficient(coefficient, { persist: false });
  },

  applyGlucoseCalorieCoefficient(coefficient, { persist = false } = {}) {
    const nextCoefficient = normalizeGlucoseCalorieCoefficient(coefficient);
    this.setData({
      glucoseCalorieCoefficient: nextCoefficient,
      glucoseCalorieKey: formatGlucoseCalorieKey(nextCoefficient),
      concentrationReference: buildDextroseConcentrationReference(nextCoefficient),
      calculationExamples: buildDextroseCalculationExamples(nextCoefficient)
    });
    this.calculateFluidCalories();
    if (persist) {
      saveGlucoseCalorieCoefficient(getBabyUid(), nextCoefficient);
    }
  },

  async onGlucoseCoefficientTap(e) {
    const nextCoefficient = normalizeGlucoseCalorieCoefficient(e.currentTarget.dataset.value);
    if (nextCoefficient === this.data.glucoseCalorieCoefficient) return;
    this.applyGlucoseCalorieCoefficient(nextCoefficient, { persist: true });
  },

  handleCardTap(e) {
    const { id = '' } = e.currentTarget.dataset || {};
    if (id === 'emergency-card') {
      wx.navigateTo({
        url: '/pkg-misc/emergency-card/index'
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
    const result = calculateDextroseFluidCalories({
      weight: this.data.calculatorForm.weight,
      concentration: this.data.calculatorForm.concentration,
      volume: this.data.calculatorForm.volume,
      rate: this.data.calculatorForm.rate,
      coefficient: this.data.glucoseCalorieCoefficient
    });

    this.setData({
      calculatorResult: {
        dextroseGrams: this.roundTo(result.dextroseGrams, 1),
        totalCalories: this.roundTo(result.totalCalories, 1),
        kcalPerKg: this.roundTo(result.kcalPerKg, 1),
        kcalPerMl: this.roundTo(result.kcalPerMl, 3),
        gir: this.roundTo(result.gir, 2)
      }
    });
  },

  roundTo(value, digits = 1) {
    const factor = Math.pow(10, digits);
    return Math.round((Number(value) || 0) * factor) / factor;
  }
});
