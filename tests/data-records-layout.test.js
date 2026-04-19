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
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pages/data-records/index.wxss'),
    'utf8'
  );

  assert.match(wxml, /hero-badge-edit/);
  assert.match(wxml, /nutrition-strip/);
  assert.match(wxml, /nutrition-pill-source-block/);
  assert.match(wxml, /nutrition-pill-source-accent/);
  assert.match(wxml, /优质蛋白 \{\{item\.premiumValue\}\}g · \{\{item\.premiumRatio\}\}%/);
  assert.match(wxml, /ratio-inline-list/);
  assert.match(wxml, /overview-stat-compact-grid/);
  assert.match(wxml, /basic-info-modal/);
  assert.doesNotMatch(wxml, /nutrition-pill-protein-row/);
  assert.doesNotMatch(wxml, /class="ratio-inline-value" wx:if="\{\{item\.premiumRatio > 0\}\}"/);
  assert.doesNotMatch(wxml, /section-subtitle">基础信息/);
  assert.doesNotMatch(wxml, /section-subtitle">热量统计/);
  assert.match(wxss, /\.nutrition-pill\{[^}]*padding:20rpx/);
  assert.match(wxss, /\.nutrition-pill\{[^}]*border-radius:24rpx/);
  assert.match(wxss, /\.nutrition-pill-label\{[^}]*font-size:22rpx/);
  assert.match(wxss, /\.nutrition-pill-metric\{[^}]*margin-top:10rpx/);
  assert.match(wxss, /\.nutrition-pill-source-row\{[^}]*display:flex/);
  assert.match(wxss, /\.nutrition-pill-source-block\{/);
  assert.match(wxss, /\.nutrition-pill-source-accent\{[^}]*white-space:nowrap/);
  assert.match(wxss, /\.nutrition-pill-source-accent\{/);
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

test('data-records summaryPreview prefers computed protein coefficients over stale input values', () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      formattedSelectedDate: '2026年4月18日',
      weight: 13.5,
      height: 92,
      totalMilk: 540,
      dailyCaloriesTotal: 920,
      caloriePerKg: 68.1,
      proteinSummaryDisplay: {
        natural: '11.92',
        special: '0.00',
        total: '11.92'
      },
      naturalProteinCoefficientInput: '0.85',
      specialProteinCoefficientInput: '',
      naturalProteinCoefficient: 0.88,
      specialProteinCoefficient: '',
      calorieGoalPerKgRange: {
        min: 60,
        max: 80,
        label: '当前年龄段推荐'
      },
      macroRatios: {
        protein: 14,
        carbs: 46,
        fat: 40
      },
      fatRatioPopupLines: [],
      intakeOverview: {
        milk: {
          normal: { volume: 540, calories: 362, protein: 5.19, carbs: 0, fat: 0 },
          special: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0 }
        },
        food: {
          count: 3,
          totalCalories: 558,
          naturalProtein: 6.73,
          specialProtein: 0,
          carbs: 40,
          fat: 18
        },
        treatment: {
          count: 0,
          totalCalories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        }
      },
      feedings: [{ naturalMilkType: 'breast' }]
    },
    inferNaturalMilkType: page.inferNaturalMilkType
  };

  const preview = page.buildSummaryPreviewData.call(instance);

  assert.equal(preview.nutritionStrip[0].detail, '0.88 g/kg/d');
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

test('data-records edit food save refreshes protein source from latest food catalog snapshot', async () => {
  const page = loadDataRecordsPage();
  const instance = {
    data: {
      foodCatalog: [
        {
          _id: 'food-1',
          name: '测试食物',
          baseUnit: 'g',
          category: '乳类及制品',
          proteinSource: 'special',
          proteinQuality: '',
          milkType: '',
          aliasText: ''
        }
      ],
      foodIntakes: [
        {
          _id: 'intake-1',
          foodId: 'food-1',
          nameSnapshot: '测试食物',
          unit: 'g',
          category: '乳类及制品',
          proteinSource: 'natural',
          proteinQuality: 'premium',
          quantity: 25,
          nutrition: { protein: 2.5 },
          naturalProtein: 2.5,
          specialProtein: 0,
          recordedAt: '12:00',
          notes: ''
        }
      ],
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1,
      foodExperiment: {},
      newFoodIntake: {}
    },
    _getFoodUnit: page._getFoodUnit,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    initFoodExperimentCategories() {},
    filterFoodExperimentOptions() {},
    async saveFoodIntake() {
      assert.equal(this.data.newFoodIntake.proteinSource, 'special');
    },
    hideFoodIntakeExperimentModal() {}
  };

  page.openEditFoodModal.call(instance, {
    currentTarget: {
      dataset: { id: 'intake-1' }
    }
  });

  assert.equal(instance.data.foodExperiment.food.proteinSource, 'special');

  await page.saveFoodIntakeExperiment.call(instance);
});
