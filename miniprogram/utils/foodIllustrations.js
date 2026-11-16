const catalog = require('../data/food-illustrations');
const cloudFiles = require('../data/food-illustrations-cloud');

function isRemoteImage(source = '') {
  return /^(cloud:\/\/|https:\/\/)/.test(source);
}

function getFoodIllustration(food = {}) {
  const placeholderText = Array.from(String(food.name || '食物').trim()).slice(0, 2).join('');
  const ownImage = [food.image, ...(Array.isArray(food.images) ? food.images : []), food.imageUrl]
    .find(value => typeof value === 'string' && value.trim());
  // 图片仅由展示层解析，不能写回食物的营养快照或覆盖用户上传的照片。
  if (ownImage) {
    return { source: ownImage.trim(), fallback: '', kind: 'photo', placeholderText, label: food.name || '食物照片' };
  }
  const code = String(food.sourceFoodCode || food.origin?.foodCode || '');
  const isSystemSource = food.isSystem || food.isSystemSnapshot || food.sourceSystemFoodId || food.sourceType === 'system';
  const key = isSystemSource && catalog.foods[code];
  if (!key) return { source: '', fallback: '', kind: 'empty', placeholderText, label: food.name || '食物' };
  const local = catalog.localFiles[key] || '';
  const base = typeof cloudFiles.root === 'string' && isRemoteImage(cloudFiles.root) && cloudFiles.root.endsWith('/') ? cloudFiles.root : '';
  const override = cloudFiles.files[key];
  const remote = base ? base + key + '.jpg' : '';
  return {
    source: typeof override === 'string' && isRemoteImage(override) ? override : (local || remote),
    fallback: local,
    kind: 'food',
    placeholderText,
    label: (food.name || '食物') + '示意图'
  };
}

module.exports = { getFoodIllustration, isRemoteImage };
