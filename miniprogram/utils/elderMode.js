// 仅保存在当前设备；不写入宝宝档案或家庭共享设置。
const ELDER_MODE_KEY = 'elder_mode_enabled';
const ELDER_HOME_URL = '/pages/elder-home/index';
let openingHome = false;
let recordSaved = false;

function isElderMode() {
  try {
    return typeof wx !== 'undefined' && wx.getStorageSync(ELDER_MODE_KEY) === true;
  } catch (error) {
    return false;
  }
}

function setElderMode(enabled) {
  try {
    wx.setStorageSync(ELDER_MODE_KEY, enabled === true);
    return true;
  } catch (error) {
    wx.showToast({ title: '模式未保存，请重试', icon: 'none' });
    return false;
  }
}

function openElderHome() {
  if (openingHome) return;
  openingHome = true;
  wx.reLaunch({
    url: ELDER_HOME_URL,
    fail() {
      wx.showToast({ title: '页面打开失败，请重新进入', icon: 'none' });
    },
    complete() { openingHome = false; }
  });
}

// 普通页的加载与显示均守卫，覆盖冷启动、分享入口和切换标签页。
function guardNormalPage() {
  if (!isElderMode()) {
    if (typeof wx !== 'undefined' && wx.showTabBar) wx.showTabBar({ animation: false });
    return false;
  }
  if (wx.hideTabBar) wx.hideTabBar({ animation: false });
  openElderHome();
  return true;
}

function enableElderMode() {
  if (setElderMode(true)) openElderHome();
}

function exitElderMode() {
  if (!setElderMode(false)) return;
  recordSaved = false;
  wx.switchTab({
    url: '/pages/profile/index',
    success() {
      if (wx.showTabBar) wx.showTabBar({ animation: false });
    },
    fail() {
      // 留在长辈首页时恢复偏好，让用户仍可重试退出。
      setElderMode(true);
      wx.showToast({ title: '退出失败，请重试', icon: 'none' });
    }
  });
}

function finishElderRecord() {
  recordSaved = true;
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const homeIndex = pages.findIndex((page) => page.route === ELDER_HOME_URL.slice(1));
  if (homeIndex >= 0 && homeIndex < pages.length - 1) {
    wx.navigateBack({ delta: pages.length - 1 - homeIndex, fail: openElderHome });
  } else {
    openElderHome();
  }
}

function consumeRecordSaved() {
  const saved = recordSaved;
  recordSaved = false;
  return saved;
}

module.exports = {
  isElderMode,
  guardNormalPage,
  enableElderMode,
  exitElderMode,
  finishElderRecord,
  consumeRecordSaved
};
