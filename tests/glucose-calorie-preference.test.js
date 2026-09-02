const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getGlucoseCalorieCoefficient,
  saveGlucoseCalorieCoefficient,
  glucoseCalorieStorageKey
} = require('../miniprogram/utils/glucoseCaloriePreference');

function createWxMock({ babyDoc = null, failUpdate = false } = {}) {
  const storage = {};
  const writes = [];
  const wx = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : '';
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    cloud: {
      database() {
        return {
          serverDate: () => 'SERVER_DATE',
          collection(name) {
            assert.equal(name, 'baby_info');
            return {
              where(query) {
                assert.deepEqual(query, { babyUid: 'baby-1' });
                return this;
              },
              limit() {
                return this;
              },
              doc(id) {
                assert.equal(id, 'doc-1');
                return this;
              },
              async get() {
                return { data: babyDoc ? [babyDoc] : [] };
              },
              async update(payload) {
                if (failUpdate) throw new Error('update failed');
                writes.push(payload);
                return {};
              }
            };
          }
        };
      }
    }
  };
  return { wx, storage, writes };
}

test('getGlucoseCalorieCoefficient prefers a valid cloud coefficient and refreshes local cache', async () => {
  const { wx, storage } = createWxMock({
    babyDoc: {
      _id: 'doc-1',
      glucoseCalorieCoefficient: 4
    }
  });

  const coefficient = await getGlucoseCalorieCoefficient('baby-1', wx);

  assert.equal(coefficient, 4);
  assert.equal(storage[glucoseCalorieStorageKey('baby-1')], 4);
});

test('getGlucoseCalorieCoefficient keeps local 4 when cloud value is empty', async () => {
  const { wx, storage } = createWxMock({
    babyDoc: {
      _id: 'doc-1'
    }
  });
  storage[glucoseCalorieStorageKey('baby-1')] = 4;

  const coefficient = await getGlucoseCalorieCoefficient('baby-1', wx);

  assert.equal(coefficient, 4);
});

test('getGlucoseCalorieCoefficient defaults to 3.4 when nothing is stored', async () => {
  const { wx } = createWxMock();
  const coefficient = await getGlucoseCalorieCoefficient('baby-1', wx);
  assert.equal(coefficient, 3.4);
});

test('saveGlucoseCalorieCoefficient writes cloud and local cache', async () => {
  const { wx, storage, writes } = createWxMock({
    babyDoc: { _id: 'doc-1' }
  });

  const saved = await saveGlucoseCalorieCoefficient('baby-1', 4, wx);

  assert.equal(saved, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.glucoseCalorieCoefficient, 4);
  assert.equal(writes[0].data.updatedAt, 'SERVER_DATE');
  assert.equal(storage[glucoseCalorieStorageKey('baby-1')], 4);
});

test('saveGlucoseCalorieCoefficient falls back to local cache when cloud write fails', async () => {
  const { wx, storage } = createWxMock({
    babyDoc: { _id: 'doc-1' },
    failUpdate: true
  });

  const saved = await saveGlucoseCalorieCoefficient('baby-1', 4, wx);

  assert.equal(saved, false);
  assert.equal(storage[glucoseCalorieStorageKey('baby-1')], 4);
});
