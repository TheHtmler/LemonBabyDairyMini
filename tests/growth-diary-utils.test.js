const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_DIARY_PHOTOS,
  MAX_AUTHOR_ROLE_LEN,
  DIARY_ROLE_PRESETS,
  validateDiaryPayload,
  canEditDiaryEntry,
  mapMilestoneToDiary,
  validateAuthorDisplayName,
  formatDiaryPublishMeta,
  hasAuthorDisplayName
} = require('../miniprogram/utils/growthDiaryUtils');

test('MAX_DIARY_PHOTOS is 3', () => {
  assert.equal(MAX_DIARY_PHOTOS, 3);
});

test('validateDiaryPayload rejects empty title', () => {
  const r = validateDiaryPayload({ title: '  ', eventDate: '2026-01-01', photos: [] });
  assert.equal(r.isValid, false);
});

test('validateDiaryPayload rejects more than 3 photos', () => {
  const photos = [1, 2, 3, 4].map((i) => ({
    originalFileId: `cloud://o${i}`,
    thumbFileId: `cloud://t${i}`
  }));
  const r = validateDiaryPayload({ title: '会坐', eventDate: '2026-01-01', photos });
  assert.equal(r.isValid, false);
});

test('canEditDiaryEntry allows author', () => {
  assert.equal(canEditDiaryEntry({ createdByOpenid: 'a' }, { openid: 'a', isCreator: false }), true);
});

test('canEditDiaryEntry denies non-author', () => {
  assert.equal(canEditDiaryEntry({ createdByOpenid: 'a' }, { openid: 'b', isCreator: true }), false);
});

test('canEditDiaryEntry allows creator for legacy without author', () => {
  assert.equal(
    canEditDiaryEntry({ legacy: true, createdByOpenid: '' }, { openid: 'c', isCreator: true }),
    true
  );
  assert.equal(
    canEditDiaryEntry({ legacy: true, createdByOpenid: '' }, { openid: 'c', isCreator: false }),
    false
  );
});

test('mapMilestoneToDiary fills photos empty and migratedFromId', () => {
  const out = mapMilestoneToDiary({
    _id: 'old1',
    babyUid: 'b1',
    title: '满月',
    notes: 'n',
    eventDate: '2026-01-01T00:00:00.000Z',
    userInfo: { openid: 'o1', nickName: '爸' },
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  });
  assert.equal(out.migratedFromId, 'old1');
  assert.deepEqual(out.photos, []);
  assert.equal(out.createdByOpenid, 'o1');
  assert.equal(out.legacy, false);
  assert.equal(out.status, 'active');
  assert.equal(out.title, '满月');
  assert.equal(out.authorDisplayName, '');
});

test('mapMilestoneToDiary marks legacy when no openid', () => {
  const out = mapMilestoneToDiary({
    _id: 'old2',
    babyUid: 'b1',
    title: 'x',
    eventDate: '2026-01-01',
    userInfo: {}
  });
  assert.equal(out.legacy, true);
  assert.equal(out.createdByOpenid, '');
});

test('validateAuthorDisplayName enforces max 5 chars and required', () => {
  assert.equal(MAX_AUTHOR_ROLE_LEN, 5);
  assert.ok(DIARY_ROLE_PRESETS.includes('妈妈'));
  assert.equal(validateAuthorDisplayName('').isValid, false);
  assert.equal(validateAuthorDisplayName('外婆').isValid, true);
  assert.equal(validateAuthorDisplayName('外婆').normalized, '外婆');
  assert.equal(validateAuthorDisplayName('一二三四五六').isValid, false);
  assert.equal(hasAuthorDisplayName('爸爸'), true);
  assert.equal(hasAuthorDisplayName('  '), false);
});

test('formatDiaryPublishMeta shows role and datetime', () => {
  const text = formatDiaryPublishMeta({
    authorDisplayName: '妈妈',
    createdAt: '2026-07-14T08:05:00.000Z'
  });
  assert.match(text, /^【妈妈】发布于/);
  assert.match(text, /\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}$/);
});
