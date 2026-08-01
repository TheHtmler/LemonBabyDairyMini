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
