const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

test('app.json registers recipe-wall list subpackage page', () => {
  const app = read('miniprogram/app.json');
  assert.match(app, /pkg-recipe-wall/);
  assert.match(app, /list\/index/);
});

test('profile menu links to recipe wall under support group', () => {
  const js = read('miniprogram/pages/profile/index.js');
  assert.match(js, /食谱墙/);
  assert.match(js, /\/pkg-recipe-wall\/list\/index/);
});

test('list page loads via recipeWallManager list action', () => {
  const js = read('miniprogram/pkg-recipe-wall/list/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/list/index.wxml');
  assert.match(js, /recipeWallManager/);
  assert.match(js, /action:\s*['"]list['"]/);
  assert.match(js, /mapPostForCard/);
  assert.match(wxml, /authorLabel/);
  assert.match(wxml, /likeCount/);
});

test('app.json registers all recipe-wall pages', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  const pkg = app.subPackages.find((item) => item.root === 'pkg-recipe-wall');
  assert.ok(pkg);
  assert.deepEqual(pkg.pages, [
    'list/index',
    'detail/index',
    'publish/index',
    'mine/index',
    'admin/index'
  ]);
});

test('detail page uses detail and toggleLike actions', () => {
  const js = read('miniprogram/pkg-recipe-wall/detail/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/detail/index.wxml');
  assert.match(js, /action:\s*['"]detail['"]/);
  assert.match(js, /action:\s*['"]toggleLike['"]/);
  assert.match(wxml, /authorLabel/);
  assert.match(wxml, /内容不可用/);
});

test('publish page validates tags and calls publish', () => {
  const js = read('miniprogram/pkg-recipe-wall/publish/index.js');
  assert.match(js, /RECIPE_WALL_TAG_OPTIONS/);
  assert.match(js, /validatePublishPayload/);
  assert.match(js, /action:\s*['"]publish['"]/);
  assert.match(js, /wx\.cloud\.uploadFile/);
});

test('mine and admin pages support deleteOwn and takeDown', () => {
  const mineJs = read('miniprogram/pkg-recipe-wall/mine/index.js');
  const mineWxml = read('miniprogram/pkg-recipe-wall/mine/index.wxml');
  const adminJs = read('miniprogram/pkg-recipe-wall/admin/index.js');
  const profileJs = read('miniprogram/pages/profile/index.js');

  assert.match(mineJs, /action:\s*['"]listMine['"]/);
  assert.match(mineJs, /action:\s*['"]deleteOwn['"]/);
  assert.match(mineJs, /已下架/);
  assert.match(mineWxml, /statusText/);
  assert.match(adminJs, /action:\s*['"]adminList['"]/);
  assert.match(adminJs, /action:\s*['"]takeDown['"]/);
  assert.match(profileJs, /食谱墙管理/);
  assert.match(profileJs, /\/pkg-recipe-wall\/admin\/index/);
});
