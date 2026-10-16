'use strict';
const { compareNutrient } = require('./nutrition');
function searchText(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''); }
function rankCatalogCandidate(candidate, keyword) {
  const key = searchText(keyword);
  if (!key || searchText(candidate.name) === key) return 0;
  if ((candidate.aliases || []).some(x => searchText(x) === key)) return 1;
  return searchText(candidate.searchText || candidate.name).includes(key) ? 2 : -1;
}
function matchCandidate(candidate, query) {
  if (!query.scope.includes(candidate.type) || candidate.deleted) return { state: 'unmatched', reasons: [] };
  if (query.intent !== 'search_catalog' && !(candidate.actualQuantity > 0)) return { state: 'unmatched', reasons: [] };
  if (query.intent === 'search_catalog' && query.source !== 'all' && candidate.source !== query.source) return { state: 'unmatched', reasons: [] };
  // 属性问题先确认对象名称，不能因为备注提到另一种药就回答该药的属性。
  if (query.answerFields && query.keyword && ![candidate.name, ...(candidate.aliases || []), candidate.brand, candidate.series]
    .some(value => searchText(value).includes(searchText(query.keyword)))) return { state: 'unmatched', reasons: [] };
  if (rankCatalogCandidate(candidate, query.keyword) < 0) return { state: 'unmatched', reasons: [] };
  if (candidate.type === 'recipe' && query.conditions.length) return { state: 'unknown', reasons: ['recipe_density_unsupported'] };
  if (candidate.type === 'medication' && query.conditions.length) return { state: 'unmatched', reasons: [] };
  const results = query.conditions.map(condition => compareNutrient(candidate, condition, query.powderBasis));
  if (results.some(x => x.state === 'unmatched')) return { state: 'unmatched', reasons: [] };
  const reasons = results.filter(x => x.state === 'unknown').map(x => x.reason);
  return { state: reasons.length ? 'unknown' : 'matched', reasons };
}
module.exports = { searchText, rankCatalogCandidate, matchCandidate };
