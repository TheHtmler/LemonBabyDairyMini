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
