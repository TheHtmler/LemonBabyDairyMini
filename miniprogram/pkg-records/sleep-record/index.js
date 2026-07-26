const SleepRecordModel = require('../../models/sleepRecord');
const { getBabyUid } = require('../../utils/index');

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function createForm(overrides = {}) {
  return {
    startTime: overrides.startTime || formatTime(),
    endTime: overrides.endTime || '',
    notes: overrides.notes || ''
  };
}

Page({
  data: {
    dateKey: '',
    editingId: '',
    isEdit: false,
    saving: false,
    deleting: false,
    form: createForm()
  },

  async onLoad(options = {}) {
    const dateKey = options.date || getTodayDateKey();
    const editingId = options.id || '';
    this.setData({
      dateKey,
      editingId,
      isEdit: !!editingId,
      form: createForm()
    });

    if (!getBabyUid()) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
    }
    if (editingId) {
      await this.loadRecord(editingId);
    }
  },

  async loadRecord(id) {
    wx.showLoading({ title: '加载中...' });
    try {
      const result = await SleepRecordModel.getById(id);
      if (!result.success || !result.data) {
        wx.showToast({ title: result.message || '记录不存在', icon: 'none' });
        return;
      }
      const record = result.data;
      this.setData({
        dateKey: record.dateKey || record.date || this.data.dateKey,
        form: createForm(record)
      });
    } catch (error) {
      console.error('加载睡眠记录失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onStartTimeChange(e) {
    this.setData({ 'form.startTime': e.detail.value });
  },

  onEndTimeChange(e) {
    this.setData({ 'form.endTime': e.detail.value });
  },

  clearEndTime() {
    this.setData({ 'form.endTime': '' });
  },

  onNotesInput(e) {
    this.setData({ 'form.notes': e.detail.value });
  },

  cancelEdit() {
    wx.navigateBack();
  },

  async chooseOngoingAction() {
    return new Promise((resolve) => {
      wx.showActionSheet({
        itemList: ['补结束并继续新建', '先去结束上一段'],
        success: result => resolve(result.tapIndex),
        fail: () => resolve(-1)
      });
    });
  },

  openOngoingRecord(id) {
    const url = `/pkg-records/sleep-record/index?id=${encodeURIComponent(id)}&date=${encodeURIComponent(this.data.dateKey)}`;
    wx.redirectTo({ url });
  },

  async ensureNoOngoingOrHandle(babyUid) {
    if (this.data.isEdit || this.data.editingId) return true;

    const ongoingResult = await SleepRecordModel.findOngoing(babyUid);
    if (!ongoingResult.success) {
      wx.showToast({ title: ongoingResult.message || '检查进行中睡眠失败', icon: 'none' });
      return false;
    }
    const ongoing = (ongoingResult.data || [])[0];
    if (!ongoing) return true;

    const action = await this.chooseOngoingAction();
    if (action === 1) {
      this.openOngoingRecord(ongoing._id);
      return false;
    }
    if (action !== 0) return false;

    const completeResult = await SleepRecordModel.completeSleep(ongoing._id, formatTime());
    if (!completeResult.success) {
      if (completeResult.code === 'INVALID_END') {
        this.openOngoingRecord(ongoing._id);
      } else {
        wx.showToast({ title: completeResult.message || '补结束失败', icon: 'none' });
      }
      return false;
    }
    return true;
  },

  async refreshPreviousPage() {
    const pages = getCurrentPages();
    const previousPage = pages[pages.length - 2];
    if (previousPage && typeof previousPage.forceRefreshData === 'function') {
      await previousPage.forceRefreshData();
    }
  },

  async saveRecord() {
    const { dateKey, editingId, isEdit, form, saving } = this.data;
    if (saving) return;
    if (!form.startTime) {
      wx.showToast({ title: '请选择开始时间', icon: 'none' });
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const canSave = await this.ensureNoOngoingOrHandle(babyUid);
      if (!canSave) return;

      wx.showLoading({ title: '保存中...' });
      const payload = {
        babyUid,
        date: dateKey,
        startTime: form.startTime,
        endTime: form.endTime || null,
        notes: form.notes || ''
      };
      const result = isEdit
        ? await SleepRecordModel.update(editingId, payload)
        : await SleepRecordModel.create(payload);
      wx.hideLoading();

      if (!result.success) {
        wx.showToast({ title: result.message || '保存失败', icon: 'none' });
        return;
      }
      await this.refreshPreviousPage();
      wx.showToast({ title: isEdit ? '已更新' : '已记录', icon: 'success' });
      wx.navigateBack();
    } catch (error) {
      console.error('保存睡眠记录失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  deleteRecord() {
    const { editingId, deleting } = this.data;
    if (!editingId || deleting) return;

    wx.showModal({
      title: '删除睡眠记录',
      content: '确定删除这条睡眠记录吗？',
      confirmColor: '#E16852',
      success: async (modalResult) => {
        if (!modalResult.confirm) return;
        this.setData({ deleting: true });
        try {
          const result = await SleepRecordModel.delete(editingId);
          if (!result.success) {
            wx.showToast({ title: result.message || '删除失败', icon: 'none' });
            return;
          }
          await this.refreshPreviousPage();
          wx.showToast({ title: '已删除', icon: 'success' });
          wx.navigateBack();
        } catch (error) {
          console.error('删除睡眠记录失败:', error);
          wx.showToast({ title: '删除失败', icon: 'none' });
        } finally {
          this.setData({ deleting: false });
        }
      }
    });
  }
});
