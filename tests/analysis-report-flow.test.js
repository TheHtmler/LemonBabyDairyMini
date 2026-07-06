const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('analysis-report page uses archive/compare tabs and navigates to report detail page', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /main-tabs/);
  assert.match(wxml, /archive-panel/);
  assert.match(wxml, /compare-panel/);
  assert.match(wxml, /archiveYearGroups/);
  assert.match(wxml, /report-status/);
  assert.match(wxml, /compare-summary-card/);
  assert.match(wxml, /diet-entry-card/);
  assert.match(wxml, /diet-summary-card/);
  assert.match(wxml, /dietSummaryLines/);
  assert.match(wxml, /item\.changeText/);
  assert.match(wxml, /nutritionCompareSeries/);
  assert.match(wxml, /diet-empty-hint/);
  assert.match(wxml, /fab/);
  assert.doesNotMatch(wxml, /detail-view/);
  assert.doesNotMatch(wxml, /page-title/);
  assert.doesNotMatch(wxml, /去对比/);
});

test('analysis-report compare layout reserves bottom space and sticks dates to top', () => {
  const wxss = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.wxss'),
    'utf8'
  );

  assert.match(wxss, /\.compare-panel\s*\{[\s\S]*padding-bottom:\s*220rpx/);
  assert.match(wxss, /\.compare-date-sticky\s*\{[\s\S]*top:\s*12rpx/);
});

test('analysis-report page wires compare builders, lazy feeding load, and detail navigation', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.js'),
    'utf8'
  );

  assert.match(js, /buildReportArchivePreview/);
  assert.match(js, /buildReportComparePreview/);
  assert.match(js, /resolveCompareReportSelection/);
  assert.match(js, /resolveCompareNutritionWindows/);
  assert.match(js, /ensureCompareFeedingData/);
  assert.match(js, /showCompareDiet/);
  assert.match(js, /includeNutrition:\s*this\.data\.compareDietVisible/);
  assert.match(js, /REPORTS_CACHE_TTL_MS/);
  assert.match(js, /ANALYSIS_REPORT_RELOAD_KEY/);
  assert.match(js, /pkg-report\/report-detail\/index/);
  assert.match(js, /openDetailView/);
  assert.match(js, /refreshCompareView/);
  assert.doesNotMatch(js, /buildReportDetailPreview/);
  assert.doesNotMatch(js, /openCompareFromDetail/);
  assert.doesNotMatch(js, /resolveFeedingDataRange/);
});

test('analysis-report page reads reports through report repository', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/analysis-report/index.js'),
    'utf8'
  );

  assert.match(js, /require\('\.\.\/\.\.\/models\/reportRepository'\)/);
  assert.match(js, /ReportRepository\.listReportsByBaby/);
  assert.match(js, /DailyRecordV2Service\.getDailySummariesForRange/);
  assert.match(js, /dailySummariesCache/);
  assert.match(js, /rebuildMissing:\s*true/);
  assert.doesNotMatch(js, /feedingRecordsCache/);
  assert.doesNotMatch(js, /dailySummaryToFeedingWindowRecord/);
  assert.doesNotMatch(js, /collection\('baby_reports'\)/);
});

test('report-detail page keeps edit action in header and removes compare trend entry', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-report/report-detail/index.wxml'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-report/report-detail/index.js'),
    'utf8'
  );

  assert.match(wxml, /onEditReport/);
  assert.match(wxml, /header-actions/);
  assert.doesNotMatch(wxml, /trend-entry/);
  assert.doesNotMatch(wxml, /去对比/);
  assert.doesNotMatch(wxml, /bottom-actions/);
  assert.match(js, /ANALYSIS_REPORT_RELOAD_KEY/);
  assert.doesNotMatch(js, /onOpenSameTypeTrend/);
});

test('add-report page uses custom OCR cloud function instead of WeChat OCR', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-report/add-report/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-report/add-report/index.wxml'),
    'utf8'
  );

  assert.match(js, /recognizeReportCustom/);
  assert.match(js, /parseStructuredReportItems/);
  assert.match(js, /mapOcrResultToIndicators/);
  assert.doesNotMatch(js, /recognizeReportImage/);
  assert.doesNotMatch(js, /WECHAT_OCR/);
  assert.doesNotMatch(js, /fetchOcrQuotaHint/);
  assert.doesNotMatch(wxml, /微信 OCR/);
});
