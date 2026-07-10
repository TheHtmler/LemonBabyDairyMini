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

function getProfileMenuItems(page) {
  return (page.data.menuGroups || []).flatMap((group) => group.items || []);
}

test('app.json registers nutrition profile settings page and drops the legacy page', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));

  assert.ok(appConfigHasPage(appConfig, 'pkg-milk/nutrition-profile-settings/index'));
  assert.ok(!appConfigHasPage(appConfig, 'pkg-milk/nutrition-settings/index'));
});

test('profile menu replaces 配奶管理 with 奶粉管理 pointing at powder-management', () => {
  const page = loadProfilePage();
  const menuItems = getProfileMenuItems(page);
  const legacyItem = menuItems.find((item) => item.path === '/pkg-milk/nutrition-profile-settings/index');
  const powderItem = menuItems.find((item) => item.path === '/pkg-milk/powder-management/index');

  assert.equal(legacyItem, undefined);
  assert.ok(powderItem);
  assert.equal(powderItem.name, '奶粉管理');
  assert.doesNotMatch(powderItem.name, /v2/i);
  assert.match(powderItem.description, /母乳|奶粉/);
});
