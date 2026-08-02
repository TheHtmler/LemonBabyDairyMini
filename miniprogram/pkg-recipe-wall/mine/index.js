// 兼容旧入口：统一到广场「我发布的」Tab
Page({
  onLoad() {
    wx.redirectTo({
      url: '/pkg-recipe-wall/list/index?filter=mine'
    });
  }
});
