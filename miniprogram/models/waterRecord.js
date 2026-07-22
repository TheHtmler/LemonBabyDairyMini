/**
 * 喝水记录数据模型
 * 管理 water_records 集合的 CRUD，写路径失效当日 daily_summary_v2
 */

const DailySummaryV2Model = require('./dailySummaryV2');

class WaterRecordModel {
  constructor() {
    this.db = wx.cloud.database();
    this.collection = this.db.collection('water_records');
  }

  getDateKey(dateInput) {
    if (!dateInput) return '';
    if (typeof dateInput === 'string') {
      const matched = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
    }
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  getDateStart(date) {
    const target = date instanceof Date ? date : new Date(date);
    return new Date(target.getFullYear(), target.getMonth(), target.getDate());
  }

  getDateEnd(date) {
    const start = this.getDateStart(date);
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  }

  buildRecordTime(dateKey, timeString = '00:00') {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const [hours, minutes] = String(timeString || '00:00').split(':').map(Number);
    return new Date(
      Number.isFinite(year) ? year : new Date().getFullYear(),
      Number.isFinite(month) ? month - 1 : 0,
      Number.isFinite(day) ? day : 1,
      Number.isFinite(hours) ? hours : 0,
      Number.isFinite(minutes) ? minutes : 0,
      0,
      0
    );
  }

  async markSummaryDirty(babyUid, dateInput) {
    const dateKey = this.getDateKey(dateInput);
    if (!babyUid || !dateKey) return;
    try {
      await DailySummaryV2Model.markDirty(babyUid, dateKey);
    } catch (error) {
      console.error('标记当日汇总失效失败:', error);
    }
  }

  normalizeVolumeMl(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      throw new Error('请输入有效的喝水量');
    }
    return Math.round(num);
  }

  buildPayload(data = {}, babyUid) {
    const dateKey = data.date || data.dateKey || this.getDateKey(new Date());
    const timeString = data.timeString || data.time || '00:00';
    const volumeMl = this.normalizeVolumeMl(data.volumeMl ?? data.volume);
    const recordTime = data.recordTime instanceof Date
      ? data.recordTime
      : this.buildRecordTime(dateKey, timeString);

    const notes = String(data.notes || '').trim();
    const payload = {
      babyUid,
      date: dateKey,
      dateKey,
      recordTime,
      timeString,
      volumeMl,
      status: data.status || 'active'
    };
    if (notes) {
      payload.notes = notes;
    } else if (Object.prototype.hasOwnProperty.call(data, 'notes')) {
      // 编辑时清空备注
      payload.notes = '';
    }
    return payload;
  }

  async getById(id) {
    try {
      const res = await this.collection.doc(id).get();
      return { success: true, data: res?.data || null };
    } catch (error) {
      return { success: false, message: error.message || '查询失败', data: null };
    }
  }

  async create(data = {}) {
    try {
      const app = getApp();
      const babyUid = data.babyUid || app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        throw new Error('未找到宝宝信息');
      }
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';
      const payload = this.buildPayload(data, babyUid);
      const result = await this.collection.add({
        data: {
          ...payload,
          createdAt: this.db.serverDate(),
          updatedAt: this.db.serverDate(),
          createdBy: openid,
          updatedBy: openid
        }
      });
      await this.markSummaryDirty(babyUid, payload.dateKey);
      return { success: true, data: result };
    } catch (error) {
      console.error('创建喝水记录失败:', error);
      return { success: false, message: error.message || '创建失败' };
    }
  }

  async update(id, data = {}) {
    try {
      const app = getApp();
      const babyUid = data.babyUid || app.globalData.babyUid || wx.getStorageSync('baby_uid');
      const openid = app.globalData.openid || wx.getStorageSync('openid') || '';
      const previous = await this.getById(id);
      const previousRecord = previous?.data || {};
      const payload = this.buildPayload({
        ...previousRecord,
        ...data,
        date: data.date || data.dateKey || previousRecord.dateKey || previousRecord.date
      }, babyUid || previousRecord.babyUid);
      const result = await this.collection.doc(id).update({
        data: {
          ...payload,
          updatedAt: this.db.serverDate(),
          updatedBy: openid
        }
      });
      const previousBabyUid = previousRecord.babyUid || babyUid;
      const previousDateKey = previousRecord.dateKey || previousRecord.date || '';
      await this.markSummaryDirty(babyUid || previousBabyUid, payload.dateKey);
      if (previousDateKey && (previousDateKey !== payload.dateKey || previousBabyUid !== (babyUid || previousBabyUid))) {
        await this.markSummaryDirty(previousBabyUid, previousDateKey);
      }
      return { success: true, data: result };
    } catch (error) {
      console.error('更新喝水记录失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }

  async delete(id) {
    try {
      const existing = await this.getById(id);
      const existingRecord = existing?.data || {};
      const result = await this.collection.doc(id).remove();
      await this.markSummaryDirty(
        existingRecord.babyUid,
        existingRecord.dateKey || existingRecord.date
      );
      return { success: true, data: result };
    } catch (error) {
      console.error('删除喝水记录失败:', error);
      return { success: false, message: error.message || '删除失败' };
    }
  }

  async findByDate(dateStr, babyUid) {
    try {
      const dateKey = this.getDateKey(dateStr);
      if (!babyUid || !dateKey) {
        return { success: true, data: [] };
      }

      if (this.db.command?.gte && this.db.command?.lt) {
        const startOfDay = this.getDateStart(this.buildRecordTime(dateKey, '00:00'));
        const endOfDay = this.getDateEnd(startOfDay);
        const rangeRes = await this.collection
          .where({
            babyUid,
            recordTime: this.db.command.gte(startOfDay).and(this.db.command.lt(endOfDay)),
            status: 'active'
          })
          .orderBy('recordTime', 'desc')
          .get();
        if ((rangeRes.data || []).length > 0) {
          return { success: true, data: rangeRes.data || [] };
        }
      }

      const result = await this.collection
        .where({
          babyUid,
          date: dateKey,
          status: 'active'
        })
        .orderBy('recordTime', 'desc')
        .get();
      return { success: true, data: result.data || [] };
    } catch (error) {
      console.error('查询喝水记录失败:', error);
      return { success: false, message: error.message || '查询失败', data: [] };
    }
  }
}

module.exports = new WaterRecordModel();
