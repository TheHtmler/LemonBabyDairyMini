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
    removeCollection: '',
    removeDocId: '',
    collectionReads: [],
    collectionQueries: [],
    touchedFoodIntakeRecordsForWrite: false,
    touchedLegacyFeedingRecordsForWrite: false
  };
  const dataByCollection = {
    meal_combinations: overrides.mealCombinationData || [],
    food_intake_records: overrides.foodIntakeData || [],
    feeding_records: overrides.legacyData || []
  };
  const incrementToken = { __op: 'inc', value: 1 };

  function markWrite(collectionName) {
    if (collectionName === 'food_intake_records') {
      writes.touchedFoodIntakeRecordsForWrite = true;
    }
    if (collectionName === 'feeding_records') {
      writes.touchedLegacyFeedingRecordsForWrite = true;
    }
  }

  function matchesWhere(record, whereInput = {}) {
    return Object.entries(whereInput).every(([key, expected]) => record[key] === expected);
  }

  function queryFor(collectionName, whereInput = {}) {
    return {
      _where: whereInput,
      _orderBy: null,
      _skip: 0,
      _limit: overrides.defaultQueryLimit || 20,
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
      skip(offset) {
        this._skip = offset;
        return this;
      },
      limit(limitValue) {
        this._limit = limitValue;
        return this;
      },
      async get() {
        writes.collectionReads.push(collectionName);
        writes.collectionQueries.push({
          collectionName,
          where: this._where,
          orderBy: this._orderBy,
          skip: this._skip,
          limit: this._limit
        });
        let data = (dataByCollection[collectionName] || []).filter((record) => (
          matchesWhere(record, this._where)
        ));
        if (this._orderBy) {
          const { field, direction } = this._orderBy;
          data = [...data].sort((left, right) => {
            if (left[field] === right[field]) return 0;
            const result = left[field] > right[field] ? 1 : -1;
            return direction === 'desc' ? -result : result;
          });
        }
        data = data.slice(this._skip, this._skip + this._limit);
        return { data };
      }
    };
  }

  const db = {
    command: {
      inc(value) {
        return { ...incrementToken, value };
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
            async update({ data }) {
              writes.updateCollection = name;
              writes.updateDocId = id;
              writes.updateData = data;
              markWrite(name);
              return {};
            },
            async remove() {
              writes.removeCollection = name;
              writes.removeDocId = id;
              markWrite(name);
              return {};
            }
          };
        },
        async add({ data }) {
          writes.addCollection = name;
          writes.addData = data;
          writes.adds.push({ collectionName: name, data });
          markWrite(name);
          return { _id: 'combo-1' };
        }
      };
    }
  };

  return { db, writes, incrementToken };
}

function loadFreshModel(db) {
  const modelPath = require.resolve('../miniprogram/models/mealCombination.js');
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
    return require(modelPath);
  } finally {
    global.wx = previousWx;
  }
}

test('createMealCombination writes a normalized combination to meal_combinations only', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  const result = await model.createMealCombination({
    babyUid: 'baby-1',
    operatorOpenid: 'openid-creator',
    name: '上午米粉组合',
    items: [
      {
        foodId: 'food-rice',
        foodName: '米粉',
        foodSnapshot: {
          name: '米粉',
          category: 'grain',
          proteinSource: 'natural',
          nutritionPer100g: {
            calories: '360',
            protein: '7',
            fat: '1',
            carbs: '80',
            fiber: '2',
            sodium: '12'
          },
          baseQuantity: '100',
          baseUnit: 'g',
          proteinQuality: 'complete',
          milkType: 'none'
        },
        plannedQuantity: '20',
        plannedNutrition: {
          calories: '72',
          protein: '1.4',
          naturalProtein: '1.4',
          specialProtein: '0',
          fat: '0.2',
          carbs: '16',
          fiber: '0.4',
          sodium: '2.4'
        },
        unit: 'g',
        notes: '先少量试吃'
      }
    ]
  });

  assert.equal(result._id, 'combo-1');
  assert.equal(writes.addCollection, 'meal_combinations');
  assert.equal(writes.touchedFoodIntakeRecordsForWrite, false);
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
  assert.equal(writes.addData.schemaVersion, 1);
  assert.equal(writes.addData.recordType, 'meal_combination');
  assert.equal(writes.addData.status, 'active');
  assert.equal(writes.addData.babyUid, 'baby-1');
  assert.equal(writes.addData.name, '上午米粉组合');
  assert.deepEqual(writes.addData.items, [
    {
      foodId: 'food-rice',
      foodName: '米粉',
      foodSnapshot: {
        name: '米粉',
        category: 'grain',
        proteinSource: 'natural',
        nutritionPerUnit: {
          calories: 360,
          protein: 7,
          fat: 1,
          carbs: 80,
          fiber: 2,
          sodium: 12
        },
        nutritionPer100g: {
          calories: 360,
          protein: 7,
          fat: 1,
          carbs: 80,
          fiber: 2,
          sodium: 12
        },
        baseQuantity: 100,
        baseUnit: 'g',
        proteinQuality: 'complete',
        milkType: 'none'
      },
      plannedQuantity: 20,
      plannedNutrition: {
        calories: 72,
        protein: 1.4,
        naturalProtein: 1.4,
        specialProtein: 0,
        fat: 0.2,
        carbs: 16,
        fiber: 0.4,
        sodium: 2.4
      },
      unit: 'g',
      sortOrder: 0,
      notes: '先少量试吃'
    }
  ]);
  assert.equal(writes.addData.usageCount, 0);
  assert.equal(writes.addData.lastUsedAt, null);
  assert.equal(writes.addData.createdAt, '__server_date__');
  assert.equal(writes.addData.updatedAt, '__server_date__');
  assert.equal(writes.addData.deletedAt, null);
  assert.equal(writes.addData.createdBy, 'openid-creator');
  assert.equal(writes.addData.updatedBy, 'openid-creator');
  assert.equal(writes.addData.deletedBy, '');
});

test('findByBaby returns active combinations sorted newest first', async () => {
  const olderActive = {
    _id: 'combo-old',
    babyUid: 'baby-1',
    status: 'active',
    updatedAt: new Date('2026-05-25T08:00:00.000Z'),
    lastUsedAt: new Date('2026-05-25T08:00:00.000Z'),
    name: '早饭组合'
  };
  const deleted = {
    _id: 'combo-deleted',
    babyUid: 'baby-1',
    status: 'deleted',
    updatedAt: new Date('2026-05-26T09:00:00.000Z'),
    lastUsedAt: new Date('2026-05-26T09:00:00.000Z'),
    name: '已删除组合'
  };
  const newerActive = {
    _id: 'combo-new',
    babyUid: 'baby-1',
    status: 'active',
    updatedAt: new Date('2026-05-26T08:00:00.000Z'),
    lastUsedAt: new Date('2026-05-26T08:00:00.000Z'),
    name: '午饭组合'
  };
  const otherBaby = {
    _id: 'combo-other',
    babyUid: 'baby-2',
    status: 'active',
    updatedAt: new Date('2026-05-27T08:00:00.000Z'),
    lastUsedAt: new Date('2026-05-27T08:00:00.000Z')
  };
  const { db, writes } = createDbMock({
    mealCombinationData: [olderActive, deleted, newerActive, otherBaby]
  });
  const model = loadFreshModel(db);

  const records = await model.findByBaby('baby-1');

  assert.deepEqual(records.map((record) => record._id), ['combo-new', 'combo-old']);
  assert.deepEqual(writes.collectionReads, ['meal_combinations']);
});

test('findByBaby paginates active combinations beyond one cloud query page', async () => {
  const recordsByAge = Array.from({ length: 25 }, (_, index) => ({
    _id: `combo-${String(index + 1).padStart(2, '0')}`,
    babyUid: 'baby-1',
    status: 'active',
    updatedAt: new Date(Date.UTC(2026, 4, 26, 8, 0, 0) - index * 60000),
    name: `组合 ${index + 1}`
  }));
  const { db, writes } = createDbMock({
    mealCombinationData: recordsByAge
  });
  const model = loadFreshModel(db);

  const records = await model.findByBaby('baby-1');

  assert.equal(records.length, 25);
  assert.deepEqual(
    records.map((record) => record._id),
    recordsByAge.map((record) => record._id)
  );
  assert.deepEqual(writes.collectionReads, ['meal_combinations', 'meal_combinations']);
  assert.deepEqual(
    writes.collectionQueries.map((query) => ({
      where: query.where,
      orderBy: query.orderBy,
      skip: query.skip,
      limit: query.limit
    })),
    [
      {
        where: { babyUid: 'baby-1', status: 'active' },
        orderBy: { field: 'updatedAt', direction: 'desc' },
        skip: 0,
        limit: 20
      },
      {
        where: { babyUid: 'baby-1', status: 'active' },
        orderBy: { field: 'updatedAt', direction: 'desc' },
        skip: 20,
        limit: 20
      }
    ]
  );
});

test('updateMealCombination strips unsafe fields and rewrites normalized items', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.updateMealCombination('combo-1', {
    _id: 'unsafe-id',
    id: 'unsafe-legacy-id',
    createdAt: 'should-not-overwrite',
    createdBy: 'should-not-overwrite',
    operatorOpenid: 'openid-editor',
    name: '更新后的组合',
    items: [
      {
        foodId: 'food-avocado',
        foodName: '牛油果',
        foodSnapshot: {
          name: '牛油果',
          category: 'fruit',
          proteinSource: 'natural',
          nutritionPerUnit: {
            calories: '160',
            protein: '2',
            fat: '15',
            carbs: '9',
            fiber: '7'
          },
          baseQuantity: '100',
          baseUnit: 'g'
        },
        plannedQuantity: '25',
        plannedNutrition: {
          calories: '40',
          protein: '0.5',
          naturalProtein: '0.5',
          specialProtein: '0',
          fat: '3.75',
          carbs: '2.25',
          fiber: '1.75',
          sodium: '0'
        },
        unit: 'g',
        sortOrder: '3'
      }
    ]
  });

  assert.equal(writes.updateCollection, 'meal_combinations');
  assert.equal(writes.updateDocId, 'combo-1');
  assert.equal(writes.updateData._id, undefined);
  assert.equal(writes.updateData.id, undefined);
  assert.equal(writes.updateData.createdAt, undefined);
  assert.equal(writes.updateData.createdBy, undefined);
  assert.equal(writes.updateData.operatorOpenid, undefined);
  assert.equal(writes.updateData.name, '更新后的组合');
  assert.equal(writes.updateData.updatedAt, '__server_date__');
  assert.equal(writes.updateData.updatedBy, 'openid-editor');
  assert.deepEqual(writes.updateData.items, [
    {
      foodId: 'food-avocado',
      foodName: '牛油果',
      foodSnapshot: {
        name: '牛油果',
        category: 'fruit',
        proteinSource: 'natural',
        nutritionPerUnit: {
          calories: 160,
          protein: 2,
          fat: 15,
          carbs: 9,
          fiber: 7,
          sodium: 0
        },
        baseQuantity: 100,
        baseUnit: 'g',
        proteinQuality: '',
        milkType: ''
      },
      plannedQuantity: 25,
      plannedNutrition: {
        calories: 40,
        protein: 0.5,
        naturalProtein: 0.5,
        specialProtein: 0,
        fat: 3.75,
        carbs: 2.25,
        fiber: 1.75,
        sodium: 0
      },
      unit: 'g',
      sortOrder: 3,
      notes: ''
    }
  ]);
});

test('deleteMealCombination hard deletes the combination and writes an audit log', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.deleteMealCombination('combo-1', {
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter'
  });

  assert.equal(writes.removeCollection, 'meal_combinations');
  assert.equal(writes.removeDocId, 'combo-1');
  assert.equal(writes.updateCollection, '');
  assert.deepEqual(writes.adds.find(item => item.collectionName === 'audit_logs')?.data, {
    schemaVersion: 1,
    recordType: 'audit_log',
    action: 'delete',
    collection: 'meal_combinations',
    recordId: 'combo-1',
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter',
    status: 'active',
    createdAt: '__server_date__'
  });
  assert.equal(writes.touchedFoodIntakeRecordsForWrite, false);
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
});

test('createMealCombination rejects duplicate active names for the same baby', async () => {
  const { db, writes } = createDbMock({
    mealCombinationData: [
      {
        _id: 'combo-existing',
        babyUid: 'baby-1',
        status: 'active',
        name: '早餐组合'
      },
      {
        _id: 'combo-other-baby',
        babyUid: 'baby-2',
        status: 'active',
        name: '早餐组合'
      }
    ]
  });
  const model = loadFreshModel(db);

  await assert.rejects(
    () => model.createMealCombination({
      babyUid: 'baby-1',
      name: ' 早餐组合 ',
      items: []
    }),
    /同名菜谱已存在/
  );

  assert.equal(writes.addCollection, '');
  assert.deepEqual(writes.collectionQueries[0].where, {
    babyUid: 'baby-1',
    status: 'active',
    name: '早餐组合'
  });
});

test('incrementUsage increments usageCount and sets lastUsedAt', async () => {
  const { db, writes, incrementToken } = createDbMock();
  const model = loadFreshModel(db);

  await model.incrementUsage('combo-1');

  assert.equal(writes.updateCollection, 'meal_combinations');
  assert.equal(writes.updateDocId, 'combo-1');
  assert.deepEqual(writes.updateData.usageCount, incrementToken);
  assert.equal(writes.updateData.lastUsedAt, '__server_date__');
  assert.equal(writes.touchedFoodIntakeRecordsForWrite, false);
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
});
