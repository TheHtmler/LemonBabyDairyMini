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
    return res;
  }

  async updateRecord(recordId, data = {}) {
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
    return true;
  }

  async deleteRecord(recordId, options = {}) {
    await feedingRecordV2Collection.doc(recordId).remove();
    await recordHardDelete({
      db,
      collectionName: 'feeding_records_v2',
      recordId,
      babyUid: options.babyUid || '',
      operatorOpenid: resolveOperatorOpenid(options)
    });
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
