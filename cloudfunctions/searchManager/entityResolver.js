'use strict';
const { searchText, rankCatalogCandidate, CATALOG_DOMAINS } = require('./lib/search');

function identityRank(item, mention) {
  const key = searchText(mention); if (!key) return -1;
  if (searchText(item.name) === key) return 0;
  if ((item.aliases || []).some(x => searchText(x) === key)) return 1;
  if ([item.name, ...(item.aliases || []), item.type === 'powder' ? item.brand : '', item.type === 'powder' ? item.series : ''].some(x => searchText(x).includes(key))) return 2;
  return -1;
}
async function resolveEntities(reader, draft, period) {
  if (!draft.entityMentions.length || draft.domain === 'feature' || draft.domain === 'intake') return { items: [], candidates: [], match: 'none' };
  const catalogDomain = draft.domain === 'catalog' || CATALOG_DOMAINS.includes(draft.domain) ? draft.domain : draft.domain === 'milk' ? 'powder' : draft.domain === 'diet' ? 'food' : null;
  const matched = [];
  for (const mention of draft.entityMentions) {
    let rows = catalogDomain ? await reader.catalogItems(catalogDomain, mention, draft.source) : [];
    const ranked = rows.map(item => ({ item, rank: draft.operation === 'catalog.search' ? rankCatalogCandidate(item, mention) : identityRank(item, mention) })).filter(x => x.rank >= 0).sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name));
    const exact = ranked.filter(x => x.rank < 2);
    let candidates = (draft.operation === 'catalog.search' ? ranked : exact.length ? exact : ranked).map(x => x.item);
    if (!draft.operation.startsWith('catalog') && ['medication', 'diet', 'milk'].includes(draft.domain)) {
      const periods = Array.isArray(period) ? period : [period];
      const events = (await Promise.all(periods.map(value => reader.events(draft.domain, value)))).flat();
      const history = draft.domain === 'milk' ? events.flatMap(row => (row.raw.formulaComponents || []).filter(x => x.kind === 'formula_powder').map(x => ({ entityId: x.powderId, name: x.powderName }))) : events;
      const knownId = item => item.locator && item.locator.memberId || item.sourceId;
      const historical = [...new Map(history.filter(x => searchText(x.name).includes(searchText(mention))).map(x => [x.entityId || x.name,
        { id: 'history:' + draft.domain + ':' + (x.entityId || x.name), sourceId: x.entityId || '', name: x.name, type: draft.domain, source: 'history', aliases: [], historical: true }])).values()];
      candidates.push(...historical.filter(item => !candidates.some(current => knownId(current) && knownId(current) === item.sourceId)));
    }
    if (!candidates.length) return { items: [], candidates: [], match: 'not_found', mention };
    matched.push(...candidates);
  }
  const items = [...new Map(matched.map(x => [x.id, x])).values()];
  return { items, candidates: items.map(item => ({ id: item.id, name: item.name, type: item.type, source: item.source })), match: items.length === 1 ? 'unique' : 'multiple' };
}
module.exports = { identityRank, resolveEntities };
