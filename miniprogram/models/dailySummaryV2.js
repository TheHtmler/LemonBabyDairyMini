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

function markHomeDashboardDirty(babyUid, date) {
  try {
    if (typeof getApp !== 'function') return;
    const app = getApp();
    if (!app || !app.globalData) return;
    app.globalData.homeDashboardDirty = {
      babyUid,
      date,
      markedAt: Date.now()
    };
  } catch (error) {
    // 测试环境或非页面上下文可能没有 getApp，忽略即可。
  }
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
  // rev：客户端可比对的版本戳（serverDate 是占位对象，无法用于读取端比对），
  // 供读取层判断当天数据自上次缓存以来是否变化（含多端写入）。
  const rev = Date.now();
  const existing = summary._id
    ? summary
    : await getByDate(normalized.babyUid, normalized.date);

  if (existing?._id) {
    await dailySummaryCollection.doc(existing._id).update({
      data: {
        ...stripDocumentFields(normalized),
        isDirty: false,
        rev,
        rebuiltAt: timestamp,
        updatedAt: timestamp
      }
    });
    return {
      ...normalized,
      _id: existing._id,
      isDirty: false,
      rev,
      rebuiltAt: timestamp,
      updatedAt: timestamp
    };
  }

  const res = await dailySummaryCollection.add({
    data: {
      ...stripDocumentFields(normalized),
      isDirty: false,
      rev,
      rebuiltAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  });
  return {
    ...normalized,
    _id: res._id,
    isDirty: false,
    rev,
    rebuiltAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function markDirty(babyUid, date) {
  markHomeDashboardDirty(babyUid, date);

  const query = dailySummaryCollection.where({
    babyUid,
    date,
    status: 'active'
  });

  const dirtyData = {
    isDirty: true,
    // 写操作发生即更新 rev，供读取层（含多端）感知"数据已变"。
    rev: Date.now(),
    updatedAt: serverDate()
  };

  if (typeof query.update === 'function') {
    const res = await query.update({ data: dirtyData });
    return (res?.stats?.updated || 0) > 0;
  }

  // 兼容测试 mock 或低版本 SDK：真实云开发环境会走上方 where().update() 一步写。
  const existing = await getByDate(babyUid, date);
  if (!existing?._id) {
    return false;
  }
  await dailySummaryCollection.doc(existing._id).update({ data: dirtyData });
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

const CLIENT_QUERY_PAGE_SIZE = 20;

function estimateDateRangeLimit(startDate, endDate) {
  const [sy, sm, sd] = String(startDate).split('-').map(Number);
  const [ey, em, ed] = String(endDate).split('-').map(Number);
  if ([sy, sm, sd, ey, em, ed].some(value => !Number.isFinite(value))) {
    return 20;
  }
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const days = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, Math.min(days, 366));
}

function isSameRecordId(left, right) {
  return !!(left && right && left._id && left._id === right._id);
}

async function getRange(babyUid, startDate, endDate) {
  const where = {
    babyUid,
    status: 'active'
  };
  if (db.command?.gte && db.command?.lte) {
    where.date = db.command.gte(startDate).and(db.command.lte(endDate));
  }

  const maxRecords = estimateDateRangeLimit(startDate, endDate);
  const maxPages = Math.ceil(maxRecords / CLIENT_QUERY_PAGE_SIZE) + 1;
  const all = [];
  let skip = 0;

  for (let page = 0; page < maxPages; page += 1) {
    let query = dailySummaryCollection
      .where(where)
      .orderBy('date', 'asc');

    if (typeof query.skip === 'function') {
      query = query.skip(skip);
    }
    if (typeof query.limit === 'function') {
      query = query.limit(CLIENT_QUERY_PAGE_SIZE);
    }

    const res = await query.get();
    const batch = res.data || [];
    if (batch.length === 0) {
      break;
    }
    if (all.length > 0 && isSameRecordId(all[0], batch[0])) {
      break;
    }

    all.push(...batch);
    if (batch.length < CLIENT_QUERY_PAGE_SIZE) {
      break;
    }
    if (typeof query.skip !== 'function') {
      break;
    }
    skip += batch.length;
  }

  const seen = new Set();
  return all.filter((summary) => {
    if (!summary || summary.date < startDate || summary.date > endDate) {
      return false;
    }
    const key = summary._id || summary.date;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

module.exports = {
  getByDate,
  upsertSummary,
  markDirty,
  rebuildByDate,
  getRange
};
