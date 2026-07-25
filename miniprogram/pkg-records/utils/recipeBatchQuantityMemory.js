const KEY_PREFIX = 'recipe_last_batch_qty';

function buildStorageKey(babyUid, recipeId) {
  return `${KEY_PREFIX}_${babyUid || 'anon'}_${recipeId || ''}`;
}

function normalizeQuantityList(ingredients = []) {
  return (ingredients || [])
    .map((item = {}) => {
      const foodId = String(item.foodId || '').trim();
      const quantity = Math.max(0, Number(item.quantity) || 0);
      if (!foodId || !(quantity > 0)) return null;
      return {
        foodId,
        quantity,
        unit: item.unit || 'g'
      };
    })
    .filter(Boolean);
}

function saveLastBatchQuantities(babyUid, recipeId, ingredients = []) {
  const id = String(recipeId || '').trim();
  if (!id) return false;
  const list = normalizeQuantityList(ingredients);
  if (!list.length) return false;
  try {
    wx.setStorageSync(buildStorageKey(babyUid, id), {
      updatedAt: Date.now(),
      ingredients: list
    });
    return true;
  } catch (error) {
    console.warn('保存上次食谱用量失败:', error);
    return false;
  }
}

function readLastBatchQuantities(babyUid, recipeId) {
  const id = String(recipeId || '').trim();
  if (!id) return [];
  try {
    const cached = wx.getStorageSync(buildStorageKey(babyUid, id));
    if (!cached || !Array.isArray(cached.ingredients)) return [];
    return normalizeQuantityList(cached.ingredients);
  } catch (error) {
    return [];
  }
}

module.exports = {
  buildStorageKey,
  normalizeQuantityList,
  saveLastBatchQuantities,
  readLastBatchQuantities
};
