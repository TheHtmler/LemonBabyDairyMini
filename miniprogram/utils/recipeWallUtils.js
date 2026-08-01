const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: '简单' },
  { value: 'normal', label: '普通' },
  { value: 'hard', label: '较难' }
];

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

  return {
    ok: true,
    data: {
      title,
      description,
      coverFileId,
      ingredients,
      steps,
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
  return {
    id,
    title: post.title || '',
    coverFileId: post.coverFileId || '',
    authorLabel: formatRecipeWallAuthorLabel(post),
    likeCount: Number(post.likeCount) || 0,
    liked: likedSet.has(id),
    status: post.status || '',
    description: post.description || '',
    createdAt: post.createdAt || null
  };
}

module.exports = {
  DIFFICULTY_OPTIONS,
  formatRecipeWallAuthorLabel,
  formatDifficultyLabel,
  normalizeIngredient,
  normalizeStep,
  normalizeTotalNutrition,
  validatePublishPayload,
  mapPostForCard
};
