'use strict';
const { REPORT_MAX_IMAGE_BYTES, REPORT_MAX_PHOTOS } = require('./lib/config/reportTypes');

// 原图检查与分块共用，裁剪不缩放、不改写检验内容。
function validateReportImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw Object.assign(new Error('缺少报告图片'), { code: 'INVALID_INPUT' });
  if (buffer.length > REPORT_MAX_IMAGE_BYTES) throw Object.assign(new Error('图片过大，请分段拍摄报告以保留文字清晰度'), { code: 'IMAGE_TOO_LARGE' });
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw Object.assign(new Error('请选择 JPG、PNG 或 WebP 格式的清晰报告图片'), { code: 'INVALID_INPUT' });
}

const MAX_INPUT_PIXELS = 24 * 1024 * 1024;
const SEGMENT_PIXELS = 2 * 1024 * 1024;
const MIN_SEGMENT_HEIGHT = 128;
const MAX_SPLIT_DEPTH = 3;
let imageLibrary;
let cropQueue = Promise.resolve();

function sharp() {
  if (!imageLibrary) {
    const runtimeVersion = process.versions.node;
    const [major, minor] = runtimeVersion.split('.').map(Number);
    if (major < 20 || major === 20 && minor < 9) {
      throw Object.assign(new Error('当前云函数运行于 Node.js ' + runtimeVersion +
        '，报告分块需要 Node.js 20.9 或更高版本；请在云平台设置本函数的运行环境为 Node.js 20.19，并在云端安装依赖'),
      { code: 'CONFIG_MISSING', diagnostic: { reason: 'IMAGE_RUNTIME_UNSUPPORTED', runtimeVersion } });
    }
    try { imageLibrary = require('sharp'); }
    catch (error) {
      // 不输出底层错误原文；仅用固定原因及平台版本区分运行时问题和原生依赖问题。
      const missing = error.code === 'MODULE_NOT_FOUND';
      throw Object.assign(new Error('当前云函数为 Node.js ' + runtimeVersion + '，但报告分块依赖加载失败；' +
        '请检查云端依赖安装日志，安装 sharp 及对应 Linux 平台的可选依赖，不要上传 Mac 版 node_modules'),
      { code: 'CONFIG_MISSING', diagnostic: { reason: missing ? 'IMAGE_DEPENDENCY_MISSING' : 'IMAGE_DEPENDENCY_LOAD_FAILED',
        runtimeVersion, platform: process.platform, architecture: process.arch } });
    }
    imageLibrary.cache({ memory: 16, files: 0, items: 16 });
    imageLibrary.concurrency(1);
  }
  return imageLibrary;
}

async function prepareReportPages(buffers) {
  if (!Array.isArray(buffers) || !buffers.length || buffers.length > REPORT_MAX_PHOTOS) {
    throw Object.assign(new Error('报告图片组无效'), { code: 'INVALID_INPUT' });
  }
  const pages = [];
  for (const [index, buffer] of buffers.entries()) {
    validateReportImage(buffer);
    let metadata;
    try { metadata = await sharp()(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata(); }
    catch (error) {
      if (error.code === 'CONFIG_MISSING') throw error;
      throw Object.assign(new Error('报告图片无法解码或像素过多，请使用不超过2400万像素的清晰图片'), { code: 'INVALID_INPUT' });
    }
    if (!metadata.width || !metadata.height || (metadata.pages || 1) !== 1) {
      throw Object.assign(new Error('请使用单帧报告照片'), { code: 'INVALID_INPUT' });
    }
    const rotated = [5, 6, 7, 8].includes(metadata.orientation);
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    const segmentHeight = Math.max(MIN_SEGMENT_HEIGHT, Math.min(1024, Math.floor(SEGMENT_PIXELS / width)));
    const count = Math.ceil(height / segmentHeight);
    const segments = Array.from({ length: count }, (_, part) => {
      const top = Math.floor(height * part / count);
      return { path: String(part + 1), depth: 0, top, height: Math.floor(height * (part + 1) / count) - top };
    });
    pages.push({ buffer, index, width, height, segments });
  }
  return pages;
}

function splitReportSegment(segment) {
  if (segment.depth >= MAX_SPLIT_DEPTH || segment.height < MIN_SEGMENT_HEIGHT * 2) return null;
  const height = Math.floor(segment.height / 2);
  return [
    { path: segment.path + '.1', depth: segment.depth + 1, top: segment.top, height },
    { path: segment.path + '.2', depth: segment.depth + 1, top: segment.top + height, height: segment.height - height }
  ];
}

async function extractReportSegment(page, segment, deadline) {
  // 上下文至少覆盖半个核心高度；继续细分时保留与原图宽度相关的上下文，照顾倾斜或换行项目。
  const overlap = Math.max(Math.ceil(segment.height / 2), Math.ceil(page.width * 0.15));
  const top = Math.max(0, segment.top - overlap);
  const bottom = Math.min(page.height, segment.top + segment.height + overlap);
  const extract = async () => {
    if (Date.now() >= deadline - 500) {
      throw Object.assign(new Error('报告分块处理已到本次时间上限，请减少同时上传的图片后重试'), { code: 'MODEL_TIMEOUT' });
    }
    try {
      const marker = await sharp()({ create: { width: 16, height: segment.height, channels: 3, background: '#2563eb' } }).png().toBuffer();
      // 蓝色边栏只加在图外，标出本次取字范围，不能遮挡报告文字或穿过原表行。
      const image = sharp()(page.buffer, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient()
        .extract({ left: 0, top, width: page.width, height: bottom - top })
        .extend({ left: 16, right: 16, top: 0, bottom: 0, background: '#ffffff' })
        .composite([{ input: marker, left: 0, top: segment.top - top },
          { input: marker, left: page.width + 16, top: segment.top - top }]);
      const png = await image.clone().png().toBuffer();
      // 拍照JPEG转PNG可能显著膨胀；仅在超出传输预算时用高质量全色采样JPEG，不缩小文字像素。
      return png.length <= REPORT_MAX_IMAGE_BYTES ? png
        : await image.jpeg({ quality: 98, chromaSubsampling: '4:4:4' }).toBuffer();
    } catch (error) {
      if (error.code === 'CONFIG_MISSING') throw error;
      throw Object.assign(new Error('报告图片分块失败，请重新选择清晰图片'), { code: 'INVALID_INPUT' });
    }
  };
  // 单实例只同时解码一张原图，模型请求仍可并发，控制512MB云函数的原生内存。
  const pending = cropQueue.then(extract);
  cropQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

module.exports = { validateReportImage, prepareReportPages, splitReportSegment, extractReportSegment };
