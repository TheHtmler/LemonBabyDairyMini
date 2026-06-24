const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function loadPersonalInfoPage() {
  const pagePath = require.resolve('../miniprogram/pkg-misc/personal-info/index.js');
  delete require.cache[pagePath];

  let pageConfig = null;
  const previousPage = global.Page;
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);
  global.Page = previousPage;

  return pageConfig;
}

function createPersonalInfoPageInstance(page, data = {}) {
  return {
    ...page,
    data: {
      ...page.data,
      ...data
    },
    setData(update) {
      Object.assign(this.data, update);
    }
  };
}

function loadMiniProgramApp({ storage = {}, creators = [], participants = [], babyInfos = [] } = {}) {
  let appConfig = null;
  const storageMap = new Map(Object.entries(storage));
  const calls = {
    baby_creators: 0,
    baby_participants: 0,
    baby_info: 0,
    getOpenid: 0
  };
  const sandbox = {
    console,
    App(config) {
      appConfig = config;
    },
    wx: {
      getStorageSync(key) {
        return storageMap.get(key);
      },
      setStorageSync(key, value) {
        storageMap.set(key, value);
      },
      removeStorageSync(key) {
        storageMap.delete(key);
      },
      cloud: {
        async callFunction({ name }) {
          if (name === 'getOpenid') {
            calls.getOpenid += 1;
            return { result: { openid: 'cloud-openid' } };
          }
          return { result: {} };
        },
        database() {
          return {
            collection(name) {
              return {
                where(query) {
                  return {
                    async get() {
                      if (name === 'baby_creators') {
                        calls.baby_creators += 1;
                        return {
                          data: creators.filter((item) => (
                            (!query._openid || item._openid === query._openid)
                            && (!query.babyUid || item.babyUid === query.babyUid)
                          ))
                        };
                      }
                      if (name === 'baby_participants') {
                        calls.baby_participants += 1;
                        return {
                          data: participants.filter((item) => (
                            (!query._openid || item._openid === query._openid)
                            && (!query.babyUid || item.babyUid === query.babyUid)
                          ))
                        };
                      }
                      if (name === 'baby_info') {
                        calls.baby_info += 1;
                        return {
                          data: babyInfos.filter((item) => (
                            !query.babyUid || item.babyUid === query.babyUid
                          ))
                        };
                      }
                      return { data: [] };
                    },
                    limit() {
                      return this;
                    }
                  };
                }
              };
            }
          };
        },
        async getTempFileURL() {
          return { fileList: [] };
        }
      }
    }
  };

  vm.runInNewContext(readProjectFile('miniprogram/app.js'), sandbox);
  return {
    app: appConfig,
    storage: storageMap,
    calls
  };
}

test('profile menu exposes personal info entry', () => {
  const source = readProjectFile('miniprogram/pages/profile/index.js');

  assert.match(source, /name:\s*'个人信息'/);
  assert.match(source, /path:\s*'\/pkg-misc\/personal-info\/index'/);
  assert.match(source, /查看身份、展示名称与账号状态/);
});

test('personal info page is registered and supports identity editing and status copy', () => {
  const appJson = JSON.parse(readProjectFile('miniprogram/app.json'));
  const miscPackage = appJson.subPackages.find((item) => item.root === 'pkg-misc');

  assert.ok(miscPackage.pages.includes('personal-info/index'));

  const js = readProjectFile('miniprogram/pkg-misc/personal-info/index.js');
  const wxml = readProjectFile('miniprogram/pkg-misc/personal-info/index.wxml');

  assert.match(js, /loadPersonalInfo/);
  assert.match(js, /saveDisplayName/);
  assert.match(js, /copyAccountStatus/);
  assert.match(js, /baby_creators/);
  assert.match(js, /baby_participants/);
  assert.match(wxml, /当前身份/);
  assert.match(wxml, /展示名称/);
  assert.match(wxml, /宝宝名称/);
  assert.match(wxml, /创建者/);
  assert.match(wxml, /参与者/);
  assert.match(wxml, /排查标识/);
  assert.match(wxml, /当前页面/);
  assert.match(wxml, /设备信息/);
  assert.match(wxml, /复制账号状态/);
});

test('personal info status copy includes current openid for troubleshooting', () => {
  const page = loadPersonalInfoPage();
  const instance = createPersonalInfoPageInstance(page, {
    babyName: '柠檬宝宝',
    userRole: 'creator',
    roleLabel: '创建者',
    displayName: '妈妈',
    creatorInfoText: '妈妈',
    participantsInfoText: '1 位：爸爸',
    bindingStatus: '已绑定宝宝记录',
    babyUid: 'baby-1',
    currentRouteText: 'pkg-misc/personal-info/index',
    systemInfoText: 'iPhone | iOS 18',
    appVersion: '1.0.0'
  });
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  let clipboardText = '';

  global.getApp = () => ({
    globalData: {
      openid: 'openid-1'
    }
  });
  global.wx = {
    getStorageSync() {
      return '';
    },
    setClipboardData({ data, success }) {
      clipboardText = data;
      if (success) success();
    },
    showToast() {}
  };

  try {
    page.copyAccountStatus.call(instance);
  } finally {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  }

  assert.match(clipboardText, /OpenID：openid-1/);
});

test('cached babyInfo includes creator and participants info snapshots', () => {
  const source = readProjectFile('miniprogram/app.js');

  assert.match(source, /resolveBabyCaregiverInfo/);
  assert.match(source, /creatorInfo/);
  assert.match(source, /participantsInfo/);
  assert.match(source, /baby_creators/);
  assert.match(source, /baby_participants/);
  assert.match(source, /wx\.setStorageSync\('baby_info', normalizedBabyInfo\)/);
});

test('getOpenid reuses cached storage openid without cloud function call', async () => {
  const { app, calls } = loadMiniProgramApp({
    storage: {
      openid: 'cached-openid'
    }
  });

  const openid = await app.getOpenid();

  assert.equal(openid, 'cached-openid');
  assert.equal(app.globalData.openid, 'cached-openid');
  assert.equal(calls.getOpenid, 0);
});

test('logout keeps persisted baby records intact', () => {
  const source = readProjectFile('miniprogram/pages/profile/index.js');

  assert.doesNotMatch(source, /collection\('feeding_records'\)[\s\S]{0,120}\.remove\(/);
  assert.doesNotMatch(source, /collection\('medication_records'\)[\s\S]{0,120}\.remove\(/);
  assert.doesNotMatch(source, /collection\('baby_info'\)[\s\S]{0,160}\.remove\(/);
});

test('local logout prevents cloud relation from auto-restoring role', async () => {
  const { app, storage } = loadMiniProgramApp({
    storage: {
      account_logged_out: true
    },
    creators: [
      {
        _openid: 'openid-1',
        babyUid: 'baby-1',
        phone: '13800000000'
      }
    ],
    babyInfos: [
      {
        babyUid: 'baby-1',
        name: '柠檬宝宝',
        birthday: '2026-01-01',
        weight: 4.2
      }
    ]
  });

  app.globalData.openid = 'openid-1';

  const role = await app.getUserRole();

  assert.equal(role, null);
  assert.equal(app.globalData.userRole, '');
  assert.equal(storage.get('user_role'), undefined);
  assert.equal(storage.get('baby_uid'), undefined);
});

test('invalid creator relation does not block restoring valid participant role', async () => {
  const { app, storage } = loadMiniProgramApp({
    creators: [
      {
        _openid: 'openid-1',
        babyUid: 'missing-baby',
        phone: '13800000000'
      }
    ],
    participants: [
      {
        _openid: 'openid-1',
        babyUid: 'baby-1'
      }
    ],
    babyInfos: [
      {
        babyUid: 'baby-1',
        name: '柠檬宝宝',
        birthday: '2026-01-01',
        weight: 4.2
      }
    ]
  });

  app.globalData.openid = 'openid-1';

  const role = await app.getUserRole();

  assert.equal(role, 'participant');
  assert.equal(app.globalData.userRole, 'participant');
  assert.equal(storage.get('user_role'), 'participant');
  assert.equal(storage.get('baby_uid'), 'baby-1');
});

test('app.checkPermission re-queries relations for same openid and baby to keep permission fresh', async () => {
  const { app, calls } = loadMiniProgramApp({
    storage: {
      baby_uid: 'baby-1'
    },
    creators: [
      {
        _openid: 'openid-1',
        babyUid: 'baby-1',
        phone: '13800000000'
      }
    ]
  });

  app.globalData.openid = 'openid-1';
  app.globalData.babyUid = 'baby-1';

  assert.equal(await app.checkPermission(), true);
  assert.equal(await app.checkPermission(), true);
  assert.equal(calls.baby_creators, 2);
  assert.equal(calls.baby_participants, 0);
});

test('validateBabyInfo re-queries relations after getUserRole instead of using session cache', async () => {
  const { app, calls } = loadMiniProgramApp({
    creators: [
      {
        _openid: 'openid-1',
        babyUid: 'baby-1',
        phone: '13800000000'
      }
    ],
    babyInfos: [
      {
        babyUid: 'baby-1',
        name: '柠檬宝宝',
        birthday: '2026-01-01',
        weight: 4.2
      }
    ],
    storage: {
      baby_info_completed: true
    }
  });

  app.globalData.openid = 'openid-1';
  const role = await app.getUserRole();
  const creatorReadsAfterRole = calls.baby_creators;
  const participantReadsAfterRole = calls.baby_participants;

  assert.equal(role, 'creator');
  assert.equal(await app.validateBabyInfo(), true);
  assert.equal(calls.baby_creators, creatorReadsAfterRole + 1);
  assert.equal(calls.baby_participants, participantReadsAfterRole);
});

test('initialized app returns baby info validity for bound participant', async () => {
  const { app } = loadMiniProgramApp({
    storage: {
      user_role: 'participant',
      has_selected_role: true,
      baby_uid: 'baby-1',
      baby_info_completed: true
    },
    participants: [
      {
        _openid: 'openid-1',
        babyUid: 'baby-1'
      }
    ],
    babyInfos: [
      {
        babyUid: 'baby-1',
        name: '柠檬宝宝',
        birthday: '2026-01-01',
        weight: 4.2
      }
    ]
  });

  app.globalData.openid = 'openid-1';
  app.globalData.userRole = 'participant';
  app.globalData.isInitialized = true;

  const initResult = await app.waitForInitialization();

  assert.equal(initResult.userRole, 'participant');
  assert.equal(initResult.babyInfoValid, true);
});
