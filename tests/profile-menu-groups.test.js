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

test('profile menu is grouped by functional modules', () => {
  const page = loadProfilePage();
  const groups = page.data.menuGroups || [];

  assert.ok(groups.length >= 5);
  assert.deepEqual(
    groups.map((group) => group.title),
    ['账号与宝宝', '喂养管理', '数据与成长', '帮助与社区', '关于', '开发者', '账号操作']
  );

  const accountGroup = groups.find((group) => group.id === 'account');
  const supportGroup = groups.find((group) => group.id === 'support');

  assert.ok(accountGroup.items.some((item) => item.name === '个人信息'));
  assert.ok(supportGroup.items.some((item) => item.name === '加群讨论'));
  assert.ok(supportGroup.items.some((item) => item.name === '意见反馈'));
  assert.ok(!supportGroup.items.some((item) => item.name === '新手指南'));
  assert.ok(!groups.some((group) => (group.items || []).some((item) => item.path === '/pages/onboarding/index')));
});

test('app.json no longer registers onboarding page after profile cleanup', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  assert.ok(!appConfig.pages.includes('pages/onboarding/index'));
  assert.ok(!fs.existsSync('miniprogram/pages/onboarding/index.js'));
});
