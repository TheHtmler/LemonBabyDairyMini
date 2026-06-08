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
      '当前：0-6月龄推荐 72~109 kcal/kg/d',
      '各年龄段参考：',
      '0-6月龄推荐：72~109 kcal/kg/d',
      '6-12月龄推荐：65~97 kcal/kg/d',
      '1-3岁推荐：66~99 kcal/kg/d',
      '3-7岁推荐：59~88 kcal/kg/d',
      '7-12岁推荐：43~65 kcal/kg/d'
    ]);
  } finally {
    restore();
  }
});
