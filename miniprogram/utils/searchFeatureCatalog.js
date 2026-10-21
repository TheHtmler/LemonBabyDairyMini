const { FEATURES } = require('./search-core/features');

function openFeature(id, allowed) {
  const item = FEATURES.find(x => x.id === id && allowed.includes(x.id));
  if (!item) return;
  return item.tab ? wx.switchTab({ url: item.path }) : wx.navigateTo({ url: item.path });
}
module.exports = { openFeature };
