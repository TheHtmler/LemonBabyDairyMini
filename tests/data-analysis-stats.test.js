const test = require('node:test');
const assert = require('node:assert/strict');

function loadDataAnalysisPage() {
  const pagePath = require.resolve('../miniprogram/pages/data-analysis/index.js');
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

test('data-analysis fetchFeedingRecords keeps paging past 100 records', async () => {
  const page = loadDataAnalysisPage();
  const instance = createPageInstance(page);
  const allRecords = Array.from({ length: 120 }, (_, index) => ({
    _id: `record_${index}`,
    babyUid: 'baby_1',
    date: new Date(`2026-03-${String((index % 30) + 1).padStart(2, '0')}T00:00:00+08:00`)
  }));

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
          collection() {
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
});
