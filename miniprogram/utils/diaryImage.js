const DIARY_ORIG_MAX_BYTES = 500 * 1024;
const ORIG_QUALITY_LADDER = [70, 50, 40, 30];
const THUMB_QUALITY = 40;

function buildDiaryCloudPaths({ babyUid, entryKey, index, ts }) {
  const base = `growth-diary/${babyUid}/${entryKey}/${ts}_${index}`;
  return {
    originalCloudPath: `${base}_orig.jpg`,
    thumbCloudPath: `${base}_thumb.jpg`
  };
}

function resolveCompressImage(compressImage) {
  if (compressImage) return compressImage;
  if (typeof wx !== 'undefined' && typeof wx.compressImage === 'function') {
    return (opts) => wx.compressImage(opts);
  }
  throw new Error('compressImage is not available');
}

function resolveUploadFile(uploadFile) {
  if (uploadFile) return uploadFile;
  if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.uploadFile === 'function') {
    return (opts) => wx.cloud.uploadFile(opts);
  }
  throw new Error('uploadFile is not available');
}

function resolveGetFileInfo(getFileInfo) {
  if (getFileInfo) return getFileInfo;
  if (typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function') {
    return (filePath) =>
      new Promise((resolve, reject) => {
        wx.getFileSystemManager().getFileInfo({
          filePath,
          success: resolve,
          fail: reject
        });
      });
  }
  return null;
}

function resolveDeleteFile(deleteFile) {
  if (deleteFile) return deleteFile;
  if (typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.deleteFile === 'function') {
    return (opts) => wx.cloud.deleteFile(opts);
  }
  return async () => {};
}

async function compressToTargetSize(localPath, { compressImage, getFileInfo, qualities }) {
  let currentPath = localPath;

  for (const quality of qualities) {
    const compressed = await compressImage({ src: currentPath, quality });
    currentPath = compressed?.tempFilePath || currentPath;

    if (!getFileInfo) {
      return currentPath;
    }

    try {
      const info = await getFileInfo(currentPath);
      if (!info?.size || info.size <= DIARY_ORIG_MAX_BYTES) {
        return currentPath;
      }
    } catch (error) {
      return currentPath;
    }
  }

  return currentPath;
}

async function prepareAndUploadDiaryPhoto(
  localPath,
  { babyUid, entryKey, index, ts = Date.now(), uploadFile, compressImage, getFileInfo } = {}
) {
  const doCompress = resolveCompressImage(compressImage);
  const doUpload = resolveUploadFile(uploadFile);
  const doGetFileInfo = resolveGetFileInfo(getFileInfo);
  const { originalCloudPath, thumbCloudPath } = buildDiaryCloudPaths({
    babyUid,
    entryKey,
    index,
    ts
  });

  const originalPath = await compressToTargetSize(localPath, {
    compressImage: doCompress,
    getFileInfo: doGetFileInfo,
    qualities: ORIG_QUALITY_LADDER
  });

  const originalResult = await doUpload({
    cloudPath: originalCloudPath,
    filePath: originalPath
  });
  const originalFileId = originalResult?.fileID;
  if (!originalFileId) {
    throw new Error('上传原图失败');
  }

  const thumbCompressed = await doCompress({ src: originalPath, quality: THUMB_QUALITY });
  const thumbPath = thumbCompressed?.tempFilePath || originalPath;
  const thumbResult = await doUpload({
    cloudPath: thumbCloudPath,
    filePath: thumbPath
  });
  const thumbFileId = thumbResult?.fileID;
  if (!thumbFileId) {
    throw new Error('上传缩略图失败');
  }

  return { originalFileId, thumbFileId };
}

async function deleteCloudFiles(fileIds, { deleteFile } = {}) {
  const ids = (Array.isArray(fileIds) ? fileIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (!ids.length) return;

  const doDelete = resolveDeleteFile(deleteFile);
  try {
    await doDelete({ fileList: ids });
  } catch (error) {
    console.warn('deleteCloudFiles failed:', error);
  }
}

module.exports = {
  buildDiaryCloudPaths,
  prepareAndUploadDiaryPhoto,
  deleteCloudFiles,
  DIARY_ORIG_MAX_BYTES,
  ORIG_QUALITY_LADDER,
  THUMB_QUALITY
};
