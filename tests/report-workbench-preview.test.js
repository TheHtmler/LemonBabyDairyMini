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
  const previewItem = page.data.menuList.find(
    (item) => item.path === '/pages/report-workbench-preview/index'
  );
  const oldPreviewItem = page.data.menuList.find(
    (item) => item.path === '/pages/summary-preview/index'
  );

  assert.equal(previewItem, undefined);
  assert.equal(oldPreviewItem, undefined);
});
