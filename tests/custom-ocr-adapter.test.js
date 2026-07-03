const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const adapterPath = path.resolve(__dirname, '..', 'cloudfunctions', 'recognizeReportCustom', 'customOcrAdapter.js');
const { boxToPos, linesToOcrItems } = require(adapterPath);

test('boxToPos converts xyxy boxes', () => {
  assert.deepEqual(boxToPos([10, 20, 110, 50]), {
    left: 10,
    top: 20,
    width: 100,
    height: 30
  });
});

test('boxToPos converts polygon boxes', () => {
  assert.deepEqual(boxToPos([[10, 20], [110, 20], [110, 50], [10, 50]]), {
    left: 10,
    top: 20,
    width: 100,
    height: 30
  });
});

test('linesToOcrItems maps OCR lines into printedText-like items', () => {
  const items = linesToOcrItems([
    { text: '血氨', confidence: 0.98, box: [10, 20, 80, 50] },
    { text: '45.000', confidence: 0.95, box: [200, 20, 320, 50] }
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0].text, '血氨');
  assert.equal(items[1].pos.left, 200);
});
