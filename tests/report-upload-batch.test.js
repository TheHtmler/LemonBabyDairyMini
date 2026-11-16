const test = require('node:test');
const assert = require('node:assert/strict');
const { recognizeReportPhotos } = require('../miniprogram/pkg-report/utils/reportRecognition');

// 仅替代文件和云传输，不加载页面，不进行界面交互或真实网络请求。
function offlineUploads(t) {
  const previous = { wx: global.wx, getApp: global.getApp };
  const uploads = []; const calls = []; const deleted = []; const tasks = [];
  let current = true;
  global.getApp = () => ({ globalData: { cloudEnvId: 'offline-env' } });
  global.wx = {
    getFileSystemManager: () => ({ getFileInfo: ({ success }) => success({ size: 1024 }) }),
    cloud: {
      uploadFile: input => new Promise((resolve, reject) => uploads.push({ ...input, resolve, reject })),
      callFunction: async input => { calls.push(input); return { result: { ok: true, structuredItems: [] } }; },
      deleteFile: async input => { deleted.push(input.fileList); }
    }
  };
  t.after(async () => {
    current = false;
    uploads.forEach(upload => upload.reject(new Error('离线传输已结束')));
    await Promise.allSettled(tasks);
    if (previous.wx === undefined) delete global.wx; else global.wx = previous.wx;
    if (previous.getApp === undefined) delete global.getApp; else global.getApp = previous.getApp;
  });
  return { uploads, calls, deleted,
    run: count => {
      const task = recognizeReportPhotos({ photos: Array.from({ length: count }, (_, index) =>
        ({ tempFilePath: 'wxfile://photo-' + index })), babyUid: 'baby_one', reportType: 'blood_ms', isCurrent: () => current });
      task.catch(() => {}); tasks.push(task); return task;
    }
  };
}

const advance = () => new Promise(resolve => setImmediate(resolve));

test('三张图片并行上传，乱序结束仍按照片顺序提交完整图片组', async t => {
  const io = offlineUploads(t);
  const pending = io.run(4);
  await advance();
  assert.equal(io.uploads.length, 3);
  io.uploads[2].resolve({ fileID: 'cloud://photo-2' });
  await advance();
  assert.equal(io.uploads.length, 4);
  assert.equal(io.calls.length, 0);
  io.uploads[0].resolve({ fileID: 'cloud://photo-0' });
  io.uploads[3].resolve({ fileID: 'cloud://photo-3' });
  io.uploads[1].resolve({ fileID: 'cloud://photo-1' });
  const result = await pending;
  assert.equal(result.context.imageCount, 4);
  assert.deepEqual(io.calls[0].data.fileIDs, ['cloud://photo-0', 'cloud://photo-1', 'cloud://photo-2', 'cloud://photo-3']);
  assert.deepEqual(io.deleted, [['cloud://photo-0', 'cloud://photo-1', 'cloud://photo-2', 'cloud://photo-3']]);
});

test('并发上传失败后停止新增上传，等待在途结束并清理晚完成文件，不发送半份报告', async t => {
  const io = offlineUploads(t);
  const pending = io.run(6);
  const rejected = assert.rejects(pending, /上传失败/);
  rejected.catch(() => {});
  await advance();
  assert.equal(io.uploads.length, 3);
  io.uploads[0].reject(new Error('上传失败'));
  await advance();
  assert.equal(io.uploads.length, 3);
  assert.equal(io.deleted.length, 0);
  io.uploads[2].resolve({ fileID: 'cloud://photo-2' });
  io.uploads[1].resolve({ fileID: 'cloud://photo-1' });
  await rejected;
  assert.equal(io.calls.length, 0);
  assert.deepEqual(io.deleted, [['cloud://photo-1', 'cloud://photo-2']]);
});
