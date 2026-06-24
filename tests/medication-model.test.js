const test = require('node:test');
const assert = require('node:assert/strict');

// 药物数据源已统一为 medications 集合（baby_info.medicationSettings 遗留字段及相关逻辑已移除）。
// 验证 getMedications 只读 medications 集合，且不再触碰 baby_info。
function loadMedicationModel(options = {}) {
  const modelPath = require.resolve('../miniprogram/models/medication.js');
  delete require.cache[modelPath];

  const previousWx = global.wx;

  const calls = { babyInfoReads: 0, medicationsReads: 0 };
  const storage = {
    baby_uid: 'babyUid' in options ? options.babyUid : 'baby-1'
  };

  const db = {
    serverDate: () => new Date('2026-06-01T00:00:00Z'),
    collection: (name) => ({
      where: () => ({
        get: async () => {
          if (name === 'baby_info') {
            calls.babyInfoReads += 1;
            return { data: [] };
          }
          if (name === 'medications') {
            calls.medicationsReads += 1;
            if (options.medicationsError) {
              throw options.medicationsError;
            }
            return { data: options.dbMedications || [] };
          }
          return { data: [] };
        }
      })
    })
  };

  global.wx = {
    cloud: { database: () => db },
    getStorageSync: (key) => storage[key]
  };

  const model = require(modelPath);

  function restore() {
    global.wx = previousWx;
  }

  return { model, calls, restore };
}

test('getMedications 读取 medications 集合返回当前宝宝的药物', async () => {
  const meds = [{ _id: 'm1', name: '精氨酸' }, { _id: 'm2', name: '左卡尼丁' }];
  const { model, calls, restore } = loadMedicationModel({ dbMedications: meds });
  try {
    const result = await model.getMedications();
    assert.deepEqual(result, meds);
    assert.equal(calls.medicationsReads, 1);
    assert.equal(calls.babyInfoReads, 0, '不应再读取 baby_info');
  } finally {
    restore();
  }
});

test('getMedications 无 babyUid 时返回空数组且不查库', async () => {
  const { model, calls, restore } = loadMedicationModel({ babyUid: '' });
  try {
    const result = await model.getMedications();
    assert.deepEqual(result, []);
    assert.equal(calls.medicationsReads, 0);
    assert.equal(calls.babyInfoReads, 0);
  } finally {
    restore();
  }
});

test('getMedications 无药物记录时返回空数组', async () => {
  const { model, restore } = loadMedicationModel({ dbMedications: [] });
  try {
    const result = await model.getMedications();
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test('getMedications 在集合不存在(-502005)时返回空数组', async () => {
  const error = new Error('collection not exists');
  error.errCode = -502005;
  const { model, restore } = loadMedicationModel({ medicationsError: error });
  try {
    const result = await model.getMedications();
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test('getMedications 查询异常时安全降级为空数组', async () => {
  const { model, restore } = loadMedicationModel({ medicationsError: new Error('network') });
  try {
    const result = await model.getMedications();
    assert.deepEqual(result, []);
  } finally {
    restore();
  }
});

test('getMedications 每次读取 medications 集合，保证用药配置最新', async () => {
  const meds = [{ _id: 'm1', name: '精氨酸' }];
  const { model, calls, restore } = loadMedicationModel({ dbMedications: meds });
  try {
    assert.deepEqual(await model.getMedications(), meds);
    assert.deepEqual(await model.getMedications(), meds);
    assert.equal(calls.medicationsReads, 2);
  } finally {
    restore();
  }
});
