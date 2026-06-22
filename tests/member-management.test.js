const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const pagePath = 'miniprogram/pkg-misc/member-management/index.js';
const functionDir = path.join('cloudfunctions', 'manageParticipants');
const functionPath = path.join(functionDir, 'index.js');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function loadMemberManagementPage() {
  const resolved = require.resolve(path.resolve(__dirname, '..', pagePath));
  delete require.cache[resolved];

  let pageConfig = null;
  const previousPage = global.Page;
  global.Page = (config) => {
    pageConfig = config;
  };

  require(resolved);
  global.Page = previousPage;

  return pageConfig;
}

function matchesQuery(item, query = {}) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

function createDbMock({ creators = [], participants = [] } = {}) {
  const writes = {
    updates: [],
    removes: [],
    adds: []
  };
  const data = {
    baby_creators: creators.map((item) => ({ ...item })),
    baby_participants: participants.map((item) => ({ ...item }))
  };
  const db = {
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      return {
        where(query) {
          return {
            limit() {
              return this;
            },
            async get() {
              return {
                data: (data[name] || []).filter((item) => matchesQuery(item, query))
              };
            },
            async update({ data: updateData }) {
              const rows = data[name] || [];
              const matched = rows.filter((item) => matchesQuery(item, query));
              matched.forEach((item) => Object.assign(item, updateData));
              writes.updates.push({ collectionName: name, query, data: updateData });
              return { stats: { updated: matched.length } };
            },
            async remove() {
              const rows = data[name] || [];
              const kept = rows.filter((item) => !matchesQuery(item, query));
              const removed = rows.length - kept.length;
              data[name] = kept;
              writes.removes.push({ collectionName: name, query });
              return { stats: { removed } };
            }
          };
        },
        doc(id) {
          return {
            async update({ data: updateData }) {
              const row = (data[name] || []).find((item) => item._id === id);
              if (row) Object.assign(row, updateData);
              writes.updates.push({ collectionName: name, docId: id, data: updateData });
              return { stats: { updated: row ? 1 : 0 } };
            },
            async remove() {
              const rows = data[name] || [];
              const kept = rows.filter((item) => item._id !== id);
              const removed = rows.length - kept.length;
              data[name] = kept;
              writes.removes.push({ collectionName: name, docId: id });
              return { stats: { removed } };
            }
          };
        },
        async add({ data: addData }) {
          const row = { _id: `${name}-${data[name].length + 1}`, ...addData };
          data[name].push(row);
          writes.adds.push({ collectionName: name, data: addData });
          return { _id: row._id };
        }
      };
    }
  };

  return { db, writes, data };
}

function loadFunctionWithMockCloud(db, openid) {
  const resolved = require.resolve(path.resolve(__dirname, '..', functionPath));
  const previousLoad = Module._load;
  delete require.cache[resolved];

  Module._load = function mockWxServerSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test-env',
        init() {},
        database() {
          return db;
        },
        getWXContext() {
          return { OPENID: openid };
        }
      };
    }
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    return require(resolved);
  } finally {
    Module._load = previousLoad;
  }
}

test('profile exposes creator-only member management entry and route', () => {
  const appJson = JSON.parse(readProjectFile('miniprogram/app.json'));
  const miscPackage = appJson.subPackages.find((item) => item.root === 'pkg-misc');
  const profileSource = readProjectFile('miniprogram/pages/profile/index.js');

  assert.ok(miscPackage.pages.includes('member-management/index'));
  assert.match(profileSource, /name:\s*'成员管理'/);
  assert.match(profileSource, /path:\s*'\/pkg-misc\/member-management\/index'/);
  assert.match(profileSource, /showForCreator:\s*true/);
});

test('member management page formats participant names by remark, self name, then fallback', () => {
  const page = loadMemberManagementPage();

  assert.deepEqual(page.formatParticipantMember({
    _id: 'participant-1',
    _openid: 'openid-abcdef',
    creatorRemark: '爸爸备用机',
    displayName: '爸爸'
  }, 0), {
    _id: 'participant-1',
    displayName: '爸爸备用机',
    selfDisplayName: '爸爸',
    creatorRemark: '爸爸备用机',
    openidSuffix: 'abcdef',
    joinedAtText: '加入时间未记录'
  });
  assert.equal(page.formatParticipantMember({
    _id: 'participant-2',
    _openid: 'openid-222222',
    displayName: '妈妈'
  }, 1).displayName, '妈妈');
  assert.equal(page.formatParticipantMember({
    _id: 'participant-3',
    _openid: 'openid-333333'
  }, 2).displayName, '参与者3');
});

test('manageParticipants lists members only for the baby creator', async () => {
  const { db } = createDbMock({
    creators: [{ _id: 'creator-1', _openid: 'creator-openid', babyUid: 'baby-1' }],
    participants: [
      { _id: 'participant-1', _openid: 'participant-openid-1', babyUid: 'baby-1', displayName: '爸爸' },
      { _id: 'participant-2', _openid: 'participant-openid-2', babyUid: 'baby-2', displayName: '外婆' }
    ]
  });
  const fn = loadFunctionWithMockCloud(db, 'creator-openid');

  const result = await fn.main({ action: 'list', babyUid: 'baby-1' });

  assert.equal(result.ok, true);
  assert.equal(result.participants.length, 1);
  assert.equal(result.participants[0]._id, 'participant-1');
  assert.equal(result.participants[0].displayName, '爸爸');
  assert.equal(result.participants[0].openidSuffix, 'enid-1');
});

test('manageParticipants rejects remark updates from non-creators', async () => {
  const { db, writes } = createDbMock({
    creators: [{ _id: 'creator-1', _openid: 'creator-openid', babyUid: 'baby-1' }],
    participants: [{ _id: 'participant-1', _openid: 'participant-openid-1', babyUid: 'baby-1' }]
  });
  const fn = loadFunctionWithMockCloud(db, 'participant-openid-1');

  const result = await fn.main({
    action: 'updateRemark',
    babyUid: 'baby-1',
    participantId: 'participant-1',
    creatorRemark: '爸爸'
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /无权限/);
  assert.deepEqual(writes.updates, []);
});

test('manageParticipants lets creator update remark and remove a participant relation', async () => {
  const { db, writes, data } = createDbMock({
    creators: [{ _id: 'creator-1', _openid: 'creator-openid', babyUid: 'baby-1' }],
    participants: [{ _id: 'participant-1', _openid: 'participant-openid-1', babyUid: 'baby-1' }]
  });
  const fn = loadFunctionWithMockCloud(db, 'creator-openid');

  const remarkResult = await fn.main({
    action: 'updateRemark',
    babyUid: 'baby-1',
    participantId: 'participant-1',
    creatorRemark: '爸爸备用机'
  });
  assert.equal(remarkResult.ok, true);
  assert.equal(data.baby_participants[0].creatorRemark, '爸爸备用机');
  assert.equal(data.baby_participants[0].creatorRemarkUpdatedBy, 'creator-openid');

  const removeResult = await fn.main({
    action: 'remove',
    babyUid: 'baby-1',
    participantId: 'participant-1'
  });

  assert.equal(removeResult.ok, true);
  assert.equal(data.baby_participants.length, 0);
  assert.deepEqual(writes.removes, [{ collectionName: 'baby_participants', docId: 'participant-1' }]);
  assert.deepEqual(writes.adds, []);
});
