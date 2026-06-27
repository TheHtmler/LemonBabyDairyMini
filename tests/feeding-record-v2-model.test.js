const test = require('node:test');
const assert = require('node:assert/strict');

function createDbMock(overrides = {}) {
  const writes = {
    addCollection: '',
    addData: null,
    adds: [],
    updateCollection: '',
    updateDocId: '',
    updateData: null,
    updates: [],
    removeCollection: '',
    removeDocId: '',
    collectionReads: [],
    touchedLegacyFeedingRecordsForWrite: false
  };
  const dataByCollection = {
    growth_records_v2: overrides.growthRecordsV2Data || [],
    feeding_records_v2: overrides.v2Data || [],
    feeding_records: overrides.legacyData || [],
    baby_info: overrides.babyInfoData || [],
    daily_summary_v2: overrides.dailySummaryV2Data || []
  };

  function queryFor(collectionName, whereInput = {}) {
    const chain = {
      _where: whereInput,
      _orderBy: null,
      where(nextWhere) {
        this._where = {
          ...this._where,
          ...nextWhere
        };
        return this;
      },
      orderBy(field, direction) {
        this._orderBy = { field, direction };
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        writes.collectionReads.push(collectionName);
        if ((overrides.failCollections || []).includes(collectionName)) {
          const error = new Error(`collection ${collectionName} does not exist`);
          error.errCode = -502005;
          throw error;
        }
        let data = (dataByCollection[collectionName] || []).filter((item) => {
          return Object.entries(this._where || {}).every(([key, expected]) => {
            if (expected && expected.__op === 'lt') {
              return item[key] < expected.value;
            }
            if (expected && expected.__op === 'gt') {
              return item[key] > expected.value;
            }
            return item[key] === expected;
          });
        });
        if (this._orderBy) {
          const { field, direction } = this._orderBy;
          data = [...data].sort((left, right) => {
            if (left[field] === right[field]) return 0;
            const result = left[field] > right[field] ? 1 : -1;
            return direction === 'desc' ? -result : result;
          });
        }
        return { data };
      }
    };
    return chain;
  }

  const db = {
    command: {
      lt(value) {
        return { __op: 'lt', value };
      },
      gt(value) {
        return { __op: 'gt', value };
      }
    },
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
              writes.collectionReads.push(name);
              const record = (dataByCollection[name] || [])
                .find((item) => (item._id || item.id) === id) || null;
              return { data: record };
            },
            async update({ data }) {
              writes.updateCollection = name;
              writes.updateDocId = id;
              writes.updateData = data;
              writes.updates.push({ collectionName: name, docId: id, data });
              if (name === 'feeding_records') {
                writes.touchedLegacyFeedingRecordsForWrite = true;
              }
              return {};
            },
            async remove() {
              writes.removeCollection = name;
              writes.removeDocId = id;
              if (name === 'feeding_records') {
                writes.touchedLegacyFeedingRecordsForWrite = true;
              }
              return {};
            }
          };
        },
        async add({ data }) {
          writes.addCollection = name;
          writes.addData = data;
          writes.adds.push({ collectionName: name, data });
          if ((overrides.failCollections || []).includes(name)) {
            const error = new Error(`collection ${name} does not exist`);
            error.errCode = -502005;
            throw error;
          }
          if (name === 'feeding_records') {
            writes.touchedLegacyFeedingRecordsForWrite = true;
          }
          return { _id: 'v2-record-1' };
        }
      };
    }
  };

  return { db, writes };
}

function loadFreshModel(db) {
  const modelPath = require.resolve('../miniprogram/models/feedingRecordV2.js');
  // 同时清掉 dailySummaryV2 缓存：它在加载时绑定 wx.cloud.database()，
  // 必须让它和本次 feeding 模型用同一个 mock db，失效写入才会落到同一份 mock 集合。
  const summaryModelPath = require.resolve('../miniprogram/models/dailySummaryV2.js');
  delete require.cache[modelPath];
  delete require.cache[summaryModelPath];

  const previousWx = global.wx;
  global.wx = {
    cloud: {
      database() {
        return db;
      }
    }
  };

  try {
    return require(modelPath);
  } finally {
    global.wx = previousWx;
  }
}

test('addRecord writes an active milk feeding document to feeding_records_v2 only', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  const result = await model.addRecord({
    babyUid: 'baby-1',
    operatorOpenid: 'openid-creator',
    date: '2026-05-20',
    startTime: '08:30',
    formulaComponents: [],
    nutritionSummary: {
      calories: 0
    }
  });

  assert.equal(result._id, 'v2-record-1');
  assert.equal(writes.addCollection, 'feeding_records_v2');
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
  assert.equal(writes.addData.schemaVersion, 1);
  assert.equal(writes.addData.recordType, 'milk_feeding');
  assert.equal(writes.addData.source, 'milk_feeding_v2');
  assert.equal(writes.addData.status, 'active');
  assert.equal(writes.addData.createdAt, '__server_date__');
  assert.equal(writes.addData.updatedAt, '__server_date__');
  assert.equal(writes.addData.deletedAt, null);
  assert.equal(writes.addData.createdBy, 'openid-creator');
  assert.equal(writes.addData.updatedBy, 'openid-creator');
  assert.equal(writes.addData.deletedBy, '');
});

test('updateRecord preserves original createdAt and updates updatedAt', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.updateRecord('record-1', {
    startTime: '09:00',
    createdAt: 'should-not-overwrite',
    createdBy: 'should-not-overwrite',
    operatorOpenid: 'openid-editor'
  });

  assert.equal(writes.updateCollection, 'feeding_records_v2');
  assert.equal(writes.updateDocId, 'record-1');
  assert.equal(writes.updateData.startTime, '09:00');
  assert.equal(writes.updateData.createdAt, undefined);
  assert.equal(writes.updateData.createdBy, undefined);
  assert.equal(writes.updateData.operatorOpenid, undefined);
  assert.equal(writes.updateData.updatedAt, '__server_date__');
  assert.equal(writes.updateData.updatedBy, 'openid-editor');
});

test('deleteRecord hard deletes a v2 feeding record and writes an audit log', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.deleteRecord('record-1', {
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter'
  });

  assert.equal(writes.removeCollection, 'feeding_records_v2');
  assert.equal(writes.removeDocId, 'record-1');
  assert.equal(writes.updateCollection, '');
  assert.deepEqual(writes.adds.find(item => item.collectionName === 'audit_logs')?.data, {
    schemaVersion: 1,
    recordType: 'audit_log',
    action: 'delete',
    collection: 'feeding_records_v2',
    recordId: 'record-1',
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter',
    status: 'active',
    createdAt: '__server_date__'
  });
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
});

test('upsertGrowthRecordForDate creates a v2 growth record without touching legacy records', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.upsertGrowthRecordForDate('baby-1', '2026-05-21', {
    operatorOpenid: 'openid-creator',
    weight: 5.2,
    height: 58
  });

  assert.equal(writes.addCollection, 'growth_records_v2');
  assert.equal(writes.addData.babyUid, 'baby-1');
  assert.equal(writes.addData.date, '2026-05-21');
  assert.equal(writes.addData.weight, 5.2);
  assert.equal(writes.addData.height, 58);
  assert.equal(writes.addData.headCircumference, '');
  assert.equal(writes.addData.notes, '');
  assert.equal(writes.addData.changes, '');
  assert.equal(writes.addData.status, 'active');
  assert.equal(writes.addData.source, 'data_records_v2');
  assert.equal(writes.addData.schemaVersion, 1);
  assert.equal(writes.addData.createdBy, 'openid-creator');
  assert.equal(writes.addData.updatedBy, 'openid-creator');
  assert.equal(writes.addData.deletedAt, null);
  assert.equal(writes.addData.deletedBy, '');
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
});

test('upsertGrowthRecordForDate persists protein and calorie coefficients on add', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.upsertGrowthRecordForDate('baby-1', '2026-05-22', {
    operatorOpenid: 'openid-creator',
    weight: 5.3,
    height: 59,
    naturalProteinCoefficient: 1.2,
    specialProteinCoefficient: 0.9,
    calorieCoefficient: 100
  });

  assert.equal(writes.addCollection, 'growth_records_v2');
  assert.equal(writes.addData.weight, 5.3);
  assert.equal(writes.addData.height, 59);
  assert.equal(writes.addData.naturalProteinCoefficient, 1.2);
  assert.equal(writes.addData.specialProteinCoefficient, 0.9);
  assert.equal(writes.addData.calorieCoefficient, 100);
});

test('upsertGrowthRecordForDate updates coefficients without wiping existing ones on partial weight update', async () => {
  const { db, writes } = createDbMock({
    growthRecordsV2Data: [
      {
        _id: 'growth-1',
        babyUid: 'baby-1',
        date: '2026-05-22',
        status: 'active',
        weight: 5.1,
        height: 58,
        naturalProteinCoefficient: 1.2
      }
    ]
  });
  const model = loadFreshModel(db);

  // 只更新体重，且未携带系数：不应把系数键写成空覆盖。
  await model.upsertGrowthRecordForDate('baby-1', '2026-05-22', {
    operatorOpenid: 'openid-editor',
    weight: 5.4,
    height: 58
  });

  assert.equal(writes.updateCollection, 'growth_records_v2');
  assert.equal(writes.updateDocId, 'growth-1');
  assert.equal(writes.updateData.weight, 5.4);
  assert.equal(Object.prototype.hasOwnProperty.call(writes.updateData, 'naturalProteinCoefficient'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(writes.updateData, 'specialProteinCoefficient'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(writes.updateData, 'calorieCoefficient'), false);
});

test('upsertGrowthRecordForDate propagates changed weight until the next explicit different weight', async () => {
  const { db, writes } = createDbMock({
    growthRecordsV2Data: [
      {
        _id: 'growth-a',
        babyUid: 'baby-1',
        date: '2026-06-01',
        status: 'active',
        source: 'data_records_v2',
        weight: 5.0
      },
      {
        _id: 'growth-carry',
        babyUid: 'baby-1',
        date: '2026-06-02',
        status: 'active',
        source: 'daily_record_v2_carry_forward',
        weight: 5.0
      },
      {
        _id: 'growth-b',
        babyUid: 'baby-1',
        date: '2026-06-03',
        status: 'active',
        source: 'data_records_v2',
        weight: 6.0
      },
      {
        _id: 'growth-after-b',
        babyUid: 'baby-1',
        date: '2026-06-04',
        status: 'active',
        source: 'daily_record_v2_carry_forward',
        weight: 6.0
      }
    ],
    dailySummaryV2Data: [
      { _id: 'summary-a', babyUid: 'baby-1', date: '2026-06-01', status: 'active' },
      { _id: 'summary-carry', babyUid: 'baby-1', date: '2026-06-02', status: 'active' },
      { _id: 'summary-b', babyUid: 'baby-1', date: '2026-06-03', status: 'active' }
    ]
  });
  const model = loadFreshModel(db);

  await model.upsertGrowthRecordForDate('baby-1', '2026-06-01', {
    operatorOpenid: 'openid-editor',
    weight: 5.5
  });

  const growthUpdates = writes.updates.filter(update => update.collectionName === 'growth_records_v2');
  assert.equal(growthUpdates.find(update => update.docId === 'growth-a').data.weight, 5.5);
  assert.equal(growthUpdates.find(update => update.docId === 'growth-carry').data.weight, 5.5);
  assert.equal(growthUpdates.some(update => update.docId === 'growth-b'), false);
  assert.equal(growthUpdates.some(update => update.docId === 'growth-after-b'), false);

  const dirtySummaryIds = writes.updates
    .filter(update => update.collectionName === 'daily_summary_v2')
    .map(update => update.docId);
  assert.ok(dirtySummaryIds.includes('summary-a'));
  assert.ok(dirtySummaryIds.includes('summary-carry'));
  assert.equal(dirtySummaryIds.includes('summary-b'), false);
});

test('upsertGrowthRecordForDate propagates newly inserted weight over previous carried future dates', async () => {
  const { db, writes } = createDbMock({
    growthRecordsV2Data: [
      {
        _id: 'growth-prev',
        babyUid: 'baby-1',
        date: '2026-05-31',
        status: 'active',
        source: 'data_records_v2',
        weight: 5.0
      },
      {
        _id: 'growth-carry',
        babyUid: 'baby-1',
        date: '2026-06-02',
        status: 'active',
        source: 'daily_record_v2_carry_forward',
        weight: 5.0
      },
      {
        _id: 'growth-b',
        babyUid: 'baby-1',
        date: '2026-06-03',
        status: 'active',
        source: 'data_records_v2',
        weight: 6.0
      }
    ],
    dailySummaryV2Data: [
      { _id: 'summary-carry', babyUid: 'baby-1', date: '2026-06-02', status: 'active' }
    ]
  });
  const model = loadFreshModel(db);

  await model.upsertGrowthRecordForDate('baby-1', '2026-06-01', {
    operatorOpenid: 'openid-editor',
    weight: 5.5
  });

  assert.equal(writes.addCollection, 'growth_records_v2');
  assert.equal(writes.addData.date, '2026-06-01');
  assert.equal(writes.addData.weight, 5.5);

  const growthUpdates = writes.updates.filter(update => update.collectionName === 'growth_records_v2');
  assert.equal(growthUpdates.find(update => update.docId === 'growth-carry').data.weight, 5.5);
  assert.equal(growthUpdates.some(update => update.docId === 'growth-b'), false);

  const dirtySummaryIds = writes.updates
    .filter(update => update.collectionName === 'daily_summary_v2')
    .map(update => update.docId);
  assert.ok(dirtySummaryIds.includes('summary-carry'));
});

test('getRecordsByDate ignores v2 daily basic info documents in the feeding list', async () => {
  const { db } = createDbMock({
    v2Data: [
      {
        _id: 'daily-basic-1',
        babyUid: 'baby-1',
        date: '2026-05-20',
        status: 'active',
        recordType: 'daily_basic_info',
        basicInfoSnapshot: {
          weight: 5.4,
          height: 59
        }
      },
      {
        _id: 'feeding-1',
        babyUid: 'baby-1',
        date: '2026-05-20',
        status: 'active',
        recordType: 'milk_feeding',
        startTime: '08:00',
        formulaComponents: []
      }
    ]
  });
  const model = loadFreshModel(db);

  const records = await model.getRecordsByDate('baby-1', '2026-05-20');

  assert.deepEqual(records.map((record) => record.id), ['feeding-1']);
});

test('getRecordsByDate returns only active v2 records for the date in reverse chronological order', async () => {
  const { db } = createDbMock({
    v2Data: [
      { _id: 'archived', babyUid: 'baby-1', date: '2026-05-20', status: 'archived', startTime: '07:00' },
      { _id: 'active-2', babyUid: 'baby-1', date: '2026-05-20', status: 'active', startTime: '09:00' },
      { _id: 'active-1', babyUid: 'baby-1', date: '2026-05-20', status: 'active', startTime: '08:00' }
    ]
  });
  const model = loadFreshModel(db);

  const records = await model.getRecordsByDate('baby-1', '2026-05-20');

  assert.deepEqual(records.map((record) => record.id), ['active-2', 'active-1']);
});

test('getRecentDayMealCount counts feeding meals on the most recent prior day', async () => {
  const { db } = createDbMock({
    v2Data: [
      { _id: 'm1', babyUid: 'baby-1', date: '2026-05-19', status: 'active', recordType: 'milk_feeding', startTime: '07:00' },
      { _id: 'm2', babyUid: 'baby-1', date: '2026-05-19', status: 'active', recordType: 'milk_feeding', startTime: '11:00' },
      { _id: 'a', babyUid: 'baby-1', date: '2026-05-20', status: 'active', recordType: 'milk_feeding', startTime: '08:00' },
      { _id: 'b', babyUid: 'baby-1', date: '2026-05-20', status: 'active', recordType: 'milk_feeding', startTime: '12:00' },
      { _id: 'c', babyUid: 'baby-1', date: '2026-05-20', status: 'active', recordType: 'milk_feeding', startTime: '16:00' },
      { _id: 'daily', babyUid: 'baby-1', date: '2026-05-20', status: 'active', recordType: 'daily_basic_info', startTime: '00:00' }
    ]
  });
  const model = loadFreshModel(db);

  // 目标日 2026-05-21 当天无记录，应取最近一天 2026-05-20 的喂奶顿数（排除 daily_basic_info）。
  const count = await model.getRecentDayMealCount('baby-1', '2026-05-21');

  assert.equal(count, 3);
});

test('getRecentDayMealCount returns 0 when there is no prior feeding history', async () => {
  const { db } = createDbMock({ v2Data: [] });
  const model = loadFreshModel(db);

  const count = await model.getRecentDayMealCount('baby-1', '2026-05-21');

  assert.equal(count, 0);
});

test('resolveBasicInfoSnapshot prefers same-day v2 snapshot', async () => {
  const { db } = createDbMock({
    v2Data: [
      {
        _id: 'record-1',
        babyUid: 'baby-1',
        date: '2026-05-20',
        status: 'active',
        basicInfoSnapshot: {
          weight: 5.2,
          height: 58
        }
      }
    ],
    legacyData: [
      {
        babyUid: 'baby-1',
        date: '2026-05-20',
        basicInfo: {
          weight: 4.9
        }
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-20', {
    includeFallbacks: true
  });

  assert.equal(snapshot.weight, 5.2);
  assert.equal(snapshot.height, 58);
  assert.equal(snapshot.source, 'v2_record');
});

test('resolveBasicInfoSnapshot prefers same-day v2 growth record over feeding snapshots', async () => {
  const { db } = createDbMock({
    growthRecordsV2Data: [
      {
        _id: 'growth-1',
        babyUid: 'baby-1',
        date: '2026-05-21',
        status: 'active',
        weight: 5.6,
        height: 60
      }
    ],
    v2Data: [
      {
        _id: 'record-1',
        babyUid: 'baby-1',
        date: '2026-05-21',
        status: 'active',
        basicInfoSnapshot: {
          weight: 5.2,
          height: 58
        }
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-21', {
    includeFallbacks: false
  });

  assert.equal(snapshot.weight, 5.6);
  assert.equal(snapshot.height, 60);
  assert.equal(snapshot.source, 'v2_growth_record');
});

test('resolveBasicInfoSnapshot defaults to latest previous v2 growth record for a new day', async () => {
  const { db } = createDbMock({
    growthRecordsV2Data: [
      {
        _id: 'growth-old',
        babyUid: 'baby-1',
        date: '2026-05-19',
        status: 'active',
        weight: 5.1,
        height: 57
      },
      {
        _id: 'growth-latest',
        babyUid: 'baby-1',
        date: '2026-05-20',
        status: 'active',
        weight: 5.4,
        height: 59
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-21', {
    includeFallbacks: false
  });

  assert.equal(snapshot.weight, 5.4);
  assert.equal(snapshot.height, 59);
  assert.equal(snapshot.source, 'v2_growth_record');
});

test('resolveBasicInfoSnapshot can fill missing same-day growth fields from the latest previous growth record', async () => {
  const { db } = createDbMock({
    growthRecordsV2Data: [
      {
        _id: 'growth-old',
        babyUid: 'baby-1',
        date: '2026-05-19',
        status: 'active',
        weight: 5.1,
        height: 57,
        naturalProteinCoefficient: 1.2
      },
      {
        _id: 'growth-today',
        babyUid: 'baby-1',
        date: '2026-05-21',
        status: 'active',
        weight: 5.5,
        height: ''
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-21', {
    includeFallbacks: false,
    carryForwardMissing: true
  });

  assert.equal(snapshot.weight, 5.5);
  assert.equal(snapshot.height, 57);
  assert.equal(snapshot.naturalProteinCoefficient, 1.2);
  assert.equal(snapshot.source, 'v2_growth_record');
});

test('resolveBasicInfoSnapshot continues with v2 feeding snapshots when the v2 growth collection is missing', async () => {
  const { db, writes } = createDbMock({
    failCollections: ['growth_records_v2'],
    v2Data: [
      {
        _id: 'record-1',
        babyUid: 'baby-1',
        date: '2026-05-21',
        status: 'active',
        basicInfoSnapshot: {
          weight: 5.2,
          height: 58
        }
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-21', {
    includeFallbacks: false
  });

  assert.equal(writes.collectionReads.includes('growth_records_v2'), true);
  assert.equal(snapshot.weight, 5.2);
  assert.equal(snapshot.height, 58);
  assert.equal(snapshot.source, 'v2_record');
});

test('resolveBasicInfoSnapshot can use baby_info only as an explicit initial profile seed', async () => {
  const { db, writes } = createDbMock({
    legacyData: [
      {
        babyUid: 'baby-1',
        date: '2026-05-20',
        basicInfo: {
          weight: 4.9,
          height: 56
        }
      }
    ],
    babyInfoData: [
      {
        babyUid: 'baby-1',
        weight: 5,
        height: 57
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-21', {
    includeFallbacks: false,
    includeProfileInitial: true
  });

  assert.equal(snapshot.weight, 5);
  assert.equal(snapshot.height, 57);
  assert.equal(snapshot.source, 'baby_info_initial');
  assert.equal(writes.collectionReads.includes('feeding_records'), false);
});

test('resolveBasicInfoSnapshot can fall back to legacy basic info without writing legacy records', async () => {
  const { db, writes } = createDbMock({
    legacyData: [
      {
        babyUid: 'baby-1',
        date: '2026-05-19',
        basicInfo: {
          weight: 5.1,
          height: 57,
          calorieCoefficient: 100
        }
      }
    ],
    babyInfoData: [
      {
        babyUid: 'baby-1',
        weight: 4.8,
        height: 56
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-20', {
    includeFallbacks: true
  });

  assert.equal(snapshot.weight, 5.1);
  assert.equal(snapshot.height, 57);
  assert.equal(snapshot.calorieCoefficient, 100);
  assert.equal(snapshot.source, 'legacy_record');
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
});

test('resolveBasicInfoSnapshot can disable legacy and baby_info fallbacks for isolated v2 pages', async () => {
  const { db } = createDbMock({
    legacyData: [
      {
        babyUid: 'baby-1',
        date: '2026-05-19',
        basicInfo: {
          weight: 5.1,
          height: 57
        }
      }
    ],
    babyInfoData: [
      {
        babyUid: 'baby-1',
        weight: 4.8,
        height: 56
      }
    ]
  });
  const model = loadFreshModel(db);

  const snapshot = await model.resolveBasicInfoSnapshot('baby-1', '2026-05-20', {
    includeFallbacks: false
  });

  assert.equal(snapshot.weight, '');
  assert.equal(snapshot.height, '');
  assert.equal(snapshot.source, 'empty');
});

test('addRecord 自动让当天 daily_summary_v2 失效（写必脏，收口在模型层）', async () => {
  const { db, writes } = createDbMock({
    dailySummaryV2Data: [
      { _id: 'sum-531', babyUid: 'baby-1', date: '2026-05-31', status: 'active', isDirty: false }
    ]
  });
  const model = loadFreshModel(db);

  await model.addRecord({
    babyUid: 'baby-1',
    date: '2026-05-31',
    startTime: '08:00',
    formulaComponents: [],
    nutritionSummary: { calories: 0 }
  });

  assert.equal(writes.updateCollection, 'daily_summary_v2');
  assert.equal(writes.updateDocId, 'sum-531');
  assert.equal(writes.updateData.isDirty, true);
});

test('deleteRecord 按被删记录的真实归属日失效，无需调用方传日期', async () => {
  const { db, writes } = createDbMock({
    v2Data: [
      {
        _id: 'feed-1',
        babyUid: 'baby-1',
        date: '2026-05-31',
        status: 'active',
        recordType: 'milk_feeding',
        startTime: '08:00',
        formulaComponents: []
      }
    ],
    dailySummaryV2Data: [
      { _id: 'sum-531', babyUid: 'baby-1', date: '2026-05-31', status: 'active', isDirty: false }
    ]
  });
  const model = loadFreshModel(db);

  await model.deleteRecord('feed-1', { babyUid: 'baby-1' });

  assert.equal(writes.removeCollection, 'feeding_records_v2');
  assert.equal(writes.updateCollection, 'daily_summary_v2');
  assert.equal(writes.updateDocId, 'sum-531');
  assert.equal(writes.updateData.isDirty, true);
});

test('updateRecord 改归属日时旧日期与新日期都失效', async () => {
  const { db, writes } = createDbMock({
    v2Data: [
      {
        _id: 'feed-1',
        babyUid: 'baby-1',
        date: '2026-05-30',
        status: 'active',
        recordType: 'milk_feeding',
        startTime: '08:00',
        formulaComponents: []
      }
    ],
    dailySummaryV2Data: [
      { _id: 'sum-530', babyUid: 'baby-1', date: '2026-05-30', status: 'active', isDirty: false },
      { _id: 'sum-531', babyUid: 'baby-1', date: '2026-05-31', status: 'active', isDirty: false }
    ]
  });
  const model = loadFreshModel(db);

  await model.updateRecord('feed-1', { babyUid: 'baby-1', date: '2026-05-31', startTime: '09:00' });

  // 旧日 5/30 与新日 5/31 应分别被标脏。
  const dirtiedSummaryDocIds = writes.updates
    .filter((item) => item.collectionName === 'daily_summary_v2' && item.data.isDirty === true)
    .map((item) => item.docId);
  assert.ok(dirtiedSummaryDocIds.includes('sum-530'), '旧归属日 5/30 应被标脏');
  assert.ok(dirtiedSummaryDocIds.includes('sum-531'), '新归属日 5/31 应被标脏');
});
