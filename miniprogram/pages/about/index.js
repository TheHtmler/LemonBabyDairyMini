// pages/about/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    logoUrl: '/images/logo.png',
    appVersion: '1.0.0'
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 如果从其他页面跳转而来，检查是否需要显示特定的锚点
    if (options.section) {
      this.scrollToSection(options.section);
    }
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  },

  // 跳转到特定部分
  scrollToSection: function (sectionId) {
    wx.createSelectorQuery()
      .select('#' + sectionId)
      .boundingClientRect(function (rect) {
        if (rect) {
          wx.pageScrollTo({
            scrollTop: rect.top,
            duration: 300
          });
        }
      })
      .exec();
  },

  // 复制联系邮箱
  copyEmail: function () {
    wx.setClipboardData({
      data: 'support@lemonbaby.com',
      success: function () {
        wx.showToast({
          title: '邮箱已复制',
          icon: 'success',
          duration: 1500
        });
      }
    });
  },

  // 返回上一页
  navigateBack: function () {
    wx.navigateBack({
      delta: 1
    });
  }
})