const DailySummaryV2Model = require('../../models/dailySummaryV2');
const { getBabyUid } = require('../../utils/index');

const TYPE_OPTIONS = [
  { value: 'stool', label: '大便', icon: '💩', tip: '记录性状颜色' },
  { value: 'urine', label: '小便', icon: '💧', tip: '快速记尿尿' },
  { value: 'mixed', label: '混合', icon: '🌈', tip: '尿布里都有' }
];

const CONSISTENCY_OPTIONS = [
  { value: 'liquid', label: '水样', icon: '💧' },
  { value: 'loose', label: '稀便', icon: '🌊' },
  { value: 'soft', label: '糊状', icon: '🥣' },
  { value: 'normal', label: '正常', icon: '💩' },
  { value: 'hard', label: '干硬', icon: '🪨' }
];

const COLOR_OPTIONS = [
  { value: 'yellow', label: '黄色', icon: '🟡' },
  { value: 'green', label: '绿色', icon: '🟢' },
  { value: 'brown', label: '褐色', icon: '🟤' },
  { value: 'white', label: '白色', icon: '⚪' },
  { value: 'red', label: '红色', icon: '🔴' },
  { value: 'black', label: '黑色', icon: '⚫' }
];

const SMELL_OPTIONS = [
  { value: 'normal', label: '正常', icon: '🌿' },
  { value: 'sour', label: '酸臭', icon: '🍋' },
  { value: 'fishy', label: '腥臭', icon: '🐟' },
  { value: 'odorless', label: '无味', icon: '☁' }
];

const AMOUNT_OPTIONS = [
  { value: 'small', label: '少量', icon: '🥄' },
  { value: 'medium', label: '适量', icon: '🫙' },
  { value: 'large', label: '大量', icon: '🪣' }
];

const URINE_AMOUNT_OPTIONS = [
  { value: 'small', label: '偏少', icon: '💧' },
  { value: 'medium', label: '正常', icon: '💦' },
  { value: 'large', label: '较多', icon: '🌊' }
];

const URINE_COLOR_OPTIONS = [
  { value: 'clear', label: '清亮', icon: '⚪' },
  { value: 'light_yellow', label: '淡黄', icon: '🟡' },
  { value: 'dark_yellow', label: '深黄', icon: '🟠' }
];

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getBowelTypeIcon(type) {
  const option = TYPE_OPTIONS.find(item => item.value === type);
  return option ? option.icon : '🧷';
}

function getCurrentOpenid() {
  return getApp().globalData.openid || wx.getStorageSync('openid') || '';
}

function createForm(overrides = {}) {
  const type = overrides.type || 'stool';
  return {
    time: overrides.time || overrides.timeString || formatTime(new Date()),
    type,
    typeIcon: getBowelTypeIcon(type),
    consistency: overrides.consistency || '',
    color: overrides.color || '',
    smell: overrides.smell || '',
    amount: overrides.amount || '',
    urineAmount: overrides.urineAmount || '',
    urineColor: overrides.urineColor || '',
    notes: overrides.notes || ''
  };
}

function buildRecordTime(dateKey, time) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const [hours, minutes] = String(time).split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

Page({
  data: {
    dateKey: '',
    recordId: '',
    isEdit: false,
    saving: false,
    typeOptions: TYPE_OPTIONS,
    consistencyOptions: CONSISTENCY_OPTIONS,
    colorOptions: COLOR_OPTIONS,
    smellOptions: SMELL_OPTIONS,
    amountOptions: AMOUNT_OPTIONS,
    urineAmountOptions: URINE_AMOUNT_OPTIONS,
    urineColorOptions: URINE_COLOR_OPTIONS,
    form: createForm()
  },

  async onLoad(options = {}) {
    const dateKey = options.date || getTodayDateKey();
    const recordId = options.id || '';
    this.setData({
      dateKey,
      recordId,
      isEdit: !!recordId,
      form: createForm()
    });

    if (recordId) {
      await this.loadRecord(recordId);
    }
  },

  async loadRecord(recordId) {
    try {
      wx.showLoading({ title: '加载中...' });
      const db = wx.cloud.database();
      const result = await db.collection('bowel_records').doc(recordId).get();
      const record = result.data || {};
      this.setData({
        form: createForm(record)
      });
      wx.hideLoading();
    } catch (error) {
      console.error('加载排便记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onTimeChange(e) {
    this.setData({ 'form.time': e.detail.value });
  },

  onTypeSelect(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      'form.type': type,
      'form.typeIcon': getBowelTypeIcon(type)
    });
  },

  onOptionSelect(e) {
    const { field, value } = e.currentTarget.dataset;
    const currentValue = this.data.form?.[field];
    this.setData({ [`form.${field}`]: currentValue === value ? '' : value });
  },

  onNotesInput(e) {
    this.setData({ 'form.notes': e.detail.value });
  },

  buildPayload() {
    const { dateKey, form } = this.data;
    const payload = {
      type: form.type,
      recordTime: buildRecordTime(dateKey, form.time),
      timeString: form.time,
      notes: form.notes || ''
    };

    if (form.type === 'stool' || form.type === 'mixed') {
      payload.consistency = form.consistency || '';
      payload.color = form.color || '';
      payload.smell = form.smell || '';
      payload.amount = form.amount || '';
    } else {
      payload.consistency = '';
      payload.color = '';
      payload.smell = '';
      payload.amount = '';
    }

    if (form.type === 'urine' || form.type === 'mixed') {
      payload.urineAmount = form.urineAmount || '';
      payload.urineColor = form.urineColor || '';
    } else {
      payload.urineAmount = '';
      payload.urineColor = '';
    }

    return payload;
  },

  async refreshPreviousPage() {
    const pages = getCurrentPages();
    const previousPage = pages[pages.length - 2];
    if (previousPage && typeof previousPage.forceRefreshData === 'function') {
      await previousPage.forceRefreshData();
    }
  },

  async saveBowelRecord() {
    const { dateKey, recordId, isEdit, form } = this.data;
    if (!form.time) {
      wx.showToast({ title: '请选择时间', icon: 'none' });
      return;
    }
    if (!form.type) {
      wx.showToast({ title: '请选择类型', icon: 'none' });
      return;
    }

    try {
      this.setData({ saving: true });
      wx.showLoading({ title: '保存中...' });
      const babyUid = getBabyUid();
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
        return;
      }
      const db = wx.cloud.database();
      const payload = this.buildPayload();
      const openid = getCurrentOpenid();

      if (isEdit) {
        await db.collection('bowel_records').doc(recordId).update({
          data: {
            ...payload,
            updatedAt: new Date(),
            updatedBy: openid
          }
        });
      } else {
        await db.collection('bowel_records').add({
          data: {
            ...payload,
            babyUid,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: openid,
            updatedBy: openid
          }
        });
      }

      await DailySummaryV2Model.markDirty(babyUid, dateKey);
      await this.refreshPreviousPage();
      wx.hideLoading();
      wx.showToast({ title: isEdit ? '更新成功' : '记录成功', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      console.error('保存排便记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
