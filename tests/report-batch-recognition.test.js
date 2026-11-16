const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReportOcrRequest } = require('../cloudfunctions/recognizeReportCustom/customOcrClient');
const { validateReportFileIDs, resolveReportImageBatch } = require('../cloudfunctions/recognizeReportCustom/imagePayload');

function image(number) {
  return Buffer.from([0xff, 0xd8, 0xff, number]);
}

function fileID(index, babyUid = 'baby_one', host = 'env-one.bucket') {
  return `cloud://${host}/custom_ocr_temp/${babyUid}_12345_photo00${index}.jpg`;
}

test('同一份报告的四张图片都进入同一次模型请求，顺序和字节不丢失', () => {
  assert.equal(typeof buildReportOcrRequest, 'function');
  const images = [image(1), image(2), image(3), image(4)];
  const body = buildReportOcrRequest(images, 'urine_ms', 'qwen3.5-ocr');
  const content = body.messages[0].content;
  assert.equal(body.model, 'qwen3.5-ocr');
  assert.equal(body.messages.length, 1);
  assert.deepEqual(content.filter(item => item.type === 'image_url').map(item => item.image_url.url),
    images.map(buffer => 'data:image/jpeg;base64,' + buffer.toString('base64')));
  assert.equal(content[content.length - 1].type, 'text');
});

test('联合识别仍支持单张和六张图片，拒绝空组、超限或无效图片', () => {
  assert.equal(typeof buildReportOcrRequest, 'function');
  for (const count of [1, 6]) {
    const body = buildReportOcrRequest(Array.from({ length: count }, (_, index) => image(index)), 'urine_ms', 'qwen3.5-ocr');
    assert.equal(body.messages[0].content.filter(item => item.type === 'image_url').length, count);
  }
  for (const images of [[], Array.from({ length: 7 }, () => image(1)), [Buffer.from('invalid')]]) {
    assert.throws(() => buildReportOcrRequest(images, 'urine_ms', 'qwen3.5-ocr'), { code: 'INVALID_INPUT' });
  }
});

for (const [model, pixelsPerToken, expectedPixels] of [
  ['qwen-vl-ocr', 784, 4816896],
  ['qwen-vl-ocr-2025-11-20', 1024, 6291456],
  ['qwen3.5-ocr', 1024, 10485760]
]) {
  test(model + '为整组图片预留文字空间，不把每张图片上限独立累加', () => {
    const body = buildReportOcrRequest([image(1), image(2), image(3), image(4)], 'blood_ms', model, 16384);
    const images = body.messages[0].content.filter(item => item.type === 'image_url');
    assert.deepEqual(images.map(item => item.max_pixels), Array(4).fill(expectedPixels));
    assert.ok(images.reduce((sum, item) => sum + item.max_pixels / pixelsPerToken, 0)
      <= (model === 'qwen3.5-ocr' ? 40960 : 24576));
    assert.equal(body.max_tokens, model === 'qwen3.5-ocr' ? 8192 : 4096);
    assert.equal(buildReportOcrRequest([image(1)], 'blood_ms', model, 2048).max_tokens, 2048);
  });
}

test('批次内每张图片都必须属于当前宝宝与云环境', () => {
  assert.equal(typeof validateReportFileIDs, 'function');
  const allowed = [fileID(1), fileID(2)];
  assert.deepEqual(validateReportFileIDs(allowed, 'baby_one', 'env-one'), allowed);
  for (const files of [[], [fileID(1), fileID(1)], [fileID(1), fileID(2, 'other_baby')],
    [fileID(1), fileID(2, 'baby_one', 'env-other.bucket')], Array.from({ length: 7 }, (_, index) => fileID(index)),
    [fileID(1), 'not-a-cloud-file']]) {
    assert.throws(() => validateReportFileIDs(files, 'baby_one', 'env-one'));
  }
});

test('整组下载保留图片顺序，摘要绑定每张内容与报告类型', async () => {
  assert.equal(typeof resolveReportImageBatch, 'function');
  const files = [fileID(1), fileID(2)];
  const buffers = [image(1), image(2)];
  const cloud = { downloadFile: async ({ fileID }) => ({ fileContent: buffers[files.indexOf(fileID)] }) };
  const result = await resolveReportImageBatch(cloud, files, 'urine_ms');
  assert.deepEqual(result.buffers, buffers);
  assert.equal(result.totalBytes, 8);
  assert.match(result.requestHash, /^[a-f0-9]{64}$/);
  const reordered = await resolveReportImageBatch(cloud, [...files].reverse(), 'urine_ms');
  assert.notEqual(result.requestHash, reordered.requestHash);
  const differentType = await resolveReportImageBatch(cloud, files, 'blood_ms');
  assert.notEqual(result.requestHash, differentType.requestHash);
  buffers[1] = image(3);
  const differentImage = await resolveReportImageBatch(cloud, files, 'urine_ms');
  assert.notEqual(result.requestHash, differentImage.requestHash);
});

test('任一图片下载或格式失败，不能将不完整批次发给模型', async () => {
  assert.equal(typeof resolveReportImageBatch, 'function');
  await assert.rejects(resolveReportImageBatch({ downloadFile: async () => { throw new Error('失败'); } }, [fileID(1)], 'urine_ms'), { code: 'DOWNLOAD_FAILED' });
  await assert.rejects(resolveReportImageBatch({ downloadFile: async () => ({ fileContent: Buffer.from('invalid') }) }, [fileID(1)], 'urine_ms'), { code: 'INVALID_INPUT' });
});

test('整组图片并行下载，先完成的后页不能改变报告顺序', async () => {
  const files = [fileID(1), fileID(2), fileID(3), fileID(4)];
  const resolvers = new Map();
  const cloud = { downloadFile: ({ fileID }) => new Promise(resolve => { resolvers.set(fileID, resolve); }) };
  const pending = resolveReportImageBatch(cloud, files, 'blood_ms');
  assert.deepEqual([...resolvers.keys()], files);
  for (const index of [3, 1, 2, 0]) resolvers.get(files[index])({ fileContent: image(index + 1) });
  const result = await pending;
  assert.deepEqual(result.buffers, [image(1), image(2), image(3), image(4)]);
  assert.equal(result.totalBytes, 16);
});
