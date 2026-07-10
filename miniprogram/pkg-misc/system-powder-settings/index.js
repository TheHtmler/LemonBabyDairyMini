const { waitForAppInitialization, handleError } = require('../../utils/index');
const { isDeveloperOpenid } = require('../../config/developer');
const {
  POWDER_CATEGORIES,
  getDefaultProteinRole
} = require('../../utils/formulaPowderUtils');

const CATEGORY_OPTIONS = [
  { value: POWDER_CATEGORIES.REGULAR_FORMULA, label: '普通配方粉' },
  { value: POWDER_CATEGORIES.SPECIAL_FORMULA, label: '特殊配方粉' },
  { value: POWDER_CATEGORIES.ENERGY_SUPPLEMENT, label: '能量补充粉' }
];

// 与我的奶粉创建保持一致：编码由系统自动生成，开发者无需手填。
function generatePowderCode() {
  return `SP_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function createEmptyDraft() {
  return {
    id: '',
    powderCode: '',
    name: '',
    category: POWDER_CATEGORIES.REGULAR_FORMULA,
    brand: '',
    stage: '',
    image: '',
    aliasText: '',
    description: '',
    nutritionPer100g: { protein: '', calories: '', fat: '', carbs: '', fiber: '' },
    mixRatio: { powder: '', water: '' }
  };
}

function categoryLabel(category) {
  const option = CATEGORY_OPTIONS.find((item) => item.value === category);
  return option ? option.label : '普通配方粉';
}

function formatListItem(item = {}) {
  const nutrition = item.nutritionPer100g || {};
  const ratio = item.mixRatio || {};
  return {
    ...item,
    categoryLabel: categoryLabel(item.category),
    nutritionText: `蛋白 ${nutrition.protein || 0}g · 热量 ${nutrition.calories || 0}kcal`,
    mixRatioText: ratio.powder && ratio.water ? `${ratio.powder}g / ${ratio.water}ml` : '未设置',
    inactive: item.status !== 'active'
  };
}

Page({
  data: {
    hasAccess: true,
    loading: true,
    saving: false,
    uploading: false,
    items: [],
    metaVersion: '',
    metaTotal: 0,
    showEditor: false,
    editorTitle: '新增系统奶粉',
    categoryOptions: CATEGORY_OPTIONS,
    categoryIndex: 0,
    draft: createEmptyDraft(),
    imagePreviewUrl: ''
  },

  async onLoad() {
    try {
      await waitForAppInitialization();
      const app = getApp();
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';

      if (!isDeveloperOpenid(openid)) {
        this.setData({ hasAccess: false, loading: false });
        return;
      }

      await this.loadList();
    } catch (error) {
      this.setData({ loading: false });
      handleError(error, { title: '加载系统奶粉库失败' });
    }
  },

  async callManager(data = {}) {
    const res = await wx.cloud.callFunction({
      name: 'systemPowderManager',
      data
    });
    if (!res?.result?.ok) {
      throw new Error(res?.result?.message || '系统奶粉库操作失败');
    }
    return res.result;
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const result = await this.callManager({ action: 'list' });
      this.setData({
        items: (result.items || []).map(formatListItem),
        metaVersion: result.meta?.version || '',
        metaTotal: result.meta?.total || 0
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  showAddEditor() {
    this.setData({
      showEditor: true,
      editorTitle: '新增系统奶粉',
      categoryIndex: 0,
      draft: createEmptyDraft(),
      imagePreviewUrl: ''
    });
  },

  showEditEditor(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.items || []).find((powder) => powder._id === id);
    if (!item) return;

    const categoryIndex = Math.max(
      0,
      CATEGORY_OPTIONS.findIndex((option) => option.value === item.category)
    );
    this.setData({
      showEditor: true,
      editorTitle: '编辑系统奶粉',
      categoryIndex,
      imagePreviewUrl: '',
      draft: {
        id: item._id,
        powderCode: item.powderCode || '',
        name: item.name || '',
        category: item.category || POWDER_CATEGORIES.REGULAR_FORMULA,
        brand: item.brand || '',
        stage: item.stage || '',
        image: item.image || '',
        aliasText: (item.alias || []).join('、'),
        description: item.description || '',
        nutritionPer100g: {
          protein: String(item.nutritionPer100g?.protein ?? ''),
          calories: String(item.nutritionPer100g?.calories ?? ''),
          fat: String(item.nutritionPer100g?.fat ?? ''),
          carbs: String(item.nutritionPer100g?.carbs ?? ''),
          fiber: String(item.nutritionPer100g?.fiber ?? '')
        },
        mixRatio: {
          powder: String(item.mixRatio?.powder ?? ''),
          water: String(item.mixRatio?.water ?? '')
        }
      }
    });
    this.resolveImagePreview(item.image || '');
  },

  hideEditor() {
    this.setData({ showEditor: false });
  },

  // 云文件 ID 无法直接用于 image 组件，需要换成临时链接预览。
  async resolveImagePreview(fileId) {
    if (!fileId) {
      this.setData({ imagePreviewUrl: '' });
      return;
    }
    if (!fileId.startsWith('cloud://')) {
      this.setData({ imagePreviewUrl: fileId });
      return;
    }
    try {
      const { fileList } = await wx.cloud.getTempFileURL({
        fileList: [{ fileID: fileId, maxAge: 3600 }]
      });
      this.setData({ imagePreviewUrl: fileList?.[0]?.tempFileURL || '' });
    } catch (error) {
      console.warn('解析奶粉图片预览失败:', error);
      this.setData({ imagePreviewUrl: '' });
    }
  },

  async choosePowderImage() {
    if (this.data.uploading || this.data.saving) return;
    try {
      const chooseRes = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });
      const tempFilePath = chooseRes?.tempFilePaths?.[0];
      if (!tempFilePath) return;
      await this.uploadPowderImage(tempFilePath);
    } catch (error) {
      if (error && /cancel/i.test(error.errMsg || '')) {
        return;
      }
      handleError(error, { title: '选择图片失败' });
    }
  },

  async uploadPowderImage(tempFilePath) {
    this.setData({ uploading: true, imagePreviewUrl: tempFilePath });
    try {
      wx.showLoading({ title: '上传中...', mask: true });
      const extMatch = (tempFilePath || '').match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '.jpg';
      const cloudPath = `powder_catalog_images/powder_${Date.now()}${ext}`;
      const result = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      });
      if (!result?.fileID) {
        throw new Error('图片上传失败');
      }
      this.setData({ 'draft.image': result.fileID });
      wx.hideLoading();
      wx.showToast({ title: '图片已上传', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      this.setData({ 'draft.image': '', imagePreviewUrl: '' });
      handleError(error, { title: '图片上传失败' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  removePowderImage() {
    if (this.data.uploading) return;
    this.setData({ 'draft.image': '', imagePreviewUrl: '' });
  },

  previewPowderImage() {
    const current = this.data.imagePreviewUrl;
    if (!current) return;
    wx.previewImage({ current, urls: [current] });
  },

  onCategoryChange(e) {
    const categoryIndex = Number(e.detail.value) || 0;
    const category = (CATEGORY_OPTIONS[categoryIndex] || CATEGORY_OPTIONS[0]).value;
    this.setData({
      categoryIndex,
      'draft.category': category
    });
  },

  onDraftInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`draft.${field}`]: e.detail.value });
  },

  // 必填规则与「我的奶粉」编辑弹窗保持一致：名称 + 四项核心营养 + 冲配比，纤维选填。
  validateDraftRequired(draft = {}) {
    if (!String(draft.name || '').trim()) {
      return '请填写名称';
    }

    const nutrition = draft.nutritionPer100g || {};
    const nutritionFields = [
      { value: nutrition.protein, label: '蛋白' },
      { value: nutrition.calories, label: '热量' },
      { value: nutrition.fat, label: '脂肪' },
      { value: nutrition.carbs, label: '碳水' }
    ];
    const invalidNutrition = nutritionFields.find(({ value }) => {
      const num = Number(value);
      return String(value ?? '').trim() === '' || !Number.isFinite(num) || num < 0;
    });
    if (invalidNutrition) {
      return `请填写有效的${invalidNutrition.label}`;
    }

    const ratio = draft.mixRatio || {};
    const ratioFields = [
      { value: ratio.powder, label: '冲配比粉量' },
      { value: ratio.water, label: '冲配比水量' }
    ];
    const invalidRatio = ratioFields.find(({ value }) => {
      const num = Number(value);
      return !Number.isFinite(num) || num <= 0;
    });
    if (invalidRatio) {
      return `请填写有效的${invalidRatio.label}`;
    }

    return '';
  },

  async saveDraft() {
    if (this.data.saving || this.data.uploading) return;
    const draft = this.data.draft;
    const requiredError = this.validateDraftRequired(draft);
    if (requiredError) {
      wx.showToast({ title: requiredError, icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      await this.callManager({
        action: 'save',
        id: draft.id,
        powder: {
          powderCode: String(draft.powderCode || '').trim() || generatePowderCode(),
          name: draft.name,
          category: draft.category,
          proteinRole: getDefaultProteinRole(draft.category),
          brand: draft.brand,
          stage: draft.stage,
          image: draft.image,
          alias: draft.aliasText,
          description: draft.description,
          nutritionPer100g: draft.nutritionPer100g,
          mixRatio: draft.mixRatio
        }
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showEditor: false });
      await this.loadList();
    } catch (error) {
      handleError(error, { title: error?.message || '保存系统奶粉失败' });
    } finally {
      this.setData({ saving: false });
    }
  },

  deletePowder(e) {
    const { id, name } = e.currentTarget.dataset;
    if (!id) return;

    wx.showModal({
      title: '删除系统奶粉',
      content: `确定删除「${name || '该奶粉'}」吗？所有用户的系统奶粉库都会移除该条目。`,
      confirmColor: '#e64340',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await this.callManager({ action: 'remove', id });
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadList();
        } catch (error) {
          handleError(error, { title: error?.message || '删除系统奶粉失败' });
        }
      }
    });
  }
});
