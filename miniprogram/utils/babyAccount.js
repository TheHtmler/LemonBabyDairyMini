// 多宝宝账号工具：列举当前账号可访问的宝宝、切换当前宝宝、校验写入权限。
// 数据隔离原则：每个宝宝的食物/食谱/奶粉等数据完全独立，
// 跨宝宝迁移数据请使用 utils/babyDataImport.js 的一次性导入。
const { conditionLabel } = require('./babyBindings');
const { formatBabyAgeText } = require('./babyAgeDisplay');

function getAppSafe() {
  return typeof getApp === 'function' ? getApp() : null;
}

function getDb() {
  const app = getAppSafe();
  if (app?.globalData?.cloudEnvId && wx.cloud?.database) {
    return wx.cloud.database({ env: app.globalData.cloudEnvId });
  }
  return wx.cloud.database();
}

function getOpenid() {
  const app = getAppSafe();
  return app?.globalData?.openid || wx.getStorageSync('openid') || '';
}

function getCurrentBabyUid() {
  const app = getAppSafe();
  return app?.globalData?.babyUid || wx.getStorageSync('baby_uid') || '';
}

async function findBabyInfo(db, babyUid) {
  if (!babyUid) return null;
  const res = await db.collection('baby_info').where({ babyUid }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function canWriteBaby(babyUid) {
  const openid = getOpenid();
  if (!babyUid || !openid) return false;
  try {
    const db = getDb();
    const [creatorRes, participantRes] = await Promise.all([
      db.collection('baby_creators').where({ _openid: openid, babyUid }).limit(1).get(),
      db.collection('baby_participants').where({ _openid: openid, babyUid }).limit(1).get()
    ]);
    return !!((creatorRes.data && creatorRes.data.length) || (participantRes.data && participantRes.data.length));
  } catch (error) {
    console.warn('检查宝宝写入权限失败:', error);
    return false;
  }
}

async function listAccessibleBabies() {
  const openid = getOpenid();
  if (!openid) return [];
  const db = getDb();
  const [creatorRes, participantRes] = await Promise.all([
    db.collection('baby_creators').where({ _openid: openid }).limit(20).get(),
    db.collection('baby_participants').where({ _openid: openid }).limit(20).get()
  ]);
  const bindings = [];
  (creatorRes.data || []).forEach((item) => {
    if (item.babyUid) bindings.push({ babyUid: item.babyUid, role: 'creator' });
  });
  (participantRes.data || []).forEach((item) => {
    if (item.babyUid && !bindings.some((binding) => binding.babyUid === item.babyUid)) {
      bindings.push({ babyUid: item.babyUid, role: 'participant' });
    }
  });

  const babies = [];
  for (const binding of bindings) {
    const info = await findBabyInfo(db, binding.babyUid);
    if (!info) continue;
    const ageText = info.birthday ? formatBabyAgeText(info.birthday) : '';
    babies.push({
      babyUid: info.babyUid,
      name: info.name || '宝宝',
      condition: info.condition || 'MMA',
      conditionText: conditionLabel(info.condition || 'MMA'),
      birthday: info.birthday || '',
      ageText,
      gender: info.gender || '',
      avatarUrl: info.avatarUrl || '',
      avatarFileId: info.avatarFileId || '',
      role: binding.role
    });
  }
  return babies;
}

function switchToBaby(baby = {}) {
  const babyUid = baby.babyUid || '';
  if (!babyUid) return;
  const app = getAppSafe();
  const role = baby.role === 'participant' ? 'participant' : 'creator';
  const previousBabyUid = app?.globalData?.babyUid || wx.getStorageSync('baby_uid') || '';
  wx.setStorageSync('baby_uid', babyUid);
  wx.setStorageSync('user_role', role);
  wx.setStorageSync('has_selected_role', true);
  wx.removeStorageSync('account_logged_out');
  if (previousBabyUid && previousBabyUid !== babyUid) {
    // 清掉旧宝宝的信息缓存，避免 getBabyInfo 继续返回上一个宝宝的姓名/头像
    const cached = wx.getStorageSync('baby_info');
    if (cached && cached.babyUid && cached.babyUid !== babyUid) {
      wx.removeStorageSync('baby_info');
    }
    if (app?.globalData?.babyInfo && app.globalData.babyInfo.babyUid !== babyUid) {
      app.globalData.babyInfo = null;
    }
  }
  if (app) {
    app.globalData.babyUid = babyUid;
    app.globalData.userRole = role;
    app.globalData.isOwner = role === 'creator';
    app.globalData.permission = true;
  }
}

module.exports = {
  getCurrentBabyUid,
  canWriteBaby,
  listAccessibleBabies,
  switchToBaby
};
