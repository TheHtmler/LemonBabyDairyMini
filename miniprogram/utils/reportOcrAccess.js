const { logReportCloudFailure } = require('./reportCloudErrors');

// 报告识别调试期间统一隐藏入口，恢复后仍需通过云端权限校验。
const REPORT_OCR_ENTRY_ENABLED = false;

// 拍照入口、识别结果页与填写页共用权限预检，正式识别仍由云函数再次校验。
async function getReportOcrAccess(babyUid) {
  if (!REPORT_OCR_ENTRY_ENABLED) {
    return { available: false, reasonCode: 'FEATURE_DISABLED', message: '报告拍照识别暂未开放，请手动录入' };
  }
  const cloudEnvId = getApp()?.globalData?.cloudEnvId || '';
  let timer;
  try {
    const response = await Promise.race([
      wx.cloud.callFunction({
        name: 'recognizeReportCustom',
        data: { action: 'checkAccess', babyUid },
        ...(cloudEnvId ? { config: { env: cloudEnvId } } : {})
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('报告识别权限检查超时，请重试')), 12000);
      })
    ]);
    const result = response?.result;
    if (!result || result.ok !== true) throw new Error(result?.message || '报告识别服务暂时不可用，请重试');
    return {
      available: result.allowed === true,
      reasonCode: result.allowed === true ? '' : result.reasonCode || 'OCR_NOT_ALLOWED',
      message: result.message || (result.allowed === true ? '' : '报告识别暂未对当前用户开放')
    };
  } catch (error) {
    logReportCloudFailure(error, 'access', cloudEnvId);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { REPORT_OCR_ENTRY_ENABLED, getReportOcrAccess };
