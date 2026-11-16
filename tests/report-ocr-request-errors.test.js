const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { requestReportOcr } = require('../cloudfunctions/recognizeReportCustom/customOcrClient');

function offlineResponses(t, responses, onResponse = () => {}) {
  const requests = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = payload => queueMicrotask(() => {
      requests.push(JSON.parse(payload.toString()));
      const [status, body] = responses.shift();
      onResponse();
      const received = new EventEmitter();
      received.statusCode = status;
      callback(received);
      received.emit('data', Buffer.from(JSON.stringify(body)));
      received.emit('end');
    });
    return request;
  });
  return requests;
}

function options() {
  return { buffers: [Buffer.from([0xff, 0xd8, 0xff, 1])], reportType: 'blood_ms',
    env: { DASHSCOPE_API_KEY: 'offline-test-only', BAILIAN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    policy: { managed: true, available: true, candidates: ['qwen-vl-ocr-2025-11-20'],
      primaryModel: 'qwen-vl-ocr-2025-11-20', modelOptions: { 'qwen-vl-ocr-2025-11-20': { maxOutputTokens: 8192 } },
      onModelSuccess: async () => {}, onModelError: async () => {} } };
}

test('模型400保留安全的参数类别、模型和阶段，不把原响应写进诊断', async t => {
  offlineResponses(t, [[400, { error: { code: 'InvalidParameter',
    message: 'max_tokens must be less than 4096; PRIVATE_REPORT_TEXT sk-private-test-key' } }]]);
  await assert.rejects(requestReportOcr(options()), error => {
    assert.equal(error.code, 'MODEL_UNAVAILABLE');
    assert.equal(error.httpStatus, 400);
    assert.equal(error.diagnostic.model, 'qwen-vl-ocr-2025-11-20');
    assert.equal(error.diagnostic.stage, 'transcription');
    assert.equal(error.diagnostic.reason, 'OUTPUT_LIMIT');
    assert.equal(error.diagnostic.nativeCode, 'InvalidParameter');
    assert.equal(error.diagnostic.maxOutputTokens, 4096);
    assert.equal(error.diagnostic.imageCount, 1);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_REPORT_TEXT|sk-private-test-key/);
    return true;
  });
});

test('正常结束但JSON损坏时，日志同时保留阶段与具体校验原因', async t => {
  offlineResponses(t, [[200, { choices: [{ finish_reason: 'stop', message: {
    content: 'PRIVATE_REPORT_TEXT is not JSON'
  } }], usage: { prompt_tokens: 30, completion_tokens: 20 } }]]);
  await assert.rejects(requestReportOcr(options()), error => {
    assert.equal(error.code, 'INVALID_MODEL_RESULT');
    assert.equal(error.diagnostic.stage, 'transcription');
    assert.equal(error.diagnostic.finishReason, 'stop');
    assert.equal(error.diagnostic.validationReason, 'INVALID_JSON');
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_REPORT_TEXT/);
    return true;
  });
});

for (const stage of ['transcription', 'mapping']) {
  test(stage + '输出截断与超时分开，记录耗时及输出用量而不记录半份报告', async t => {
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const truncated = [200, { choices: [{ finish_reason: 'length', message: {
      content: '{"rows":[["PRIVATE_REPORT_TEXT"'
    } }], usage: { prompt_tokens: 200, completion_tokens: 4096 } }];
    const source = [200, { choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ rows: [{ n: '亮氨酸(Leu)', v: '100', r: '60-250' }] })
    } }], usage: { prompt_tokens: 30, completion_tokens: 20 } }];
    offlineResponses(t, stage === 'mapping' ? [source, truncated] : [truncated], () => { now += 1200; });
    await assert.rejects(requestReportOcr(options()), error => {
      assert.equal(error.code, 'MODEL_OUTPUT_TRUNCATED');
      assert.equal(error.diagnostic.stage, stage);
      assert.equal(error.diagnostic.reason, 'OUTPUT_TRUNCATED');
      assert.equal(error.diagnostic.finishReason, 'length');
      assert.equal(error.diagnostic.elapsedMs, 1200);
      assert.equal(error.diagnostic.outputTokens, 4096);
      assert.equal(error.usage.outputTokens, stage === 'mapping' ? 4116 : 4096);
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_REPORT_TEXT/);
      return true;
    });
  });
}

test('归属阶段400不会被记录成图片转录失败，未知服务错误码不原样进入日志', async t => {
  offlineResponses(t, [[200, { choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ rows: [{ n: '亮氨酸(Leu)', v: '100', r: '60-250' }] })
  } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }],
  [400, { error: { code: 'sk-private-test-key', message: 'input tokens exceed maximum; PRIVATE_REPORT_TEXT' } }]]);
  await assert.rejects(requestReportOcr(options()), error => {
    assert.equal(error.diagnostic.stage, 'mapping');
    assert.equal(error.diagnostic.reason, 'INPUT_LIMIT');
    assert.equal(error.diagnostic.nativeCode, 'UNKNOWN');
    assert.equal(error.usage.inputTokens, 10);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_REPORT_TEXT|sk-private-test-key/);
    return true;
  });
});

test('归属切换备用模型时复用已成功的固定原表，不重新转录图片', async t => {
  const requests = offlineResponses(t, [
    [200, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ rows: [
      { n: '实验室项目甲', v: '100', r: '60-250' }
    ] }) } }], usage: { prompt_tokens: 30, completion_tokens: 20 } }],
    [403, { error: { code: 'insufficient_quota' } }],
    [200, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ matches: [['iso_leu', 'r1']] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 } }]
  ]);
  const input = options();
  input.policy.candidates.push('qwen-vl-ocr');
  const result = await requestReportOcr(input);
  assert.equal(requests.length, 3);
  assert.equal(result.modelInfo.actualModel, 'qwen-vl-ocr');
  assert.equal(result.modelInfo.fallbackUsed, true);
  assert.equal(result.structuredItems[0].value, '100');
  assert.equal(result.usage.inputTokens, 40);
  assert.equal(result.usage.outputTokens, 25);
  assert.equal(result.statistics.reusedSourceBatchCount, 1);
});
