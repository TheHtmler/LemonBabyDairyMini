const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  buildDataRecordsSummaryPreview
} = require('../miniprogram/utils/dataRecordsSummaryPreview');

function loadSummaryPreviewPage() {
  const pagePath = require.resolve('../miniprogram/pages/summary-preview/index.js');
  delete require.cache[pagePath];
  let pageConfig = null;
  const previousPage = global.Page;
  global.Page = (config) => {
    pageConfig = config;
  };
  require(pagePath);
  global.Page = previousPage;
  return pageConfig;
}

test('buildDataRecordsSummaryPreview maps summary data into compact dashboard sections', () => {
  const preview = buildDataRecordsSummaryPreview({
    formattedSelectedDate: '2026年3月28日',
    weight: '5.2',
    height: '58',
    totalMilk: 720,
    naturalMilkType: 'breast',
    dailyCaloriesTotal: 685,
    caloriePerKg: 132,
    proteinSummaryDisplay: {
      total: '18.6',
      natural: '8.3',
      special: '4.1'
    },
    naturalProteinCoefficient: '1.2',
    specialProteinCoefficient: '0.8',
    calorieGoalPerKgRange: {
      min: 120,
      max: 135,
      label: '稳定期'
    },
    macroRatios: {
      protein: 12,
      carbs: 48,
      fat: 40
    },
    fatRatioPopupLines: [
      '0-6月: 45%-50%',
      '>6月: 35%-40%',
      '1-2岁: 30%-35%',
      '>6岁: 25%-30%'
    ],
    intakeOverview: {
      milk: {
        normal: {
          volume: 420,
          calories: 260,
          protein: 5.1
        },
        special: {
          volume: 300,
          calories: 180,
          protein: 4.8
        }
      },
      food: {
        count: 2,
        totalCalories: 160,
        protein: 6.2,
        carbs: 18
      },
      treatment: {
        count: 1,
        totalCalories: 85,
        carbs: 25
      }
    }
  });

  assert.equal(preview.displayDate, '2026年3月28日');
  assert.deepEqual(preview.heroBadges, [
    { label: '体重', value: '5.2', unit: 'kg', field: 'weight' },
    { label: '身高', value: '58', unit: 'cm', field: 'height' }
  ]);
  assert.deepEqual(preview.topMetrics, [
    { label: '总热量', value: '685', unit: 'kcal', detail: '奶 440 · 食物 160 · 治疗 85' },
    {
      label: '热卡系数',
      value: '132',
      unit: 'kcal/kg/d',
      detail: '推荐：120~135 kcal/kg/d',
      infoTitle: '目标热卡系数',
      infoLines: ['120~135 kcal/kg', '稳定期']
    },
    {
      label: '总蛋白',
      value: '18.6',
      unit: 'g',
      detail: '天然 8.3g · 特殊 4.1g'
    },
    { label: '总奶量', value: '720', unit: 'ml', detail: '母：420ml · 特：300ml' }
  ]);
  assert.deepEqual(preview.nutritionStrip, [
    { label: '天然蛋白', value: '8.3', unit: 'g', source: '奶 5.1g · 食物 3.2g', detailLabel: '天然蛋白系数', detailValue: '1.2', detailUnit: 'g/kg/d', detail: '1.2 g/kg/d' },
    { label: '特殊蛋白', value: '4.1', unit: 'g', source: '特奶 4.1g', detailLabel: '特殊蛋白系数', detailValue: '0.8', detailUnit: 'g/kg/d', detail: '0.8 g/kg/d' }
  ]);
  assert.deepEqual(preview.sourceSections, [
    {
      label: '喂奶',
      type: 'milk',
      summaryText: '母乳 420ml 260kcal 5.1g蛋白 · 特奶 300ml 180kcal 4.8g蛋白',
      columns: [
        {
          label: '母乳',
          stats: [
            { label: '体积', value: '420 ml' },
            { label: '热量', value: '260 kcal' },
            { label: '蛋白', value: '5.1 g' },
            { label: '蛋白系数', value: '— g/kg/d' },
            { label: '碳水', value: '0 g' },
            { label: '脂肪', value: '0 g' }
          ]
        },
        {
          label: '特奶',
          stats: [
            { label: '体积', value: '300 ml' },
            { label: '热量', value: '180 kcal' },
            { label: '蛋白', value: '4.8 g' },
            { label: '蛋白系数', value: '— g/kg/d' },
            { label: '碳水', value: '0 g' },
            { label: '脂肪', value: '0 g' }
          ]
        }
      ]
    },
    {
      label: '食物',
      type: 'stats',
      meta: '2条记录',
      summaryText: '热量 160 kcal · 蛋白 6.2 g',
      stats: [
        { label: '热量', value: '160 kcal' },
        { label: '蛋白', value: '6.2 g' },
        { label: '碳水', value: '18 g' }
      ]
    },
    {
      label: '治疗',
      type: 'stats',
      meta: '1条记录',
      summaryText: '热量 85 kcal · 碳水 25 g',
      stats: [
        { label: '热量', value: '85 kcal' },
        { label: '碳水', value: '25 g' }
      ]
    }
  ]);
  assert.deepEqual(preview.coefficientRows, [
    { label: '目标热卡系数', value: '120~135 kcal/kg', hint: '稳定期' },
    { label: '天然蛋白系数', value: '1.2 g/kg/d' },
    { label: '特殊蛋白系数', value: '0.8 g/kg/d' }
  ]);
  assert.deepEqual(preview.macroRows, [
    { label: '蛋白', value: '12%', infoTitle: '蛋白供能占比参考', infoLines: ['参考 10%-15%'] },
    { label: '碳水', value: '48%', infoTitle: '碳水供能占比参考', infoLines: ['参考 55%-60%'] },
    { label: '脂肪', value: '40%', infoTitle: '脂肪供能占比参考', infoLines: ['0-6月: 45%-50%', '>6月: 35%-40%', '1-2岁: 30%-35%', '>6岁: 25%-30%'] }
  ]);
});

test('buildDataRecordsSummaryPreview falls back to placeholders for missing values', () => {
  const preview = buildDataRecordsSummaryPreview({});

  assert.equal(preview.topMetrics[0].value, '0');
  assert.equal(preview.topMetrics[0].detail, '奶 0 · 食物 0 · 治疗 0');
  assert.equal(preview.topMetrics[1].value, '--');
  assert.equal(preview.topMetrics[1].detail, '推荐：--');
  assert.deepEqual(preview.topMetrics[1].infoLines, ['--']);
  assert.equal(preview.topMetrics[2].detail, '天然 0g · 特殊 0g');
  assert.equal(preview.topMetrics[3].detail, '普：0ml · 特：0ml');
  assert.equal(preview.nutritionStrip[0].source, '奶 0g · 食物 0g');
  assert.equal(preview.nutritionStrip[1].source, '特奶 0g');
  assert.equal(preview.nutritionStrip[0].unit, 'g');
  assert.equal(preview.nutritionStrip[1].unit, 'g');
  assert.equal(preview.nutritionStrip[0].detailLabel, '天然蛋白系数');
  assert.equal(preview.nutritionStrip[1].detailLabel, '特殊蛋白系数');
  assert.equal(preview.nutritionStrip[0].detailValue, '--');
  assert.equal(preview.nutritionStrip[1].detailValue, '--');
  assert.equal(preview.nutritionStrip[0].detailUnit, 'g/kg/d');
  assert.equal(preview.nutritionStrip[1].detailUnit, 'g/kg/d');
  assert.equal(preview.nutritionStrip[0].detail, '--');
  assert.equal(preview.nutritionStrip[1].detail, '--');
  assert.equal(preview.macroRows[0].value, '0%');
  assert.deepEqual(preview.macroRows[2].infoLines, []);
  assert.equal(preview.sourceSections[0].columns[0].stats[0].value, '0 ml');
  assert.deepEqual(preview.sourceSections[1].stats, []);
  assert.deepEqual(preview.sourceSections[2].stats, []);
  assert.equal(preview.sourceSections[0].summaryText, '普奶 0ml 0kcal 0g蛋白 · 特奶 0ml 0kcal 0g蛋白');
  assert.equal(preview.sourceSections[1].meta, '0条记录');
  assert.equal(preview.sourceSections[2].meta, '0条记录');
  assert.equal(preview.coefficientRows[0].value, '--');
});

test('summary preview page toggles calorie goal bubble state', () => {
  const page = loadSummaryPreviewPage();
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      this.data = { ...this.data, ...update };
    }
  };

  page.toggleMetricInfo.call(instance, {
    currentTarget: {
      dataset: {
        label: '热卡系数',
        title: '目标热卡系数',
        lines: ['120~135 kcal/kg', '稳定期']
      }
    }
  });

  assert.equal(instance.data.activeMetricInfoLabel, '热卡系数');
  assert.equal(instance.data.activeMetricInfoTitle, '目标热卡系数');
  assert.deepEqual(instance.data.activeMetricInfoLines, ['120~135 kcal/kg', '稳定期']);

  page.toggleMetricInfo.call(instance, {
    currentTarget: {
      dataset: {
        label: '热卡系数',
        title: '目标热卡系数',
        lines: ['120~135 kcal/kg', '稳定期']
      }
    }
  });

  assert.equal(instance.data.activeMetricInfoLabel, '');
  assert.deepEqual(instance.data.activeMetricInfoLines, []);

  page.toggleMetricInfo.call(instance, {
    currentTarget: {
      dataset: {
        label: '热卡系数',
        title: '目标热卡系数',
        lines: ['120~135 kcal/kg', '稳定期']
      }
    }
  });
  page.hideMetricInfo.call(instance);

  assert.equal(instance.data.activeMetricInfoLabel, '');
  assert.equal(instance.data.activeMetricInfoTitle, '');
  assert.deepEqual(instance.data.activeMetricInfoLines, []);
});

test('summary preview page toggles overview detail state', () => {
  const page = loadSummaryPreviewPage();
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      this.data = { ...this.data, ...update };
    }
  };

  assert.equal(instance.data.detailsExpanded, undefined);
});

test('summary preview page toggles fat ratio bubble state', () => {
  const page = loadSummaryPreviewPage();
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      this.data = { ...this.data, ...update };
    }
  };

  page.toggleMetricInfo.call(instance, {
    currentTarget: {
      dataset: {
        label: '脂肪',
        title: '脂肪供能占比参考',
        lines: ['0-6月: 45%-50%', '>6月: 35%-40%']
      }
    }
  });

  assert.equal(instance.data.activeMetricInfoLabel, '脂肪');
  assert.equal(instance.data.activeMetricInfoTitle, '脂肪供能占比参考');
  assert.deepEqual(instance.data.activeMetricInfoLines, ['0-6月: 45%-50%', '>6月: 35%-40%']);
});

test('summary preview bubble styles anchor arrow to icon center', () => {
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pages/summary-preview/index.wxss'),
    'utf8'
  );

  assert.match(wxss, /\.metric-info-bubble\s*\{[\s\S]*left:\s*50%;/);
  assert.match(wxss, /\.metric-info-bubble\s*\{[\s\S]*transform:\s*translateX\(-50%\);/);
  assert.match(wxss, /\.metric-info-bubble::before\s*\{[\s\S]*left:\s*50%;/);
  assert.match(wxss, /\.metric-info-bubble::before\s*\{[\s\S]*transform:\s*translateX\(-50%\)\s*rotate\(45deg\);/);
});

test('protein nutrition pills use stacked metric layout for value and coefficient', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pages/summary-preview/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/pages/summary-preview/index.wxss'),
    'utf8'
  );

  assert.match(wxml, /nutrition-pill-copy[\s\S]*nutrition-pill-label/);
  assert.match(wxml, /nutrition-pill-label">\{\{item\.label\}\}系数/);
  assert.match(wxml, /nutrition-pill-metric[\s\S]*nutrition-pill-detail-row[\s\S]*nutrition-pill-detail[\s\S]*nutrition-pill-detail-unit[\s\S]*nutrition-pill-protein-row[\s\S]*nutrition-pill-protein-label">蛋白<\/text>[\s\S]*nutrition-pill-protein-value[\s\S]*nutrition-pill-unit-secondary[\s\S]*nutrition-pill-separator[\s\S]*nutrition-pill-source-inline/);
  assert.match(wxml, /ratio-inline-list\s+macro-strip/);
  assert.match(wxml, /ratio-inline-label-row[\s\S]*ratio-inline-label[\s\S]*metric-info-anchor/);
  assert.match(wxml, /overview-title">摄入概览/);
  assert.match(wxml, /overview-milk-grid/);
  assert.match(wxml, /overview-stat-compact-grid/);
  assert.match(wxml, /overview-stat-compact-item/);
  assert.match(wxml, /nutrition-pill-label-row[\s\S]*nutrition-pill-label/);
  assert.match(wxss, /\.nutrition-pill\s*\{[\s\S]*align-items:\s*flex-start;/);
  assert.match(wxss, /\.nutrition-pill-metric\s*\{[\s\S]*align-items:\s*flex-start;/);
  assert.match(wxss, /\.nutrition-strip\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(wxss, /\.nutrition-pill-detail-row\s*\{[\s\S]*display:\s*flex;/);
  assert.match(wxss, /\.nutrition-pill-detail\s*\{[\s\S]*font-size:\s*30rpx;/);
  assert.match(wxss, /\.nutrition-pill-detail-unit\s*\{[\s\S]*font-size:\s*22rpx;/);
  assert.match(wxss, /\.nutrition-pill-value-secondary\s*\{[\s\S]*font-size:\s*22rpx;/);
  assert.match(wxss, /\.nutrition-pill-protein-value\s*\{[\s\S]*color:\s*#FF8C00;/);
  assert.match(wxss, /\.nutrition-pill-separator\s*\{/);
  assert.match(wxss, /\.ratio-inline-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(wxss, /\.ratio-inline-label-row\s*\{[\s\S]*display:\s*flex;/);
  assert.match(wxss, /\.overview-milk-grid\s*\{/);
  assert.match(wxss, /\.overview-stat-compact-grid\s*\{/);
  assert.match(wxss, /\.overview-stat-compact-item\s*\{/);
  assert.match(wxss, /#ffd54f/);
});

test('summary preview page exposes date selector and record tabs state', () => {
  const page = loadSummaryPreviewPage();

  assert.equal(page.data.activeTab, 'feeding');
  assert.equal(page.data.todayFullDate, '2026年3月28日');
  assert.equal(page.data.currentDateId, 'date-0');
  assert.equal(page.data.selectedDateIndex, 0);
  assert.equal(page.data.dateList.length, 7);
});

test('summary preview wxml includes date selector and detailed record tabs', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pages/summary-preview/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /class="date-selector"/);
  assert.doesNotMatch(wxml, /class="current-date"/);
  assert.match(wxml, /bindtap="onDateItemClick"/);
  assert.match(wxml, /bindtap="showCalendar"/);
  assert.match(wxml, /class="tabs"/);
  assert.match(wxml, /data-tab="feeding"/);
  assert.match(wxml, /data-tab="food"/);
  assert.match(wxml, /data-tab="medication"/);
  assert.match(wxml, /data-tab="treatment"/);
});

test('summary preview page supports editing weight and height via modal state', () => {
  const page = loadSummaryPreviewPage();
  const instance = {
    data: JSON.parse(JSON.stringify(page.data)),
    setData(update) {
      this.data = { ...this.data, ...update };
    }
  };

  page.openBasicInfoEditor.call(instance, {
    currentTarget: {
      dataset: {
        field: 'weight',
        label: '体重',
        unit: 'kg'
      }
    }
  });

  assert.equal(instance.data.showBasicInfoModal, true);
  assert.equal(instance.data.editingField, 'weight');
  assert.equal(instance.data.editingLabel, '体重');
  assert.equal(instance.data.editBasicInfoValue, '5.2');

  page.onBasicInfoInput.call(instance, {
    detail: {
      value: '5.5'
    }
  });
  page.confirmBasicInfoEdit.call(instance);

  assert.equal(instance.data.showBasicInfoModal, false);
  assert.equal(instance.data.preview.heroBadges[0].value, '5.5');
  assert.equal(instance.data.preview.topMetrics[1].value, '124.5');
});

test('summary preview wxml includes edit icons and basic info modal', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pages/summary-preview/index.wxml'),
    'utf8'
  );

  assert.match(wxml, /bindtap="openBasicInfoEditor"/);
  assert.match(wxml, /data-field="{{item\.field}}"/);
  assert.match(wxml, /data-label="{{item\.label}}"/);
  assert.match(wxml, /class="basic-info-modal"/);
  assert.match(wxml, /bindtap="confirmBasicInfoEdit"/);
});
