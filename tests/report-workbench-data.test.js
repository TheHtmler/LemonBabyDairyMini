const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReportArchivePreview,
  buildReportDetailPreview,
  buildReportTrendPreview,
  buildReportWorkbenchView
} = require('../miniprogram/utils/reportWorkbench');

test('buildReportWorkbenchView compares same-type reports and summarizes nutrition window from feeding records', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '120', status: 'high' },
        methylcitric_acid_1: { value: '9', status: 'high' },
        methylcitric_acid_2: { value: '4.5', status: 'high' },
        hydroxypropionic_acid: { value: '3.5', status: 'normal' },
        hydroxybutyric_acid: { value: '2.1', status: 'normal' },
        lactate: { value: '1.6', status: 'normal' }
      }
    },
    {
      _id: 'blood-other',
      reportType: 'blood_ms',
      reportDate: new Date('2026-11-15T00:00:00+08:00'),
      indicators: {
        c3: { value: '7.2', status: 'high' }
      }
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-12T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '100', status: 'high' },
        methylcitric_acid_1: { value: '8', status: 'high' },
        methylcitric_acid_2: { value: '4.1', status: 'high' },
        hydroxypropionic_acid: { value: '3.6', status: 'normal' },
        hydroxybutyric_acid: { value: '2.4', status: 'normal' },
        lactate: { value: '1.3', status: 'normal' }
      }
    },
    {
      _id: 'urine-older',
      reportType: 'urine_ms',
      reportDate: new Date('2026-10-01T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '88', status: 'high' },
        methylcitric_acid_1: { value: '7.1', status: 'high' },
        lactate: { value: '1.2', status: 'normal' }
      }
    }
  ];

  const feedingRecords = [
    {
      _id: 'f1',
      date: '2026-11-13',
      basicInfo: { weight: 5 },
      feedings: [],
      intakes: [
        {
          type: 'food',
          proteinSource: 'natural',
          nutrition: { calories: 100, protein: 2, carbs: 10, fat: 5 },
          naturalProtein: 2,
          specialProtein: 0
        }
      ]
    },
    {
      _id: 'f2',
      date: '2026-11-14',
      basicInfo: { weight: 5 },
      feedings: [],
      intakes: [
        {
          type: 'food',
          proteinSource: 'special',
          nutrition: { calories: 50, protein: 1, carbs: 5, fat: 2 },
          naturalProtein: 0,
          specialProtein: 1
        }
      ]
    },
    {
      _id: 'f3',
      date: '2026-11-15',
      basicInfo: { weight: 5 },
      feedings: [],
      intakes: [
        {
          type: 'food',
          proteinSource: 'natural',
          nutrition: { calories: 90, protein: 3, carbs: 6, fat: 4 },
          naturalProtein: 3,
          specialProtein: 0
        }
      ]
    }
  ];

  const view = buildReportWorkbenchView({
    selectedReportId: 'urine-current',
    reports,
    feedingRecords,
    nutritionSettings: {},
    fallbackWeight: 5
  });

  assert.equal(view.reportTypeLabel, '尿串联质谱');
  assert.equal(view.reportDate, '2026-11-16');
  assert.equal(view.compareDate, '2026-11-12');
  assert.equal(view.coverage, '3/3 天');
  assert.equal(view.coverageRate, '100%');
  assert.equal(view.compareCards[0].name, '甲基丙二酸');
  assert.equal(view.compareCards[0].current, '120');
  assert.equal(view.compareCards[0].previous, '100');
  assert.equal(view.compareCards[0].delta, '+20');
  assert.equal(view.compareCards[0].direction, 'up');
  assert.ok(view.compareCards.some((card) => card.key === 'lactate'));
  assert.ok(view.compareCards.some((card) => card.key === 'methylcitric_acid_1'));
  assert.ok(view.allIndicatorGroups.flatMap((group) => group.items.map((item) => item.abbr)).includes('Lac'));
  assert.ok(view.allIndicatorGroups.flatMap((group) => group.items.map((item) => item.abbr)).includes('MCA(1)'));
  assert.ok(view.allIndicatorGroups.flatMap((group) => group.items.map((item) => item.abbr)).includes('MCA(2)'));
  assert.deepEqual(
    view.trendMetrics[0].points.map((point) => point.date),
    ['10-01', '11-12', '11-16']
  );
  assert.equal(view.nutritionWindows[0].dateRange, '11-13 至 11-15');
  assert.equal(view.nutritionWindows[0].metrics[0].value, '0.33');
  assert.equal(view.nutritionWindows[0].metrics[1].value, '0.07');
  assert.equal(view.nutritionWindows[0].metrics[2].value, '16');
  assert.equal(view.nutritionWindows[0].metrics[3].value, '3.67');
  assert.equal(view.nutritionWindows[1].dateRange, '11-13 至 11-15');
  assert.match(view.doctorSummary[0], /甲基丙二酸上升/);
  assert.match(view.doctorSummary[1], /3\/3 天/);
});

test('buildReportWorkbenchView exposes all blood-ms indicators including amino acid markers', () => {
  const reports = [
    {
      _id: 'blood-current',
      reportType: 'blood_ms',
      reportDate: new Date('2026-12-20T00:00:00+08:00'),
      indicators: {
        iso_leu: { value: '42', status: 'normal' },
        met: { value: '18', status: 'low' },
        val: { value: '75', status: 'normal' },
        thr: { value: '66', status: 'normal' },
        c0: { value: '20', status: 'normal' },
        c2: { value: '22', status: 'normal' },
        c3: { value: '8.1', status: 'high' },
        c3_c0: { value: '0.41', status: 'high' },
        c3_c2: { value: '0.36', status: 'high' }
      }
    },
    {
      _id: 'blood-previous',
      reportType: 'blood_ms',
      reportDate: new Date('2026-11-20T00:00:00+08:00'),
      indicators: {
        iso_leu: { value: '38', status: 'normal' },
        met: { value: '20', status: 'normal' },
        val: { value: '70', status: 'normal' },
        thr: { value: '60', status: 'normal' },
        c0: { value: '21', status: 'normal' },
        c2: { value: '24', status: 'normal' },
        c3: { value: '7.2', status: 'high' },
        c3_c0: { value: '0.34', status: 'high' },
        c3_c2: { value: '0.30', status: 'high' }
      }
    }
  ];

  const view = buildReportWorkbenchView({
    selectedReportId: 'blood-current',
    reports,
    feedingRecords: [],
    nutritionSettings: {},
    fallbackWeight: 5
  });

  const labels = view.allIndicatorGroups.flatMap((group) => group.items.map((item) => item.name));

  assert.equal(view.workflowSteps, undefined);
  assert.ok(labels.includes('异亮氨酸/亮氨酸'));
  assert.ok(labels.includes('蛋氨酸/甲硫氨酸'));
  assert.ok(labels.includes('缬氨酸'));
  assert.ok(labels.includes('苏氨酸'));
  assert.ok(labels.includes('C3/C2'));
});

test('buildReportArchivePreview groups reports by type and exposes compare-ready list cards', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-12-20T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '120', status: 'high' },
        methylcitric_acid_1: { value: '9', status: 'high' },
        lactate: { value: '1.5', status: 'normal' }
      }
    },
    {
      _id: 'blood-current',
      reportType: 'blood_ms',
      reportDate: new Date('2026-12-18T00:00:00+08:00'),
      indicators: {
        c3: { value: '7.8', status: 'high' },
        iso_leu: { value: '40', status: 'normal' }
      }
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-20T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '110', status: 'high' },
        methylcitric_acid_1: { value: '8', status: 'high' },
        lactate: { value: '1.2', status: 'normal' }
      }
    }
  ];

  const archive = buildReportArchivePreview({
    reports,
    filterType: 'urine_ms'
  });

  assert.equal(archive.tabs[0].key, 'all');
  assert.equal(archive.tabs[0].count, 3);
  assert.equal(archive.tabs.find((tab) => tab.key === 'urine_ms').count, 2);
  assert.equal(archive.tabs.find((tab) => tab.key === 'blood_ms').count, 1);
  assert.equal(archive.reportCards.length, 2);
  assert.equal(archive.reportCards[0].reportId, 'urine-current');
  assert.equal(archive.reportCards[0].reportTypeLabel, '尿串联质谱');
  assert.equal(archive.reportCards[0].formattedDate, '2026-12-20');
  assert.equal(archive.reportCards[0].abnormalCount, 2);
  assert.match(archive.reportCards[0].keySummary, /甲基丙二酸/);
  assert.equal(archive.selectedCompareReportId, 'urine-current');
});

test('buildReportArchivePreview uses abbreviations for blood carnitine summary keys', () => {
  const reports = [
    {
      _id: 'blood-current',
      reportType: 'blood_ms',
      reportDate: new Date('2026-12-18T00:00:00+08:00'),
      indicators: {
        c3: { value: '7.8', status: 'high' },
        c2: { value: '22.3', status: 'normal' },
        c0: { value: '19.4', status: 'normal' }
      }
    }
  ];

  const archive = buildReportArchivePreview({
    reports,
    filterType: 'blood_ms'
  });

  assert.match(archive.reportCards[0].keySummary, /C3 7.8/);
  assert.doesNotMatch(archive.reportCards[0].keySummary, /丙酰基肉碱/);
});

test('buildReportDetailPreview builds grouped indicator detail for a selected report', () => {
  const reports = [
    {
      _id: 'blood-current',
      reportType: 'blood_ms',
      reportDate: new Date('2026-12-20T00:00:00+08:00'),
      indicators: {
        iso_leu: { value: '42.125', status: 'normal' },
        met: { value: '18', status: 'low' },
        val: { value: '75', status: 'normal' },
        thr: { value: '66', status: 'normal' },
        c0: { value: '20', status: 'normal' },
        c2: { value: '22', status: 'normal' },
        c3: { value: '8.1', status: 'high' },
        c3_c0: { value: '0.41', status: 'high' },
        c3_c2: { value: '0.36', status: 'high' }
      }
    }
  ];

  const detail = buildReportDetailPreview({
    selectedReportId: 'blood-current',
    reports
  });

  assert.equal(detail.reportId, 'blood-current');
  assert.equal(detail.reportTypeLabel, '血串联质谱');
  assert.equal(detail.summary.abnormalCount, 4);
  assert.equal(detail.indicatorGroups[0].title, '氨基酸相关指标');
  assert.ok(detail.indicatorGroups[0].items.some((item) => item.name === '蛋氨酸/甲硫氨酸'));
  assert.equal(detail.indicatorGroups[0].items.find((item) => item.key === 'iso_leu').current, '42.125');
  assert.equal(detail.indicatorGroups[1].items.find((item) => item.key === 'c0').name, 'C0');
  assert.equal(detail.indicatorGroups[1].items.find((item) => item.key === 'c2').name, 'C2');
  assert.equal(detail.indicatorGroups[1].items.find((item) => item.key === 'c3').name, 'C3');
});

test('buildReportTrendPreview links same-type trend data to previous report and feeding windows', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '120', status: 'high' },
        methylcitric_acid_1: { value: '9', status: 'high' },
        methylcitric_acid_2: { value: '4.5', status: 'high' },
        hydroxypropionic_acid: { value: '3.5', status: 'normal' },
        hydroxybutyric_acid: { value: '2.1', status: 'normal' },
        lactate: { value: '1.5', status: 'normal' }
      }
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-12T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '100', status: 'high' },
        methylcitric_acid_1: { value: '8', status: 'high' },
        methylcitric_acid_2: { value: '4.1', status: 'high' },
        hydroxypropionic_acid: { value: '3.6', status: 'normal' },
        hydroxybutyric_acid: { value: '2.4', status: 'normal' },
        lactate: { value: '1.1', status: 'normal' }
      }
    }
  ];

  const feedingRecords = [
    {
      _id: 'f1',
      date: '2026-11-13',
      basicInfo: { weight: 5 },
      feedings: [],
      intakes: [
        {
          type: 'food',
          proteinSource: 'natural',
          nutrition: { calories: 100, protein: 2, carbs: 10, fat: 5 },
          naturalProtein: 2,
          specialProtein: 0
        }
      ]
    }
  ];

  const trend = buildReportTrendPreview({
    reportType: 'urine_ms',
    selectedReportId: 'urine-current',
    reports,
    feedingRecords,
    nutritionSettings: {},
    fallbackWeight: 5
  });

  assert.equal(trend.reportTypeLabel, '尿串联质谱');
  assert.equal(trend.selectedReportId, 'urine-current');
  assert.equal(trend.previousReportId, 'urine-previous');
  assert.equal(trend.detailLinks.currentReportId, 'urine-current');
  assert.equal(trend.detailLinks.previousReportId, 'urine-previous');
  assert.ok(trend.compareCards.some((card) => card.key === 'lactate'));
  assert.ok(trend.compareCards.some((card) => card.key === 'methylcitric_acid_1'));
  assert.ok(trend.trendMetrics.some((metric) => metric.key === 'lactate'));
  assert.equal(trend.nutritionWindows[0].dateRange, '11-13 至 11-15');
});

test('buildReportTrendPreview uses explanatory overlay copy and explicit empty nutrition summaries when feeding records are missing', () => {
  const reports = [
    {
      _id: 'blood-current',
      reportType: 'blood_ms',
      reportDate: new Date('2026-12-20T00:00:00+08:00'),
      indicators: {
        c3: { value: '8.1', status: 'high' },
        c2: { value: '22', status: 'normal' },
        c0: { value: '20', status: 'normal' },
        c3_c2: { value: '0.36', status: 'high' }
      }
    },
    {
      _id: 'blood-previous',
      reportType: 'blood_ms',
      reportDate: new Date('2026-12-10T00:00:00+08:00'),
      indicators: {
        c3: { value: '7.2', status: 'high' },
        c2: { value: '24', status: 'normal' },
        c0: { value: '21', status: 'normal' },
        c3_c2: { value: '0.30', status: 'high' }
      }
    }
  ];

  const trend = buildReportTrendPreview({
    reportType: 'blood_ms',
    selectedReportId: 'blood-current',
    reports,
    feedingRecords: [],
    nutritionSettings: {},
    fallbackWeight: 5
  });

  assert.match(trend.trendMetrics[0].overlayLabel, /可结合查看/);
  assert.equal(trend.nutritionWindows[0].badge, '暂无喂养记录');
  assert.match(trend.nutritionWindows[0].note, /暂无喂养记录/);
  assert.equal(trend.nutritionWindows[1].badge, '暂无喂养记录');
  assert.match(trend.nutritionWindows[1].note, /暂无喂养记录/);
});
