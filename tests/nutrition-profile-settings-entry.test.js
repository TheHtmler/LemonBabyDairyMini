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

test('profile menu switches 配奶管理 to nutrition profile settings without exposing v2 wording', () => {
  const page = loadProfilePage();
  const legacyItem = getProfileMenuItems(page).find((item) => item.path === '/pkg-milk/nutrition-settings/index');
  const nutritionItem = getProfileMenuItems(page).find((item) => item.path === '/pkg-milk/nutrition-profile-settings/index');

  assert.equal(legacyItem, undefined);
  assert.ok(nutritionItem);
  assert.equal(nutritionItem.name, '配奶管理');
  assert.doesNotMatch(nutritionItem.name, /v2/i);
  assert.match(nutritionItem.description, /配方粉|奶粉|档案/);
});
