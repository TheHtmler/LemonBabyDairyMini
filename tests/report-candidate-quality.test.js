const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportResult } = require('../cloudfunctions/recognizeReportCustom/customOcrAdapter');
const { parseStructuredReportItems } = require('../miniprogram/pkg-report/utils/reportOcrParser');
const { mergeReportPages } = require('../miniprogram/pkg-report/utils/reportPageMerge');

function page(item) {
  const normalized = normalizeReportResult({ choices: [{ finish_reason: 'stop',
    message: { content: JSON.stringify({ items: [item] }) } }] }, 'urine_ms');
  const parsed = parseStructuredReportItems({ reportType: 'urine_ms', structuredItems: normalized.structuredItems });
  return { status: 'success', result: { indicators: parsed, rawIndicators: parsed,
    context: { itemCount: normalized.structuredItems.length } } };
}

// 使用虚构数值复现不同化合物被错塞入同一编号的情况，不写入患者检验值。
for (const [key, correct, wrong] of [
  ['methylmalonic_acid', '甲基丙二酸-2', ['乙基丙二酸-2', '巴豆酰甘氨酸-1']],
  ['hydroxypropionic_acid', '3-羟基丙酸-2', ['辛酸-1', '3-(3-羟苯基)-3-羟基丙酸-3']],
  ['methylcitric_acid_1', '甲基枸缘酸-4(1)', ['枸橼酸-4', '异枸橼酸-4']],
  ['methylcitric_acid_2', '甲基枸缘酸-4(2)', ['高香草酸-2', '乌头酸-3']],
  ['lactate', '乳酸-2', ['苯乳酸-2', '4-羟基苯乳酸-3']]
]) {
  for (const value of ['0.01', '9000']) {
    test('明确原行优先于其他化合物的模型误归类：' + key + '，原值' + value, () => {
      const pages = wrong.map((name, index) => page({ name, indicator_key: key,
        value: String(index + 1), ref_range: '0-8' }));
      const source = page({ name: correct, indicator_key: key, value, ref_range: '0-5' });
      for (const ordered of [[source, ...pages], [...pages, source]]) {
        const merged = mergeReportPages(ordered, 'urine_ms');
        assert.equal(merged.indicators[key]?.value, value);
        assert.equal(merged.indicators[key].minRange, '0');
        assert.equal(merged.indicators[key].maxRange, '5');
        assert.equal(merged.conflicts.length, 0);
      }
    });
  }
}

test('同值的弱候选不能给明确原行补入其他项目的参考范围', () => {
  const merged = mergeReportPages([
    page({ name: '乙基丙二酸-2', indicator_key: 'methylmalonic_acid', value: '1', ref_range: '0-8' }),
    page({ name: '甲基丙二酸-2', indicator_key: 'methylmalonic_acid', value: '1' })
  ], 'urine_ms');
  assert.equal(merged.indicators.methylmalonic_acid.maxRange, '');
  assert.equal(merged.conflicts.length, 0);
});

test('同一指标的两个明确来源真实不同时仍核对，弱候选不进入选项', () => {
  const merged = mergeReportPages([
    page({ name: '甲基丙二酸-2', indicator_key: 'methylmalonic_acid', value: '1', ref_range: '0-5' }),
    page({ name: 'MMA', indicator_key: 'methylmalonic_acid', value: '2', ref_range: '0-5' }),
    page({ name: '乙基丙二酸-2', indicator_key: 'methylmalonic_acid', value: '3', ref_range: '0-8' })
  ], 'urine_ms');
  assert.deepEqual(merged.indicators, {});
  assert.equal(merged.conflicts[0].variants.length, 2);
  assert.deepEqual(merged.conflicts[0].variants.map(variant => variant.valueText), ['1', '2']);
  assert.deepEqual(merged.conflicts[0].variants.map(variant => variant.sourceText), ['甲基丙二酸-2', 'MMA']);
});

test('模型明确留空的编号不能由名称兜底重新填入', () => {
  const merged = mergeReportPages([page({ name: '甲基丙二酸', indicator_key: null, value: '1' })], 'urine_ms');
  assert.deepEqual(merged.indicators, {});
});

test('只有词典外明确模型映射时仍保留，不退回名称白名单', () => {
  const merged = mergeReportPages([page({ name: 'Urinary methylmalonate',
    indicator_key: 'methylmalonic_acid', value: '7.5' })], 'urine_ms');
  assert.equal(merged.indicators.methylmalonic_acid.value, '7.5');
  assert.equal(merged.conflicts.length, 0);
});
