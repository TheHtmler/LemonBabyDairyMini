const MAX_EDGE_PX = 2400;
const JPEG_QUALITY = 88;
const OCR_MAX_BYTES = 2 * 1024 * 1024;

let jimpModule = null;

function loadJimp() {
  if (jimpModule !== null) {
    return jimpModule;
  }
  try {
    jimpModule = require('jimp');
    return jimpModule;
  } catch (error) {
    jimpModule = false;
    return null;
  }
}

async function preprocessImageForOcr(buffer) {
  const originalBytes = buffer?.length || 0;
  if (!originalBytes) {
    return { buffer, preprocessMs: 0, resized: false, skipped: true, originalBytes: 0, outputBytes: 0 };
  }

  // 与 curl 直传保持一致：2MB 以内且边长合理时不再二次压缩，避免 OCR 文字劣化
  const Jimp = loadJimp();
  if (!Jimp) {
    return {
      buffer,
      preprocessMs: 0,
      resized: false,
      skipped: true,
      originalBytes,
      outputBytes: originalBytes
    };
  }

  const startedAt = Date.now();

  try {
    const image = await Jimp.read(buffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const maxEdge = Math.max(width, height);
    const needsResize = maxEdge > MAX_EDGE_PX;
    const needsReencode = originalBytes > OCR_MAX_BYTES;

    if (!needsResize && !needsReencode) {
      return {
        buffer,
        preprocessMs: Date.now() - startedAt,
        resized: false,
        skipped: true,
        originalBytes,
        outputBytes: originalBytes,
        width,
        height
      };
    }

    if (needsResize) {
      image.scaleToFit(MAX_EDGE_PX, MAX_EDGE_PX, Jimp.RESIZE_BILINEAR);
    }

    const outputBuffer = await image.quality(JPEG_QUALITY).getBufferAsync(Jimp.MIME_JPEG);

    return {
      buffer: outputBuffer,
      preprocessMs: Date.now() - startedAt,
      resized: true,
      skipped: false,
      originalBytes,
      outputBytes: outputBuffer.length,
      width: image.bitmap.width,
      height: image.bitmap.height
    };
  } catch (error) {
    console.warn('[recognizeReportCustom] preprocess skipped', {
      message: error?.message || String(error),
      originalBytes
    });
    return {
      buffer,
      preprocessMs: Date.now() - startedAt,
      resized: false,
      skipped: true,
      originalBytes,
      outputBytes: originalBytes,
      preprocessError: error?.message || String(error)
    };
  }
}

module.exports = {
  MAX_EDGE_PX,
  JPEG_QUALITY,
  OCR_MAX_BYTES,
  preprocessImageForOcr
};
