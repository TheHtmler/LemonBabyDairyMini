'use strict';

const https = require('https');
const { fail } = require('./lib/core/contracts');
const MAX_BYTES = 3 * 1024 * 1024;

function readLimited(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(Object.assign(new Error('图片下载地址无效'), { code: 'INVALID_INPUT' }));
    const chunks = []; let size = 0; let timer; let done = false;
    const finish = (error, data) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) reject(error); else resolve(data);
    };
    const req = https.get(target, response => {
      if (response.statusCode !== 200 || Number(response.headers['content-length']) > MAX_BYTES) {
        finish(Object.assign(new Error('无法读取图片或图片超过3MB'), { code: 'INVALID_INPUT' }));
        response.destroy(); req.destroy(); return;
      }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          finish(Object.assign(new Error('图片超过3MB'), { code: 'INVALID_INPUT' }));
          response.destroy(); req.destroy();
        } else chunks.push(chunk);
      });
      response.on('error', finish);
      response.on('end', () => finish(null, Buffer.concat(chunks)));
    });
    req.on('error', () => finish(Object.assign(new Error('图片下载失败'), { code: 'INVALID_INPUT' })));
    timer = setTimeout(() => {
      finish(Object.assign(new Error('图片读取超时'), { code: 'INVALID_INPUT' })); req.destroy();
    }, 10000);
  });
}

function validateFileId(fileID, path, env) {
  let parsed; let decoded;
  try { parsed = new URL(fileID); decoded = decodeURIComponent(parsed.pathname.slice(1)); }
  catch (_) { fail('INVALID_INPUT', '图片ID格式无效'); }
  if (parsed.protocol !== 'cloud:' || !(parsed.hostname === env || parsed.hostname.startsWith(env + '.')) ||
      decoded !== path || parsed.search || parsed.hash) {
    fail('FORBIDDEN', '图片不属于本次识别的上传路径或当前环境');
  }
}

async function resolveImages(cloud, fileIDs, session, env) {
  if (!Array.isArray(fileIDs) || fileIDs.length !== session.filePaths.length ||
      fileIDs.length < 1 || fileIDs.length > 3 || new Set(fileIDs).size !== fileIDs.length) {
    fail('INVALID_INPUT', '请选择本次识别的1～3张不同图片');
  }
  fileIDs.forEach((id, index) => validateFileId(id, session.filePaths[index], env));
  if (session.expectedFileIDs && fileIDs.some((id, index) => id !== session.expectedFileIDs[index])) {
    fail('FORBIDDEN', '图片ID与本次分配的文件不同');
  }
  const response = await cloud.getTempFileURL({ fileList: fileIDs });
  const files = response.fileList || [];
  return Promise.all(fileIDs.map(async id => {
    const item = files.find(x => x.fileID === id);
    if (!item || !item.tempFileURL || item.status && item.status !== 0) fail('INVALID_INPUT', '无法读取识别图片');
    const buffer = await readLimited(item.tempFileURL);
    const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if (!png && !jpeg) fail('INVALID_INPUT', '图片实际内容必须为JPEG或PNG');
    return 'data:image/' + (png ? 'png' : 'jpeg') + ';base64,' + buffer.toString('base64');
  }));
}

module.exports = { resolveImages, validateFileId, readLimited };
