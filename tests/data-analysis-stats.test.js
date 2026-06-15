const test = require('node:test');
const assert = require('node:assert/strict');

function loadDataAnalysisPage() {
  const pagePath = require.resolve('../miniprogram/pkg-report/data-analysis/index.js');
  const nutritionPath = require.resolve('../miniprogram/models/nutrition.js');
  delete require.cache[pagePath];
  delete require.cache[nutritionPath];

  let pageConfig = null;
  const previousPage = global.Page;
  const previousWx = global.wx;

  global.wx = {
    cloud: {
      database() {
        return {
          collection() {
            return {
              where() {
                return this;
              },
              get() {
                return Promise.resolve({ data: [] });
              }
            };
          }
        };
      }
    }
  };
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  global.Page = previousPage;
  global.wx = previousWx;
  return pageConfig;
}

function createPageInstance(pageConfig, data = {}) {
  return {
    ...pageConfig,
    data: {
      nutritionSettings: {},
      ...data
    },
    setData(update) {
      this.data = {
        ...this.data,
        ...update
      };
    }
  };
}

async function withMutedConsole(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

async function withWxAndApp(wxMock, appMock, callback) {
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  global.wx = wxMock;
  global.getApp = () => appMock;
  try {
    return await callback();
  } finally {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  }
}

async function withFixedNow(isoString, callback) {
  const RealDate = global.Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        return new RealDate(isoString);
      }
      return new RealDate(...args);
    }

    static now() {
      return new RealDate(isoString).getTime();
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }

  global.Date = FixedDate;
  try {
    return await callback();
  } finally {
    global.Date = RealDate;
  }
}

test('data-analysis derives special milk from legacy totalVolume when computing statistics', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67
    }
  });
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 5 },
      feedings: [
        {
          naturalMilkVolume: '30',
          totalVolume: '50',
          naturalMilkType: 'breast'
        }
      ]
    }
  ], date, date));

  assert.equal(instance.data.statistics.avgMilkVolume, 50);
  assert.equal(instance.data.statistics.avgNaturalMilk, 30);
  assert.equal(instance.data.statistics.avgSpecialMilk, 20);
  assert.equal(instance.data.chartData.totalCalories[0], 34);
});

test('data-analysis uses v2 feeding nutrition snapshot instead of recomputing from legacy settings', () => {
  const page = loadDataAnalysisPage();
  // 旧配奶参数刻意与 v2 快照不同：若仍用旧参数重算，热量不会等于 v2 快照值
  const instance = createPageInstance(page, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      special_milk_protein: 13.1,
      special_milk_calories: 480,
      special_milk_ratio: { powder: 13.5, water: 90 }
    }
  });
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 5 },
      feedings: [
        {
          isV2FeedingRecord: true,
          naturalMilkType: 'breast',
          naturalMilkVolume: 59,
          specialMilkVolume: 61,
          nutritionDisplay: {
            calories: 100,
            naturalProtein: 0.65,
            specialProtein: 7.99,
            carbs: 5,
            fat: 3
          }
        }
      ]
    }
  ], date, date));

  assert.equal(instance.data.statistics.avgMilkVolume, 120);
  assert.equal(instance.data.statistics.avgNaturalMilk, 59);
  assert.equal(instance.data.statistics.avgSpecialMilk, 61);
  // 热量取 v2 快照（100），不是旧参数重算值
  assert.equal(instance.data.chartData.totalCalories[0], 100);
});

test('data-analysis merges multiple feeding_records from the same day before aggregation', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 5 },
      feedings: [
        {
          naturalMilkVolume: '30',
          specialMilkVolume: '10',
          naturalMilkType: 'breast'
        }
      ]
    },
    {
      date,
      basicInfo: { weight: 5 },
      feedings: [
        {
          naturalMilkVolume: '20',
          specialMilkVolume: '15',
          naturalMilkType: 'breast'
        }
      ]
    }
  ], date, date));

  assert.equal(instance.data.statistics.avgMilkVolume, 75);
  assert.equal(instance.data.statistics.avgNaturalMilk, 50);
  assert.equal(instance.data.statistics.avgSpecialMilk, 25);
  assert.equal(instance.data.statistics.totalDays, 1);
});

test('data-analysis includes milk intakes in milk volume chart data', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 6 },
      intakes: [
        {
          type: 'milk',
          quantity: '120',
          proteinSource: 'natural',
          nutrition: {
            calories: 80,
            protein: 1.8
          },
          naturalProtein: 1.8,
          specialProtein: 0
        },
        {
          type: 'milk',
          quantity: '60',
          proteinSource: 'special',
          milkType: 'special_formula',
          nutrition: {
            calories: 42,
            protein: 2.4
          },
          naturalProtein: 0,
          specialProtein: 2.4
        }
      ]
    }
  ], date, date));

  assert.equal(instance.data.chartData.milkVolumes[0], 180);
  assert.equal(instance.data.chartData.naturalMilk[0], 120);
  assert.equal(instance.data.chartData.specialMilk[0], 60);
  assert.equal(instance.data.chartData.totalCalories[0], 122);
  assert.equal(instance.data.chartData.totalProteinCoefficient[0], 0.7);
});

test('data-analysis uses historical weight snapshot for coefficient chart data', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67
    }
  });
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      feedings: [
        {
          naturalMilkVolume: '500',
          naturalMilkType: 'breast'
        }
      ]
    }
  ], date, date, {
    '2026-03-20': {
      weight: 5,
      weightSource: 'history-feeding'
    }
  }));

  assert.equal(instance.data.chartData.calorieCoefficient[0], 67);
  assert.equal(instance.data.chartData.naturalProteinCoefficient[0], 1.1);
  assert.equal(instance.data.chartData.totalProteinCoefficient[0], 1.1);
  assert.equal(instance.data.statistics.avgCalorieCoefficient, 67);
  assert.equal(instance.data.statistics.avgTotalProteinCoefficient, 1.1);
});

test('data-analysis averages coefficient statistics only across days with valid weight', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67
    }
  });
  const startDate = new Date('2026-03-20T00:00:00+08:00');
  const endDate = new Date('2026-03-21T23:59:59+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date: startDate,
      basicInfo: { weight: 5 },
      feedings: [
        {
          naturalMilkVolume: '100',
          naturalMilkType: 'breast'
        }
      ]
    },
    {
      date: new Date('2026-03-21T00:00:00+08:00'),
      feedings: [
        {
          naturalMilkVolume: '100',
          naturalMilkType: 'breast'
        }
      ]
    }
  ], startDate, endDate));

  assert.equal(instance.data.statistics.totalDays, 2);
  assert.equal(instance.data.statistics.rangeDays, 2);
  assert.equal(instance.data.statistics.avgTotalProteinCoefficient, 0.22);
  assert.equal(instance.data.statistics.avgCalorieCoefficient, 13.4);
});

test('data-analysis exposes premium and regular protein ratio chart data from intakes', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 5 },
      intakes: [
        {
          type: 'food',
          quantity: '10',
          proteinQuality: 'premium',
          nutrition: {
            calories: 10,
            protein: 2
          },
          naturalProtein: 2,
          specialProtein: 0
        },
        {
          type: 'food',
          quantity: '10',
          proteinQuality: 'regular',
          nutrition: {
            calories: 10,
            protein: 3
          },
          naturalProtein: 3,
          specialProtein: 0
        }
      ]
    }
  ], date, date));

  assert.equal(instance.data.chartData.premiumProteinRatio[0], 40);
  assert.equal(instance.data.chartData.regularProteinRatio[0], 60);
  assert.equal(instance.data.statistics.avgPremiumProteinRatio, 40);
  assert.equal(instance.data.statistics.avgRegularProteinRatio, 60);
});

test('data-analysis computes average macro energy ratios for overview', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      natural_milk_carbs: 6.8,
      natural_milk_fat: 4
    }
  });
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 5 },
      intakes: [
        {
          type: 'food',
          nutrition: {
            calories: 100,
            protein: 5,
            carbs: 10,
            fat: 2
          },
          naturalProtein: 5,
          specialProtein: 0
        }
      ],
      feedings: [
        {
          naturalMilkVolume: '100',
          naturalMilkType: 'breast'
        }
      ]
    }
  ], date, date));

  assert.equal(instance.data.statistics.avgProteinEnergyRatio, 16.8);
  assert.equal(instance.data.statistics.avgCarbsEnergyRatio, 46.2);
  assert.equal(instance.data.statistics.avgFatEnergyRatio, 37.1);
});

test('data-analysis exposes calorie source averages and ratios', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      natural_milk_carbs: 6.8,
      natural_milk_fat: 4
    }
  });
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([
    {
      date,
      basicInfo: { weight: 5 },
      intakes: [
        {
          type: 'food',
          nutrition: {
            calories: 33,
            protein: 1,
            carbs: 5,
            fat: 1
          },
          naturalProtein: 1,
          specialProtein: 0
        }
      ],
      feedings: [
        {
          naturalMilkVolume: '100',
          naturalMilkType: 'breast'
        }
      ]
    }
  ], date, date, {}, [
    {
      dateKey: '2026-03-20',
      summary: {
        totalCalories: 100,
        carbs: 25,
        protein: 0,
        fat: 0
      }
    }
  ]));

  assert.equal(instance.data.statistics.avgCalories, 200);
  assert.equal(instance.data.statistics.avgMilkCalories, 67);
  assert.equal(instance.data.statistics.avgFoodCalories, 33);
  assert.equal(instance.data.statistics.avgTreatmentCalories, 100);
  assert.equal(instance.data.statistics.milkCalorieRatio, 33.5);
  assert.equal(instance.data.statistics.foodCalorieRatio, 16.5);
  assert.equal(instance.data.statistics.treatmentCalorieRatio, 50);
  assert.equal(instance.data.statistics.hasCalorieSourceBreakdown, true);
});

test('data-analysis includes treatment nutrition in calories and macro ratios', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const date = new Date('2026-03-20T00:00:00+08:00');

  withMutedConsole(() => instance.processAnalysisData([], date, date, {}, [
    {
      dateKey: '2026-03-20',
      groups: [
        {
          items: [
            {
              category: 'dextrose_10',
              calories: 120,
              carbsG: 30,
              proteinG: 0,
              fatG: 0,
              countInNutrition: true
            }
          ]
        }
      ]
    }
  ]));

  assert.equal(instance.data.statistics.totalDays, 1);
  assert.equal(instance.data.statistics.avgCalories, 120);
  assert.equal(instance.data.statistics.avgTreatmentCalories, 120);
  assert.equal(instance.data.statistics.avgCarbsEnergyRatio, 100);
  assert.equal(instance.data.chartData.totalCalories[0], 120);
});

test('data-analysis marks today as default chart crosshair index', async () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const startDate = new Date('2026-05-01T00:00:00+08:00');
  const endDate = new Date('2026-05-03T23:59:59+08:00');

  await withFixedNow('2026-05-02T12:00:00+08:00', () => {
    withMutedConsole(() => instance.processAnalysisData([], startDate, endDate));
  });

  assert.deepEqual(instance.data.chartData.dateKeys, ['2026-05-01', '2026-05-02', '2026-05-03']);
  assert.equal(instance.data.chartData.defaultCrosshairIndex, 1);
});

test('data-analysis leaves default chart crosshair unset when today is outside range', async () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const startDate = new Date('2026-05-01T00:00:00+08:00');
  const endDate = new Date('2026-05-03T23:59:59+08:00');

  await withFixedNow('2026-05-10T12:00:00+08:00', () => {
    withMutedConsole(() => instance.processAnalysisData([], startDate, endDate));
  });

  assert.equal(instance.data.chartData.defaultCrosshairIndex, -1);
});

test('data-analysis load includes treatment-only records as analysis data', async () => {
  const page = loadDataAnalysisPage();
  const date = new Date('2026-03-20T00:00:00+08:00');
  const treatmentRecords = [
    {
      dateKey: '2026-03-20',
      summary: {
        totalCalories: 80,
        carbs: 20,
        protein: 0,
        fat: 0
      }
    }
  ];
  const instance = createPageInstance(page, {
    hasLoadedAnalysis: true,
    timeDimension: 'week',
    selectedWeek: 0,
    selectedMonth: 0
  });
  let receivedTreatmentRecords = null;

  instance.calculateDateRange = () => ({ startDate: date, endDate: date });
  instance.updateDateRangeText = () => {};
  instance.fetchFeedingRecords = async () => [];
  instance.fetchTreatmentRecords = async () => treatmentRecords;
  instance.loadAnalysisBasicInfoSnapshots = async () => ({});
  instance.processAnalysisData = (records, startDate, endDate, snapshots, treatments) => {
    receivedTreatmentRecords = treatments;
  };
  instance.initCharts = () => {};

  await withMutedConsole(() => instance.loadAnalysisData());

  assert.equal(instance.data.hasData, true);
  assert.deepEqual(receivedTreatmentRecords, treatmentRecords);
});

test('data-analysis exposes conservative reference ranges for overview metrics', () => {
  const page = loadDataAnalysisPage();

  assert.equal(page.data.referenceRanges.naturalProteinCoefficient, '1.2g/kg/日');
  assert.equal(page.data.referenceRanges.proteinEnergy, '参考 10%-15%');
  assert.equal(page.data.referenceRanges.carbsEnergy, '参考 55%-60%');
  assert.equal(page.data.referenceRanges.fatEnergy, '0-6月: 45%-50%；>6月: 35%-40%；1-2岁: 30%-35%；>6岁: 25%-30%');
  assert.equal(page.data.referenceRanges.premiumProteinRatio, undefined);
});

test('data-analysis uses selected range date to show one fat energy reference', () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page, {
    babyInfo: {
      birthday: '2025-01-01'
    },
    nutritionSettings: {}
  });
  const startDate = new Date('2026-05-01T00:00:00+08:00');
  const endDate = new Date('2026-05-14T23:59:59+08:00');

  withMutedConsole(() => instance.processAnalysisData([], startDate, endDate));

  assert.equal(instance.data.referenceRanges.fatEnergy, '1-2岁: 30%-35%');
});

test('data-analysis current period date ranges stop at today instead of future days', async () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);

  await withFixedNow('2026-05-14T12:00:00+08:00', () => {
    const currentWeek = instance.calculateDateRange('week', 0, 0);
    const currentMonth = instance.calculateDateRange('month', 0, 0);
    const previousWeek = instance.calculateDateRange('week', -1, 0);

    assert.equal(instance.formatDateKey(currentWeek.endDate), '2026-05-14');
    assert.equal(instance.formatDateKey(currentMonth.endDate), '2026-05-14');
    assert.equal(instance.formatDateKey(previousWeek.endDate), '2026-05-10');
  });
});

test('data-analysis keeps existing page visible during period refresh', async () => {
  const page = loadDataAnalysisPage();
  const setDataCalls = [];
  const instance = createPageInstance(page, {
    loading: false,
    refreshing: false,
    hasLoadedAnalysis: true,
    hasData: true,
    timeDimension: 'week',
    selectedWeek: 0,
    selectedMonth: 0
  });
  const originalSetData = instance.setData;
  instance.setData = function(update) {
    setDataCalls.push(update);
    originalSetData.call(this, update);
  };
  instance.fetchFeedingRecords = async () => [];
  instance.fetchTreatmentRecords = async () => [];
  instance.loadAnalysisBasicInfoSnapshots = async () => ({});
  instance.processAnalysisData = () => {};
  instance.initCharts = () => {};
  instance.updateDateRangeText = () => {};

  await withMutedConsole(() => instance.loadAnalysisData());

  assert.equal(setDataCalls[0].loading, undefined);
  assert.equal(setDataCalls[0].refreshing, true);
  assert.equal(instance.data.loading, false);
  assert.equal(instance.data.refreshing, false);
  assert.equal(instance.data.hasLoadedAnalysis, true);
});

test('data-analysis redraws initialized charts after chartData changes', () => {
  const page = loadDataAnalysisPage();
  const drawnCharts = [];
  const instance = createPageInstance(page, {
    timeDimension: 'month',
    chartData: {
      dates: ['05-01', '05-02'],
      defaultCrosshairIndex: 1,
      milkVolumes: [100, 120],
      naturalMilk: [60, 70],
      specialMilk: [40, 50],
      naturalProteinCoefficient: [1.1, 1.2],
      specialProteinCoefficient: [0.5, 0.6],
      totalProteinCoefficient: [1.6, 1.8],
      premiumProteinRatio: [80, 75],
      regularProteinRatio: [20, 25],
      totalCalories: [300, 360],
      calorieCoefficient: [70, 75]
    }
  });
  const components = {
    '#milk-chart': { data: { isInit: true }, drawChart: (chart) => drawnCharts.push({ id: 'milk', chart }) },
    '#protein-chart': { data: { isInit: true }, drawChart: (chart) => drawnCharts.push({ id: 'protein', chart }) },
    '#calorie-chart': { data: { isInit: true }, drawChart: (chart) => drawnCharts.push({ id: 'calorie', chart }) }
  };
  instance.selectComponent = (selector) => components[selector];

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => {
    callback();
    return 0;
  };
  try {
    withMutedConsole(() => instance.initCharts());
  } finally {
    global.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(drawnCharts.map(item => item.id), ['milk', 'protein', 'calorie']);
  assert.deepEqual(drawnCharts[0].chart.xData, ['05-01', '05-02']);
  assert.deepEqual(drawnCharts[0].chart.series.map(item => item.name), ['总量', '天然', '特奶']);
  assert.equal(drawnCharts[0].chart.options.showCrosshair, true);
  assert.equal(drawnCharts[0].chart.options.defaultCrosshairIndex, 1);
  assert.equal(drawnCharts[0].chart.options.keepCrosshairVisible, true);
  assert.equal(drawnCharts[0].chart.options.defaultCrosshairTooltipVisible, false);
  assert.equal(drawnCharts[0].chart.options.xAxisLabelInterval, 5);
  assert.deepEqual(drawnCharts[0].chart.options.padding, { top: 24, right: 20, bottom: 42, left: 38 });
  assert.deepEqual(drawnCharts[1].chart.series.map(item => item.name), ['总蛋白', '天然', '特殊', '优质占比', '普通占比']);
  assert.deepEqual(drawnCharts[1].chart.series[0].data, [1.6, 1.8]);
  assert.equal(drawnCharts[1].chart.series[0].axisLabel, '左轴 g/kg');
  assert.equal(drawnCharts[1].chart.series[1].lineStyle, 'solid');
  assert.deepEqual(drawnCharts[1].chart.series[3].lineDash, [6, 4]);
  assert.equal(drawnCharts[1].chart.series[3].dotShape, 'diamond');
  assert.equal(drawnCharts[1].chart.series[3].axisLabel, '右轴 %');
  assert.deepEqual(drawnCharts[1].chart.options.colors, ['#FF9800', '#2E7D32', '#2196F3', '#7E57C2', '#795548']);
  assert.equal(drawnCharts[1].chart.options.showCrosshair, true);
  assert.equal(drawnCharts[1].chart.options.defaultCrosshairIndex, 1);
  assert.equal(drawnCharts[1].chart.options.keepCrosshairVisible, true);
  assert.equal(drawnCharts[1].chart.options.defaultCrosshairTooltipVisible, false);
  assert.equal(drawnCharts[1].chart.options.xAxisLabelInterval, 5);
  assert.deepEqual(drawnCharts[1].chart.options.padding, { top: 24, right: 30, bottom: 48, left: 36 });
  assert.deepEqual(drawnCharts[2].chart.series.map(item => item.name), ['总热量', '热量系数']);
  assert.deepEqual(drawnCharts[2].chart.series[1].data, [70, 75]);
  assert.equal(drawnCharts[2].chart.series[0].axisLabel, '左轴 kcal');
  assert.deepEqual(drawnCharts[2].chart.series[1].lineDash, [6, 4]);
  assert.equal(drawnCharts[2].chart.series[1].dotShape, 'diamond');
  assert.equal(drawnCharts[2].chart.series[1].axisLabel, '右轴 kcal/kg');
  assert.equal(drawnCharts[2].chart.options.showCrosshair, true);
  assert.equal(drawnCharts[2].chart.options.defaultCrosshairIndex, 1);
  assert.equal(drawnCharts[2].chart.options.keepCrosshairVisible, true);
  assert.equal(drawnCharts[2].chart.options.defaultCrosshairTooltipVisible, false);
  assert.equal(drawnCharts[2].chart.options.xAxisLabelInterval, 5);
  assert.deepEqual(drawnCharts[2].chart.options.padding, { top: 24, right: 30, bottom: 42, left: 38 });
});

test('data-analysis fetchFeedingRecords reads daily_summary_v2 with paging past 100 records', async () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const allRecords = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(2026, 0, index + 1);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
      _id: `summary_${index}`,
      babyUid: 'baby_1',
      date: dateKey,
      status: 'active',
      basicInfo: { weight: 5 },
      food: { calories: 10, protein: 1, naturalProtein: 1, specialProtein: 0, carbs: 1, fat: 1 }
    };
  });

  const wxMock = {
    getStorageSync() {
      return 'baby_1';
    },
    showToast() {},
    cloud: {
      database() {
        return {
          command: {
            gte() {
              return {
                and() {
                  return {};
                }
              };
            },
            lte() {
              return {};
            }
          },
          collection(name) {
            let skipValue = 0;
            let limitValue = 20;
            return {
              where() {
                return this;
              },
              skip(value) {
                skipValue = value;
                return this;
              },
              limit(value) {
                limitValue = value;
                return this;
              },
              get() {
                assert.notEqual(name, 'feeding_records');
                if (name === 'feeding_records_v2') {
                  return Promise.resolve({ data: [] });
                }
                return Promise.resolve({
                  data: allRecords.slice(skipValue, skipValue + limitValue)
                });
              }
            };
          }
        };
      }
    }
  };

  const records = await withWxAndApp(
    wxMock,
    { globalData: { babyUid: 'baby_1' } },
    () => withMutedConsole(() => instance.fetchFeedingRecords(
      new Date('2026-03-01T00:00:00+08:00'),
      new Date('2026-03-31T23:59:59+08:00')
    ))
  );

  assert.equal(records.length, 120);
  assert.equal(records[0].intakes[0].nutrition.calories, 10);
});

test('data-analysis fetchFeedingRecords includes daily summary string date records', async () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const summaryRecords = [
    {
      _id: 'summary_record',
      babyUid: 'baby_1',
      date: '2026-03-21',
      status: 'active',
      basicInfo: { weight: 5 },
      food: { calories: 20, protein: 2, naturalProtein: 2, specialProtein: 0, carbs: 2, fat: 1 }
    }
  ];

  const wxMock = {
    getStorageSync() {
      return 'baby_1';
    },
    showToast() {},
    cloud: {
      database() {
        return {
          command: {
            gte(value) {
              return {
                __gte: value,
                and(condition) {
                  return {
                    __gte: value,
                    __and: condition
                  };
                }
              };
            },
            lte(value) {
              return { __lte: value };
            }
          },
          collection(name) {
            let skipValue = 0;
            let limitValue = 20;
            return {
              where() {
                return this;
              },
              orderBy() {
                return this;
              },
              skip(value) {
                skipValue = value;
                return this;
              },
              limit(value) {
                limitValue = value;
                return this;
              },
              get() {
                assert.notEqual(name, 'feeding_records');
                if (name === 'feeding_records_v2') {
                  return Promise.resolve({ data: [] });
                }
                return Promise.resolve({
                  data: summaryRecords.slice(skipValue, skipValue + limitValue)
                });
              }
            };
          }
        };
      }
    }
  };

  const records = await withWxAndApp(
    wxMock,
    { globalData: { babyUid: 'baby_1' } },
    () => withMutedConsole(() => instance.fetchFeedingRecords(
      new Date('2026-03-01T00:00:00+08:00'),
      new Date('2026-03-31T23:59:59+08:00')
    ))
  );

  assert.deepEqual(records.map(record => record._id), ['summary_record']);
  assert.equal(records[0].intakes[0].nutrition.calories, 20);
});
