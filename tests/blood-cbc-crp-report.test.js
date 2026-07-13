const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('repository and workbench register blood_cbc_crp key metrics', () => {
  const repo = read('miniprogram/models/reportRepository.js');
  const workbench = read('miniprogram/utils/reportWorkbench.js');
  const analysis = read('miniprogram/pages/analysis-report/index.js');
  const lexicon = read('miniprogram/utils/reportIndicatorLexicon.js');

  assert.match(repo, /BLOOD_CBC_CRP[\s\S]*crp[\s\S]*wbc[\s\S]*hgb[\s\S]*plt[\s\S]*neut_pct/);
  assert.match(workbench, /KEY_METRICS_BY_REPORT_TYPE[\s\S]*BLOOD_CBC_CRP[\s\S]*'crp'/);
  assert.match(workbench, /REPORT_TYPE_FILTERS[\s\S]*BLOOD_CBC_CRP[\s\S]*血五分类CRP/);
  assert.match(analysis, /COMPARE_TYPE_TABS[\s\S]*blood_cbc_crp[\s\S]*血五分类CRP/);
  assert.match(lexicon, /crp:\s*\[[\s\S]*c反应蛋白/);
});

test('add-report lists blood cbc crp and keeps OCR enabled for that type', () => {
  const js = read('miniprogram/pkg-report/add-report/index.js');
  const reportTypes = read('miniprogram/constants/reportTypes.js');
  assert.match(reportTypes, /key:\s*'blood_cbc_crp'[\s\S]*name:\s*'血五分类CRP'/);
  assert.match(js, /ocrAllowed[\s\S]*selectedReportType\s*!==\s*'blood_biochem'/);
  assert.doesNotMatch(js, /selectedReportType\s*!==\s*'blood_cbc_crp'/);
});
