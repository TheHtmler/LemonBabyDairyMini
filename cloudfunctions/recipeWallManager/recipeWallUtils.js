const RECIPE_WALL_TAG_OPTIONS = ['辅食', '低蛋白', '特医友好'];

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

function normalizeIngredient(raw = {}) {
  const name = trimText(raw.name, 40);
  const amount = trimText(raw.amount, 40);
  if (!name) return null;
  return { name, amount };
}

function normalizeStep(raw = {}) {
  const text = trimText(raw.text, 500);
  const imageFileId = trimText(raw.imageFileId, 300);
  if (!text) return null;
  return { text, imageFileId };
}

function validatePublishPayload(input = {}) {
  const title = trimText(input.title, 40);
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
  const tags = (Array.isArray(input.tags) ? input.tags : [])
    .map((t) => trimText(t, 20))
    .filter(Boolean);

  if (!babyUid) return { ok: false, message: '缺少宝宝信息' };
  if (!babyName || !authorDisplayName) {
    return { ok: false, message: '请先完善宝宝昵称与个人展示名称' };
  }
  if (!title) return { ok: false, message: '请填写标题' };
  if (!coverFileId) return { ok: false, message: '请上传封面图' };
  if (!ingredients.length) return { ok: false, message: '请至少添加一种材料' };
  if (!steps.length) return { ok: false, message: '请至少添加一步做法' };
  if (tags.length !== 1 || !RECIPE_WALL_TAG_OPTIONS.includes(tags[0])) {
    return { ok: false, message: '请选择辅食 / 低蛋白 / 特医友好标签' };
  }

  return {
    ok: true,
    data: {
      title,
      coverFileId,
      ingredients,
      steps,
      tags,
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
    tags: Array.isArray(post.tags) ? post.tags : [],
    createdAt: post.createdAt || null
  };
}

module.exports = {
  RECIPE_WALL_TAG_OPTIONS,
  formatRecipeWallAuthorLabel,
  normalizeIngredient,
  normalizeStep,
  validatePublishPayload,
  mapPostForCard
};
