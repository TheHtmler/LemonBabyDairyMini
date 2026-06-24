const test = require('node:test');
const assert = require('node:assert/strict');

function loadDailySummaryModel(options = {}) {
  const modelPath = require.resolve('../miniprogram/models/dailySummaryV2.js');
  const utilsPath = require.resolve('../miniprogram/utils/dailySummaryV2Utils.js');
  delete require.cache[modelPath];
  delete require.cache[utilsPath];

  const previousWx = global.wx;
  const calls = {
    gets: 0,
    queryUpdates: [],
    docUpdates: []
  };

  const db = {
    serverDate: () => '__server_date__',
    collection: () => ({
      where(query) {
        return {
          async get() {
            calls.gets += 1;
            return { data: options.existing ? [options.existing] : [] };
          },
          async update({ data }) {
            calls.queryUpdates.push({ query, data });
            return { stats: { updated: options.updatedCount ?? 1 } };
          },
          orderBy() {
            return this;
          },
          limit() {
            return this;
          }
        };
      },
      doc(id) {
        return {
          async update({ data }) {
            calls.docUpdates.push({ id, data });
            return { stats: { updated: 1 } };
          }
        };
      }
    })
  };

  global.wx = {
    cloud: {
      database: () => db
    }
  };

  return {
    model: require(modelPath),
    calls,
    restore() {
      global.wx = previousWx;
      delete require.cache[modelPath];
      delete require.cache[utilsPath];
    }
  };
}

test('markDirty uses query update without preliminary getByDate read', async () => {
  const { model, calls, restore } = loadDailySummaryModel();
  try {
    const result = await model.markDirty('baby-1', '2026-06-23');
    assert.equal(result, true);
    assert.equal(calls.gets, 0);
    assert.deepEqual(calls.queryUpdates[0].query, {
      babyUid: 'baby-1',
      date: '2026-06-23',
      status: 'active'
    });
    assert.equal(calls.queryUpdates[0].data.isDirty, true);
    assert.equal(typeof calls.queryUpdates[0].data.rev, 'number');
    assert.equal(calls.queryUpdates[0].data.updatedAt, '__server_date__');
    assert.deepEqual(calls.docUpdates, []);
  } finally {
    restore();
  }
});

test('markDirty returns false when no daily summary document is updated', async () => {
  const { model, calls, restore } = loadDailySummaryModel({ updatedCount: 0 });
  try {
    const result = await model.markDirty('baby-1', '2026-06-23');
    assert.equal(result, false);
    assert.equal(calls.gets, 0);
    assert.equal(calls.queryUpdates.length, 1);
  } finally {
    restore();
  }
});
