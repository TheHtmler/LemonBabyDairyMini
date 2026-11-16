const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportResult } = require('../cloudfunctions/recognizeReportCustom/customOcrAdapter');
const { parseStructuredReportItems } = require('../miniprogram/pkg-report/utils/reportOcrParser');
const { mergeReportPages } = require('../miniprogram/pkg-report/utils/reportPageMerge');

function response(items) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items }) } }] };
}

// 直接串联生产解析器与合并函数，不加载页面或模拟微信接口。
function recognizedPage(items, reportType = 'urine_ms') {
  const normalized = normalizeReportResult(response(items), reportType);
  const parsed = parseStructuredReportItems({ structuredItems: normalized.structuredItems, reportType });
  return { status: 'success', result: {
    indicators: parsed, rawIndicators: parsed, context: { itemCount: normalized.structuredItems.length }
  } };
}

for (const [name, key, value] of [
  ['Urinary methylmalonate', 'methylmalonic_acid', '12.3400'],
  ['3-Hydroxypropionate', 'hydroxypropionic_acid', '0'],
  ['Urinary 3-hydroxybutyrate', 'hydroxybutyric_acid', '2.50'],
  ['Methylcitrate isomer I', 'methylcitric_acid_1', '3.70'],
  ['Methylcitrate isomer II', 'methylcitric_acid_2', '4.80'],
  ['Urinary lactic acid', 'lactate', '1.25']
]) {
  test('词典外名称按合法模型编号通过云端、前端及汇总：' + name, () => {
    const page = recognizedPage([{ name, indicator_key: key, value, unit: 'mmol/mol Cr', ref_range: '0-5' }]);
    const parsed = page.result.indicators[key];
    assert.ok(parsed, '合法模型归属不能因原名称未收录而丢失');
    assert.equal(parsed.sourceText, name);
    assert.equal(parsed.value, value);
    assert.equal(parsed.minRange, '0');
    assert.equal(parsed.maxRange, '5');
    assert.equal(parsed.unit, 'mmol/mol Cr');
    assert.equal(parsed.needsReview, false);
    const merged = mergeReportPages([page], 'urine_ms');
    assert.deepEqual(Object.keys(merged.indicators), [key]);
    assert.equal(merged.conflicts.length, 0);
  });
}

test('四批目标行汇总保留六项与两个独立编号，空批次不阻断结果', () => {
  const pages = [
    recognizedPage([
      { name: '乳酸-2', indicator_key: 'lactate', value: '1.20' },
      { name: '3-羟基丙酸-2', indicator_key: 'hydroxypropionic_acid', value: '2.30' },
      { name: '3-羟基丁酸-2', indicator_key: 'hydroxybutyric_acid', value: '3.40' },
      { name: '甲基丙二酸-2', indicator_key: 'methylmalonic_acid', value: '4.50' }
    ]), recognizedPage([]),
    recognizedPage([{ name: '甲基枸缘酸-4(1)', indicator_key: 'methylcitric_acid_1', value: '5.60' }]),
    recognizedPage([{ name: '甲基枸缘酸-4(2)', indicator_key: 'methylcitric_acid_2', value: '6.70' }])
  ];
  const merged = mergeReportPages(pages, 'urine_ms');
  assert.deepEqual(Object.keys(merged.indicators).sort(), [
    'hydroxybutyric_acid', 'hydroxypropionic_acid', 'lactate', 'methylcitric_acid_1',
    'methylcitric_acid_2', 'methylmalonic_acid'
  ]);
  assert.equal(merged.indicators.methylcitric_acid_1.value, '5.60');
  assert.equal(merged.indicators.methylcitric_acid_2.value, '6.70');
  assert.equal(merged.context.itemCount, 6);
  assert.equal(merged.conflicts.length, 0);
});

for (const item of [
  { name: '未知名称', indicator_key: 'unregistered_key', value: '1' },
  { name: 'Hemoglobin', indicator_key: 'hgb', value: '1' },
  { indicator_key: 'methylmalonic_acid', value: '1' },
  { name: 'Urinary methylmalonate', indicator_key: 'methylmalonic_acid', value: '?' }
]) {
  test('非法目标、缺少原名或不可读数值不能自动填入：' + JSON.stringify(item), () => {
    const merged = mergeReportPages([recognizedPage([item])], 'urine_ms');
    assert.deepEqual(merged.indicators, {});
    assert.equal(merged.rows.length, 0);
  });
}

for (const fields of [{ indicator_key: 3 }, { indicator_key: {} }, { indicator_key: 'x'.repeat(81) },
  { needs_review: 'false' }, { needs_review: 1 }]) {
  test('模型字段类型或长度错误须明确报错：' + JSON.stringify(fields), () => {
    assert.throws(() => normalizeReportResult(response([
      { name: '乳酸', indicator_key: 'lactate', value: '1', ...fields }
    ]), 'urine_ms'), { code: 'INVALID_MODEL_RESULT' });
  });
}

test('模型编号缺失时仍可由明确名称辅助归属', () => {
  const merged = mergeReportPages([recognizedPage([{ name: '3-HPA', value: '8' }])], 'urine_ms');
  assert.deepEqual(Object.keys(merged.indicators), ['hydroxypropionic_acid']);
  assert.equal(merged.indicators.hydroxypropionic_acid.value, '8');
});

test('明确原名与模型编号矛盾时按原名纠正，原值保留且不制造核对', () => {
  const pages = [recognizedPage([{ name: '乳酸', indicator_key: 'methylmalonic_acid', value: '2.4000', ref_range: '0-5' }])];
  const merged = mergeReportPages(pages, 'urine_ms');
  assert.equal(merged.indicators.lactate.sourceText, '乳酸');
  assert.equal(merged.indicators.lactate.value, '2.4000');
  assert.equal(merged.indicators.lactate.needsReview, false);
  assert.equal(merged.indicators.methylmalonic_acid, undefined);
  assert.equal(merged.conflicts.length, 0);
});

test('归属不确定时不强塞目标，即使数字可读也不制造核对候选', () => {
  const pages = [recognizedPage([{ name: 'Urinary methylmalonate', indicator_key: 'methylmalonic_acid', value: 0, needs_review: true }])];
  const pending = mergeReportPages(pages, 'urine_ms');
  assert.deepEqual(pending.indicators, {});
  assert.equal(pending.conflicts.length, 0);
  assert.equal(pending.rows.length, 0);
});

for (const reverse of [false, true]) {
  test('多页同值的模糊归属不能污染明确原行，顺序反转：' + reverse, () => {
    const pages = [
      recognizedPage([{ name: 'Urinary methylmalonate', indicator_key: 'methylmalonic_acid', value: '1', needs_review: true }]),
      recognizedPage([{ name: '甲基丙二酸', indicator_key: 'methylmalonic_acid', value: '1.00', ref_range: '0-5' }])
    ];
    const pending = mergeReportPages(reverse ? pages.reverse() : pages, 'urine_ms');
    assert.equal(pending.indicators.methylmalonic_acid.value, '1.00');
    assert.equal(pending.indicators.methylmalonic_acid.minRange, '0');
    assert.equal(pending.indicators.methylmalonic_acid.maxRange, '5');
    assert.equal(pending.conflicts.length, 0);
  });
}

for (const change of ['原文', '参考范围']) {
  test('无关候选改变' + change + '不改变已确认的真实同项目冲突选择', () => {
    const item = { name: 'Urinary methylmalonate', indicator_key: 'methylmalonic_acid', value: '1', needs_review: true };
    const originals = [
      recognizedPage([{ name: '甲基丙二酸', indicator_key: 'methylmalonic_acid', value: '1' }]),
      recognizedPage([{ name: 'MMA', indicator_key: 'methylmalonic_acid', value: '2' }])
    ];
    const pending = mergeReportPages(originals, 'urine_ms');
    assert.equal(pending.conflicts.length, 1);
    const choices = { methylmalonic_acid: pending.conflicts[0].variants[0].signature };
    assert.equal(mergeReportPages(originals, 'urine_ms', choices).rows[0].needsReview, false);
    const updated = recognizedPage([{ ...item, ...(change === '原文' ? { name: 'Methylmalonic acid in urine' } : { ref_range: '0-5' }) }]);
    const merged = mergeReportPages([...originals, updated], 'urine_ms', choices);
    assert.equal(merged.indicators.methylmalonic_acid.value, '1');
    assert.equal(merged.rows[0].needsReview, false);
  });
}

for (const reverse of [false, true]) {
  test('同页模糊归属不让明确同值项目进入核对，顺序反转：' + reverse, () => {
    const items = [
      { name: 'Urinary methylmalonate', indicator_key: 'methylmalonic_acid', value: '1', needs_review: true },
      { name: '甲基丙二酸', indicator_key: 'methylmalonic_acid', value: '1.00', ref_range: '0-5' }
    ];
    const merged = mergeReportPages([recognizedPage(reverse ? items.reverse() : items)], 'urine_ms');
    assert.equal(merged.indicators.methylmalonic_acid.value, '1.00');
    assert.equal(merged.rows[0].needsReview, false);
    assert.equal(merged.conflicts.length, 0);
  });
}
