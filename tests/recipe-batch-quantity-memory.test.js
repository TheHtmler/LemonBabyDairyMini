const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const memory = require(path.join(
  __dirname,
  '..',
  'miniprogram/pkg-records/utils/recipeBatchQuantityMemory.js'
));

function withMockStorage(run) {
  const store = new Map();
  const previousWx = global.wx;
  global.wx = {
    setStorageSync(key, value) {
      store.set(key, value);
    },
    getStorageSync(key) {
      return store.has(key) ? store.get(key) : '';
    }
  };
  try {
    return run(store);
  } finally {
    global.wx = previousWx;
  }
}

test('recipe batch quantity memory saves and reads by baby and recipe', () => {
  withMockStorage(() => {
    const saved = memory.saveLastBatchQuantities('baby-1', 'recipe-a', [
      { foodId: 'egg', quantity: 50, unit: 'g' },
      { foodId: 'tomato', quantity: 0, unit: 'g' },
      { foodId: '', quantity: 20, unit: 'g' }
    ]);
    assert.equal(saved, true);

    const loaded = memory.readLastBatchQuantities('baby-1', 'recipe-a');
    assert.deepEqual(loaded, [
      { foodId: 'egg', quantity: 50, unit: 'g' }
    ]);
    assert.deepEqual(memory.readLastBatchQuantities('baby-1', 'recipe-b'), []);
    assert.deepEqual(memory.readLastBatchQuantities('baby-2', 'recipe-a'), []);
  });
});

test('recipe batch quantity memory ignores empty payloads', () => {
  withMockStorage((store) => {
    assert.equal(
      memory.saveLastBatchQuantities('baby-1', 'recipe-a', [
        { foodId: 'egg', quantity: 0, unit: 'g' }
      ]),
      false
    );
    assert.equal(store.size, 0);
  });
});
