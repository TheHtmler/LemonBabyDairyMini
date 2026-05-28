const {
  buildHardDeleteAuditLog,
  resolveOperatorOpenid
} = require('../utils/auditFields');

async function recordHardDelete({
  db: dbInstance = null,
  collectionName = '',
  recordId = '',
  babyUid = '',
  operatorOpenid = ''
} = {}) {
  if (!collectionName || !recordId) {
    return false;
  }

  const db = dbInstance || wx.cloud.database();
  try {
    await db.collection('audit_logs').add({
      data: buildHardDeleteAuditLog({
        timestamp: db.serverDate(),
        collectionName,
        recordId,
        babyUid,
        operatorOpenid: resolveOperatorOpenid(operatorOpenid)
      })
    });
    return true;
  } catch (error) {
    console.warn('写入删除审计日志失败:', error);
    return false;
  }
}

module.exports = {
  recordHardDelete
};
