const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadDataRecordsPageForDeletion() {
  const pagePath = require.resolve('../miniprogram/pages/data-records/index.js');
  const modelPath = require.resolve('../miniprogram/models/feedingRecordV2.js');
  delete require.cache[pagePath];
  delete require.cache[modelPath];

  const calls = {
    toasts: [],
    loading: [],
    hideLoading: 0,
    collections: [],
    collectionData: {},
    legacyUpdates: [],
    refreshes: 0
  };
  const previousWx = global.wx;
  const previousPage = global.Page;
  const previousGetApp = global.getApp;
  const previousSuppress = global.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__;

  global.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__ = true;
  global.Page = () => {};
  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1'
    }
  });
  global.wx = {
    cloud: {
      database() {
        return {
          command: {
            eq: (value) => ({ $eq: value }),
            in: (value) => ({ $in: value }),
            or: (value) => ({ $or: value }),
            lt: (value) => ({ $lt: value }),
            gte(value) {
              return {
                and(next) {
                  return { $gte: value, $lte: next };
                }
              };
            },
            lte: (value) => ({ $lte: value })
          },
          serverDate() {
            return '__server_date__';
          },
          collection(name) {
            calls.collections.push(name);
            return {
              where() {
                return {
                  orderBy() {
                    return this;
                  },
                  limit() {
                    return this;
                  },
                  get: async () => ({ data: calls.collectionData[name] || [] })
                };
              },
              doc(id) {
                return {
                  update: async ({ data }) => {
                    calls.legacyUpdates.push({ collection: name, id, data });
                    return {};
                  }
                };
              }
            };
          }
        };
      }
    },
    showLoading(payload) {
      calls.loading.push(payload);
    },
    hideLoading() {
      calls.hideLoading += 1;
    },
    showToast(payload) {
      calls.toasts.push(payload);
    }
  };

  const { createDataRecordsPageConfig } = require(pagePath);
  const feedingRecordV2Model = require(modelPath);
  calls.collections = [];

  return {
    page: createDataRecordsPageConfig({ recordSource: 'v2' }),
    feedingRecordV2Model,
    calls,
    cleanup() {
      global.wx = previousWx;
      global.Page = previousPage;
      global.getApp = previousGetApp;
      global.__DATA_RECORDS_SUPPRESS_AUTO_PAGE__ = previousSuppress;
    }
  };
}

function createPageInstance(page, overrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data)),
      ...overrides
    },
    setData(update, callback) {
      this.data = {
        ...this.data,
        ...update
      };
      if (typeof callback === 'function') {
        callback();
      }
    }
  };
}

test('profile exposes a separate data records v2 entry and route', () => {
  const appJson = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  const profileJs = fs.readFileSync('miniprogram/pages/profile/index.js', 'utf8');

  assert.ok(appJson.pages.includes('pages/data-records-v2/index'));
  assert.match(profileJs, /name:\s*'数据记录v2'/);
  assert.match(profileJs, /path:\s*'\/pages\/data-records-v2\/index'/);
  assert.match(profileJs, /新版数据记录/);
});

test('data-records-v2 page keeps the v1 shell while opting into v2 feeding records', () => {
  const wxml = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/data-records-v2/index.wxss', 'utf8');
  const json = JSON.parse(fs.readFileSync('miniprogram/pages/data-records-v2/index.json', 'utf8'));
  const js = fs.readFileSync('miniprogram/pages/data-records-v2/index.js', 'utf8');

  assert.equal(json.navigationBarTitleText, '数据记录v2');
  assert.match(wxml, /include\s+src="\.\.\/data-records\/index\.wxml"/);
  assert.match(wxss, /@import\s+"\.\.\/data-records\/index\.wxss"/);
  assert.match(js, /createDataRecordsPageConfig\(\{\s*recordSource:\s*'v2'\s*\}\)/);
});

test('data-records-v2 keeps the v1 four-tab record shell and basic info editing entry points', () => {
  const wxml = fs.readFileSync('miniprogram/pages/data-records/index.wxml', 'utf8');

  assert.match(wxml, /data-tab="feeding"/);
  assert.match(wxml, /data-tab="food"/);
  assert.match(wxml, /data-tab="medication"/);
  assert.match(wxml, /data-tab="treatment"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{!isV2RecordsPage\}\}"[^>]*data-tab="food"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{!isV2RecordsPage\}\}"[^>]*data-tab="medication"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{!isV2RecordsPage\}\}"[^>]*data-tab="treatment"/);
  assert.match(wxml, /wx:if="\{\{activeTab === 'food'\}\}"/);
  assert.match(wxml, /wx:elif="\{\{activeTab === 'medication'\}\}"/);
  assert.match(wxml, /wx:elif="\{\{activeTab === 'treatment'\}\}"/);
  assert.match(wxml, /hero-badge-edit" wx:if="\{\{item\.field\}\}"/);
  assert.match(wxml, /copy-btn" wx:if="\{\{!isV2RecordsPage\}\}" bindtap="onCopyFeedingToDate"/);
});

test('data-records switches milk editor navigation to v2 when using v2 records', () => {
  const dataRecordsJs = fs.readFileSync('miniprogram/pages/data-records/index.js', 'utf8');

  assert.match(dataRecordsJs, /getMilkFeedingEditorPath\(\)/);
  assert.match(dataRecordsJs, /\/pages\/milk-feeding-editor-v2\/index/);
  assert.match(dataRecordsJs, /\/pages\/milk-feeding-editor\/index/);
  assert.match(dataRecordsJs, /feedingRecords\s*\|\|\s*\[\]\)\[index\]/);
  assert.match(dataRecordsJs, /recordId=\$\{encodeURIComponent\(targetRecordId\)\}/);
});

test('data-records-v2 fetches v2 feeding while reusing v1 secondary tab records', async () => {
  const { page, feedingRecordV2Model, calls, cleanup } = loadDataRecordsPageForDeletion();
  const previousGetRecordsByDate = feedingRecordV2Model.getRecordsByDate;
  const previousResolveBasicInfoSnapshot = feedingRecordV2Model.resolveBasicInfoSnapshot;
  const MedicationRecordModel = require('../miniprogram/models/medicationRecord');
  const TreatmentRecordModel = require('../miniprogram/models/treatmentRecord');
  const previousFindMedicationByDate = MedicationRecordModel.findByDate;
  const previousFindTreatmentByDate = TreatmentRecordModel.findByDate;
  let resolveOptions = null;
  let medicationArgs = null;
  let treatmentArgs = null;
  feedingRecordV2Model.getRecordsByDate = async () => [];
  MedicationRecordModel.findByDate = async (date, babyUid) => {
    medicationArgs = { date, babyUid };
    return { success: true, data: [{ _id: 'med-1', medicineName: '左卡尼汀' }] };
  };
  TreatmentRecordModel.findByDate = async (date, babyUid) => {
    treatmentArgs = { date, babyUid };
    return { success: true, data: [] };
  };
  feedingRecordV2Model.resolveBasicInfoSnapshot = async (babyUid, date, options) => {
    resolveOptions = options;
    return {
      weight: '',
      height: '',
      naturalProteinCoefficient: '',
      specialProteinCoefficient: '',
      calorieCoefficient: '',
      source: 'empty'
    };
  };

  try {
    calls.collectionData.feeding_records = [
      {
        _id: 'legacy-food-1',
        date: '2026-05-21',
        babyUid: 'baby-1',
        feedings: [],
        intakes: [
          {
            _id: 'food-1',
            type: 'food',
            foodId: 'food-catalog-1',
            nameSnapshot: '米糊',
            quantity: 10,
            unit: 'g',
            nutrition: {
              calories: 20,
              protein: 1,
              carbs: 4,
              fat: 0
            }
          }
        ],
        basicInfo: {}
      }
    ];
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-21',
      nutritionSettings: {}
    });

    await page.fetchDailyRecords.call(instance, '2026-05-21', { silent: true });

    assert.ok(calls.collections.includes('feeding_records'));
    assert.ok(calls.collections.includes('bowel_records'));
    assert.deepEqual(medicationArgs, { date: '2026-05-21', babyUid: 'baby-1' });
    assert.deepEqual(treatmentArgs, { date: '2026-05-21', babyUid: 'baby-1' });
    assert.deepEqual(resolveOptions, { includeFallbacks: false, includeProfileInitial: true });
    assert.equal(instance.data.foodIntakes.length, 1);
    assert.equal(instance.data.foodIntakes[0].nameSnapshot, '米糊');
    assert.deepEqual(instance.data.medicationRecords, [{ _id: 'med-1', medicineName: '左卡尼汀' }]);
    assert.deepEqual(instance.data.treatmentRecords, []);
  } finally {
    feedingRecordV2Model.getRecordsByDate = previousGetRecordsByDate;
    feedingRecordV2Model.resolveBasicInfoSnapshot = previousResolveBasicInfoSnapshot;
    MedicationRecordModel.findByDate = previousFindMedicationByDate;
    TreatmentRecordModel.findByDate = previousFindTreatmentByDate;
    cleanup();
  }
});

test('data-records-v2 saves edited basic info to isolated v2 growth records', async () => {
  const { page, feedingRecordV2Model, calls, cleanup } = loadDataRecordsPageForDeletion();
  const previousUpsert = feedingRecordV2Model.upsertGrowthRecordForDate;
  let saved = null;
  feedingRecordV2Model.upsertGrowthRecordForDate = async (babyUid, date, basicInfo) => {
    saved = { babyUid, date, basicInfo };
    return { recordId: 'growth-1' };
  };

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-21',
      weight: 5.2,
      height: 58,
      weightSource: 'record',
      heightSource: 'history-feeding',
      naturalProteinCoefficientInput: '1.2',
      specialProteinCoefficientInput: '0.8'
    });

    await page.saveBasicInfoFields.call(instance, { weight: 5.4 });

    assert.deepEqual(saved, {
      babyUid: 'baby-1',
      date: '2026-05-21',
      basicInfo: {
        weight: 5.4,
        height: 58,
        naturalProteinCoefficient: '1.2',
        specialProteinCoefficient: '0.8',
        calorieCoefficient: ''
      }
    });
    assert.equal(calls.legacyUpdates.length, 0);
  } finally {
    feedingRecordV2Model.upsertGrowthRecordForDate = previousUpsert;
    cleanup();
  }
});

test('data-records-v2 hard deletes the selected v2 feeding record on delete', async () => {
  const { page, feedingRecordV2Model, calls, cleanup } = loadDataRecordsPageForDeletion();
  const previousDeleteRecord = feedingRecordV2Model.deleteRecord;
  let deletedId = '';
  feedingRecordV2Model.deleteRecord = async (recordId) => {
    deletedId = recordId;
    return true;
  };

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-21',
      recordId: 'v2-1',
      deleteType: 'feeding',
      deleteIndex: 0,
      feedingRecords: [
        {
          id: 'v2-1',
          _id: 'v2-1',
          isV2FeedingRecord: true,
          formattedStartTime: '08:30'
        }
      ]
    });
    instance.forceRefreshData = async () => {
      calls.refreshes += 1;
    };

    await page.confirmDelete.call(instance);

    assert.equal(deletedId, 'v2-1');
    assert.equal(calls.legacyUpdates.length, 0);
    assert.equal(calls.refreshes, 1);
    assert.equal(calls.toasts.at(-1).title, '删除成功');
  } finally {
    feedingRecordV2Model.deleteRecord = previousDeleteRecord;
    cleanup();
  }
});

test('v2 adapter converts component records into v1-style feeding display data', () => {
  const { createDailyRecordFromV2 } = require('../miniprogram/utils/dataRecordsV2Adapter');

  const record = createDailyRecordFromV2([
    {
      id: 'v2-1',
      _id: 'v2-1',
      babyUid: 'baby-1',
      date: '2026-05-21',
      startTime: '08:30',
      notes: '上午奶',
      formulaComponents: [
        { kind: 'breast_milk', volume: 60 },
        {
          kind: 'formula_powder',
          powderName: '纽康特',
          category: 'special_formula',
          categoryShortLabel: '特',
          proteinRole: 'special',
          waterVolume: 90,
          powderWeight: 13.5
        },
        {
          kind: 'formula_powder',
          powderName: '能量粉',
          category: 'energy_supplement',
          categoryShortLabel: '能',
          proteinRole: 'none',
          waterVolume: 0,
          powderWeight: 4
        }
      ],
      nutritionSummary: {
        totalVolume: 150,
        totalPowderWeight: 17.5,
        calories: 160,
        protein: 3.2,
        naturalProtein: 0.66,
        specialProtein: 2.54,
        carbs: 18,
        fat: 6,
        zeroProteinCalories: 16
      },
      basicInfoSnapshot: {
        weight: 5.2,
        height: 58
      }
    }
  ], '2026-05-21', 'baby-1');

  assert.equal(record._id, 'v2-1');
  assert.equal(record.date, '2026-05-21');
  assert.equal(record.feedings.length, 1);
  assert.equal(record.feedings[0].id, 'v2-1');
  assert.equal(record.feedings[0].formattedStartTime, '08:30');
  assert.equal(record.feedings[0].naturalMilkVolume, 60);
  assert.equal(record.feedings[0].specialMilkVolume, 90);
  assert.equal(record.feedings[0].specialMilkPowder, 13.5);
  assert.equal(record.feedings[0].milkSummaryText, '母乳 60ml · 特 纽康特 90ml（粉 13.5g） · 能 能量粉 粉 4g');
  assert.deepEqual(record.feedings[0].milkSummaryItems, [
    {
      badge: '母',
      badgeClass: 'breast',
      badgeStyle: 'background: #FFF4C9; color: #8A5B12; border-color: rgba(138, 91, 18, 0.22);',
      name: '母乳',
      amountText: '60ml'
    },
    {
      badge: '特',
      badgeClass: 'special',
      badgeStyle: 'background: #EAF1FF; color: #4775C9; border-color: rgba(71, 117, 201, 0.24);',
      name: '纽康特',
      amountText: '90ml · 粉 13.5g'
    },
    {
      badge: '能',
      badgeClass: 'energy',
      badgeStyle: 'background: #FFF0D8; color: #B76A1B; border-color: rgba(183, 106, 27, 0.24);',
      name: '能量粉',
      amountText: '粉 4g'
    }
  ]);
  assert.deepEqual(record.feedings[0].nutritionDisplay, {
    calories: 160,
    carbs: 18,
    fat: 6,
    naturalProtein: 0.66,
    specialProtein: 2.54
  });
  assert.deepEqual(record.basicInfo, {
    weight: 5.2,
    height: 58
  });
});

test('data-records-v2 uses v2 component nutrition for daily overview and feeding list', async () => {
  const { page, feedingRecordV2Model, cleanup } = loadDataRecordsPageForDeletion();
  const previousGetRecordsByDate = feedingRecordV2Model.getRecordsByDate;
  const previousResolveBasicInfoSnapshot = feedingRecordV2Model.resolveBasicInfoSnapshot;

  feedingRecordV2Model.getRecordsByDate = async () => [
    {
      id: 'v2-mixed',
      _id: 'v2-mixed',
      babyUid: 'baby-1',
      date: '2026-05-21',
      startTime: '08:30',
      formulaComponents: [
        {
          kind: 'breast_milk',
          volume: 60,
          nutritionSnapshot: { protein: 1.1, calories: 67, fat: 3.8, carbs: 7 }
        },
        {
          kind: 'formula_powder',
          powderName: '普奶 A',
          category: 'regular_formula',
          categoryShortLabel: '普',
          proteinRole: 'natural',
          waterVolume: 30,
          powderWeight: 5,
          nutritionSnapshot: { protein: 10, calories: 500, fat: 20, carbs: 55 }
        },
        {
          kind: 'formula_powder',
          powderName: '特奶',
          category: 'special_formula',
          categoryShortLabel: '特',
          proteinRole: 'special',
          waterVolume: 90,
          powderWeight: 13.5,
          nutritionSnapshot: { protein: 13, calories: 520, fat: 24, carbs: 50 }
        },
        {
          kind: 'formula_powder',
          powderName: '能量粉',
          category: 'energy_supplement',
          categoryShortLabel: '能',
          proteinRole: 'none',
          waterVolume: 20,
          powderWeight: 3,
          nutritionSnapshot: { protein: 0, calories: 400, fat: 0, carbs: 95 }
        }
      ],
      nutritionSummary: {
        totalVolume: 200,
        totalPowderWeight: 21.5,
        calories: 147,
        protein: 2.92,
        naturalProtein: 1.16,
        specialProtein: 1.76,
        carbs: 15.8,
        fat: 5.52,
        zeroProteinCalories: 12
      }
    }
  ];
  feedingRecordV2Model.resolveBasicInfoSnapshot = async () => ({
    weight: 5,
    height: 58,
    naturalProteinCoefficient: '',
    specialProteinCoefficient: '',
    calorieCoefficient: '',
    source: 'v2_growth_record'
  });

  try {
    const instance = createPageInstance(page, {
      selectedDate: '2026-05-21',
      nutritionSettings: {}
    });

    await page.fetchDailyRecords.call(instance, '2026-05-21', { silent: true });

    assert.equal(instance.data.macroSummary.calories, 147);
    assert.equal(instance.data.macroSummary.protein, 2.92);
    assert.equal(instance.data.dailyCaloriesTotal, 147);
    assert.equal(instance.data.totalMilk, 200);
    assert.equal(instance.data.summaryPreview.topMetrics.find((item) => item.label === '总奶量').value, '200');
    assert.deepEqual(instance.data.feedingRecords[0].nutritionDisplay, {
      calories: 147,
      carbs: 15.8,
      fat: 5.52,
      naturalProtein: 1.16,
      specialProtein: 1.76
    });
  } finally {
    feedingRecordV2Model.getRecordsByDate = previousGetRecordsByDate;
    feedingRecordV2Model.resolveBasicInfoSnapshot = previousResolveBasicInfoSnapshot;
    cleanup();
  }
});
