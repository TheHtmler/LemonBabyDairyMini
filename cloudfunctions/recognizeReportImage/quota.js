const DEFAULT_LIMITS = require('./quotaConfig');

const COLLECTION = 'ocr_usage_daily';
const CONFIG_KEY = 'report_ocr_quota';

const QUOTA_MESSAGES = {
  GLOBAL_QUOTA_EXCEEDED: '今日全站识别次数已用完，请明天再试或手动填写',
  BABY_DAILY_QUOTA_EXCEEDED: '该宝宝今日识别次数已达上限，请明天再试或手动填写',
  BABY_MONTHLY_QUOTA_EXCEEDED: '该宝宝本月识别次数已达上限，请下月再试或手动填写',
  BABY_QUOTA_EXCEEDED: '该宝宝今日识别次数已达上限，请明天再试或手动填写',
  USER_QUOTA_EXCEEDED: '您今日识别次数已达上限，请明天再试或手动填写',
  MISSING_BABY_UID: '未找到宝宝信息，无法使用拍照识别'
};

function getDateKey(now = new Date(), timezoneOffsetHours = 8) {
  const shifted = new Date(now.getTime() + timezoneOffsetHours * 3600000);
  return shifted.toISOString().slice(0, 10);
}

function getMonthKey(now = new Date(), timezoneOffsetHours = 8) {
  return getDateKey(now, timezoneOffsetHours).slice(0, 7);
}

function buildDocId(scope, refId, periodKey) {
  const safeRef = String(refId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${scope}_${safeRef}_${periodKey}`;
}

function readLimitValue(input, key, defaultValue) {
  if (input[key] === undefined) {
    return defaultValue;
  }
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : defaultValue;
}

function normalizeLimits(input = {}) {
  return {
    enabled: input.enabled === undefined ? DEFAULT_LIMITS.enabled : input.enabled !== false,
    globalDaily: readLimitValue(input, 'globalDaily', DEFAULT_LIMITS.globalDaily),
    perBabyUidDaily: readLimitValue(input, 'perBabyUidDaily', DEFAULT_LIMITS.perBabyUidDaily),
    perBabyUidMonthly: readLimitValue(input, 'perBabyUidMonthly', DEFAULT_LIMITS.perBabyUidMonthly),
    perOpenidDaily: readLimitValue(input, 'perOpenidDaily', DEFAULT_LIMITS.perOpenidDaily),
    timezoneOffsetHours: readLimitValue(input, 'timezoneOffsetHours', DEFAULT_LIMITS.timezoneOffsetHours)
  };
}

function buildQuotaChecks({ limits, babyUid, openid, dateKey, monthKey }) {
  const checks = [];

  if (limits.globalDaily > 0) {
    checks.push({
      scope: 'global',
      refId: 'global',
      periodKey: dateKey,
      limit: limits.globalDaily,
      code: 'GLOBAL_QUOTA_EXCEEDED'
    });
  }

  const needsBabyUid = (limits.perBabyUidDaily > 0) || (limits.perBabyUidMonthly > 0);
  if (needsBabyUid && !babyUid) {
    return {
      ok: false,
      code: 'MISSING_BABY_UID',
      message: QUOTA_MESSAGES.MISSING_BABY_UID
    };
  }

  if (limits.perBabyUidDaily > 0) {
    checks.push({
      scope: 'baby_daily',
      refId: babyUid,
      periodKey: dateKey,
      limit: limits.perBabyUidDaily,
      code: 'BABY_DAILY_QUOTA_EXCEEDED'
    });
  }

  if (limits.perBabyUidMonthly > 0) {
    checks.push({
      scope: 'baby_monthly',
      refId: babyUid,
      periodKey: monthKey,
      limit: limits.perBabyUidMonthly,
      code: 'BABY_MONTHLY_QUOTA_EXCEEDED'
    });
  }

  if (limits.perOpenidDaily > 0 && openid) {
    checks.push({
      scope: 'user_daily',
      refId: openid,
      periodKey: dateKey,
      limit: limits.perOpenidDaily,
      code: 'USER_QUOTA_EXCEEDED'
    });
  }

  return { ok: true, checks };
}

async function loadQuotaLimits(db) {
  const limits = normalizeLimits(DEFAULT_LIMITS);
  if (!db) return limits;

  try {
    const res = await db.collection('app_config').where({ key: CONFIG_KEY }).limit(1).get();
    const value = res.data?.[0]?.value;
    if (value && typeof value === 'object') {
      return normalizeLimits({ ...limits, ...value });
    }
  } catch (error) {
    console.warn('[recognizeReportImage] load quota config failed', error);
  }

  return limits;
}

function buildUsageQuery(meta = {}) {
  return {
    scope: meta.scope,
    refId: meta.refId,
    periodKey: meta.periodKey
  };
}

async function readUsageCount(collection, meta) {
  try {
    const res = await collection.where(buildUsageQuery(meta)).limit(1).get();
    return res.data?.[0]?.count || 0;
  } catch (error) {
    return 0;
  }
}

async function incrementUsageRecord({ collection, meta, command }) {
  const where = buildUsageQuery(meta);
  const updateResult = await collection.where(where).update({
    data: {
      count: command.inc(1),
      updatedAt: new Date()
    }
  });

  if ((updateResult?.stats?.updated || 0) > 0) {
    return;
  }

  await collection.add({
    data: {
      ...where,
      count: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });
}

async function decrementUsageRecord({ collection, meta, command }) {
  const count = await readUsageCount(collection, meta);
  if (count <= 0) {
    return;
  }

  await collection.where(buildUsageQuery(meta)).update({
    data: {
      count: command.inc(-1),
      updatedAt: new Date()
    }
  });
}

function buildQuotaFailure(check, dateKey, monthKey) {
  return {
    ok: false,
    code: check.code,
    message: QUOTA_MESSAGES[check.code] || QUOTA_MESSAGES.GLOBAL_QUOTA_EXCEEDED,
    scope: check.scope,
    dateKey,
    monthKey
  };
}

async function consumeOcrQuota({ db, babyUid = '', openid = '', now = new Date(), limitsOverride = null }) {
  const limits = limitsOverride ? normalizeLimits(limitsOverride) : await loadQuotaLimits(db);
  if (!limits.enabled) {
    return { ok: true, limits, skipped: true };
  }

  const dateKey = getDateKey(now, limits.timezoneOffsetHours);
  const monthKey = getMonthKey(now, limits.timezoneOffsetHours);
  const checkPlan = buildQuotaChecks({ limits, babyUid, openid, dateKey, monthKey });
  if (!checkPlan.ok) {
    return checkPlan;
  }

  const checks = checkPlan.checks || [];
  if (checks.length === 0) {
    return { ok: true, limits, dateKey, monthKey };
  }

  const transaction = await db.startTransaction();
  const collection = transaction.collection(COLLECTION);
  const command = db.command;

  try {
    for (const check of checks) {
      const count = await readUsageCount(collection, {
        scope: check.scope,
        refId: check.refId,
        periodKey: check.periodKey
      });
      if (count >= check.limit) {
        await transaction.rollback();
        return buildQuotaFailure(check, dateKey, monthKey);
      }
    }

    for (const check of checks) {
      await incrementUsageRecord({
        collection,
        command,
        meta: {
          scope: check.scope,
          refId: check.refId,
          periodKey: check.periodKey
        }
      });
    }

    await transaction.commit();
    const quota = await readQuotaSnapshot(db, {
      babyUid,
      openid,
      now,
      limits
    });
    return { ok: true, limits, dateKey, monthKey, quota };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function releaseOcrQuota({ db, babyUid = '', openid = '', now = new Date(), limitsOverride = null }) {
  const limits = limitsOverride ? normalizeLimits(limitsOverride) : await loadQuotaLimits(db);
  if (!limits.enabled) {
    return { ok: true, skipped: true };
  }

  const dateKey = getDateKey(now, limits.timezoneOffsetHours);
  const monthKey = getMonthKey(now, limits.timezoneOffsetHours);
  const checkPlan = buildQuotaChecks({ limits, babyUid, openid, dateKey, monthKey });
  if (!checkPlan.ok) {
    return checkPlan;
  }

  const checks = checkPlan.checks || [];
  if (checks.length === 0) {
    return { ok: true };
  }

  const collection = db.collection(COLLECTION);
  const command = db.command;

  for (const check of checks) {
    await decrementUsageRecord({
      collection,
      command,
      meta: {
        scope: check.scope,
        refId: check.refId,
        periodKey: check.periodKey
      }
    });
  }

  return { ok: true };
}

async function readQuotaSnapshot(db, { babyUid = '', openid = '', now = new Date(), limits = null } = {}) {
  const normalized = limits || await loadQuotaLimits(db);
  const dateKey = getDateKey(now, normalized.timezoneOffsetHours);
  const monthKey = getMonthKey(now, normalized.timezoneOffsetHours);
  const collection = db.collection(COLLECTION);

  const read = async (scope, refId, periodKey) => readUsageCount(collection, {
    scope,
    refId,
    periodKey
  });

  const store = {};
  const put = async (scope, refId, periodKey) => {
    const count = await read(scope, refId, periodKey);
    store[buildDocId(scope, refId, periodKey)] = { count };
  };

  await put('global', 'global', dateKey);
  if (babyUid) {
    await put('baby_daily', babyUid, dateKey);
    await put('baby_monthly', babyUid, monthKey);
  }
  if (openid) {
    await put('user_daily', openid, dateKey);
  }

  return getQuotaUsageSnapshot({
    store,
    limits: normalized,
    babyUid,
    openid,
    now
  });
}

function getQuotaUsageSnapshot({ store = {}, limits, babyUid = '', openid = '', now = new Date() }) {
  const normalized = normalizeLimits(limits);
  const dateKey = getDateKey(now, normalized.timezoneOffsetHours);
  const monthKey = getMonthKey(now, normalized.timezoneOffsetHours);

  const readCount = (scope, refId, periodKey) => {
    const docId = buildDocId(scope, refId, periodKey);
    return store[docId]?.count || 0;
  };

  const snapshot = {
    dateKey,
    monthKey,
    globalDaily: {
      used: readCount('global', 'global', dateKey),
      limit: normalized.globalDaily
    },
    babyDaily: {
      used: babyUid ? readCount('baby_daily', babyUid, dateKey) : 0,
      limit: normalized.perBabyUidDaily
    },
    babyMonthly: {
      used: babyUid ? readCount('baby_monthly', babyUid, monthKey) : 0,
      limit: normalized.perBabyUidMonthly
    },
    userDaily: {
      used: openid ? readCount('user_daily', openid, dateKey) : 0,
      limit: normalized.perOpenidDaily
    }
  };

  snapshot.remaining = {
    globalDaily: normalized.globalDaily > 0
      ? Math.max(normalized.globalDaily - snapshot.globalDaily.used, 0)
      : null,
    babyDaily: normalized.perBabyUidDaily > 0
      ? Math.max(normalized.perBabyUidDaily - snapshot.babyDaily.used, 0)
      : null,
    babyMonthly: normalized.perBabyUidMonthly > 0
      ? Math.max(normalized.perBabyUidMonthly - snapshot.babyMonthly.used, 0)
      : null,
    userDaily: normalized.perOpenidDaily > 0
      ? Math.max(normalized.perOpenidDaily - snapshot.userDaily.used, 0)
      : null
  };

  return snapshot;
}

module.exports = {
  COLLECTION,
  CONFIG_KEY,
  QUOTA_MESSAGES,
  getDateKey,
  getMonthKey,
  buildDocId,
  normalizeLimits,
  buildQuotaChecks,
  loadQuotaLimits,
  consumeOcrQuota,
  releaseOcrQuota,
  readQuotaSnapshot,
  getQuotaUsageSnapshot
};
