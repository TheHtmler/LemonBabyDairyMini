const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const functionDir = path.join('cloudfunctions', 'backfillGrowthRecordsV2');
const indexPath = path.join(functionDir, 'index.js');

function loadFunctionWithMockCloud() {
  const resolved = require.resolve(path.join('..', indexPath));
  const previousLoad = Module._load;
  delete require.cache[resolved];

  Module._load = function mockWxServerSdk(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test-env',
        init() {},
        database() {
          return {
            serverDate() {
              return '__server_date__';
            },
            collection(name) {
              throw new Error(`unexpected collection in helper test: ${name}`);
            }
          };
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

test('backfillGrowthRecordsV2 cloud function reads legacy records and writes growth_records_v2 only', () => {
  assert.equal(fs.existsSync(indexPath), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'config.json')), true);

  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /LEGACY_FEEDING_RECORDS_COLLECTION\s*=\s*'feeding_records'/);
  assert.match(source, /GROWTH_RECORDS_V2_COLLECTION\s*=\s*'growth_records_v2'/);
  assert.match(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)/);
  assert.match(source, /collection\(GROWTH_RECORDS_V2_COLLECTION\)/);
  assert.match(source, /legacyGrowthCollections/);
  assert.match(source, /carryForward/);
  assert.match(source, /sourceDate/);
  assert.match(source, /dryRun/);
  assert.match(source, /maxBatches/);
  assert.match(source, /nextOffset/);
  assert.doesNotMatch(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)\.doc\([^)]*\)\.update/);
  assert.doesNotMatch(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)\.doc\([^)]*\)\.remove/);
});

test('buildBackfillPlan carries latest measurements into missing business dates without overwriting existing values', () => {
  const fn = loadFunctionWithMockCloud();
  const plan = fn._internal.buildBackfillPlan({
    babyUid: 'baby-1',
    businessDates: ['2026-05-01', '2026-05-02', '2026-05-03'],
    sourceSnapshots: [
      {
        date: '2026-05-01',
        source: 'legacy_feeding_basic_info',
        basicInfo: {
          weight: 5.1,
          height: 58,
          naturalProteinCoefficient: 1.2
        }
      },
      {
        date: '2026-05-03',
        source: 'legacy_feeding_basic_info',
        basicInfo: {
          weight: 5.3
        }
      }
    ],
    existingGrowthRecords: [
      {
        _id: 'growth-existing',
        babyUid: 'baby-1',
        date: '2026-05-03',
        status: 'active',
        weight: 5.35,
        height: ''
      }
    ],
    timestamp: '__server_date__'
  });

  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((item) => ({
    date: item.date,
    carryForward: item.carryForward,
    sourceDate: item.sourceDate,
    action: item.action,
    weight: item.data.weight,
    height: item.data.height
  })), [
    {
      date: '2026-05-01',
      carryForward: false,
      sourceDate: '2026-05-01',
      action: 'add',
      weight: 5.1,
      height: 58
    },
    {
      date: '2026-05-02',
      carryForward: true,
      sourceDate: '2026-05-01',
      action: 'add',
      weight: 5.1,
      height: 58
    },
    {
      date: '2026-05-03',
      carryForward: false,
      sourceDate: '2026-05-03',
      action: 'update',
      weight: 5.35,
      height: 58
    }
  ]);
});

test('formatDateKey normalizes cloud Date values into YYYY-MM-DD', () => {
  const fn = loadFunctionWithMockCloud();

  assert.equal(
    fn._internal.formatDateKey(new Date('2026-05-26T16:00:00.000Z')),
    '2026-05-27'
  );
});

test('buildBackfillPlan can carry a previous initial snapshot into the first business date', () => {
  const fn = loadFunctionWithMockCloud();
  const plan = fn._internal.buildBackfillPlan({
    babyUid: 'baby-1',
    businessDates: ['2026-05-02'],
    sourceSnapshots: [
      {
        date: '2026-05-01',
        source: 'baby_info_initial',
        basicInfo: {
          weight: 5,
          height: 57
        }
      }
    ],
    timestamp: '__server_date__'
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].date, '2026-05-02');
  assert.equal(plan[0].sourceDate, '2026-05-01');
  assert.equal(plan[0].carryForward, true);
  assert.equal(plan[0].data.weight, 5);
  assert.equal(plan[0].data.height, 57);
});
