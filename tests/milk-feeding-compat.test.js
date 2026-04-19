const test = require('node:test');
const assert = require('node:assert/strict');

function setPath(target, path, value) {
  const segments = path.split('.');
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

function applyPatch(target, patch) {
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key.includes('.')) {
      setPath(target, key, value);
      return;
    }
    target[key] = value;
  });
}

function createPageInstance(page, overrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data || {})),
      ...overrides
    },
    setData(patch, callback) {
      applyPatch(this.data, patch);
      if (callback) {
        callback();
      }
    }
  };
}

function createDefaultWx(customDatabaseFactory) {
  return {
    cloud: {
      database() {
        if (customDatabaseFactory) {
          return customDatabaseFactory();
        }
        return {
          command: {
            gte: (value) => ({ $gte: value }),
            lte: (value) => ({ $lte: value }),
            lt: (value) => ({ $lt: value }),
            eq: (value) => ({ $eq: value }),
            in: (value) => ({ $in: value }),
            or: (value) => ({ $or: value }),
            push: (value) => value
          },
          serverDate() {
            return '__server_date__';
          },
          collection() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      limit() {
                        return {
                          get: async () => ({ data: [] })
                        };
                      }
                    };
                  },
                  get: async () => ({ data: [] })
                };
              },
              doc() {
                return {
                  update: async () => ({})
                };
              },
              add: async () => ({ _id: 'record-id' })
            };
          }
        };
      }
    },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    navigateTo() {},
    navigateBack() {},
    nextTick(callback) {
      if (callback) callback();
    },
    getStorageSync() {
      return '';
    }
  };
}

function loadDailyFeedingPage(options = {}) {
  const pagePath = require.resolve('../miniprogram/pages/daily-feeding/index.js');
  const modulePaths = [
    pagePath,
    require.resolve('../miniprogram/models/nutrition.js'),
    require.resolve('../miniprogram/models/medicationRecord.js'),
    require.resolve('../miniprogram/models/treatmentRecord.js'),
    require.resolve('../miniprogram/models/food.js'),
    require.resolve('../miniprogram/models/invitation.js'),
    require.resolve('../miniprogram/utils/feedingRecordStore.js'),
    require.resolve('../miniprogram/utils/index.js')
  ];
  modulePaths.forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  let pageConfig = null;

  global.wx = options.wx || createDefaultWx(options.databaseFactory);
  global.getApp = () => options.getAppReturn || { globalData: {} };
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;
  return pageConfig;
}

function loadDataRecordsPage(options = {}) {
  const pagePath = require.resolve('../miniprogram/pages/data-records/index.js');
  const modulePaths = [
    pagePath,
    require.resolve('../miniprogram/models/nutrition.js'),
    require.resolve('../miniprogram/models/medicationRecord.js'),
    require.resolve('../miniprogram/models/treatmentRecord.js'),
    require.resolve('../miniprogram/models/food.js'),
    require.resolve('../miniprogram/models/invitation.js'),
    require.resolve('../miniprogram/utils/feedingRecordStore.js'),
    require.resolve('../miniprogram/utils/index.js')
  ];
  modulePaths.forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  let pageConfig = null;

  global.wx = options.wx || createDefaultWx(options.databaseFactory);
  global.getApp = () => options.getAppReturn || { globalData: {} };
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;
  return pageConfig;
}

test('daily-feeding summary uses explicit formula and special powder weights when records were custom mixed', () => {
  const page = loadDailyFeedingPage();
  const instance = createPageInstance(page, {
    calculation_params: {
      formula_milk_ratio: {
        powder: 10,
        water: 100
      },
      formula_milk_protein: 20,
      formula_milk_calories: 100,
      special_milk_ratio: {
        powder: 10,
        water: 100
      },
      special_milk_protein: 20,
      special_milk_calories: 100
    },
    treatmentRecords: []
  });

  instance._round = page._round;
  instance._roundCalories = page._roundCalories;
  instance.calculateMilkNutrition = page.calculateMilkNutrition;
  instance.calculateSpecialMilkPowder = page.calculateSpecialMilkPowder;

  const summary = page.calculateMacroSummary.call(instance, [], [
    {
      naturalMilkType: 'formula',
      naturalMilkVolume: 40,
      formulaPowderWeight: 5,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    },
    {
      naturalMilkType: 'breast',
      naturalMilkVolume: 0,
      specialMilkVolume: 100,
      specialMilkPowder: 5
    }
  ]);

  assert.equal(summary.naturalProtein, 1);
  assert.equal(summary.specialProtein, 1);
  assert.equal(summary.protein, 2);
  assert.equal(summary.calories, 10);
});

test('daily-feeding edit modal keeps stored formula powder weight for custom formula records', () => {
  const page = loadDailyFeedingPage();
  const instance = createPageInstance(page, {
    calculation_params: {
      formula_milk_ratio: {
        powder: 10,
        water: 100
      }
    },
    feedings: [
      {
        startTime: '10:00',
        naturalMilkType: 'formula',
        naturalMilkVolume: 40,
        formulaPowderWeight: 5,
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }
    ]
  });

  instance.calculateFormulaPowderWeight = page.calculateFormulaPowderWeight;
  instance.scheduleEditingNutritionUpdate = () => {};
  instance.updateEditingFeedingDisplay = () => {};

  page.openEditModal.call(instance, {
    detail: {
      index: 0
    }
  });

  assert.equal(instance.data.editingFeeding.formulaPowderWeight, 5);
});

test('daily-feeding saveEditedFeeding persists formulaPowderWeight for custom formula records', async () => {
  let updatedFeedings = null;
  const wx = createDefaultWx(() => ({
    command: {
      push: (value) => value
    },
    serverDate() {
      return '__server_date__';
    },
    collection() {
      return {
        doc() {
          return {
            update: async ({ data }) => {
              updatedFeedings = data.feedings;
              return {};
            }
          };
        }
      };
    }
  }));
  const page = loadDailyFeedingPage({ wx });
  const instance = createPageInstance(page, {
    calculation_params: null,
    recordId: 'record-1',
    editingFeedingIndex: 0,
    feedings: [
      {
        startTime: '10:00',
        naturalMilkType: 'formula',
        naturalMilkVolume: 40,
        formulaPowderWeight: 5,
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }
    ],
    editingFeeding: {
      startTime: '10:00',
      naturalMilkType: 'formula',
      naturalMilkVolume: 40,
      formulaPowderWeight: 5,
      specialMilkVolume: 0,
      specialMilkPowder: 0,
      totalVolume: 40,
      startDateTime: new Date('2026-04-19T10:00:00+08:00'),
      endDateTime: null,
      endTime: ''
    },
    modals: {
      edit: true
    }
  });

  instance.calculateTotalVolume = () => {};
  instance.ensureFeedingSettings = () => true;
  instance.sortFeedingsByTimeDesc = (feedings) => feedings;
  instance.updateCalculations = () => {};

  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  global.wx = wx;
  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1'
    }
  });
  try {
    await page.saveEditedFeeding.call(instance);
  } finally {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  }

  assert.equal(updatedFeedings[0].formulaPowderWeight, 5);
});

test('daily-feeding routes add and edit actions to milk feeding editor with context params', () => {
  let navigatedUrl = '';
  const wx = createDefaultWx();
  wx.navigateTo = ({ url }) => {
    navigatedUrl = url;
  };
  const page = loadDailyFeedingPage({ wx });
  const instance = createPageInstance(page, {
    feedings: [
      {
        startTime: '10:00'
      }
    ]
  });

  const previousWx = global.wx;
  global.wx = wx;
  try {
    page.navigateToMilkFeedingEditor.call(instance);
    assert.match(navigatedUrl, /^\/pages\/milk-feeding-editor\/index\?/);
    assert.match(navigatedUrl, /mode=create/);
    assert.match(navigatedUrl, /source=daily/);

    page.navigateToMilkFeedingEditorForEdit.call(instance, {
      detail: {
        index: 0
      }
    });
  } finally {
    global.wx = previousWx;
  }

  assert.match(navigatedUrl, /^\/pages\/milk-feeding-editor\/index\?/);
  assert.match(navigatedUrl, /mode=edit/);
  assert.match(navigatedUrl, /source=daily/);
  assert.match(navigatedUrl, /index=0/);
});

test('data-records edit modal keeps stored special powder weight for custom special milk records', () => {
  const page = loadDataRecordsPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      special_milk_ratio: {
        powder: 10,
        water: 100
      }
    },
    feedingRecords: [
      {
        startTime: '10:00',
        naturalMilkType: 'breast',
        naturalMilkVolume: 0,
        specialMilkVolume: 100,
        specialMilkPowder: 5
      }
    ]
  });

  instance.updateFeedingDisplay = () => {};

  page.openEditFeedingModal.call(instance, {
    detail: {
      index: 0
    }
  });

  assert.equal(instance.data.editingFeeding.specialMilkPowder, 5);
});

test('data-records summary uses explicit powder weights when records were custom mixed', () => {
  const page = loadDataRecordsPage();
  const instance = createPageInstance(page, {
    nutritionSettings: {
      formula_milk_ratio: {
        powder: 10,
        water: 100
      },
      formula_milk_protein: 20,
      formula_milk_calories: 100,
      special_milk_ratio: {
        powder: 10,
        water: 100
      },
      special_milk_protein: 20,
      special_milk_calories: 100
    },
    treatmentRecords: []
  });

  instance.computeProteinSummaryDisplay = () => ({});
  instance.calculateTotalMilk = () => {};

  page.processFeedingData.call(instance, [
    {
      startTime: '10:00',
      naturalMilkType: 'formula',
      naturalMilkVolume: 40,
      formulaPowderWeight: 5,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    },
    {
      startTime: '11:00',
      naturalMilkType: 'breast',
      naturalMilkVolume: 0,
      specialMilkVolume: 100,
      specialMilkPowder: 5
    }
  ], []);

  assert.equal(instance.data.intakeOverview.milk.normal.protein, 1);
  assert.equal(instance.data.intakeOverview.milk.special.protein, 1);
  assert.equal(instance.data.intakeOverview.milk.normal.calories, 5);
  assert.equal(instance.data.intakeOverview.milk.special.calories, 5);
});

test('data-records saveEditedFeeding persists formulaPowderWeight for custom formula records', async () => {
  let updatedFeedings = null;
  const dbRecord = {
    _id: 'record-1',
    feedings: [
      {
        startTime: '10:00',
        naturalMilkType: 'formula',
        naturalMilkVolume: 40,
        formulaPowderWeight: 5,
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }
    ]
  };
  const wx = createDefaultWx(() => ({
    command: {
      gte: (value) => ({
        and: (nextValue) => ({ $gte: value, $and: nextValue })
      }),
      lte: (value) => ({ $lte: value })
    },
    serverDate() {
      return '__server_date__';
    },
    collection() {
      return {
        where() {
          return {
            get: async () => ({ data: [dbRecord] })
          };
        },
        doc() {
          return {
            update: async ({ data }) => {
              updatedFeedings = data.feedings;
              return {};
            }
          };
        }
      };
    }
  }));
  const page = loadDataRecordsPage({ wx });
  const instance = createPageInstance(page, {
    selectedDate: '2026-04-19',
    editingFeedingIndex: 0,
    feedingRecords: [
      {
        startTime: '10:00',
        formattedStartTime: '10:00',
        naturalMilkType: 'formula',
        naturalMilkVolume: 40,
        formulaPowderWeight: 5,
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }
    ],
    editingFeeding: {
      formattedStartTime: '10:00',
      naturalMilkType: 'formula',
      naturalMilkVolume: 40,
      formulaPowderWeight: 5,
      specialMilkVolume: 0,
      specialMilkPowder: 0,
      notes: ''
    }
  });

  instance.ensureFeedingSettings = () => true;
  instance.forceRefreshData = async () => {};
  instance.hideEditFeedingModal = () => {};

  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  global.wx = wx;
  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1'
    }
  });
  try {
    await page.saveEditedFeeding.call(instance);
  } finally {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  }

  assert.equal(updatedFeedings[0].formulaPowderWeight, 5);
});

test('data-records routes add and edit actions to milk feeding editor with selected date context', () => {
  let navigatedUrl = '';
  const wx = createDefaultWx();
  wx.navigateTo = ({ url }) => {
    navigatedUrl = url;
  };
  const page = loadDataRecordsPage({ wx });
  const instance = createPageInstance(page, {
    selectedDate: '2026-04-19',
    feedingRecords: [
      {
        startTime: '10:00',
        naturalMilkVolume: 40
      }
    ]
  });

  const previousWx = global.wx;
  global.wx = wx;
  try {
    page.navigateToMilkFeedingEditor.call(instance);
    assert.match(navigatedUrl, /^\/pages\/milk-feeding-editor\/index\?/);
    assert.match(navigatedUrl, /mode=create/);
    assert.match(navigatedUrl, /source=records/);
    assert.match(navigatedUrl, /date=2026-04-19/);

    page.navigateToMilkFeedingEditorForEdit.call(instance, {
      detail: {
        index: 0
      }
    });
  } finally {
    global.wx = previousWx;
  }

  assert.match(navigatedUrl, /^\/pages\/milk-feeding-editor\/index\?/);
  assert.match(navigatedUrl, /mode=edit/);
  assert.match(navigatedUrl, /source=records/);
  assert.match(navigatedUrl, /date=2026-04-19/);
  assert.match(navigatedUrl, /index=0/);
});

test('report workbench nutrition windows use explicit powder weights for custom formula records', () => {
  const { buildReportWorkbenchView } = require('../miniprogram/utils/reportWorkbench');

  const view = buildReportWorkbenchView({
    selectedReportId: 'report-current',
    reports: [
      {
        _id: 'report-current',
        reportType: 'urine_ms',
        reportDate: new Date('2026-11-16T00:00:00+08:00'),
        indicators: {
          methylmalonic_acid: { value: '120', status: 'high' }
        }
      },
      {
        _id: 'report-previous',
        reportType: 'urine_ms',
        reportDate: new Date('2026-11-14T00:00:00+08:00'),
        indicators: {
          methylmalonic_acid: { value: '100', status: 'high' }
        }
      }
    ],
    feedingRecords: [
      {
        _id: 'feeding-record-1',
        date: '2026-11-15',
        basicInfo: { weight: 5 },
        feedings: [
          {
            naturalMilkType: 'formula',
            naturalMilkVolume: 40,
            formulaPowderWeight: 5,
            specialMilkVolume: 0,
            specialMilkPowder: 0
          }
        ],
        intakes: []
      }
    ],
    nutritionSettings: {
      formula_milk_ratio: {
        powder: 10,
        water: 100
      },
      formula_milk_protein: 20,
      formula_milk_calories: 100
    },
    fallbackWeight: 5
  });

  assert.equal(view.nutritionWindows[0].dateRange, '11-15 至 11-15');
  assert.equal(view.nutritionWindows[0].metrics[0].value, '0.2');
  assert.equal(view.nutritionWindows[0].metrics[2].value, '1');
});
