const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

test('audit package does not register recipe-wall subpackage', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(!(app.subPackages || []).some((item) => item.root === 'pkg-recipe-wall'));
});

test('audit package does not keep recipe-wall under miniprogram root', () => {
  assert.equal(fs.existsSync('miniprogram/pkg-recipe-wall'), false);
  assert.equal(fs.existsSync('miniprogram/utils/recipeWallUtils.js'), false);
  assert.ok(fs.existsSync('deferred/pkg-recipe-wall'));
  assert.ok(fs.existsSync('deferred/utils/recipeWallUtils.js'));
});

test('profile menu has no recipe wall entries or feature gate', () => {
  const js = read('miniprogram/pages/profile/index.js');
  assert.doesNotMatch(js, /食谱墙/);
  assert.doesNotMatch(js, /pkg-recipe-wall/);
  assert.doesNotMatch(js, /recipeWallEntry/);
  assert.doesNotMatch(js, /RECIPE_WALL_MENU_VISIBLE/);
  assert.doesNotMatch(js, /config\/features/);
  assert.equal(fs.existsSync('miniprogram/config/features.js'), false);
});

test('project packOptions ignores deferred recipe-wall paths as belt-and-suspenders', () => {
  const project = JSON.parse(read('project.config.json'));
  const ignore = project.packOptions?.ignore || [];
  assert.ok(ignore.some((item) => String(item.value || item).includes('pkg-recipe-wall')));
});
