const {
  normalizeDateKey,
  validateDayMarkPayload
} = require('../utils/dayCalendarMarkUtils');

class DayCalendarMarkModel {
  constructor() {
    this.db = wx.cloud.database();
    this.collection = this.db.collection('day_calendar_marks');
  }

  async findByDate(babyUid, dateStr) {
    const date = normalizeDateKey(dateStr);
    if (!babyUid || !date) return [];

    try {
      const res = await this.collection
        .where({
          babyUid,
          date,
          status: 'active'
        })
        .orderBy('createdAt', 'asc')
        .get();
      return res?.data || [];
    } catch (error) {
      console.error('查询日标记失败:', error);
      return [];
    }
  }

  async findByDateRange(babyUid, startDate, endDate) {
    const start = normalizeDateKey(startDate);
    const end = normalizeDateKey(endDate);
    if (!babyUid || !start || !end) return [];

    try {
      const res = await this.collection
        .where({
          babyUid,
          status: 'active',
          date: this.db.command.gte(start).and(this.db.command.lte(end))
        })
        .get();
      return res?.data || [];
    } catch (error) {
      console.error('查询日标记范围失败:', error);
      return [];
    }
  }

  async create(babyUid, payload = {}) {
    const validation = validateDayMarkPayload(payload);
    if (!validation.isValid) {
      return { success: false, message: validation.errors[0] || '数据无效' };
    }

    const date = normalizeDateKey(payload.date);
    if (!babyUid || !date) {
      return { success: false, message: '缺少宝宝或日期信息' };
    }

    try {
      const record = {
        babyUid,
        date,
        label: validation.normalized.label,
        presetKey: validation.normalized.presetKey,
        color: validation.normalized.color,
        note: validation.normalized.note,
        time: validation.normalized.time,
        status: 'active',
        createdAt: this.db.serverDate(),
        updatedAt: this.db.serverDate()
      };
      const result = await this.collection.add({ data: record });
      return { success: true, data: { ...record, _id: result._id } };
    } catch (error) {
      console.error('创建日标记失败:', error);
      return { success: false, message: error.message || '保存失败' };
    }
  }

  async update(id, babyUid, payload = {}) {
    if (!id || !babyUid) {
      return { success: false, message: '缺少记录信息' };
    }

    const validation = validateDayMarkPayload(payload);
    if (!validation.isValid) {
      return { success: false, message: validation.errors[0] || '数据无效' };
    }

    try {
      await this.collection.doc(id).update({
        data: {
          label: validation.normalized.label,
          presetKey: validation.normalized.presetKey,
          color: validation.normalized.color,
          note: validation.normalized.note,
          time: validation.normalized.time,
          updatedAt: this.db.serverDate()
        }
      });
      return { success: true };
    } catch (error) {
      console.error('更新日标记失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }

  async remove(id, babyUid) {
    if (!id || !babyUid) {
      return { success: false, message: '缺少记录信息' };
    }

    try {
      await this.collection.doc(id).remove();
      return { success: true };
    } catch (error) {
      console.error('删除日标记失败:', error);
      return { success: false, message: error.message || '删除失败' };
    }
  }
}

module.exports = new DayCalendarMarkModel();
