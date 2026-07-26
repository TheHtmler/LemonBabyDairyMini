/**
 * 睡眠记录数据模型
 * 管理 sleep_records 集合的 CRUD，写路径失效当日 daily_summary_v2
 */

const DailySummaryV2Model = require('./dailySummaryV2');
const {
  buildDateTime,
  resolveEndDateTime,
  resolveWakeEndDateTime,
  computeDurationMinutes,
  isOngoingSleep
} = require('../utils/sleepRecordUtils');

class SleepRecordModel {
  constructor() {
    this.db = wx.cloud.database();
    this.collection = this.db.collection('sleep_records');
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

  formatTimeString(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

  buildPayload(data = {}, babyUid) {
    const dateKey = data.date || data.dateKey || this.getDateKey(new Date());
    const startTime = String(data.startTime || '').trim();
    if (!startTime) {
      throw new Error('开始时间必填');
    }

    const startDateTime = buildDateTime(dateKey, startTime);
    const endTimeRaw = data.endTime;
    const hasEndTime = endTimeRaw != null && String(endTimeRaw).trim() !== '';

    const notes = String(data.notes || '').trim();
    const payload = {
      babyUid,
      date: dateKey,
      dateKey,
      startTime,
      startDateTime,
      status: data.status || 'active'
    };

    if (hasEndTime) {
      const endTime = String(endTimeRaw).trim();
      let endDateTime = null;
      if (data.endDateTime instanceof Date && !Number.isNaN(data.endDateTime.getTime())) {
        endDateTime = data.endDateTime;
        if (!(endDateTime > startDateTime)) {
          throw new Error('结束时间无效');
        }
      } else {
        endDateTime = resolveEndDateTime(dateKey, startTime, endTime);
      }
      if (!endDateTime) {
        throw new Error('结束时间无效');
      }
      payload.endTime = endTime;
      payload.endDateTime = endDateTime;
      payload.durationMinutes = computeDurationMinutes(startDateTime, endDateTime);
    } else {
      payload.endTime = null;
      payload.endDateTime = null;
      payload.durationMinutes = null;
    }

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
      console.error('创建睡眠记录失败:', error);
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
      console.error('更新睡眠记录失败:', error);
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
      console.error('删除睡眠记录失败:', error);
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
        const startOfDay = this.getDateStart(buildDateTime(dateKey, '00:00'));
        const endOfDay = this.getDateEnd(startOfDay);
        const rangeRes = await this.collection
          .where({
            babyUid,
            startDateTime: this.db.command.gte(startOfDay).and(this.db.command.lt(endOfDay)),
            status: 'active'
          })
          .orderBy('startDateTime', 'desc')
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
        .orderBy('startDateTime', 'desc')
        .get();
      return { success: true, data: result.data || [] };
    } catch (error) {
      console.error('查询睡眠记录失败:', error);
      return { success: false, message: error.message || '查询失败', data: [] };
    }
  }

  async findOngoing(babyUid) {
    try {
      if (!babyUid) {
        return { success: true, data: [] };
      }
      const result = await this.collection
        .where({
          babyUid,
          status: 'active'
        })
        .get();
      const records = (result.data || []).filter(isOngoingSleep);
      return { success: true, data: records };
    } catch (error) {
      console.error('查询进行中睡眠失败:', error);
      return { success: false, message: error.message || '查询失败', data: [] };
    }
  }

  async completeSleep(id, endTimeOptional) {
    try {
      const existing = await this.getById(id);
      const record = existing?.data;
      if (!record || !isOngoingSleep(record)) {
        return { success: true };
      }
      const dateKey = record.dateKey || record.date;
      const startDateTime = record.startDateTime instanceof Date
        ? record.startDateTime
        : buildDateTime(dateKey, record.startTime);

      let endTime;
      let endDateTime;
      if (endTimeOptional != null && String(endTimeOptional).trim() !== '') {
        // 手选钟点：仍按归属日拼装（含跨午夜）
        endTime = String(endTimeOptional).trim();
        endDateTime = resolveEndDateTime(dateKey, record.startTime, endTime);
      } else {
        // 一键醒来：用真实墙钟，避免跨自然日被拼成短时长
        endDateTime = resolveWakeEndDateTime(startDateTime, new Date());
        endTime = endDateTime ? this.formatTimeString(endDateTime) : '';
      }

      if (!endDateTime) {
        return { success: false, code: 'INVALID_END', message: '结束时间无效' };
      }
      return await this.update(id, { endTime, endDateTime });
    } catch (error) {
      console.error('完成睡眠记录失败:', error);
      return { success: false, message: error.message || '完成失败' };
    }
  }
}

module.exports = new SleepRecordModel();
