// pages/about/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    logoUrl: '/images/LemonLogo.png',
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

  // 跳转到特定部分
  scrollToSection: function (sectionId) {
    // 滚动到指定section
    const query = wx.createSelectorQuery();
    query.select('#' + sectionId).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec(function (res) {
      if (res[0]) {
        wx.pageScrollTo({
          scrollTop: res[1].scrollTop + res[0].top - 50,
          duration: 300
        });
      }
    });
  },

  // 复制联系邮箱
  copyEmail: function () {
    wx.setClipboardData({
      data: 'support@lemonbaby.com',
      success: function () {
        wx.showToast({
          title: '邮箱已复制',
          icon: 'success'
        });
      }
    });
  }
})