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

test('appConfigManager stores group qrcode config in app_config', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/appConfigManager/index.js'),
    'utf8'
  );

  assert.match(js, /APP_CONFIG_COLLECTION\s*=\s*'app_config'/);
  assert.match(js, /GROUP_QRCODE_KEY\s*=\s*'group_qrcode'/);
  assert.match(js, /updateGroupQrcodeConfig/);
  assert.match(js, /clearGroupQrcodeConfig/);
  assert.match(js, /action === 'getGroupQrcode'/);
});

test('group qrcode settings page is wired to appConfigManager', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/group-qrcode-settings/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/group-qrcode-settings/index.wxml'),
    'utf8'
  );

  assert.match(js, /appConfigManager/);
  assert.match(js, /require\('\.\.\/\.\.\/config\/developer'\)/);
  assert.match(js, /updateGroupQrcode/);
  assert.match(js, /chooseImage/);
  assert.match(wxml, /本地上传/);
});

test('group discussion page loads qrcode via shared util', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/group-discussion/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/group-discussion/index.wxml'),
    'utf8'
  );

  assert.match(js, /loadGroupQrcode/);
  assert.match(js, /groupQrCode/);
  assert.match(wxml, /加群讨论/);
  assert.match(wxml, /groupQrUrl/);
});

test('feedback page no longer renders group qrcode section', () => {
  const js = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/feedback/index.js'),
    'utf8'
  );
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/feedback/index.wxml'),
    'utf8'
  );

  assert.doesNotMatch(js, /groupQrUrl/);
  assert.doesNotMatch(js, /loadGroupQrCode/);
  assert.doesNotMatch(wxml, /加入用户群/);
  assert.doesNotMatch(wxml, /qr-card/);
});

test('profile menu exposes group discussion entry and developer config hub links qrcode settings', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../miniprogram/app.json'),
      'utf8'
    )
  );
  const page = loadProfilePage();
  const miscPages = (appConfig.subPackages || []).find((item) => item.root === 'pkg-misc')?.pages || [];
  const discussionItem = getProfileMenuItems(page).find(
    (item) => item.path === '/pkg-misc/group-discussion/index'
  );
  const devConfigJs = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pkg-misc/developer-config/index.js'),
    'utf8'
  );

  assert.ok(miscPages.includes('group-discussion/index'));
  assert.ok(miscPages.includes('group-qrcode-settings/index'));
  assert.equal(discussionItem?.name, '加群讨论');
  assert.match(devConfigJs, /group-qrcode-settings\/index/);
});
