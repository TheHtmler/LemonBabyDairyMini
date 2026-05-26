const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function appConfigHasPage(appConfig, pagePath) {
  if ((appConfig.pages || []).includes(pagePath)) return true;
  return (appConfig.subPackages || appConfig.subpackages || []).some((pkg) => (
    (pkg.pages || []).some((page) => `${pkg.root}/${page}` === pagePath)
  ));
}

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

test('app.json registers milk feeding v2 beside legacy milk feeding editor', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));

  assert.ok(appConfigHasPage(appConfig, 'pages/milk-feeding-editor/index'));
  assert.ok(appConfigHasPage(appConfig, 'pages/milk-feeding-editor-v2/index'));
});

test('profile menu exposes 喂奶记录v2 without replacing legacy milk feeding routes', () => {
  const page = loadProfilePage();
  const v2Item = page.data.menuList.find((item) => item.path === '/pages/milk-feeding-editor-v2/index');

  assert.ok(v2Item);
  assert.equal(v2Item.name, '喂奶记录v2');
  assert.match(v2Item.description, /多配方粉|新版|独立/);
});

test('milk feeding v2 page files exist with the expected title', () => {
  const pageJson = fs.readFileSync('miniprogram/pages/milk-feeding-editor-v2/index.json', 'utf8');

  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor-v2/index.js'));
  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor-v2/index.wxml'));
  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor-v2/index.wxss'));
  assert.match(pageJson, /"navigationBarTitleText": "喂奶记录v2"/);
});
