const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

test('app.json registers recipe-wall pages including preview', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  const pkg = app.subPackages.find((item) => item.root === 'pkg-recipe-wall');
  assert.ok(pkg);
  assert.deepEqual(pkg.pages, [
    'list/index',
    'detail/index',
    'publish/index',
    'preview/index',
    'mine/index',
    'admin/index'
  ]);
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

test('detail page uses detail and toggleLike actions', () => {
  const js = read('miniprogram/pkg-recipe-wall/detail/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/detail/index.wxml');
  assert.match(js, /action:\s*['"]detail['"]/);
  assert.match(js, /action:\s*['"]toggleLike['"]/);
  assert.match(wxml, /authorLabel/);
  assert.match(wxml, /内容不可用/);
  assert.match(wxml, /营养预估/);
});

test('publish page uses food library and opens preview', () => {
  const js = read('miniprogram/pkg-recipe-wall/publish/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/publish/index.wxml');
  assert.match(js, /from=recipe-wall/);
  assert.match(js, /validatePublishPayload/);
  assert.match(js, /\/pkg-recipe-wall\/preview\/index/);
  assert.match(js, /buildIngredientNutrition/);
  assert.doesNotMatch(js, /RECIPE_WALL_TAG_OPTIONS/);
  assert.match(wxml, /成品图片/);
  assert.match(wxml, /菜谱描述/);
  assert.match(wxml, /高级设置/);
  assert.match(wxml, /上传步骤图（可选）/);
});

test('preview page publishes via cloud function', () => {
  const js = read('miniprogram/pkg-recipe-wall/preview/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/preview/index.wxml');
  assert.match(js, /action:\s*['"]publish['"]/);
  assert.match(wxml, /营养预估/);
  assert.match(wxml, /确认发布/);
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

test('food picker treats recipe-wall as ingredient picker', () => {
  const js = read('miniprogram/pkg-records/food-picker/index.js');
  assert.match(js, /from === 'recipe-wall'/);
});
