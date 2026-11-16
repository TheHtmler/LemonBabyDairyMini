const { REPORT_MAX_PHOTOS } = require('../constants/reportTypes');
const { currentContext } = require('./searchSession');

function cloudConfig() {
  const env = getApp()?.globalData?.cloudEnvId || '';
  return env ? { config: { env } } : {};
}

async function callOriginals(data) {
  const response = await wx.cloud.callFunction({ name: 'recognizeReportCustom', data, ...cloudConfig() });
  if (!response.result?.ok) throw new Error(response.result?.message || '原报告服务暂不可用，请稍后重试');
  return response.result;
}

function sameContext(context) {
  const current = currentContext();
  return !!context?.accountKey && !!context.babyUid && current.accountKey === context.accountKey && current.babyUid === context.babyUid
    && getApp().globalData.babyInfo?.babyUid === context.babyUid;
}

async function uploadReportOriginals(photos, context, isCurrent = () => true) {
  if (!photos.length) return [];
  if (photos.length > REPORT_MAX_PHOTOS) throw new Error('原报告最多保存6张');
  const active = () => sameContext(context) && isCurrent();
  const config = cloudConfig();
  if (!active()) throw new Error('宝宝或账号已切换，请重新打开报告');
  const prepared = await callOriginals({ action: 'prepareOriginals', babyUid: context.babyUid, count: photos.length });
  if (!active()) throw new Error('宝宝或账号已切换，请重新打开报告');
  const uploaded = [];
  try {
    if (!Array.isArray(prepared.paths) || prepared.paths.length !== photos.length) throw new Error('原报告上传准备失败');
    for (let i = 0; i < photos.length; i++) {
      if (!active()) throw new Error('宝宝或账号已切换，请重新打开报告');
      const result = await wx.cloud.uploadFile({ cloudPath: prepared.paths[i], filePath: photos[i], ...config });
      if (!result.fileID) throw new Error('原报告上传失败，请重试');
      uploaded.push(result.fileID);
    }
    if (!active()) throw new Error('宝宝或账号已切换，请重新打开报告');
    return uploaded;
  } catch (error) {
    // 仅回收本次尚未写入报告的新附件；上传途中退出仍需发布后的孤立文件巡检处理。
    if (uploaded.length) {
      try {
        const result = await wx.cloud.deleteFile({ fileList: uploaded, ...config });
        if (result.fileList?.length !== uploaded.length || result.fileList.some(file => file.status !== 0)) {
          console.warn('[report-original-upload-cleanup]', { code: 'DELETE_INCOMPLETE' });
        }
      } catch (_) { console.warn('[report-original-upload-cleanup]', { code: 'DELETE_FAILED' }); }
    }
    throw error;
  }
}

module.exports = { callOriginals, sameContext, uploadReportOriginals };
