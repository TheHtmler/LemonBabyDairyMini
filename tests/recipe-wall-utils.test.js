const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIFFICULTY_OPTIONS,
  formatRecipeWallAuthorLabel,
  formatDifficultyLabel,
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
    cookingMinutes: 20,
    difficulty: 'easy',
    totalNutrition: { calories: 80, protein: 1.2, carbs: 18, fat: 0.3 },
    babyName: '柠檬',
    authorDisplayName: '妈妈',
    babyUid: 'b1'
  });
  assert.equal(good.ok, true);
  assert.equal(good.data.title, '南瓜泥');
  assert.equal(good.data.description, '软糯辅食');
  assert.equal(good.data.ingredients[0].amount, '100g');
  assert.equal(good.data.cookingMinutes, 20);
  assert.equal(good.data.difficulty, 'easy');
  assert.ok(DIFFICULTY_OPTIONS.length >= 3);
  assert.equal(formatDifficultyLabel('easy'), '简单');
});

test('validatePublishPayload rejects handwritten ingredient without foodId', () => {
  const res = validatePublishPayload({
    title: '菜',
    description: '描述',
    coverFileId: 'cloud://c.png',
    ingredients: [{ foodName: '菜', quantity: 1, unit: 'g' }],
    steps: [{ text: '煮' }],
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
