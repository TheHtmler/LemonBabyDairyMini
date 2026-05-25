const test = require('node:test');
const assert = require('node:assert/strict');

function createDbMock(overrides = {}) {
  const calls = {
    collectionReads: [],
    addCollection: '',
    addData: null,
    updateCollection: '',
    updateDocId: '',
    updateData: null
  };
  const dataByCollection = {
    daily_summary_v2: overrides.dailySummaryData || [],
    growth_records_v2: overrides.growthRecordsV2Data || [],
    bowel_records: overrides.bowelRecords || [],
    feeding_records: overrides.legacyFeedingRecords || []
  };

  function queryFor(collectionName, whereInput = {}) {
    return {
      _where: whereInput,
      _orderBy: null,
      limit() {
        return this;
      },
      orderBy(field, direction) {
        this._orderBy = { field, direction };
        return this;
      },
      async get() {
        calls.collectionReads.push(collectionName);
        let data = (dataByCollection[collectionName] || []).filter((record) => (
          Object.entries(this._where || {}).every(([key, expected]) => record[key] === expected)
        ));
        if (this._orderBy) {
          const { field, direction } = this._orderBy;
          data = [...data].sort((left, right) => {
            if (left[field] === right[field]) return 0;
            const result = left[field] > right[field] ? 1 : -1;
            return direction === 'desc' ? -result : result;
          });
        }
        return { data };
      }
    };
  }

  const db = {
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      return {
        where(whereInput) {
          return queryFor(name, whereInput);
        },
        doc(id) {
          return {
            async update({ data }) {
              calls.updateCollection = name;
              calls.updateDocId = id;
              calls.updateData = data;
              return {};
            }
          };
        },
        async add({ data }) {
          calls.addCollection = name;
          calls.addData = data;
          return { _id: `${name}-new-id` };
        }
      };
    }
  };

  return { db, calls };
}

function loadFreshService(db) {
  [
    '../miniprogram/utils/dailyRecordV2Service.js',
    '../miniprogram/models/dailySummaryV2.js',
    '../miniprogram/models/feedingRecordV2.js',
    '../miniprogram/models/foodIntakeRecord.js',
    '../miniprogram/models/medicationRecord.js',
    '../miniprogram/models/treatmentRecord.js'
  ].forEach((modulePath) => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') {
        throw error;
      }
    }
  });

  const previousWx = global.wx;
  global.wx = {
    cloud: {
      database() {
        return db;
      }
    }
  };

  try {
    const service = require('../miniprogram/utils/dailyRecordV2Service.js');
    const FeedingRecordV2Model = require('../miniprogram/models/feedingRecordV2.js');
    const FoodIntakeRecordModel = require('../miniprogram/models/foodIntakeRecord.js');
    const MedicationRecordModel = require('../miniprogram/models/medicationRecord.js');
    const TreatmentRecordModel = require('../miniprogram/models/treatmentRecord.js');
    return {
      service,
      models: {
        FeedingRecordV2Model,
        FoodIntakeRecordModel,
        MedicationRecordModel,
        TreatmentRecordModel
      },
      restore() {
        global.wx = previousWx;
      }
    };
  } catch (error) {
    global.wx = previousWx;
    throw error;
  }
}

test('getDailyRecordV2 returns a clean daily_summary_v2 cache while loading v2 event lists', async () => {
  const cleanSummary = {
    _id: 'summary-1',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    isDirty: false,
    basicInfo: { weight: '6.2' },
    milk: { calories: 100 },
    food: { calories: 40 },
    treatment: { calories: 10 },
    macroSummary: { calories: 150, protein: 3 }
  };
  const { db, calls } = createDbMock({
    dailySummaryData: [cleanSummary],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active' }],
    bowelRecords: [{ _id: 'bowel-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active' }]
  });
  const { service, models, restore } = loadFreshService(db);
  const modelCalls = [];
  models.FeedingRecordV2Model.getRecordsByDate = async (babyUid, date) => {
    modelCalls.push(['milk', babyUid, date]);
    return [{ _id: 'milk-1' }];
  };
  models.FoodIntakeRecordModel.findByDate = async (babyUid, date) => {
    modelCalls.push(['food', babyUid, date]);
    return [{ _id: 'food-1' }];
  };
  models.MedicationRecordModel.findByDate = async (date, babyUid) => {
    modelCalls.push(['medication', babyUid, date]);
    return { success: true, data: [{ _id: 'medication-1' }] };
  };
  models.TreatmentRecordModel.findByDate = async (date, babyUid) => {
    modelCalls.push(['treatment', babyUid, date]);
    return { success: true, data: [{ _id: 'treatment-1' }] };
  };

  try {
    const dailyRecord = await service.getDailyRecordV2('baby-1', '2026-05-25');

    assert.equal(dailyRecord.summary._id, 'summary-1');
    assert.deepEqual(dailyRecord.basicInfo, { weight: '6.2' });
    assert.deepEqual(dailyRecord.milkRecords, [{ _id: 'milk-1' }]);
    assert.deepEqual(dailyRecord.foodIntakeRecords, [{ _id: 'food-1' }]);
    assert.deepEqual(dailyRecord.medicationRecords, [{ _id: 'medication-1' }]);
    assert.deepEqual(dailyRecord.treatmentRecords, [{ _id: 'treatment-1' }]);
    assert.deepEqual(dailyRecord.bowelRecords, [{ _id: 'bowel-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active' }]);
    assert.deepEqual(modelCalls.map(([name]) => name), ['milk', 'food', 'medication', 'treatment']);
    assert.equal(calls.addCollection, '');
    assert.equal(calls.updateCollection, '');
    assert.equal(calls.collectionReads.includes('feeding_records'), false);
  } finally {
    restore();
  }
});

test('getDailyRecordV2 rebuilds and upserts summary when cache is missing or dirty', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [{ _id: 'summary-dirty', babyUid: 'baby-1', date: '2026-05-25', status: 'active', isDirty: true }],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', weight: '6.3' }],
    bowelRecords: [{ _id: 'bowel-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', type: 'normal' }]
  });
  const { service, models, restore } = loadFreshService(db);
  models.FeedingRecordV2Model.getRecordsByDate = async () => [
    {
      _id: 'milk-1',
      nutritionSummary: {
        totalVolume: 100,
        calories: 80,
        protein: 2,
        naturalProtein: 2
      }
    }
  ];
  models.FoodIntakeRecordModel.findByDate = async () => [
    {
      _id: 'food-1',
      nutrition: {
        calories: 20,
        protein: 1,
        naturalProtein: 1,
        carbs: 4,
        fat: 0.5
      }
    }
  ];
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({
    success: true,
    data: [
      {
        _id: 'treatment-1',
        summary: {
          totalCalories: 10,
          carbs: 2,
          protein: 0,
          fat: 0
        }
      }
    ]
  });

  try {
    const dailyRecord = await service.getDailyRecordV2('baby-1', '2026-05-25');

    assert.equal(dailyRecord.summary.isDirty, false);
    assert.equal(dailyRecord.summary.basicInfo.weight, '6.3');
    assert.deepEqual(dailyRecord.summary.macroSummary, {
      calories: 110,
      protein: 3,
      naturalProtein: 3,
      specialProtein: 0,
      carbs: 6,
      fat: 0.5
    });
    assert.equal(calls.updateCollection, 'daily_summary_v2');
    assert.equal(calls.updateDocId, 'summary-dirty');
    assert.equal(calls.updateData.isDirty, false);
    assert.equal(calls.collectionReads.includes('feeding_records'), false);
  } finally {
    restore();
  }
});

test('getDailySummariesForRange reads daily_summary_v2 without legacy fallback by default', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [
      { _id: 'summary-1', babyUid: 'baby-1', date: '2026-05-24', status: 'active', isDirty: false },
      { _id: 'summary-2', babyUid: 'baby-1', date: '2026-05-25', status: 'active', isDirty: false }
    ],
    legacyFeedingRecords: [{ _id: 'legacy-1', babyUid: 'baby-1' }]
  });
  const { service, restore } = loadFreshService(db);

  try {
    const summaries = await service.getDailySummariesForRange('baby-1', '2026-05-24', '2026-05-25');

    assert.deepEqual(summaries.map((summary) => summary._id), ['summary-1', 'summary-2']);
    assert.equal(calls.collectionReads.includes('feeding_records'), false);
  } finally {
    restore();
  }
});
