const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { requestReportOcr, resolveReportDeadline } = require('../cloudfunctions/recognizeReportCustom/customOcrClient');

function response(raw, inputTokens, outputTokens) {
  if (Array.isArray(raw.rows)) raw = { ...raw, rows: raw.rows.map(row => ({
    n: row[1], v: row[2], r: row[3], u: row[4], f: row[5]
  })) };
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }],
    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } };
}

// 只替代网络传输，实际执行请求编排、响应解析和原行映射，不加载页面。
function offlineTransport(t, responses, onResponse = () => {}) {
  const requests = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = payload => {
      requests.push(JSON.parse(payload.toString()));
      const raw = responses.shift();
      queueMicrotask(() => {
        onResponse();
        const received = new EventEmitter();
        received.statusCode = 200;
        callback(received);
        received.emit('data', Buffer.from(JSON.stringify(raw)));
        received.emit('end');
      });
    };
    return request;
  });
  return requests;
}

function options(reportType = 'blood_ms', model = 'qwen3.5-ocr') {
  return { buffers: [Buffer.from([0xff, 0xd8, 0xff, 1])], reportType,
    env: { DASHSCOPE_API_KEY: 'offline-test-only', BAILIAN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    policy: { managed: true, available: true, primaryModel: model, candidates: [model],
      modelOptions: { [model]: { maxOutputTokens: 16384 } },
      onModelSuccess: async () => {}, onModelError: async () => {} } };
}

test('血报告实际先转录再映射，只发送一次图片并累计两阶段用量', async t => {
  const requests = offlineTransport(t, [
    response({ rows: [['5', '亮氨酸(Leu)', '100', '60-250', 'μmol/L', ''],
      ['6', '新写法的甲硫氨酸项目', '15', '8-40', 'μmol/L', '']] }, 50, 10),
    response({ matches: [['iso_leu', 'r1'], ['met', 'r2']] }, 20, 5)
  ]);
  const result = await requestReportOcr(options());
  assert.deepEqual(result.structuredItems.map(item => [item.indicatorKey, item.value]), [['iso_leu', '100'], ['met', '15']]);
  assert.equal(result.usage.model, 'qwen3.5-ocr');
  assert.equal(result.usage.inputTokens, 70);
  assert.equal(result.usage.outputTokens, 15);
  assert.deepEqual(result.usage.calls, [{ model: 'qwen3.5-ocr', inputTokens: 70, outputTokens: 15 }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages[0].content.filter(item => item.type === 'image_url').length, 1);
  assert.equal(requests[1].messages[0].content.some(item => item.type === 'image_url'), false);
});

test('原表无效不能继续归属，已消耗的转录用量随错误返回', async t => {
  const requests = offlineTransport(t, [response({ rows: [['5', '亮氨酸', {}, '', '', '']] }, 50, 10)]);
  await assert.rejects(requestReportOcr(options()), error => {
    assert.equal(error.code, 'INVALID_MODEL_RESULT');
    assert.equal(error.usage.inputTokens, 50);
    assert.equal(error.usage.outputTokens, 10);
    assert.equal(error.usage.calls[0].model, 'qwen3.5-ocr');
    return true;
  });
  assert.equal(requests.length, 1);
});

test('尿报告继续一次模型请求，保留原来的结构化抽取结果', async t => {
  const requests = offlineTransport(t, [response({ items: [
    { indicator_key: 'methylmalonic_acid', name: '甲基丙二酸', value: '1', ref_range: '0-2' }
  ] }, 30, 5)]);
  const result = await requestReportOcr(options('urine_ms'));
  assert.equal(result.structuredItems[0].value, '1');
  assert.equal(requests.length, 1);
});

test('血报告原表为空时不再调用归属模型，也不补写指标', async t => {
  const requests = offlineTransport(t, [response({ rows: [] }, 30, 5)]);
  const result = await requestReportOcr(options());
  assert.deepEqual(result.structuredItems, []);
  assert.equal(requests.length, 1);
});

test('模型预算从调用开始计算，但必须为云函数收尾保留时间', () => {
  assert.equal(resolveReportDeadline(0, 5000), 95000);
  assert.equal(resolveReportDeadline(0, 30000), 105000);
  assert.equal(resolveReportDeadline(0, 105001), 105000);
});

test('转录在60秒时完成仍能继续归属，不再沿用45秒默认上限', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  offlineTransport(t, [
    response({ rows: [['5', '亮氨酸(Leu)', '100', '60-250', '', '']] }, 30, 5),
    response({ matches: [['iso_leu', 'r1']] }, 10, 2)
  ], () => { now = 60000; });
  const result = await requestReportOcr(options('blood_ms', 'qwen-vl-ocr'));
  assert.equal(result.structuredItems[0].value, '100');
});

test('转录耗尽共享预算时不能为归属重新延长超时', async t => {
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  const requests = offlineTransport(t, [response({ rows: [
    ['5', '亮氨酸(Leu)', '100', '60-250', '', '']
  ] }, 30, 5)], () => { now = 200; });
  await assert.rejects(requestReportOcr({ ...options(), deadline: 150 }), error => {
    assert.equal(error.code, 'MODEL_TIMEOUT');
    assert.equal(error.usage.inputTokens, 30);
    assert.equal(error.diagnostic.stage, 'mapping');
    assert.equal(error.diagnostic.reason, 'MODEL_TIMEOUT');
    return true;
  });
  assert.equal(requests.length, 1);
});

test('归属结果引用不存在的行时不交付数据，两阶段已用额度都保留', async t => {
  offlineTransport(t, [
    response({ rows: [['5', '亮氨酸(Leu)', '100', '60-250', '', '']] }, 30, 5),
    response({ matches: [['iso_leu', 'missing']] }, 10, 2)
  ]);
  await assert.rejects(requestReportOcr(options()), error => {
    assert.equal(error.code, 'INVALID_MODEL_RESULT');
    assert.equal(error.usage.inputTokens, 40);
    assert.equal(error.usage.outputTokens, 7);
    assert.equal(error.usage.calls[0].model, 'qwen3.5-ocr');
    return true;
  });
});

for (const model of ['qwen-vl-ocr', 'qwen-vl-ocr-2025-11-20']) {
  test(model + '血报告归属请求保留图片，两个阶段都遵守调用上限', async t => {
    const requests = offlineTransport(t, [
      response({ rows: [['5', '亮氨酸(Leu)', '100', '60-250', '', '']] }, 30, 5),
      response({ matches: [['iso_leu', 'r1']] }, 10, 2)
    ]);
    const result = await requestReportOcr(options('blood_ms', model));
    assert.equal(result.structuredItems[0].indicatorKey, 'iso_leu');
    assert.equal(result.structuredItems[0].value, '100');
    assert.deepEqual(requests.map(body => body.max_tokens), [4096, 2048]);
    assert.deepEqual(requests.map(body => body.messages[0].content
      .filter(item => item.type === 'image_url').length), [1, 1]);
  });

  test(model + '完整转录四张图后，归属仅带一张参考图与全部原行名称', async t => {
    const requests = offlineTransport(t, [
      response({ rows: [['5', '亮氨酸(Leu)', '100', '60-250', '', ''],
        ['6', '甲硫氨酸(Met)', '15', '8-40', '', '']] }, 30, 5),
      response({ rows: [] }, 10, 2),
      response({ rows: [] }, 10, 2),
      response({ rows: [] }, 10, 2),
      response({ matches: [['iso_leu', 'p1r1'], ['met', 'p1r2']] }, 10, 2)
    ]);
    const buffers = [1, 2, 3, 4].map(id => Buffer.from([0xff, 0xd8, 0xff, id]));
    const result = await requestReportOcr({ ...options('blood_ms', model), buffers });
    assert.deepEqual(requests.map(body => body.messages[0].content
      .filter(item => item.type === 'image_url').length), [1, 1, 1, 1, 1]);
    assert.equal(result.structuredItems.find(item => item.indicatorKey === 'iso_leu').value, '100');
    assert.equal(result.structuredItems.find(item => item.indicatorKey === 'met').value, '15');
  });
}
