// 配奶管理 v2 页面
const app = getApp();
const NutritionModel = require('../../models/nutrition');
const MilkNutritionProfileModel = require('../../models/nutritionProfile');
const {
  POWDER_CATEGORIES,
  POWDER_CATEGORY_META,
  POWDER_STATUSES,
  PROTEIN_ROLES,
  buildCategoryBadgeStyle,
  normalizeFormulaPowders,
  sortFormulaPowdersByCategory
} = require('../../utils/formulaPowderUtils');

const ROLE_LABELS = {
  [PROTEIN_ROLES.NATURAL]: '天然蛋白',
  [PROTEIN_ROLES.SPECIAL]: '特殊蛋白',
  [PROTEIN_ROLES.NONE]: '无蛋白·计热量'
};
const POWDER_TYPE_OPTIONS = [
  {
    value: POWDER_CATEGORIES.REGULAR_FORMULA,
    label: POWDER_CATEGORY_META[POWDER_CATEGORIES.REGULAR_FORMULA].label,
    desc: '默认按天然蛋白计算'
  },
  {
    value: POWDER_CATEGORIES.SPECIAL_FORMULA,
    label: POWDER_CATEGORY_META[POWDER_CATEGORIES.SPECIAL_FORMULA].label,
    desc: '默认按特殊蛋白计算'
  },
  {
    value: POWDER_CATEGORIES.ENERGY_SUPPLEMENT,
    label: POWDER_CATEGORY_META[POWDER_CATEGORIES.ENERGY_SUPPLEMENT].label,
    desc: '无蛋白，计入热量'
  }
];
const DEFAULT_SETTINGS = NutritionModel.createDefaultSettings();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getServerDate() {
  return wx.cloud.database().serverDate();
}

function isBlank(value) {
  return value === undefined || value === null || `${value}`.trim() === '';
}

function isValidNumber(value, allowZero = true) {
  if (isBlank(value)) return false;
  const num = Number(value);
  if (!Number.isFinite(num)) return false;
  return allowZero ? num >= 0 : num > 0;
}

function createEmptyPowderDraft(category = POWDER_CATEGORIES.REGULAR_FORMULA) {
  const proteinRole = category === POWDER_CATEGORIES.SPECIAL_FORMULA
    ? PROTEIN_ROLES.SPECIAL
    : category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT
      ? PROTEIN_ROLES.NONE
      : PROTEIN_ROLES.NATURAL;

  return {
    id: '',
    name: '',
    category,
    proteinRole,
    nutritionPer100g: {
      protein: '',
      calories: '',
      fat: '',
      carbs: '',
      fiber: ''
    },
    mixRatio: {
      powder: '',
      water: ''
    },
    status: POWDER_STATUSES.ACTIVE,
    source: 'user',
    createdAt: '',
    updatedAt: '',
    deletedAt: null
  };
}

function getPowderTypeIndex(category) {
  const index = POWDER_TYPE_OPTIONS.findIndex((option) => option.value === category);
  return index >= 0 ? index : 0;
}

function buildPowderTypeState(category) {
  const powderTypeIndex = getPowderTypeIndex(category);
  const option = POWDER_TYPE_OPTIONS[powderTypeIndex];
  return {
    powderTypeIndex,
    powderTypeLabel: option.label,
    powderTypeDesc: option.desc
  };
}

Page({
  data: {
    settings: clone(DEFAULT_SETTINGS),
    inputValues: clone(DEFAULT_SETTINGS),
    isConfirmed: false,
    isFromSetup: false,
    activeView: 'mother',
    showPowderModal: false,
    powderTypeOptions: POWDER_TYPE_OPTIONS,
    powderTypeIndex: 0,
    powderTypeLabel: POWDER_TYPE_OPTIONS[0].label,
    powderTypeDesc: POWDER_TYPE_OPTIONS[0].desc,
    powderDraft: createEmptyPowderDraft(),
    visibleFormulaPowders: []
  },

  async onLoad(options = {}) {
    const isFromSetup = options.fromSetup === 'true';
    const defaultSettings = NutritionModel.createDefaultSettings();

    this.setData({ isFromSetup });
    this.applySettings(defaultSettings);

    try {
      wx.showLoading({ title: '加载中...' });
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');

      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
        return;
      }

      console.info('[NutritionProfileSettings] load start', { babyUid });
      const settings = await MilkNutritionProfileModel.getNutritionProfileSettings(babyUid, {
        includeLegacyFallback: false,
        throwOnError: true
      });
      console.info('[NutritionProfileSettings] load result', {
        babyUid,
        hasSettings: !!settings,
        powderCount: Array.isArray(settings?.formulaPowders) ? settings.formulaPowders.length : 0,
        powderIds: (settings?.formulaPowders || []).map((powder) => powder.id)
      });
      this.applySettings({
        ...defaultSettings,
        ...(settings || {}),
        formula_milk_ratio: {
          ...defaultSettings.formula_milk_ratio,
          ...((settings && settings.formula_milk_ratio) || {})
        },
        special_milk_ratio: {
          ...defaultSettings.special_milk_ratio,
          ...((settings && settings.special_milk_ratio) || {})
        }
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('加载配奶管理失败：', err);
      wx.showModal({
        title: '加载配奶管理失败',
        content: err?.message || '读取 milk_nutrition_profiles 失败，请打开调试日志查看详情。',
        showCancel: false
      });
    }
  },

  applySettings(rawSettings) {
    const normalized = NutritionModel.normalizeSettings(rawSettings || {});
    const settings = this.enrichSettings(normalized);

    this.setData({
      settings,
      inputValues: clone(settings),
      visibleFormulaPowders: sortFormulaPowdersByCategory(
        settings.formulaPowders.filter((powder) => powder.status === POWDER_STATUSES.ACTIVE)
      )
    });
  },

  enrichSettings(settings) {
    const powders = normalizeFormulaPowders(settings.formulaPowders || []).map((powder) => {
      const categoryMeta = POWDER_CATEGORY_META[powder.category] || {
        label: '配方粉',
        shortLabel: '粉',
        badgeClass: 'regular',
        colors: {}
      };

      return {
        ...powder,
        categoryLabel: categoryMeta.label,
        categoryShortLabel: categoryMeta.shortLabel,
        categoryBadgeClass: categoryMeta.badgeClass,
        categoryBadgeStyle: buildCategoryBadgeStyle(categoryMeta),
        proteinRoleLabel: ROLE_LABELS[powder.proteinRole] || '天然蛋白'
      };
    });
    return {
      ...settings,
      formulaPowders: powders
    };
  },

  refreshVisibleFormulaPowders(powders = []) {
    this.setData({
      visibleFormulaPowders: sortFormulaPowdersByCategory(
        powders.filter((powder) => powder.status === POWDER_STATUSES.ACTIVE)
      )
    });
  },

  showMotherSettings() {
    this.setData({ activeView: 'mother' });
  },

  showPowderList() {
    this.setData({ activeView: 'powders' });
  },

  startAddPowder() {
    this.setData({
      activeView: 'powders',
      showPowderModal: true,
      powderDraft: createEmptyPowderDraft(),
      ...buildPowderTypeState(POWDER_CATEGORIES.REGULAR_FORMULA)
    });
  },

  startEditPowder(e) {
    const id = e.currentTarget.dataset.id;
    const powder = (this.data.settings.formulaPowders || []).find((item) => item.id === id);
    if (!powder) return;

    this.setData({
      activeView: 'powders',
      showPowderModal: true,
      powderDraft: clone(powder),
      ...buildPowderTypeState(powder.category)
    });
  },

  onPowderTypePickerChange(e) {
    const index = Number(e.detail.value);
    const option = POWDER_TYPE_OPTIONS[index] || POWDER_TYPE_OPTIONS[0];
    const category = option.value;
    const draft = {
      ...this.data.powderDraft,
      category,
      proteinRole: category === POWDER_CATEGORIES.SPECIAL_FORMULA
        ? PROTEIN_ROLES.SPECIAL
        : category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT
          ? PROTEIN_ROLES.NONE
          : PROTEIN_ROLES.NATURAL
    };
    this.setData({
      powderDraft: draft,
      ...buildPowderTypeState(category)
    });
  },

  cancelPowderDraft() {
    this.setData({
      showPowderModal: false,
      powderDraft: createEmptyPowderDraft(),
      ...buildPowderTypeState(POWDER_CATEGORIES.REGULAR_FORMULA)
    });
  },

  validatePowderDraftRequired(values = {}) {
    const requiredFields = [
      { field: 'name', label: '名称', type: 'text' },
      { field: 'protein', label: '蛋白', type: 'number' },
      { field: 'calories', label: '热量', type: 'number' },
      { field: 'fat', label: '脂肪', type: 'number' },
      { field: 'carbs', label: '碳水', type: 'number' },
      { field: 'ratioPowder', label: '冲配比粉量', type: 'positiveNumber' },
      { field: 'ratioWater', label: '冲配比水量', type: 'positiveNumber' }
    ];
    const invalidField = requiredFields.find(({ field, type }) => {
      if (type === 'text') {
        return isBlank(values[field]);
      }
      if (type === 'positiveNumber') {
        return !isValidNumber(values[field], false);
      }
      return !isValidNumber(values[field], true);
    });

    if (!invalidField) {
      return '';
    }

    return invalidField.type === 'text'
      ? `请填写${invalidField.label}`
      : `请填写有效的${invalidField.label}`;
  },

  async savePowderDraft(e) {
    const values = e.detail.value || {};
    const requiredError = this.validatePowderDraftRequired(values);
    if (requiredError) {
      wx.showToast({ title: requiredError, icon: 'none' });
      return;
    }

    const current = this.data.powderDraft;
    const now = getServerDate();
    const draft = {
      id: current.id || createId('powder'),
      name: (values.name || '').trim(),
      category: current.category,
      proteinRole: current.proteinRole,
      nutritionPer100g: {
        protein: toNumber(values.protein),
        calories: toNumber(values.calories),
        fat: toNumber(values.fat),
        carbs: toNumber(values.carbs),
        fiber: toNumber(values.fiber)
      },
      mixRatio: {
        powder: toNumber(values.ratioPowder),
        water: toNumber(values.ratioWater)
      },
      status: POWDER_STATUSES.ACTIVE,
      source: current.source || 'user',
      createdAt: current.createdAt || now,
      updatedAt: now,
      deletedAt: null
    };

    const settings = clone(this.data.settings);
    const powders = settings.formulaPowders || [];
    const index = powders.findIndex((item) => item.id === draft.id);
    if (index >= 0) {
      powders[index] = draft;
    } else {
      powders.push(draft);
    }

    settings.formulaPowders = powders;
    const success = await this.saveSettings(settings, {
      stayOnPage: true,
      toastTitle: draft.id === current.id ? '配方粉已保存' : '配方粉已添加'
    });

    if (!success) {
      return;
    }

    this.applySettings(settings);
    this.refreshVisibleFormulaPowders(this.data.settings.formulaPowders || []);
    this.setData({
      showPowderModal: false,
      powderDraft: createEmptyPowderDraft(),
      ...buildPowderTypeState(POWDER_CATEGORIES.REGULAR_FORMULA)
    });
  },

  async deletePowder(e) {
    const id = e.currentTarget.dataset.id;
    const powder = (this.data.settings.formulaPowders || []).find((item) => item.id === id);
    if (!powder) return;

    const modalRes = await wx.showModal({
      title: '删除这个配方粉？',
      content: `删除「${powder.name}」后，以后记录喂奶时，就不能再选择它了。以前已经保存的喂奶记录还会保留。`,
      confirmText: '删除',
      confirmColor: '#E65A4F',
      cancelText: '取消'
    });

    if (!modalRes.confirm) {
      return;
    }

    const settings = clone(this.data.settings);
    const now = getServerDate();
    settings.formulaPowders = (settings.formulaPowders || []).map((powder) => {
      if (powder.id !== id) {
        return powder;
      }

      return {
        ...powder,
        status: POWDER_STATUSES.ARCHIVED,
        updatedAt: now,
        deletedAt: now
      };
    });
    const success = await this.saveSettings(settings, {
      stayOnPage: true,
      toastTitle: '配方粉已删除'
    });

    if (!success) {
      return;
    }

    this.applySettings(settings);
    this.refreshVisibleFormulaPowders(this.data.settings.formulaPowders || []);
  },

  onMotherInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [`inputValues.${field}`]: e.detail.value
    });
  },

  buildSettingsForSave() {
    const settings = clone(this.data.settings);
    const values = this.data.inputValues || {};
    [
      'natural_milk_protein',
      'natural_milk_calories',
      'natural_milk_fat',
      'natural_milk_carbs',
      'natural_milk_fiber'
    ].forEach((key) => {
      settings[key] = values[key];
    });
    return settings;
  },

  onSaveSettings() {
    const settings = this.buildSettingsForSave();
    this.applySettings(settings);
    this.saveSettings(settings);
  },

  async saveSettings(newSettings, options = {}) {
    try {
      wx.showLoading({ title: '保存中...', mask: true });
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({ title: '未找到宝宝信息，无法保存', icon: 'none' });
        return false;
      }

      console.info('[NutritionProfileSettings] save start', {
        babyUid,
        powderCount: Array.isArray(newSettings?.formulaPowders) ? newSettings.formulaPowders.length : 0,
        powderIds: (newSettings?.formulaPowders || []).map((powder) => powder.id)
      });
      const success = await MilkNutritionProfileModel.updateNutritionProfileSettings(babyUid, newSettings);

      if (!success) {
        wx.hideLoading();
        console.error('[NutritionProfileSettings] save failed without thrown error', {
          babyUid,
          newSettings
        });
        wx.showToast({ title: '保存失败', icon: 'none' });
        return false;
      }

      const persistedSettings = await MilkNutritionProfileModel.getNutritionProfileSettings(babyUid, {
        includeLegacyFallback: false,
        throwOnError: true
      });
      const expectedActivePowderIds = (newSettings.formulaPowders || [])
        .filter((powder) => powder.status === POWDER_STATUSES.ACTIVE)
        .map((powder) => powder.id);
      const persistedPowderIds = (persistedSettings?.formulaPowders || [])
        .filter((powder) => powder.status === POWDER_STATUSES.ACTIVE)
        .map((powder) => powder.id);
      const missingPowderIds = expectedActivePowderIds.filter((id) => !persistedPowderIds.includes(id));

      console.info('[NutritionProfileSettings] save readback result', {
        babyUid,
        expectedActivePowderIds,
        persistedPowderIds,
        missingPowderIds
      });

      if (!persistedSettings || missingPowderIds.length > 0) {
        throw new Error(`保存后回读 milk_nutrition_profiles 未找到配方粉：${missingPowderIds.join(', ') || '无档案'}`);
      }

      this.applySettings({
        ...DEFAULT_SETTINGS,
        ...persistedSettings
      });
      wx.hideLoading();
      console.info('[NutritionProfileSettings] save success', {
        babyUid,
        powderCount: Array.isArray(newSettings?.formulaPowders) ? newSettings.formulaPowders.length : 0
      });
      this.setData({ isConfirmed: true });
      wx.showToast({ title: options.toastTitle || '设置已保存', icon: 'success' });

      if (options.stayOnPage) {
        return true;
      }

      setTimeout(() => {
        if (this.data.isFromSetup) {
          wx.switchTab({
            url: '/pages/daily-feeding/index',
            fail: () => wx.navigateBack()
          });
        } else {
          wx.navigateBack();
        }
      }, 800);

      return true;
    } catch (error) {
      console.error('保存配奶管理失败:', error);
      wx.hideLoading();
      wx.showModal({
        title: '保存失败',
        content: error?.message || '保存配奶管理失败，请打开调试日志查看详情。',
        showCancel: false
      });
      return false;
    }
  }
});
