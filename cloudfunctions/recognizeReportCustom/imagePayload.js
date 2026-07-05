const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

async function resolveImageBuffer(cloud, event = {}) {
  const fileID = event.fileID || event.avatarFileId || '';
  const imageBase64 = event.imageBase64 || '';

  if (imageBase64) {
    const buffer = Buffer.from(imageBase64, 'base64');
    if (!buffer.length) {
      throw Object.assign(new Error('empty_image_base64'), { code: 'DOWNLOAD_FAILED' });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('image_too_large'), { code: 'IMAGE_TOO_LARGE', bufferBytes: buffer.length });
    }
    return {
      buffer,
      fileName: event.fileName || 'report.jpg',
      source: 'base64'
    };
  }

  if (fileID) {
    const downloadStartedAt = Date.now();
    const fileRes = await cloud.downloadFile({ fileID });
    const buffer = fileRes.fileContent;
    if (!buffer || !buffer.length) {
      throw Object.assign(new Error('empty_file_content'), { code: 'DOWNLOAD_FAILED' });
    }
    return {
      buffer,
      fileName: event.fileName || inferFileName(fileID),
      source: 'fileID',
      downloadMs: Date.now() - downloadStartedAt
    };
  }

  return null;
}

function inferFileName(fileID = '') {
  const lower = String(fileID).toLowerCase();
  if (lower.endsWith('.png')) return 'report.png';
  if (lower.endsWith('.webp')) return 'report.webp';
  return 'report.jpg';
}

module.exports = {
  MAX_IMAGE_BYTES,
  resolveImageBuffer,
  inferFileName
};
