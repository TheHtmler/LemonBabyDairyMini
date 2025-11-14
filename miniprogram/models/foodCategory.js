// 食物分类数据模型，支持云端存储自定义分类
const db = wx.cloud.database();
const _ = db.command;

class FoodCategoryModel {
  constructor() {
    this.collection = db.collection('food_categories');
  }

  /**
   * 归一化分类名称（去除空白、统一大小写判断）
   * @param {string} name
   * @returns {{display: string, key: string}}
   */
  _normalizeName(name) {
    const display = (name || '').toString().trim();
    if (!display) {
      return { display: '', key: '' };
    }
    return {
      display,
      key: display.toLowerCase()
    };
  }

  /**
   * 获取指定宝宝的自定义分类列表
   * @param {string} babyUid
   * @returns {Promise<Array>}
   */
  async getCategories(babyUid) {
    if (!babyUid) {
      return [];
    }

    try {
      const res = await this.collection
        .where({
          babyUid: _.eq(babyUid)
        })
        .orderBy('name', 'asc')
        .get();

      return (res && res.data) || [];
    } catch (error) {
      console.error('获取云端分类失败:', error);
      return [];
    }
  }

  /**
   * 新增自定义分类
   * @param {string} name
    * @param {Object} options
   * @param {string} options.babyUid
   * @param {string} [options.createdBy]
   * @returns {Promise<Object>} 新增或已存在的分类文档
   */
  async addCategory(name, { babyUid, createdBy = '' } = {}) {
    const { display, key } = this._normalizeName(name);
    if (!display) {
      throw new Error('分类名称不能为空');
    }
    if (!babyUid) {
      throw new Error('缺少 babyUid，无法保存分类');
    }

    try {
      return await this._upsertCategory({ display, key, babyUid, createdBy });
    } catch (error) {
      console.error('添加分类失败:', error);
      throw error;
    }
  }

  async _upsertCategory({ display, key, babyUid, createdBy }) {
    const existingRes = await this.collection
      .where({
        babyUid: _.eq(babyUid),
        normalizedName: _.eq(key)
      })
      .limit(1)
      .get();

    const existing = existingRes?.data?.[0];
    if (existing) {
      // 同步更新时间
      await this.collection.doc(existing._id).update({
        data: {
          name: display,
          normalizedName: key,
          updatedAt: db.serverDate()
        }
      });
      return {
        ...existing,
        name: display,
        normalizedName: key
      };
    }

    const payload = {
      name: display,
      normalizedName: key,
      babyUid,
      createdBy,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };

    const res = await this.collection.add({
      data: payload
    });

    return {
      _id: res._id,
      ...payload
    };
  }
}

module.exports = new FoodCategoryModel();
