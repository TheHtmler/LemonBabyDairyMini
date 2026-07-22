const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const functionDir = path.join('cloudfunctions', 'rebuildDailySummaryV2');
const indexPath = path.join(functionDir, 'index.js');

function readPathValue(record = {}, pathValue = '') {
  return String(pathValue).split('.').reduce((value, key) => (
    value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
  ), record);
}

function matchesWhere(record = {}, whereInput = {}) {
  return Object.entries(whereInput || {}).every(([key, expected]) => {
    const actual = readPathValue(record, key);
    if (expected && expected.__gte !== undefined && expected.__lte !== undefined) {
      return actual >= expected.__gte && actual <= expected.__lte;
    }
    if (expected && expected.__gte !== undefined) {
      return actual >= expected.__gte;
    }
    if (expected && expected.__lt !== undefined) {
      return actual < expected.__lt;
    }
    return actual === expected;
  });
}

function createDbMock(overrides = {}) {
  const writes = {
    adds: [],
    updates: [],
    reads: []
  };
  const dataByCollection = {
    daily_summary_v2: overrides.dailySummaryData || [],
    feeding_records_v2: overrides.milkRecords || [],
    food_intake_records: overrides.foodRecords || [],
    treatment_records: overrides.treatmentRecords || [],
    medication_records: overrides.medicationRecords || [],
    bowel_records: overrides.bowelRecords || [],
    water_records: overrides.waterRecords || [],
    growth_records_v2: overrides.growthRecords || []
  };

  function queryFor(collectionName, whereInput = {}) {
    const chain = {
      _where: whereInput,
      _skip: 0,
      _limit: 0,
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
      skip(value) {
        this._skip = value;
        return this;
      },
      limit(value) {
        this._limit = value;
        return this;
      },
      async get() {
        writes.reads.push({ collectionName, where: this._where, skip: this._skip, limit: this._limit });
        let data = (dataByCollection[collectionName] || []).filter(item => matchesWhere(item, this._where));
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
        if (this._skip > 0) data = data.slice(this._skip);
        if (this._limit > 0) data = data.slice(0, this._limit);
        return { data };
      }
    };
    return chain;
  }

  const db = {
    command: {
      gte(value) {
        return {
          __gte: value,
          and(next) {
            return { ...this, ...next };
          }
        };
      },
      lte(value) {
        return { __lte: value };
      },
      lt(value) {
        return { __lt: value };
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
              writes.updates.push({ collectionName: name, docId: id, data });
              return {};
            }
          };
        },
        async add({ data }) {
          writes.adds.push({ collectionName: name, data });
          return { _id: `${name}-new-id` };
        }
      };
    }
  };

  return { db, writes };
}

function loadFunctionWithMockCloud(db) {
  const resolved = require.resolve(path.join('..', indexPath));
  const previousLoad = Module._load;
  delete require.cache[resolved];

  Module._load = function mockWxServerSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test-env',
        init() {},
        database() {
          return db;
        }
      };
    }
    return previousLoad.call(this, request, parent, isMain);
  };

  try {
    return require(path.join('..', indexPath));
  } finally {
    Module._load = previousLoad;
  }
}

test('rebuildDailySummaryV2 cloud function exposes dryRun and paged rebuild controls', () => {
  assert.equal(fs.existsSync(indexPath), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'config.json')), true);

  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /DAILY_SUMMARY_COLLECTION\s*=\s*'daily_summary_v2'/);
  assert.match(source, /FOOD_INTAKE_COLLECTION\s*=\s*'food_intake_records'/);
  assert.match(source, /FEEDING_RECORDS_V2_COLLECTION\s*=\s*'feeding_records_v2'/);
  assert.match(source, /dryRun/);
  assert.match(source, /pageSize/);
  assert.match(source, /nextOffset/);
  assert.match(source, /rebuildDailySummaryForDate/);
});

test('dryRun lists target dates without writing daily_summary_v2', async () => {
  const { db, writes } = createDbMock({
    foodRecords: [
      { _id: 'food-1', babyUid: 'baby-1', date: '2026-06-04', status: 'active', nutrition: { calories: 100, protein: 2, naturalProtein: 2, specialProtein: 0 } }
    ]
  });
  const fn = loadFunctionWithMockCloud(db);

  const result = await fn.main({
    dryRun: true,
    babyUid: 'baby-1',
    startDate: '2026-06-04',
    endDate: '2026-06-10',
    pageSize: 3,
    offset: 0
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.scannedDates, 3);
  assert.equal(result.rebuilt, 0);
  assert.deepEqual(result.dates, ['2026-06-04', '2026-06-05', '2026-06-06']);
  assert.deepEqual(writes.adds, []);
  assert.deepEqual(writes.updates, []);
});

test('rebuild writes daily_summary_v2 from v2 milk and food facts', async () => {
  const { db, writes } = createDbMock({
    dailySummaryData: [
      { _id: 'summary-1', babyUid: 'baby-1', date: '2026-06-04', status: 'active', isDirty: true }
    ],
    milkRecords: [
      {
        _id: 'milk-1',
        babyUid: 'baby-1',
        date: '2026-06-04',
        status: 'active',
        nutritionSummary: {
          totalVolume: 100,
          calories: 80,
          protein: 2,
          naturalProtein: 2,
          specialProtein: 0,
          carbs: 6,
          fat: 3
        },
        basicInfoSnapshot: { weight: '5' }
      }
    ],
    foodRecords: [
      {
        _id: 'food-1',
        babyUid: 'baby-1',
        date: '2026-06-04',
        status: 'active',
        proteinQuality: 'premium',
        nutrition: {
          calories: 50,
          protein: 1,
          naturalProtein: 1,
          specialProtein: 0,
          carbs: 8,
          fat: 1,
          fiber: 0.5
        }
      }
    ]
  });
  const fn = loadFunctionWithMockCloud(db);

  const result = await fn.main({
    dryRun: false,
    babyUid: 'baby-1',
    startDate: '2026-06-04',
    endDate: '2026-06-04',
    pageSize: 1,
    offset: 0
  });

  assert.equal(result.ok, true);
  assert.equal(result.rebuilt, 1);
  assert.equal(writes.updates.length, 1);
  assert.equal(writes.updates[0].collectionName, 'daily_summary_v2');
  assert.equal(writes.updates[0].docId, 'summary-1');
  assert.equal(writes.updates[0].data.isDirty, false);
  assert.deepEqual(writes.updates[0].data.food, {
    calories: 50,
    protein: 1,
    naturalProtein: 1,
    specialProtein: 0,
    premiumProtein: 1,
    regularProtein: 0,
    fat: 1,
    carbs: 8,
    fiber: 0.5,
    fluidVolume: 0
  });
  assert.deepEqual(writes.updates[0].data.macroSummary, {
    calories: 130,
    protein: 3,
    naturalProtein: 3,
    specialProtein: 0,
    carbs: 14,
    fat: 4
  });
});
