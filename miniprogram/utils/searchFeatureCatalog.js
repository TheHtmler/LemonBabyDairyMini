const { FEATURES } = require('./search-core/features');

function normalize(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ''); }
function searchFeatures(keyword, allowed = []) {
  const query = normalize(keyword).replace(/^(?:请问|我要|我想|怎么|如何|在哪里|在哪儿|在哪|打开|进入|查找|搜索)+/, '').replace(/(?:在哪里|在哪儿|在哪|怎么操作|[?？])+$/, '');
  return FEATURES.filter(x => allowed.includes(x.id)).map(x => ({ ...x, score: normalize(x.name) === query || x.aliases.some(a => normalize(a) === query) ? 0 : 1 }))
    .filter(x => !query || normalize([x.name, ...x.aliases].join(' ')).includes(query)).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
}
function openFeature(id, allowed) {
  const item = FEATURES.find(x => x.id === id && allowed.includes(x.id));
  if (!item) return;
  return item.tab ? wx.switchTab({ url: item.path }) : wx.navigateTo({ url: item.path });
}
module.exports = { FEATURES, searchFeatures, openFeature };
