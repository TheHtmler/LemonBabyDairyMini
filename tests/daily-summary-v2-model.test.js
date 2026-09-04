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
    pages: [],
    queryUpdates: [],
    docUpdates: []
  };

  const db = {
    serverDate: () => '__server_date__',
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
      lte(value) {
        return { __op: 'lte', value };
      }
    },
    collection: () => ({
      where(query) {
        return {
          _skip: 0,
          _limit: null,
          async get() {
            calls.gets += 1;
            calls.pages.push({ skip: this._skip, limit: this._limit, query });
            if (Array.isArray(options.rangeData)) {
              const start = this._skip || 0;
              const end = this._limit != null ? start + this._limit : undefined;
              return { data: options.rangeData.slice(start, end) };
            }
            return { data: options.existing ? [options.existing] : [] };
          },
          async update({ data }) {
            calls.queryUpdates.push({ query, data });
            return { stats: { updated: options.updatedCount ?? 1 } };
          },
          orderBy() {
            return this;
          },
          skip(value) {
            this._skip = Number(value) || 0;
            return this;
          },
          limit(value) {
            this._limit = Number(value) || 0;
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

test('getRange pages client reads by 20 so month-long windows are complete', async () => {
  const rangeData = Array.from({ length: 25 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return {
      _id: `summary-${day}`,
      babyUid: 'baby-1',
      date: `2026-05-${day}`,
      status: 'active'
    };
  });
  const { model, calls, restore } = loadDailySummaryModel({ rangeData });
  try {
    const summaries = await model.getRange('baby-1', '2026-05-01', '2026-05-25');
    assert.equal(summaries.length, 25);
    assert.equal(calls.gets, 2);
    assert.deepEqual(calls.pages.map(page => ({ skip: page.skip, limit: page.limit })), [
      { skip: 0, limit: 20 },
      { skip: 20, limit: 20 }
    ]);
    assert.equal(calls.pages[0].query.date.__op, 'and');
  } finally {
    restore();
  }
});

test('getRange stops when a page returns fewer than 20 records', async () => {
  const rangeData = Array.from({ length: 7 }, (_, index) => ({
    _id: `summary-${index}`,
    babyUid: 'baby-1',
    date: `2026-05-0${index + 1}`,
    status: 'active'
  }));
  const { model, calls, restore } = loadDailySummaryModel({ rangeData });
  try {
    const summaries = await model.getRange('baby-1', '2026-05-01', '2026-05-07');
    assert.equal(summaries.length, 7);
    assert.equal(calls.gets, 1);
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
