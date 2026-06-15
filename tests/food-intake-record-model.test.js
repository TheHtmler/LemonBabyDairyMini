const test = require('node:test');
const assert = require('node:assert/strict');

function readPathValue(record = {}, path = '') {
  return String(path).split('.').reduce((value, key) => (
    value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
  ), record);
}

function createDbMock(overrides = {}) {
  const writes = {
    adds: [],
    updates: [],
    removes: [],
    reads: []
  };
  const dataByCollection = {
    food_intake_records: overrides.foodIntakeRecords || [],
    audit_logs: []
  };

  function matchesWhere(record = {}, whereInput = {}) {
    return Object.entries(whereInput || {}).every(([key, expected]) => (
      readPathValue(record, key) === expected
    ));
  }

  function queryFor(collectionName, whereInput = {}) {
    const chain = {
      _where: whereInput,
      _orderBy: null,
      _limit: 0,
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
      limit(value) {
        this._limit = value;
        return this;
      },
      async get() {
        writes.reads.push({ collectionName, where: this._where, orderBy: this._orderBy, limit: this._limit });
        let data = (dataByCollection[collectionName] || []).filter((item) => matchesWhere(item, this._where));
        if (this._orderBy) {
          const { field, direction } = this._orderBy;
          data = [...data].sort((left, right) => {
            const leftValue = readPathValue(left, field);
            const rightValue = readPathValue(right, field);
            if (leftValue === rightValue) return 0;
            const result = leftValue > rightValue ? 1 : -1;
            return direction === 'desc' ? -result : result;
          });
        }
        if (this._limit > 0) {
          data = data.slice(0, this._limit);
        }
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
            async update({ data }) {
              writes.updates.push({ collectionName: name, docId: id, data });
              return {};
            },
            async remove() {
              writes.removes.push({ collectionName: name, docId: id });
              return {};
            }
          };
        },
        async add({ data }) {
          const id = `new-food-${writes.adds.length + 1}`;
          writes.adds.push({ collectionName: name, data });
          return { _id: id };
        }
      };
    }
  };

  return { db, writes };
}

function loadFreshModel(db) {
  const modelPath = require.resolve('../miniprogram/models/foodIntakeRecord.js');
  const auditLogPath = require.resolve('../miniprogram/models/auditLog.js');
  delete require.cache[modelPath];
  delete require.cache[auditLogPath];

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

test('findByMealBatch returns active records for one meal sorted by sortOrder', async () => {
  const { db } = createDbMock({
    foodIntakeRecords: [
      { _id: 'food-2', babyUid: 'baby-1', date: '2026-06-15', mealBatchId: 'meal-a', status: 'active', sortOrder: 2, foodName: '苹果泥' },
      { _id: 'food-deleted', babyUid: 'baby-1', date: '2026-06-15', mealBatchId: 'meal-a', status: 'deleted', sortOrder: 1, foodName: '旧米粉' },
      { _id: 'food-1', babyUid: 'baby-1', date: '2026-06-15', mealBatchId: 'meal-a', status: 'active', sortOrder: 1, foodName: '米粉' },
      { _id: 'food-other', babyUid: 'baby-1', date: '2026-06-15', mealBatchId: 'meal-b', status: 'active', sortOrder: 0, foodName: '南瓜' }
    ]
  });
  const model = loadFreshModel(db);

  const records = await model.findByMealBatch('baby-1', '2026-06-15', 'meal-a');

  assert.deepEqual(records.map(item => item._id), ['food-1', 'food-2']);
});

test('softDeleteFoodIntake marks one record deleted without hard remove', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.softDeleteFoodIntake('food-1', {
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter'
  });

  assert.deepEqual(writes.removes, []);
  assert.equal(writes.updates[0].collectionName, 'food_intake_records');
  assert.equal(writes.updates[0].docId, 'food-1');
  assert.equal(writes.updates[0].data.status, 'deleted');
  assert.equal(writes.updates[0].data.deletedAt, '__server_date__');
  assert.equal(writes.updates[0].data.deletedBy, 'openid-deleter');
  assert.equal(writes.updates[0].data.updatedAt, '__server_date__');
  assert.equal(writes.updates[0].data.updatedBy, 'openid-deleter');
});

test('replaceMealBatch soft deletes existing meal records then creates replacement records', async () => {
  const { db, writes } = createDbMock({
    foodIntakeRecords: [
      { _id: 'old-1', babyUid: 'baby-1', date: '2026-06-15', mealBatchId: 'meal-a', status: 'active', foodName: '旧米粉' },
      { _id: 'old-2', babyUid: 'baby-1', date: '2026-06-15', mealBatchId: 'meal-a', status: 'active', foodName: '旧苹果' }
    ]
  });
  const model = loadFreshModel(db);

  const result = await model.replaceMealBatch({
    babyUid: 'baby-1',
    date: '2026-06-15',
    mealBatchId: 'meal-a',
    operatorOpenid: 'openid-editor',
    records: [
      { foodId: 'rice', foodName: '米粉', quantity: 30, nutrition: { calories: 90, protein: 2 } },
      { foodId: 'apple', foodName: '苹果泥', quantity: 20, nutrition: { calories: 30, protein: 0.2 } }
    ]
  });

  assert.equal(result.deletedCount, 2);
  assert.equal(result.createdIds.length, 2);
  assert.deepEqual(writes.updates.map(item => item.docId), ['old-1', 'old-2']);
  assert.equal(writes.adds.length, 2);
  assert.equal(writes.adds[0].collectionName, 'food_intake_records');
  assert.equal(writes.adds[0].data.babyUid, 'baby-1');
  assert.equal(writes.adds[0].data.date, '2026-06-15');
  assert.equal(writes.adds[0].data.mealBatchId, 'meal-a');
  assert.equal(writes.adds[0].data.source, 'meal_editor_v2');
});

test('findMigratedLegacyIntake locates records by legacy source and migration version', async () => {
  const { db, writes } = createDbMock({
    foodIntakeRecords: [
      {
        _id: 'migrated-1',
        babyUid: 'baby-1',
        status: 'active',
        source: 'legacy_migration',
        migrationVersion: 'food-v2',
        legacySource: {
          collection: 'feeding_records',
          recordId: 'legacy-day-1',
          intakeId: 'intake-1'
        }
      }
    ]
  });
  const model = loadFreshModel(db);

  const record = await model.findMigratedLegacyIntake({
    babyUid: 'baby-1',
    recordId: 'legacy-day-1',
    intakeId: 'intake-1',
    migrationVersion: 'food-v2'
  });

  assert.equal(record._id, 'migrated-1');
  assert.deepEqual(writes.reads[0].where, {
    babyUid: 'baby-1',
    status: 'active',
    source: 'legacy_migration',
    migrationVersion: 'food-v2',
    'legacySource.collection': 'feeding_records',
    'legacySource.recordId': 'legacy-day-1',
    'legacySource.intakeId': 'intake-1'
  });
});

test('findRecentFoodIntakes keeps the newest active record for each food', async () => {
  const { db } = createDbMock({
    foodIntakeRecords: [
      { _id: 'rice-new', babyUid: 'baby-1', date: '2026-06-15', status: 'active', foodId: 'rice', foodName: '米粉', recordedAt: '2026-06-15T09:00:00.000Z' },
      { _id: 'rice-old', babyUid: 'baby-1', date: '2026-06-14', status: 'active', foodId: 'rice', foodName: '米粉', recordedAt: '2026-06-14T09:00:00.000Z' },
      { _id: 'apple', babyUid: 'baby-1', date: '2026-06-15', status: 'active', foodId: 'apple', foodName: '苹果泥', recordedAt: '2026-06-15T08:00:00.000Z' },
      { _id: 'deleted', babyUid: 'baby-1', date: '2026-06-15', status: 'deleted', foodId: 'pumpkin', foodName: '南瓜泥', recordedAt: '2026-06-15T10:00:00.000Z' }
    ]
  });
  const model = loadFreshModel(db);

  const records = await model.findRecentFoodIntakes('baby-1', { limit: 2 });

  assert.deepEqual(records.map(item => item._id), ['rice-new', 'apple']);
}
);
