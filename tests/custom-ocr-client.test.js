const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const clientPath = path.resolve(__dirname, '..', 'cloudfunctions', 'recognizeReportCustom', 'customOcrClient.js');
const { parseOcrResponseBody, buildOcrHttpError } = require(clientPath);

test('parseOcrResponseBody maps plain-text 500 to server error', () => {
  assert.throws(
    () => parseOcrResponseBody('Internal Server Error', 500),
    (error) => error.code === 'OCR_SERVER_ERROR' && /500/.test(error.message)
  );
});

test('buildOcrHttpError maps 401 to unauthorized', () => {
  const error = buildOcrHttpError(401, '{"detail":"invalid api key"}', { detail: 'invalid api key' });
  assert.equal(error.code, 'OCR_UNAUTHORIZED');
  assert.match(error.message, /API Key/);
});

test('buildOcrHttpError keeps json detail in message', () => {
  const error = buildOcrHttpError(422, '{"detail":"unsupported image"}', { detail: 'unsupported image' });
  assert.equal(error.code, 'OCR_HTTP_ERROR');
  assert.match(error.message, /unsupported image/);
});
