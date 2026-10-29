'use strict';
const { rankCatalogCandidate, searchText, resolvePeriod, shiftDate, BROWSE_GROUPS } = require('./lib/search');
const { publicCandidate } = require('./catalogAdapter');
const { selectedEvents, publicEvent, groupMealEvents } = require('./recordQueryService');

async function queryBrowse({ reader, plan, now, offset = 0 }) {
  const focus = BROWSE_GROUPS.find(group => group.id === plan.browseGroup);
  const keyword = plan.entityMentions[0]; const key = searchText(keyword);
  const catalog = (await reader.catalogItems(focus && focus.operation === 'catalog.search' ? focus.domain : 'catalog', keyword, plan.source))
    .filter(item => rankCatalogCandidate(item, keyword) >= 0)
    .sort((a, b) => rankCatalogCandidate(a, keyword) - rankCatalogCandidate(b, keyword) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const period = plan.effectivePeriods[0] || resolvePeriod({ kind: 'last_n_days', days: 30 }, now);
  const matchedTypes = new Set(catalog.map(item => item.type));
  const records = new Map();
  if (plan.source === 'all' && (!focus || focus.operation === 'records.list')) {
    const domains = focus ? [focus.domain] : [
      ...(!catalog.length || matchedTypes.has('food') || matchedTypes.has('recipe') ? ['diet'] : []),
      ...(!catalog.length || matchedTypes.has('powder') ? ['milk'] : []),
      ...(!catalog.length || matchedTypes.has('medication') ? ['medication'] : [])
    ];
    await Promise.all(domains.map(async domain => {
      const recordPlan = { ...plan, operation: 'records.list', domain, entities: [], filters: [] };
      const selected = await selectedEvents(reader, recordPlan, period, now);
      const ids = new Set(catalog.filter(item => domain === 'diet' ? ['food', 'recipe'].includes(item.type) : item.type === (domain === 'milk' ? 'powder' : domain))
        .map(item => item.locator && item.locator.memberId || item.sourceId));
      const items = selected.items.filter(item => searchText(item.name).includes(key) || ids.has(item.entityId) ||
        item.candidate && rankCatalogCandidate(item.candidate, keyword) >= 0 ||
        domain === 'milk' && (item.raw.formulaComponents || []).some(component => searchText(component.powderName).includes(key) || ids.has(component.powderId)));
      records.set(domain, domain === 'diet' ? groupMealEvents(items, selected.items) : items.map(item => publicEvent(item, recordPlan)));
    }));
  }
  const items = []; let total = 0;
  for (const group of BROWSE_GROUPS) {
    if (focus && group.id !== focus.id) continue;
    const rows = group.operation === 'catalog.search' ? catalog.filter(item => item.type === group.domain).map(publicCandidate) : records.get(group.domain) || [];
    if (!rows.length) continue;
    total += rows.length;
    items.push(...rows.slice(focus ? offset : 0, focus ? offset + 20 : 3).map((item, index) => ({ ...item,
      ...(index === 0 && (!focus || offset === 0) ? { groupId: group.id, groupLabel: group.label, groupTotal: rows.length, groupHasMore: !focus && rows.length > 3 } : {}) })));
  }
  return { status: total ? 'ready' : 'no_match', message: total ? '' : '没有找到相关资料或最近记录，可以换个名称再试',
    result: { kind: 'list', items, total, nextOffset: focus && offset + items.length < total ? offset + items.length : null,
      note: records.size ? '相关记录范围：' + period.startDate + ' 至 ' + shiftDate(period.endDateExclusive, -1) + (focus ? '' : '；每组先展示最多 3 项。') : '' } };
}

module.exports = { queryBrowse, BROWSE_GROUPS };
