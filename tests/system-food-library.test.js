const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function installWxMock(collectionDocs = []) {
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  const writes = [];
  const storage = {};

  const command = {
    eq: value => ({ $eq: value }),
    in: value => ({ $in: value }),
    or: conditions => ({ $or: conditions }),
    addToSet: value => ({ $addToSet: value }),
    remove: () => ({ $remove: true })
  };

  function matchesCondition(doc, condition = {}) {
    return Object.entries(condition).every(([key, expected]) => {
      const actual = doc[key];
      if (expected && Object.prototype.hasOwnProperty.call(expected, '$eq')) {
        return actual === expected.$eq;
      }
      if (expected && Object.prototype.hasOwnProperty.call(expected, '$in')) {
        return Array.isArray(actual) && expected.$in.some(value => actual.includes(value));
      }
      return actual === expected;
    });
  }

  function applyQuery(docs, query) {
    if (!query) return docs;
    if (query.$or) {
      return docs.filter(doc => query.$or.some(condition => matchesCondition(doc, condition)));
    }
    return docs.filter(doc => matchesCondition(doc, query));
  }

  function createQuery(initialQuery) {
    let query = initialQuery || null;
    let offset = 0;
    let limitCount = collectionDocs.length || 20;

    return {
      where(nextQuery) {
        query = nextQuery;
        return this;
      },
      skip(nextOffset) {
        offset = nextOffset;
        return this;
      },
      limit(nextLimit) {
        limitCount = nextLimit;
        return this;
      },
      async get() {
        return {
          data: applyQuery(collectionDocs, query).slice(offset, offset + limitCount)
        };
      },
      async update({ data }) {
        writes.push({ type: 'query.update', query, data });
        return { stats: { updated: 1 } };
      },
      async remove() {
        writes.push({ type: 'query.remove', query });
        return { stats: { removed: 1 } };
      }
    };
  }

  global.wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    cloud: {
      async callFunction({ name }) {
        if (name === 'getSystemFoodIndex') {
          return {
            result: {
              ok: true,
              index: collectionDocs.filter(doc =>
                doc && (doc.isSystem === true || doc.sourceType === 'system' || doc.ownerType === 'system')
              )
            }
          };
        }
        return { result: { ok: false } };
      },
      database() {
        return {
          command,
          collection() {
            return {
              where: createQuery,
              skip(offset) {
                return createQuery().skip(offset);
              },
              doc(id) {
                return {
                  async update({ data }) {
                    writes.push({ type: 'doc.update', id, data });
                    return { stats: { updated: 1 } };
                  }
                };
              },
              async add({ data }) {
                writes.push({ type: 'add', data });
                return { _id: 'created-food-id' };
              }
            };
          },
          serverDate() {
            return new Date('2026-06-13T00:00:00.000Z');
          }
        };
      }
    }
  };
  global.getApp = () => ({ globalData: { openid: 'openid-1' } });

  return {
    writes,
    restore() {
      global.wx = previousWx;
      global.getApp = previousGetApp;
    }
  };
}

function loadFoodModel(docs = []) {
  const modelPath = require.resolve('../miniprogram/models/food.js');
  delete require.cache[modelPath];
  const mock = installWxMock(docs);
  return {
    FoodModel: require(modelPath),
    mock
  };
}

test('system foods seed uses v2 nutrition basis fields and keeps Excel origin data', () => {
  const foodsPath = path.resolve(__dirname, '../cloudfunctions/migrateSystemFoods/foods.json');
  const foods = JSON.parse(fs.readFileSync(foodsPath, 'utf8'));
  const wheat = foods.find(item => item.name === '小麦');

  assert.ok(wheat);
  assert.equal(wheat.schemaVersion, 2);
  assert.equal(wheat.recordType, 'food_catalog_item');
  assert.equal(wheat.status, 'active');
  assert.equal(wheat.sourceType, 'system');
  assert.deepEqual(wheat.nutritionBasis, { quantity: 100, unit: 'g' });
  assert.equal(wheat.nutritionPerBasis.protein, 11.9);
  assert.equal(wheat.nutritionPerBasis.sodium, 0);
  assert.equal(wheat.origin.source, 'china_food_composition_table');
  assert.equal(wheat.origin.foodCode, '011101');
  assert.equal(wheat.origin.categoryLevel1Code, '01');
  assert.equal(wheat.origin.categoryLevel2Code, '011');
  assert.equal(wheat.nutritionExtra.water, 10);
  assert.equal(wheat.nutritionExtra.energyKj, 1416);
});

test('system food migration cloud function supports bounded batch imports', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/migrateSystemFoods/index.js'),
    'utf8'
  );

  assert.match(source, /const DEFAULT_BATCH_SIZE = 200;/);
  assert.match(source, /const MAX_BATCH_SIZE = 200;/);
  assert.match(source, /exports\.main\s*=\s*async\s*\(event\s*=\s*\{\}\)/);
  assert.match(source, /startIndex/);
  assert.match(source, /batchSize/);
  assert.match(source, /nextStart/);
  assert.match(source, /hasMore/);
  assert.match(source, /logs\.slice\(0,\s*logLimit\)/);
});

test('system food migration cloud function provides dry-run stale system cleanup', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../cloudfunctions/migrateSystemFoods/index.js'),
    'utf8'
  );

  assert.match(source, /cleanupStaleSystemFoods/);
  assert.match(source, /event\.action\s*===\s*'cleanupStale'/);
  assert.match(source, /execute\s*===\s*true/);
  assert.match(source, /buildSystemFoodCleanupQuery/);
  assert.match(source, /sourceType:\s*'system'/);
  assert.match(source, /ownerType:\s*'system'/);
  assert.match(source, /isSystem:\s*true/);
  assert.match(source, /docs\.length\s*-\s*deleted/);
  assert.match(source, /babyUid:\s*''/);
  assert.match(source, /stale/);
});

test('FoodModel returns system foods for a baby and calculates from nutrition basis', async () => {
  const { FoodModel, mock } = loadFoodModel([
    {
      _id: 'sys-1',
      name: '小麦',
      sourceType: 'system',
      ownerType: 'system',
      status: 'active',
      category: '谷类及制品',
      nutritionBasis: { quantity: 100, unit: 'g' },
      nutritionPerBasis: { calories: 338, protein: 11.9, fat: 1.3, carbs: 75.2, fiber: 10.8, sodium: 0 }
    },
    {
      _id: 'user-1',
      name: '自定义米糊',
      babyUid: 'baby-1',
      sharedBabyUids: ['baby-1'],
      isSystem: false,
      nutritionBasis: { quantity: 1, unit: '份' },
      nutritionPerBasis: { calories: 80, protein: 2, fat: 1, carbs: 12, fiber: 0, sodium: 3 }
    }
  ]);

  try {
    const foods = await FoodModel.getAvailableFoods('baby-1');
    assert.deepEqual(foods.map(food => food._id).sort(), ['sys-1', 'user-1']);
    assert.equal(foods.find(food => food._id === 'sys-1').libraryScope, 'system');
    assert.equal(foods.find(food => food._id === 'sys-1').isSystem, true);
    assert.equal(foods.find(food => food._id === 'user-1').libraryScope, 'mine');
    assert.deepEqual(FoodModel.calculateNutrition(foods[0], 50), {
      calories: 169,
      protein: 5.95,
      carbs: 37.6,
      fat: 0.65,
      fiber: 5.4,
      sodium: 0
    });
  } finally {
    mock.restore();
  }
});

test('FoodModel creates a user override snapshot from a system food', async () => {
  const { FoodModel, mock } = loadFoodModel([]);
  const systemFood = {
    _id: 'sys-1',
    name: '小麦',
    category: '谷类及制品',
    categoryLevel1: '谷类及制品',
    categoryLevel2: '小麦',
    isSystem: true,
    nutritionBasis: { quantity: 100, unit: 'g' },
    nutritionPerBasis: { calories: 338, protein: 11.9, fat: 1.3, carbs: 75.2, fiber: 10.8, sodium: 0 },
    origin: { source: 'china_food_composition_table', foodCode: '011101' },
    sourceFoodCode: '011101'
  };

  try {
    const createdId = await FoodModel.createSystemFoodSnapshot(systemFood, {
      name: '小麦-家庭修订',
      nutritionBasis: { quantity: 100, unit: 'g' },
      nutritionPerBasis: { calories: 340, protein: 12, fat: 1.3, carbs: 75, fiber: 10, sodium: 1 }
    }, 'baby-1');

    assert.equal(createdId, 'created-food-id');
    const addWrite = mock.writes.find(write => write.type === 'add');
    assert.equal(addWrite.data.sourceType, 'user_override');
    assert.equal(addWrite.data.ownerType, 'baby');
    assert.equal(addWrite.data.isSystemSnapshot, true);
    assert.equal(addWrite.data.sourceSystemFoodId, 'sys-1');
    assert.deepEqual(addWrite.data.snapshotOf, {
      collection: 'food_catalog',
      id: 'sys-1',
      sourceFoodCode: '011101'
    });
    assert.deepEqual(addWrite.data.nutritionBasis, { quantity: 100, unit: 'g' });
    assert.equal(addWrite.data.nutritionPerBasis.protein, 12);
  } finally {
    mock.restore();
  }
});
