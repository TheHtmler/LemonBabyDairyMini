const MAX_EDGE_PX = 1400;
const JPEG_QUALITY = 72;
const SKIP_PREPROCESS_BYTES = 350 * 1024;

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
    return { buffer, preprocessMs: 0, resized: false, originalBytes: 0, outputBytes: 0 };
  }

  const Jimp = loadJimp();
  if (!Jimp) {
    return { buffer, preprocessMs: 0, resized: false, originalBytes, outputBytes: originalBytes };
  }

  const startedAt = Date.now();

  try {
    const image = await Jimp.read(buffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const maxEdge = Math.max(width, height);
    const needsResize = maxEdge > MAX_EDGE_PX;
    const needsReencode = originalBytes > SKIP_PREPROCESS_BYTES;

    if (!needsResize && !needsReencode) {
      return {
        buffer,
        preprocessMs: Date.now() - startedAt,
        resized: false,
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
      resized: needsResize || outputBuffer.length < originalBytes,
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
      originalBytes,
      outputBytes: originalBytes,
      preprocessError: error?.message || String(error)
    };
  }
}

module.exports = {
  MAX_EDGE_PX,
  JPEG_QUALITY,
  preprocessImageForOcr
};
