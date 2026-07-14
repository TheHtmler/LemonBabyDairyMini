const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDiaryCloudPaths,
  prepareAndUploadDiaryPhoto,
  deleteCloudFiles
} = require('../miniprogram/utils/diaryImage');

test('buildDiaryCloudPaths returns orig and thumb paths', () => {
  const p = buildDiaryCloudPaths({ babyUid: 'b1', entryKey: 'tmp', index: 0, ts: 1000 });
  assert.match(p.originalCloudPath, /growth-diary\/b1\/tmp\/1000_0_orig\.jpg/);
  assert.match(p.thumbCloudPath, /growth-diary\/b1\/tmp\/1000_0_thumb\.jpg/);
});

test('prepareAndUploadDiaryPhoto compresses and uploads original and thumb', async () => {
  const compressCalls = [];
  const uploadCalls = [];

  const result = await prepareAndUploadDiaryPhoto('wxfile://local/photo.jpg', {
    babyUid: 'b1',
    entryKey: 'tmp',
    index: 1,
    ts: 2000,
    compressImage: async ({ src, quality }) => {
      compressCalls.push({ src, quality });
      return { tempFilePath: `${src}?q=${quality}` };
    },
    uploadFile: async ({ cloudPath, filePath }) => {
      uploadCalls.push({ cloudPath, filePath });
      if (cloudPath.endsWith('_orig.jpg')) {
        return { fileID: 'cloud://orig-id' };
      }
      if (cloudPath.endsWith('_thumb.jpg')) {
        return { fileID: 'cloud://thumb-id' };
      }
      throw new Error(`unexpected cloudPath: ${cloudPath}`);
    }
  });

  assert.equal(result.originalFileId, 'cloud://orig-id');
  assert.equal(result.thumbFileId, 'cloud://thumb-id');
  assert.equal(compressCalls.length, 2);
  assert.equal(compressCalls[0].quality, 70);
  assert.equal(compressCalls[1].quality, 40);
  assert.equal(uploadCalls.length, 2);
  assert.match(uploadCalls[0].cloudPath, /2000_1_orig\.jpg$/);
  assert.match(uploadCalls[1].cloudPath, /2000_1_thumb\.jpg$/);
});

test('prepareAndUploadDiaryPhoto lowers quality when file exceeds 500KB', async () => {
  const qualities = [];

  await prepareAndUploadDiaryPhoto('wxfile://local/large.jpg', {
    babyUid: 'b1',
    entryKey: 'tmp',
    index: 0,
    ts: 3000,
    getFileInfo: async (filePath) => ({
      size: filePath.includes('q=50') ? 400 * 1024 : 600 * 1024
    }),
    compressImage: async ({ src, quality }) => {
      qualities.push(quality);
      return { tempFilePath: `${src}?q=${quality}` };
    },
    uploadFile: async ({ cloudPath }) => ({
      fileID: cloudPath.includes('_thumb') ? 'cloud://thumb' : 'cloud://orig'
    })
  });

  assert.deepEqual(qualities.slice(0, 2), [70, 50]);
  assert.equal(qualities[qualities.length - 1], 40);
});

test('prepareAndUploadDiaryPhoto throws when upload fails', async () => {
  await assert.rejects(
    () =>
      prepareAndUploadDiaryPhoto('wxfile://local/photo.jpg', {
        babyUid: 'b1',
        entryKey: 'tmp',
        index: 0,
        ts: 1000,
        compressImage: async ({ src }) => ({ tempFilePath: src }),
        uploadFile: async () => {
          throw new Error('upload failed');
        }
      }),
    /upload failed/
  );
});

test('deleteCloudFiles swallows errors', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    await deleteCloudFiles(['cloud://a', 'cloud://b'], {
      deleteFile: async () => {
        throw new Error('delete failed');
      }
    });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /deleteCloudFiles/);
  } finally {
    console.warn = originalWarn;
  }
});

test('deleteCloudFiles calls deleteFile with file list', async () => {
  const deleted = [];
  await deleteCloudFiles(['cloud://x', 'cloud://y'], {
    deleteFile: async ({ fileList }) => {
      deleted.push(...fileList);
    }
  });
  assert.deepEqual(deleted, ['cloud://x', 'cloud://y']);
});
