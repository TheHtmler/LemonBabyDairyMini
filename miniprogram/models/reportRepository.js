const ReportModel = require('./report');

const COLLECTIONS = {
  PRIMARY: 'baby_reports_v2',
  LEGACY: 'baby_reports'
};

const ARCHIVE_KEY_INDICATORS = {
  [ReportModel.REPORT_TYPES.URINE_MS]: ['methylmalonic_acid', 'methylcitric_acid_1', 'hydroxypropionic_acid'],
  [ReportModel.REPORT_TYPES.BLOOD_MS]: ['c3', 'c3_c2', 'met'],
  [ReportModel.REPORT_TYPES.BLOOD_GAS]: ['ph', 'hco3', 'be'],
  [ReportModel.REPORT_TYPES.BLOOD_AMMONIA]: ['ammonia']
};

const TREND_METRIC_KEYS = {
  [ReportModel.REPORT_TYPES.URINE_MS]: ['methylmalonic_acid', 'methylcitric_acid_1', 'methylcitric_acid_2', 'hydroxypropionic_acid', 'hydroxybutyric_acid', 'lactate'],
  [ReportModel.REPORT_TYPES.BLOOD_MS]: ['c3', 'c3_c2', 'c3_c0', 'c0', 'iso_leu', 'met'],
  [ReportModel.REPORT_TYPES.BLOOD_GAS]: ['ph', 'hco3', 'be'],
  [ReportModel.REPORT_TYPES.BLOOD_AMMONIA]: ['ammonia']
};

function getDb() {
  return wx.cloud.database();
}

function isMissingCollectionError(error = {}) {
  const message = `${error?.errMsg || error?.message || ''}`.toLowerCase();
  return message.includes('collection') && (
    message.includes('not exist')
    || message.includes('does not exist')
    || message.includes('不存在')
  );
}

function getStableReportId(report = {}) {
  return report._id || report.id || report.reportId || '';
}

function normalizeIndicatorMap(reportType = '', indicators = {}) {
  const normalized = { ...(indicators || {}) };
  if (reportType === ReportModel.REPORT_TYPES.URINE_MS && normalized.methylcitric_acid && !normalized.methylcitric_acid_1) {
    normalized.methylcitric_acid_1 = normalized.methylcitric_acid;
    delete normalized.methylcitric_acid;
  }
  return normalized;
}

function hasIndicatorValue(indicator = {}) {
  return indicator && indicator.value !== '' && indicator.value !== undefined && indicator.value !== null;
}

function getFilledCount(indicators = {}) {
  return Object.values(indicators || {}).filter((indicator) => hasIndicatorValue(indicator)).length;
}

function getIndicatorConfigMap(reportType = '') {
  return ReportModel.getIndicators(reportType).reduce((map, config) => {
    map[config.key] = config;
    return map;
  }, {});
}

function buildKeySummary(reportType = '', indicators = {}) {
  const configMap = getIndicatorConfigMap(reportType);
  const preferredKeys = ARCHIVE_KEY_INDICATORS[reportType] || [];
  const entries = preferredKeys
    .map((key) => {
      const indicator = indicators[key];
      const config = configMap[key];
      if (!config || !hasIndicatorValue(indicator)) return null;
      return `${ReportModel.getIndicatorDisplayName(config)} ${indicator.value}`;
    })
    .filter(Boolean);

  return entries.join('，') || '待补充关键指标';
}

function buildSummary(reportType = '', indicators = {}) {
  const summary = ReportModel.getReportSummary({ reportType, indicators });
  return {
    ...summary,
    filledCount: getFilledCount(indicators)
  };
}

function buildArchiveFields(reportType = '', indicators = {}) {
  const summary = buildSummary(reportType, indicators);
  return {
    abnormalCount: summary.abnormalCount,
    statusText: summary.abnormalCount > 0 ? `${summary.abnormalCount} 项异常` : '本次无异常项',
    keySummary: buildKeySummary(reportType, indicators)
  };
}

function inferSourceCollection(record = {}, fallback = '') {
  if (fallback) return fallback;
  if (record.sourceCollection) return record.sourceCollection;
  return record.schemaVersion >= 2 ? COLLECTIONS.PRIMARY : COLLECTIONS.LEGACY;
}

function normalizeReportRecord(record = {}, sourceCollection = '') {
  const reportType = record.reportType || '';
  const indicators = normalizeIndicatorMap(reportType, record.indicators || {});
  const summary = {
    ...buildSummary(reportType, indicators),
    ...(record.summary || {})
  };
  const archive = {
    ...buildArchiveFields(reportType, indicators),
    ...(record.archive || {})
  };
  const trend = {
    metricKeys: Array.isArray(record.trend?.metricKeys) && record.trend.metricKeys.length
      ? record.trend.metricKeys
      : (TREND_METRIC_KEYS[reportType] || [])
  };

  return {
    ...record,
    reportType,
    reportTypeLabel: record.reportTypeLabel || ReportModel.getReportTypeName(reportType),
    indicators,
    summary,
    archive,
    trend,
    schemaVersion: record.schemaVersion || (inferSourceCollection(record, sourceCollection) === COLLECTIONS.PRIMARY ? 2 : 1),
    sourceCollection: inferSourceCollection(record, sourceCollection)
  };
}

function buildV2ReportDocument({
  babyUid,
  reportDate,
  reportType,
  indicators,
  reportId = '',
  createdAt = new Date(),
  updatedAt = new Date()
}) {
  const logicalReportId = reportId || ReportModel.generateReportId();
  const normalizedDate = reportDate instanceof Date ? reportDate : new Date(reportDate);
  const normalizedIndicators = normalizeIndicatorMap(reportType, indicators);
  const summary = buildSummary(reportType, normalizedIndicators);
  const archive = buildArchiveFields(reportType, normalizedIndicators);

  return {
    schemaVersion: 2,
    babyUid,
    reportId: logicalReportId,
    reportDate: normalizedDate,
    reportType,
    reportTypeLabel: ReportModel.getReportTypeName(reportType),
    indicators: normalizedIndicators,
    summary,
    archive,
    trend: {
      metricKeys: TREND_METRIC_KEYS[reportType] || []
    },
    createdAt,
    updatedAt
  };
}

function buildLegacyReportDocument({
  babyUid,
  reportDate,
  reportType,
  indicators,
  reportId = '',
  createdAt = new Date(),
  updatedAt = new Date()
}) {
  return {
    babyUid,
    reportId: reportId || ReportModel.generateReportId(),
    reportDate: reportDate instanceof Date ? reportDate : new Date(reportDate),
    reportType,
    indicators,
    createdAt,
    updatedAt
  };
}

function dedupeReports(reports = []) {
  const byKey = new Map();
  reports.forEach((report) => {
    const key = report.reportId || `${report.reportType}:${report.reportDate}:${getStableReportId(report)}`;
    const existing = byKey.get(key);
    if (!existing || report.sourceCollection === COLLECTIONS.PRIMARY) {
      byKey.set(key, report);
    }
  });

  return Array.from(byKey.values()).sort((a, b) => {
    const dateA = new Date(a.reportDate).getTime();
    const dateB = new Date(b.reportDate).getTime();
    return dateB - dateA;
  });
}

async function safeListFromCollection(db, collectionName, babyUid, limit = 100) {
  try {
    const result = await db.collection(collectionName)
      .where({ babyUid })
      .orderBy('reportDate', 'desc')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return (result.data || []).map((record) => normalizeReportRecord(record, collectionName));
  } catch (error) {
    if (collectionName === COLLECTIONS.PRIMARY) {
      return [];
    }
    throw error;
  }
}

async function listReportsByBaby(babyUid, { limit = 100 } = {}) {
  const db = getDb();
  const [primaryReports, legacyReports] = await Promise.all([
    safeListFromCollection(db, COLLECTIONS.PRIMARY, babyUid, limit),
    safeListFromCollection(db, COLLECTIONS.LEGACY, babyUid, limit)
  ]);

  return dedupeReports([...primaryReports, ...legacyReports]);
}

async function getReportById(reportId) {
  if (!reportId) return null;
  const db = getDb();

  try {
    const primary = await db.collection(COLLECTIONS.PRIMARY).doc(reportId).get();
    if (primary?.data) {
      return normalizeReportRecord(primary.data, COLLECTIONS.PRIMARY);
    }
  } catch (error) {
    // ignore and fallback to legacy
  }

  try {
    const legacy = await db.collection(COLLECTIONS.LEGACY).doc(reportId).get();
    if (legacy?.data) {
      return normalizeReportRecord(legacy.data, COLLECTIONS.LEGACY);
    }
  } catch (error) {
    return null;
  }

  return null;
}

async function getHistoricalRanges(babyUid, reportType) {
  if (!babyUid || !reportType) return {};

  const reports = await listReportsByBaby(babyUid, { limit: 50 });
  const latestReport = reports.find((report) => report.reportType === reportType);
  if (!latestReport?.indicators) return {};

  return Object.keys(latestReport.indicators).reduce((ranges, indicatorKey) => {
    const indicator = latestReport.indicators[indicatorKey];
    if (indicator?.minRange && indicator?.maxRange) {
      ranges[indicatorKey] = {
        minRange: indicator.minRange,
        maxRange: indicator.maxRange
      };
    }
    return ranges;
  }, {});
}

async function saveReport({ mode = 'add', reportId = '', babyUid, reportDate, reportType, indicators }) {
  const db = getDb();
  const normalizedDate = reportDate instanceof Date ? reportDate : new Date(reportDate);

  if (mode === 'edit' && reportId) {
    const existing = await getReportById(reportId);
    if (existing?.sourceCollection === COLLECTIONS.LEGACY) {
      const legacyPayload = buildLegacyReportDocument({
        babyUid,
        reportDate: normalizedDate,
        reportType,
        indicators,
        reportId: existing.reportId,
        createdAt: existing.createdAt || new Date()
      });

      return db.collection(COLLECTIONS.LEGACY).doc(reportId).update({
        data: {
          ...legacyPayload,
          updatedAt: db.serverDate()
        }
      });
    }

    const v2Payload = buildV2ReportDocument({
      babyUid,
      reportDate: normalizedDate,
      reportType,
      indicators,
      reportId: existing?.reportId,
      createdAt: existing?.createdAt || new Date()
    });

    return db.collection(COLLECTIONS.PRIMARY).doc(reportId).update({
      data: {
        ...v2Payload,
        updatedAt: db.serverDate()
      }
    });
  }

  const v2Payload = buildV2ReportDocument({
    babyUid,
    reportDate: normalizedDate,
    reportType,
    indicators
  });

  try {
    return await db.collection(COLLECTIONS.PRIMARY).add({
      data: v2Payload
    });
  } catch (error) {
    if (!isMissingCollectionError(error)) {
      throw error;
    }

    const legacyPayload = buildLegacyReportDocument({
      babyUid,
      reportDate: normalizedDate,
      reportType,
      indicators
    });

    return db.collection(COLLECTIONS.LEGACY).add({
      data: legacyPayload
    });
  }
}

async function deleteReport(reportId) {
  const existing = await getReportById(reportId);
  if (!existing) {
    throw new Error('report_not_found');
  }

  const db = getDb();
  return db.collection(existing.sourceCollection).doc(reportId).remove();
}

module.exports = {
  COLLECTIONS,
  buildV2ReportDocument,
  normalizeReportRecord,
  listReportsByBaby,
  getReportById,
  getHistoricalRanges,
  saveReport,
  deleteReport
};
