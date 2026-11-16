// 识别可以使用多图，长期资料只保留封面及包装的营养表依据。
function retainedFoodPhotos(state) {
  const paths = [...new Set((state.foodImagePaths || []).filter(Boolean))];
  if (!paths.length) return [];
  const cover = paths.includes(state.coverImagePath) ? state.coverImagePath : paths[0];
  if (state.mode === 'food_object') return [cover];
  const evidence = state.result?.observation?.packageEvidence;
  const index = evidence?.nutrition?.imageIndex;
  const nutrition = Number.isInteger(index) ? state.paths?.[index] : '';
  // 优先保留模型明确指向且用户未移除的营养表；否则沿用输入中首张非封面图。
  const label = paths.includes(nutrition) ? nutrition : paths.find(path => path !== cover);
  return [...new Set([cover, label].filter(Boolean))];
}

module.exports = { retainedFoodPhotos };
