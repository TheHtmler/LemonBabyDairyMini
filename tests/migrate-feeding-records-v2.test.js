const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const functionDir = path.join('cloudfunctions', 'migrateFeedingRecordsV2');
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

test('migrateFeedingRecordsV2 cloud function copies legacy milk feedings into feeding_records_v2 only', () => {
  assert.equal(fs.existsSync(indexPath), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'config.json')), true);

  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /LEGACY_FEEDING_RECORDS_COLLECTION\s*=\s*'feeding_records'/);
  assert.match(source, /FEEDING_RECORDS_V2_COLLECTION\s*=\s*'feeding_records_v2'/);
  assert.match(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)/);
  assert.match(source, /collection\(FEEDING_RECORDS_V2_COLLECTION\)/);
  assert.match(source, /dryRun/);
  assert.match(source, /migrationVersion/);
  assert.match(source, /maxBatches/);
  assert.match(source, /nextOffset/);
  assert.match(source, /hasMore/);
  assert.match(source, /startDate/);
  assert.match(source, /endDate/);
  assert.match(source, /formatDateKey/);
  assert.match(source, /repairExistingDates/);
  assert.match(source, /repairExistingMigratedDates/);
  assert.match(source, /queryExistingMigratedRecordsForLegacyDay/);
  assert.match(source, /existingMigratedIndices/);
  assert.match(source, /if\s*\(!dryRun\)\s*\{\s*existingMigratedIndices\s*=\s*await queryExistingMigratedRecordsForLegacyDay/s);
  assert.match(source, /powderVersionRules/);
  assert.match(source, /legacyRecordId/);
  assert.match(source, /legacyFeedingIndex/);
  assert.match(source, /nutritionAccuracy/);
  assert.doesNotMatch(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)\.doc\([^)]*\)\.update/);
  assert.doesNotMatch(source, /collection\(LEGACY_FEEDING_RECORDS_COLLECTION\)\.doc\([^)]*\)\.remove/);
});

test('buildMigratedFeedingRecord normalizes legacy Date values into YYYY-MM-DD date keys', () => {
  const fn = loadFunctionWithMockCloud();
  const migrated = fn._internal.buildMigratedFeedingRecord({
    legacyRecord: {
      _id: 'legacy-day-date-object',
      babyUid: 'baby-1',
      date: new Date('2026-05-26T16:00:00.000Z')
    },
    feeding: {
      startTime: '07:10',
      naturalMilkType: 'breast',
      naturalMilkVolume: 60
    },
    feedingIndex: 0,
    profile: {
      breastMilk: {
        nutritionPer100ml: {
          protein: 1.1,
          calories: 67
        }
      },
      formulaPowders: []
    },
    migrationVersion: 'milk-v2-test',
    migratedAt: '__server_date__'
  });

  assert.equal(migrated.date, '2026-05-27');
  assert.equal(migrated.startDateTime.getFullYear(), 2026);
  assert.equal(migrated.startDateTime.getMonth(), 4);
  assert.equal(migrated.startDateTime.getDate(), 27);
  assert.equal(migrated.startDateTime.getHours(), 7);
  assert.equal(migrated.startDateTime.getMinutes(), 10);
});

test('buildMigratedFeedingRecord preserves explicit powder weights and uses default milk profiles', () => {
  const fn = loadFunctionWithMockCloud();
  const migrated = fn._internal.buildMigratedFeedingRecord({
    legacyRecord: {
      _id: 'legacy-day-1',
      babyUid: 'baby-1',
      date: '2026-05-01',
      basicInfo: {
        weight: 5.2,
        height: 61,
        naturalProteinCoefficient: 1.2
      }
    },
    feeding: {
      startTime: '08:30',
      endTime: '08:45',
      naturalMilkType: 'formula',
      naturalMilkVolume: 80,
      formulaPowderWeight: 6.4,
      specialMilkVolume: 40,
      specialMilkPowder: 6
    },
    feedingIndex: 2,
    profile: {
      breastMilk: {
        nutritionPer100ml: {
          protein: 1.1,
          calories: 67
        }
      },
      formulaPowders: [
        {
          id: 'regular',
          name: '普奶',
          category: 'regular_formula',
          proteinRole: 'natural',
          mixRatio: { powder: 8, water: 100 },
          nutritionPer100g: { protein: 10, calories: 500 }
        },
        {
          id: 'special',
          name: '特奶',
          category: 'special_formula',
          proteinRole: 'special',
          mixRatio: { powder: 15, water: 100 },
          nutritionPer100g: { protein: 13, calories: 480 }
        }
      ]
    },
    migrationVersion: 'milk-v2-test',
    migratedAt: '__server_date__'
  });

  assert.equal(migrated.babyUid, 'baby-1');
  assert.equal(migrated.date, '2026-05-01');
  assert.equal(migrated.source, 'legacy_migration');
  assert.equal(migrated.legacyRecordId, 'legacy-day-1');
  assert.equal(migrated.legacyFeedingIndex, 2);
  assert.equal(migrated.nutritionAccuracy, 'estimated_current_profile');
  assert.equal(migrated.formulaComponents.length, 2);
  assert.equal(migrated.formulaComponents[0].powderName, '普奶');
  assert.equal(migrated.formulaComponents[0].powderWeight, 6.4);
  assert.equal(migrated.formulaComponents[1].powderName, '特奶');
  assert.equal(migrated.formulaComponents[1].powderWeight, 6);
  assert.equal(migrated.nutritionSummary.totalVolume, 120);
  assert.equal(migrated.basicInfoSnapshot.weight, 5.2);
});

test('buildMigratedFeedingRecord warns and records dropped special milk when the profile lacks a special powder', () => {
  const fn = loadFunctionWithMockCloud();
  const migrated = fn._internal.buildMigratedFeedingRecord({
    legacyRecord: {
      _id: 'legacy-day-missing-special',
      babyUid: 'baby-1',
      date: '2026-05-01'
    },
    feeding: {
      startTime: '08:00',
      naturalMilkType: 'breast',
      naturalMilkVolume: 59,
      specialMilkVolume: 61,
      specialMilkPowder: 9.15
    },
    feedingIndex: 0,
    profile: {
      breastMilk: {
        nutritionPer100ml: { protein: 1.1, calories: 67 }
      },
      // 只有普奶，没有特奶档案
      formulaPowders: [
        {
          id: 'regular',
          name: '普奶',
          category: 'regular_formula',
          proteinRole: 'natural',
          mixRatio: { powder: 8, water: 100 },
          nutritionPer100g: { protein: 10, calories: 500 }
        }
      ]
    },
    migrationVersion: 'milk-v2-test',
    migratedAt: '__server_date__'
  });

  // 母乳仍保留，但特奶组件因缺档案不能静默丢弃：必须有 warning + droppedComponents 记录
  assert.equal(migrated.formulaComponents.length, 1);
  assert.equal(migrated.formulaComponents[0].kind, 'breast_milk');
  assert.equal(migrated.migrationDroppedComponents.length, 1);
  assert.equal(migrated.migrationDroppedComponents[0].category, 'special_formula');
  assert.equal(migrated.migrationDroppedComponents[0].waterVolume, 61);
  assert.equal(migrated.migrationDroppedComponents[0].reason, 'missing_powder_profile');
  assert.equal(migrated.migrationWarnings.some((text) => /特奶/.test(text)), true);
});

test('buildMigratedFeedingRecord optionally selects historical powder profiles by date range', () => {
  const fn = loadFunctionWithMockCloud();
  const migrated = fn._internal.buildMigratedFeedingRecord({
    legacyRecord: {
      _id: 'legacy-day-2',
      babyUid: 'baby-1',
      date: '2026-02-15'
    },
    feeding: {
      startTime: '09:00',
      specialMilkVolume: 90
    },
    feedingIndex: 0,
    profile: {
      formulaPowders: [
        {
          id: 'special-current',
          name: '特奶',
          category: 'special_formula',
          proteinRole: 'special',
          mixRatio: { powder: 15, water: 100 },
          nutritionPer100g: { protein: 13, calories: 480 }
        },
        {
          id: 'special-old',
          name: '特奶旧版',
          category: 'special_formula',
          proteinRole: 'special',
          mixRatio: { powder: 12, water: 100 },
          nutritionPer100g: { protein: 10, calories: 460 }
        }
      ]
    },
    powderVersionRules: {
      special_formula: [
        {
          id: 'old-special-rule',
          powderId: 'special-old',
          startDate: '2026-01-01',
          endDate: '2026-03-01'
        }
      ]
    },
    migrationVersion: 'milk-v2-test',
    migratedAt: '__server_date__'
  });

  assert.equal(migrated.formulaComponents.length, 1);
  assert.equal(migrated.formulaComponents[0].powderId, 'special-old');
  assert.equal(migrated.formulaComponents[0].powderName, '特奶旧版');
  assert.equal(migrated.formulaComponents[0].powderWeight, 10.8);
  assert.equal(migrated.nutritionAccuracy, 'matched_powder_version_rule');
  assert.equal(migrated.migrationPowderRules.special_formula.matched, true);
  assert.equal(migrated.migrationPowderRules.special_formula.ruleId, 'old-special-rule');
});
