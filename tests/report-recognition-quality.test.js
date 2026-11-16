const test = require('node:test');
const assert = require('node:assert/strict');
const { matchReportIndicator } = require('../miniprogram/pkg-report/utils/reportRecognitionRules');
const { parseStructuredReportItems } = require('../miniprogram/pkg-report/utils/reportOcrParser');
const { mergeReportPages } = require('../miniprogram/pkg-report/utils/reportPageMerge');
const { normalizeReportResult } = require('../cloudfunctions/recognizeReportCustom/customOcrAdapter');
const { validateReportImage } = require('../cloudfunctions/recognizeReportCustom/imagePreprocess');
const { REPORT_MAX_IMAGE_BYTES } = require('../miniprogram/constants/reportTypes');
const { bloodReportResponse } = require('./helpers/bloodReportResponse');

for (const name of ['精氨酸', 'Arg', 'arg', 'ARG', 'Ａｒｇ', '精氨酸(Arg)', 'Arg 精氨酸', '1. 精氨酸', '①精氨酸']) {
  test('血报告识别精氨酸名称：' + name, () => {
    assert.equal(matchReportIndicator(name, 'blood_ms')?.key, 'arginine');
  });
}

for (const name of ['精氨酰琥珀酸', '精氨酸琥珀酸', 'Arg-Succ', '精氨酰琥珀酸(Arg)', '精氨酸/瓜氨酸', '肌酐', 'Arginine succinic acid']) {
  test('血报告排除相似但不属于目标的项目：' + name, () => {
    assert.equal(matchReportIndicator(name, 'blood_ms'), null);
  });
}

for (const [name, key] of [
  ['甲基丙二酸(MMA)', 'methylmalonic_acid'], ['MMA', 'methylmalonic_acid'],
  ['3-羟基丙酸', 'hydroxypropionic_acid'], ['3-HPA', 'hydroxypropionic_acid'],
  ['3-羟基丁酸-2', 'hydroxybutyric_acid'], ['3-HBA(2)', 'hydroxybutyric_acid'],
  ['甲基枸橼酸(1)', 'methylcitric_acid_1'], ['MCA1', 'methylcitric_acid_1'],
  ['甲基枸橼酸(2)', 'methylcitric_acid_2'], ['MCA(2)', 'methylcitric_acid_2'],
  ['甲基枸缘酸（２）', 'methylcitric_acid_2'], ['乳酸(Lac)', 'lactate']
]) {
  test('尿报告保留完整名称与正确编号：' + name, () => {
    assert.equal(matchReportIndicator(name, 'urine_ms')?.key, key);
  });
}

for (const name of ['丙二酸', '甲基丙二酸/肌酐', '2-羟基丁酸', '3,4-二羟基丁酸', '3-羟基丁酸-1', '甲基枸橼酸(3)', '肌酐', 'Arg', '甲基枸橼酸(1)(MCA2)']) {
  test('尿报告不截取其他项目或错误编号：' + name, () => {
    assert.equal(matchReportIndicator(name, 'urine_ms'), null);
  });
}

test('括号缩写可插在中文名中间，但须指向同一指标', () => {
  assert.equal(matchReportIndicator('血小板(PLT)计数', 'blood_cbc')?.key, 'plt');
  assert.equal(matchReportIndicator('血小板(HGB)计数', 'blood_cbc'), null);
});

test('明确原名称纠正模型编号，已知其他化合物不制造核对候选', () => {
  const result = parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: [
    { indicatorKey: 'arginine', name: '精氨酰琥珀酸(Arg)', value: '123' },
    { indicatorKey: 'c0', name: 'Arg', value: '999.125', refRange: '1-10' }
  ] });
  assert.deepEqual(Object.keys(result), ['arginine']);
  assert.equal(result.arginine.value, '999.125');
  assert.equal(result.arginine.sourceText, 'Arg');
  assert.equal(result.arginine.minRange, '1');
  assert.equal(result.arginine.maxRange, '10');
  assert.equal(result.arginine.needsReview, false);
  const merged = mergeReportPages([{ status: 'success', result: {
    indicators: result, rawIndicators: result, context: { itemCount: 2 }
  } }], 'blood_ms');
  assert.equal(merged.indicators.arginine.value, '999.125');
  assert.equal(merged.conflicts.length, 0);
});

test('仅有模型编号而没有原项目名称证据时不盲填', () => {
  assert.deepEqual(parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: [
    { indicatorKey: 'arginine', value: '99' }, { indicator_key: 'c3', value: '8' }
  ] }), {});
});

test('尿报告结构化结果不吸收更长的相似化合物行', () => {
  const result = parseStructuredReportItems({ reportType: 'urine_ms', structuredItems: [
    { name: '3-羟基丁酸-1', value: '88' },
    { name: '3,4-二羟基丁酸', value: '77' },
    { name: '3-羟基丁酸-2', value: '6.75' },
    { name: '甲基枸橼酸(3)', value: '66' },
    { name: '甲基枸橼酸(2)', value: '2.5' }
  ] });
  assert.equal(result.hydroxybutyric_acid.value, '6.75');
  assert.equal(result.methylcitric_acid_2.value, '2.5');
  assert.equal(result.methylcitric_acid_1, undefined);
});

test('结构化解析保留真实异常值与零值，忽略无结果行', () => {
  const result = parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: [
    null, { name: '精氨酸', value: null },
    { name: 'Arg', value: 0, minRange: 0, maxRange: 5 },
    { name: '丙酰基肉碱(C3)', value: '9999', refRange: '0.1-5' }
  ] });
  assert.equal(result.arginine.value, '0');
  assert.equal(result.arginine.minRange, '0');
  assert.equal(result.c3.value, '9999');
});

test('同页重复结果优先采用完整名称依据', () => {
  const result = parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: [
    { name: 'Arg', value: '99' }, { name: '精氨酸(Arg)', value: '3.5' }
  ] });
  assert.equal(result.arginine.value, '3.5');
});

function modelResponse(items, finishReason = 'stop') {
  return { choices: [{ finish_reason: finishReason, message: { content: JSON.stringify({ items }) } }] };
}

test('云端依据明确原名纠正归属，其他化合物不进入目标，原值不改写', () => {
  const result = normalizeReportResult(bloodReportResponse([
    { name: '精氨酰琥珀酸(Arg)', indicator_key: 'arginine', value: '123' },
    { name: 'Arg', indicator_key: 'methylmalonic_acid', value: '999.125', ref_range: '1-10' },
    { name: '肌酐', value: '7' }
  ]), 'blood_ms');
  assert.equal(result.structuredItems.length, 1);
  assert.equal(result.structuredItems[0].indicatorKey, 'arginine');
  assert.equal(result.structuredItems[0].value, '999.125');
  assert.equal(result.structuredItems[0].refRange, '1-10');
  assert.equal(result.structuredItems[0].needsReview, false);
  assert.deepEqual(result.statistics, { extractedCount: 3, acceptedCount: 1, filteredCount: 2 });
});

test('整页无目标指标作为正常空结果，模糊结果不补值', () => {
  const result = normalizeReportResult(modelResponse([
    { name: '肌酐', value: '100' }, { name: 'MMA', value: '?' }, { name: '乳酸', value: null }
  ]), 'urine_ms');
  assert.deepEqual(result.structuredItems, []);
});

test('模型截断或返回损坏结构仍是明确错误', () => {
  assert.throws(() => normalizeReportResult(modelResponse([], 'length'), 'urine_ms'), { code: 'MODEL_OUTPUT_TRUNCATED' });
  assert.throws(() => normalizeReportResult(modelResponse([null]), 'urine_ms'), { code: 'INVALID_MODEL_RESULT' });
});

function page(id, value, extra = {}, indicatorValue = value) {
  const raw = { value, minRange: '', maxRange: '', unit: '', ...extra };
  return { id, status: 'success', result: { indicators: { arginine: { ...raw, value: indicatorValue } },
    rawIndicators: { arginine: raw }, context: { itemCount: 1 } } };
}

test('同值结果自动互补缺失参考范围，保留数字零边界', () => {
  const result = mergeReportPages([
    page('a', '1.2300'), page('b', '1.23', { minRange: 0, maxRange: '5', unit: 'umol/L' })
  ], 'blood_ms');
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(Number(result.indicators.arginine.value), 1.23);
  assert.equal(result.indicators.arginine.minRange, '0.000');
  assert.equal(result.indicators.arginine.maxRange, '5.000');
});

test('科学计数法与普通小数表示同一结果，不要求核对', () => {
  const result = mergeReportPages([page('a', '1e-3'), page('b', '0.001')], 'blood_ms');
  assert.equal(result.conflicts.length, 0);
  assert.equal(Number(result.indicators.arginine.value), 0.001);
});

test('微符号和升的大小写差异不制造单位冲突', () => {
  const result = mergeReportPages([
    page('a', '1.2', { unit: 'μmol/L' }), page('b', '1.2', { unit: 'µmol/l' }), page('c', '1.2', { unit: 'umol/L' })
  ], 'blood_ms');
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.rows[0].needsReview, false);
});

test('显示舍入相同仍按未舍入值保留真正冲突', () => {
  const result = mergeReportPages([page('a', '0.0001', {}, '0.000'), page('b', '0.0002', {}, '0.000')], 'blood_ms');
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.rows[0].needsReview, true);
  assert.equal(result.indicators.arginine, undefined);
});

test('明确不同的数值只能按用户选定的结果填入', () => {
  const pages = [page('a', '1'), page('b', '2')];
  const pending = mergeReportPages(pages, 'blood_ms');
  const selected = mergeReportPages(pages, 'blood_ms', { arginine: pending.conflicts[0].variants[1].signature });
  assert.equal(selected.indicators.arginine.value, '2');
  assert.equal(selected.rows[0].needsReview, false);
});

test('已确认结果补入同值完整信息后仍保留原选择', () => {
  const later = page('b', '1');
  const other = page('c', '2');
  const pending = mergeReportPages([{ id: 'a', status: 'pending' }, later, other], 'blood_ms');
  const signature = pending.conflicts[0].variants.find(variant => variant.valueText === '1').signature;
  const result = mergeReportPages([
    page('a', '1', { minRange: '0', maxRange: '5', unit: 'umol/L' }), later, other
  ], 'blood_ms', { arginine: signature });
  assert.equal(Number(result.indicators.arginine?.value), 1);
  assert.equal(result.indicators.arginine.minRange, '0.000');
  assert.equal(result.rows[0].needsReview, false);
});

test('相互矛盾的范围、倒置的互补范围和不同物理单位不自动合并', () => {
  for (const pages of [
    [page('a', '1', { minRange: '0', maxRange: '5' }), page('b', '1', { minRange: '0', maxRange: '6' })],
    [page('a', '1', { minRange: '3' }), page('b', '1', { maxRange: '2' })],
    [page('a', '1', { unit: 'mg/L' }), page('b', '1', { unit: 'umol/L' })]
  ]) {
    const result = mergeReportPages(pages, 'blood_ms');
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.indicators.arginine, undefined);
  }
});

test('空页和失败页不污染已识别指标的汇总', () => {
  const result = mergeReportPages([
    { id: 'empty', status: 'success', result: { indicators: {}, context: { itemCount: 0 } } },
    { id: 'failed', status: 'failed' }, page('good', '2')
  ], 'blood_ms');
  assert.deepEqual(Object.keys(result.indicators), ['arginine']);
  assert.equal(result.rows.length, 1);
});

test('数值下溢不能把可见的非零结果归为零', () => {
  const result = mergeReportPages([page('a', '1e-999'), page('b', '0')], 'blood_ms');
  assert.equal(result.conflicts.length, 1);
});

test('图片大小边界允许清晰原图，但仍限制超大文件', () => {
  const image = Buffer.alloc(3 * 1024 * 1024);
  image[0] = 0xff; image[1] = 0xd8;
  assert.equal(validateReportImage(image), 'image/jpeg');
  assert.throws(() => validateReportImage(Buffer.alloc(REPORT_MAX_IMAGE_BYTES + 1)), { code: 'IMAGE_TOO_LARGE' });
});
