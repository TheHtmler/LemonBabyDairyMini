const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const VIOLATION_MESSAGE = '头像含有违规内容，请更换后再试';
const CHECK_FAILED_MESSAGE = '头像安全检测失败，请稍后重试';

function inferContentType(fileID = '') {
  const lower = String(fileID || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function deleteUploadedFile(avatarFileId) {
  if (!avatarFileId) return;
  try {
    await cloud.deleteFile({ fileList: [avatarFileId] });
  } catch (error) {
    console.error('删除未通过安全检测的头像失败:', error);
  }
}

function isSecurityViolation(errorOrResult = {}) {
  return errorOrResult.errCode === 87014
    || errorOrResult.errcode === 87014
    || errorOrResult.code === 87014;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const avatarFileId = event.avatarFileId || event.fileID || '';

  if (!OPENID) {
    return { ok: false, code: 'MISSING_OPENID', message: '缺少用户身份' };
  }
  if (!avatarFileId) {
    return { ok: false, code: 'MISSING_FILE', message: '缺少头像文件' };
  }

  let fileContent;
  try {
    const fileRes = await cloud.downloadFile({ fileID: avatarFileId });
    fileContent = fileRes.fileContent;
  } catch (error) {
    console.error('下载头像文件失败:', error);
    await deleteUploadedFile(avatarFileId);
    return { ok: false, code: 'DOWNLOAD_FAILED', message: CHECK_FAILED_MESSAGE };
  }

  try {
    const checkResult = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: inferContentType(avatarFileId),
        value: fileContent
      }
    });

    if (isSecurityViolation(checkResult)) {
      await deleteUploadedFile(avatarFileId);
      return { ok: false, code: 'AVATAR_SECURITY_RISK', message: VIOLATION_MESSAGE };
    }
    if (checkResult.errCode && checkResult.errCode !== 0) {
      await deleteUploadedFile(avatarFileId);
      return { ok: false, code: 'CHECK_FAILED', message: CHECK_FAILED_MESSAGE };
    }

    return { ok: true };
  } catch (error) {
    console.error('头像安全检测失败:', error);
    await deleteUploadedFile(avatarFileId);
    if (isSecurityViolation(error)) {
      return { ok: false, code: 'AVATAR_SECURITY_RISK', message: VIOLATION_MESSAGE };
    }
    return { ok: false, code: 'CHECK_FAILED', message: CHECK_FAILED_MESSAGE };
  }
};

exports._internal = {
  inferContentType,
  isSecurityViolation
};
