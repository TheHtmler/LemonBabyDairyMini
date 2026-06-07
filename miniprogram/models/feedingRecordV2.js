const {
  normalizeFeedingRecordV2
} = require('../utils/feedingRecordV2Utils');
const {
  buildCreateAuditFields,
  buildUpdateAuditFields,
  resolveOperatorOpenid,
  stripProtectedAuditFields
} = require('../utils/auditFields');
const { recordHardDelete } = require('./auditLog');
const DailySummaryV2Model = require('./dailySummaryV2');

const db = wx.cloud.database();
const feedingRecordV2Collection = db.collection('feeding_records_v2');
const growthRecordsV2Collection = db.collection('growth_records_v2');
const legacyFeedingRecordCollection = db.collection('feeding_records');
const babyInfoCollection = db.collection('baby_info');

function serverDate() {
  return db.serverDate();
}

function createEmptyBasicInfoSnapshot(source = 'empty') {
  return {
    weight: '',
    height: '',
    naturalProteinCoefficient: '',
    specialProteinCoefficient: '',
    calorieCoefficient: '',
    source
  };
}

function normalizeBasicInfoSnapshot(input = {}, source = 'manual') {
  return {
    ...createEmptyBasicInfoSnapshot(source),
    ...input,
    source
  };
}

function hasBasicInfoValue(value) {
  return value !== '' && value !== null && value !== undefined;
}

const GROWTH_COEFFICIENT_FIELDS = [
  'naturalProteinCoefficient',
  'specialProteinCoefficient',
  'calorieCoefficient'
];

// 仅写入有值的系数，避免部分更新（例如只改体重）把已有系数清空。
function buildGrowthCoefficientFields(growthData = {}) {
  return GROWTH_COEFFICIENT_FIELDS.reduce((fields, key) => {
    if (hasBasicInfoValue(growthData[key])) {
      fields[key] = growthData[key];
    }
    return fields;
  }, {});
}

function mergeMissingBasicInfo(primary = {}, fallback = {}) {
  const merged = { ...primary };
  ['weight', 'height', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient'].forEach((key) => {
    if (!hasBasicInfoValue(merged[key]) && hasBasicInfoValue(fallback[key])) {
      merged[key] = fallback[key];
    }
  });
  return merged;
}

function isMissingCollectionError(error) {
  const message = String(error?.message || error?.errMsg || '');
  return error?.errCode === -502005
    || /collection.*(not exist|does not exist)|集合.*(不存在|未找到)/i.test(message);
}

function createMissingGrowthRecordsError(error) {
  const nextError = new Error('growth_records_v2 集合不存在，请先在云数据库中创建该集合');
  nextError.code = 'GROWTH_RECORDS_COLLECTION_MISSING';
  nextError.userMessage = '请先创建v2成长记录集合';
  nextError.cause = error;
  return nextError;
}

async function queryActiveV2Records(babyUid, date) {
  const res = await feedingRecordV2Collection
    .where({
      babyUid,
      date,
      status: 'active'
    })
    .orderBy('startTime', 'desc')
    .get();

  return (res.data || [])
    .filter((record) => record.recordType !== 'daily_basic_info')
    .map((record) => normalizeFeedingRecordV2(record))
    .filter(Boolean);
}

function normalizeGrowthRecordSnapshot(record = {}, source = 'v2_growth_record') {
  return normalizeBasicInfoSnapshot(
    {
      weight: record.weight || '',
      height: record.height || record.length || '',
      naturalProteinCoefficient: record.naturalProteinCoefficient || '',
      specialProteinCoefficient: record.specialProteinCoefficient || '',
      calorieCoefficient: record.calorieCoefficient || ''
    },
    source
  );
}

async function queryActiveGrowthRecord(babyUid, date) {
  let res;
  try {
    res = await growthRecordsV2Collection
      .where({
        babyUid,
        date,
        status: 'active'
      })
      .limit(1)
      .get();
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return null;
    }
    throw error;
  }

  return (res.data || [])[0] || null;
}

async function queryLatestPreviousGrowthRecord(babyUid, date) {
  let res;
  try {
    res = await growthRecordsV2Collection
      .where({
        babyUid,
        status: 'active',
        date: db.command.lt(date)
      })
      .orderBy('date', 'desc')
      .limit(1)
      .get();
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return null;
    }
    throw error;
  }

  return (res.data || [])[0] || null;
}

async function queryBabyInfoInitialSnapshot(babyUid) {
  const babyInfoRes = await babyInfoCollection
    .where({ babyUid })
    .limit(1)
    .get();
  const babyInfo = babyInfoRes.data && babyInfoRes.data[0];
  if (!babyInfo) {
    return null;
  }

  return normalizeBasicInfoSnapshot(
    {
      weight: babyInfo.weight || '',
      height: babyInfo.height || '',
      naturalProteinCoefficient: babyInfo.naturalProteinCoefficient || '',
      specialProteinCoefficient: babyInfo.specialProteinCoefficient || '',
      calorieCoefficient: babyInfo.calorieCoefficient || ''
    },
    'baby_info_initial'
  );
}

function latestByDate(records = [], date) {
  return records
    .filter((record) => record.date <= date)
    .filter((record) => record.basicInfo || record.basicInfoSnapshot)
    .sort((left, right) => {
      if (left.date === right.date) {
        const leftUpdated = left.updatedAt || left.createdAt || '';
        const rightUpdated = right.updatedAt || right.createdAt || '';
        return rightUpdated > leftUpdated ? 1 : -1;
      }
      return right.date > left.date ? 1 : -1;
    })[0];
}

// 把任意日期值（'YYYY-MM-DD' / ISO 字符串 / Date）归一成 'YYYY-MM-DD' 键。
function resolveDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 喂奶/体重也是当日营养来源，增删改后必须让 daily_summary_v2 缓存失效。
// 失效收口在模型写入层，调用方（页面/编辑器）无需再各自记得 markDirty，
// 后续新增功能只要复用本模型写入，就自动保持缓存一致，不会再“忘记刷新”。
async function markSummaryDirtySafe(babyUid, dateValue) {
  const dateKey = resolveDateKey(dateValue);
  if (!babyUid || !dateKey) return;
  try {
    await DailySummaryV2Model.markDirty(babyUid, dateKey);
  } catch (error) {
    console.error('标记当日汇总失效失败:', error);
  }
}

async function getFeedingRecordById(recordId) {
  if (!recordId) return null;
  try {
    const res = await feedingRecordV2Collection.doc(recordId).get();
    return res?.data || null;
  } catch (error) {
    return null;
  }
}

class FeedingRecordV2Model {
  async addRecord(data = {}) {
    const timestamp = serverDate();
    const operatorOpenid = resolveOperatorOpenid(data);
    const res = await feedingRecordV2Collection.add({
      data: {
        ...stripProtectedAuditFields(data),
        source: 'milk_feeding_v2',
        ...buildCreateAuditFields({
          timestamp,
          operatorOpenid,
          recordType: 'milk_feeding',
          schemaVersion: 1
        })
      }
    });
    await markSummaryDirtySafe(data.babyUid, data.date);
    return res;
  }

  async updateRecord(recordId, data = {}) {
    // 先读旧记录：若编辑改了归属日期，旧日期的汇总也要一起失效。
    const previous = await getFeedingRecordById(recordId);
    const operatorOpenid = resolveOperatorOpenid(data);
    const updateData = {
      ...stripProtectedAuditFields(data),
      ...buildUpdateAuditFields({
        timestamp: serverDate(),
        operatorOpenid
      })
    };

    await feedingRecordV2Collection.doc(recordId).update({
      data: updateData
    });

    const previousBabyUid = previous?.babyUid || data.babyUid;
    await markSummaryDirtySafe(previousBabyUid, previous?.date);
    if (data.date) {
      await markSummaryDirtySafe(data.babyUid || previousBabyUid, data.date);
    }
    return true;
  }

  async deleteRecord(recordId, options = {}) {
    // 删除前读出记录归属的宝宝与日期，删除后据此让对应当日汇总失效。
    const previous = await getFeedingRecordById(recordId);
    await feedingRecordV2Collection.doc(recordId).remove();
    await recordHardDelete({
      db,
      collectionName: 'feeding_records_v2',
      recordId,
      babyUid: options.babyUid || '',
      operatorOpenid: resolveOperatorOpenid(options)
    });
    await markSummaryDirtySafe(previous?.babyUid || options.babyUid, previous?.date);
    return true;
  }

  async upsertGrowthRecordForDate(babyUid, date, growthData = {}) {
    const existing = await queryActiveGrowthRecord(babyUid, date);
    const timestamp = serverDate();
    const operatorOpenid = resolveOperatorOpenid(growthData);
    const payload = {
      weight: growthData.weight || '',
      height: growthData.height || growthData.length || '',
      headCircumference: growthData.headCircumference || '',
      notes: growthData.notes || '',
      changes: growthData.changes || '',
      ...buildGrowthCoefficientFields(growthData)
    };

    if (existing?._id) {
      try {
        await growthRecordsV2Collection.doc(existing._id).update({
          data: {
            ...payload,
            ...buildUpdateAuditFields({
              timestamp,
              operatorOpenid
            })
          }
        });
      } catch (error) {
        if (isMissingCollectionError(error)) {
          throw createMissingGrowthRecordsError(error);
        }
        throw error;
      }
      await markSummaryDirtySafe(babyUid, date);
      return { recordId: existing._id };
    }

    let res;
    try {
      res = await growthRecordsV2Collection.add({
        data: {
          babyUid,
          date,
          ...payload,
          schemaVersion: 1,
          source: 'data_records_v2',
          ...buildCreateAuditFields({
            timestamp,
            operatorOpenid,
            recordType: 'growth_record',
            schemaVersion: 1
          })
        }
      });
    } catch (error) {
      if (isMissingCollectionError(error)) {
        throw createMissingGrowthRecordsError(error);
      }
      throw error;
    }
    await markSummaryDirtySafe(babyUid, date);
    return { recordId: res._id };
  }

  async getRecordsByDate(babyUid, date) {
    return queryActiveV2Records(babyUid, date);
  }

  async getRecentRecord(babyUid, date) {
    const res = await feedingRecordV2Collection
      .where({
        babyUid,
        status: 'active',
        date: db.command.lt(date)
      })
      .orderBy('date', 'desc')
      .orderBy('startTime', 'desc')
      .limit(1)
      .get();
    const record = res.data && res.data[0];
    return record ? normalizeFeedingRecordV2(record) : null;
  }

  // 最近一天（严格早于指定日期）有喂奶记录那天的喂奶顿数，
  // 用作“分顿建议”的默认计划顿数；没有历史则返回 0。
  async getRecentDayMealCount(babyUid, date) {
    const recent = await this.getRecentRecord(babyUid, date);
    if (!recent || !recent.date) return 0;
    const records = await this.getRecordsByDate(babyUid, recent.date);
    return Array.isArray(records) ? records.length : 0;
  }

  // 最近一天（严格早于指定日期）有喂奶记录那天的「全部喂奶记录」，
  // 用作首页“下一顿参考”：按今天已喂顿数对应到上次同序号那一顿。
  async getRecentDayRecords(babyUid, date) {
    const recent = await this.getRecentRecord(babyUid, date);
    if (!recent || !recent.date) return { date: '', records: [] };
    const records = await this.getRecordsByDate(babyUid, recent.date);
    return { date: recent.date, records: Array.isArray(records) ? records : [] };
  }

  async resolveBasicInfoSnapshot(babyUid, date, options = {}) {
    const includeFallbacks = options.includeFallbacks === true;
    const includeProfileInitial = options.includeProfileInitial === true;
    const carryForwardMissing = options.carryForwardMissing === true;
    const skipSameDay = options.skipSameDay === true;

    if (!skipSameDay) {
      const sameDayGrowthRecord = await queryActiveGrowthRecord(babyUid, date);
      if (sameDayGrowthRecord) {
        const snapshot = normalizeGrowthRecordSnapshot(sameDayGrowthRecord);
        if (!carryForwardMissing) {
          return snapshot;
        }
        const fallback = await this.resolveBasicInfoSnapshot(babyUid, date, {
          includeFallbacks,
          includeProfileInitial,
          skipSameDay: true
        });
        return mergeMissingBasicInfo(snapshot, fallback);
      }

      const sameDayV2 = await queryActiveV2Records(babyUid, date);
      const sameDaySnapshot = sameDayV2.find((record) => record.basicInfoSnapshot)?.basicInfoSnapshot;
      if (sameDaySnapshot) {
        const snapshot = normalizeBasicInfoSnapshot(sameDaySnapshot, 'v2_record');
        if (!carryForwardMissing) {
          return snapshot;
        }
        const fallback = await this.resolveBasicInfoSnapshot(babyUid, date, {
          includeFallbacks,
          includeProfileInitial,
          skipSameDay: true
        });
        return mergeMissingBasicInfo(snapshot, fallback);
      }
    }

    const previousGrowthRecord = await queryLatestPreviousGrowthRecord(babyUid, date);
    if (previousGrowthRecord) {
      return normalizeGrowthRecordSnapshot(previousGrowthRecord);
    }

    const previousV2Res = await feedingRecordV2Collection
      .where({
        babyUid,
        status: 'active',
        date: db.command.lt(date)
      })
      .orderBy('date', 'desc')
      .limit(1)
      .get();
    const previousV2 = (previousV2Res.data || []).find((record) => record.basicInfoSnapshot);
    if (previousV2?.basicInfoSnapshot) {
      return normalizeBasicInfoSnapshot(previousV2.basicInfoSnapshot, 'v2_record');
    }

    if (includeProfileInitial) {
      const babyInfoSnapshot = await queryBabyInfoInitialSnapshot(babyUid);
      if (babyInfoSnapshot) {
        return babyInfoSnapshot;
      }
    }

    if (!includeFallbacks) {
      return createEmptyBasicInfoSnapshot('empty');
    }

    const legacyRes = await legacyFeedingRecordCollection
      .where({ babyUid })
      .get();
    const legacyRecord = latestByDate(legacyRes.data || [], date);
    if (legacyRecord?.basicInfo) {
      return normalizeBasicInfoSnapshot(legacyRecord.basicInfo, 'legacy_record');
    }

    const babyInfoSnapshot = await queryBabyInfoInitialSnapshot(babyUid);
    if (babyInfoSnapshot) {
      return normalizeBasicInfoSnapshot(babyInfoSnapshot, 'baby_info');
    }

    return createEmptyBasicInfoSnapshot('empty');
  }
}

module.exports = new FeedingRecordV2Model();
