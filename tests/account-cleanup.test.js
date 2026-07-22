const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const functionPath = path.join('cloudfunctions', 'accountCleanup', 'index.js');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function matchesQuery(item, query = {}) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

function createDbMock(initialData = {}) {
  const data = Object.fromEntries(
    Object.entries(initialData).map(([name, rows]) => [name, rows.map((item) => ({ ...item }))])
  );
  const writes = {
    removes: [],
    gets: []
  };

  const db = {
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      if (!data[name]) data[name] = [];
      return {
        where(query) {
          return {
            limit() {
              return this;
            },
            async get() {
              writes.gets.push({ collectionName: name, query });
              return {
                data: data[name].filter((item) => matchesQuery(item, query))
              };
            },
            async remove() {
              const before = data[name].length;
              data[name] = data[name].filter((item) => !matchesQuery(item, query));
              writes.removes.push({ collectionName: name, query });
              return { stats: { removed: before - data[name].length } };
            }
          };
        }
      };
    }
  };

  return { db, data, writes };
}

function loadFunctionWithMockCloud({ db, openid, deletedFiles = [] }) {
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
        },
        async deleteFile({ fileList }) {
          deletedFiles.push(...(fileList || []));
          return { fileList: (fileList || []).map((fileID) => ({ fileID, status: 0 })) };
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

test('accountCleanup lets creator hard delete baby scoped data and relations', async () => {
  const babyScopedCollections = [
    'baby_info',
    'baby_creators',
    'baby_participants',
    'feeding_records',
    'feeding_records_v2',
    'food_intake_records',
    'medication_records',
    'treatment_records',
    'bowel_records',
    'water_records',
    'growth_records',
    'growth_records_v2',
    'growth_milestones',
    'growth_diary',
    'medications',
    'nutrition_settings',
    'milk_nutrition_profiles',
    'daily_summary_v2',
    'participant_unbind_logs',
    'audit_logs'
  ];
  const initialData = Object.fromEntries(babyScopedCollections.map((name) => ([
    name,
    [
      {
        _id: `${name}-baby-1`,
        babyUid: 'baby-1',
        _openid: name === 'baby_creators' ? 'creator-openid' : 'other-openid',
        avatarFileId: name === 'baby_info' ? 'cloud://avatar-file' : undefined
      },
      {
        _id: `${name}-baby-2`,
        babyUid: 'baby-2',
        _openid: 'other-openid'
      }
    ]
  ])));
  const { db, data, writes } = createDbMock(initialData);
  const deletedFiles = [];
  const fn = loadFunctionWithMockCloud({ db, openid: 'creator-openid', deletedFiles });

  const result = await fn.main({ action: 'cancelCreatorAccount', babyUid: 'baby-1' });

  assert.equal(result.ok, true);
  for (const collectionName of babyScopedCollections) {
    assert.deepEqual(
      data[collectionName].map((item) => item.babyUid),
      ['baby-2'],
      `${collectionName} should only keep other baby rows`
    );
  }
  assert.ok(writes.removes.some((item) => item.collectionName === 'baby_creators' && item.query.babyUid === 'baby-1'));
  assert.deepEqual(deletedFiles, ['cloud://avatar-file']);
});

test('accountCleanup rejects creator cancellation from non-creator', async () => {
  const { db, data, writes } = createDbMock({
    baby_creators: [{ _id: 'creator-1', _openid: 'creator-openid', babyUid: 'baby-1' }],
    baby_info: [{ _id: 'baby-info-1', babyUid: 'baby-1' }]
  });
  const fn = loadFunctionWithMockCloud({ db, openid: 'participant-openid' });

  const result = await fn.main({ action: 'cancelCreatorAccount', babyUid: 'baby-1' });

  assert.equal(result.ok, false);
  assert.match(result.message, /无权限|创建者/);
  assert.equal(data.baby_info.length, 1);
  assert.deepEqual(writes.removes, []);
});

test('accountCleanup unbinds only current participant relation', async () => {
  const { db, data, writes } = createDbMock({
    baby_participants: [
      { _id: 'participant-1', _openid: 'participant-openid', babyUid: 'baby-1' },
      { _id: 'participant-2', _openid: 'other-participant', babyUid: 'baby-1' }
    ],
    baby_info: [{ _id: 'baby-info-1', babyUid: 'baby-1' }],
    feeding_records_v2: [{ _id: 'feeding-1', babyUid: 'baby-1' }]
  });
  const fn = loadFunctionWithMockCloud({ db, openid: 'participant-openid' });

  const result = await fn.main({ action: 'unbindParticipant', babyUid: 'baby-1' });

  assert.equal(result.ok, true);
  assert.deepEqual(data.baby_participants.map((item) => item._id), ['participant-2']);
  assert.equal(data.baby_info.length, 1);
  assert.equal(data.feeding_records_v2.length, 1);
  assert.deepEqual(writes.removes, [
    {
      collectionName: 'baby_participants',
      query: { babyUid: 'baby-1', _openid: 'participant-openid' }
    }
  ]);
});

test('profile uses role-specific account action copy and double confirmation for creators', () => {
  const source = readProjectFile('miniprogram/pages/profile/index.js');

  assert.match(source, /name:\s*'注销账号'/);
  assert.match(source, /name:\s*'解绑'/);
  assert.match(source, /cancelCreatorAccount/);
  assert.match(source, /unbindParticipant/);
  assert.match(source, /editable:\s*true/);
  assert.match(source, /确认注销/);
  assert.doesNotMatch(source, /content:\s*`请输入“\$\{CREATOR_CANCEL_CONFIRM_TEXT\}”完成注销`/);
  assert.match(source, /placeholderText:\s*`请输入：\$\{CREATOR_CANCEL_CONFIRM_TEXT\}`/);
});
