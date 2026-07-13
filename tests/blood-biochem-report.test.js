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
