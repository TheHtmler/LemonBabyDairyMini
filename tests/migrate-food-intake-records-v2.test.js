const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const functionDir = path.join('cloudfunctions', 'migrateFoodIntakeRecordsV2');
const indexPath = path.join(functionDir, 'index.js');

function readPathValue(record = {}, pathValue = '') {
  return String(pathValue).split('.').reduce((value, key) => (
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
    feeding_records: overrides.legacyRecords || [],
    food_intake_records: overrides.foodIntakeRecords || []
  };

  function matchesWhere(record = {}, whereInput = {}) {
    return Object.entries(whereInput || {}).every(([key, expected]) => (
      readPathValue(record, key) === expected
    ));
  }

  function queryFor(collectionName, whereInput = {}) {
    const chain = {
      _where: whereInput,
      _skip: 0,
      _limit: 0,
      where(nextWhere) {
        this._where = {
          ...this._where,
          ...nextWhere
        };
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
      orderBy() {
        return this;
      },
      async get() {
        writes.reads.push({ collectionName, where: this._where, skip: this._skip, limit: this._limit });
        let data = (dataByCollection[collectionName] || []).filter((item) => matchesWhere(item, this._where));
        if (this._skip > 0) data = data.slice(this._skip);
        if (this._limit > 0) data = data.slice(0, this._limit);
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
        skip(value) {
          return queryFor(name).skip(value);
        },
        limit(value) {
          return queryFor(name).limit(value);
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
          writes.adds.push({ collectionName: name, data });
          return { _id: `food-v2-${writes.adds.length}` };
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

test('migrateFoodIntakeRecordsV2 function is a copy-only migration into food_intake_records', () => {
  assert.equal(fs.existsSync(indexPath), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'config.json')), true);

  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /LEGACY_FEEDING_RECORDS_COLLECTION\s*=\s*'feeding_records'/);
  assert.match(source, /FOOD_INTAKE_RECORDS_COLLECTION\s*=\s*'food_intake_records'/);
  assert.match(source, /dryRun/);
  assert.match(source, /migrationVersion/);
  assert.match(source, /legacySource/);
  assert.match(source, /findExistingMigratedIntake/);
  assert.match(source, /skippedExisting/);
  assert.match(source, /warnings/);
  assert.doesNotMatch(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)\.doc\([^)]*\)\.update/);
  assert.doesNotMatch(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)\.doc\([^)]*\)\.remove/);
});

test('buildV2FoodIntakePayloadFromLegacyIntake preserves meal, nutrition split, snapshot, and legacy source', () => {
  const { db } = createDbMock();
  const fn = loadFunctionWithMockCloud(db);

  const payload = fn._internal.buildV2FoodIntakePayloadFromLegacyIntake({
    legacyRecord: {
      _id: 'legacy-day-1',
      babyUid: 'baby-1',
      date: new Date('2026-06-14T16:00:00.000Z')
    },
    intake: {
      _id: 'intake-1',
      foodId: 'food-rice',
      nameSnapshot: '米粉',
      quantity: '30',
      unit: 'g',
      nutrition: { calories: 90, protein: 2.4, fat: 0.3, carbs: 20, fiber: 0.5 },
      naturalProtein: 2.4,
      specialProtein: 0,
      proteinSource: 'natural',
      recordedAt: '09:30',
      mealBatchId: 'meal-a',
      mealTime: '09:30',
      mealLabel: '早餐',
      mealNote: '吃得不错',
      sortOrder: 1,
      foodSnapshot: {
        name: '米粉',
        category: '谷物',
        nutritionBasis: { quantity: 100, unit: 'g' },
        nutritionPerBasis: { calories: 300, protein: 8 },
        proteinSource: 'natural'
      },
      plannedQuantity: 40,
      plannedNutrition: { calories: 120, protein: 3.2, naturalProtein: 3.2, specialProtein: 0 },
      completionPercent: 75,
      mealCombinationSource: {
        combinationId: 'recipe-1',
        combinationName: '早餐组合',
        sourceGroupId: 'group-1'
      },
      createdBy: 'openid-old'
    },
    migrationVersion: 'food-v2-test',
    migratedAt: '__server_date__'
  });

  assert.equal(payload.babyUid, 'baby-1');
  assert.equal(payload.date, '2026-06-15');
  assert.equal(payload.recordType, 'food_intake');
  assert.equal(payload.source, 'legacy_migration');
  assert.equal(payload.status, 'active');
  assert.equal(payload.foodName, '米粉');
  assert.equal(payload.quantity, 30);
  assert.equal(payload.nutrition.naturalProtein, 2.4);
  assert.equal(payload.nutrition.specialProtein, 0);
  assert.equal(payload.foodSnapshot.name, '米粉');
  assert.equal(payload.mealBatchId, 'meal-a');
  assert.equal(payload.mealLabel, '早餐');
  assert.equal(payload.mealNote, '吃得不错');
  assert.deepEqual(payload.legacySource, {
    collection: 'feeding_records',
    recordId: 'legacy-day-1',
    intakeId: 'intake-1'
  });
  assert.equal(payload.migrationVersion, 'food-v2-test');
  assert.equal(payload.migratedAt, '__server_date__');
  assert.equal(payload.createdBy, 'openid-old');
  assert.equal(payload.plannedQuantity, 40);
  assert.equal(payload.completionPercent, 75);
  assert.equal(payload.mealCombinationSource.combinationId, 'recipe-1');
  assert.equal(payload.recordedAt.getFullYear(), 2026);
  assert.equal(payload.recordedAt.getMonth(), 5);
  assert.equal(payload.recordedAt.getDate(), 15);
  assert.equal(payload.recordedAt.getHours(), 9);
  assert.equal(payload.recordedAt.getMinutes(), 30);
});

test('dryRun scans legacy food intakes and does not write either collection', async () => {
  const { db, writes } = createDbMock({
    legacyRecords: [
      {
        _id: 'legacy-day-1',
        babyUid: 'baby-1',
        date: '2026-06-15',
        intakes: [
          { _id: 'food-1', type: 'food', foodId: 'rice', nameSnapshot: '米粉', quantity: 30, nutrition: { calories: 90, protein: 2 } },
          { _id: 'milk-1', type: 'milk', milkType: 'breast', quantity: 60 },
          { _id: 'deleted-food', type: 'food', status: 'deleted', foodId: 'apple', quantity: 20 }
        ]
      }
    ]
  });
  const fn = loadFunctionWithMockCloud(db);

  const result = await fn.main({
    babyUid: 'baby-1',
    startDate: '2026-06-15',
    endDate: '2026-06-15',
    dryRun: true,
    pageSize: 20,
    migrationVersion: 'food-v2-test'
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.scannedLegacyRecords, 1);
  assert.equal(result.scannedIntakes, 3);
  assert.equal(result.migratableIntakes, 1);
  assert.equal(result.created, 0);
  assert.equal(result.skippedNonFood, 1);
  assert.equal(result.skippedInactive, 1);
  assert.deepEqual(writes.adds, []);
  assert.deepEqual(writes.updates, []);
  assert.deepEqual(writes.removes, []);
});

test('migration payload includes a logical dedupe key independent of legacy record id', () => {
  const { db } = createDbMock();
  const fn = loadFunctionWithMockCloud(db);
  const intake = {
    _id: 'intake-1',
    foodId: 'rice',
    nameSnapshot: '米粉',
    quantity: 30,
    unit: 'g',
    recordedAt: '09:30',
    mealBatchId: 'meal-a',
    sortOrder: 0,
    nutrition: { calories: 90, protein: 2 }
  };

  const left = fn._internal.buildV2FoodIntakePayloadFromLegacyIntake({
    legacyRecord: { _id: 'legacy-a', babyUid: 'baby-1', date: '2026-06-04' },
    intake,
    migrationVersion: 'food-v2-test',
    migratedAt: '__server_date__'
  });
  const right = fn._internal.buildV2FoodIntakePayloadFromLegacyIntake({
    legacyRecord: { _id: 'legacy-b', babyUid: 'baby-1', date: '2026-06-04' },
    intake,
    migrationVersion: 'food-v2-test',
    migratedAt: '__server_date__'
  });

  assert.equal(left.legacySource.recordId, 'legacy-a');
  assert.equal(right.legacySource.recordId, 'legacy-b');
  assert.match(left.migrationDedupKey, /baby-1\|2026-06-04\|meal-a\|rice\|09:30\|30\|g\|0/);
  assert.equal(left.migrationDedupKey, right.migrationDedupKey);
});

test('cleanupDuplicateMigratedFoodIntakes soft deletes duplicate legacy migration records by logical key', async () => {
  const duplicateKey = 'baby-1|2026-06-04|meal-a|rice|09:30|30|g|0';
  const { db, writes } = createDbMock({
    foodIntakeRecords: [
      {
        _id: 'keep-1',
        babyUid: 'baby-1',
        date: '2026-06-04',
        status: 'active',
        source: 'legacy_migration',
        migrationVersion: 'food-v2-test',
        migrationDedupKey: duplicateKey,
        createdAt: '2026-06-01T00:00:00.000Z'
      },
      {
        _id: 'delete-1',
        babyUid: 'baby-1',
        date: '2026-06-04',
        status: 'active',
        source: 'legacy_migration',
        migrationVersion: 'food-v2-test',
        migrationDedupKey: duplicateKey,
        createdAt: '2026-06-01T00:00:01.000Z'
      },
      {
        _id: 'manual-keep',
        babyUid: 'baby-1',
        date: '2026-06-04',
        status: 'active',
        source: 'meal_editor_v2',
        migrationDedupKey: duplicateKey
      }
    ]
  });
  const fn = loadFunctionWithMockCloud(db);

  const result = await fn.main({
    cleanupDuplicates: true,
    dryRun: false,
    babyUid: 'baby-1',
    startDate: '2026-06-04',
    endDate: '2026-06-10',
    pageSize: 20,
    migrationVersion: 'food-v2-test'
  });

  assert.equal(result.mode, 'cleanupDuplicates');
  assert.equal(result.duplicateGroups, 1);
  assert.equal(result.duplicateRecords, 1);
  assert.deepEqual(writes.updates.map(item => item.docId), ['delete-1']);
  assert.equal(writes.updates[0].data.status, 'deleted');
  assert.equal(writes.updates[0].data.deletedBy, 'migration_duplicate_cleanup');
  assert.equal(writes.removes.length, 0);
});
