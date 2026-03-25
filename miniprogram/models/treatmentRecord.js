const {
  calculateTreatmentRecordSummary,
  calculateTreatmentGroupSummary,
  shouldCountInNutrition,
  getDefaultTreatmentGroupName
} = require('../utils/treatmentUtils');

class TreatmentRecordModel {
  constructor() {
    this.db = wx.cloud.database();
    this.collection = this.db.collection('treatment_records');
  }

  getDateStart(date) {
    const target = date instanceof Date ? date : new Date(date);
    return new Date(target.getFullYear(), target.getMonth(), target.getDate());
  }

  getDateEnd(date) {
    const start = this.getDateStart(date);
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  }

  getDateKey(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  buildDateTime(dateKey, timeValue = '00:00') {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const [hours, minutes] = String(timeValue || '00:00').split(':').map(Number);
    return new Date(
      Number.isFinite(year) ? year : new Date().getFullYear(),
      Number.isFinite(month) ? month - 1 : 0,
      Number.isFinite(day) ? day : 1,
      Number.isFinite(hours) ? hours : 0,
      Number.isFinite(minutes) ? minutes : 0,
      0
    );
  }

  normalizeItem(item = {}) {
    const amount = item.amount === '' || item.amount === undefined
      ? (item.volumeMl === '' || item.volumeMl === undefined ? '' : Number(item.volumeMl))
      : Number(item.amount);
    return {
      id: item.id || `treatment_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category: item.category || '',
      name: String(item.name || '').trim(),
      amount: amount === '' ? '' : amount,
      unit: item.unit || 'ml',
      calories: item.calories === '' || item.calories === undefined ? '' : Number(item.calories),
      carbsG: item.carbsG === '' || item.carbsG === undefined ? '' : Number(item.carbsG),
      proteinG: item.proteinG === '' || item.proteinG === undefined ? '' : Number(item.proteinG),
      fatG: item.fatG === '' || item.fatG === undefined ? '' : Number(item.fatG),
      countInNutrition: shouldCountInNutrition(item),
      notes: String(item.notes || '').trim()
    };
  }

  normalizeGroup(group = {}, index = 0, dateKey = '') {
    const items = Array.isArray(group.items) ? group.items.map(item => this.normalizeItem(item)) : [];
    return {
      id: group.id || `treatment_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: String(group.name || '').trim() || getDefaultTreatmentGroupName(index),
      items,
      summary: calculateTreatmentGroupSummary({ items }),
      notes: String(group.notes || '').trim()
    };
  }

  buildRecordPayload(data = {}, babyUid) {
    const dateKey = data.date || this.getDateKey(new Date());
    const groups = Array.isArray(data.groups)
      ? data.groups.map((group, index) => this.normalizeGroup(group, index, dateKey))
      : [];
    const summary = calculateTreatmentRecordSummary(groups);
    const startTime = data.startTime || '';

    return {
      babyUid,
      date: this.getDateStart(this.buildDateTime(dateKey, '00:00')),
      dateKey,
      recordType: data.recordType || 'iv',
      notes: String(data.notes || '').trim(),
      startTime,
      startDateTime: startTime ? this.buildDateTime(dateKey, startTime) : null,
      groups,
      summary
    };
  }

  async create(data) {
    try {
      const app = getApp();
      const babyUid = data.babyUid || app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        throw new Error('未找到宝宝信息');
      }
      const record = this.buildRecordPayload(data, babyUid);
      const result = await this.collection.add({
        data: {
          ...record,
          createdAt: this.db.serverDate(),
          updatedAt: this.db.serverDate()
        }
      });
      return { success: true, data: result };
    } catch (error) {
      console.error('创建治疗记录失败:', error);
      return { success: false, message: error.message || '创建失败' };
    }
  }

  async update(id, data) {
    try {
      const app = getApp();
      const babyUid = data.babyUid || app.globalData.babyUid || wx.getStorageSync('baby_uid');
      const record = this.buildRecordPayload(data, babyUid);
      const result = await this.collection.doc(id).update({
        data: {
          ...record,
          updatedAt: this.db.serverDate()
        }
      });
      return { success: true, data: result };
    } catch (error) {
      console.error('更新治疗记录失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }

  async delete(id) {
    try {
      const result = await this.collection.doc(id).remove();
      return { success: true, data: result };
    } catch (error) {
      console.error('删除治疗记录失败:', error);
      return { success: false, message: error.message || '删除失败' };
    }
  }

  async findByDate(dateStr, babyUid) {
    try {
      const [year, month, day] = String(dateStr).split('-').map(Number);
      const targetDate = new Date(year, month - 1, day);
      const startOfDay = this.getDateStart(targetDate);
      const endOfDay = this.getDateEnd(targetDate);
      const result = await this.collection
        .where({
          babyUid,
          date: this.db.command.gte(startOfDay).and(this.db.command.lt(endOfDay))
        })
        .orderBy('startDateTime', 'desc')
        .get();
      return { success: true, data: result.data || [] };
    } catch (error) {
      console.error('查询治疗记录失败:', error);
      return { success: false, message: error.message || '查询失败', data: [] };
    }
  }

  async getById(id) {
    try {
      const result = await this.collection.doc(id).get();
      return { success: true, data: result.data || null };
    } catch (error) {
      console.error('获取治疗记录失败:', error);
      return { success: false, message: error.message || '获取失败', data: null };
    }
  }
}

module.exports = new TreatmentRecordModel();
