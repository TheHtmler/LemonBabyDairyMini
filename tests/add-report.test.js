const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadAddReportPage() {
  const pagePath = require.resolve('../miniprogram/pages/add-report/index.js');
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

test('add-report honors incoming report type when opening add mode from a category', () => {
  const page = loadAddReportPage();
  const instance = {
    ...page,
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      Object.assign(this.data, update);
    },
    initPage() {}
  };

  page.onLoad.call(instance, {
    mode: 'add',
    type: 'urine_ms'
  });

  assert.equal(instance.data.mode, 'add');
  assert.equal(instance.data.selectedReportType, 'urine_ms');
});

test('add-report page saves and loads through report repository instead of direct baby_reports access', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/add-report/index.js'),
    'utf8'
  );

  assert.match(js, /require\('\.\.\/\.\.\/models\/reportRepository'\)/);
  assert.match(js, /ReportRepository\.getReportById/);
  assert.match(js, /ReportRepository\.getHistoricalRanges/);
  assert.match(js, /ReportRepository\.saveReport/);
  assert.doesNotMatch(js, /collection\('baby_reports'\)/);
});

test('add-report page uses compact grouped layout for indicator entry', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/add-report/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/add-report/index.wxss'),
    'utf8'
  );
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/add-report/index.js'),
    'utf8'
  );

  assert.match(wxml, /report-meta-bar/);
  assert.match(wxml, /compact-input-grid/);
  assert.match(wxml, /compact-cell value-cell/);
  assert.match(wxml, /indicator-list/);
  assert.match(wxml, /indicator-row/);
  assert.doesNotMatch(wxml, /录入概览/);
  assert.doesNotMatch(wxml, /指标录入/);
  assert.doesNotMatch(wxml, /检测值必填/);
  assert.doesNotMatch(wxml, /status-badge/);
  assert.doesNotMatch(wxml, /section-copy/);
  assert.doesNotMatch(wxml, /base-info-card/);
  assert.doesNotMatch(wxml, /indicator-item/);
  assert.doesNotMatch(wxml, /indicator-group/);
  assert.doesNotMatch(wxml, /group-header/);

  assert.match(wxss, /\.report-meta-bar/);
  assert.match(wxss, /\.content\s*\{[^}]*padding:\s*20rpx 20rpx 240rpx;/s);
  assert.match(wxss, /\.indicator-list/);
  assert.match(wxss, /\.compact-input-grid/);
  assert.match(wxss, /grid-template-columns:\s*2\.1fr 1fr 1fr/);
  assert.match(wxss, /\.compact-cell\.value-cell/);
  assert.match(wxss, /\.bottom-section\s*\{[^}]*z-index:\s*20;/s);
  assert.doesNotMatch(wxss, /backdrop-filter/);
  assert.doesNotMatch(wxss, /\.indicator-group/);
  assert.doesNotMatch(wxss, /\.status-badge/);
  assert.doesNotMatch(wxss, /\.section-copy/);
  assert.doesNotMatch(wxss, /repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

  assert.doesNotMatch(js, /buildIndicatorGroups/);
  assert.doesNotMatch(js, /toggleIndicatorGroup/);
  assert.doesNotMatch(js, /indicatorGroups/);
  assert.doesNotMatch(js, /collapsedGroups/);
});

test('add-report auto-calculates c3 ratios on blur even before base indicator ranges are filled', () => {
  const page = loadAddReportPage();
  global.wx = {
    showToast() {}
  };

  const instance = {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data)),
      selectedReportType: 'blood_ms',
      indicatorData: {
        c3: { value: '8.000', minRange: '', maxRange: '' },
        c0: { value: '20.000', minRange: '', maxRange: '' },
        c2: { value: '', minRange: '', maxRange: '' },
        c3_c0: { value: '', minRange: '', maxRange: '' },
        c3_c2: { value: '', minRange: '', maxRange: '' }
      }
    },
    setData(update) {
      Object.assign(this.data, update);
    }
  };

  page.onIndicatorValueBlur.call(instance, {
    currentTarget: {
      dataset: {
        indicator: 'c2',
        field: 'value'
      }
    },
    detail: {
      value: '22'
    }
  });

  assert.equal(instance.data.indicatorData.c3_c0.value, '0.4');
  assert.equal(instance.data.indicatorData.c3_c2.value, '0.364');
});
