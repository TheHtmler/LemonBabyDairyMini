const test = require('node:test');
const assert = require('node:assert/strict');

// 多宝宝切换的缓存一致性回归测试：
// 历史上 switchToBaby 只切 baby_uid 不清 baby_info 缓存，
// 导致切换后 getBabyInfo 仍返回上一个宝宝的姓名/头像（张冠李戴）。

function setupEnv() {
  const store = new Map();
  const app = {
    globalData: {
      babyUid: 'baby-a',
      babyInfo: { babyUid: 'baby-a', name: '柠檬' },
      cloudEnvId: ''
    }
  };
  global.wx = {
    getStorageSync: (key) => store.get(key),
    setStorageSync: (key, value) => store.set(key, value),
    removeStorageSync: (key) => store.delete(key),
    cloud: {
      database: () => ({
        collection: () => ({
          where: () => ({
            limit: () => ({ get: async () => ({ data: [] }) }),
            get: async () => ({ data: [] })
          })
        })
      })
    }
  };
  global.getApp = () => app;
  store.set('baby_uid', 'baby-a');
  store.set('baby_info', { babyUid: 'baby-a', name: '柠檬' });
  return { store, app };
}

function loadBabyAccount() {
  const modulePath = require.resolve('../miniprogram/utils/babyAccount.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('switching baby clears the previous baby info cache', () => {
  const { store, app } = setupEnv();
  const { switchToBaby } = loadBabyAccount();

  switchToBaby({ babyUid: 'baby-b', role: 'creator' });

  assert.equal(store.get('baby_uid'), 'baby-b');
  // 旧宝宝的 baby_info 缓存必须清掉，否则首页头部仍显示旧宝宝
  assert.equal(store.get('baby_info'), undefined);
  assert.equal(app.globalData.babyInfo, null);
  assert.equal(app.globalData.babyUid, 'baby-b');
});

test('switching back to the cached baby keeps its info cache', () => {
  const { store, app } = setupEnv();
  const { switchToBaby } = loadBabyAccount();

  // 缓存与目标一致时不应清掉，避免不必要的云端拉取
  switchToBaby({ babyUid: 'baby-a', role: 'creator' });

  assert.equal(store.get('baby_info')?.name, '柠檬');
  assert.equal(app.globalData.babyInfo?.name, '柠檬');
});

test('switching to a baby as participant records the participant role', () => {
  const { store, app } = setupEnv();
  const { switchToBaby } = loadBabyAccount();

  switchToBaby({ babyUid: 'baby-b', role: 'participant' });

  assert.equal(store.get('user_role'), 'participant');
  assert.equal(app.globalData.userRole, 'participant');
  assert.equal(app.globalData.isOwner, false);
});
