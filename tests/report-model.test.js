const test = require('node:test');
const assert = require('node:assert/strict');
const ReportModel = require('../miniprogram/models/report');

function buildBloodGasIndicators(overrides = {}) {
  return {
    ph: { value: '7.40', minRange: '7.35', maxRange: '7.45' },
    hco3: { value: '24.0', minRange: '22', maxRange: '26' },
    be: { value: '-1.0', minRange: '-3', maxRange: '3' },
    ...overrides
  };
}

test('blood gas only requires pH, HCO3std and BE(B)', () => {
  const indicators = ReportModel.getIndicators(ReportModel.REPORT_TYPES.BLOOD_GAS);
  const required = indicators.filter((item) => !item.optional).map((item) => item.key);

  assert.deepEqual(required, ['ph', 'hco3', 'be']);
  assert.equal(indicators.length, 14);

  const result = ReportModel.validateReportData(
    ReportModel.REPORT_TYPES.BLOOD_GAS,
    buildBloodGasIndicators()
  );

  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
});

test('validateReportData allows optional blood gas value without reference range', () => {
  const result = ReportModel.validateReportData(
    ReportModel.REPORT_TYPES.BLOOD_GAS,
    buildBloodGasIndicators({
      beecf: { value: '-5.80', minRange: '', maxRange: '' },
      lactate: { value: '2.00', minRange: '0.5', maxRange: '1.6' }
    })
  );

  assert.equal(result.isValid, true);
  assert.deepEqual(result.errors, []);
});

test('validateReportData still requires reference range for mandatory blood gas indicators', () => {
  const result = ReportModel.validateReportData(
    ReportModel.REPORT_TYPES.BLOOD_GAS,
    buildBloodGasIndicators({
      be: { value: '-3.90', minRange: '', maxRange: '' }
    })
  );

  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /剩余碱 BE\(B\).*参考范围/);
});

test('validateReportData accepts partial blood cbc reports with optional fields omitted', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_CBC, {
    hgb: { value: '110', minRange: '110', maxRange: '160' },
    plt: { value: '180', minRange: '100', maxRange: '300' }
  });

  assert.equal(result.isValid, true);
});

test('blood biochem exposes 28 optional indicators and display name', () => {
  const indicators = ReportModel.getIndicators(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM);
  assert.equal(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, 'blood_biochem');
  assert.equal(ReportModel.getReportTypeName(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM), '大生化');
  assert.equal(indicators.length, 28);
  assert.ok(indicators.every((item) => item.optional === true));
  assert.deepEqual(
    indicators.map(({ key, name, unit, abbr }) => ({ key, name, unit, abbr })),
    [
      { key: 'tp', name: '总蛋白', unit: 'g/L', abbr: 'TP' },
      { key: 'alb', name: '白蛋白', unit: 'g/L', abbr: 'ALB' },
      { key: 'alt', name: '丙氨酸氨基转移酶', unit: 'U/L', abbr: 'ALT' },
      { key: 'ast', name: '天门冬氨酸氨基转移酶', unit: 'U/L', abbr: 'AST' },
      { key: 'alp', name: '碱性磷酸酶', unit: 'U/L', abbr: 'ALP' },
      { key: 'ggt', name: '谷氨酰转肽酶', unit: 'U/L', abbr: 'GGT' },
      { key: 'dbil', name: '直接胆红素', unit: 'μmol/L', abbr: 'DBil' },
      { key: 'tbil', name: '总胆红素', unit: 'μmol/L', abbr: 'TBil' },
      { key: 'crea', name: '肌酐', unit: 'μmol/L', abbr: 'CREA' },
      { key: 'tba', name: '总胆汁酸', unit: 'μmol/L', abbr: 'TBA' },
      { key: 'ua', name: '尿酸', unit: 'μmol/L', abbr: 'UA' },
      { key: 'tc', name: '总胆固醇', unit: 'mmol/L', abbr: 'TC' },
      { key: 'tg', name: '甘油三酯', unit: 'mmol/L', abbr: 'TG' },
      { key: 'ldl', name: '低密度脂蛋白', unit: 'mmol/L', abbr: 'LDL' },
      { key: 'hdl', name: '高密度脂蛋白', unit: 'mmol/L', abbr: 'HDL' },
      { key: 'glu', name: '空腹血糖', unit: 'mmol/L', abbr: 'Glu' },
      { key: 'bun', name: '尿素氮', unit: 'mmol/L', abbr: 'BUN' },
      { key: 'egfr', name: '肾小球滤过率', unit: 'ml/min', abbr: 'eGFR' },
      { key: 'cysc', name: '胱抑素C', unit: 'mg/L', abbr: 'CysC' },
      { key: 'na', name: '钠', unit: 'mmol/L', abbr: 'Na' },
      { key: 'k', name: '钾', unit: 'mmol/L', abbr: 'K' },
      { key: 'mg', name: '镁', unit: 'mmol/L', abbr: 'Mg' },
      { key: 'ca', name: '钙', unit: 'mmol/L', abbr: 'Ca' },
      { key: 'cl', name: '氯', unit: 'mmol/L', abbr: 'Cl' },
      { key: 'ck', name: '肌酸激酶', unit: 'U/L', abbr: 'CK' },
      { key: 'ck_mb', name: '肌酸激酶同工酶', unit: 'U/L', abbr: 'CK-MB' },
      { key: 'ctni', name: '肌钙蛋白', unit: 'ng/mL', abbr: 'cTnI' },
      { key: 'co2', name: '二氧化碳', unit: 'mmol/L', abbr: 'CO₂' }
    ]
  );
});

test('validateReportData rejects empty blood biochem report', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, {});
  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /至少/);
});

test('validateReportData accepts partial blood biochem with one value and no ranges', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_BIOCHEM, {
    alt: { value: '32', minRange: '', maxRange: '' }
  });
  assert.equal(result.isValid, true);
});

test('blood cbc crp exposes 24 optional indicators and display name', () => {
  const indicators = ReportModel.getIndicators(ReportModel.REPORT_TYPES.BLOOD_CBC_CRP);
  assert.equal(ReportModel.REPORT_TYPES.BLOOD_CBC_CRP, 'blood_cbc_crp');
  assert.equal(ReportModel.getReportTypeName(ReportModel.REPORT_TYPES.BLOOD_CBC_CRP), '血五分类CRP');
  assert.equal(indicators.length, 24);
  assert.ok(indicators.every((item) => item.optional === true));
  assert.deepEqual(
    indicators.map(({ key }) => key),
    [
      'crp', 'wbc', 'neut_pct', 'lym_pct', 'mono_pct', 'eos_pct', 'baso_pct',
      'neut_abs', 'mono_abs', 'lym_abs', 'eos_abs', 'baso_abs',
      'rbc', 'hgb', 'hct', 'mcv', 'mch', 'mchc', 'rdw_cv', 'rdw_sd',
      'plt', 'mpv', 'pct', 'pdw'
    ]
  );
});

test('validateReportData rejects empty blood cbc crp report', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_CBC_CRP, {});
  assert.equal(result.isValid, false);
  assert.match(result.errors.join(' '), /血五分类CRP/);
});

test('validateReportData accepts partial blood cbc crp with one value and no ranges', () => {
  const result = ReportModel.validateReportData(ReportModel.REPORT_TYPES.BLOOD_CBC_CRP, {
    crp: { value: '0.5', minRange: '', maxRange: '' }
  });
  assert.equal(result.isValid, true);
});
