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

function getProfileMenuItems(page) {
  return (page.data.menuGroups || []).flatMap((group) => group.items || []);
}

function getMiscPackagePages(appConfig) {
  const miscPackage = (appConfig.subPackages || []).find((item) => item.root === 'pkg-misc');
  return miscPackage ? miscPackage.pages : [];
}

test('app.json keeps analysis-report and excludes removed report workbench preview page', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../miniprogram/app.json'),
      'utf8'
    )
  );

  assert.ok(appConfig.pages.includes('pages/analysis-report/index'));
  assert.ok(!appConfig.pages.includes('pages/report-workbench-preview/index'));
  assert.ok(!appConfig.pages.includes('pages/summary-preview/index'));
});

test('profile menu does not expose removed report workbench preview entry', () => {
  const page = loadProfilePage();
  const previewItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pages/report-workbench-preview/index'
  );
  const oldPreviewItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pages/summary-preview/index'
  );

  assert.equal(previewItem, undefined);
  assert.equal(oldPreviewItem, undefined);
});

test('app.json and profile menu exclude removed custom OCR demo page', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../miniprogram/app.json'),
      'utf8'
    )
  );
  const page = loadProfilePage();
  const miscPages = getMiscPackagePages(appConfig);
  const demoItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pkg-misc/custom-ocr-demo/index'
  );

  assert.ok(!miscPages.includes('custom-ocr-demo/index'));
  assert.equal(demoItem, undefined);
});

test('developer profile menu exposes unified developer config hub', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../miniprogram/app.json'),
      'utf8'
    )
  );
  const page = loadProfilePage();
  const miscPages = getMiscPackagePages(appConfig);
  const hubItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pkg-misc/developer-config/index'
  );
  const ocrItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pkg-misc/ocr-access-settings/index'
  );
  const noticeItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pkg-misc/notice-settings/index'
  );

  assert.ok(miscPages.includes('developer-config/index'));
  assert.equal(hubItem?.showForDeveloper, true);
  assert.equal(ocrItem, undefined);
  assert.equal(noticeItem, undefined);
});
