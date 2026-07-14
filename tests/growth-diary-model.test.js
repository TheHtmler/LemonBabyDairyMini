const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modelPath = path.resolve(__dirname, '../miniprogram/models/growthDiary.js');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function createDbMock(overrides = {}) {
  const writes = {
    adds: [],
    updates: [],
    queries: []
  };
  const dataByCollection = {
    growth_diary: (overrides.growthDiaryData || []).map((item) => ({ ...item }))
  };
  let nextId = 1;

  function queryFor(collectionName, whereInput = {}) {
    const chain = {
      _where: whereInput,
      _orderBy: null,
      _skip: 0,
      _limit: null,
      where(nextWhere) {
        this._where = { ...this._where, ...nextWhere };
        return this;
      },
      orderBy(field, direction) {
        this._orderBy = { field, direction };
        return this;
      },
      skip(count) {
        this._skip = Number(count) || 0;
        return this;
      },
      limit(count) {
        this._limit = Number(count);
        return this;
      },
      async get() {
        writes.queries.push({
          collectionName,
          where: { ...this._where },
          orderBy: this._orderBy,
          skip: this._skip,
          limit: this._limit
        });
        let data = (dataByCollection[collectionName] || []).filter((item) =>
          Object.entries(this._where || {}).every(([key, expected]) => item[key] === expected)
        );
        if (this._orderBy) {
          const { field, direction } = this._orderBy;
          data = [...data].sort((left, right) => {
            if (left[field] === right[field]) return 0;
            const result = left[field] > right[field] ? 1 : -1;
            return direction === 'desc' ? -result : result;
          });
        }
        if (this._skip) data = data.slice(this._skip);
        if (this._limit != null) data = data.slice(0, this._limit);
        return { data };
      }
    };
    return chain;
  }

  const db = {
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      return {
        where(whereInput) {
          return queryFor(name, whereInput);
        },
        doc(id) {
          return {
            async get() {
              const record = (dataByCollection[name] || []).find((item) => item._id === id) || null;
              return { data: record };
            },
            async update({ data }) {
              writes.updates.push({ collectionName: name, docId: id, data });
              const index = (dataByCollection[name] || []).findIndex((item) => item._id === id);
              if (index >= 0) {
                dataByCollection[name][index] = {
                  ...dataByCollection[name][index],
                  ...data
                };
              }
              return {};
            }
          };
        },
        async add({ data }) {
          const _id = `diary-${nextId++}`;
          const record = { ...data, _id };
          dataByCollection[name].push(record);
          writes.adds.push({ collectionName: name, data });
          return { _id };
        }
      };
    }
  };

  return { db, writes, dataByCollection };
}

function loadFreshModel(db, options = {}) {
  delete require.cache[modelPath];
  const previousWx = global.wx;
  global.wx = {
    cloud: {
      database() {
        return db;
      }
    }
  };

  try {
    const exported = require(modelPath);
    const GrowthDiaryModel = exported.GrowthDiaryModel;
    return new GrowthDiaryModel(options);
  } finally {
    global.wx = previousWx;
  }
}

test('growthDiary model uses growth_diary collection and active filter', () => {
  const source = readProjectFile('miniprogram/models/growthDiary.js');

  assert.match(source, /collection\('growth_diary'\)/);
  assert.match(source, /status:\s*'active'/);
  assert.match(source, /orderBy\('eventDate',\s*'desc'\)/);
  assert.match(source, /\.skip\(/);
  assert.match(source, /\.limit\(/);
  assert.match(source, /validateDiaryPayload/);
  assert.match(source, /canEditDiaryEntry/);
  assert.match(source, /normalizePhotos/);
  assert.match(source, /createdByOpenid/);
  assert.match(source, /deleteCloudFiles/);
  assert.match(source, /status:\s*'deleted'/);
});

test('listByBaby filters active entries and orders by eventDate desc', async () => {
  const { db, writes } = createDbMock({
    growthDiaryData: [
      { _id: 'd1', babyUid: 'baby-1', status: 'active', eventDate: '2026-01-01', title: 'A' },
      { _id: 'd2', babyUid: 'baby-1', status: 'deleted', eventDate: '2026-02-01', title: 'B' },
      { _id: 'd3', babyUid: 'baby-1', status: 'active', eventDate: '2026-03-01', title: 'C' },
      { _id: 'd4', babyUid: 'baby-2', status: 'active', eventDate: '2026-04-01', title: 'D' }
    ]
  });
  const model = loadFreshModel(db);

  const list = await model.listByBaby('baby-1');

  assert.equal(list.length, 2);
  assert.deepEqual(list.map((item) => item._id), ['d3', 'd1']);
  assert.deepEqual(writes.queries[0].where, { babyUid: 'baby-1', status: 'active' });
  assert.deepEqual(writes.queries[0].orderBy, { field: 'eventDate', direction: 'desc' });
});

test('listByBaby client-sorts when cloud date objects do not orderBy correctly', async () => {
  const { db } = createDbMock({
    growthDiaryData: [
      { _id: 'old', babyUid: 'baby-1', status: 'active', eventDate: '2025-10-04', title: '扶坐' },
      { _id: 'new', babyUid: 'baby-1', status: 'active', eventDate: '2026-01-03', title: '坐' },
      { _id: 'mid', babyUid: 'baby-1', status: 'active', eventDate: '2025-12-01', title: '中间' }
    ]
  });
  const model = loadFreshModel(db);
  const list = await model.listByBaby('baby-1');
  assert.deepEqual(list.map((item) => item._id), ['new', 'mid', 'old']);
});

test('create writes createdByOpenid photos and active status', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  const result = await model.create(
    'baby-1',
    {
      title: '会坐',
      eventDate: '2026-07-01',
      notes: '开心',
      photos: [{ originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1', width: 100, height: 80 }],
      authorDisplayName: '妈妈'
    },
    { openid: 'author-openid', authorDisplayName: '妈妈', userInfo: { nickName: '微信名' } }
  );

  assert.equal(result.success, true);
  assert.equal(writes.adds[0].collectionName, 'growth_diary');
  assert.equal(writes.adds[0].data.createdByOpenid, 'author-openid');
  assert.equal(writes.adds[0].data.status, 'active');
  assert.equal(writes.adds[0].data.authorDisplayName, '妈妈');
  assert.deepEqual(writes.adds[0].data.photos, [
    { originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1', width: 100, height: 80 }
  ]);
  assert.equal(writes.adds[0].data.userInfo.displayName, '妈妈');
  assert.equal(writes.adds[0].data.userInfo.nickName, '微信名');
});

test('update returns success false when canEditDiaryEntry is false', async () => {
  const { db, writes } = createDbMock({
    growthDiaryData: [
      {
        _id: 'd1',
        babyUid: 'baby-1',
        status: 'active',
        createdByOpenid: 'author-openid',
        title: '旧标题',
        eventDate: '2026-07-01',
        photos: []
      }
    ]
  });
  const model = loadFreshModel(db);

  const result = await model.update(
    'd1',
    'baby-1',
    { title: '新标题', eventDate: '2026-07-02', photos: [] },
    { openid: 'other-openid', isCreator: false }
  );

  assert.deepEqual(result, { success: false, message: '无权编辑该日记' });
  assert.equal(writes.updates.length, 0);
});

test('softDelete returns success false when canEditDiaryEntry is false', async () => {
  const { db, writes } = createDbMock({
    growthDiaryData: [
      {
        _id: 'd1',
        babyUid: 'baby-1',
        status: 'active',
        createdByOpenid: 'author-openid',
        title: '标题',
        eventDate: '2026-07-01',
        photos: [{ originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1' }]
      }
    ]
  });
  const deletedFiles = [];
  const model = loadFreshModel(db, {
    deleteCloudFiles: async (fileIds) => {
      deletedFiles.push(...fileIds);
    }
  });

  const result = await model.softDelete('d1', 'baby-1', { openid: 'other-openid', isCreator: false });

  assert.deepEqual(result, { success: false, message: '无权删除该日记' });
  assert.equal(writes.updates.length, 0);
  assert.deepEqual(deletedFiles, []);
});

test('update deletes replaced photo file ids after successful save', async () => {
  const { db } = createDbMock({
    growthDiaryData: [
      {
        _id: 'd1',
        babyUid: 'baby-1',
        status: 'active',
        createdByOpenid: 'author-openid',
        title: '标题',
        eventDate: '2026-07-01',
        photos: [
          { originalFileId: 'cloud://old-o1', thumbFileId: 'cloud://old-t1' },
          { originalFileId: 'cloud://keep-o', thumbFileId: 'cloud://keep-t' }
        ]
      }
    ]
  });
  const deletedFiles = [];
  const model = loadFreshModel(db, {
    deleteCloudFiles: async (fileIds) => {
      deletedFiles.push(...fileIds);
    }
  });

  const result = await model.update(
    'd1',
    'baby-1',
    {
      title: '新标题',
      eventDate: '2026-07-01',
      photos: [{ originalFileId: 'cloud://new-o', thumbFileId: 'cloud://new-t' }]
    },
    { openid: 'author-openid' }
  );

  assert.equal(result.success, true);
  assert.deepEqual(deletedFiles.sort(), [
    'cloud://keep-o',
    'cloud://keep-t',
    'cloud://old-o1',
    'cloud://old-t1'
  ].sort());
});

test('softDelete marks deleted and cleans up photo files', async () => {
  const { db, writes, dataByCollection } = createDbMock({
    growthDiaryData: [
      {
        _id: 'd1',
        babyUid: 'baby-1',
        status: 'active',
        createdByOpenid: 'author-openid',
        title: '标题',
        eventDate: '2026-07-01',
        photos: [{ originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1' }]
      }
    ]
  });
  const deletedFiles = [];
  const model = loadFreshModel(db, {
    deleteCloudFiles: async (fileIds) => {
      deletedFiles.push(...fileIds);
    }
  });

  const result = await model.softDelete('d1', 'baby-1', { openid: 'author-openid' });

  assert.equal(result.success, true);
  assert.equal(writes.updates[0].data.status, 'deleted');
  assert.equal(dataByCollection.growth_diary[0].status, 'deleted');
  assert.deepEqual(deletedFiles, ['cloud://o1', 'cloud://t1']);
});
