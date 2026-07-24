const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_DIARY_PHOTOS,
  MAX_DIARY_MEDIA,
  MAX_DIARY_VIDEOS,
  MAX_VIDEO_DURATION_SEC,
  MAX_VIDEO_BYTES,
  MAX_AUTHOR_ROLE_LEN,
  DIARY_ROLE_PRESETS,
  validateDiaryPayload,
  canEditDiaryEntry,
  mapMilestoneToDiary,
  validateAuthorDisplayName,
  formatDiaryPublishMeta,
  hasAuthorDisplayName,
  sortDiaryEntriesByEventDateDesc,
  toComparableDateMs,
  normalizeEventDateKey,
  formatDiaryEventAgeText,
  normalizeMedia,
  mediaToPhotos,
  collectMediaFileIds,
  listPreviewFileIds
} = require('../miniprogram/utils/growthDiaryUtils');

test('MAX_DIARY_PHOTOS is 3', () => {
  assert.equal(MAX_DIARY_PHOTOS, 3);
});

test('media caps match short-video design', () => {
  assert.equal(MAX_DIARY_MEDIA, 3);
  assert.equal(MAX_DIARY_VIDEOS, 1);
  assert.equal(MAX_VIDEO_DURATION_SEC, 15);
  assert.equal(MAX_VIDEO_BYTES, 10 * 1024 * 1024);
});

test('normalizeMedia maps legacy photos to image media', () => {
  const media = normalizeMedia(undefined, [
    { originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1', width: 100, height: 80 }
  ]);
  assert.equal(media.length, 1);
  assert.equal(media[0].type, 'image');
  assert.equal(media[0].originalFileId, 'cloud://o1');
  assert.equal(media[0].thumbFileId, 'cloud://t1');
});

test('normalizeMedia prefers media field and drops invalid items', () => {
  const media = normalizeMedia(
    [
      {
        type: 'video',
        videoFileId: 'cloud://v1',
        coverFileId: 'cloud://c1',
        durationSec: 12,
        sizeBytes: 1024
      },
      { type: 'image', originalFileId: 'cloud://o1', thumbFileId: '' },
      { type: 'image', originalFileId: 'cloud://o2', thumbFileId: 'cloud://t2' }
    ],
    []
  );
  assert.equal(media.length, 2);
  assert.equal(media[0].type, 'video');
  assert.equal(media[1].originalFileId, 'cloud://o2');
});

test('validateDiaryPayload rejects more than 3 media items', () => {
  const media = [1, 2, 3, 4].map((i) => ({
    type: 'image',
    originalFileId: `cloud://o${i}`,
    thumbFileId: `cloud://t${i}`
  }));
  const r = validateDiaryPayload({ title: '会坐', eventDate: '2026-01-01', media });
  assert.equal(r.isValid, false);
  assert.match(r.errors[0], /最多/);
});

test('validateDiaryPayload rejects more than one video', () => {
  const media = [
    { type: 'video', videoFileId: 'cloud://v1', coverFileId: 'cloud://c1' },
    { type: 'video', videoFileId: 'cloud://v2', coverFileId: 'cloud://c2' }
  ];
  const r = validateDiaryPayload({ title: '会坐', eventDate: '2026-01-01', media });
  assert.equal(r.isValid, false);
  assert.match(r.errors.join(','), /视频/);
});

test('validateDiaryPayload normalizes media and dual-write photos', () => {
  const r = validateDiaryPayload({
    title: '会坐',
    eventDate: '2026-01-01',
    media: [
      {
        type: 'video',
        videoFileId: 'cloud://v1',
        coverFileId: 'cloud://c1',
        durationSec: 10,
        sizeBytes: 2048
      },
      { type: 'image', originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1' }
    ]
  });
  assert.equal(r.isValid, true);
  assert.equal(r.normalized.media.length, 2);
  assert.deepEqual(r.normalized.photos, mediaToPhotos(r.normalized.media));
  assert.equal(r.normalized.photos.length, 1);
});

test('listPreviewFileIds only returns thumb and cover ids', () => {
  const ids = listPreviewFileIds([
    { type: 'image', originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1' },
    { type: 'video', videoFileId: 'cloud://v1', coverFileId: 'cloud://c1' }
  ]);
  assert.deepEqual(ids, ['cloud://t1', 'cloud://c1']);
});

test('collectMediaFileIds includes video and image files', () => {
  const ids = collectMediaFileIds([
    { type: 'image', originalFileId: 'cloud://o1', thumbFileId: 'cloud://t1' },
    { type: 'video', videoFileId: 'cloud://v1', coverFileId: 'cloud://c1' }
  ]);
  assert.deepEqual(ids.sort(), ['cloud://c1', 'cloud://o1', 'cloud://t1', 'cloud://v1'].sort());
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
  assert.equal(out.eventDate, '2026-01-01');
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

test('formatDiaryPublishMeta falls back to openid display map', () => {
  const text = formatDiaryPublishMeta(
    { createdByOpenid: 'o1', createdAt: '2026-07-14T08:05:00.000Z' },
    { displayNameByOpenid: { o1: '爸爸' } }
  );
  assert.match(text, /^【爸爸】发布于/);
});

test('sortDiaryEntriesByEventDateDesc sorts by eventDate new to old', () => {
  const sorted = sortDiaryEntriesByEventDateDesc([
    { _id: 'a', eventDate: '2025-10-04', title: '扶坐' },
    { _id: 'b', eventDate: '2026-01-03', title: '第一次自己坐' },
    { _id: 'c', eventDate: '2025-12-01', title: '中间' }
  ]);
  assert.deepEqual(sorted.map((item) => item._id), ['b', 'c', 'a']);
});

test('sortDiaryEntriesByEventDateDesc same day orders by createdAt', () => {
  const sorted = sortDiaryEntriesByEventDateDesc([
    {
      _id: 'earlier',
      eventDate: '2026-07-14',
      createdAt: '2026-07-14T08:00:00.000Z',
      title: '早发'
    },
    {
      _id: 'later',
      eventDate: '2026-07-14',
      createdAt: '2026-07-14T12:00:00.000Z',
      title: '晚发'
    },
    {
      _id: 'other-day',
      eventDate: '2026-07-13',
      createdAt: '2026-07-15T12:00:00.000Z',
      title: '昨天'
    }
  ]);
  assert.deepEqual(sorted.map((item) => item._id), ['later', 'earlier', 'other-day']);
});

test('normalizeEventDateKey keeps calendar day only', () => {
  assert.equal(normalizeEventDateKey('2026-07-14'), '2026-07-14');
  assert.equal(normalizeEventDateKey('2026-07-14T08:05:00.000Z'), '2026-07-14');
});

test('formatDiaryEventAgeText shows age at event day', () => {
  assert.equal(formatDiaryEventAgeText('2026-06-11', '2026-05-21'), '21天（约3周）');
  assert.equal(formatDiaryEventAgeText('2026-06-11', ''), '');
  assert.equal(formatDiaryEventAgeText('', '2026-05-21'), '');
});

test('toComparableDateMs reads $date objects', () => {
  assert.equal(
    toComparableDateMs({ $date: '2026-01-02T16:00:00Z' }),
    new Date('2026-01-02T16:00:00Z').getTime()
  );
});
