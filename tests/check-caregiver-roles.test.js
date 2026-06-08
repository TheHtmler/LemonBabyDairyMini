const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  analyzeRelations,
  analyzeAllRelations
} = require('../scripts/check-caregiver-roles');

test('parseArgs reads openid and json options', () => {
  const options = parseArgs(['--openid', 'openid-1', '--json']);

  assert.equal(options.openid, 'openid-1');
  assert.equal(options.json, true);
});

test('parseArgs defaults to global scan when openid is omitted', () => {
  const options = parseArgs([]);

  assert.equal(options.openid, '');
  assert.equal(options.pageSize, 100);
});

test('analyzeRelations detects same-baby creator and participant duplicate', () => {
  const result = analyzeRelations({
    openid: 'openid-1',
    creators: [{ _id: 'creator-1', babyUid: 'baby-1', displayName: '妈妈' }],
    participants: [{ _id: 'participant-1', babyUid: 'baby-1', displayName: '妈妈' }],
    babyInfoMap: {
      'baby-1': { babyUid: 'baby-1', name: '柠檬宝宝' }
    }
  });

  assert.equal(result.summary.creatorCount, 1);
  assert.equal(result.summary.participantCount, 1);
  assert.deepEqual(result.summary.duplicateBabyUids, ['baby-1']);
  assert.equal(result.summary.crossBabyRelations, false);
  assert.match(result.recommendations[0], /保留创建者关系/);
});

test('analyzeRelations flags cross-baby relationship without duplicate', () => {
  const result = analyzeRelations({
    openid: 'openid-1',
    creators: [{ _id: 'creator-1', babyUid: 'baby-1' }],
    participants: [{ _id: 'participant-1', babyUid: 'baby-2' }],
    babyInfoMap: {
      'baby-1': { babyUid: 'baby-1', name: '宝宝A' },
      'baby-2': { babyUid: 'baby-2', name: '宝宝B' }
    }
  });

  assert.deepEqual(result.summary.duplicateBabyUids, []);
  assert.equal(result.summary.crossBabyRelations, true);
  assert.match(result.recommendations[0], /多个 babyUid/);
});

test('analyzeRelations reports no conflict for a single participant relation', () => {
  const result = analyzeRelations({
    openid: 'openid-1',
    creators: [],
    participants: [{ _id: 'participant-1', babyUid: 'baby-1' }],
    babyInfoMap: {
      'baby-1': { babyUid: 'baby-1', name: '柠檬宝宝' }
    }
  });

  assert.equal(result.summary.creatorCount, 0);
  assert.equal(result.summary.participantCount, 1);
  assert.equal(result.summary.crossBabyRelations, false);
  assert.deepEqual(result.summary.duplicateBabyUids, []);
  assert.deepEqual(result.recommendations, ['未发现创建者/参与者冲突。']);
});

test('analyzeAllRelations finds every openid with both creator and participant roles', () => {
  const result = analyzeAllRelations({
    creators: [
      { _id: 'creator-1', _openid: 'openid-a', babyUid: 'baby-1' },
      { _id: 'creator-2', _openid: 'openid-b', babyUid: 'baby-2' },
      { _id: 'creator-3', _openid: 'openid-creator-only', babyUid: 'baby-3' }
    ],
    participants: [
      { _id: 'participant-1', _openid: 'openid-a', babyUid: 'baby-1' },
      { _id: 'participant-2', _openid: 'openid-b', babyUid: 'baby-4' },
      { _id: 'participant-3', _openid: 'openid-participant-only', babyUid: 'baby-5' }
    ],
    babyInfoMap: {
      'baby-1': { babyUid: 'baby-1', name: '宝宝1' },
      'baby-2': { babyUid: 'baby-2', name: '宝宝2' },
      'baby-3': { babyUid: 'baby-3', name: '宝宝3' },
      'baby-4': { babyUid: 'baby-4', name: '宝宝4' },
      'baby-5': { babyUid: 'baby-5', name: '宝宝5' }
    }
  });

  assert.equal(result.summary.scannedCreatorCount, 3);
  assert.equal(result.summary.scannedParticipantCount, 3);
  assert.equal(result.summary.multiRoleOpenidCount, 2);
  assert.deepEqual(result.multiRoleOpenids.map((item) => item.openid), ['openid-a', 'openid-b']);
  assert.deepEqual(result.multiRoleOpenids[0].summary.duplicateBabyUids, ['baby-1']);
  assert.equal(result.multiRoleOpenids[1].summary.crossBabyRelations, true);
});
