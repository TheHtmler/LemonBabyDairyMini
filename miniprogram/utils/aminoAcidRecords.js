const { readAllQuery } = require('./readAllQuery');

async function loadAminoAcidRecords(babyUid, date) {
  if (!babyUid) throw new Error('请先选择宝宝');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('记录日期无效');
  const db = wx.cloud.database();
  const where = { babyUid, status: 'active', date };
  // 保留原始份量，避免把旧记录中的空值归成零摄入。
  const load = name => readAllQuery(db.collection(name).where(where).orderBy('date', 'desc'));
  const [milk, food] = await Promise.all([load('feeding_records_v2'), load('food_intake_records')]);
  return {
    milkRecords: milk.data.filter(record => record.recordType !== 'daily_basic_info'),
    foodIntakeRecords: food.data
  };
}

module.exports = { loadAminoAcidRecords };
