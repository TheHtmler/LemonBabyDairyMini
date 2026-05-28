function toText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeMealCombinationSource(source = {}) {
  if (!source || typeof source !== 'object') return null;

  const combinationId = toText(source.combinationId);
  const combinationName = toText(source.combinationName);
  const sourceGroupId = toText(source.sourceGroupId);

  if (!combinationId && !combinationName) return null;

  return {
    combinationId,
    combinationName,
    ...(sourceGroupId ? { sourceGroupId } : {})
  };
}

function getMealCombinationSourceText(source = {}) {
  const normalized = normalizeMealCombinationSource(source);
  return normalized?.combinationName ? `来自菜谱：${normalized.combinationName}` : '';
}

module.exports = {
  normalizeMealCombinationSource,
  getMealCombinationSourceText
};
