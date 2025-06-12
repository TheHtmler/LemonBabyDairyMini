/**
 * 药物记录数据模型
 * 管理 medication_records 集合的 CRUD 操作
 */

class MedicationRecordModel {
  constructor() {
    this.db = wx.cloud.database();
    this.collection = this.db.collection('medication_records');
  }

  /**
   * 创建药物记录
   * @param {Object} data 药物记录数据
   * @returns {Promise}
   */
  async create(data) {
    try {
      const result = await this.addRecord(data);
      return { success: true, data: result };
    } catch (error) {
      console.error('创建药物记录失败:', error);
      return { success: false, message: error.message || '创建失败' };
    }
  }

  /**
   * 添加药物记录
   * @param {Object} data 药物记录数据
   * @returns {Promise}
   */
  async addRecord(data) {
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    
    const record = {
      babyUid: babyUid,
      date: this.getDateStart(new Date()),
      medicationId: data.medicationId,
      medicationName: data.medicationName,
      dosage: data.dosage,
      unit: data.unit,
      frequency: data.frequency,
      actualTime: data.actualTime,
      actualDateTime: data.actualDateTime,
      createdAt: this.db.serverDate(),
      updatedAt: this.db.serverDate()
    };

    return await this.collection.add({ data: record });
  }

  /**
   * 查询指定日期的药物记录（统一接口）
   * @param {string} dateStr 日期字符串 YYYY-MM-DD
   * @param {string} babyUid 宝宝UID
   * @returns {Promise}
   */
  async findByDate(dateStr, babyUid) {
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const result = await this.getRecordsByDate(date, babyUid);
      return { success: true, data: result.data || [] };
    } catch (error) {
      console.error('查询药物记录失败:', error);
      return { success: false, message: error.message || '查询失败', data: [] };
    }
  }

  /**
   * 获取指定日期的药物记录
   * @param {Date} date 日期
   * @param {string} babyUid 宝宝UID
   * @returns {Promise}
   */
  async getRecordsByDate(date, babyUid) {
    const startOfDay = this.getDateStart(date);
    const endOfDay = this.getDateEnd(date);
    
    return await this.collection
      .where({
        babyUid: babyUid,
        date: this.db.command.gte(startOfDay).and(this.db.command.lt(endOfDay))
      })
      .orderBy('actualDateTime', 'desc')
      .get();
  }

  /**
   * 获取今日药物记录
   * @param {string} babyUid 宝宝UID
   * @returns {Promise}
   */
  async getTodayRecords(babyUid) {
    return await this.getRecordsByDate(new Date(), babyUid);
  }

  /**
   * 更新药物记录（统一接口）
   * @param {string} id 记录ID
   * @param {Object} data 更新数据
   * @returns {Promise}
   */
  async update(id, data) {
    try {
      const result = await this.updateRecord(id, data);
      return { success: true, data: result };
    } catch (error) {
      console.error('更新药物记录失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }

  /**
   * 更新药物记录
   * @param {string} id 记录ID
   * @param {Object} data 更新数据
   * @returns {Promise}
   */
  async updateRecord(id, data) {
    const updateData = {
      ...data,
      updatedAt: this.db.serverDate()
    };

    return await this.collection.doc(id).update({
      data: updateData
    });
  }

  /**
   * 删除药物记录（统一接口）
   * @param {string} id 记录ID
   * @returns {Promise}
   */
  async delete(id) {
    try {
      const result = await this.deleteRecord(id);
      return { success: true, data: result };
    } catch (error) {
      console.error('删除药物记录失败:', error);
      return { success: false, message: error.message || '删除失败' };
    }
  }

  /**
   * 删除药物记录
   * @param {string} id 记录ID
   * @returns {Promise}
   */
  async deleteRecord(id) {
    return await this.collection.doc(id).remove();
  }

  /**
   * 批量删除药物记录
   * @param {Array} ids 记录ID数组
   * @returns {Promise}
   */
  async batchDeleteRecords(ids) {
    const promises = ids.map(id => this.deleteRecord(id));
    return await Promise.all(promises);
  }

  /**
   * 检查某个药物今日是否已服用
   * @param {string} medicationId 药物ID
   * @param {string} babyUid 宝宝UID
   * @returns {Promise<boolean>}
   */
  async hasTakenToday(medicationId, babyUid) {
    const today = new Date();
    const startOfDay = this.getDateStart(today);
    const endOfDay = this.getDateEnd(today);
    
    const result = await this.collection
      .where({
        babyUid: babyUid,
        medicationId: medicationId,
        date: this.db.command.gte(startOfDay).and(this.db.command.lt(endOfDay))
      })
      .count();
    
    return result.total > 0;
  }

  /**
   * 获取某个时间段的药物记录统计
   * @param {Date} startDate 开始日期
   * @param {Date} endDate 结束日期
   * @param {string} babyUid 宝宝UID
   * @returns {Promise}
   */
  async getRecordsInRange(startDate, endDate, babyUid) {
    const start = this.getDateStart(startDate);
    const end = this.getDateEnd(endDate);
    
    return await this.collection
      .where({
        babyUid: babyUid,
        date: this.db.command.gte(start).and(this.db.command.lt(end))
      })
      .orderBy('actualDateTime', 'desc')
      .get();
  }



  /**
   * 按药物名称分组记录
   * @param {Array} records 药物记录数组
   * @returns {Array}
   */
  groupRecordsByMedication(records) {
    if (!records || records.length === 0) {
      return [];
    }

    const groups = {};
    records.forEach((record) => {
      const medicationName = record.medicationName;
      if (!groups[medicationName]) {
        groups[medicationName] = [];
      }
      groups[medicationName].push({
        ...record
      });
    });

    return Object.keys(groups).map(medicationName => {
      const records = groups[medicationName].sort((a, b) => {
        // 按actualDateTime倒序排序（更准确）
        if (a.actualDateTime && b.actualDateTime) {
          const aTime = new Date(a.actualDateTime);
          const bTime = new Date(b.actualDateTime);
          return bTime - aTime;
        }
        
        // 如果没有actualDateTime，则使用actualTime字符串比较
        if (a.actualTime && b.actualTime) {
          const aTimeParts = a.actualTime.split(':').map(Number);
          const bTimeParts = b.actualTime.split(':').map(Number);
          
          if (aTimeParts[0] !== bTimeParts[0]) {
            return bTimeParts[0] - aTimeParts[0];
          }
          return bTimeParts[1] - aTimeParts[1];
        }
        
        return 0;
      });

      return {
        medicationName: medicationName,
        records: records,
        totalCount: records.length
      };
    }).sort((a, b) => a.medicationName.localeCompare(b.medicationName));
  }

  /**
   * 获取一天的开始时间
   * @param {Date} date 
   * @returns {Date}
   */
  getDateStart(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /**
   * 获取一天的结束时间
   * @param {Date} date 
   * @returns {Date}
   */
  getDateEnd(date) {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end;
  }
}

module.exports = new MedicationRecordModel(); 