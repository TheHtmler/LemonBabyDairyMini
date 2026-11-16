const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportResult } = require('../cloudfunctions/recognizeReportCustom/customOcrAdapter');
const { parseStructuredReportItems } = require('../miniprogram/pkg-report/utils/reportOcrParser');
const { mergeReportPages } = require('../miniprogram/pkg-report/utils/reportPageMerge');
const { bloodReportResponse } = require('./helpers/bloodReportResponse');

function parse(items) {
  const normalized = normalizeReportResult(bloodReportResponse(items), 'blood_ms');
  return parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: normalized.structuredItems });
}

for (const name of ['丙氨酸(Ala)', 'Ala', 'ALANINE', '丙氨酸']) {
  test('丙氨酸原行即使被模型错误标为精氨酸也不能填入：' + name, () => {
    assert.deepEqual(parse([{ name, indicator_key: 'arginine', value: '200', ref_range: '100-500' }]), {});
  });
}

for (const name of ['亮氨酸(Leu)', 'Leu', 'LEU', '亮氨酸（Leu）', 'Leucine']) {
  test('亮氨酸完整原名与缩写能纠正错误的甲硫氨酸编号：' + name, () => {
    const result = parse([{ name, indicator_key: 'met', value: '100', ref_range: '60-250' }]);
    assert.deepEqual(Object.keys(result), ['iso_leu']);
    assert.equal(result.iso_leu.value, '100');
    assert.equal(result.met, undefined);
  });
}

test('虚构血串联样例中，Ala不占用Arg，Leu不覆盖Met，未出现的Thr不补值', () => {
  const indicators = parse([
    { name: '丙氨酸(Ala)', indicator_key: 'arginine', value: '200', ref_range: '100-500' },
    { name: '精氨酸(Arg)', indicator_key: 'arginine', value: '50', ref_range: '1-65' },
    { name: '亮氨酸(Leu)', indicator_key: 'met', value: '100', ref_range: '60-250' },
    { name: '甲硫氨酸(Met)', indicator_key: 'met', value: '15', ref_range: '8-40' },
    { name: '缬氨酸(Val)', indicator_key: 'val', value: '80', ref_range: '55-250' }
  ]);
  const merged = mergeReportPages([{ status: 'success', result: {
    indicators, rawIndicators: indicators, context: { itemCount: 5 }
  } }], 'blood_ms');
  assert.deepEqual(Object.keys(merged.indicators), ['arginine', 'iso_leu', 'met', 'val']);
  assert.equal(merged.indicators.arginine.value, '50');
  assert.equal(merged.indicators.iso_leu.value, '100');
  assert.equal(merged.indicators.met.value, '15');
  assert.equal(merged.indicators.thr, undefined);
  assert.equal(merged.conflicts.length, 0);
});

test('新血报告写法的明确模型归属继续保留，不要求名称全部命中词典', () => {
  const result = parse([{ name: 'Plasma arginine measurement', indicator_key: 'arginine', value: '20' }]);
  assert.equal(result.arginine.value, '20');
});
