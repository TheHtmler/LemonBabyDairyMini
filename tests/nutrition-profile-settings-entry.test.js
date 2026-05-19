const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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

test('app.json registers nutrition profile settings v2 page beside legacy nutrition settings', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));

  assert.ok(appConfig.pages.includes('pages/nutrition-settings/index'));
  assert.ok(appConfig.pages.includes('pages/nutrition-profile-settings/index'));
});

test('profile menu exposes 配奶管理v2 without replacing legacy 配奶管理', () => {
  const page = loadProfilePage();
  const legacyItem = page.data.menuList.find((item) => item.path === '/pages/nutrition-settings/index');
  const v2Item = page.data.menuList.find((item) => item.path === '/pages/nutrition-profile-settings/index');

  assert.ok(legacyItem);
  assert.equal(legacyItem.name, '配奶管理');
  assert.ok(v2Item);
  assert.equal(v2Item.name, '配奶管理v2');
  assert.match(v2Item.description, /配方粉|新版|档案/);
});
