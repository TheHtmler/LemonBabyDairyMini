const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: '简单' },
  { value: 'normal', label: '普通' },
  { value: 'hard', label: '较难' }
];

// 仅作快捷建议，不作为白名单限制；面向 0-10 岁常见饮食场景的通用词
const RECIPE_WALL_TAG_SUGGESTIONS = [
  '辅食',
  '低蛋白',
  '正餐',
  '加餐点心',
  '粥糊',
  '汤羹',
  '软食',
  '手指食物',
  '蒸煮',
  '易消化',
  '少盐少油',
  '外出便携'
];
const RECIPE_WALL_TAG_MAX_COUNT = 3;
const RECIPE_WALL_TAG_MAX_LEN = 8;

function trimText(value = '', maxLen = 0) {
  const text = String(value || '').trim();
  if (!maxLen) return text;
  return text.slice(0, maxLen);
}

function formatRecipeWallAuthorLabel({ babyName = '', authorDisplayName = '' } = {}) {
  const baby = trimText(babyName, 20);
  const role = trimText(authorDisplayName, 12);
  if (!baby || !role) return '';
  return `来自${baby}${role}`;
}

function formatDifficultyLabel(value = '') {
  const found = DIFFICULTY_OPTIONS.find((item) => item.value === value);
  return found ? found.label : '';
}

function normalizeTagItem(raw = '') {
  const text = String(raw || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '');
  if (!text) return null;
  if (text.length > RECIPE_WALL_TAG_MAX_LEN) {
    return text.slice(0, RECIPE_WALL_TAG_MAX_LEN);
  }
  return text;
}

function normalizeTags(rawTags = []) {
  const tags = (Array.isArray(rawTags) ? rawTags : [])
    .map(normalizeTagItem)
    .filter(Boolean);
  const unique = [...new Set(tags)];
  if (unique.length > RECIPE_WALL_TAG_MAX_COUNT) {
    return {
      ok: false,
      message: `最多添加 ${RECIPE_WALL_TAG_MAX_COUNT} 个标签`,
      tags: []
    };
  }
  return { ok: true, tags: unique };
}

function buildSearchText({
  title = '',
  description = '',
  ingredients = [],
  tags = []
} = {}) {
  const parts = [
    title,
    description,
    ...(Array.isArray(ingredients) ? ingredients : []).map((item) => item.foodName || item.name || ''),
    ...(Array.isArray(tags) ? tags : [])
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return parts.join(' ').toLowerCase();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIngredient(raw = {}) {
  const foodId = trimText(raw.foodId, 64);
  const foodName = trimText(raw.foodName || raw.name, 40);
  const unit = trimText(raw.unit, 10) || 'g';
  const quantityNum = Math.max(0, Number(raw.quantity));
  if (!foodName || !(quantityNum > 0)) return null;

  const nutrition = raw.nutrition && typeof raw.nutrition === 'object'
    ? {
      calories: Number(raw.nutrition.calories) || 0,
      protein: Number(raw.nutrition.protein) || 0,
      carbs: Number(raw.nutrition.carbs) || 0,
      fat: Number(raw.nutrition.fat) || 0,
      naturalProtein: Number(raw.nutrition.naturalProtein) || 0,
      specialProtein: Number(raw.nutrition.specialProtein) || 0,
      fiber: Number(raw.nutrition.fiber) || 0,
      sodium: Number(raw.nutrition.sodium) || 0
    }
    : null;

  const foodSnapshot = raw.foodSnapshot && typeof raw.foodSnapshot === 'object'
    ? raw.foodSnapshot
    : null;

  return {
    foodId,
    foodName,
    name: foodName,
    quantity: quantityNum,
    unit,
    amount: `${quantityNum}${unit}`,
    nutrition,
    foodSnapshot
  };
}

function normalizeStep(raw = {}) {
  const text = trimText(raw.text, 500);
  const imageFileId = trimText(raw.imageFileId, 300);
  if (!text) return null;
  return { text, imageFileId };
}

function normalizeTotalNutrition(raw = {}) {
  if (!raw || typeof raw !== 'object') {
    return {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    };
  }
  return {
    calories: Number(raw.calories) || 0,
    protein: Number(raw.protein) || 0,
    carbs: Number(raw.carbs) || 0,
    fat: Number(raw.fat) || 0
  };
}

function validatePublishPayload(input = {}) {
  const title = trimText(input.title, 40);
  const description = trimText(input.description, 500);
  const coverFileId = trimText(input.coverFileId, 300);
  const babyName = trimText(input.babyName, 20);
  const authorDisplayName = trimText(input.authorDisplayName, 12);
  const babyUid = trimText(input.babyUid, 64);
  const authorAvatar = trimText(input.authorAvatar, 300);
  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map(normalizeIngredient)
    .filter(Boolean);
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map(normalizeStep)
    .filter(Boolean);
  const tagResult = normalizeTags(input.tags);

  const cookingMinutesRaw = input.cookingMinutes;
  let cookingMinutes = null;
  if (cookingMinutesRaw !== '' && cookingMinutesRaw !== null && cookingMinutesRaw !== undefined) {
    const minutes = Math.round(Number(cookingMinutesRaw));
    if (Number.isFinite(minutes) && minutes > 0) {
      cookingMinutes = Math.min(24 * 60, minutes);
    }
  }

  const difficulty = trimText(input.difficulty, 20);
  const difficultyOk = !difficulty || DIFFICULTY_OPTIONS.some((item) => item.value === difficulty);
  const totalNutrition = normalizeTotalNutrition(input.totalNutrition);

  if (!babyUid) return { ok: false, message: '缺少宝宝信息' };
  if (!babyName || !authorDisplayName) {
    return { ok: false, message: '请先完善宝宝昵称与个人展示名称' };
  }
  if (!coverFileId) return { ok: false, message: '请上传成品图片' };
  if (!title) return { ok: false, message: '请填写标题' };
  if (!description) return { ok: false, message: '请填写菜谱描述' };
  if (!ingredients.length) return { ok: false, message: '请至少添加一种用料（从食物库选择）' };
  if (ingredients.some((item) => !item.foodId)) {
    return { ok: false, message: '用料需从食物库选择' };
  }
  if (!steps.length) return { ok: false, message: '请至少添加一步做法' };
  if (!difficultyOk) return { ok: false, message: '烹饪难度无效' };
  if (!tagResult.ok) return { ok: false, message: tagResult.message };

  const searchText = buildSearchText({
    title,
    description,
    ingredients,
    tags: tagResult.tags
  });

  return {
    ok: true,
    data: {
      title,
      description,
      coverFileId,
      ingredients,
      steps,
      tags: tagResult.tags,
      searchText,
      cookingMinutes,
      difficulty,
      totalNutrition,
      babyName,
      authorDisplayName,
      babyUid,
      authorAvatar
    }
  };
}

function mapPostForCard(post = {}, options = {}) {
  const likedSet = options.likedPostIds instanceof Set
    ? options.likedPostIds
    : new Set(options.likedPostIds || []);
  const id = post._id || '';
  const tags = Array.isArray(post.tags) ? post.tags : [];
  return {
    id,
    title: post.title || '',
    coverFileId: post.coverFileId || '',
    authorLabel: formatRecipeWallAuthorLabel(post),
    likeCount: Number(post.likeCount) || 0,
    liked: likedSet.has(id),
    status: post.status || '',
    description: post.description || '',
    tags,
    tagText: tags[0] || '',
    createdAt: post.createdAt || null
  };
}

module.exports = {
  DIFFICULTY_OPTIONS,
  RECIPE_WALL_TAG_SUGGESTIONS,
  RECIPE_WALL_TAG_MAX_COUNT,
  RECIPE_WALL_TAG_MAX_LEN,
  formatRecipeWallAuthorLabel,
  formatDifficultyLabel,
  normalizeTagItem,
  normalizeTags,
  buildSearchText,
  escapeRegExp,
  normalizeIngredient,
  normalizeStep,
  normalizeTotalNutrition,
  validatePublishPayload,
  mapPostForCard
};
