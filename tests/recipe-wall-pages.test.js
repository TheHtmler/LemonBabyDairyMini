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

test('profile menu links to recipe wall under feeding group', () => {
  const js = read('miniprogram/pages/profile/index.js');
  const features = read('miniprogram/config/features.js');
  const feedingStart = js.indexOf("id: 'feeding'");
  const supportStart = js.indexOf("id: 'support'");
  assert.ok(feedingStart >= 0 && supportStart > feedingStart);
  const feedingBlock = js.slice(feedingStart, supportStart);
  assert.match(feedingBlock, /name:\s*['"]食谱墙['"]/);
  assert.match(feedingBlock, /\/pkg-recipe-wall\/list\/index/);
  assert.match(feedingBlock, /recipeWallEntry:\s*true/);
  assert.match(js, /RECIPE_WALL_MENU_VISIBLE/);
  assert.match(features, /RECIPE_WALL_MENU_VISIBLE\s*=\s*false/);
  const supportBlock = js.slice(supportStart, js.indexOf("id: 'about'"));
  assert.doesNotMatch(supportBlock, /name:\s*['"]食谱墙['"]/);
});

test('recipe wall menu entries are hidden while feature flag is off', () => {
  const page = (() => {
    const pagePath = require.resolve('../miniprogram/pages/profile/index.js');
    delete require.cache[pagePath];
    delete require.cache[require.resolve('../miniprogram/config/features.js')];
    let pageConfig = null;
    const previousPage = global.Page;
    global.Page = (config) => {
      pageConfig = config;
    };
    require(pagePath);
    global.Page = previousPage;
    return pageConfig;
  })();

  const { RECIPE_WALL_MENU_VISIBLE } = require('../miniprogram/config/features');
  assert.equal(RECIPE_WALL_MENU_VISIBLE, false);

  const source = read('miniprogram/pages/profile/index.js');
  // canShowMenuItem 会按 recipeWallEntry 过滤；可见菜单不应包含食谱墙
  assert.match(source, /item\.recipeWallEntry && !RECIPE_WALL_MENU_VISIBLE/);
  assert.ok(page.data.menuGroups.some((group) => (
    (group.items || []).some((item) => item.name === '食谱墙' && item.recipeWallEntry)
  )));
});

test('list page loads via recipeWallManager list action', () => {
  const js = read('miniprogram/pkg-recipe-wall/list/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/list/index.wxml');
  const wxss = read('miniprogram/pkg-recipe-wall/list/index.wxss');
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
  const js = read('miniprogram/pkg-recipe-wall/detail/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/detail/index.wxml');
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
  const js = read('miniprogram/pkg-recipe-wall/publish/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/publish/index.wxml');
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
  const js = read('miniprogram/pkg-recipe-wall/preview/index.js');
  const wxml = read('miniprogram/pkg-recipe-wall/preview/index.wxml');
  assert.match(js, /action:\s*['"]publish['"]/);
  assert.match(js, /postId/);
  assert.match(wxml, /营养预估/);
  assert.match(wxml, /确认发布/);
});

test('mine page redirects to list mine tab; admin supports takeDown', () => {
  const mineJs = read('miniprogram/pkg-recipe-wall/mine/index.js');
  const adminJs = read('miniprogram/pkg-recipe-wall/admin/index.js');
  const profileJs = read('miniprogram/pages/profile/index.js');

  assert.match(mineJs, /filter=mine/);
  assert.match(mineJs, /redirectTo/);
  assert.match(adminJs, /action:\s*['"]adminList['"]/);
  assert.match(adminJs, /action:\s*['"]takeDown['"]/);
  assert.match(profileJs, /食谱墙管理/);
  assert.match(profileJs, /\/pkg-recipe-wall\/admin\/index/);
});

test('food picker treats recipe-wall as ingredient picker', () => {
  const js = read('miniprogram/pkg-records/food-picker/index.js');
  assert.match(js, /from === 'recipe-wall'/);
});
