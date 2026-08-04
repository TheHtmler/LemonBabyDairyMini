const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RECIPE_WALL_ROOT = 'deferred/pkg-recipe-wall';

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

test('deferred recipe-wall package keeps page set for later restore', () => {
  assert.ok(fs.existsSync(`${RECIPE_WALL_ROOT}/list/index.js`));
  assert.ok(fs.existsSync(`${RECIPE_WALL_ROOT}/detail/index.js`));
  assert.ok(fs.existsSync(`${RECIPE_WALL_ROOT}/publish/index.js`));
  assert.ok(fs.existsSync(`${RECIPE_WALL_ROOT}/preview/index.js`));
  assert.ok(fs.existsSync(`${RECIPE_WALL_ROOT}/mine/index.js`));
  assert.ok(fs.existsSync(`${RECIPE_WALL_ROOT}/admin/index.js`));
});

test('list page loads via recipeWallManager list action', () => {
  const js = read(`${RECIPE_WALL_ROOT}/list/index.js`);
  const wxml = read(`${RECIPE_WALL_ROOT}/list/index.wxml`);
  const wxss = read(`${RECIPE_WALL_ROOT}/list/index.wxss`);
  assert.match(js, /recipeWallManager/);
  assert.match(js, /action:\s*['"]list['"]/);
  assert.match(js, /keyword/);
  assert.match(js, /filter:\s*this\.data\.filter/);
  assert.match(js, /我赞过的/);
  assert.match(js, /我发布的/);
  assert.match(js, /filterOptions/);
  assert.match(js, /mapPostForCard/);
  assert.match(js, /action:\s*['"]deleteOwn['"]/);
  assert.match(js, /publish\/index\?id=/);
  assert.match(js, /goEdit/);
  assert.match(js, /status === 'draft'/);
  assert.match(wxml, /authorLabel/);
  assert.match(wxml, /likeCount/);
  assert.match(wxml, /filter === 'mine'/);
  assert.match(wxml, /onDeleteOwn/);
  assert.match(wxml, /item\.status !== 'draft'/);
  assert.match(wxml, /class="fab"/);
  assert.match(wxml, /搜菜名、描述或食材/);
  assert.match(wxml, /filterOptions/);
  assert.match(wxml, /onSelectFilter/);
  assert.doesNotMatch(wxml, /我的发布/);
  assert.doesNotMatch(wxml, /标签来自大家发布/);
  assert.doesNotMatch(js, /listTags/);
  assert.match(wxss, /\.waterfall-col/);
  assert.match(js, /leftPosts/);
  assert.match(js, /rightPosts/);
  assert.doesNotMatch(wxml, /tool-btn/);
});

test('detail page uses detail and toggleLike actions', () => {
  const js = read(`${RECIPE_WALL_ROOT}/detail/index.js`);
  const wxml = read(`${RECIPE_WALL_ROOT}/detail/index.wxml`);
  assert.match(js, /action:\s*['"]detail['"]/);
  assert.match(js, /action:\s*['"]toggleLike['"]/);
  assert.match(js, /goEdit/);
  assert.match(wxml, /authorLabel/);
  assert.match(wxml, /内容不可用/);
  assert.match(wxml, /营养预估/);
  assert.match(wxml, /编辑/);
  assert.match(wxml, /bottom-bar/);
  assert.match(wxml, /like-bar/);
  assert.match(js, /redirectTo/);
});

test('publish page uses food library and publishes directly', () => {
  const js = read(`${RECIPE_WALL_ROOT}/publish/index.js`);
  const wxml = read(`${RECIPE_WALL_ROOT}/publish/index.wxml`);
  assert.match(js, /from=recipe-wall/);
  assert.match(js, /validatePublishPayload/);
  assert.match(js, /normalizeDraftPayload/);
  assert.match(js, /action:\s*['"]saveDraft['"]/);
  assert.match(js, /action:\s*['"]getOwn['"]/);
  assert.match(js, /action:\s*['"]publish['"]/);
  assert.match(js, /list\/index/);
  assert.doesNotMatch(js, /\/pkg-recipe-wall\/preview\/index/);
  assert.match(js, /compressRecipeWallImage/);
  assert.match(js, /buildIngredientNutrition/);
  assert.match(js, /loadRelationDisplayName/);
  assert.match(js, /baby_creators/);
  assert.match(js, /RECIPE_WALL_TAG_SUGGESTIONS/);
  assert.match(js, /selectedTags/);
  assert.match(js, /onAddCustomTag/);
  assert.match(js, /scrollStepIntoView/);
  assert.match(js, /onStepFocus/);
  assert.match(wxml, /bindfocus="onStepFocus"/);
  assert.match(wxml, /step-block-\{\{index\}\}/);
  assert.match(wxml, /成品图片/);
  assert.match(wxml, /菜谱描述/);
  assert.match(wxml, /自定义，如软食/);
  assert.match(wxml, /快捷建议/);
  assert.match(wxml, /高级设置/);
  assert.match(wxml, /上传步骤图（可选）/);
  assert.match(wxml, /存草稿/);
  assert.match(wxml, /submitBtnText/);
  assert.match(js, /submitBtnText:\s*['"]发布['"]/);
  assert.match(js, /保存发布/);
  assert.match(wxml, /wx:if="\{\{tipText\}\}"/);
});

test('preview page remains as legacy confirm publisher', () => {
  const js = read(`${RECIPE_WALL_ROOT}/preview/index.js`);
  const wxml = read(`${RECIPE_WALL_ROOT}/preview/index.wxml`);
  assert.match(js, /action:\s*['"]publish['"]/);
  assert.match(js, /postId/);
  assert.match(wxml, /营养预估/);
  assert.match(wxml, /确认发布/);
});

test('mine page redirects to list mine tab; admin supports takeDown', () => {
  const mineJs = read(`${RECIPE_WALL_ROOT}/mine/index.js`);
  const adminJs = read(`${RECIPE_WALL_ROOT}/admin/index.js`);

  assert.match(mineJs, /filter=mine/);
  assert.match(mineJs, /redirectTo/);
  assert.match(adminJs, /action:\s*['"]adminList['"]/);
  assert.match(adminJs, /action:\s*['"]takeDown['"]/);
});

test('food picker treats recipe-wall as ingredient picker', () => {
  const js = read('miniprogram/pkg-records/food-picker/index.js');
  assert.match(js, /from === 'recipe-wall'/);
});
