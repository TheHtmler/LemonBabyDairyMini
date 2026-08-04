/** 微信 imgSecCheck 约 1MB 上限；发布前压缩到此以内 */
const RECIPE_WALL_IMAGE_MAX_BYTES = 1024 * 1024;
const RECIPE_WALL_COMPRESS_QUALITIES = [80, 65, 50, 40, 30, 20];

function resolveCompressImage(compressImage) {
  if (typeof compressImage === 'function') return compressImage;
  if (typeof wx !== 'undefined' && typeof wx.compressImage === 'function') {
    return (opts) => wx.compressImage(opts);
  }
  return null;
}

function resolveGetFileInfo(getFileInfo) {
  if (typeof getFileInfo === 'function') return getFileInfo;
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

async function readFileSize(filePath, getFileInfo) {
  if (!filePath || !getFileInfo) return 0;
  try {
    const info = await getFileInfo(filePath);
    return Number(info?.size) || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * 将本地图片压缩到 imgSecCheck 可接受大小。
 * @returns {{ ok: boolean, path: string, size: number, message?: string }}
 */
async function compressRecipeWallImage(localPath, options = {}) {
  const src = String(localPath || '').trim();
  if (!src) {
    return { ok: false, path: '', size: 0, message: '未选择图片' };
  }

  const maxBytes = Number(options.maxBytes) > 0
    ? Number(options.maxBytes)
    : RECIPE_WALL_IMAGE_MAX_BYTES;
  const qualities = Array.isArray(options.qualities) && options.qualities.length
    ? options.qualities
    : RECIPE_WALL_COMPRESS_QUALITIES;
  const compressImage = resolveCompressImage(options.compressImage);
  const getFileInfo = resolveGetFileInfo(options.getFileInfo);

  let currentPath = src;
  let size = Number(options.initialSize) || 0;
  if (!size) {
    size = await readFileSize(currentPath, getFileInfo);
  }

  if (size > 0 && size <= maxBytes) {
    return { ok: true, path: currentPath, size };
  }

  if (!compressImage) {
    if (size > maxBytes) {
      return {
        ok: false,
        path: currentPath,
        size,
        message: '图片过大，请压缩到 1MB 以内再发'
      };
    }
    return { ok: true, path: currentPath, size };
  }

  for (const quality of qualities) {
    try {
      const compressed = await compressImage({ src: currentPath, quality });
      currentPath = compressed?.tempFilePath || currentPath;
      size = await readFileSize(currentPath, getFileInfo);
      if (size > 0 && size <= maxBytes) {
        return { ok: true, path: currentPath, size };
      }
    } catch (error) {
      console.warn('recipe wall compressImage failed', quality, error);
    }
  }

  size = await readFileSize(currentPath, getFileInfo);
  if (size > 0 && size <= maxBytes) {
    return { ok: true, path: currentPath, size };
  }

  // 读不到体积时仍上传压缩后的路径，交给云端兜底
  if (!size) {
    return { ok: true, path: currentPath, size: 0 };
  }

  return {
    ok: false,
    path: currentPath,
    size,
    message: '图片过大，请换一张更小的图或裁剪后再试'
  };
}

module.exports = {
  RECIPE_WALL_IMAGE_MAX_BYTES,
  RECIPE_WALL_COMPRESS_QUALITIES,
  compressRecipeWallImage
};
