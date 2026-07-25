function buildQuery(options = {}) {
  return Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== null && options[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`)
    .join('&');
}

Page({
  onLoad(options = {}) {
    const query = buildQuery(options);
    wx.redirectTo({
      url: `/pkg-records/meal-editor/index${query ? `?${query}` : ''}`
    });
  }
});
