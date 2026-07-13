const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('repository and workbench register blood_biochem key metrics', () => {
  const repo = read('miniprogram/models/reportRepository.js');
  const workbench = read('miniprogram/utils/reportWorkbench.js');
  const analysis = read('miniprogram/pages/analysis-report/index.js');

  assert.match(repo, /BLOOD_BIOCHEM[\s\S]*alt[\s\S]*ast[\s\S]*crea[\s\S]*\bk\b[\s\S]*glu/);
  assert.match(workbench, /KEY_METRICS_BY_REPORT_TYPE[\s\S]*BLOOD_BIOCHEM[\s\S]*'alt'/);
  assert.match(workbench, /REPORT_TYPE_FILTERS[\s\S]*BLOOD_BIOCHEM[\s\S]*大生化/);
  assert.match(analysis, /COMPARE_TYPE_TABS[\s\S]*blood_biochem[\s\S]*大生化/);
});

test('add-report lists blood biochem and hides OCR for that type', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  const wxml = read('miniprogram/pkg-report/add-report/index.wxml');
  const reportTypes = read('miniprogram/constants/reportTypes.js');
  assert.match(reportTypes, /key:\s*'blood_biochem'[\s\S]*name:\s*'大生化'/);
  assert.match(js, /constants\/reportTypes|REPORT_ENTRY_TYPES/);
  assert.match(js, /refreshOcrEntryVisible/);
  assert.match(js, /ocrAllowed[\s\S]*selectedReportType\s*!==\s*'blood_biochem'/);
  assert.match(js, /async switchReportType\(reportType\)[\s\S]*refreshOcrEntryVisible/);
  assert.match(wxml, /ocrEntryVisible/);
});
