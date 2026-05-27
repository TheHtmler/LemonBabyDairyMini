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
    touchedLegacyFeedingRecordsForWrite: false
  };
  const dataByCollection = {
    food_intake_records: overrides.foodIntakeData || [],
    feeding_records: overrides.legacyData || []
  };

  function matchesWhere(record, whereInput = {}) {
    return Object.entries(whereInput).every(([key, expected]) => record[key] === expected);
  }

  function queryFor(collectionName, whereInput = {}) {
    return {
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
      async get() {
        writes.collectionReads.push(collectionName);
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
        return { data };
      }
    };
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
              writes.updateCollection = name;
              writes.updateDocId = id;
              writes.updateData = data;
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
          if (name === 'feeding_records') {
            writes.touchedLegacyFeedingRecordsForWrite = true;
          }
          return { _id: 'food-intake-1' };
        }
      };
    }
  };

  return { db, writes };
}

function loadFreshModel(db) {
  const modelPath = require.resolve('../miniprogram/models/foodIntakeRecord.js');
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

test('createFoodIntake writes a food intake document to food_intake_records only', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);
  const recordedAt = new Date('2026-05-25T12:30:00.000Z');

  const result = await model.createFoodIntake({
    babyUid: 'baby-1',
    operatorOpenid: 'openid-creator',
    date: '2026-05-25',
    mealBatchId: 'meal-1',
    recordedAt,
    time: '12:30',
    foodId: 'food-rice',
    foodName: '米粉',
    foodSnapshot: {
      name: '米粉',
      category: 'grain',
      proteinSource: 'natural',
      nutritionPer100g: {
        calories: 360,
        protein: 7,
        fat: 1,
        carbs: 80,
        fiber: 2
      }
    },
    quantity: '20',
    unit: 'g',
    nutrition: {
      calories: 72,
      protein: 1.4,
      naturalProtein: 1.4,
      specialProtein: 0,
      fat: 0.2,
      carbs: 16,
      fiber: 0.4
    },
    notes: '午餐'
  });

  assert.equal(result._id, 'food-intake-1');
  assert.equal(writes.addCollection, 'food_intake_records');
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
  assert.equal(writes.addData.schemaVersion, 1);
  assert.equal(writes.addData.recordType, 'food_intake');
  assert.equal(writes.addData.source, 'meal_editor_v2');
  assert.equal(writes.addData.status, 'active');
  assert.equal(writes.addData.babyUid, 'baby-1');
  assert.equal(writes.addData.date, '2026-05-25');
  assert.equal(writes.addData.mealBatchId, 'meal-1');
  assert.equal(writes.addData.recordedAt, recordedAt);
  assert.equal(writes.addData.time, '12:30');
  assert.equal(writes.addData.foodId, 'food-rice');
  assert.equal(writes.addData.foodName, '米粉');
  assert.deepEqual(writes.addData.foodSnapshot.nutritionPer100g, {
    calories: 360,
    protein: 7,
    fat: 1,
    carbs: 80,
    fiber: 2
  });
  assert.deepEqual(writes.addData.nutrition, {
    calories: 72,
    protein: 1.4,
    naturalProtein: 1.4,
    specialProtein: 0,
    fat: 0.2,
    carbs: 16,
    fiber: 0.4
  });
  assert.equal(writes.addData.createdAt, '__server_date__');
  assert.equal(writes.addData.updatedAt, '__server_date__');
  assert.equal(writes.addData.deletedAt, null);
  assert.equal(writes.addData.createdBy, 'openid-creator');
  assert.equal(writes.addData.updatedBy, 'openid-creator');
  assert.equal(writes.addData.deletedBy, '');
});

test('createFoodIntake preserves meal combination planned fields', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.createFoodIntake({
    babyUid: 'baby-1',
    date: '2026-05-25',
    foodName: '组合午餐',
    plannedQuantity: '45.5',
    plannedNutrition: {
      calories: '92.4',
      protein: '2.2',
      naturalProtein: '2.2',
      specialProtein: '0',
      fat: '0.8',
      carbs: '18.6',
      fiber: '1.4',
      sodium: '12.5',
      unsafeKey: 999
    },
    completionPercent: '75',
    mealCombinationSource: {
      combinationId: 'combo-1',
      combinationName: '午餐组合',
      unsafeKey: 'strip-me'
    }
  });

  assert.equal(writes.addData.plannedQuantity, 45.5);
  assert.deepEqual(writes.addData.plannedNutrition, {
    calories: 92.4,
    protein: 2.2,
    naturalProtein: 2.2,
    specialProtein: 0,
    fat: 0.8,
    carbs: 18.6,
    fiber: 1.4,
    sodium: 12.5
  });
  assert.equal(writes.addData.completionPercent, 75);
  assert.deepEqual(writes.addData.mealCombinationSource, {
    combinationId: 'combo-1',
    combinationName: '午餐组合'
  });
});

test('updateFoodIntake preserves createdAt and updates updatedAt', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.updateFoodIntake('food-intake-1', {
    quantity: '25',
    createdAt: 'should-not-overwrite',
    createdBy: 'should-not-overwrite',
    operatorOpenid: 'openid-editor',
    nutrition: {
      calories: 90,
      protein: 1.75
    }
  });

  assert.equal(writes.updateCollection, 'food_intake_records');
  assert.equal(writes.updateDocId, 'food-intake-1');
  assert.equal(writes.updateData.quantity, 25);
  assert.equal(writes.updateData.createdAt, undefined);
  assert.equal(writes.updateData.createdBy, undefined);
  assert.equal(writes.updateData.operatorOpenid, undefined);
  assert.equal(writes.updateData.updatedAt, '__server_date__');
  assert.equal(writes.updateData.updatedBy, 'openid-editor');
  assert.deepEqual(writes.updateData.nutrition, {
    calories: 90,
    protein: 1.75,
    naturalProtein: 0,
    specialProtein: 0,
    fat: 0,
    carbs: 0,
    fiber: 0
  });
});

test('updateFoodIntake normalizes planned fields and strips unsafe keys', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.updateFoodIntake('food-intake-1', {
    _id: 'unsafe-id',
    id: 'unsafe-public-id',
    createdAt: 'should-not-overwrite',
    plannedQuantity: '18.25',
    plannedNutrition: {
      calories: '40',
      protein: '1.1',
      naturalProtein: '1',
      specialProtein: '0.1',
      fat: '0.3',
      carbs: '8.2',
      fiber: '0.6',
      sodium: '4.5',
      extra: 'strip-me'
    },
    completionPercent: '60',
    mealCombinationSource: {
      combinationId: 'combo-2',
      combinationName: '晚餐组合',
      extra: 'strip-me'
    }
  });

  assert.equal(writes.updateData._id, undefined);
  assert.equal(writes.updateData.id, undefined);
  assert.equal(writes.updateData.createdAt, undefined);
  assert.equal(writes.updateData.plannedQuantity, 18.25);
  assert.deepEqual(writes.updateData.plannedNutrition, {
    calories: 40,
    protein: 1.1,
    naturalProtein: 1,
    specialProtein: 0.1,
    fat: 0.3,
    carbs: 8.2,
    fiber: 0.6,
    sodium: 4.5
  });
  assert.equal(writes.updateData.completionPercent, 60);
  assert.deepEqual(writes.updateData.mealCombinationSource, {
    combinationId: 'combo-2',
    combinationName: '晚餐组合'
  });
});

test('deleteFoodIntake hard deletes a food intake document and writes an audit log', async () => {
  const { db, writes } = createDbMock();
  const model = loadFreshModel(db);

  await model.deleteFoodIntake('food-intake-1', {
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter'
  });

  assert.equal(writes.removeCollection, 'food_intake_records');
  assert.equal(writes.removeDocId, 'food-intake-1');
  assert.equal(writes.updateCollection, '');
  assert.equal(writes.updateData, null);
  assert.deepEqual(writes.adds.find(item => item.collectionName === 'audit_logs')?.data, {
    schemaVersion: 1,
    recordType: 'audit_log',
    action: 'delete',
    collection: 'food_intake_records',
    recordId: 'food-intake-1',
    babyUid: 'baby-1',
    operatorOpenid: 'openid-deleter',
    status: 'active',
    createdAt: '__server_date__'
  });
  assert.equal(writes.touchedLegacyFeedingRecordsForWrite, false);
});

test('findByDate returns active food intakes sorted by recordedAt', async () => {
  const activeLater = {
    _id: 'food-2',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    recordedAt: new Date('2026-05-25T12:30:00.000Z'),
    foodName: '土豆',
    quantity: '30'
  };
  const activeEarlier = {
    _id: 'food-1',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    recordedAt: new Date('2026-05-25T08:30:00.000Z'),
    foodName: '米粉',
    quantity: '20'
  };
  const archived = {
    _id: 'food-archived',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'archived',
    recordedAt: new Date('2026-05-25T09:30:00.000Z')
  };
  const { db, writes } = createDbMock({
    foodIntakeData: [activeLater, archived, activeEarlier]
  });
  const model = loadFreshModel(db);

  const records = await model.findByDate('baby-1', '2026-05-25');

  assert.deepEqual(records.map((record) => record._id), ['food-1', 'food-2']);
  assert.equal(records[0].quantity, 20);
  assert.deepEqual(writes.collectionReads, ['food_intake_records']);
});

test('findByDate returns normalized planned fields for display and edit', async () => {
  const { db } = createDbMock({
    foodIntakeData: [{
      _id: 'food-1',
      babyUid: 'baby-1',
      date: '2026-05-25',
      status: 'active',
      recordedAt: new Date('2026-05-25T08:30:00.000Z'),
      foodName: '米粉组合',
      quantity: '20',
      plannedQuantity: '25.5',
      plannedNutrition: {
        calories: '88.8',
        protein: '2',
        naturalProtein: '1.8',
        specialProtein: '0.2',
        fat: '0.5',
        carbs: '17',
        fiber: '1.2',
        sodium: '6',
        unsafeKey: 'strip-me'
      },
      completionPercent: '80',
      mealCombinationSource: {
        combinationId: 'combo-1',
        combinationName: '早餐组合',
        unsafeKey: 'strip-me'
      }
    }]
  });
  const model = loadFreshModel(db);

  const records = await model.findByDate('baby-1', '2026-05-25');

  assert.equal(records[0].plannedQuantity, 25.5);
  assert.deepEqual(records[0].plannedNutrition, {
    calories: 88.8,
    protein: 2,
    naturalProtein: 1.8,
    specialProtein: 0.2,
    fat: 0.5,
    carbs: 17,
    fiber: 1.2,
    sodium: 6
  });
  assert.equal(records[0].completionPercent, 80);
  assert.deepEqual(records[0].mealCombinationSource, {
    combinationId: 'combo-1',
    combinationName: '早餐组合'
  });
});

test('findByDate keeps existing food intakes backward-compatible without planned quantity', async () => {
  const { db } = createDbMock({
    foodIntakeData: [{
      _id: 'food-1',
      babyUid: 'baby-1',
      date: '2026-05-25',
      status: 'active',
      recordedAt: new Date('2026-05-25T08:30:00.000Z'),
      foodName: '米粉',
      quantity: '20'
    }]
  });
  const model = loadFreshModel(db);

  const records = await model.findByDate('baby-1', '2026-05-25');

  assert.equal(records[0].completionPercent, 100);
  assert.equal(Object.prototype.hasOwnProperty.call(records[0], 'plannedQuantity'), false);
});
