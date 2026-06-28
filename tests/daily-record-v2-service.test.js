const test = require('node:test');
const assert = require('node:assert/strict');

function createDbMock(overrides = {}) {
  const calls = {
    collectionReads: [],
    whereCalls: [],
    addCollection: '',
    addData: null,
    adds: [],
    updateCollection: '',
    updateDocId: '',
    updateData: null
  };
  const dataByCollection = {
    daily_summary_v2: overrides.dailySummaryData || [],
    food_intake_records: overrides.foodIntakeData || [],
    growth_records_v2: overrides.growthRecordsV2Data || [],
    bowel_records: overrides.bowelRecords || [],
    feeding_records_v2: overrides.v2Data || [],
    baby_info: overrides.babyInfoData || [],
    feeding_records: overrides.legacyFeedingRecords || []
  };

  function queryFor(collectionName, whereInput = {}) {
    calls.whereCalls.push({ collectionName, whereInput });
    return {
      _where: whereInput,
      _orderBy: null,
      _skip: 0,
      _limit: null,
      skip(value) {
        this._skip = Number(value) || 0;
        return this;
      },
      limit(value) {
        this._limit = Number(value) || 0;
        return this;
      },
      orderBy(field, direction) {
        this._orderBy = { field, direction };
        return this;
      },
      async get() {
        calls.collectionReads.push(collectionName);
        let data = (dataByCollection[collectionName] || []).filter((record) => (
          Object.entries(this._where || {}).every(([key, expected]) => {
            if (expected && expected.__op === 'lt') {
              return record[key] < expected.value;
            }
            if (expected && expected.__op === 'lte') {
              return record[key] <= expected.value;
            }
            if (expected && expected.__op === 'gte') {
              return record[key] >= expected.value;
            }
            if (expected && expected.__op === 'and') {
              return expected.conditions.every((condition) => {
                if (condition.__op === 'lt') return record[key] < condition.value;
                if (condition.__op === 'lte') return record[key] <= condition.value;
                if (condition.__op === 'gte') return record[key] >= condition.value;
                return false;
              });
            }
            return record[key] === expected;
          })
        ));
        if (this._orderBy) {
          const { field, direction } = this._orderBy;
          data = [...data].sort((left, right) => {
            if (left[field] === right[field]) return 0;
            const result = left[field] > right[field] ? 1 : -1;
            return direction === 'desc' ? -result : result;
          });
        }
        if (this._skip > 0 || this._limit !== null) {
          const end = this._limit !== null ? this._skip + this._limit : undefined;
          data = data.slice(this._skip, end);
        }
        return { data };
      }
    };
  }

  const db = {
    command: {
      gte(value) {
        return {
          __op: 'gte',
          value,
          and(other) {
            return { __op: 'and', conditions: [this, other] };
          }
        };
      },
      lt(value) {
        return {
          __op: 'lt',
          value,
          and(other) {
            return { __op: 'and', conditions: [this, other] };
          }
        };
      },
      lte(value) {
        return {
          __op: 'lte',
          value,
          and(other) {
            return { __op: 'and', conditions: [this, other] };
          }
        };
      }
    },
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
          calls.adds.push({ collectionName: name, data });
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
    foodIntakeData: [{ _id: 'food-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', nutrition: { calories: 40 } }],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active' }],
    bowelRecords: [{ _id: 'bowel-1', babyUid: 'baby-1', date: '2026-05-25', recordTime: new Date(2026, 4, 25, 10), status: 'active' }]
  });
  const { service, models, restore } = loadFreshService(db);
  const modelCalls = [];
  models.FeedingRecordV2Model.getRecordsByDate = async (babyUid, date) => {
    modelCalls.push(['milk', babyUid, date]);
    return [{ _id: 'milk-1' }];
  };
  models.FoodIntakeRecordModel.findByDate = async (babyUid, date) => {
    modelCalls.push(['food', babyUid, date]);
    return [{ _id: 'food-1', nutrition: { calories: 40 } }];
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
    assert.deepEqual(dailyRecord.foodIntakeRecords, [{ _id: 'food-1', nutrition: { calories: 40 } }]);
    assert.equal(dailyRecord.usesLegacyFoodIntakes, false);
    assert.deepEqual(dailyRecord.medicationRecords, [{ _id: 'medication-1' }]);
    assert.deepEqual(dailyRecord.treatmentRecords, [{ _id: 'treatment-1' }]);
    assert.deepEqual(dailyRecord.bowelRecords.map(record => record._id), ['bowel-1']);
    assert.deepEqual(modelCalls.map(([name]) => name), ['milk', 'food', 'medication', 'treatment']);
    assert.equal(calls.addCollection, '');
    assert.equal(calls.updateCollection, '');
    assert.equal(calls.collectionReads.includes('feeding_records'), false);
  } finally {
    restore();
  }
});

test('getDailySummaryForDate returns clean summary without loading event detail collections', async () => {
  const cleanSummary = {
    _id: 'summary-clean',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    isDirty: false,
    rev: 100,
    basicInfo: { weight: '6.2' },
    macroSummary: { calories: 150, protein: 3 }
  };
  const { db, calls } = createDbMock({
    dailySummaryData: [cleanSummary]
  });
  const { service, models, restore } = loadFreshService(db);
  const modelCalls = [];
  models.FeedingRecordV2Model.getRecordsByDate = async () => {
    modelCalls.push('milk');
    return [];
  };
  models.FoodIntakeRecordModel.findByDate = async () => {
    modelCalls.push('food');
    return [];
  };
  models.MedicationRecordModel.findByDate = async () => {
    modelCalls.push('medication');
    return { success: true, data: [] };
  };
  models.TreatmentRecordModel.findByDate = async () => {
    modelCalls.push('treatment');
    return { success: true, data: [] };
  };

  try {
    const summary = await service.getDailySummaryForDate('baby-1', '2026-05-25');

    assert.equal(summary._id, 'summary-clean');
    assert.deepEqual(summary.basicInfo, { weight: '6.2' });
    assert.deepEqual(modelCalls, []);
    assert.deepEqual(calls.collectionReads, ['daily_summary_v2']);
  } finally {
    restore();
  }
});

test('getDailySummaryForDate rebuilds dirty summary before returning it', async () => {
  const dirtySummary = {
    _id: 'summary-dirty',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    isDirty: true,
    rev: 100,
    basicInfo: { weight: '5.9' },
    macroSummary: { calories: 0, protein: 0 }
  };
  const { db, calls } = createDbMock({
    dailySummaryData: [dirtySummary],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', weight: '6.2' }]
  });
  const { service, models, restore } = loadFreshService(db);
  const modelCalls = [];
  models.FeedingRecordV2Model.getRecordsByDate = async () => {
    modelCalls.push('milk');
    return [
      {
        _id: 'milk-1',
        nutritionSummary: {
          totalVolume: 120,
          calories: 80,
          protein: 2,
          naturalProtein: 2
        }
      }
    ];
  };
  models.FoodIntakeRecordModel.findByDate = async () => {
    modelCalls.push('food');
    return [];
  };
  models.MedicationRecordModel.findByDate = async () => {
    modelCalls.push('medication');
    return { success: true, data: [] };
  };
  models.TreatmentRecordModel.findByDate = async () => {
    modelCalls.push('treatment');
    return { success: true, data: [] };
  };

  try {
    const summary = await service.getDailySummaryForDate('baby-1', '2026-05-25');

    assert.equal(summary._id, 'summary-dirty');
    assert.equal(summary.isDirty, false);
    assert.equal(summary.basicInfo.weight, '6.2');
    assert.equal(summary.macroSummary.calories, 80);
    assert.deepEqual(modelCalls, ['milk', 'food', 'medication', 'treatment']);
    assert.equal(calls.updateCollection, 'daily_summary_v2');
    assert.equal(calls.updateDocId, 'summary-dirty');
  } finally {
    restore();
  }
});

test('getDailyRecordTabDetails loads only the requested food tab details', async () => {
  const { db, calls } = createDbMock({});
  const { service, models, restore } = loadFreshService(db);
  const modelCalls = [];
  models.FeedingRecordV2Model.getRecordsByDate = async () => {
    modelCalls.push('milk');
    return [];
  };
  models.FoodIntakeRecordModel.findByDate = async (babyUid, date) => {
    modelCalls.push(['food', babyUid, date]);
    return [{ _id: 'food-1', babyUid, date, status: 'active' }];
  };
  models.MedicationRecordModel.findByDate = async () => {
    modelCalls.push('medication');
    return { success: true, data: [] };
  };
  models.TreatmentRecordModel.findByDate = async () => {
    modelCalls.push('treatment');
    return { success: true, data: [] };
  };

  try {
    const details = await service.getDailyRecordTabDetails('baby-1', '2026-05-25', 'food');

    assert.deepEqual(details, {
      tab: 'food',
      foodIntakeRecords: [{ _id: 'food-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active' }]
    });
    assert.deepEqual(modelCalls, [['food', 'baby-1', '2026-05-25']]);
    assert.deepEqual(calls.collectionReads, []);
  } finally {
    restore();
  }
});

test('getDailyRecordV2 rebuilds clean cache when cached basicInfo is empty but milk snapshots have body measurements', async () => {
  const cleanSummary = {
    _id: 'summary-empty-basic',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    isDirty: false,
    basicInfo: {},
    milk: { calories: 100 },
    macroSummary: { calories: 100, protein: 2 }
  };
  const { db, calls } = createDbMock({
    dailySummaryData: [cleanSummary]
  });
  const { service, models, restore } = loadFreshService(db);
  models.FeedingRecordV2Model.getRecordsByDate = async () => [
    {
      _id: 'milk-1',
      basicInfoSnapshot: {
        weight: '5.8',
        height: '62',
        naturalProteinCoefficient: '1.2'
      },
      nutritionSummary: {
        totalVolume: 120,
        calories: 80,
        protein: 2,
        naturalProtein: 2
      }
    }
  ];
  models.FoodIntakeRecordModel.findByDate = async () => [];
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    const dailyRecord = await service.getDailyRecordV2('baby-1', '2026-05-25');

    assert.equal(dailyRecord.basicInfo.weight, '5.8');
    assert.equal(dailyRecord.basicInfo.height, '62');
    assert.equal(dailyRecord.summary._id, 'summary-empty-basic');
    assert.equal(calls.updateCollection, 'daily_summary_v2');
    assert.equal(calls.updateDocId, 'summary-empty-basic');
    assert.equal(calls.updateData.basicInfo.weight, '5.8');
    assert.equal(calls.updateData.basicInfo.height, '62');
    assert.equal(calls.updateData.isDirty, false);
  } finally {
    restore();
  }
});

test('getDailyRecordV2 carries the latest body measurements into today growth_records_v2 when today is missing them', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [],
    growthRecordsV2Data: [
      {
        _id: 'growth-old',
        babyUid: 'baby-1',
        date: '2026-05-24',
        status: 'active',
        weight: '5.7',
        height: '61',
        naturalProteinCoefficient: '1.2'
      }
    ]
  });
  const { service, models, restore } = loadFreshService(db);
  models.FeedingRecordV2Model.getRecordsByDate = async () => [];
  models.FoodIntakeRecordModel.findByDate = async () => [];
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    const dailyRecord = await service.getDailyRecordV2('baby-1', '2026-05-25');

    assert.equal(dailyRecord.basicInfo.weight, '5.7');
    assert.equal(dailyRecord.basicInfo.height, '61');
    // 系数属于设定，不应被自动顺延进当天成长记录/汇总。
    assert.equal(dailyRecord.basicInfo.naturalProteinCoefficient, '');
    const growthWrite = calls.adds.find((item) => item.collectionName === 'growth_records_v2');
    assert.ok(growthWrite);
    assert.equal(growthWrite.data.babyUid, 'baby-1');
    assert.equal(growthWrite.data.date, '2026-05-25');
    assert.equal(growthWrite.data.weight, '5.7');
    assert.equal(growthWrite.data.height, '61');
    assert.ok(!growthWrite.data.naturalProteinCoefficient, 'coefficients must not be carried forward into growth records');
    const summaryWrite = calls.adds.find((item) => item.collectionName === 'daily_summary_v2');
    assert.ok(summaryWrite);
    assert.equal(summaryWrite.data.basicInfo.height, '61');
    assert.equal(summaryWrite.data.basicInfo.naturalProteinCoefficient, '');
  } finally {
    restore();
  }
});

test('getDailyRecordV2 rebuilds and upserts summary when cache is missing or dirty', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [{ _id: 'summary-dirty', babyUid: 'baby-1', date: '2026-05-25', status: 'active', isDirty: true }],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', weight: '6.3' }],
    foodIntakeData: [
      {
        _id: 'food-1',
        babyUid: 'baby-1',
        date: '2026-05-25',
        status: 'active',
        nutrition: {
          calories: 20,
          protein: 1,
          naturalProtein: 1,
          carbs: 4,
          fat: 0.5
        }
      }
    ],
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
  models.FoodIntakeRecordModel.findByDate = async () => db.collection('food_intake_records')
    .where({ babyUid: 'baby-1', date: '2026-05-25', status: 'active' })
    .get()
    .then(res => res.data || []);
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

test('dirty daily_summary_v2 rebuild uses actual food_intake_records nutrition and ignores legacy food intakes', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [{ _id: 'summary-dirty', babyUid: 'baby-1', date: '2026-05-25', status: 'active', isDirty: true }],
    foodIntakeData: [
      {
        _id: 'food-half-1',
        babyUid: 'baby-1',
        date: '2026-05-25',
        status: 'active',
        recordedAt: new Date('2026-05-25T08:30:00.000Z'),
        foodName: '米粉',
        quantity: 10,
        plannedQuantity: 20,
        unit: 'g',
        nutrition: {
          calories: 50,
          protein: 2,
          naturalProtein: 1.5,
          specialProtein: 0.5,
          carbs: 7.25,
          fat: 0.75,
          fiber: 1.125
        },
        plannedNutrition: {
          calories: 100,
          protein: 4,
          naturalProtein: 3,
          specialProtein: 1,
          carbs: 14.5,
          fat: 1.5,
          fiber: 2.25
        },
        completionPercent: 50,
        mealCombinationSource: {
          combinationId: 'combo-breakfast',
          combinationName: '早餐组合'
        }
      },
      {
        _id: 'food-half-2',
        babyUid: 'baby-1',
        date: '2026-05-25',
        status: 'active',
        recordedAt: new Date('2026-05-25T08:35:00.000Z'),
        foodName: '苹果泥',
        quantity: 5.1175,
        plannedQuantity: 10.235,
        unit: 'g',
        nutrition: {
          calories: 10.235,
          protein: 0.333,
          naturalProtein: 0.123,
          specialProtein: 0.21,
          carbs: 1.234,
          fat: 0.456,
          fiber: 0.789
        },
        plannedNutrition: {
          calories: 20.47,
          protein: 0.666,
          naturalProtein: 0.246,
          specialProtein: 0.42,
          carbs: 2.468,
          fat: 0.912,
          fiber: 1.578
        },
        completionPercent: 50,
        mealCombinationSource: {
          combinationId: 'combo-breakfast',
          combinationName: '早餐组合'
        }
      },
      {
        _id: 'food-archived',
        babyUid: 'baby-1',
        date: '2026-05-25',
        status: 'archived',
        recordedAt: new Date('2026-05-25T08:40:00.000Z'),
        foodName: '应被状态过滤',
        nutrition: { calories: 999 },
        plannedNutrition: { calories: 1998 },
        completionPercent: 50
      },
      {
        _id: 'food-other-date',
        babyUid: 'baby-1',
        date: '2026-05-24',
        status: 'active',
        recordedAt: new Date('2026-05-24T08:30:00.000Z'),
        foodName: '应被日期过滤',
        nutrition: { calories: 999 },
        plannedNutrition: { calories: 1998 },
        completionPercent: 50
      }
    ]
  });
  const { service, models, restore } = loadFreshService(db);
  models.FeedingRecordV2Model.getRecordsByDate = async () => [];
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    const dailyRecord = await service.getDailyRecordV2('baby-1', '2026-05-25');

    assert.deepEqual(dailyRecord.summary.food, {
      calories: 60.24,
      protein: 2.33,
      naturalProtein: 1.62,
      specialProtein: 0.71,
      premiumProtein: 0,
      regularProtein: 1.62,
      fat: 1.21,
      carbs: 8.48,
      fiber: 1.91
    });
    assert.deepEqual(dailyRecord.summary.macroSummary, {
      calories: 60.24,
      protein: 2.33,
      naturalProtein: 1.62,
      specialProtein: 0.71,
      carbs: 8.48,
      fat: 1.21
    });
    assert.equal(dailyRecord.summary.recordCounts.food, 2);
    assert.equal(calls.whereCalls.some((call) => call.collectionName === 'food_intake_records'), true);
    assert.equal(calls.whereCalls.some((call) => call.collectionName === 'feeding_records'), false);
    assert.equal(calls.updateCollection, 'daily_summary_v2');
    assert.deepEqual(calls.updateData.food, dailyRecord.summary.food);
  } finally {
    restore();
  }
});

test('getDailyRecordV2 refreshes clean cache when legacy food changes the daily macro summary', async () => {
  const cachedMilkOnlySummary = {
    _id: 'summary-milk-only',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    isDirty: false,
    basicInfo: { weight: '6.2', height: '61' },
    milk: {
      calories: 80,
      protein: 2,
      naturalProtein: 2,
      specialProtein: 0
    },
    food: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0
    },
    macroSummary: {
      calories: 80,
      protein: 2,
      naturalProtein: 2,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    },
    recordCounts: {
      milk: 1,
      food: 0,
      medication: 0,
      treatment: 0,
      bowel: 0
    }
  };
  const { db, calls } = createDbMock({
    dailySummaryData: [cachedMilkOnlySummary],
    foodIntakeData: [
      {
        _id: 'v2-food-1',
        babyUid: 'baby-1',
        date: '2026-05-25',
        status: 'active',
        nutrition: {
          calories: 20,
          protein: 1,
          naturalProtein: 1,
          specialProtein: 0,
          carbs: 4,
          fat: 0.5
        }
      }
    ],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', weight: '6.2', height: '61' }]
  });
  const { service, models, restore } = loadFreshService(db);
  models.FeedingRecordV2Model.getRecordsByDate = async () => [
    {
      _id: 'milk-1',
      nutritionSummary: {
        totalVolume: 100,
        calories: 80,
        protein: 2,
        naturalProtein: 2,
        specialProtein: 0
      }
    }
  ];
  models.FoodIntakeRecordModel.findByDate = async () => db.collection('food_intake_records')
    .where({ babyUid: 'baby-1', date: '2026-05-25', status: 'active' })
    .get()
    .then(res => res.data || []);
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    const dailyRecord = await service.getDailyRecordV2('baby-1', '2026-05-25');

    assert.equal(dailyRecord.summary._id, 'summary-milk-only');
    assert.equal(dailyRecord.summary.recordCounts.food, 1);
    assert.deepEqual(dailyRecord.summary.macroSummary, {
      calories: 100,
      protein: 3,
      naturalProtein: 3,
      specialProtein: 0,
      carbs: 4,
      fat: 0.5
    });
    assert.equal(calls.updateCollection, 'daily_summary_v2');
    assert.equal(calls.updateDocId, 'summary-milk-only');
    assert.deepEqual(calls.updateData.macroSummary, dailyRecord.summary.macroSummary);
  } finally {
    restore();
  }
});

test('getDailySummariesForRange rebuildMissing 补齐缺失天的汇总', async () => {
  const { db } = createDbMock({
    dailySummaryData: [
      { _id: 'summary-24', babyUid: 'baby-1', date: '2026-05-24', status: 'active', isDirty: false }
      // 2026-05-25 缺失，应按原始记录重建
    ]
  });
  const { service, models, restore } = loadFreshService(db);
  models.FeedingRecordV2Model.getRecordsByDate = async (babyUid, date) => {
    if (date === '2026-05-25') {
      return [{
        _id: 'milk-25',
        date: '2026-05-25',
        startTime: '08:00',
        nutritionSummary: {
          calories: 70, protein: 1.5, naturalProtein: 1.5, specialProtein: 0, carbs: 6, fat: 3, totalVolume: 90
        }
      }];
    }
    return [];
  };
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    const summaries = await service.getDailySummariesForRange('baby-1', '2026-05-24', '2026-05-25', {
      rebuildMissing: true
    });
    const byDate = Object.fromEntries(summaries.map((summary) => [summary.date, summary]));
    assert.deepEqual(Object.keys(byDate).sort(), ['2026-05-24', '2026-05-25']);
    assert.equal(byDate['2026-05-24']._id, 'summary-24'); // 已有且 fresh 的天保持原样
    assert.equal(byDate['2026-05-25'].macroSummary.calories, 70); // 缺失天按原始记录重建
    assert.equal(byDate['2026-05-25'].recordCounts.milk, 1);
  } finally {
    restore();
  }
});

test('getDailySummariesForRange rebuildMissing 跳过 skipDates（如今天另行处理）', async () => {
  const { db } = createDbMock({ dailySummaryData: [] });
  const { service, models, restore } = loadFreshService(db);
  const rebuiltDates = [];
  models.FeedingRecordV2Model.getRecordsByDate = async (babyUid, date) => {
    rebuiltDates.push(date);
    return [];
  };
  models.MedicationRecordModel.findByDate = async () => ({ success: true, data: [] });
  models.TreatmentRecordModel.findByDate = async () => ({ success: true, data: [] });

  try {
    await service.getDailySummariesForRange('baby-1', '2026-05-24', '2026-05-25', {
      rebuildMissing: true,
      skipDates: ['2026-05-25']
    });
    assert.equal(rebuiltDates.includes('2026-05-25'), false);
    assert.equal(rebuiltDates.includes('2026-05-24'), true);
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

test('getDailySummariesForRange pushes date range into daily_summary_v2 query', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [
      { _id: 'before', babyUid: 'baby-1', date: '2026-05-23', status: 'active', isDirty: false },
      { _id: 'in-1', babyUid: 'baby-1', date: '2026-05-24', status: 'active', isDirty: false },
      { _id: 'in-2', babyUid: 'baby-1', date: '2026-05-25', status: 'active', isDirty: false },
      { _id: 'after', babyUid: 'baby-1', date: '2026-05-26', status: 'active', isDirty: false }
    ]
  });
  const { service, restore } = loadFreshService(db);

  try {
    const summaries = await service.getDailySummariesForRange('baby-1', '2026-05-24', '2026-05-25');
    const summaryQuery = calls.whereCalls.find(call => call.collectionName === 'daily_summary_v2')?.whereInput;
    assert.deepEqual(summaries.map(summary => summary._id), ['in-1', 'in-2']);
    assert.equal(summaryQuery.date.__op, 'and');
    assert.deepEqual(summaryQuery.date.conditions.map(condition => condition.__op), ['gte', 'lte']);
  } finally {
    restore();
  }
});

test('getDailySummariesForRange rereads daily_summary_v2 for repeated range reads to keep summaries fresh', async () => {
  const { db, calls } = createDbMock({
    dailySummaryData: [
      { _id: 'summary-1', babyUid: 'baby-1', date: '2026-05-24', status: 'active', isDirty: false },
      { _id: 'summary-2', babyUid: 'baby-1', date: '2026-05-25', status: 'active', isDirty: false }
    ]
  });
  const { service, restore } = loadFreshService(db);

  try {
    await service.getDailySummariesForRange('baby-1', '2026-05-24', '2026-05-25', {
      rebuildMissing: true,
      skipDates: []
    });
    const readsAfterFirst = calls.collectionReads.length;
    await service.getDailySummariesForRange('baby-1', '2026-05-24', '2026-05-25', {
      rebuildMissing: true,
      skipDates: []
    });
    assert.deepEqual(calls.collectionReads.slice(readsAfterFirst), ['daily_summary_v2']);
  } finally {
    restore();
  }
});

// —— 第 2 步：getDailyRecordV2 进程内明细缓存（命中 / 失效 / forceRefresh / invalidate / 零回退） ——

// 构造一个「干净且重建不会触发 upsert」的当天场景：
// 首次必为 cache miss（读 6 集合且不写库，从而 finalSummary 保留预置 rev），第二次方可命中。
function setupDailyRecordCacheScenario(summaryOverrides = {}) {
  const summary = {
    _id: 'summary-cache',
    babyUid: 'baby-1',
    date: '2026-05-25',
    status: 'active',
    isDirty: false,
    rev: 111,
    basicInfo: { weight: '6.2', height: '61' },
    milk: { calories: 100, protein: 2, naturalProtein: 2, specialProtein: 0, totalVolume: 100, totalPowderWeight: 0 },
    food: { calories: 0, protein: 0, naturalProtein: 0, specialProtein: 0, fat: 0, carbs: 0, fiber: 0 },
    treatment: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    macroSummary: { calories: 100, protein: 2, naturalProtein: 2, specialProtein: 0, carbs: 0, fat: 0 },
    recordCounts: { milk: 1, food: 0, medication: 0, treatment: 0, bowel: 0 },
    ...summaryOverrides
  };
  const { db, calls } = createDbMock({
    dailySummaryData: [summary],
    growthRecordsV2Data: [{ _id: 'growth-1', babyUid: 'baby-1', date: '2026-05-25', status: 'active', weight: '6.2', height: '61' }]
  });
  const { service, models, restore } = loadFreshService(db);
  const modelCalls = [];
  models.FeedingRecordV2Model.getRecordsByDate = async () => { modelCalls.push('milk'); return []; };
  models.FoodIntakeRecordModel.findByDate = async () => { modelCalls.push('food'); return []; };
  models.MedicationRecordModel.findByDate = async () => { modelCalls.push('medication'); return { success: true, data: [] }; };
  models.TreatmentRecordModel.findByDate = async () => { modelCalls.push('treatment'); return { success: true, data: [] }; };
  return { db, calls, service, restore, summary, modelCalls };
}

test('getDailyRecordV2 第二次命中缓存：跳过 6 个事件集合，只探测 summary 一次', async () => {
  const { calls, service, restore, modelCalls } = setupDailyRecordCacheScenario();
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25'); // miss
    assert.ok(modelCalls.length > 0, '首次应读取事件集合');
    assert.equal(calls.updateCollection, '', '干净且无增量不应 upsert（否则 rev 会变导致第二次无法命中）');

    modelCalls.length = 0;
    const readsBefore = calls.collectionReads.length;
    const second = await service.getDailyRecordV2('baby-1', '2026-05-25'); // hit
    assert.deepEqual(modelCalls, [], '命中缓存不应再读事件集合');
    assert.deepEqual(calls.collectionReads.slice(readsBefore), ['daily_summary_v2'], '命中时只探测 summary 一次');
    assert.equal(second.summary._id, 'summary-cache');
  } finally {
    restore();
  }
});

test('getDailyRecordV2 在 rev 变化（含别端写入）时失效并重读', async () => {
  const { service, restore, summary, modelCalls } = setupDailyRecordCacheScenario();
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25'); // miss，缓存 rev=111
    modelCalls.length = 0;
    summary.rev = 222; // 模拟别端写入后云端 rev 变化
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    assert.ok(modelCalls.length > 0, 'rev 变化应失效并重读事件集合');
  } finally {
    restore();
  }
});

test('getDailyRecordV2 在 isDirty=true 时失效并重读', async () => {
  const { service, restore, summary, modelCalls } = setupDailyRecordCacheScenario();
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    modelCalls.length = 0;
    summary.isDirty = true; // 本端写入后被标脏
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    assert.ok(modelCalls.length > 0, 'isDirty 应失效并重读事件集合');
  } finally {
    restore();
  }
});

test('getDailyRecordV2 forceRefresh 忽略缓存强制重读', async () => {
  const { service, restore, modelCalls } = setupDailyRecordCacheScenario();
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    modelCalls.length = 0;
    await service.getDailyRecordV2('baby-1', '2026-05-25', { forceRefresh: true });
    assert.ok(modelCalls.length > 0, 'forceRefresh 应强制重读');
  } finally {
    restore();
  }
});

test('invalidateDailyRecordCache 使指定日期缓存失效', async () => {
  const { service, restore, modelCalls } = setupDailyRecordCacheScenario();
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    modelCalls.length = 0;
    service.invalidateDailyRecordCache('baby-1', '2026-05-25');
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    assert.ok(modelCalls.length > 0, '失效后应重读');
  } finally {
    restore();
  }
});

test('getDailyRecordV2 对无 rev 的旧文档不缓存（行为同改造前，零回退）', async () => {
  const { service, restore, modelCalls } = setupDailyRecordCacheScenario({ rev: undefined });
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    modelCalls.length = 0;
    await service.getDailyRecordV2('baby-1', '2026-05-25');
    assert.ok(modelCalls.length > 0, '无 rev 不应命中缓存，仍读事件集合');
  } finally {
    restore();
  }
});

test('getDailyRecordV2 跨天使用独立缓存：不同日期不会串用昨天明细', async () => {
  const { service, restore, modelCalls } = setupDailyRecordCacheScenario();
  try {
    await service.getDailyRecordV2('baby-1', '2026-05-25'); // 缓存「昨天」
    modelCalls.length = 0;
    const next = await service.getDailyRecordV2('baby-1', '2026-05-26'); // 过 0 点后的「今天」
    assert.ok(modelCalls.length > 0, '不同日期应 cache miss、按新日期重新读取事件集合');
    assert.equal(next.date, '2026-05-26', '返回的是新日期的数据');
  } finally {
    restore();
  }
});
