const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('analysis-report page uses archive, detail, and trend views instead of normal-rate overview', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /archive-view/);
  assert.match(wxml, /detail-view/);
  assert.match(wxml, /trend-view/);
  assert.match(wxml, /primary-entry/);
  assert.match(wxml, /trend-entry-inline/);
  assert.match(wxml, /report-type-tabs/);
  assert.match(wxml, /report-archive-list/);
  assert.match(wxml, /archive-card-status-row/);
  assert.doesNotMatch(wxml, /quick-actions/);
  assert.doesNotMatch(wxml, /archive-card-footer/);
  assert.doesNotMatch(wxml, /正常率/);
});

test('analysis-report page wires report flow builders and navigation handlers', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.js'),
    'utf8'
  );

  assert.match(js, /buildReportArchivePreview/);
  assert.match(js, /buildReportDetailPreview/);
  assert.match(js, /buildReportTrendPreview/);
  assert.match(js, /openDetailView/);
  assert.match(js, /openTrendView/);
  assert.match(js, /goBackToArchive/);
  assert.doesNotMatch(js, /calculateStatistics/);
});

test('analysis-report page reads and deletes reports through report repository', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.js'),
    'utf8'
  );

  assert.match(js, /require\('\.\.\/\.\.\/models\/reportRepository'\)/);
  assert.match(js, /require\('\.\.\/\.\.\/models\/nutrition'\)/);
  assert.match(js, /NutritionModel\.getNutritionSettings/);
  assert.match(js, /ReportRepository\.listReportsByBaby/);
  assert.match(js, /collection\('feeding_records'\)/);
  assert.match(js, /orderBy\('date', 'desc'\)/);
  assert.match(js, /ReportRepository\.deleteReport/);
  assert.doesNotMatch(js, /collection\('baby_reports'\)/);
});

test('report-detail page exposes same-type trend entry', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/report-detail/index.wxml'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/report-detail/index.js'),
    'utf8'
  );

  assert.match(wxml, /查看本类趋势/);
  assert.match(wxml, /item\.displayName \|\| item\.name/);
  assert.match(js, /onOpenSameTypeTrend/);
  assert.match(js, /displayName:/);
});

test('report-detail page loads and deletes reports through report repository', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/report-detail/index.js'),
    'utf8'
  );

  assert.match(js, /require\('\.\.\/\.\.\/models\/reportRepository'\)/);
  assert.match(js, /ReportRepository\.getReportById/);
  assert.match(js, /ReportRepository\.deleteReport/);
  assert.doesNotMatch(js, /collection\('baby_reports'\)/);
});
