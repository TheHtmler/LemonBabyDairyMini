'use strict';

const { fail } = require('./policy');
const NUTRITION_QUOTA_KEY = 'nutrition_daily_quota';
const REPORT_QUOTA_KEY = 'report_daily_quota';
const MAX_DAILY_LIMIT = 10000;

function isDailyLimit(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DAILY_LIMIT;
}

// 管理配置使用固定文档，避免并发保存创建多条互相冲突的额度记录。
async function readDailyQuota(db, key, fallbackLimit) {
  let document;
  try {
    const result = await db.collection('feature_flags').doc(key).get();
    document = Array.isArray(result.data) ? result.data[0] : result.data;
  } catch (error) {
    if (!/DOCUMENT_NOT_FOUND|DOCUMENT_NOT_EXIST/.test(String(error.code || error.errCode)) &&
        !/document.*not.*exist|document.*not.*found/i.test(error.message || error.errMsg || '')) throw error;
  }
  if (!document) {
    if (!isDailyLimit(fallbackLimit)) fail('CONFIG_MISSING', '每日识别次数配置无效');
    return { dailyLimit: fallbackLimit, version: 0, configured: false };
  }
  if (!isDailyLimit(document.dailyLimit) || !Number.isSafeInteger(document.version) || document.version < 1) {
    fail('CONFIG_MISSING', '每日识别次数配置无效，请联系管理员');
  }
  return { dailyLimit: document.dailyLimit, version: document.version, configured: true };
}

function readNutritionQuota(db, fallbackLimit = 20) {
  return readDailyQuota(db, NUTRITION_QUOTA_KEY, fallbackLimit);
}

function readReportQuota(db, fallbackLimit = 20) {
  return readDailyQuota(db, REPORT_QUOTA_KEY, fallbackLimit);
}

module.exports = { NUTRITION_QUOTA_KEY, REPORT_QUOTA_KEY, MAX_DAILY_LIMIT, isDailyLimit, readNutritionQuota, readReportQuota };
