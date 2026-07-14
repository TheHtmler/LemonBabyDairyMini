const MAX_DIARY_PHOTOS = 3;

function normalizePhotos(photos = []) {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p) => ({
      originalFileId: String(p?.originalFileId || '').trim(),
      thumbFileId: String(p?.thumbFileId || '').trim(),
      width: p?.width == null ? null : Number(p.width),
      height: p?.height == null ? null : Number(p.height)
    }))
    .filter((p) => p.originalFileId && p.thumbFileId);
}

function validateDiaryPayload(payload = {}) {
  const errors = [];
  const title = String(payload.title || '').trim();
  if (!title) errors.push('请输入里程碑标题');
  const eventDate = payload.eventDate;
  if (!eventDate) errors.push('请选择发生日期');
  const photos = normalizePhotos(payload.photos);
  if ((payload.photos || []).length > MAX_DIARY_PHOTOS || photos.length > MAX_DIARY_PHOTOS) {
    errors.push(`最多上传 ${MAX_DIARY_PHOTOS} 张图片`);
  }
  return {
    isValid: errors.length === 0,
    errors,
    normalized: {
      title,
      notes: String(payload.notes || '').trim(),
      eventDate,
      photos
    }
  };
}

function canEditDiaryEntry(entry = {}, actor = {}) {
  const openid = String(actor.openid || '').trim();
  if (!openid) return false;
  const author = String(entry.createdByOpenid || '').trim();
  if (author && author === openid) return true;
  if (entry.legacy && !author && actor.isCreator) return true;
  return false;
}

function mapMilestoneToDiary(milestone = {}) {
  const openid = String(milestone.userInfo?.openid || milestone._openid || '').trim();
  return {
    babyUid: milestone.babyUid,
    eventDate: milestone.eventDate,
    title: String(milestone.title || '').trim(),
    notes: String(milestone.notes || '').trim(),
    photos: [],
    createdByOpenid: openid,
    userInfo: milestone.userInfo || {},
    migratedFromId: milestone._id || '',
    legacy: !openid,
    status: 'active',
    createdAt: milestone.createdAt || null,
    updatedAt: milestone.updatedAt || null
  };
}

function formatDiaryForDisplay(entry = {}) {
  return {
    ...entry,
    canEdit: false,
    eventDateText: '',
    thumbUrls: [],
    originalUrls: []
  };
}

module.exports = {
  MAX_DIARY_PHOTOS,
  normalizePhotos,
  validateDiaryPayload,
  canEditDiaryEntry,
  mapMilestoneToDiary,
  formatDiaryForDisplay
};
