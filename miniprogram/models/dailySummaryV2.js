const {
  buildDailySummaryV2,
  normalizeDailySummaryV2
} = require('../utils/dailySummaryV2Utils');

const db = wx.cloud.database();
const dailySummaryCollection = db.collection('daily_summary_v2');

function serverDate() {
  return db.serverDate();
}

function stripDocumentFields(data = {}) {
  const nextData = { ...data };
  delete nextData._id;
  delete nextData.id;
  delete nextData.createdAt;
  return nextData;
}

async function getByDate(babyUid, date) {
  const res = await dailySummaryCollection
    .where({
      babyUid,
      date,
      status: 'active'
    })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function upsertSummary(summary = {}) {
  const normalized = normalizeDailySummaryV2(summary);
  const timestamp = serverDate();
  const existing = summary._id
    ? summary
    : await getByDate(normalized.babyUid, normalized.date);

  if (existing?._id) {
    await dailySummaryCollection.doc(existing._id).update({
      data: {
        ...stripDocumentFields(normalized),
        isDirty: false,
        rebuiltAt: timestamp,
        updatedAt: timestamp
      }
    });
    return {
      ...normalized,
      _id: existing._id,
      isDirty: false,
      rebuiltAt: timestamp,
      updatedAt: timestamp
    };
  }

  const res = await dailySummaryCollection.add({
    data: {
      ...stripDocumentFields(normalized),
      isDirty: false,
      rebuiltAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  });
  return {
    ...normalized,
    _id: res._id,
    isDirty: false,
    rebuiltAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function markDirty(babyUid, date) {
  const existing = await getByDate(babyUid, date);
  if (!existing?._id) {
    return false;
  }
  await dailySummaryCollection.doc(existing._id).update({
    data: {
      isDirty: true,
      updatedAt: serverDate()
    }
  });
  return true;
}

async function rebuildByDate(babyUid, date, sourceData = {}) {
  const summary = buildDailySummaryV2({
    babyUid,
    date,
    ...sourceData
  });
  return upsertSummary(summary);
}

async function getRange(babyUid, startDate, endDate) {
  const res = await dailySummaryCollection
    .where({
      babyUid,
      status: 'active'
    })
    .orderBy('date', 'asc')
    .get();

  return (res.data || [])
    .filter((summary) => summary.date >= startDate && summary.date <= endDate);
}

module.exports = {
  getByDate,
  upsertSummary,
  markDirty,
  rebuildByDate,
  getRange
};
