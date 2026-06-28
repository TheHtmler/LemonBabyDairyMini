const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  analyzeBabyInfoDuplicates
} = require('../scripts/check-babyinfo-duplicates');

test('parseArgs requires openid and reads json option', () => {
  const options = parseArgs(['--openid', 'openid-1', '--json']);

  assert.equal(options.openid, 'openid-1');
  assert.equal(options.json, true);
});

test('analyzeBabyInfoDuplicates marks baby with only summary records as suspicious empty profile', () => {
  const result = analyzeBabyInfoDuplicates({
    openid: 'openid-1',
    babyInfos: [
      { _id: 'info-main', _openid: 'openid-1', babyUid: 'baby-main', name: '柠檬宝宝' },
      { _id: 'info-empty', _openid: 'openid-1', babyUid: 'baby-empty', name: '误建宝宝' }
    ],
    creators: [
      { _id: 'creator-main', _openid: 'openid-1', babyUid: 'baby-main' },
      { _id: 'creator-empty', _openid: 'openid-1', babyUid: 'baby-empty' }
    ],
    participants: [],
    collectionCounts: {
      'baby-main': {
        feeding_records_v2: 3,
        food_intake_records: 2,
        daily_summary_v2: 4
      },
      'baby-empty': {
        daily_summary_v2: 7
      }
    }
  });

  assert.equal(result.summary.babyUidCount, 2);
  assert.equal(result.summary.suspiciousEmptyProfileCount, 1);
  assert.deepEqual(result.suspiciousEmptyBabyUids, ['baby-empty']);
  assert.equal(result.babies[0].babyUid, 'baby-main');
  assert.equal(result.babies[0].hasBusinessRecords, true);
  assert.equal(result.babies[1].babyUid, 'baby-empty');
  assert.equal(result.babies[1].onlyHasDailySummary, true);
  assert.match(result.recommendations[0], /优先保留有真实业务明细/);
});

test('analyzeBabyInfoDuplicates does not flag cross-baby business data as auto-cleanable', () => {
  const result = analyzeBabyInfoDuplicates({
    openid: 'openid-1',
    babyInfos: [
      { _id: 'info-1', _openid: 'openid-1', babyUid: 'baby-1' },
      { _id: 'info-2', _openid: 'openid-1', babyUid: 'baby-2' }
    ],
    creators: [],
    participants: [{ _id: 'participant-1', _openid: 'openid-1', babyUid: 'baby-2' }],
    collectionCounts: {
      'baby-1': { feeding_records: 1 },
      'baby-2': { medication_records: 1 }
    }
  });

  assert.deepEqual(result.suspiciousEmptyBabyUids, []);
  assert.equal(result.summary.babyUidCount, 2);
  assert.equal(result.summary.babyInfoCount, 2);
  assert.match(result.recommendations[0], /不要自动删除/);
});
