const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { requestReportOcr } = require('../cloudfunctions/recognizeReportCustom/customOcrClient');

function transport(t) {
  const requests = [];
  t.after(() => { requests.forEach(item => item.cancel()); });
  t.mock.method(https, 'request', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = payload => requests.push({ body: JSON.parse(payload.toString()),
      cancel: () => request.emit('error', new Error('离线传输已关闭')), respond: (body, status = 200) => {
      const received = new EventEmitter();
      received.statusCode = status;
      callback(received);
      received.emit('data', Buffer.from(JSON.stringify(body)));
      received.emit('end');
    } });
    return request;
  });
  return requests;
}

function response(rows, tokens = 5) {
  if (Array.isArray(rows.rows)) rows = { ...rows, rows: rows.rows.map(row => ({
    n: row[1], v: row[2], r: row[3], u: row[4], f: row[5]
  })) };
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(rows) } }],
    usage: { prompt_tokens: 10, completion_tokens: tokens } };
}

function options() {
  return { buffers: [1, 2, 3, 4].map(id => Buffer.from([0xff, 0xd8, 0xff, id])), reportType: 'blood_ms',
    env: { DASHSCOPE_API_KEY: 'offline-test-only', BAILIAN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    policy: { managed: true, available: true, primaryModel: 'qwen-vl-ocr', candidates: ['qwen-vl-ocr'],
      onModelSuccess: async () => {}, onModelError: async () => {} } };
}

const advance = () => new Promise(resolve => setImmediate(resolve));

test('四图同轮转录，全部完成才归属，乱序结束不改变来源编号', async t => {
  const requests = transport(t);
  const pending = requestReportOcr(options());
  pending.catch(() => {});
  assert.equal(requests.length, 4);
  requests[1].respond(response({ rows: [['1', '甲硫氨酸(Met)', '15', '8-40', '', '']] }));
  await advance();
  assert.equal(requests.length, 4);
  requests[0].respond(response({ rows: [['1', '亮氨酸(Leu)', '100', '60-250', '', '']] }));
  await advance();
  assert.equal(requests.length, 4);
  requests[3].respond(response({ rows: [] }));
  await advance();
  assert.equal(requests.length, 4);
  requests[2].respond(response({ rows: [] }));
  await advance();
  assert.equal(requests.length, 5);
  requests[4].respond(response({ matches: [['iso_leu', 'p1r1'], ['met', 'p2r1']] }));
  const result = await pending;
  assert.deepEqual(result.structuredItems.map(item => [item.indicatorKey, item.value, item.sourceRowId]),
    [['iso_leu', '100', 'p1r1'], ['met', '15', 'p2r1']]);
  assert.equal(result.usage.outputTokens, 25);
});

test('一张截断后停止派发新图，等待在途请求以完整记录用量，不交付半份结果', async t => {
  const requests = transport(t);
  const pending = requestReportOcr(options());
  const rejected = assert.rejects(pending, error => {
    assert.equal(error.code, 'MODEL_OUTPUT_TRUNCATED');
    assert.equal(error.diagnostic.batchIndex, 1);
    assert.equal(error.diagnostic.batchCount, 4);
    assert.equal(error.usage.outputTokens, 4111);
    return true;
  });
  rejected.catch(() => {});
  assert.equal(requests.length, 4);
  requests[0].respond({ choices: [{ finish_reason: 'length', message: { content: '{"rows":[' } }],
    usage: { prompt_tokens: 10, completion_tokens: 4096 } });
  await advance();
  assert.equal(requests.length, 4);
  requests[1].respond(response({ rows: [] }));
  requests[2].respond(response({ rows: [] }));
  requests[3].respond(response({ rows: [] }));
  await rejected;
  assert.equal(requests.length, 4);
});

test('跨图原行矛盾在汇总阶段拒绝，保留模型和阶段诊断及全部已用额度', async t => {
  const requests = transport(t);
  const pending = requestReportOcr(options());
  const rejected = assert.rejects(pending, error => {
    assert.equal(error.code, 'INVALID_MODEL_RESULT');
    assert.equal(error.diagnostic.stage, 'source_merge');
    assert.equal(error.diagnostic.model, 'qwen-vl-ocr');
    assert.equal(error.diagnostic.validationReason, 'SOURCE_VALUE_CONFLICT');
    assert.equal(error.usage.outputTokens, 20);
    return true;
  });
  rejected.catch(() => {});
  requests[0].respond(response({ rows: [['1', '亮氨酸(Leu)', '100', '60-250', '', '']] }));
  requests[1].respond(response({ rows: [['1', '亮氨酸(Leu)', '110', '60-250', '', '']] }));
  await advance();
  requests[2].respond(response({ rows: [] }));
  requests[3].respond(response({ rows: [] }));
  await rejected;
  assert.equal(requests.length, 4);
});

test('第二张图重复印刷序号不会中止四图识别，全部原行按程序编号传给归属阶段', async t => {
  const requests = transport(t);
  const pending = requestReportOcr(options());
  pending.catch(() => {});
  requests[0].respond(response({ rows: [] }));
  requests[1].respond(response({ rows: [
    ['5', '实验室项目甲', '100', '60-250', 'μmol/L', ''],
    ['5', '实验室项目乙', '15', '8-40', 'μmol/L', '']
  ] }));
  await advance();
  assert.equal(requests.length, 4);
  requests[2].respond(response({ rows: [] }));
  requests[3].respond(response({ rows: [] }));
  await advance();
  assert.equal(requests.length, 5);
  const instruction = requests[4].body.messages[0].content.find(item => item.type === 'text').text;
  const rows = JSON.parse(instruction.split('原表：')[1].split('\n系统字段：')[0]);
  assert.deepEqual(rows, [
    ['p2r1', '实验室项目甲'],
    ['p2r2', '实验室项目乙']
  ]);
  const reference = requests[4].body.messages[0].content.find(item => item.type === 'image_url');
  assert.ok(reference.max_pixels <= 65536, '只保留接口所需的版式参考，不再次编码高清原图');
  requests[4].respond(response({ matches: [['iso_leu', 'p2r1'], ['met', 'p2r2']] }));
  const result = await pending;
  assert.deepEqual(result.structuredItems.map(item => [item.indicatorKey, item.value, item.sourceRowId]),
    [['iso_leu', '100', 'p2r1'], ['met', '15', 'p2r2']]);
  assert.equal(result.usage.outputTokens, 25);
  assert.equal(result.statistics.sourceBatchCount, 4);
});

test('六图并发仍有上限，前四张发生失败后不派发剩余图片或归属请求', async t => {
  const requests = transport(t);
  const input = options();
  input.buffers.push(Buffer.from([0xff, 0xd8, 0xff, 5]), Buffer.from([0xff, 0xd8, 0xff, 6]));
  const pending = requestReportOcr(input);
  const rejected = assert.rejects(pending, { code: 'MODEL_OUTPUT_TRUNCATED' });
  rejected.catch(() => {});
  assert.equal(requests.length, 4);
  requests[0].respond({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] });
  await advance();
  for (const index of [1, 2, 3]) requests[index].respond(response({ rows: [] }));
  await rejected;
  assert.equal(requests.length, 4);
});

test('转录切换备用模型只补失败照片，成功和空页都复用，来源与额度不重复', async t => {
  const requests = transport(t);
  const input = options();
  input.policy.candidates.push('qwen-vl-ocr-2025-11-20');
  const pending = requestReportOcr(input);
  pending.catch(() => {});
  requests[0].respond(response({ rows: [['1', '亮氨酸(Leu)', '100', '60-250', '', '']] }));
  requests[1].respond({ error: { code: 'insufficient_quota' } }, 403);
  requests[2].respond(response({ rows: [['1', '甲硫氨酸(Met)', '15', '8-40', '', '']] }));
  requests[3].respond(response({ rows: [] }));
  await advance();
  assert.equal(requests.length, 5);
  assert.equal(requests[4].body.model, 'qwen-vl-ocr-2025-11-20');
  requests[4].respond(response({ rows: [['1', '缬氨酸(Val)', '90', '55-250', '', '']] }));
  await advance();
  assert.equal(requests.length, 6);
  requests[5].respond(response({ matches: [['iso_leu', 'p1r1'], ['val', 'p2r1'], ['met', 'p3r1']] }));
  const result = await pending;
  assert.deepEqual(result.structuredItems.map(item => [item.indicatorKey, item.value, item.sourceRowId]),
    [['iso_leu', '100', 'p1r1'], ['val', '90', 'p2r1'], ['met', '15', 'p3r1']]);
  assert.equal(result.usage.outputTokens, 25);
  assert.equal(result.statistics.reusedSourceBatchCount, 3);
});
