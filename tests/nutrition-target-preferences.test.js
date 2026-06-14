const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getNutritionTargetPreferences,
  saveNutritionTargetPreferences,
  targetCoefStorageKey
} = require('../miniprogram/utils/nutritionTargetPreferences');

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

test('getNutritionTargetPreferences reads cloud baby target preferences and refreshes local cache', async () => {
  const { wx, storage } = createWxMock({
    babyDoc: {
      _id: 'doc-1',
      nutritionTargetPreferences: {
        naturalProteinCoefficient: '1.3',
        specialProteinCoefficient: '0.6',
        calorieCoefficient: '110',
        preferredTargetMode: 'calorie'
      }
    }
  });

  const preferences = await getNutritionTargetPreferences('baby-1', wx);

  assert.deepEqual(preferences, {
    naturalProteinCoefficient: '1.3',
    specialProteinCoefficient: '0.6',
    calorieCoefficient: '110',
    preferredTargetMode: 'calorie'
  });
  assert.deepEqual(storage[targetCoefStorageKey('baby-1')], preferences);
});

test('saveNutritionTargetPreferences writes baby target preferences to cloud and local cache', async () => {
  const { wx, storage, writes } = createWxMock({
    babyDoc: { _id: 'doc-1' }
  });

  const saved = await saveNutritionTargetPreferences('baby-1', {
    naturalProteinCoefficient: '1.2',
    specialProteinCoefficient: '0.5',
    calorieCoefficient: '100',
    preferredTargetMode: 'protein'
  }, wx);

  assert.equal(saved, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data.nutritionTargetPreferences, {
    naturalProteinCoefficient: '1.2',
    specialProteinCoefficient: '0.5',
    calorieCoefficient: '100',
    preferredTargetMode: 'protein'
  });
  assert.equal(writes[0].data.updatedAt, 'SERVER_DATE');
  assert.deepEqual(storage[targetCoefStorageKey('baby-1')], writes[0].data.nutritionTargetPreferences);
});

test('saveNutritionTargetPreferences falls back to local cache when cloud write fails', async () => {
  const { wx, storage } = createWxMock({
    babyDoc: { _id: 'doc-1' },
    failUpdate: true
  });

  const saved = await saveNutritionTargetPreferences('baby-1', {
    naturalProteinCoefficient: '1.4',
    specialProteinCoefficient: '',
    calorieCoefficient: '120'
  }, wx);

  assert.equal(saved, false);
  assert.deepEqual(storage[targetCoefStorageKey('baby-1')], {
    naturalProteinCoefficient: '1.4',
    specialProteinCoefficient: '',
    calorieCoefficient: '120',
    preferredTargetMode: ''
  });
});
