const test = require('node:test');
const assert = require('node:assert/strict');

function createPageInstance(page, dataOverrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data || {})),
      ...dataOverrides
    },
    setData(patch, callback) {
      this.data = { ...this.data, ...(patch || {}) };
      if (callback) callback();
    }
  };
}

function createEmptyIntakeOverviewForTest() {
  return {
    milk: {
      totalCalories: 0,
      normal: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0, coefficient: '' },
      special: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0, coefficient: '' }
    },
    food: {
      count: 0,
      totalCalories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      premiumProtein: 0,
      regularProtein: 0,
      fluidVolume: 0,
      carbs: 0,
      fat: 0
    },
    treatment: {
      count: 0,
      totalCalories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fluidVolume: 0
    }
  };
}

function loadDataRecordsPage() {
  const pagePath = require.resolve('../miniprogram/pages/data-records-v2/index.js');
  delete require.cache[pagePath];

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;

  const chainableCollection = () => ({
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    doc() { return this; },
    get: async () => ({ data: [] }),
    add: async () => ({ _id: 'created' }),
    update: async () => ({}),
    remove: async () => ({})
  });

  global.wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    showToast: () => {},
    showModal: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    cloud: {
      database() {
        const command = {};
        ['gte', 'lte', 'gt', 'lt', 'eq', 'neq', 'in', 'and', 'or'].forEach((op) => {
          command[op] = () => command;
        });
        return {
          command,
          serverDate: () => new Date('2026-06-01T00:00:00Z'),
          collection: chainableCollection
        };
      }
    }
  };
  global.getApp = () => ({ globalData: { babyUid: 'baby-1' } });

  let captured = null;
  global.Page = (config) => { captured = config; };
  try {
    require(pagePath);
  } finally {
    global.Page = previousPage;
  }

  const restore = () => {
    global.wx = previousWx;
    global.getApp = previousGetApp;
    delete require.cache[pagePath];
  };

  return { pageConfig: captured, restore };
}

test('summary protein coefficient never carries over from the previously viewed date', () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  assert.ok(pageConfig, 'page config should be captured');
  try {
    // 复现路径：先看了有数据的周日，this.data 残留周日实际系数；现在切到无记录的周一。
    const page = createPageInstance(pageConfig, {
      weight: '5',
      naturalProteinCoefficient: '1.2',
      specialProteinCoefficient: '0.8',
      proteinSummaryDisplay: { natural: 0, special: 0 },
      intakeOverview: {},
      feedings: []
    });

    // 路径 A：调用方没传系数 override（最易踩坑的兜底分支），按实际摄入(0)现算 => '--'
    const previewNoOverride = page.buildSummaryPreviewData({
      proteinSummaryDisplay: { natural: 0, special: 0 },
      weight: '5',
      feedings: []
    });
    assert.equal(previewNoOverride.nutritionStrip[0].detailValue, '--');
    assert.equal(previewNoOverride.nutritionStrip[1].detailValue, '--');

    // 路径 B：显式传空串（applyV2DailyServiceResult 切到无摄入日的真实行为）=> '--'
    const previewEmptyOverride = page.buildSummaryPreviewData({
      naturalProteinCoefficient: '',
      specialProteinCoefficient: '',
      proteinSummaryDisplay: { natural: 0, special: 0 },
      weight: '5',
      feedings: []
    });
    assert.equal(previewEmptyOverride.nutritionStrip[0].detailValue, '--');
    assert.equal(previewEmptyOverride.nutritionStrip[1].detailValue, '--');
  } finally {
    restore();
  }
});

test('summary protein coefficient is computed from actual intake over weight', () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  try {
    const page = createPageInstance(pageConfig, {
      weight: '5',
      naturalProteinCoefficient: '',
      specialProteinCoefficient: '',
      proteinSummaryDisplay: { natural: 0, special: 0 },
      intakeOverview: {},
      feedings: []
    });

    const preview = page.buildSummaryPreviewData({
      proteinSummaryDisplay: { natural: 6, special: 2.5 },
      weight: '5',
      feedings: []
    });
    assert.equal(preview.nutritionStrip[0].detailValue, '1.2');
    assert.equal(preview.nutritionStrip[1].detailValue, '0.5');
  } finally {
    restore();
  }
});

test('v2 daily record protein display uses authoritative daily summary', async () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  try {
    const page = createPageInstance(pageConfig, {
      babyInfo: { birthday: '2026-01-01' },
      selectedDate: '2026-06-01',
      nutritionSettings: {},
      proteinSummaryDisplay: { natural: 0, special: 0 },
      intakeOverview: {},
      feedings: []
    });

    await page.applyV2DailyServiceResult('2026-06-01', 'baby-1', {
      summary: {
        basicInfo: {
          weight: 5,
          height: 60
        },
        macroSummary: {
          calories: 120,
          protein: 10,
          naturalProtein: 7,
          specialProtein: 3,
          carbs: 0,
          fat: 0
        }
      },
      milkRecords: [],
      foodIntakeRecords: [],
      treatmentRecords: [],
      medicationRecords: [],
      bowelRecords: []
    });

    assert.equal(page.data.proteinSummaryDisplay.natural, '7.00');
    assert.equal(page.data.proteinSummaryDisplay.special, '3.00');
    assert.equal(page.data.proteinSummaryDisplay.total, '10.00');
    assert.equal(page.data.naturalProteinCoefficient, 1.4);
    assert.equal(page.data.specialProteinCoefficient, 0.6);
  } finally {
    restore();
  }
});

test('v2 fetchDailyRecords loads summary and active tab details without full detail fetch', async () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  const service = require('../miniprogram/utils/dailyRecordV2Service.js');
  const originalGetDailyRecordV2 = service.getDailyRecordV2;
  const originalGetDailySummaryForDate = service.getDailySummaryForDate;
  const originalGetDailyRecordTabDetails = service.getDailyRecordTabDetails;
  const calls = [];

  service.getDailyRecordV2 = async () => {
    throw new Error('full daily record fetch should not be called');
  };
  service.getDailySummaryForDate = async (babyUid, date) => {
    calls.push(['summary', babyUid, date]);
    return {
      _id: 'summary-1',
      babyUid,
      date,
      status: 'active',
      isDirty: false,
      basicInfo: { weight: 5, height: 60 },
      milk: { totalVolume: 120, naturalMilkVolume: 80, specialMilkVolume: 40, calories: 100, protein: 3, naturalProtein: 2, specialProtein: 1 },
      food: { calories: 20, protein: 1, naturalProtein: 1, specialProtein: 0, carbs: 3, fat: 1 },
      treatment: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      macroSummary: { calories: 120, protein: 4, naturalProtein: 3, specialProtein: 1, carbs: 3, fat: 1 },
      recordCounts: { milk: 1, food: 1, medication: 0, treatment: 0, bowel: 0 }
    };
  };
  service.getDailyRecordTabDetails = async (babyUid, date, tab) => {
    calls.push(['tab', babyUid, date, tab]);
    return {
      tab,
      foodIntakeRecords: [
        {
          _id: 'food-1',
          babyUid,
          date,
          status: 'active',
          foodId: 'rice',
          foodName: '米粉',
          nameSnapshot: '米粉',
          quantity: 10,
          unit: 'g',
          nutrition: { calories: 20, protein: 1, naturalProtein: 1, specialProtein: 0, carbs: 3, fat: 1 }
        }
      ]
    };
  };

  try {
    const page = createPageInstance(pageConfig, {
      activeTab: 'food'
    });

    await page.fetchDailyRecords('2026-06-01', { silent: true });

    assert.deepEqual(calls, [
      ['summary', 'baby-1', '2026-06-01'],
      ['tab', 'baby-1', '2026-06-01', 'food']
    ]);
    assert.equal(page.data.macroSummary.calories, 120);
    assert.equal(page.data.foodIntakes.length, 1);
    assert.equal(page.data.foodMealGroups.length, 0);
    assert.deepEqual(page.data.loadedRecordTabs, { food: true });
  } finally {
    service.getDailyRecordV2 = originalGetDailyRecordV2;
    service.getDailySummaryForDate = originalGetDailySummaryForDate;
    service.getDailyRecordTabDetails = originalGetDailyRecordTabDetails;
    restore();
  }
});

test('v2 weight edit keeps authoritative summary instead of recalculating from loaded tab details', async () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  try {
    const page = createPageInstance(pageConfig, {
      isV2RecordsPage: true,
      selectedDate: '2026-06-01',
      editingField: 'weight',
      editingLabel: '体重',
      editingUnit: 'kg',
      editBasicInfoValue: '6',
      weight: 5,
      height: 60,
      feedings: [
        {
          isV2FeedingRecord: true,
          totalMilkVolume: 120,
          nutritionSummary: {
            calories: 100,
            protein: 3,
            naturalProtein: 2,
            specialProtein: 1,
            carbs: 6,
            fat: 3
          }
        }
      ],
      intakes: [],
      treatmentRecords: [],
      macroSummary: {
        calories: 180,
        protein: 6,
        naturalProtein: 4,
        specialProtein: 2,
        carbs: 10,
        fat: 5
      },
      intakeOverview: {
        milk: {
          totalCalories: 100,
          normal: { volume: 80, calories: 70, protein: 2, carbs: 4, fat: 2, coefficient: '' },
          special: { volume: 40, calories: 30, protein: 1, carbs: 2, fat: 1, coefficient: '' }
        },
        food: {
          count: 1,
          totalCalories: 50,
          protein: 2,
          naturalProtein: 2,
          specialProtein: 0,
          premiumProtein: 1,
          regularProtein: 1,
          fluidVolume: 0,
          carbs: 3,
          fat: 1
        },
        treatment: {
          count: 1,
          totalCalories: 30,
          protein: 1,
          carbs: 1,
          fat: 1
        }
      },
      proteinSummaryDisplay: {
        natural: '4.00',
        special: '2.00',
        total: '6.00',
        premium: '3.00',
        regular: '1.00',
        premiumRatio: 75
      }
    });
    page.saveBasicInfoFields = async () => {};

    await page.confirmBasicInfoEdit();

    assert.equal(page.data.macroSummary.calories, 180);
    assert.equal(page.data.dailyCaloriesTotal, 180);
    assert.equal(page.data.caloriePerKg, 30);
    assert.equal(page.data.naturalProteinCoefficient, 0.67);
    assert.equal(page.data.specialProteinCoefficient, 0.33);
    assert.equal(page.data.summaryPreview.topMetrics[0].value, '180');
  } finally {
    restore();
  }
});

test('basic info edit waits for save before closing modal and updating summary', async () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  try {
    let resolveSave;
    const saveStarted = new Promise(resolve => {
      resolveSave = resolve;
    });
    const page = createPageInstance(pageConfig, {
      isV2RecordsPage: true,
      selectedDate: '2026-06-01',
      showBasicInfoModal: true,
      editingField: 'weight',
      editingLabel: '体重',
      editingUnit: 'kg',
      editBasicInfoValue: '6',
      weight: 5,
      macroSummary: {
        calories: 180,
        protein: 6,
        naturalProtein: 4,
        specialProtein: 2,
        carbs: 10,
        fat: 5
      },
      intakeOverview: createEmptyIntakeOverviewForTest(),
      proteinSummaryDisplay: {
        natural: '4.00',
        special: '2.00',
        total: '6.00'
      }
    });
    page.saveBasicInfoFields = () => saveStarted;

    const promise = page.confirmBasicInfoEdit();
    await Promise.resolve();

    assert.equal(page.data.showBasicInfoModal, true);
    assert.equal(page.data.weight, 5);

    resolveSave();
    await promise;

    assert.equal(page.data.showBasicInfoModal, false);
    assert.equal(page.data.weight, 6);
    assert.equal(page.data.dailyCaloriesTotal, 180);
  } finally {
    restore();
  }
});

test('basic info edit shows saving feedback while waiting for persistence', async () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  const loadingCalls = [];
  const previousShowLoading = global.wx.showLoading;
  const previousHideLoading = global.wx.hideLoading;
  global.wx.showLoading = (options = {}) => {
    loadingCalls.push(['show', options.title]);
  };
  global.wx.hideLoading = () => {
    loadingCalls.push(['hide']);
  };

  try {
    let resolveSave;
    const saveStarted = new Promise(resolve => {
      resolveSave = resolve;
    });
    const page = createPageInstance(pageConfig, {
      isV2RecordsPage: true,
      selectedDate: '2026-06-01',
      showBasicInfoModal: true,
      editingField: 'weight',
      editingLabel: '体重',
      editBasicInfoValue: '6',
      weight: 5,
      macroSummary: { calories: 180, protein: 6, naturalProtein: 4, specialProtein: 2, carbs: 10, fat: 5 },
      intakeOverview: createEmptyIntakeOverviewForTest(),
      proteinSummaryDisplay: { natural: '4.00', special: '2.00', total: '6.00' }
    });
    page.saveBasicInfoFields = () => saveStarted;

    const promise = page.confirmBasicInfoEdit();
    await Promise.resolve();

    assert.equal(page.data.isSavingBasicInfo, true);
    assert.deepEqual(loadingCalls, [['show', '保存中...']]);

    resolveSave();
    await promise;

    assert.equal(page.data.isSavingBasicInfo, false);
    assert.deepEqual(loadingCalls, [['show', '保存中...'], ['hide']]);
  } finally {
    global.wx.showLoading = previousShowLoading;
    global.wx.hideLoading = previousHideLoading;
    restore();
  }
});

test('summary calorie coefficient info keeps all age-range hints', () => {
  const { pageConfig, restore } = loadDataRecordsPage();
  try {
    const page = createPageInstance(pageConfig, {
      babyInfo: { birthday: '2026-01-01' },
      selectedDate: '2026-05-01',
      weight: '5',
      feedings: []
    });

    const calorieMetrics = page.computeCalorieMetrics({
      totalCalories: 480,
      weight: '5',
      dateStr: '2026-05-01'
    });
    const preview = page.buildSummaryPreviewData({
      dailyCaloriesTotal: calorieMetrics.dailyCaloriesTotal,
      caloriePerKg: calorieMetrics.caloriePerKg,
      calorieGoalPerKgRange: calorieMetrics.calorieGoalPerKgRange,
      weight: '5',
      feedings: []
    });

    assert.deepEqual(preview.topMetrics[1].infoLines, [
      '▸ 0-6月龄推荐 72~109',
      '6-12月龄推荐 65~97',
      '1-3岁推荐 66~99',
      '3-7岁推荐 59~88',
      '7-12岁推荐 43~65'
    ]);
  } finally {
    restore();
  }
});
