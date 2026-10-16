// 将云函数和网络异常转换为可恢复的页面提示，保留错误码供本地排查。
function normalizeCloudServiceError(error, scene = 'search') {
  const source = error || {};
  const raw = String(source.errMsg || source.message || '');
  const service = scene === 'search' ? '搜索' : '识别';
  let code = String(source.code || source.errCode || 'SERVICE_UNAVAILABLE');
  let message = source.message || '';
  if (/FUNCTION_NOT_(FOUND|EXIST)|function[^\n]*(not found|not exist|could not be found)/i.test(code + ' ' + raw)) {
    code = 'SERVICE_NOT_DEPLOYED'; message = service + '服务尚未准备好，请稍后重试';
  } else if (/timeout|timed out|超时/i.test(raw) && !source.code) {
    code = 'NETWORK_TIMEOUT'; message = '等待' + service + '超时，请重试';
  } else if (/network|offline|fail connect|网络|断网/i.test(raw) && !source.code) {
    code = 'NETWORK_ERROR'; message = '网络连接失败，请检查网络后重试';
  }
  if (!message || !/[\u4e00-\u9fff]/.test(message)) message = service + '暂时失败，请重试';
  return Object.assign(new Error(message), { code, stage: source.stage || '' });
}

module.exports = { normalizeCloudServiceError };
