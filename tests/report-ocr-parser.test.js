const test = require('node:test');
const assert = require('node:assert/strict');
const {
  groupOcrItemsIntoLines,
  parseNumbersFromLine,
  parseReportOcrResult
} = require('../miniprogram/utils/reportOcrParser');

test('groupOcrItemsIntoLines merges text blocks on the same row and preserves left-to-right order', () => {
  const items = [
    { text: '12.500', pos: { top: 100, left: 220, height: 20 } },
    { text: '丙酰基肉碱(C3)', pos: { top: 102, left: 20, height: 20 } },
    { text: '5.000-50.000', pos: { top: 98, left: 320, height: 20 } },
    { text: '游离肉碱(C0)', pos: { top: 200, left: 20, height: 20 } },
    { text: '30.000', pos: { top: 201, left: 220, height: 20 } }
  ];

  const lines = groupOcrItemsIntoLines(items);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '丙酰基肉碱(C3) 12.500 5.000-50.000');
  assert.equal(lines[1].text, '游离肉碱(C0) 30.000');
});

test('groupOcrItemsIntoLines keeps rows separated when vertical gap is larger than row height', () => {
  const items = [
    { text: '第一行文字', pos: { top: 10, left: 0, height: 20 } },
    { text: '第二行文字', pos: { top: 60, left: 0, height: 20 } }
  ];

  const lines = groupOcrItemsIntoLines(items);

  assert.equal(lines.length, 2);
});

test('parseNumbersFromLine extracts value before a min-max range', () => {
  const result = parseNumbersFromLine('12.500 5.000-50.000 umol/L');
  assert.deepEqual(result, { value: '12.500', minRange: '5.000', maxRange: '50.000' });
});

test('parseNumbersFromLine extracts value after a parenthesised range', () => {
  const result = parseNumbersFromLine('45.000 (10.00~80.00)');
  assert.deepEqual(result, { value: '45.000', minRange: '10.00', maxRange: '80.00' });
});

test('parseNumbersFromLine handles a value with no detectable range', () => {
  const result = parseNumbersFromLine('45.000');
  assert.deepEqual(result, { value: '45.000', minRange: '', maxRange: '' });
});

test('parseNumbersFromLine returns null when there is no number at all', () => {
  assert.equal(parseNumbersFromLine('无法识别的备注文字'), null);
});

test('parseReportOcrResult matches blood_ms indicators by Chinese name and abbreviation, ignoring ratio indicators', () => {
  const items = [
    { text: '丙酰基肉碱(C3)', pos: { top: 100, left: 20, height: 20 } },
    { text: '8.000', pos: { top: 100, left: 220, height: 20 } },
    { text: '0.500-5.000', pos: { top: 100, left: 320, height: 20 } },
    { text: '游离肉碱(C0)', pos: { top: 150, left: 20, height: 20 } },
    { text: '20.000', pos: { top: 150, left: 220, height: 20 } },
    { text: '10.000-40.000', pos: { top: 150, left: 320, height: 20 } },
    { text: 'C3/C0比值备注(自动计算，无需识别)', pos: { top: 200, left: 20, height: 20 } },
    { text: '0.400', pos: { top: 200, left: 220, height: 20 } }
  ];

  const result = parseReportOcrResult({ items, reportType: 'blood_ms' });

  assert.deepEqual(result.c3, { value: '8.000', minRange: '0.500', maxRange: '5.000', sourceText: '丙酰基肉碱(C3) 8.000 0.500-5.000' });
  assert.deepEqual(result.c0, { value: '20.000', minRange: '10.000', maxRange: '40.000', sourceText: '游离肉碱(C0) 20.000 10.000-40.000' });
  assert.equal(result.c3_c0, undefined);
  assert.equal(result.c3_c2, undefined);
});

test('parseReportOcrResult does not let a leading digit in a compound Chinese label leak into the value', () => {
  const items = [
    { text: '3-羟基丙酸', pos: { top: 100, left: 20, height: 20 } },
    { text: '12.500', pos: { top: 100, left: 220, height: 20 } },
    { text: '5.000-50.000', pos: { top: 100, left: 320, height: 20 } }
  ];

  const result = parseReportOcrResult({ items, reportType: 'urine_ms' });

  assert.deepEqual(result.hydroxypropionic_acid, {
    value: '12.500',
    minRange: '5.000',
    maxRange: '50.000',
    sourceText: '3-羟基丙酸 12.500 5.000-50.000'
  });
});

test('parseReportOcrResult ignores lines that do not match any indicator alias', () => {
  const items = [
    { text: '备注：以上结果仅供参考', pos: { top: 10, left: 0, height: 20 } }
  ];

  const result = parseReportOcrResult({ items, reportType: 'blood_ms' });

  assert.deepEqual(result, {});
});

test('parseReportOcrResult keeps only the first match per indicator when a line repeats', () => {
  const items = [
    { text: '血氨', pos: { top: 10, left: 0, height: 20 } },
    { text: '45.000', pos: { top: 10, left: 220, height: 20 } },
    { text: '血氨', pos: { top: 60, left: 0, height: 20 } },
    { text: '90.000', pos: { top: 60, left: 220, height: 20 } }
  ];

  const result = parseReportOcrResult({ items, reportType: 'blood_ammonia' });

  assert.deepEqual(result.ammonia, { value: '45.000', minRange: '', maxRange: '', sourceText: '血氨 45.000' });
});

test('parseReportOcrResult returns empty object for unknown report type or empty items', () => {
  assert.deepEqual(parseReportOcrResult({ items: [], reportType: 'blood_ms' }), {});
  assert.deepEqual(parseReportOcrResult({ items: [{ text: 'C0 20.000' }], reportType: '' }), {});
});
