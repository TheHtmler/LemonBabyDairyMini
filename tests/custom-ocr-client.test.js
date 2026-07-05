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

test('buildOcrHttpError maps 403 to unauthorized', () => {
  const error = buildOcrHttpError(403, '{"detail":"missing api key"}', { detail: 'missing api key' });
  assert.equal(error.code, 'OCR_UNAUTHORIZED');
});

test('buildOcrHttpError maps 413 to image too large', () => {
  const error = buildOcrHttpError(413, '{"detail":"payload too large"}', { detail: 'payload too large' });
  assert.equal(error.code, 'IMAGE_TOO_LARGE');
});

test('buildOcrHttpError maps 429 to busy', () => {
  const error = buildOcrHttpError(429, '{"detail":"busy"}', { detail: 'busy' });
  assert.equal(error.code, 'OCR_BUSY');
});

test('buildOcrHttpError maps 502 html to gateway error without html body', () => {
  const error = buildOcrHttpError(502, '<html><title>502 Bad Gateway</title></html>', null);
  assert.equal(error.code, 'OCR_GATEWAY_ERROR');
  assert.match(error.message, /502/);
  assert.doesNotMatch(error.message, /<html>/);
});

test('buildOcrHttpError keeps json detail in message', () => {
  const error = buildOcrHttpError(422, '{"detail":"unsupported image"}', { detail: 'unsupported image' });
  assert.equal(error.code, 'OCR_HTTP_ERROR');
  assert.match(error.message, /unsupported image/);
});
