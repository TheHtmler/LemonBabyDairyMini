const { normalizeCloudServiceError } = require('./cloudServiceError');
function createSearchRequestId() { return 'search_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12); }
async function callSearch(action, params) {
  let timer;
  try {
    const response = await Promise.race([
      wx.cloud.callFunction({ name: 'searchManager', data: { ...params, action } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('等待搜索超时，请重试'), { code: 'NETWORK_TIMEOUT' })), 25000); })
    ]);
    const result = response.result;
    if (!result || !result.ok) throw Object.assign(new Error(result && result.message || '搜索暂不可用，请重试'), { code: result && result.code || 'SEARCH_FAILED' });
    return result;
  } catch (error) {
    throw normalizeCloudServiceError(error, 'search');
  } finally { clearTimeout(timer); }
}
module.exports = { createSearchRequestId, capabilities: params => callSearch('capabilities', params),
  search: params => callSearch('search', params),
  preview: params => callSearch('preview', params) };
