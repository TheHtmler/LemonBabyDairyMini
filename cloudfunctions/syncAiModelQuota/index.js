'use strict';

const cloud = require('wx-server-sdk');
const { syncModelQuota } = require('./lib/ai/quotaSync');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  const context = cloud.getWXContext();
  if (context.OPENID || event.Type !== 'Timer' || event.TriggerName !== 'sync-ai-model-quota') {
    return { ok: false, code: 'NO_PERMISSION', message: '仅允许指定的云端定时任务调用' };
  }
  try {
    const env = context.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE;
    if (!env) throw new Error('无法确定当前云环境');
    const db = require('@cloudbase/node-sdk').init({ env }).database();
    return { ok: true, ...await syncModelQuota(db, process.env) };
  }
  catch (_) { return { ok: false, code: 'QUOTA_SYNC_FAILED', message: '额度同步状态保存失败，请检查云端配置' }; }
};
