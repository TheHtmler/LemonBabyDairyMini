const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('reportTypes constant lists all six report entry types', () => {
  const { REPORT_ENTRY_TYPES } = require('../miniprogram/constants/reportTypes');
  assert.deepEqual(
    REPORT_ENTRY_TYPES.map(({ key, name, icon }) => ({ key, name, icon })),
    [
      { key: 'blood_ms', name: '血串联质谱', icon: '🩸' },
      { key: 'urine_ms', name: '尿串联质谱', icon: '🧪' },
      { key: 'blood_gas', name: '血气分析', icon: '💨' },
      { key: 'blood_cbc', name: '血常规', icon: '🩺' },
      { key: 'blood_biochem', name: '大生化', icon: '🧬' },
      { key: 'blood_ammonia', name: '血氨检测', icon: '⚡' }
    ]
  );
});

test('add-report uses shared REPORT_ENTRY_TYPES', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  assert.match(js, /constants\/reportTypes/);
  assert.match(js, /REPORT_ENTRY_TYPES/);
  assert.doesNotMatch(js, /reportTypes:\s*\[\s*\{\s*key:\s*'blood_ms'/);
});

test('analysis-report add flow opens type picker or navigates by context', () => {
  const js = read('miniprogram/pages/analysis-report/index.js');
  const wxml = read('miniprogram/pages/analysis-report/index.wxml');
  const wxss = read('miniprogram/pages/analysis-report/index.wxss');

  assert.match(js, /constants\/reportTypes|REPORT_ENTRY_TYPES/);
  assert.match(js, /typePickerVisible/);
  assert.match(js, /navigateToAddReport/);
  assert.match(js, /mainTab\s*===\s*MAIN_TABS\.COMPARE|mainTab\s*===\s*['"]compare['"]/);
  assert.match(js, /compareReportType/);
  assert.match(js, /selectedFilterType[\s\S]*!==\s*['"]all['"]/);
  assert.match(js, /onCloseTypePicker|typePickerVisible:\s*false/);
  assert.match(js, /onSelectReportType/);
  assert.match(wxml, /typePickerVisible/);
  assert.match(wxml, /onSelectReportType|data-type/);
  assert.match(wxss, /z-index:\s*(?:1000|9999)/);
});

test('countFilledIndicators only counts current indicator keys with non-empty value', () => {
  const { countFilledIndicators } = require('../miniprogram/utils/reportFilledCount');
  const current = [{ key: 'alt' }, { key: 'ast' }];
  const data = { alt: { value: '32' }, ast: { value: '  ' }, crea: { value: '99' } };
  assert.equal(countFilledIndicators(current, data), 1);
});

test('add-report shows unit and filled progress wiring', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  const wxml = read('miniprogram/pkg-report/add-report/index.wxml');
  assert.match(js, /filledCount/);
  assert.match(js, /totalCount/);
  assert.match(js, /refreshFilledCount/);
  assert.match(js, /async initIndicators[\s\S]*refreshFilledCount/);
  assert.match(js, /async switchReportType[\s\S]*refreshFilledCount/);
  assert.match(js, /loadReportData[\s\S]*refreshFilledCount/);
  assert.match(js, /onIndicatorValueInput[\s\S]*refreshFilledCount|refreshFilledCount[\s\S]*onIndicatorValueInput/);
  assert.match(wxml, /filledCount/);
  assert.match(wxml, /totalCount/);
  assert.match(wxml, /indicator\.unit/);
});
