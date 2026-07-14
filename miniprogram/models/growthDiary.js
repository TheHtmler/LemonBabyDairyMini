const {
  validateDiaryPayload,
  canEditDiaryEntry,
  normalizePhotos,
  sortDiaryEntriesByEventDateDesc
} = require('../utils/growthDiaryUtils');
const { deleteCloudFiles: defaultDeleteCloudFiles } = require('../utils/diaryImage');

function collectPhotoFileIds(photos = []) {
  const ids = [];
  for (const photo of normalizePhotos(photos)) {
    if (photo.originalFileId) ids.push(photo.originalFileId);
    if (photo.thumbFileId) ids.push(photo.thumbFileId);
  }
  return ids;
}

function findReplacedPhotoFileIds(oldPhotos = [], newPhotos = []) {
  const newIds = new Set(collectPhotoFileIds(newPhotos));
  return collectPhotoFileIds(oldPhotos).filter((id) => !newIds.has(id));
}

function resolveActorOpenid(actor = {}) {
  return String(actor.openid || actor.userInfo?.openid || '').trim();
}

class GrowthDiaryModel {
  constructor(options = {}) {
    this.db = wx.cloud.database();
    this.collection = this.db.collection('growth_diary');
    this.deleteCloudFiles = options.deleteCloudFiles || defaultDeleteCloudFiles;
  }

  async listByBaby(babyUid) {
    if (!babyUid) return [];

    try {
      const batchSize = 20;
      let skip = 0;
      let hasMore = true;
      let all = [];
      while (hasMore) {
        const batch = await this.collection
          .where({
            babyUid,
            status: 'active'
          })
          .orderBy('eventDate', 'desc')
          .skip(skip)
          .limit(batchSize)
          .get();
        const rows = batch?.data || [];
        all = all.concat(rows);
        hasMore = rows.length === batchSize;
        skip += batchSize;
      }
      return sortDiaryEntriesByEventDateDesc(all);
    } catch (error) {
      console.error('查询成长日记失败:', error);
      return [];
    }
  }

  async getById(id) {
    if (!id) return null;

    try {
      const res = await this.collection.doc(id).get();
      return res?.data || null;
    } catch (error) {
      console.error('查询成长日记详情失败:', error);
      return null;
    }
  }

  async create(babyUid, payload = {}, actor = {}) {
    const validation = validateDiaryPayload(payload);
    if (!validation.isValid) {
      return { success: false, message: validation.errors[0] || '数据无效' };
    }

    const openid = resolveActorOpenid(actor);
    if (!babyUid || !openid) {
      return { success: false, message: '缺少宝宝或用户信息' };
    }

    try {
      const authorDisplayName = String(
        validation.normalized.authorDisplayName
        || actor.authorDisplayName
        || actor.userInfo?.displayName
        || ''
      ).trim();
      const record = {
        babyUid,
        title: validation.normalized.title,
        notes: validation.normalized.notes,
        eventDate: validation.normalized.eventDate,
        photos: validation.normalized.photos,
        createdByOpenid: openid,
        authorDisplayName,
        userInfo: {
          ...(actor.userInfo || {}),
          displayName: authorDisplayName || (actor.userInfo && actor.userInfo.displayName) || ''
        },
        status: 'active',
        createdAt: this.db.serverDate(),
        updatedAt: this.db.serverDate()
      };
      const result = await this.collection.add({ data: record });
      return { success: true, data: { ...record, _id: result._id } };
    } catch (error) {
      console.error('创建成长日记失败:', error);
      return { success: false, message: error.message || '保存失败' };
    }
  }

  async update(id, babyUid, payload = {}, actor = {}) {
    if (!id || !babyUid) {
      return { success: false, message: '缺少记录信息' };
    }

    const entry = await this.getById(id);
    if (!entry || entry.babyUid !== babyUid) {
      return { success: false, message: '记录不存在' };
    }

    if (!canEditDiaryEntry(entry, actor)) {
      return { success: false, message: '无权编辑该日记' };
    }

    const validation = validateDiaryPayload(payload);
    if (!validation.isValid) {
      return { success: false, message: validation.errors[0] || '数据无效' };
    }

    const replacedFileIds = findReplacedPhotoFileIds(entry.photos, validation.normalized.photos);

    try {
      await this.collection.doc(id).update({
        data: {
          title: validation.normalized.title,
          notes: validation.normalized.notes,
          eventDate: validation.normalized.eventDate,
          photos: validation.normalized.photos,
          updatedAt: this.db.serverDate()
        }
      });

      if (replacedFileIds.length) {
        await this.deleteCloudFiles(replacedFileIds);
      }

      return { success: true };
    } catch (error) {
      console.error('更新成长日记失败:', error);
      return { success: false, message: error.message || '更新失败' };
    }
  }

  async softDelete(id, babyUid, actor = {}) {
    if (!id || !babyUid) {
      return { success: false, message: '缺少记录信息' };
    }

    const entry = await this.getById(id);
    if (!entry || entry.babyUid !== babyUid) {
      return { success: false, message: '记录不存在' };
    }

    if (!canEditDiaryEntry(entry, actor)) {
      return { success: false, message: '无权删除该日记' };
    }

    try {
      await this.collection.doc(id).update({
        data: {
          status: 'deleted',
          updatedAt: this.db.serverDate()
        }
      });

      await this.deleteCloudFiles(collectPhotoFileIds(entry.photos));
      return { success: true };
    } catch (error) {
      console.error('删除成长日记失败:', error);
      return { success: false, message: error.message || '删除失败' };
    }
  }
}

const growthDiaryModel = new GrowthDiaryModel();
growthDiaryModel.GrowthDiaryModel = GrowthDiaryModel;

module.exports = growthDiaryModel;
