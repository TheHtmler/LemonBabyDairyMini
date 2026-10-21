const revisions = new Map();
const additions = new Map();
function currentContext() {
  const app = getApp(); const global = app.globalData || {};
  return { accountKey: global.openid || wx.getStorageSync('openid') || '', babyUid: global.babyUid || wx.getStorageSync('baby_uid') || '', babyName: (global.babyInfo || {}).name || '当前宝宝' };
}
function revision(babyUid) { return revisions.get(babyUid) || 0; }
function invalidateSearchForBaby(babyUid, saved) {
  if (!babyUid) return;
  revisions.set(babyUid, revision(babyUid) + 1);
  if (!saved) return;
  const context = currentContext();
  if (context.babyUid !== babyUid || !context.accountKey || saved.accountKey && saved.accountKey !== context.accountKey) return;
  const type = saved.targetType || (saved.powderId || saved.mode === 'powder_label' ? 'powder' : 'food');
  const id = saved.itemId || saved.powderId || saved.foodId || saved.targetId;
  if (id && ['food', 'powder'].includes(type)) additions.set(babyUid, { type, id, name: saved.name || saved.finalValues && saved.finalValues.name || '', accountKey: context.accountKey, createdAt: Date.now() });
}
function takeSearchAddition(babyUid) {
  const value = additions.get(babyUid); additions.delete(babyUid);
  return value && value.accountKey === currentContext().accountKey && Date.now() - value.createdAt < 1800000 ? value : null;
}
function createSearchSession({ accountKey, babyUid }) {
  const key = 'home_search_recent:' + accountKey + ':' + babyUid;
  let epoch = 0; let rev = revision(babyUid);
  return { accountKey, babyUid, get epoch() { return epoch; }, next() { epoch++; rev = revision(babyUid); return epoch; },
    active(token) { const current = currentContext(); return token === epoch && current.accountKey === accountKey && current.babyUid === babyUid && rev === revision(babyUid); },
    changed() { return rev !== revision(babyUid); },
    recent() { const value = wx.getStorageSync(key); return Array.isArray(value) ? value.filter(x => typeof x === 'string').slice(0, 10) : []; },
    remember(query) { const value = query.trim(); if (value && accountKey && babyUid) wx.setStorageSync(key, [value, ...this.recent().filter(x => x !== value)].slice(0, 10)); },
    remove(query) { wx.setStorageSync(key, this.recent().filter(x => x !== query)); },
    clear() { wx.removeStorageSync(key); }, dispose() { epoch++; } };
}
function openSearchLocator(locator) {
  const context = currentContext();
  if (!locator || locator.babyUid !== context.babyUid) return wx.showToast({ title: '宝宝已切换，请重新搜索', icon: 'none' });
  const date = encodeURIComponent(locator.date || '');
  if (locator.kind === 'meal' && locator.mealBatchId) return wx.navigateTo({ url: '/pkg-records/meal-editor/index?date=' + date + '&from=search&mealBatchId=' + encodeURIComponent(locator.mealBatchId) });
  if (locator.kind === 'milk') return wx.navigateTo({ url: '/pkg-milk/milk-feeding-editor-v2/index?mode=edit&source=search&date=' + date + '&recordId=' + encodeURIComponent(locator.recordId) });
  const app = getApp(); app.globalData.pendingSearchLocator = { ...locator, accountKey: context.accountKey, createdAt: Date.now() };
  return wx.switchTab({ url: '/pages/data-records-v2/index' });
}
module.exports = { currentContext, createSearchSession, invalidateSearchForBaby, takeSearchAddition, openSearchLocator };
