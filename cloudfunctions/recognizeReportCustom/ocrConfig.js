'use strict';
const { beijingEndpoint } = require('./lib/ai/modelRegistry');

function resolveOcrConfig(env = process.env) {
  if (!env.DASHSCOPE_API_KEY) throw Object.assign(new Error('请配置报告云函数的 DASHSCOPE_API_KEY'), { code: 'CONFIG_MISSING' });
  if (!beijingEndpoint(env)) throw Object.assign(new Error('请配置官方北京地域的 BAILIAN_BASE_URL'), { code: 'CONFIG_MISSING' });
  return { apiKey: env.DASHSCOPE_API_KEY, baseUrl: env.BAILIAN_BASE_URL.replace(/\/+$/, '') };
}

module.exports = { resolveOcrConfig };
