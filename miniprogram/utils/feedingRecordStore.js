/**
 * 统一的 feeding_records 查找/创建逻辑
 * 确保同一宝宝同一天只有一份文档
 */
const db = wx.cloud.database();
const _ = db.command;

const COLLECTION = 'feeding_records';

function buildDayRange(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
  const endOfDay = new Date(year, month - 1, day + 1, 0, 0, 0);
  return { startOfDay, endOfDay };
}

function pickBestRecord(records) {
  if (!records || records.length === 0) return null;
  if (records.length === 1) return records[0];
  return [...records].sort((a, b) => {
    const aContent = (Array.isArray(a.feedings) ? a.feedings.length : 0) + (Array.isArray(a.intakes) ? a.intakes.length : 0);
    const bContent = (Array.isArray(b.feedings) ? b.feedings.length : 0) + (Array.isArray(b.intakes) ? b.intakes.length : 0);
    if (bContent !== aContent) return bContent - aContent;
    const aTs = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
    const bTs = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
    return bTs - aTs;
  })[0];
}

/**
 * 查找当天记录（不创建）
 * @param {string} dateStr - 格式 "YYYY-MM-DD"
 * @param {string} babyUid
 * @returns {Promise<Object|null>}
 */
async function findDailyRecord(dateStr, babyUid) {
  if (!dateStr || !babyUid) return null;

  const { startOfDay, endOfDay } = buildDayRange(dateStr);
  const res = await db.collection(COLLECTION).where({
    babyUid,
    date: _.gte(startOfDay).and(_.lt(endOfDay))
  }).get();

  if (res.data && res.data.length > 0) {
    if (res.data.length > 1) {
      console.warn(`[feedingRecordStore] 发现同日多条记录 (${dateStr}, ${babyUid}): ${res.data.length}条`);
    }
    return pickBestRecord(res.data);
  }

  // 兼容旧数据：date 存储为字符串的情况
  const legacyRes = await db.collection(COLLECTION).where({
    babyUid,
    date: dateStr
  }).get();

  if (legacyRes.data && legacyRes.data.length > 0) {
    return pickBestRecord(legacyRes.data);
  }

  return null;
}

/**
 * 查找当天记录，不存在则创建空文档
 * @param {string} dateStr - 格式 "YYYY-MM-DD"
 * @param {string} babyUid
 * @param {Object} [basicInfo={}] - 可选的初始 basicInfo
 * @returns {Promise<{recordId: string, record: Object, created: boolean}>}
 */
async function findOrCreateDailyRecord(dateStr, babyUid, basicInfo = {}) {
  const existing = await findDailyRecord(dateStr, babyUid);
  if (existing) {
    return { recordId: existing._id, record: existing, created: false };
  }

  const { startOfDay } = buildDayRange(dateStr);
  const newDoc = {
    date: startOfDay,
    basicInfo: basicInfo || {},
    feedings: [],
    intakes: [],
    medicationRecords: [],
    babyUid,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const addRes = await db.collection(COLLECTION).add({ data: newDoc });
  return {
    recordId: addRes._id,
    record: { _id: addRes._id, ...newDoc },
    created: true
  };
}

module.exports = {
  findDailyRecord,
  findOrCreateDailyRecord
};
