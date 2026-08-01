const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECIPE_WALL_TAG_OPTIONS,
  formatRecipeWallAuthorLabel,
  validatePublishPayload,
  mapPostForCard
} = require('../miniprogram/utils/recipeWallUtils');

test('formatRecipeWallAuthorLabel joins baby name and display name', () => {
  assert.equal(
    formatRecipeWallAuthorLabel({ babyName: '柠檬', authorDisplayName: '妈妈' }),
    '来自柠檬妈妈'
  );
});

test('formatRecipeWallAuthorLabel returns empty when missing parts', () => {
  assert.equal(formatRecipeWallAuthorLabel({ babyName: '', authorDisplayName: '妈妈' }), '');
  assert.equal(formatRecipeWallAuthorLabel({ babyName: '柠檬', authorDisplayName: '' }), '');
});

test('validatePublishPayload requires cover title ingredients steps and whitelist tag', () => {
  const bad = validatePublishPayload({
    title: '南瓜泥',
    coverFileId: '',
    ingredients: [{ name: '南瓜', amount: '100g' }],
    steps: [{ text: '蒸熟捣碎' }],
    tags: ['辅食'],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(bad.ok, false);

  const good = validatePublishPayload({
    title: ' 南瓜泥 ',
    coverFileId: 'cloud://cover.png',
    ingredients: [{ name: '南瓜', amount: '100g' }],
    steps: [{ text: '蒸熟捣碎', imageFileId: 'cloud://s1.png' }],
    tags: ['辅食'],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(good.ok, true);
  assert.equal(good.data.title, '南瓜泥');
  assert.deepEqual(good.data.tags, ['辅食']);
  assert.ok(RECIPE_WALL_TAG_OPTIONS.includes('低蛋白'));
});

test('validatePublishPayload rejects unknown tag', () => {
  const res = validatePublishPayload({
    title: '菜',
    coverFileId: 'cloud://c.png',
    ingredients: [{ name: '菜', amount: '1' }],
    steps: [{ text: '煮' }],
    tags: ['火锅'],
    babyName: '柠檬',
    authorDisplayName: '爸爸',
    babyUid: 'b1'
  });
  assert.equal(res.ok, false);
});

test('mapPostForCard builds authorLabel and liked flag', () => {
  const card = mapPostForCard({
    _id: 'p1',
    title: '南瓜泥',
    coverFileId: 'cloud://c.png',
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    likeCount: 3,
    status: 'published'
  }, { likedPostIds: ['p1'] });
  assert.equal(card.authorLabel, '来自柠檬妈妈');
  assert.equal(card.liked, true);
  assert.equal(card.likeCount, 3);
});
