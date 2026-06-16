const { getBabyUid } = require('../../utils/index');
const {
  getNutritionTargetPreferences,
  normalizeTargetMode,
  saveNutritionTargetPreferences
} = require('../../utils/nutritionTargetPreferences');

function normalizeInput(value) {
  if (value === undefined || value === null) return '';
  return `${value}`.replace(/[^\d.]/g, '');
}

function isInvalidPositiveInput(value) {
  if (value === '') return false;
  const num = Number(value);
  return !Number.isFinite(num) || num <= 0;
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    mode: {
      type: String,
      value: 'protein'
    },
    title: {
      type: String,
      value: '设置营养目标'
    }
  },
  data: {
    activeMode: 'protein',
    loading: false,
    saving: false,
    form: {
      naturalProteinCoefficient: '',
      specialProteinCoefficient: '',
      calorieCoefficient: ''
    }
  },
  observers: {
    'visible, mode': function(visible, mode) {
      if (visible) {
        this.loadPreferences(mode);
      }
    }
  },
  methods: {
    async loadPreferences(mode = this.data.activeMode) {
      const babyUid = getBabyUid();
      const activeMode = normalizeTargetMode(mode);
      this.setData({ activeMode, loading: true });
      try {
        const preferences = babyUid ? await getNutritionTargetPreferences(babyUid) : {};
        this.setData({
          form: {
            naturalProteinCoefficient: normalizeInput(preferences.naturalProteinCoefficient),
            specialProteinCoefficient: normalizeInput(preferences.specialProteinCoefficient),
            calorieCoefficient: normalizeInput(preferences.calorieCoefficient)
          }
        });
      } catch (error) {
        console.warn('加载营养目标失败:', error);
        wx.showToast({ title: '目标加载失败', icon: 'none' });
      } finally {
        this.setData({ loading: false });
      }
    },

    handleModeTap(e) {
      const mode = e.currentTarget.dataset.mode;
      this.setData({ activeMode: normalizeTargetMode(mode) });
    },

    handleInput(e) {
      const field = e.currentTarget.dataset.field;
      if (!field) return;
      this.setData({
        [`form.${field}`]: normalizeInput(e.detail.value)
      });
    },

    handleClose() {
      if (this.data.saving) return;
      this.triggerEvent('close');
    },

    stopBubble() {},

    async handleSave() {
      const form = this.data.form || {};
      const invalidField = [
        form.naturalProteinCoefficient,
        form.specialProteinCoefficient,
        form.calorieCoefficient
      ].some(isInvalidPositiveInput);
      if (invalidField) {
        wx.showToast({ title: '目标系数需大于 0', icon: 'none' });
        return;
      }

      const babyUid = getBabyUid();
      if (!babyUid) {
        wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
        return;
      }

      const preferences = {
        naturalProteinCoefficient: form.naturalProteinCoefficient || '',
        specialProteinCoefficient: form.specialProteinCoefficient || '',
        calorieCoefficient: form.calorieCoefficient || '',
        preferredTargetMode: normalizeTargetMode(this.data.activeMode)
      };

      this.setData({ saving: true });
      try {
        await saveNutritionTargetPreferences(babyUid, preferences);
        wx.showToast({ title: '目标已保存', icon: 'success' });
        this.triggerEvent('saved', { preferences });
        this.triggerEvent('close');
      } catch (error) {
        console.warn('保存营养目标失败:', error);
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      } finally {
        this.setData({ saving: false });
      }
    }
  }
});
