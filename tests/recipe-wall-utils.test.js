const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECIPE_WALL_TAG_OPTIONS,
  formatRecipeWallAuthorLabel,
  formatDifficultyLabel,
  buildSearchText,
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

test('validatePublishPayload requires cover title description food-based ingredients and steps', () => {
  const bad = validatePublishPayload({
    title: '南瓜泥',
    description: '软糯辅食',
    coverFileId: '',
    ingredients: [{ foodId: 'f1', foodName: '南瓜', quantity: 100, unit: 'g' }],
    steps: [{ text: '蒸熟捣碎' }],
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(bad.ok, false);

  const good = validatePublishPayload({
    title: ' 南瓜泥 ',
    description: ' 软糯辅食 ',
    coverFileId: 'cloud://cover.png',
    ingredients: [{ foodId: 'f1', foodName: '南瓜', quantity: 100, unit: 'g' }],
    steps: [{ text: '蒸熟捣碎', imageFileId: 'cloud://s1.png' }],
    tags: ['辅食', '低蛋白'],
    cookingMinutes: 20,
    difficulty: 'easy',
    totalNutrition: { calories: 80, protein: 1.2, carbs: 18, fat: 0.3 },
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(good.ok, true);
  assert.equal(good.data.title, '南瓜泥');
  assert.deepEqual(good.data.tags, ['辅食', '低蛋白']);
  assert.match(good.data.searchText, /南瓜泥/);
  assert.match(good.data.searchText, /南瓜/);
  assert.equal(formatDifficultyLabel('easy'), '简单');
  assert.ok(RECIPE_WALL_TAG_OPTIONS.includes('加餐点心'));
});

test('validatePublishPayload allows empty tags but rejects invalid ones', () => {
  const emptyTags = validatePublishPayload({
    title: '菜',
    description: '描述',
    coverFileId: 'cloud://c.png',
    ingredients: [{ foodId: 'f1', foodName: '菜', quantity: 1, unit: 'g' }],
    steps: [{ text: '煮' }],
    tags: [],
    babyName: '柠檬',
    authorDisplayName: '爸爸',
    babyUid: 'b1'
  });
  assert.equal(emptyTags.ok, true);

  const badTag = validatePublishPayload({
    title: '菜',
    description: '描述',
    coverFileId: 'cloud://c.png',
    ingredients: [{ foodId: 'f1', foodName: '菜', quantity: 1, unit: 'g' }],
    steps: [{ text: '煮' }],
    tags: ['火锅'],
    babyName: '柠檬',
    authorDisplayName: '爸爸',
    babyUid: 'b1'
  });
  assert.equal(badTag.ok, false);
});

test('buildSearchText joins title description ingredients and tags', () => {
  const text = buildSearchText({
    title: '南瓜泥',
    description: '软糯',
    ingredients: [{ foodName: '南瓜' }],
    tags: ['辅食']
  });
  assert.equal(text, '南瓜泥 软糯 南瓜 辅食');
});

test('mapPostForCard builds authorLabel liked flag and tagText', () => {
  const card = mapPostForCard({
    _id: 'p1',
    title: '南瓜泥',
    coverFileId: 'cloud://c.png',
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    likeCount: 3,
    status: 'published',
    tags: ['辅食', '低蛋白']
  }, { likedPostIds: ['p1'] });
  assert.equal(card.authorLabel, '来自柠檬妈妈');
  assert.equal(card.liked, true);
  assert.equal(card.likeCount, 3);
  assert.equal(card.tagText, '辅食');
});
