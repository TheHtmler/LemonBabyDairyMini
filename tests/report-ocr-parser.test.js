const test = require('node:test');
const assert = require('node:assert/strict');
const {
  groupOcrItemsIntoLines,
  parseNumbersFromLine,
  parseRefRange,
  parseReportOcrResult,
  parseStructuredReportItems
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

test('parseReportOcrResult ignores VAL/PHE and keeps valine row with OCR Va1 typo', () => {
  const result = parseReportOcrResult({
    reportType: 'blood_ms',
    items: [
      { text: 'VAL/PHE', pos: { top: 10, left: 20, height: 20 } },
      { text: '0.120', pos: { top: 10, left: 220, height: 20 } },
      { text: '缬氨酸(Va1)', pos: { top: 60, left: 20, height: 20 } },
      { text: '80.000', pos: { top: 60, left: 220, height: 20 } },
      { text: '60.000-250.000', pos: { top: 60, left: 320, height: 20 } }
    ]
  });

  assert.deepEqual(result.val, {
    value: '80.000',
    minRange: '60.000',
    maxRange: '250.000',
    sourceText: '缬氨酸(Va1) 80.000 60.000-250.000'
  });
});

test('parseStructuredReportItems maps blood_ms arginine as first amino marker', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { name: '精氨酸', value: '45.2', ref_range: '20.0-80.0' },
      { indicator_key: 'Arg', value: '42.1', ref_range: '18-75' }
    ]
  });

  assert.equal(result.arginine.value, '45.2');
});

test('parseStructuredReportItems maps blood carnitines and ignores ratio-like names', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { name: '游离肉碱(C0)', value: '30.000', ref_range: '10.000-40.000' },
      { name: 'C0/(C16+C18)', value: '0.120', ref_range: '0.010-0.080' },
      { name: '丙酰基肉碱(C3)', value: '8.000', ref_range: '0.500-5.000' },
      { name: 'C3/C0', value: '0.450', ref_range: '0.100-0.400' },
      { name: '酰基肉碱(C2)', value: '5.500', ref_range: '0.200-4.000' },
      { name: 'C3/C2', value: '0.320', ref_range: '0.100-0.300' }
    ]
  });

  assert.equal(result.c0.value, '30.000');
  assert.equal(result.c3.value, '8.000');
  assert.equal(result.c2.value, '5.500');
  assert.equal(result.c3_c0.value, '0.450');
  assert.equal(result.c3_c0.minRange, '0.100');
  assert.equal(result.c3_c0.maxRange, '0.400');
  assert.equal(result.c3_c2.value, '0.320');
  assert.equal(result.c3_c2.minRange, '0.100');
  assert.equal(result.c3_c2.maxRange, '0.300');
});

test('parseStructuredReportItems maps blood ratio ranges independently', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { name: 'C3/C0', value: '0.450', ref_range: '0.100-0.400' },
      { name: 'C3/C2', value: '0.320', ref_range: '0.080-0.280' }
    ]
  });

  assert.equal(result.c3_c0.minRange, '0.100');
  assert.equal(result.c3_c0.maxRange, '0.400');
  assert.equal(result.c3_c2.minRange, '0.080');
  assert.equal(result.c3_c2.maxRange, '0.280');
});

test('parseStructuredReportItems does not map long-chain acylcarnitines to C2', () => {
  const blocked = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { name: '十四烷酰基肉碱(C14)', value: '0.120', ref_range: '0.010-0.080' },
      { indicator_key: 'C2', name: '十四烷酰基肉碱(C14)', value: '0.120', ref_range: '0.010-0.080' },
      { name: '十六烷酰基肉碱(C16)', value: '0.080', ref_range: '0.010-0.060' }
    ]
  });

  assert.equal(blocked.c2, undefined);

  const matched = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { name: '十四烷酰基肉碱(C14)', value: '0.120', ref_range: '0.010-0.080' },
      { name: '酰基肉碱(C2)', value: '5.500', ref_range: '0.200-4.000' },
      { name: '乙酰基肉碱(C2)', value: '6.100', ref_range: '0.200-4.000' }
    ]
  });

  assert.equal(matched.c2.value, '5.500');
});

test('parseReportOcrResult ignores long-chain acylcarnitine rows for C2', () => {
  const result = parseReportOcrResult({
    reportType: 'blood_ms',
    items: [
      { text: '十四烷酰基肉碱(C14)', pos: { top: 10, left: 0, height: 20 } },
      { text: '0.120', pos: { top: 10, left: 220, height: 20 } },
      { text: '酰基肉碱(C2)', pos: { top: 60, left: 0, height: 20 } },
      { text: '5.500', pos: { top: 60, left: 220, height: 20 } }
    ]
  });

  assert.equal(result.c2.value, '5.500');
});

test('parseReportOcrResult ignores carnitine ratio lines on OCR rows', () => {
  const result = parseReportOcrResult({
    reportType: 'blood_ms',
    items: [
      { text: '游离肉碱(C0)', pos: { top: 10, left: 0, height: 20 } },
      { text: '30.000', pos: { top: 10, left: 220, height: 20 } },
      { text: 'C0/(C16+C18)', pos: { top: 60, left: 0, height: 20 } },
      { text: '0.120', pos: { top: 60, left: 220, height: 20 } },
      { text: '丙酰基肉碱(C3)', pos: { top: 110, left: 0, height: 20 } },
      { text: '8.000', pos: { top: 110, left: 220, height: 20 } },
      { text: 'C3/C0', pos: { top: 160, left: 0, height: 20 } },
      { text: '0.450', pos: { top: 160, left: 220, height: 20 } },
      { text: '酰基肉碱(C2)', pos: { top: 210, left: 0, height: 20 } },
      { text: '5.500', pos: { top: 210, left: 220, height: 20 } },
      { text: 'C3/C2', pos: { top: 260, left: 0, height: 20 } },
      { text: '0.320', pos: { top: 260, left: 220, height: 20 } }
    ]
  });

  assert.equal(result.c0.value, '30.000');
  assert.equal(result.c3.value, '8.000');
  assert.equal(result.c2.value, '5.500');
  assert.equal(result.c3_c0.value, '0.450');
  assert.equal(result.c3_c2.value, '0.320');
});

test('parseReportOcrResult maps blood ratio ranges independently on OCR lines', () => {
  const result = parseReportOcrResult({
    reportType: 'blood_ms',
    items: [
      { text: 'C3/C0', pos: { top: 10, left: 0, height: 20 } },
      { text: '0.450', pos: { top: 10, left: 220, height: 20 } },
      { text: '0.100-0.400', pos: { top: 10, left: 320, height: 20 } },
      { text: 'C3/C2', pos: { top: 60, left: 0, height: 20 } },
      { text: '0.320', pos: { top: 60, left: 220, height: 20 } },
      { text: '0.080-0.280', pos: { top: 60, left: 320, height: 20 } }
    ]
  });

  assert.equal(result.c3_c0.minRange, '0.100');
  assert.equal(result.c3_c0.maxRange, '0.400');
  assert.equal(result.c3_c2.minRange, '0.080');
  assert.equal(result.c3_c2.maxRange, '0.280');
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

test('parseStructuredReportItems maps format-report items to indicator keys', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_ammonia',
    structuredItems: [
      { name: '血氨', value: '45.000', refRange: '18.00-72.00', flag: 'normal', confidence: 0.98 }
    ]
  });

  assert.equal(result.ammonia.value, '45.000');
  assert.equal(result.ammonia.minRange, '18.00');
  assert.equal(result.ammonia.maxRange, '72.00');
  assert.equal(result.ammonia.flag, 'normal');
});

test('parseStructuredReportItems resolves indicator_key and label fields from custom OCR', () => {
  const bloodMs = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { indicator_key: 'c3', value: '8.000', ref_range: '0.500-5.000' },
      { label: 'C0', value: '20.000', ref_range: '10.000-40.000' },
      { code: 'iso_leu', value: '42.125', ref_range: '10-40' }
    ]
  });

  assert.equal(bloodMs.c3.value, '8.000');
  assert.equal(bloodMs.c0.value, '20.000');
  assert.equal(bloodMs.iso_leu.value, '42.125');

  const urineMs = parseStructuredReportItems({
    reportType: 'urine_ms',
    structuredItems: [
      { indicator_key: 'mma', value: '120', ref_range: '0-100' },
      { name: '甲基枸橼酸(1)', value: '9', ref_range: '0-5' }
    ]
  });

  assert.equal(urineMs.methylmalonic_acid.value, '120');
  assert.equal(urineMs.methylcitric_acid_1.value, '9');
});

test('parseStructuredReportItems treats Va1 as OCR typo for valine abbreviation', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_ms',
    structuredItems: [
      { indicator_key: 'Va1', value: '80.000', ref_range: '60.000-250.000' }
    ]
  });

  assert.equal(result.val.value, '80.000');
  assert.equal(result.val.minRange, '60.000');
  assert.equal(result.val.maxRange, '250.000');
});

test('parseStructuredReportItems maps 3-羟基丁酸-2 to hydroxybutyric_acid and ignores 3,4-二羟基丁酸', () => {
  const result = parseStructuredReportItems({
    reportType: 'urine_ms',
    structuredItems: [
      { name: '3,4-二羟基丁酸', value: '11.2', ref_range: '0-5' },
      { name: '3-羟基丁酸-2', value: '8.6', ref_range: '0-5' },
      { name: '3-羟基丁酸', value: '3.1', ref_range: '0-5' }
    ]
  });

  assert.equal(result.dihydroxybutyric_acid, undefined);
  assert.equal(result.hydroxybutyric_acid_2, undefined);
  assert.equal(result.hydroxybutyric_acid.value, '8.6');
});

test('parseStructuredReportItems normalizes methylcitric OCR typo 缘 to 橼', () => {
  const result = parseStructuredReportItems({
    reportType: 'urine_ms',
    structuredItems: [
      { name: '甲基枸缘酸(1)', value: '9.5', ref_range: '0-5' },
      { name: '甲基枸缘酸(2)', value: '4.2', ref_range: '0-5' }
    ]
  });

  assert.equal(result.methylcitric_acid_1.value, '9.5');
  assert.equal(result.methylcitric_acid_2.value, '4.2');
});

test('parseStructuredReportItems disambiguates duplicate MCA keys using name suffix', () => {
  const result = parseStructuredReportItems({
    reportType: 'urine_ms',
    structuredItems: [
      { indicator_key: 'MCA', name: '甲基枸缘酸(1)', value: '9.5', ref_range: '0-5' },
      { indicator_key: 'MCA', name: '甲基枸缘酸(2)', value: '4.2', ref_range: '0-5' }
    ]
  });

  assert.equal(result.methylcitric_acid_1.value, '9.5');
  assert.equal(result.methylcitric_acid_2.value, '4.2');
});

test('parseStructuredReportItems maps blood gas pCO2 variants', () => {
  const byKey = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [{ indicator_key: 'pCO2', value: '38.5', ref_range: '35-45' }]
  });
  assert.equal(byKey.pco2.value, '38.5');

  const byName = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [{ name: 'pCO2', value: '40.1', ref_range: '35-45' }]
  });
  assert.equal(byName.pco2.value, '40.1');

  const byChinese = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [{ name: '二氧化碳分压(PCO2)', value: '42.0', ref_range: '35-45' }]
  });
  assert.equal(byChinese.pco2.value, '42.0');
});

test('parseStructuredReportItems maps HCO3std indicator key to hco3', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [
      { indicator_key: 'HCO3std', value: '24.5', ref_range: '22-26' }
    ]
  });

  assert.equal(result.hco3.value, '24.5');
  assert.equal(result.hco3.minRange, '22');
  assert.equal(result.hco3.maxRange, '26');
});

test('parseStructuredReportItems maps BE(B) and parenthesised negative ref range', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [
      { name: 'BE(B)', value: '1.2', ref_range: '(-3)-3' }
    ]
  });

  assert.equal(result.be.value, '1.2');
  assert.equal(result.be.minRange, '-3');
  assert.equal(result.be.maxRange, '3');
});

test('parseStructuredReportItems maps Xinhua-style blood gas panel items', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [
      { name: 'Ca++', value: '1.12', ref_range: '1.12-1.32' },
      { name: 'pCO2', value: '22.10', ref_range: '35-45' },
      { name: 'pH', value: '7.50', ref_range: '7.35-7.45' },
      { name: 'pO2', value: '130.00', ref_range: '80-100' },
      { name: 'BEecf', value: '-5.80', ref_range: '' },
      { name: 'Cl-', value: '108.0', ref_range: '95-105' },
      { name: 'Hct', value: '40.10', ref_range: '37-43' },
      { name: '钾', value: '4.10', ref_range: '3.5-5.1' },
      { name: '钠', value: '138.0', ref_range: '130-150' },
      { name: 'Glu', value: '5.30', ref_range: '3.89-5.83' },
      { name: 'Lac', value: '2.00', ref_range: '0.5-1.6' },
      { name: 'ctHb', value: '13.10', ref_range: '12-17.5' },
      { name: 'BE(B)', value: '-3.90', ref_range: '(-3)-3' },
      { name: 'HCO3std', value: '21.20', ref_range: '22-26' }
    ]
  });

  assert.equal(result.calcium.value, '1.12');
  assert.equal(result.pco2.value, '22.10');
  assert.equal(result.ph.value, '7.50');
  assert.equal(result.po2.value, '130.00');
  assert.equal(result.beecf.value, '-5.80');
  assert.equal(result.chloride.value, '108.0');
  assert.equal(result.hct.value, '40.10');
  assert.equal(result.potassium.value, '4.10');
  assert.equal(result.sodium.value, '138.0');
  assert.equal(result.glucose.value, '5.30');
  assert.equal(result.lactate.value, '2.00');
  assert.equal(result.cthb.value, '13.10');
  assert.equal(result.be.value, '-3.90');
  assert.equal(result.hco3.value, '21.20');
});

test('parseStructuredReportItems maps common blood cbc items', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_cbc',
    structuredItems: [
      { name: '血红蛋白', value: '110', ref_range: '110-160' },
      { name: 'PLT', value: '180', ref_range: '100-300' },
      { name: 'WBC', value: '8.5', ref_range: '4-12' },
      { name: '中性粒细胞绝对值', value: '1.2', ref_range: '1.5-8' }
    ]
  });

  assert.equal(result.hgb.value, '110');
  assert.equal(result.plt.value, '180');
  assert.equal(result.wbc.value, '8.5');
  assert.equal(result.neut_abs.value, '1.2');
});

test('parseStructuredReportItems maps blood cbc crp items including CRP', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_cbc_crp',
    structuredItems: [
      { name: 'C反应蛋白', value: '0.8', ref_range: '0-8' },
      { name: 'WBC', value: '9.2', ref_range: '4-12' },
      { name: '中性粒细胞%', value: '45.0', ref_range: '30-70' },
      { name: '血红蛋白', value: '118', ref_range: '110-160' },
      { name: 'PLT', value: '210', ref_range: '100-300' },
      { name: 'RDW-CV', value: '13.2', ref_range: '11-15' },
      { name: '单核细胞绝对值', value: '0.4', ref_range: '0.1-0.8' }
    ]
  });

  assert.equal(result.crp.value, '0.8');
  assert.equal(result.wbc.value, '9.2');
  assert.equal(result.neut_pct.value, '45.0');
  assert.equal(result.hgb.value, '118');
  assert.equal(result.plt.value, '210');
  assert.equal(result.rdw_cv.value, '13.2');
  assert.equal(result.mono_abs.value, '0.4');
});

test('parseStructuredReportItems parses BE range when adapter min/max are empty strings', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_gas',
    structuredItems: [
      {
        name: 'BE(B)',
        value: '1.2',
        refRange: '(-3)-3',
        minRange: '',
        maxRange: ''
      }
    ]
  });

  assert.equal(result.be.value, '1.2');
  assert.equal(result.be.minRange, '-3');
  assert.equal(result.be.maxRange, '3');
});

test('parseNumbersFromLine parses parenthesised negative reference range', () => {
  const result = parseNumbersFromLine('1.2 (-3)-3 mmol/L');
  assert.deepEqual(result, { value: '1.2', minRange: '-3', maxRange: '3' });
});

test('parseNumbersFromLine maps inequality detection value to threshold number', () => {
  assert.deepEqual(parseNumbersFromLine('<0.5'), { value: '0.5', minRange: '', maxRange: '' });
  assert.deepEqual(parseNumbersFromLine('≤0.5'), { value: '0.5', minRange: '', maxRange: '' });
});

test('parseNumbersFromLine maps upper-bound-only range to 0-max', () => {
  assert.deepEqual(parseNumbersFromLine('0.8 <10'), { value: '0.8', minRange: '0', maxRange: '10' });
  assert.deepEqual(parseNumbersFromLine('<0.5 <10'), { value: '0.5', minRange: '0', maxRange: '10' });
  assert.deepEqual(parseNumbersFromLine('<0.5 0-8'), { value: '0.5', minRange: '0', maxRange: '8' });
});

test('parseNumbersFromLine keeps value and clears clinical-only range text', () => {
  assert.deepEqual(parseNumbersFromLine('42.20 请结合临床'), {
    value: '42.20',
    minRange: '',
    maxRange: ''
  });
});

test('parseRefRange maps inequality and ignores clinical-only text', () => {
  assert.deepEqual(parseRefRange('<10'), { minRange: '0', maxRange: '10' });
  assert.deepEqual(parseRefRange('≤10'), { minRange: '0', maxRange: '10' });
  assert.deepEqual(parseRefRange('>100'), { minRange: '100', maxRange: '' });
  assert.deepEqual(parseRefRange('请结合临床'), { minRange: '', maxRange: '' });
});

test('parseStructuredReportItems maps CRP inequality value/range and clinical-only RDW-SD', () => {
  const result = parseStructuredReportItems({
    reportType: 'blood_cbc_crp',
    structuredItems: [
      { name: 'C反应蛋白', value: '<0.5', ref_range: '<10' },
      { name: '红细胞分布宽度(SD)', value: '42.20', ref_range: '请结合临床' }
    ]
  });

  assert.equal(result.crp.value, '0.5');
  assert.equal(result.crp.minRange, '0');
  assert.equal(result.crp.maxRange, '10');
  assert.equal(result.rdw_sd.value, '42.20');
  assert.equal(result.rdw_sd.minRange, '');
  assert.equal(result.rdw_sd.maxRange, '');
});

test('parseReportOcrResult maps 3-羟基丁酸-2 to hydroxybutyric_acid on OCR lines', () => {
  const result = parseReportOcrResult({
    reportType: 'urine_ms',
    items: [
      { text: '3,4-二羟基丁酸', pos: { top: 10, left: 0, height: 20 } },
      { text: '11.200', pos: { top: 10, left: 220, height: 20 } },
      { text: '3-羟基丁酸-2', pos: { top: 60, left: 0, height: 20 } },
      { text: '8.600', pos: { top: 60, left: 220, height: 20 } },
      { text: '3-羟基丁酸', pos: { top: 110, left: 0, height: 20 } },
      { text: '3.100', pos: { top: 110, left: 220, height: 20 } }
    ]
  });

  assert.equal(result.dihydroxybutyric_acid, undefined);
  assert.equal(result.hydroxybutyric_acid_2, undefined);
  assert.equal(result.hydroxybutyric_acid.value, '8.600');
});
