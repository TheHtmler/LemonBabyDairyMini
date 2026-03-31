const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadDataRecordsPage() {
  const pagePath = require.resolve('../miniprogram/pages/data-records/index.js');
  delete require.cache[pagePath];
  let pageConfig = null;
  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  global.wx = {
    cloud: {
      database() {
        return {
          command: {
            eq: (value) => ({ $eq: value }),
            in: (value) => ({ $in: value }),
            or: (value) => ({ $or: value })
          },
          collection() {
            return {};
          }
        };
      }
    }
  };
  global.getApp = () => ({ globalData: {} });
  global.Page = (config) => {
    pageConfig = config;
  };
  require(pagePath);
  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;
  return pageConfig;
}

test('data-records page uses compact summary layout and basic info modal', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pages/data-records/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /hero-badge-edit/);
  assert.match(wxml, /nutrition-strip/);
  assert.match(wxml, /ratio-inline-list/);
  assert.match(wxml, /overview-stat-compact-grid/);
  assert.match(wxml, /basic-info-modal/);
  assert.doesNotMatch(wxml, /section-subtitle">基础信息/);
  assert.doesNotMatch(wxml, /section-subtitle">热量统计/);
});

test('data-records summaryPreview falls back to computed protein coefficients when input fields are empty', () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      formattedSelectedDate: '2026年3月30日',
      weight: 5.5,
      height: 58,
      totalMilk: 720,
      dailyCaloriesTotal: 685,
      caloriePerKg: 124.5,
      proteinSummaryDisplay: {
        natural: '8.3',
        special: '4.1',
        total: '12.4'
      },
      naturalProteinCoefficientInput: '',
      specialProteinCoefficientInput: '',
      naturalProteinCoefficient: 1.5,
      specialProteinCoefficient: 0.7,
      calorieGoalPerKgRange: {
        min: 120,
        max: 135,
        label: '稳定期'
      },
      macroRatios: {
        protein: 12,
        carbs: 48,
        fat: 40
      },
      fatRatioPopupLines: [],
      intakeOverview: {
        milk: {
          normal: { volume: 420, calories: 260, protein: 5.1, carbs: 28, fat: 12 },
          special: { volume: 300, calories: 180, protein: 4.8, carbs: 18, fat: 8 }
        },
        food: {
          count: 2,
          totalCalories: 160,
          naturalProtein: 3.2,
          specialProtein: 0,
          carbs: 18,
          fat: 4
        },
        treatment: {
          count: 1,
          totalCalories: 85,
          protein: 0,
          carbs: 25,
          fat: 0
        }
      },
      feedings: [{ naturalMilkType: 'breast' }]
    },
    inferNaturalMilkType: page.inferNaturalMilkType
  };

  const preview = page.buildSummaryPreviewData.call(instance);

  assert.equal(preview.nutritionStrip[0].detail, '1.5 g/kg/d');
  assert.equal(preview.nutritionStrip[1].detail, '0.7 g/kg/d');
});

test('data-records uses per-day basicInfo snapshot for historical dates instead of latest babyInfo', () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      selectedDate: '2026-03-20',
      babyInfo: {
        weight: 6.2,
        height: 63
      }
    },
    isTodayDate: page.isTodayDate,
    formatDate() {
      return '2026-03-30';
    }
  };

  const snapshot = page.resolveBasicInfoSnapshot.call(instance, {}, '2026-03-20');

  assert.equal(snapshot.weight, '');
  assert.equal(snapshot.height, '');
  assert.equal(snapshot.weightSource, 'empty');
  assert.equal(snapshot.heightSource, 'empty');
});

test('data-records only falls back to latest babyInfo on today when no daily basicInfo exists', () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      selectedDate: '2026-03-30',
      babyInfo: {
        weight: 6.2,
        height: 63
      }
    },
    isTodayDate: page.isTodayDate,
    formatDate() {
      return '2026-03-30';
    }
  };

  const snapshot = page.resolveBasicInfoSnapshot.call(instance, {}, '2026-03-30');

  assert.equal(snapshot.weight, 6.2);
  assert.equal(snapshot.height, 63);
  assert.equal(snapshot.weightSource, 'global');
  assert.equal(snapshot.heightSource, 'global');
});

test('data-records reuses latest historical snapshot for later empty dates', () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      selectedDate: '2026-01-21',
      babyInfo: {
        weight: 12.3,
        height: 82
      }
    },
    isTodayDate: page.isTodayDate,
    formatDate() {
      return '2026-03-30';
    }
  };

  const snapshot = page.resolveBasicInfoSnapshot.call(instance, {}, '2026-01-21', {
    weight: 11,
    height: 80,
    weightSource: 'history-feeding',
    heightSource: 'history-feeding'
  });

  assert.equal(snapshot.weight, 11);
  assert.equal(snapshot.height, 80);
  assert.equal(snapshot.weightSource, 'history-feeding');
  assert.equal(snapshot.heightSource, 'history-feeding');
});

test('data-records prefers growth record over feeding basicInfo when snapshots share the same day', () => {
  const page = loadDataRecordsPage();
  const snapshot = page.pickHistoricalBasicInfoSnapshot(
    {
      weight: 11,
      height: 80,
      weightSource: 'history-feeding',
      heightSource: 'history-feeding',
      weightTimestamp: new Date('2026-01-20T00:00:00+08:00').getTime(),
      heightTimestamp: new Date('2026-01-20T00:00:00+08:00').getTime()
    },
    {
      weight: 11.2,
      height: 80.5,
      weightSource: 'history-growth',
      heightSource: 'history-growth',
      weightTimestamp: new Date('2026-01-20T00:00:00+08:00').getTime(),
      heightTimestamp: new Date('2026-01-20T00:00:00+08:00').getTime()
    }
  );

  assert.equal(snapshot.weight, 11.2);
  assert.equal(snapshot.height, 80.5);
  assert.equal(snapshot.weightSource, 'history-growth');
  assert.equal(snapshot.heightSource, 'history-growth');
});

test('data-records does not persist global fallback weight into historical record creation', () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      selectedDate: '2026-03-20',
      weight: 6.2,
      height: 63,
      naturalProteinCoefficientInput: '',
      specialProteinCoefficientInput: '',
      weightSource: 'global',
      heightSource: 'global'
    },
    isNumberValue: page.isNumberValue,
    isTodayDate: page.isTodayDate,
    formatDate() {
      return '2026-03-30';
    }
  };

  const basicInfo = page.buildPersistedBasicInfoForDate.call(instance, {}, '2026-03-20');

  assert.equal(basicInfo.weight, '');
  assert.equal(basicInfo.height, '');
});
