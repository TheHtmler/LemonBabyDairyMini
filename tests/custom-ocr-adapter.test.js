const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const adapterPath = path.resolve(__dirname, '..', 'cloudfunctions', 'recognizeReportCustom', 'customOcrAdapter.js');
const {
  boxToPos,
  linesToOcrItems,
  adaptFormatReportResponse,
  adaptGenericOcrResponse,
  parseRefRange
} = require(adapterPath);

test('boxToPos converts xyxy boxes', () => {
  assert.deepEqual(boxToPos([10, 20, 110, 50]), {
    left: 10,
    top: 20,
    width: 100,
    height: 30
  });
});

test('parseRefRange parses hyphen range', () => {
  assert.deepEqual(parseRefRange('1.00-4.00'), { minRange: '1.00', maxRange: '4.00' });
});

test('parseRefRange parses parenthesised negative reference range', () => {
  assert.deepEqual(parseRefRange('(-3)-3'), { minRange: '-3', maxRange: '3' });
});

test('adaptFormatReportResponse maps BE range with parenthesised negative min', () => {
  const adapted = adaptFormatReportResponse({
    items: [{
      name: 'BE(B)',
      value: '1.2',
      ref_range: '(-3)-3'
    }]
  });

  assert.equal(adapted.structuredItems[0].minRange, '-3');
  assert.equal(adapted.structuredItems[0].maxRange, '3');
});

test('adaptFormatReportResponse maps structured items and raw lines', () => {
  const adapted = adaptFormatReportResponse({
    client: 'owner',
    report_type: 'lemon_metabolic_report',
    parser_version: 'v1.rules.1',
    item_count: 1,
    warnings: ['demo warning'],
    items: [{
      name: '丙酰肉碱(C3)',
      value: '53.62',
      ref_range: '1.00-4.00',
      flag: 'high',
      confidence: 0.99
    }],
    raw_ocr: {
      lines: [{ text: 'C3', score: 0.9, box: [0, 0, 40, 20] }]
    }
  });

  assert.equal(adapted.mode, 'format-report');
  assert.equal(adapted.structuredItems.length, 1);
  assert.equal(adapted.structuredItems[0].minRange, '1.00');
  assert.equal(adapted.structuredItems[0].indicatorKey, null);
  assert.equal(adapted.warnings.length, 1);
  assert.equal(adapted.lines.length, 1);
});

test('adaptFormatReportResponse resolves label and indicator_key into normalized structured items', () => {
  const adapted = adaptFormatReportResponse({
    items: [{
      indicator_key: 'c3',
      label: 'C3',
      value: '53.62',
      ref_range: '1.00-4.00'
    }]
  });

  assert.equal(adapted.structuredItems[0].name, 'C3');
  assert.equal(adapted.structuredItems[0].indicatorKey, 'c3');
});

test('adaptGenericOcrResponse maps score to confidence in items', () => {
  const adapted = adaptGenericOcrResponse({
    client: 'owner',
    text: 'C3',
    lines: [{ text: 'C3', score: 0.95, box: [0, 0, 40, 20] }]
  });
  const items = linesToOcrItems(adapted.lines);

  assert.equal(adapted.mode, 'generic');
  assert.equal(items[0].confidence, 0.95);
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
