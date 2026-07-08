const GROUP_QRCODE_KEY = 'group_qrcode';

async function resolveGroupQrcodeUrl(fileId = '') {
  const normalizedFileId = String(fileId || '').trim();
  if (!normalizedFileId) {
    return '';
  }

  const { fileList } = await wx.cloud.getTempFileURL({
    fileList: [{ fileID: normalizedFileId, maxAge: 604800 }]
  });
  return fileList?.[0]?.tempFileURL || '';
}

async function loadGroupQrcode(options = {}) {
  const useCloudFunction = options.useCloudFunction !== false;

  let fileId = '';
  let updatedAt = null;
  let updatedBy = '';

  if (useCloudFunction) {
    const res = await wx.cloud.callFunction({
      name: 'appConfigManager',
      data: { action: 'getGroupQrcode' }
    });
    if (!res?.result?.ok) {
      throw new Error(res?.result?.message || '加载群二维码失败');
    }
    fileId = res?.result?.config?.fileId || '';
  } else {
    const db = wx.cloud.database();
    const res = await db.collection('app_config').where({ key: GROUP_QRCODE_KEY }).limit(1).get();
    const doc = res.data && res.data[0];
    fileId = doc?.fileId || '';
    updatedAt = doc?.updatedAt || null;
    updatedBy = doc?.updatedBy || '';
  }

  const url = await resolveGroupQrcodeUrl(fileId);
  return {
    fileId,
    url,
    updatedAt,
    updatedBy
  };
}

module.exports = {
  GROUP_QRCODE_KEY,
  resolveGroupQrcodeUrl,
  loadGroupQrcode
};
