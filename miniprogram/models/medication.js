// 药物设置模型
// 说明：药物的真实数据源是独立的 `medications` 集合（由用药管理页 pkg-misc/medications 维护）。
// 历史上 baby_info 内曾内嵌过 medicationSettings 字段，现已废弃：新数据恒为空、无编辑入口，
// 相关读写逻辑已移除。本模型只负责按宝宝读取 medications 集合。
const db = wx.cloud.database();
let medicationsCollection;

try {
  medicationsCollection = db.collection('medications');
} catch (error) {
  console.error('初始化药物集合失败:', error);
}

class MedicationModel {
  /**
   * 获取当前宝宝的药物列表（数据源：medications 集合）
   * @returns {Promise<Array>} 药物列表
   */
  async getMedications() {
    try {
      const babyUid = wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取正确的药物列表');
        return [];
      }

      if (!medicationsCollection) {
        console.warn('药物集合未初始化，将返回空药物列表');
        return [];
      }

      const medsResult = await medicationsCollection.where({
        babyUid: babyUid
      }).get();

      if (medsResult.data && medsResult.data.length > 0) {
        return medsResult.data;
      }
      console.log('未找到与当前宝宝关联的药物记录');
      return [];
    } catch (error) {
      // 集合不存在
      if (error && error.errCode === -502005) {
        console.warn('药物集合不存在，将返回空药物列表');
        return [];
      }
      console.error('获取药物设置失败:', error);
      return [];
    }
  }

}

module.exports = new MedicationModel();
