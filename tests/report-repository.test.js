const test = require('node:test');
const assert = require('node:assert/strict');

const ReportRepository = require('../miniprogram/models/reportRepository');

test('buildV2ReportDocument creates schema-versioned report summary for archive and trend usage', () => {
  const doc = ReportRepository.buildV2ReportDocument({
    babyUid: 'baby-1',
    reportDate: new Date('2026-12-20T00:00:00+08:00'),
    reportType: 'urine_ms',
    indicators: {
      methylmalonic_acid: { value: '356', status: 'high', minRange: '0', maxRange: '200' },
      methylcitric_acid: { value: '22.4', status: 'high', minRange: '0', maxRange: '10' },
      hydroxypropionic_acid: { value: '6.2', status: 'normal', minRange: '0', maxRange: '10' },
      hydroxybutyric_acid: { value: '2.8', status: 'normal', minRange: '0', maxRange: '10' },
      lactate: { value: '1.4', status: 'normal', minRange: '0', maxRange: '2' }
    }
  });

  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.reportTypeLabel, '尿串联质谱');
  assert.equal(doc.summary.abnormalCount, 2);
  assert.equal(doc.summary.filledCount, 5);
  assert.equal(doc.archive.abnormalCount, 2);
  assert.match(doc.archive.keySummary, /甲基丙二酸/);
  assert.deepEqual(doc.trend.metricKeys, [
    'methylmalonic_acid',
    'methylcitric_acid_1',
    'methylcitric_acid_2',
    'hydroxypropionic_acid',
    'hydroxybutyric_acid',
    'lactate'
  ]);
});

test('normalizeReportRecord backfills legacy reports with source collection and derived summary', () => {
  const normalized = ReportRepository.normalizeReportRecord({
    _id: 'legacy-1',
    reportType: 'blood_ms',
    reportDate: new Date('2026-11-20T00:00:00+08:00'),
    indicators: {
      iso_leu: { value: '42', status: 'normal' },
      met: { value: '18', status: 'low' },
      c3: { value: '8.1', status: 'high' }
    }
  }, ReportRepository.COLLECTIONS.LEGACY);

  assert.equal(normalized.sourceCollection, ReportRepository.COLLECTIONS.LEGACY);
  assert.equal(normalized.summary.abnormalCount, 2);
  assert.equal(normalized.summary.filledCount, 3);
  assert.match(normalized.archive.keySummary, /异亮氨酸\/亮氨酸|蛋氨酸\/甲硫氨酸|丙酰基肉碱/);
});

test('normalizeReportRecord maps legacy urine methylcitric_acid into methylcitric_acid_1', () => {
  const normalized = ReportRepository.normalizeReportRecord({
    _id: 'legacy-urine-1',
    reportType: 'urine_ms',
    reportDate: new Date('2026-11-20T00:00:00+08:00'),
    indicators: {
      methylmalonic_acid: { value: '110', status: 'high' },
      methylcitric_acid: { value: '8', status: 'high' }
    }
  }, ReportRepository.COLLECTIONS.LEGACY);

  assert.equal(normalized.indicators.methylcitric_acid_1.value, '8');
  assert.equal(normalized.indicators.methylcitric_acid, undefined);
});

test('saveReport falls back to legacy collection when primary collection is unavailable on add', async () => {
  const calls = [];
  const previousWx = global.wx;

  global.wx = {
    cloud: {
      database() {
        return {
          collection(name) {
            return {
              add: async ({ data }) => {
                calls.push({ name, data });
                if (name === ReportRepository.COLLECTIONS.PRIMARY) {
                  const error = new Error('collection baby_reports_v2 does not exist');
                  error.errMsg = 'collection baby_reports_v2 does not exist';
                  throw error;
                }
                return { _id: 'legacy-new-id' };
              }
            };
          }
        };
      }
    }
  };

  await ReportRepository.saveReport({
    mode: 'add',
    babyUid: 'baby-1',
    reportDate: new Date('2026-12-20T00:00:00+08:00'),
    reportType: 'urine_ms',
    indicators: {
      methylmalonic_acid: { value: '356', status: 'high' }
    }
  });

  assert.equal(calls[0].name, ReportRepository.COLLECTIONS.PRIMARY);
  assert.equal(calls[1].name, ReportRepository.COLLECTIONS.LEGACY);
  assert.equal(calls[1].data.reportType, 'urine_ms');
  assert.equal(calls[1].data.schemaVersion, undefined);

  global.wx = previousWx;
});
