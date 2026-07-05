const test = require('node:test');
const assert = require('node:assert/strict');
const { formatReportNumber, normalizeSignedNumberText } = require('../miniprogram/utils/reportNumberFormat');

test('formatReportNumber normalizes equivalent numeric strings to three decimals', () => {
  assert.equal(formatReportNumber('1.5'), '1.500');
  assert.equal(formatReportNumber('1.500'), '1.500');
  assert.equal(formatReportNumber('65'), '65.000');
  assert.equal(formatReportNumber(''), '');
});

test('formatReportNumber preserves non-numeric tokens', () => {
  assert.equal(formatReportNumber('N/A'), 'N/A');
});

test('normalizeSignedNumberText unwraps parenthesised negatives', () => {
  assert.equal(normalizeSignedNumberText('(-3)'), '-3');
  assert.equal(formatReportNumber('(-3)'), '-3.000');
});
