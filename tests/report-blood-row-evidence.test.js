const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReportResult, readBloodSourceRows, normalizeBloodMappingResult, combineBloodSourceRows } = require('../cloudfunctions/recognizeReportCustom/customOcrAdapter');
const { parseStructuredReportItems } = require('../miniprogram/pkg-report/utils/reportOcrParser');

function response(raw) {
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw) } }] };
}

function sourceResponse(rows) {
  return response({ rows: rows.map(row => ({ n: row[1], v: row[2], r: row[3], u: row[4], f: row[5] })) });
}

test('按不可改写的原行取值，模型错选行号也不能将Ala值改名塞给Arg', () => {
  const raw = { rows: [
    ['1', '丙氨酸(Ala)', '200', '100-500', 'μmol/L', ''],
    ['2', '精氨酸(Arg)', '50', '1-65', 'μmol/L', ''],
    ['5', '亮氨酸(Leu)', '100', '60-250', 'μmol/L', ''],
    ['6', '甲硫氨酸(Met)', '15', '8-40', 'μmol/L', '']
  ], matches: [['arginine', '1'], ['met', '5']] };
  const normalized = normalizeReportResult(response(raw), 'blood_ms');
  const parsed = parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: normalized.structuredItems });
  assert.deepEqual(Object.keys(parsed), ['arginine', 'iso_leu', 'met']);
  assert.equal(parsed.arginine.value, '50');
  assert.equal(parsed.arginine.sourceRowId, '2');
  assert.equal(parsed.iso_leu.value, '100');
  assert.equal(parsed.met.value, '15');
  assert.equal(normalized.structuredItems.find(item => item.indicatorKey === 'arginine').sourceRowId, '2');
});

test('模型可以将未收录名称映射到原行，但不能重写该行数值与范围', () => {
  const normalized = normalizeReportResult(response({ rows: [
    ['r1', 'Plasma arginine measurement', '0', '1-65', 'μmol/L', '']
  ], matches: [['arginine', 'r1']] }), 'blood_ms');
  assert.equal(normalized.structuredItems.length, 1);
  assert.equal(normalized.structuredItems[0].name, 'Plasma arginine measurement');
  assert.equal(normalized.structuredItems[0].value, '0');
  assert.equal(normalized.structuredItems[0].minRange, '1');
  assert.equal(normalized.structuredItems[0].sourceRowId, 'r1');
});

test('不存在的行号不能构造结果', () => {
  assert.throws(() => normalizeReportResult(response({ rows: [
    ['1', '精氨酸(Arg)', '10', '1-65', '', '']
  ], matches: [['arginine', 'missing']] }), 'blood_ms'), { code: 'INVALID_MODEL_RESULT' });
});

test('重复行号不能让后面的行覆盖前面的证据', () => {
  assert.throws(() => normalizeReportResult(response({ rows: [
    ['1', '丙氨酸(Ala)', '200', '100-500', '', ''],
    ['1', '精氨酸(Arg)', '10', '1-65', '', '']
  ], matches: [['arginine', '1']] }), 'blood_ms'), { code: 'INVALID_MODEL_RESULT' });
});

test('映射只能包含编号和行号，不接受携带另一个名称或值覆盖原行', () => {
  assert.throws(() => normalizeReportResult(response({ rows: [
    ['1', '丙氨酸(Ala)', '200', '100-500', '', '']
  ], matches: [['arginine', '1', { name: '精氨酸(Arg)', value: '10' }]] }), 'blood_ms'), { code: 'INVALID_MODEL_RESULT' });
});

test('同一原行不能映射给两个不同目标', () => {
  assert.throws(() => normalizeReportResult(response({ rows: [
    ['1', '新项目名称', '10', '1-65', '', '']
  ], matches: [['arginine', '1'], ['met', '1']] }), 'blood_ms'), { code: 'INVALID_MODEL_RESULT' });
});

test('缺少原行证据的旧血报告输出不能作为新协议结果接收', () => {
  assert.throws(() => normalizeReportResult(response({ items: [
    { name: '精氨酸(Arg)', indicator_key: 'arginine', value: '200' }
  ] }), 'blood_ms'), { code: 'INVALID_MODEL_RESULT' });
});

test('正常空原表不补项目', () => {
  assert.deepEqual(normalizeReportResult(response({ rows: [], matches: [] }), 'blood_ms').structuredItems, []);
});

for (const [reason, raw] of [
  ['ROWS_MISSING', { items: [] }],
  ['MATCHES_MISSING', { rows: [] }],
  ['DUPLICATE_ROW_ID', { rows: [['1', '亮氨酸', '100', '', '', ''], ['1', '甲硫氨酸', '15', '', '', '']], matches: [] }],
  ['MAPPING_ROW_MISSING', { rows: [], matches: [['iso_leu', 'missing']] }],
  ['FIELD_TYPE_INVALID', { rows: [['1', '亮氨酸', { raw: 'PRIVATE_REPORT_TEXT' }, '', '', '']], matches: [] }]
]) {
  test('结构校验记录固定原因而不泄露原内容：' + reason, () => {
    assert.throws(() => normalizeReportResult(response(raw), 'blood_ms'), error => {
      assert.equal(error.code, 'INVALID_MODEL_RESULT');
      assert.equal(error.diagnostic.validationReason, reason);
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_REPORT_TEXT/);
      return true;
    });
  });
}

test('血报告映射留空不能删除原表中名称和结果清楚的亮氨酸', () => {
  const normalized = normalizeReportResult(response({ rows: [
    ['5', '亮氨酸(Leu)', '100', '60-250', 'μmol/L', ''],
    ['22', 'Leu/Phe', '2', '1-5', '', ''],
    ['23', '未知项目', '8', '', '', '']
  ], matches: [[null, '5'], [null, '22'], [null, '23']] }), 'blood_ms');
  assert.deepEqual(normalized.structuredItems.map(item => item.indicatorKey), ['iso_leu']);
  assert.equal(normalized.structuredItems[0].sourceRowId, '5');
  assert.equal(normalized.structuredItems[0].value, '100');
});

test('独立转录阶段保留非目标原行，映射阶段不能替换原表的名称或数值', () => {
  const rows = readBloodSourceRows(sourceResponse([
    ['1', '丙氨酸(Ala)', '200', '100-500', 'μmol/L', ''],
    ['5', '亮氨酸(Leu)', '100', '60-250', 'μmol/L', ''],
    ['6', '新写法的甲硫氨酸项目', '15', '8-40', 'μmol/L', '']
  ]));
  assert.equal(rows.length, 3);
  const mapped = normalizeBloodMappingResult(rows, response({
    rows: [['5', '甲硫氨酸(Met)', '999', '0-1', '', '']],
    matches: [['iso_leu', 'r2'], ['met', 'r3']]
  }));
  assert.deepEqual(mapped.structuredItems.map(item => [item.indicatorKey, item.value]), [['iso_leu', '100'], ['met', '15']]);
});

test('原表阶段的无效结构、缺失必填字段和字段类型仍在归属前拒绝', () => {
  for (const rows of [
    [{ n: '亮氨酸', v: {} }],
    [{ n: '亮氨酸' }],
    [['亮氨酸', '100']]
  ]) assert.throws(() => readBloodSourceRows(response({ rows })), { code: 'INVALID_MODEL_RESULT' });
});

test('紧凑对象原行允许缺省单位和标记，程序编号后完整保留数值及语义归属', () => {
  const original = [
    { n: '实验室项目甲', v: '100', r: '60-250', u: 'μmol/L' },
    { n: '实验室项目乙', v: '15' },
    { n: '缬氨酸(Val)', v: '90', r: '55-250', u: 'μmol/L', f: '' }
  ];
  const rows = readBloodSourceRows(response({ rows: original }));
  assert.deepEqual(rows, [
    ['r1', '实验室项目甲', '100', '60-250', 'μmol/L', null],
    ['r2', '实验室项目乙', '15', null, null, null],
    ['r3', '缬氨酸(Val)', '90', '55-250', 'μmol/L', '']
  ]);
  const result = normalizeBloodMappingResult(rows, response({ matches: [['iso_leu', 'r1'], ['met', 'r2']] }));
  assert.deepEqual(result.structuredItems.map(item => [item.indicatorKey, item.value, item.sourceRowId]),
    [['iso_leu', '100', 'r1'], ['met', '15', 'r2'], ['val', '90', 'r3']]);
  assert.throws(() => normalizeBloodMappingResult(rows, response({ matches: [['iso_leu', '5']] })),
    error => error.diagnostic.validationReason === 'MAPPING_ROW_MISSING');
});

test('转录重新编号不能掩盖同一项目的矛盾检测值', () => {
  assert.throws(() => readBloodSourceRows(sourceResponse([
    ['5', '亮氨酸(Leu)', '100', '60-250', '', ''],
    ['5', '亮氨酸(Leu)', '110', '60-250', '', '']
  ])), error => error.diagnostic.validationReason === 'SOURCE_VALUE_CONFLICT');
});

test('不同照片的局部行号可以相同，合并后保留独立原行证据', () => {
  const chunks = [[['1', '亮氨酸(Leu)', '100', '60-250', '', '']],
    [['1', '甲硫氨酸(Met)', '15', '8-40', '', '']]];
  const original = JSON.stringify(chunks);
  const rows = combineBloodSourceRows(chunks);
  assert.deepEqual(rows.map(row => row[0]), ['p1r1', 'p2r1']);
  assert.equal(JSON.stringify(chunks), original);
  const result = normalizeBloodMappingResult(rows, response({ matches: [['iso_leu', 'p1r1'], ['met', 'p2r1']] }));
  assert.deepEqual(result.structuredItems.map(item => [item.indicatorKey, item.value]), [['iso_leu', '100'], ['met', '15']]);
});

test('重叠照片的等价读数自动合并并补全范围，不丢弃未收录名称的语义映射', () => {
  const rows = combineBloodSourceRows([
    [['5', '亮氨酸(Leu)', '100.000', '', 'μmol/L', '']],
    [['5', '亮氨酸(Leu)', '100', '60-250', 'µmol/L', ''],
      ['6', 'Plasma arginine measurement', '20', '1-65', '', '']]
  ]);
  const result = normalizeBloodMappingResult(rows, response({ matches: [['iso_leu', 'p1r1'], ['arginine', 'p2r2']] }));
  assert.equal(result.structuredItems.length, 2);
  const leu = result.structuredItems.find(item => item.indicatorKey === 'iso_leu');
  assert.equal(leu.minRange, '60');
  assert.equal(leu.maxRange, '250');
  assert.deepEqual(leu.sourceRowIds, ['p1r1', 'p2r1']);
  const parsed = parseStructuredReportItems({ reportType: 'blood_ms', structuredItems: result.structuredItems });
  assert.deepEqual(parsed.iso_leu.sourceRowIds, ['p1r1', 'p2r1']);
  assert.equal(result.structuredItems.find(item => item.indicatorKey === 'arginine').value, '20');
});

test('重叠照片同一指标的矛盾读数不能被静默挑选或覆盖', () => {
  assert.throws(() => combineBloodSourceRows([
    [['5', '亮氨酸(Leu)', '100', '60-250', '', '']],
    [['5', '亮氨酸(Leu)', '110', '60-250', '', '']]
  ]), error => {
    assert.equal(error.code, 'INVALID_MODEL_RESULT');
    assert.equal(error.diagnostic.validationReason, 'SOURCE_VALUE_CONFLICT');
    return true;
  });
});
