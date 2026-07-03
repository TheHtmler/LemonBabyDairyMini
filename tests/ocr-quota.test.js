const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const quotaPath = path.resolve(__dirname, '..', 'cloudfunctions', 'recognizeReportImage', 'quota.js');
const {
  getDateKey,
  getMonthKey,
  buildDocId,
  normalizeLimits,
  buildQuotaChecks,
  consumeOcrQuota,
  releaseOcrQuota,
  getQuotaUsageSnapshot
} = require(quotaPath);

function createUsageStore() {
  const records = [];

  function matches(record, query) {
    return Object.keys(query).every((key) => record[key] === query[key]);
  }

  function createCollection(target) {
    return {
      where(query) {
        return {
          limit(n) {
            return {
              async get() {
                return {
                  data: target.filter((record) => matches(record, query)).slice(0, n)
                };
              }
            };
          },
          async update({ data }) {
            const matched = target.filter((record) => matches(record, query));
            matched.forEach((record) => {
              if (typeof data.count === 'number') {
                record.count += data.count;
              }
            });
            return { stats: { updated: matched.length } };
          }
        };
      },
      async add({ data }) {
        target.push({ ...data });
        return { _id: `id_${target.length}` };
      }
    };
  }

  return { records, createCollection };
}

function createMockDatabase({ quotaConfig = null } = {}) {
  const usage = createUsageStore();
  const appConfig = quotaConfig ? [{ key: 'report_ocr_quota', value: quotaConfig }] : [];

  return {
    usage,
    db: {
      command: { inc: (value) => value },
      collection(name) {
        if (name === 'app_config') {
          return {
            where() {
              return {
                limit() {
                  return {
                    async get() {
                      return { data: appConfig };
                    }
                  };
                }
              };
            }
          };
        }
        if (name === 'ocr_usage_daily') {
          return usage.createCollection(usage.records);
        }
        throw new Error(`unknown collection ${name}`);
      },
      async startTransaction() {
        const txRecords = JSON.parse(JSON.stringify(usage.records));
        const txCollection = usage.createCollection(txRecords);
        return {
          collection(collectionName) {
            if (collectionName === 'ocr_usage_daily') {
              return txCollection;
            }
            throw new Error(`unknown tx collection ${collectionName}`);
          },
          async commit() {
            usage.records.splice(0, usage.records.length, ...txRecords);
          },
          async rollback() {}
        };
      }
    }
  };
}

test('getDateKey uses configured timezone offset', () => {
  const utcLateNight = new Date('2026-07-01T20:00:00.000Z');
  assert.equal(getDateKey(utcLateNight, 8), '2026-07-02');
});

test('getMonthKey follows the same timezone as date key', () => {
  const now = new Date('2026-07-15T10:00:00.000Z');
  assert.equal(getMonthKey(now, 8), '2026-07');
});

test('normalizeLimits uses baby daily and monthly defaults', () => {
  assert.deepEqual(normalizeLimits({}), {
    enabled: false,
    globalDaily: 0,
    perBabyUidDaily: 100,
    perBabyUidMonthly: 500,
    perOpenidDaily: 0,
    timezoneOffsetHours: 8
  });
});

test('buildQuotaChecks requires babyUid when baby quotas are enabled', () => {
  const result = buildQuotaChecks({
    limits: normalizeLimits({}),
    babyUid: '',
    openid: 'openid-1',
    dateKey: '2026-07-01',
    monthKey: '2026-07'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_BABY_UID');
});

test('buildQuotaChecks includes daily and monthly baby checks', () => {
  const result = buildQuotaChecks({
    limits: normalizeLimits({}),
    babyUid: 'baby-1',
    openid: 'openid-1',
    dateKey: '2026-07-01',
    monthKey: '2026-07'
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 2);
  assert.deepEqual(
    result.checks.map((item) => item.scope),
    ['baby_daily', 'baby_monthly']
  );
});

test('consumeOcrQuota creates usage records via add on first call', async () => {
  const { db, usage } = createMockDatabase();
  const limits = {
    enabled: true,
    globalDaily: 0,
    perBabyUidDaily: 1,
    perBabyUidMonthly: 0,
    perOpenidDaily: 0,
    timezoneOffsetHours: 8
  };

  const first = await consumeOcrQuota({
    db,
    babyUid: 'baby-1',
    openid: 'user-1',
    now: new Date('2026-07-01T10:00:00.000Z'),
    limitsOverride: limits
  });

  assert.equal(first.ok, true);
  assert.equal(usage.records.length, 1);
  assert.equal(usage.records[0].count, 1);
});

test('consumeOcrQuota allows up to perBabyUidDaily attempts per day', async () => {
  const { db } = createMockDatabase();
  const now = new Date('2026-07-01T10:00:00.000Z');
  const limits = {
    enabled: true,
    globalDaily: 0,
    perBabyUidDaily: 5,
    perBabyUidMonthly: 0,
    perOpenidDaily: 0,
    timezoneOffsetHours: 8
  };

  for (let index = 0; index < 5; index += 1) {
    const result = await consumeOcrQuota({
      db,
      babyUid: 'baby-1',
      openid: 'user-1',
      now,
      limitsOverride: limits
    });
    assert.equal(result.ok, true, `attempt ${index + 1} should pass`);
    assert.equal(result.quota.remaining.babyDaily, 5 - (index + 1));
  }

  const blocked = await consumeOcrQuota({
    db,
    babyUid: 'baby-1',
    openid: 'user-1',
    now,
    limitsOverride: limits
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BABY_DAILY_QUOTA_EXCEEDED');
});

test('releaseOcrQuota rolls back a consumed attempt', async () => {
  const { db } = createMockDatabase();
  const now = new Date('2026-07-01T10:00:00.000Z');
  const limits = {
    enabled: true,
    globalDaily: 0,
    perBabyUidDaily: 2,
    perBabyUidMonthly: 0,
    perOpenidDaily: 0,
    timezoneOffsetHours: 8
  };

  await consumeOcrQuota({
    db,
    babyUid: 'baby-1',
    openid: 'user-1',
    now,
    limitsOverride: limits
  });
  await releaseOcrQuota({
    db,
    babyUid: 'baby-1',
    openid: 'user-1',
    now,
    limitsOverride: limits
  });

  const again = await consumeOcrQuota({
    db,
    babyUid: 'baby-1',
    openid: 'user-1',
    now,
    limitsOverride: limits
  });
  assert.equal(again.ok, true);
  assert.equal(again.quota.remaining.babyDaily, 1);
});

test('consumeOcrQuota can be disabled via limits override', async () => {
  const { db, usage } = createMockDatabase();
  const result = await consumeOcrQuota({
    db,
    babyUid: 'baby-1',
    openid: 'user-1',
    limitsOverride: { enabled: false }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.deepEqual(usage.records, []);
});

test('getQuotaUsageSnapshot reports remaining counts', () => {
  const store = {
    [buildDocId('baby_daily', 'baby-1', '2026-07-01')]: { count: 2 },
    [buildDocId('baby_monthly', 'baby-1', '2026-07')]: { count: 7 }
  };

  const snapshot = getQuotaUsageSnapshot({
    store,
    limits: normalizeLimits({}),
    babyUid: 'baby-1',
    openid: 'user-1',
    now: new Date('2026-07-01T10:00:00.000Z')
  });

  assert.equal(snapshot.babyDaily.used, 2);
  assert.equal(snapshot.remaining.babyDaily, 98);
  assert.equal(snapshot.babyMonthly.used, 7);
  assert.equal(snapshot.remaining.babyMonthly, 493);
});
