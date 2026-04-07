const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadProfilePage() {
  const pagePath = require.resolve('../miniprogram/pages/profile/index.js');
  delete require.cache[pagePath];

  let pageConfig = null;
  const previousPage = global.Page;

  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);
  global.Page = previousPage;

  return pageConfig;
}

test('app.json registers report workbench preview page without replacing analysis-report', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../miniprogram/app.json'),
      'utf8'
    )
  );

  assert.ok(appConfig.pages.includes('pages/analysis-report/index'));
  assert.ok(appConfig.pages.includes('pages/report-workbench-preview/index'));
  assert.ok(!appConfig.pages.includes('pages/summary-preview/index'));
});

test('profile menu exposes report workbench preview entry', () => {
  const page = loadProfilePage();
  const previewItem = page.data.menuList.find(
    (item) => item.path === '/pages/report-workbench-preview/index'
  );
  const oldPreviewItem = page.data.menuList.find(
    (item) => item.path === '/pages/summary-preview/index'
  );

  assert.ok(previewItem);
  assert.equal(previewItem.name, '报告工作台预览');
  assert.match(previewItem.description, /预览|工作台/);
  assert.equal(oldPreviewItem, undefined);
});

test('report workbench preview page renders compare, trend, nutrition and doctor summary sections', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/report-workbench-preview/index.wxml'),
    'utf8'
  );

  assert.doesNotMatch(wxml, /workflow-card/);
  assert.match(wxml, /quick-actions/);
  assert.match(wxml, /report-type-tabs/);
  assert.match(wxml, /report-archive-list/);
  assert.match(wxml, /archive-view/);
  assert.match(wxml, /detail-view/);
  assert.match(wxml, /trend-view/);
  assert.doesNotMatch(wxml, /当前模式/);
  assert.match(wxml, /detail-summary-card/);
  assert.match(wxml, /detail-indicators-card/);
  assert.match(wxml, /trend-summary-card/);
  assert.match(wxml, /trend-section/);
  assert.match(wxml, /nutrition-window-card/);
  assert.match(wxml, /doctor-summary-card/);
  assert.match(wxml, /bindtap="goToAddReport"/);
  assert.match(wxml, /bindtap="handleTypeFilterChange"/);
  assert.match(wxml, /bindtap="openDetailPreview"/);
  assert.match(wxml, /bindtap="openTrendPreview"/);
  assert.match(wxml, /bindtap="goBackToArchive"/);
  assert.match(wxml, /bindtap="openReportDetailFromTrend"/);
});

test('report workbench preview page wires real data aggregation utility', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/report-workbench-preview/index.js'),
    'utf8'
  );

  assert.match(js, /buildReportWorkbenchView/);
  assert.match(js, /buildReportArchivePreview/);
  assert.match(js, /buildReportDetailPreview/);
  assert.match(js, /buildReportTrendPreview/);
  assert.match(js, /loadRealReports/);
  assert.match(js, /goToAddReport/);
  assert.match(js, /handleTypeFilterChange/);
  assert.match(js, /openDetailPreview/);
  assert.match(js, /openTrendPreview/);
  assert.match(js, /goBackToArchive/);
  assert.match(js, /openReportDetailFromTrend/);
  assert.doesNotMatch(js, /const REPORTS = \[/);
});

test('report workbench preview page loads reports through report repository', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/report-workbench-preview/index.js'),
    'utf8'
  );

  assert.match(js, /require\('\.\.\/\.\.\/models\/reportRepository'\)/);
  assert.match(js, /ReportRepository\.listReportsByBaby/);
  assert.doesNotMatch(js, /collection\('baby_reports'\)/);
});
