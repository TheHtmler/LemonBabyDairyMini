// 以快门按下时的实际布局裁切，识别和扫描动画共用同一张框内图片。
function boundedOperation(start, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); callback(result);
    };
    const timer = setTimeout(() => finish(reject, new Error(message)), 8000);
    try { start(value => finish(resolve, value), () => finish(reject, new Error(message))); }
    catch (_) { finish(reject, new Error(message)); }
  });
}

async function measureCaptureRegion(page) {
  const [camera, frame, viewport] = await boundedOperation((resolve, reject) => {
    const query = wx.createSelectorQuery().in(page);
    query.select('#scanCamera').boundingClientRect();
    query.select('#captureFrame').boundingClientRect();
    query.select('.scan-page').boundingClientRect();
    query.exec(result => result && result.every(rect => rect && rect.width > 0 && rect.height > 0) ? resolve(result) : reject());
  }, '取景区域尚未准备好，请重新拍摄');
  if (frame.left < camera.left || frame.top < camera.top ||
      frame.right > camera.right || frame.bottom > camera.bottom) throw new Error('取景范围已变化，请重新拍摄');
  return { camera, frame, previewFrame: {
    left: (frame.left - viewport.left) / viewport.width * 100,
    top: (frame.top - viewport.top) / viewport.height * 100,
    width: frame.width / viewport.width * 100, height: frame.height / viewport.height * 100,
    scanSize: Math.min(frame.width, frame.height) * 0.7 / viewport.width * 100
  } };
}

async function cropCaptureImage(path, region) {
  let canvas;
  try {
    canvas = wx.createOffscreenCanvas({ type: '2d', width: 1, height: 1 });
    const image = canvas.createImage();
    await boundedOperation((resolve, reject) => {
      image.onload = resolve; image.onerror = reject; image.src = path;
    }, '照片读取失败，请重拍或从相册选择');
    const { camera, frame } = region;
    if (!(image.width > 0 && image.height > 0)) throw new Error('照片尺寸无效');
    // 原生相机画面居中铺满容器，先还原被屏幕比例遮掉的边缘，再映射取景框。
    const scale = Math.max(camera.width / image.width, camera.height / image.height);
    const hiddenX = (image.width * scale - camera.width) / 2;
    const hiddenY = (image.height * scale - camera.height) / 2;
    const x = Math.max(0, (frame.left - camera.left + hiddenX) / scale);
    const y = Math.max(0, (frame.top - camera.top + hiddenY) / scale);
    const width = Math.min(image.width - x, frame.width / scale);
    const height = Math.min(image.height - y, frame.height / scale);
    if (!(width > 0 && height > 0)) throw new Error('取景范围无效');
    const outputScale = Math.min(1, 2048 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * outputScale));
    canvas.height = Math.max(1, Math.round(height * outputScale));
    canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const result = await boundedOperation((resolve, reject) => wx.canvasToTempFilePath({
      canvas, x: 0, y: 0, width: canvas.width, height: canvas.height,
      destWidth: canvas.width, destHeight: canvas.height, fileType: 'jpg', quality: 0.92,
      success: resolve, fail: reject
    }), '取景图片处理失败，请重拍或从相册选择');
    if (!result.tempFilePath) throw new Error('未取得取景图片');
    return result.tempFilePath;
  } catch (_) {
    // 裁切失败不能静默上传整张原图，否则取景框又会失去实际含义。
    throw new Error('取景图片处理失败，请重拍或从相册选择');
  } finally {
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

module.exports = { measureCaptureRegion, cropCaptureImage };
