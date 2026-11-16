// 只使用固定平台错误类别，不能把底层错误原文、报告或密钥直接展示或写入日志。
const CLOUD_MESSAGES = {
  FUNCTION_NOT_FOUND: '当前云环境未找到报告识别函数，请核对部署环境和函数名称',
  FUNCTIONS_NOT_FOUND: '当前云环境未找到报告识别函数，请核对部署环境和函数名称',
  FUNCTION_NOT_EXIST: '当前云环境未找到报告识别函数，请核对部署环境和函数名称',
  FUNCTIONS_QUALIFIER_NOT_FOUND: '报告识别函数的调用版本不存在，请检查版本及流量配置',
  FUNCTIONS_PERMISSION_DENIED: '无权调用报告识别函数，请检查云函数调用权限',
  DATABASE_PERMISSION_DENIED: '报告识别服务访问数据库失败，请检查云端权限',
  INVALID_ENV: '报告识别的云环境不存在或不匹配，请核对环境配置',
  INVALID_ENV_STATUS: '报告识别的云环境暂不可用，请检查环境状态',
  INVALID_ENV_SOURCE: '小程序与报告识别云环境的绑定关系异常，请检查环境配置',
  FUNCTIONS_STATUS_ABNORMAL: '报告识别函数状态异常，请检查部署状态和运行日志',
  FUNCTIONS_STATUS_ABNORMITY: '报告识别函数状态异常，请检查部署状态和运行日志',
  FUNCTIONS_TIME_LIMIT_EXCEEDED: '报告识别函数执行超时，请检查云端超时配置和运行日志',
  FUNCTIONS_MEMORY_LIMIT_EXCEEDED: '报告识别函数内存不足，请检查云端内存配置和运行日志',
  FUNCTIONS_EXECUTE_FAIL: '报告识别函数运行失败，请查看云端运行日志',
  FUNCTIONS_INVOCATION_FAILED: '报告识别函数调用失败，请查看云端运行日志'
};
const CLOUD_CODE = new RegExp('\\b(' + Object.keys(CLOUD_MESSAGES).join('|') + ')\\b');

function reportCloudDiagnostic(error = {}) {
  error = error || {};
  const raw = String(error.errMsg || error.message || '');
  const providerCode = Object.prototype.hasOwnProperty.call(CLOUD_MESSAGES, error.code)
    ? error.code : (raw.match(CLOUD_CODE) || [])[1];
  const rawCode = error.errCode ?? (raw.match(/\berrCode\s*[:=]\s*(-?\d{1,9})\b/i) || [])[1];
  const code = /^-?\d{1,9}$/.test(String(rawCode)) ? String(rawCode) : '';
  // 单独的数字错误码不能证明来自函数调用，避免把上传失败也归类为函数故障。
  if (!providerCode && !/cloud\.callFunction:fail/i.test(raw)) return null;
  const rawId = error.requestId || error.requestID || error.request_id ||
    (raw.match(/\brequest[_]?id\s*[:=]\s*([A-Za-z0-9_-]{8,96})\b/i) || [])[1];
  const requestId = typeof rawId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(rawId)
    && !/^sk[-_]/i.test(rawId) ? rawId : '';
  const reason = /cannot find module|ERR_MODULE_NOT_FOUND|Runtime\.ImportModuleError/i.test(raw)
    ? 'DEPENDENCY_LOAD_FAILED' : /Runtime\.(?:Init|Exit)Error|ContainerInitError|module initialization failed/i.test(raw)
      ? 'FUNCTION_START_FAILED' : /timeout|timed out|超时/i.test(raw) ? 'CALL_TIMEOUT'
        : /network|offline|fail connect|网络|断网/i.test(raw) ? 'NETWORK_ERROR' : 'CLOUD_CALL_FAILED';
  return { code, providerCode: providerCode || '', requestId, reason };
}

function getReportCloudFailureMessage(error) {
  const diagnostic = reportCloudDiagnostic(error);
  if (!diagnostic) return '';
  const message = diagnostic.reason === 'DEPENDENCY_LOAD_FAILED'
    ? '报告识别函数依赖加载失败，请检查云端依赖安装日志和代码包目录'
    : diagnostic.reason === 'FUNCTION_START_FAILED' ? '报告识别函数启动失败，请检查执行入口和云端运行日志'
      : CLOUD_MESSAGES[diagnostic.providerCode] || (diagnostic.reason === 'CALL_TIMEOUT'
        ? '等待报告识别服务超时，请稍后重试' : diagnostic.reason === 'NETWORK_ERROR'
          ? '网络连接失败，请检查网络后重试' : '报告识别服务调用失败，请查看云端运行日志');
  return message + (diagnostic.code ? '（错误码 ' + diagnostic.code + '）' : '');
}

function logReportCloudFailure(error, stage, envId) {
  const diagnostic = reportCloudDiagnostic(error);
  if (!diagnostic) return;
  console.warn('[report-cloud-call-failed]', { stage, functionName: 'recognizeReportCustom', envId, ...diagnostic });
}

module.exports = { getReportCloudFailureMessage, logReportCloudFailure };
