const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildReportArchivePreview,
  buildReportComparePreview,
  buildReportDetailPreview,
  buildReportTrendPreview,
  buildReportWorkbenchView,
  buildDailyCoefficientSeries,
  collectNutritionMetricsFromSummaries,
  resolveCompareFeedingDataRange,
  resolveCompareNutritionWindows,
  resolveCompareReportSelection,
  resolveWeekBeforeReport
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

test('buildReportWorkbenchView uses v2 feeding nutrition snapshot for the milk window instead of recomputing', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '120', status: 'high' }
      }
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-12T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '100', status: 'high' }
      }
    }
  ];

  const feedingRecords = [
    {
      _id: 'v2-day',
      date: '2026-11-14',
      basicInfo: { weight: 5 },
      intakes: [],
      feedings: [
        {
          isV2FeedingRecord: true,
          // naturalMilkVolume 故意为 0：若仍走旧重算，奶蛋白会算成 0；走 v2 快照则用下面的数值
          naturalMilkVolume: 0,
          specialMilkVolume: 0,
          nutritionDisplay: { calories: 80, naturalProtein: 5, specialProtein: 2, carbs: 0, fat: 0 },
          milkOverviewSnapshot: {
            normal: { volume: 60, calories: 40, protein: 5, carbs: 0, fat: 0 },
            special: { volume: 60, calories: 40, protein: 2, carbs: 0, fat: 0 },
            totalVolume: 120,
            totalCalories: 80
          }
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

  // 天然蛋白系数 = 5/5 = 1；特奶蛋白系数 = 2/5 = 0.4；热卡系数 = 80/5 = 16（数值去尾零）
  assert.equal(view.nutritionWindows[0].metrics[0].value, '1');
  assert.equal(view.nutritionWindows[0].metrics[1].value, '0.4');
  assert.equal(view.nutritionWindows[0].metrics[2].value, '16');
});

test('buildReportWorkbenchView uses daily summary metrics without raw feeding records', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '120', status: 'high' }
      }
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-12T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '100', status: 'high' }
      }
    }
  ];

  const view = buildReportWorkbenchView({
    selectedReportId: 'urine-current',
    reports,
    feedingRecords: [
      {
        _id: 'summary-day',
        date: '2026-11-14',
        basicInfo: { weight: 5 },
        source: 'daily_summary_v2',
        summaryMetrics: {
          calories: 100,
          protein: 7,
          naturalProtein: 5,
          specialProtein: 2,
          carbs: 10,
          fat: 4
        }
      }
    ],
    nutritionSettings: {},
    fallbackWeight: 5
  });

  assert.equal(view.nutritionWindows[0].metrics[0].value, '1');
  assert.equal(view.nutritionWindows[0].metrics[1].value, '0.4');
  assert.equal(view.nutritionWindows[0].metrics[2].value, '20');
  assert.equal(view.nutritionWindows[0].metrics[3].value, '4');
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
  assert.equal(archive.reportYearGroups.length, 1);
  assert.equal(archive.reportYearGroups[0].year, '2026');
  assert.equal(archive.reportYearGroups[0].reports.length, 2);
  assert.equal(archive.reportCards[0].reportId, 'urine-current');
  assert.equal(archive.reportCards[0].reportTypeLabel, '尿串联质谱');
  assert.equal(archive.reportCards[0].formattedDate, '2026-12-20');
  assert.equal(archive.reportCards[0].abnormalCount, 2);
  assert.match(archive.reportCards[0].keySummary, /甲基丙二酸/);
  assert.equal(archive.selectedCompareReportId, 'urine-current');
});

test('buildReportArchivePreview groups report cards by year within filtered type', () => {
  const reports = [
    {
      _id: 'urine-2026',
      reportType: 'urine_ms',
      reportDate: new Date('2026-12-20T00:00:00+08:00'),
      indicators: { methylmalonic_acid: { value: '120', status: 'high' } }
    },
    {
      _id: 'urine-2025',
      reportType: 'urine_ms',
      reportDate: new Date('2025-11-20T00:00:00+08:00'),
      indicators: { methylmalonic_acid: { value: '110', status: 'high' } }
    }
  ];

  const archive = buildReportArchivePreview({
    reports,
    filterType: 'urine_ms'
  });

  assert.equal(archive.reportYearGroups.length, 2);
  assert.equal(archive.reportYearGroups[0].year, '2026');
  assert.equal(archive.reportYearGroups[1].year, '2025');
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

test('buildDailyCoefficientSeries builds seven-day sparkline points for three nutrition coefficients', () => {
  const { startDate, endDate } = resolveWeekBeforeReport('2026-11-16');
  const dailyMetrics = [
    { date: '2026-11-09', naturalProteinCoefficient: 0.8, specialProteinCoefficient: 0.2, calorieCoefficient: 12 },
    { date: '2026-11-11', naturalProteinCoefficient: 1.2, specialProteinCoefficient: 0.4, calorieCoefficient: 18 },
    { date: '2026-11-14', naturalProteinCoefficient: 1.0, specialProteinCoefficient: 0.3, calorieCoefficient: 15 }
  ];

  const series = buildDailyCoefficientSeries(dailyMetrics, startDate, endDate);

  assert.equal(startDate, '2026-11-09');
  assert.equal(endDate, '2026-11-15');
  assert.equal(series.length, 3);
  assert.equal(series[0].key, 'naturalProteinCoefficient');
  assert.equal(series[0].points.length, 7);
  assert.equal(series[0].points[0].label, '9');
  assert.equal(series[0].points[0].missing, false);
  assert.equal(series[0].points[1].missing, true);
  assert.equal(series[0].points[2].value, '1.2');
  assert.equal(series[0].points[2].missing, false);
  assert.ok(series[0].points[2].heightRpx >= 12);
  assert.equal(series[2].unit, 'kcal/kg/d');
});

test('collectNutritionMetricsFromSummaries reads daily_summary_v2 macroSummary like the home trend', () => {
  const metrics = collectNutritionMetricsFromSummaries([
    {
      date: '2026-04-20',
      basicInfo: { weight: 5 },
      recordCounts: { milk: 8, food: 0 },
      macroSummary: {
        naturalProtein: 6,
        specialProtein: 2,
        protein: 8,
        calories: 600,
        carbs: 40,
        fat: 20
      }
    },
    {
      date: '2026-04-21',
      basicInfo: {},
      recordCounts: { milk: 7, food: 0 },
      macroSummary: {
        naturalProtein: 5.5,
        specialProtein: 1.8,
        protein: 7.3,
        calories: 580,
        carbs: 38,
        fat: 18
      }
    }
  ], '2026-04-18', '2026-04-24', 5);

  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].naturalProteinCoefficient, 1.2);
  assert.equal(metrics[1].naturalProteinCoefficient, 1.1);
  assert.equal(metrics[1].calorieCoefficient, 116);
});

test('buildReportComparePreview uses daily summaries for week-before nutrition trends', () => {
  const compare = buildReportComparePreview({
    reportType: 'blood_ms',
    reportAId: 'blood-a',
    reportBId: 'blood-b',
    selectedMetricKeys: ['c3'],
    reports: [
      {
        _id: 'blood-a',
        reportType: 'blood_ms',
        reportDate: new Date('2026-04-25T00:00:00+08:00'),
        indicators: { c3: { value: '8.000' } }
      },
      {
        _id: 'blood-b',
        reportType: 'blood_ms',
        reportDate: new Date('2026-03-20T00:00:00+08:00'),
        indicators: { c3: { value: '7.000' } }
      }
    ],
    dailySummaries: [
      {
        date: '2026-04-20',
        basicInfo: { weight: 5 },
        recordCounts: { milk: 8, food: 0 },
        macroSummary: { naturalProtein: 6, specialProtein: 2, protein: 8, calories: 600 }
      },
      {
        date: '2026-04-22',
        basicInfo: { weight: 5.1 },
        recordCounts: { milk: 8, food: 0 },
        macroSummary: { naturalProtein: 6.2, specialProtein: 2.1, protein: 8.3, calories: 610 }
      }
    ],
    feedingRecords: [],
    nutritionSettings: {},
    fallbackWeight: 5
  });

  assert.equal(compare.hasNutritionData, true);
  const naturalSeries = compare.nutritionCompareSeries.find((item) => item.key === 'naturalProteinCoefficient');
  const reportAPoints = naturalSeries.reportA.points.filter((point) => !point.missing);
  assert.equal(reportAPoints.length, 2);
  assert.equal(reportAPoints[0].value, '1.2');
  assert.equal(reportAPoints[1].value, '1.22');
  assert.equal(naturalSeries.reportA.averageText, '1.21');
  assert.equal(compare.summaryLines.length, 1);
  assert.equal(compare.dietSummaryLines.length, 3);
  assert.match(compare.dietSummaryLines[0], /天然蛋白系数/);
  assert.match(compare.dietSummaryLines[0], /→/);
});

test('buildReportComparePreview can skip nutrition trends for lazy loading', () => {
  const compare = buildReportComparePreview({
    reportType: 'blood_ms',
    reportAId: 'blood-a',
    reportBId: 'blood-b',
    selectedMetricKeys: ['c3'],
    reports: [
      {
        _id: 'blood-a',
        reportType: 'blood_ms',
        reportDate: new Date('2026-04-25T00:00:00+08:00'),
        indicators: { c3: { value: '8.000', status: 'high' } }
      },
      {
        _id: 'blood-b',
        reportType: 'blood_ms',
        reportDate: new Date('2026-03-20T00:00:00+08:00'),
        indicators: { c3: { value: '7.000', status: 'normal' } }
      }
    ],
    dailySummaries: [
      {
        date: '2026-04-20',
        basicInfo: { weight: 5 },
        recordCounts: { milk: 8, food: 0 },
        macroSummary: { naturalProtein: 6, specialProtein: 2, protein: 8, calories: 600 }
      }
    ],
    includeNutrition: false
  });

  assert.equal(compare.canCompare, true);
  assert.equal(compare.hasNutritionData, false);
  assert.equal(compare.nutritionCompareSeries.length, 0);
  assert.equal(compare.nutritionWindows.length, 0);
  assert.equal(compare.dietSummaryLines.length, 0);
  assert.equal(compare.summaryLines.length, 1);
  assert.equal(compare.compareRows[0].statusText, '偏高');
  assert.equal(compare.compareRows[0].previousStatusText, '正常');
  assert.equal(compare.compareRows[0].changeText, '下降 1');
});

test('buildReportComparePreview compares two same-type reports and attaches week-before coefficient series', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '120', status: 'high', minRange: '0', maxRange: '100' },
        methylcitric_acid_1: { value: '9', status: 'high' },
        lactate: { value: '1.5', status: 'normal' }
      }
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-12T00:00:00+08:00'),
      indicators: {
        methylmalonic_acid: { value: '100', status: 'high', minRange: '0', maxRange: '90' },
        methylcitric_acid_1: { value: '8', status: 'high' },
        lactate: { value: '1.1', status: 'normal' }
      }
    }
  ];

  const dailySummaries = [
    {
      date: '2026-11-13',
      basicInfo: { weight: 5 },
      recordCounts: { milk: 0, food: 1 },
      macroSummary: {
        calories: 100,
        protein: 2,
        naturalProtein: 2,
        specialProtein: 0,
        carbs: 10,
        fat: 5
      }
    }
  ];

  const compare = buildReportComparePreview({
    reportType: 'urine_ms',
    reportAId: 'urine-previous',
    reportBId: 'urine-current',
    reports,
    dailySummaries,
    nutritionSettings: {},
    fallbackWeight: 5
  });

  assert.equal(compare.canCompare, true);
  assert.equal(compare.reportA.id, 'urine-previous');
  assert.equal(compare.reportB.id, 'urine-current');
  assert.equal(compare.metricOptions.filter((item) => item.selected).length, 3);
  assert.equal(compare.compareRows.length, 3);
  assert.equal(compare.hasRangeMismatch, true);
  assert.match(compare.rangeMismatchText, /不同机构/);
  const mmaRow = compare.compareRows.find((row) => row.key === 'methylmalonic_acid');
  assert.equal(mmaRow.name, '甲基丙二酸');
  assert.equal(mmaRow.abbr, 'MMA');
  assert.equal(mmaRow.current, '100');
  assert.equal(mmaRow.previous, '120');
  assert.equal(mmaRow.changeText, '上升 20');
  assert.equal(mmaRow.rangeMismatch, true);
  assert.equal(mmaRow.statusText, '偏高');
  assert.equal(mmaRow.previousStatusText, '偏高');
  assert.equal(compare.nutritionCompareSeries.length, 3);
  assert.equal(compare.dietSummaryLines.length, 3);
  assert.match(compare.dietSummaryLines[0], /天然蛋白系数/);
  assert.match(compare.dietSummaryLines[1], /特殊蛋白系数/);
  assert.match(compare.dietSummaryLines[2], /热卡系数/);
  assert.equal(compare.nutritionCompareSeries[0].reportA.date, '2026-11-12');
  assert.equal(compare.nutritionCompareSeries[0].reportB.date, '2026-11-16');
  assert.equal(compare.nutritionCompareSeries[0].reportA.points.length, 7);
  assert.ok(compare.nutritionCompareSeries[0].reportB.points.some((point) => !point.missing && point.heightRpx >= 12));
});

test('buildReportComparePreview treats equivalent numeric ranges as matching despite formatting', () => {
  const compare = buildReportComparePreview({
    reportType: 'blood_ms',
    reportAId: 'blood-a',
    reportBId: 'blood-b',
    selectedMetricKeys: ['c3'],
    reports: [
      {
        _id: 'blood-a',
        reportType: 'blood_ms',
        reportDate: new Date('2026-01-01T00:00:00+08:00'),
        indicators: {
          c3: { value: '8.000', status: 'high', minRange: '1.500', maxRange: '65.000' }
        }
      },
      {
        _id: 'blood-b',
        reportType: 'blood_ms',
        reportDate: new Date('2026-01-02T00:00:00+08:00'),
        indicators: {
          c3: { value: '9.000', status: 'high', minRange: '1.5', maxRange: '65' }
        }
      }
    ],
    feedingRecords: [],
    nutritionSettings: {},
    fallbackWeight: 5
  });

  const c3Row = compare.compareRows.find((row) => row.key === 'c3');
  assert.equal(c3Row.rangeMismatch, false);
  assert.equal(c3Row.rangeA, '1.500–65.000');
  assert.equal(c3Row.rangeB, '1.500–65.000');
  assert.equal(compare.hasRangeMismatch, false);
});

test('resolveCompareFeedingDataRange only spans week-before windows for selected reports', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {}
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-10-01T00:00:00+08:00'),
      indicators: {}
    }
  ];

  const range = resolveCompareFeedingDataRange(reports, 'urine-current', 'urine-previous', 'urine_ms');
  assert.equal(range.startDate, '2026-09-24');
  assert.equal(range.endDate, '2026-11-15');
});

test('resolveCompareNutritionWindows loads only each report week-before window without merging the gap', () => {
  const reports = [
    {
      _id: 'urine-current',
      reportType: 'urine_ms',
      reportDate: new Date('2026-11-16T00:00:00+08:00'),
      indicators: {}
    },
    {
      _id: 'urine-previous',
      reportType: 'urine_ms',
      reportDate: new Date('2026-10-01T00:00:00+08:00'),
      indicators: {}
    }
  ];

  const windows = resolveCompareNutritionWindows(reports, 'urine-current', 'urine-previous', 'urine_ms');

  assert.deepEqual(windows, [
    { startDate: '2026-11-09', endDate: '2026-11-15' },
    { startDate: '2026-09-24', endDate: '2026-09-30' }
  ]);
});

test('buildReportComparePreview rejects compare when only one same-type report exists', () => {
  const compare = buildReportComparePreview({
    reportType: 'blood_ms',
    reports: [
      {
        _id: 'blood-current',
        reportType: 'blood_ms',
        reportDate: new Date('2026-12-20T00:00:00+08:00'),
        indicators: { c3: { value: '8.1', status: 'high' } }
      }
    ]
  });

  assert.equal(compare.canCompare, false);
  assert.equal(compare.reportCount, 1);
  assert.match(compare.summaryLines[0], /至少需要两份/);
});

test('resolveCompareReportSelection keeps picker ids distinct when report B id is stale', () => {
  const reports = [
    {
      _id: 'blood-new',
      reportType: 'blood_ms',
      reportDate: new Date('2026-04-25T00:00:00+08:00'),
      indicators: { c3: { value: '8.1', status: 'high' } }
    },
    {
      _id: 'blood-old',
      reportType: 'blood_ms',
      reportDate: new Date('2026-01-10T00:00:00+08:00'),
      indicators: { c3: { value: '6.2', status: 'normal' } }
    }
  ];

  const selection = resolveCompareReportSelection(
    reports,
    'blood_ms',
    'blood-new',
    'missing-report-id'
  );

  assert.equal(selection.reportAId, 'blood-new');
  assert.equal(selection.reportBId, 'blood-old');
  assert.equal(selection.reportAIndex, 0);
  assert.equal(selection.reportBIndex, 1);
});

test('buildReportComparePreview does not silently compare the same report when report B id is stale', () => {
  const reports = [
    {
      _id: 'blood-new',
      reportType: 'blood_ms',
      reportDate: new Date('2026-04-25T00:00:00+08:00'),
      indicators: { c3: { value: '8.1', status: 'high' } }
    },
    {
      _id: 'blood-old',
      reportType: 'blood_ms',
      reportDate: new Date('2026-01-10T00:00:00+08:00'),
      indicators: { c3: { value: '6.2', status: 'normal' } }
    }
  ];

  const compare = buildReportComparePreview({
    reportType: 'blood_ms',
    reportAId: 'blood-new',
    reportBId: 'missing-report-id',
    reports
  });

  assert.equal(compare.canCompare, false);
  assert.equal(compare.reportA.id, 'blood-new');
  assert.equal(compare.reportB, null);
});

test('report workbench does not read persisted feeding record summary as nutrition source', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/utils/reportWorkbench.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /record\.summary\??\./);
});
