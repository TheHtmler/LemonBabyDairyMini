const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDataRecordsSummaryPreview
} = require('../miniprogram/utils/dataRecordsSummaryPreview');

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
      special: '4.1',
      premium: '6.4',
      premiumRatio: 77
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
      detail: '天然 8.30g · 特殊 4.10g'
    },
    { label: '总奶量', value: '720', unit: 'ml', detail: '母：420ml · 特：300ml' }
  ]);
  assert.deepEqual(preview.nutritionStrip, [
    { label: '天然蛋白', value: '8.3', unit: 'g', source: '奶 5.10g · 食物 3.20g', premiumRatio: 77, premiumValue: '6.4', detailLabel: '天然蛋白系数', detailValue: '1.2', detailUnit: 'g/kg/d', detail: '1.2 g/kg/d' },
    { label: '特殊蛋白', value: '4.1', unit: 'g', source: '特奶 4.10g', detailLabel: '特殊蛋白系数', detailValue: '0.8', detailUnit: 'g/kg/d', detail: '0.8 g/kg/d' }
  ]);
  assert.deepEqual(preview.sourceSections, [
    {
      label: '喂奶',
      type: 'milk',
      summaryText: '母乳 420ml 260kcal 5.10g蛋白 · 特奶 300ml 180kcal 4.80g蛋白',
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
  assert.equal(preview.topMetrics[2].detail, '天然 0.00g · 特殊 0.00g');
  assert.equal(preview.topMetrics[3].detail, '普：0ml · 特：0ml');
  assert.equal(preview.nutritionStrip[0].source, '奶 0.00g · 食物 0.00g');
  assert.equal(preview.nutritionStrip[1].source, '特奶 0.00g');
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
  assert.equal(preview.sourceSections[0].summaryText, '普奶 0ml 0kcal 0.00g蛋白 · 特奶 0ml 0kcal 0.00g蛋白');
  assert.equal(preview.sourceSections[1].meta, '0条记录');
  assert.equal(preview.sourceSections[2].meta, '0条记录');
  assert.equal(preview.coefficientRows[0].value, '--');
});
