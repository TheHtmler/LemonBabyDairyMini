const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('buildDataRecordsSummaryPreview builds compact v2 milk component rows', () => {
  const preview = buildDataRecordsSummaryPreview({
    totalMilk: 200,
    proteinSummaryDisplay: {
      total: '2.92',
      natural: '1.16',
      special: '1.76'
    },
    intakeOverview: {
      milk: {
        normal: { volume: 110, calories: 77.2, protein: 1.16, carbs: 9.8, fat: 3.28 },
        special: { volume: 90, calories: 70.2, protein: 1.76, carbs: 6.75, fat: 3.24 }
      }
    },
    feedings: [
      {
        isV2FeedingRecord: true,
        formulaComponents: [
          {
            kind: 'breast_milk',
            volume: 60,
            nutritionSnapshot: { protein: 1.1, calories: 67, fat: 3.8, carbs: 7 }
          },
          {
            kind: 'formula_powder',
            powderId: 'regular-a',
            powderName: '普奶 A',
            category: 'regular_formula',
            categoryShortLabel: '普',
            categoryBadgeClass: 'regular',
            proteinRole: 'natural',
            waterVolume: 30.4,
            powderWeight: 5,
            nutritionSnapshot: { protein: 10, calories: 500, fat: 20, carbs: 55 }
          },
          {
            kind: 'formula_powder',
            powderId: 'special-a',
            powderName: '特奶',
            category: 'special_formula',
            categoryShortLabel: '特',
            categoryBadgeClass: 'special',
            proteinRole: 'special',
            waterVolume: 90,
            powderWeight: 13.5,
            nutritionSnapshot: { protein: 13, calories: 520, fat: 24, carbs: 50 }
          },
          {
            kind: 'formula_powder',
            powderId: 'energy-a',
            powderName: '能量粉',
            category: 'energy_supplement',
            categoryShortLabel: '能',
            categoryBadgeClass: 'energy',
            proteinRole: 'none',
            waterVolume: 20,
            powderWeight: 3,
            nutritionSnapshot: { protein: 0, calories: 400, fat: 0, carbs: 95 }
          }
        ]
      }
    ]
  });

  const milkSection = preview.sourceSections[0];
  assert.equal(milkSection.type, 'milk');
  assert.equal(milkSection.variant, 'components');
  assert.equal(milkSection.meta, '1条记录');
  assert.equal(milkSection.summaryText, '总奶量 200ml · 热量 147.4kcal · 蛋白 2.92g');
  assert.deepEqual(
    milkSection.componentRows.map((row) => ({
      badge: row.badge,
      badgeClass: row.badgeClass,
      name: row.name,
      amountText: row.amountText,
      primaryText: row.primaryText,
      secondaryText: row.secondaryText,
      proteinRoleText: row.proteinRoleText,
      proteinValueText: row.proteinValueText,
      proteinBreakdownText: row.proteinBreakdownText,
      proteinLabelText: row.proteinLabelText,
      proteinAmountText: row.proteinAmountText,
      carbsText: row.carbsText,
      fatText: row.fatText,
      macroText: row.macroText
    })),
    [
      { badge: '母', badgeClass: 'breast', name: '母乳', amountText: '60ml', primaryText: '40 kcal', secondaryText: '天然0.66g', proteinRoleText: '天然', proteinValueText: '0.66g', proteinBreakdownText: '天然0.66g', proteinLabelText: '天然蛋白', proteinAmountText: '0.66g', carbsText: '4.2g', fatText: '2.28g', macroText: '碳水 4.2g · 脂肪 2.28g' },
      { badge: '普', badgeClass: 'regular', name: '普奶 A', amountText: '30ml / 粉5g', primaryText: '25 kcal', secondaryText: '天然0.5g', proteinRoleText: '天然', proteinValueText: '0.5g', proteinBreakdownText: '天然0.5g', proteinLabelText: '天然蛋白', proteinAmountText: '0.5g', carbsText: '2.75g', fatText: '1g', macroText: '碳水 2.75g · 脂肪 1g' },
      { badge: '特', badgeClass: 'special', name: '特奶', amountText: '90ml / 粉13.5g', primaryText: '70 kcal', secondaryText: '特殊1.76g', proteinRoleText: '特殊', proteinValueText: '1.76g', proteinBreakdownText: '特殊1.76g', proteinLabelText: '特殊蛋白', proteinAmountText: '1.76g', carbsText: '6.75g', fatText: '3.24g', macroText: '碳水 6.75g · 脂肪 3.24g' },
      { badge: '能', badgeClass: 'energy', name: '能量粉', amountText: '20ml / 粉3g', primaryText: '12 kcal', secondaryText: '无蛋白热量', proteinRoleText: '无蛋白热量', proteinValueText: '', proteinBreakdownText: '无蛋白热量', proteinLabelText: '无蛋白热量', proteinAmountText: '0g', carbsText: '2.85g', fatText: '0g', macroText: '碳水 2.85g · 脂肪 0g' }
    ]
  );
});

test('buildDataRecordsSummaryPreview keeps v2 milk overview empty like other empty intake sections', () => {
  const preview = buildDataRecordsSummaryPreview({
    isV2RecordsPage: true,
    totalMilk: 0,
    feedings: []
  });

  const milkSection = preview.sourceSections[0];
  assert.equal(milkSection.type, 'milk');
  assert.equal(milkSection.variant, 'components');
  assert.equal(milkSection.meta, '0条记录');
  assert.deepEqual(milkSection.componentRows, []);
  assert.equal(Object.hasOwn(milkSection, 'emptyText'), false);
  assert.equal(milkSection.summaryText, '总奶量 0ml · 热量 0kcal · 蛋白 0g');
});

test('buildDataRecordsSummaryPreview shows food special protein under special protein coefficient module', () => {
  const preview = buildDataRecordsSummaryPreview({
    proteinSummaryDisplay: {
      total: '12.0',
      natural: '7.9',
      special: '4.1'
    },
    specialProteinCoefficient: '0.3',
    intakeOverview: {
      milk: {
        normal: {
          volume: 420,
          calories: 260,
          protein: 5.1
        },
        special: {
          volume: 180,
          calories: 120,
          protein: 2.8
        }
      },
      food: {
        count: 2,
        totalCalories: 160,
        naturalProtein: 2.8,
        specialProtein: 1.3,
        carbs: 18
      },
      treatment: {
        count: 0,
        totalCalories: 0,
        carbs: 0
      }
    }
  });

  assert.equal(preview.nutritionStrip[1].source, '特奶 2.80g · 食物 1.30g');
  assert.equal(preview.nutritionStrip[1].detail, '0.3 g/kg/d');
});

test('data records does not rank feeding records by persisted summary calories', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../miniprogram/pages/data-records/index.js'),
    'utf8'
  );

  assert.doesNotMatch(source, /summaryCalories/);
});
