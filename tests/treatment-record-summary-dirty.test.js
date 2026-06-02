const test = require('node:test');
const assert = require('node:assert/strict');

// 治疗记录增删改后，必须让 daily_summary_v2 缓存失效，
// 否则数据记录页/首页的“当日汇总”会沿用旧缓存（尤其删除/改小不会被增量刷新检测到）。
function loadTreatmentModel(options = {}) {
  const modelPath = require.resolve('../miniprogram/models/treatmentRecord.js');
  const summaryPath = require.resolve('../miniprogram/models/dailySummaryV2.js');
  delete require.cache[modelPath];
  delete require.cache[summaryPath];

  const previousWx = global.wx;
  const previousGetApp = global.getApp;

  const docStore = options.docStore || {};
  const calls = { markDirty: [], adds: [], updates: [], removes: [] };

  const collectionMock = {
    add: async ({ data }) => {
      calls.adds.push(data);
      return { _id: 'created-id' };
    },
    doc: (id) => ({
      get: async () => ({ data: docStore[id] || null }),
      update: async ({ data }) => {
        calls.updates.push({ id, data });
        return {};
      },
      remove: async () => {
        calls.removes.push(id);
        return {};
      }
    }),
    where: () => ({ orderBy: () => ({ get: async () => ({ data: [] }) }) })
  };

  const db = {
    collection: () => collectionMock,
    command: { gte: () => ({ and: () => ({}) }), lt: () => ({}) },
    serverDate: () => new Date('2026-06-01T00:00:00Z')
  };

  global.wx = {
    cloud: { database: () => db },
    getStorageSync: () => ''
  };
  global.getApp = () => ({ globalData: { babyUid: 'baby-1' } });

  const summaryModel = require(summaryPath);
  summaryModel.markDirty = async (babyUid, dateKey) => {
    calls.markDirty.push({ babyUid, dateKey });
    return true;
  };

  const treatmentModel = require(modelPath);

  function restore() {
    global.wx = previousWx;
    global.getApp = previousGetApp;
  }

  return { treatmentModel, calls, restore };
}

function validTreatmentData(overrides = {}) {
  return {
    date: '2026-06-01',
    recordType: 'iv',
    startTime: '08:00',
    notes: '',
    groups: [
      { name: '第1组', items: [{ category: 'dextrose_10', amount: 10, unit: 'ml', calories: 4 }] }
    ],
    ...overrides
  };
}

test('creating a treatment record marks the daily summary dirty', async () => {
  const { treatmentModel, calls, restore } = loadTreatmentModel();
  try {
    const result = await treatmentModel.create(validTreatmentData());
    assert.equal(result.success, true);
    assert.deepEqual(calls.markDirty, [{ babyUid: 'baby-1', dateKey: '2026-06-01' }]);
  } finally {
    restore();
  }
});

test('deleting a treatment record marks the owning day dirty using the stored record', async () => {
  const { treatmentModel, calls, restore } = loadTreatmentModel({
    docStore: {
      t1: { _id: 't1', babyUid: 'baby-9', dateKey: '2026-05-30' }
    }
  });
  try {
    const result = await treatmentModel.delete('t1');
    assert.equal(result.success, true);
    assert.deepEqual(calls.removes, ['t1']);
    assert.deepEqual(calls.markDirty, [{ babyUid: 'baby-9', dateKey: '2026-05-30' }]);
  } finally {
    restore();
  }
});

test('editing a treatment to a new date invalidates both the old and new day', async () => {
  const { treatmentModel, calls, restore } = loadTreatmentModel({
    docStore: {
      t1: { _id: 't1', babyUid: 'baby-1', dateKey: '2026-05-30' }
    }
  });
  try {
    const result = await treatmentModel.update('t1', validTreatmentData({ date: '2026-06-01' }));
    assert.equal(result.success, true);
    assert.deepEqual(calls.markDirty, [
      { babyUid: 'baby-1', dateKey: '2026-06-01' },
      { babyUid: 'baby-1', dateKey: '2026-05-30' }
    ]);
  } finally {
    restore();
  }
});

test('editing a treatment on the same day invalidates that day once', async () => {
  const { treatmentModel, calls, restore } = loadTreatmentModel({
    docStore: {
      t1: { _id: 't1', babyUid: 'baby-1', dateKey: '2026-06-01' }
    }
  });
  try {
    const result = await treatmentModel.update('t1', validTreatmentData({ date: '2026-06-01' }));
    assert.equal(result.success, true);
    assert.deepEqual(calls.markDirty, [{ babyUid: 'baby-1', dateKey: '2026-06-01' }]);
  } finally {
    restore();
  }
});
