const TreatmentRecordModel = require('../../models/treatmentRecord');
const {
  TREATMENT_ITEM_CATEGORIES,
  TREATMENT_ITEM_UNITS,
  createTreatmentItem,
  createTreatmentGroup,
  calculateTreatmentGroupSummary,
  calculateTreatmentRecordSummary,
  getTreatmentCategoryLabel,
  getTreatmentCategoryIndex,
  getDefaultTreatmentUnit,
  getTreatmentUnitIndex
} = require('../../utils/treatmentUtils');

const FIXED_CATEGORY_OPTIONS = TREATMENT_ITEM_CATEGORIES.filter(item => item.value !== 'custom');

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeNumericInput(value) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/[^\d.]/g, '');
}

function normalizeGroupForForm(group = {}, index = 0) {
  const baseGroup = createTreatmentGroup(index, 'dextrose_10');
  const items = Array.isArray(group.items) && group.items.length > 0
    ? group.items.map(item => ({
      ...createTreatmentItem(item.category || ''),
      ...item,
      categoryIndex: item.category ? getTreatmentCategoryIndex(item.category) : -1,
      amount: item.amount === undefined || item.amount === null
        ? (item.volumeMl === undefined || item.volumeMl === null ? '' : item.volumeMl)
        : item.amount,
      unit: item.unit || getDefaultTreatmentUnit(item.category || ''),
      unitIndex: getTreatmentUnitIndex(item.unit || getDefaultTreatmentUnit(item.category || '')),
      calories: item.calories === undefined || item.calories === null ? '' : item.calories,
      carbsG: item.carbsG === undefined || item.carbsG === null ? '' : item.carbsG,
      proteinG: item.proteinG === undefined || item.proteinG === null ? '' : item.proteinG,
      fatG: item.fatG === undefined || item.fatG === null ? '' : item.fatG
    }))
    : [];

  return {
    ...baseGroup,
    ...group,
    name: group.name || baseGroup.name,
    items,
    summary: calculateTreatmentGroupSummary({ items })
  };
}

Page({
  data: {
    recordId: '',
    dateKey: '',
    isEdit: false,
    saving: false,
    categoryOptions: FIXED_CATEGORY_OPTIONS,
    unitOptions: TREATMENT_ITEM_UNITS,
    form: {
      recordType: 'iv',
      startTime: '',
      notes: '',
      groups: []
    },
    summary: calculateTreatmentRecordSummary([])
  },

  onLoad(options = {}) {
    const dateKey = options.date || getTodayDateKey();
    const recordId = options.id || '';
    this.setData({
      dateKey,
      recordId,
      isEdit: !!recordId
    });

    if (recordId) {
      this.loadRecord(recordId);
      return;
    }

    const defaultType = 'iv';
    const groups = [normalizeGroupForForm(createTreatmentGroup(0, 'dextrose_10'), 0)];
    this.setData({
      form: {
        recordType: defaultType,
        startTime: '',
        notes: '',
        groups
      },
      summary: calculateTreatmentRecordSummary(groups)
    });
  },

  async loadRecord(recordId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const result = await TreatmentRecordModel.getById(recordId);
      if (!result.success || !result.data) {
        throw new Error(result.message || '记录不存在');
      }
      const record = result.data;
      const sourceGroups = Array.isArray(record.groups) && record.groups.length > 0
        ? record.groups
        : [{
            name: '第1组',
            items: record.items || []
          }];
      const groups = sourceGroups.map((group, index) => normalizeGroupForForm(group, index));

      this.setData({
        dateKey: record.dateKey || this.data.dateKey,
        form: {
          recordType: record.recordType || 'iv',
          startTime: record.startTime || '',
          notes: record.notes || '',
          groups
        },
        summary: calculateTreatmentRecordSummary(groups)
      });
    } catch (error) {
      console.error('加载治疗记录失败:', error);
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  setFormData(nextForm) {
    const safeGroups = Array.isArray(nextForm.groups) && nextForm.groups.length > 0
      ? nextForm.groups.map((group, index) => normalizeGroupForForm(group, index))
      : [normalizeGroupForForm(createTreatmentGroup(0, 'dextrose_10'), 0)];
    this.setData({
      form: {
        ...nextForm,
        groups: safeGroups
      },
      summary: calculateTreatmentRecordSummary(safeGroups)
    });
  },

  onDateChange(e) {
    this.setData({ dateKey: e.detail.value });
  },

  onNotesInput(e) {
    this.setFormData({
      ...this.data.form,
      notes: e.detail.value
    });
  },

  onStartTimeChange(e) {
    this.setFormData({
      ...this.data.form,
      startTime: e.detail.value
    });
  },

  deriveNutritionForItem(item = {}) {
    const nextItem = { ...item };
    const amount = Number(nextItem.amount) || 0;
    const isMl = nextItem.unit === 'ml';
    if (!amount || !isMl) {
      return nextItem;
    }
    if (nextItem.category === 'dextrose_10') {
      const carbsG = Number((amount * 0.1).toFixed(2));
      nextItem.carbsG = carbsG;
      nextItem.calories = Number((carbsG * 3.4).toFixed(2));
      if (!nextItem.proteinG) nextItem.proteinG = 0;
      if (!nextItem.fatG) nextItem.fatG = 0;
    }
    if (nextItem.category === 'dextrose_5') {
      const carbsG = Number((amount * 0.05).toFixed(2));
      nextItem.carbsG = carbsG;
      nextItem.calories = Number((carbsG * 3.4).toFixed(2));
      if (!nextItem.proteinG) nextItem.proteinG = 0;
      if (!nextItem.fatG) nextItem.fatG = 0;
    }
    return nextItem;
  },

  updateGroup(groupIndex, updater) {
    const groups = [...(this.data.form.groups || [])];
    if (!groups[groupIndex]) return;
    groups[groupIndex] = normalizeGroupForForm(updater({ ...groups[groupIndex] }), groupIndex);
    this.setFormData({
      ...this.data.form,
      groups
    });
  },

  updateItem(groupIndex, itemIndex, updater) {
    this.updateGroup(groupIndex, group => {
      const items = [...(group.items || [])];
      if (!items[itemIndex]) return group;
      items[itemIndex] = this.deriveNutritionForItem(updater({ ...items[itemIndex] }));
      return {
        ...group,
        items,
        summary: calculateTreatmentGroupSummary({ items })
      };
    });
  },

  addTreatmentGroup() {
    const groups = [...(this.data.form.groups || [])];
    groups.push(normalizeGroupForForm(createTreatmentGroup(groups.length, 'dextrose_10'), groups.length));
    this.setFormData({
      ...this.data.form,
      groups
    });
  },

  removeTreatmentGroup(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    const groups = [...(this.data.form.groups || [])];
    if (groups.length === 1) {
      wx.showToast({ title: '至少保留一组', icon: 'none' });
      return;
    }
    groups.splice(groupIndex, 1);
    this.setFormData({
      ...this.data.form,
      groups
    });
  },

  addTreatmentItem(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    this.updateGroup(groupIndex, group => {
      return {
        ...group,
        items: [...(group.items || []), createTreatmentItem('')]
      };
    });
  },

  addCustomTreatmentItem(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    this.updateGroup(groupIndex, group => {
      return {
        ...group,
        items: [...(group.items || []), {
          ...createTreatmentItem('custom'),
          category: 'custom',
          categoryIndex: -1,
          name: ''
        }]
      };
    });
  },

  removeTreatmentItem(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    const itemIndex = Number(e.currentTarget.dataset.itemIndex);
    this.updateGroup(groupIndex, group => {
      const items = [...(group.items || [])];
      if (items.length === 1) {
        wx.showToast({ title: '每组至少保留一项', icon: 'none' });
        return group;
      }
      items.splice(itemIndex, 1);
      return {
        ...group,
        items,
        summary: calculateTreatmentGroupSummary({ items })
      };
    });
  },

  onItemCategoryChange(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    const itemIndex = Number(e.currentTarget.dataset.itemIndex);
    const optionIndex = Number(e.detail.value) || 0;
    const nextCategory = FIXED_CATEGORY_OPTIONS[optionIndex]?.value || '';
    this.updateItem(groupIndex, itemIndex, item => ({
      ...item,
      category: nextCategory,
      categoryIndex: optionIndex,
      name: getTreatmentCategoryLabel(nextCategory),
      unit: getDefaultTreatmentUnit(nextCategory),
      unitIndex: getTreatmentUnitIndex(getDefaultTreatmentUnit(nextCategory)),
      countInNutrition: ['dextrose_10', 'dextrose_5'].includes(nextCategory)
    }));
  },

  onItemUnitChange(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    const itemIndex = Number(e.currentTarget.dataset.itemIndex);
    const unitIndex = Number(e.detail.value) || 0;
    const unit = TREATMENT_ITEM_UNITS[unitIndex] || 'ml';
    this.updateItem(groupIndex, itemIndex, item => ({
      ...item,
      unit,
      unitIndex
    }));
  },

  onItemInput(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    const itemIndex = Number(e.currentTarget.dataset.itemIndex);
    const field = e.currentTarget.dataset.field;
    const rawValue = e.detail.value;
    const numericFields = ['amount', 'calories', 'carbsG', 'proteinG', 'fatG'];
    const nextValue = numericFields.includes(field) ? normalizeNumericInput(rawValue) : rawValue;
    this.updateItem(groupIndex, itemIndex, item => ({
      ...item,
      [field]: nextValue
    }));
  },

  onItemCountSwitch(e) {
    const groupIndex = Number(e.currentTarget.dataset.groupIndex);
    const itemIndex = Number(e.currentTarget.dataset.itemIndex);
    this.updateItem(groupIndex, itemIndex, item => ({
      ...item,
      countInNutrition: !!e.detail.value
    }));
  },

  async notifyPreviousPageRefresh() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (!prevPage || prevPage.route !== 'pages/daily-feeding/index' || typeof prevPage.loadTodayData !== 'function') {
      return;
    }
    await prevPage.loadTodayData(true);
  },

  async saveRecord() {
    if (this.data.saving) return;
    const { form, dateKey, recordId, isEdit } = this.data;
    const groups = (form.groups || []).map((group, groupIndex) => ({
      id: group.id,
      name: String(group.name || '').trim() || `第${groupIndex + 1}组`,
      items: (group.items || []).map(item => ({
        ...item,
        name: String(item.name || '').trim() || getTreatmentCategoryLabel(item.category),
        amount: item.amount === '' ? '' : Number(item.amount),
        unit: item.unit || 'ml',
        calories: item.calories === '' ? '' : Number(item.calories),
        carbsG: item.carbsG === '' ? '' : Number(item.carbsG),
        proteinG: item.proteinG === '' ? '' : Number(item.proteinG),
        fatG: item.fatG === '' ? '' : Number(item.fatG)
      }))
    }));

    if (!dateKey) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }
    if (!groups.length) {
      wx.showToast({ title: '请至少添加一组', icon: 'none' });
      return;
    }
    if (groups.some(group => !group.items || group.items.length === 0)) {
      wx.showToast({ title: '每组至少添加一种药物', icon: 'none' });
      return;
    }
    if (groups.some(group => group.items.some(item => !item.category || item.amount === ''))) {
      wx.showToast({ title: '请补全药物和剂量', icon: 'none' });
      return;
    }
    if (groups.some(group => group.items.some(item => item.category === 'custom' && !String(item.name || '').trim()))) {
      wx.showToast({ title: '请填写自定义药物名称', icon: 'none' });
      return;
    }
    if (!form.startTime) {
      wx.showToast({ title: '请填写开始时间', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });

    try {
      const payload = {
        date: dateKey,
        recordType: form.recordType,
        startTime: form.startTime,
        notes: form.notes,
        groups
      };
      const result = isEdit
        ? await TreatmentRecordModel.update(recordId, payload)
        : await TreatmentRecordModel.create(payload);
      if (!result.success) {
        throw new Error(result.message || '保存失败');
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
      await this.notifyPreviousPageRefresh();
      setTimeout(() => {
        if (getCurrentPages().length > 1) {
          wx.navigateBack();
          return;
        }
        wx.switchTab({ url: '/pages/daily-feeding/index' });
      }, 400);
    } catch (error) {
      console.error('保存治疗记录失败:', error);
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  async deleteRecord() {
    if (!this.data.recordId) return;
    wx.showModal({
      title: '删除治疗记录',
      content: '删除后不可恢复，确认删除吗？',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        try {
          const result = await TreatmentRecordModel.delete(this.data.recordId);
          if (!result.success) {
            throw new Error(result.message || '删除失败');
          }
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.notifyPreviousPageRefresh();
          setTimeout(() => {
            wx.navigateBack();
          }, 400);
        } catch (error) {
          console.error('删除治疗记录失败:', error);
          wx.showToast({ title: error.message || '删除失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  }
});
