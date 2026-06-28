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
        fluidVolume: 45,
        totalCalories: 160,
        protein: 6.2,
        carbs: 18
      },
      treatment: {
        count: 1,
        fluidVolume: 120,
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
      infoTitle: '目标热卡系数（kcal/kg/d）',
      infoLines: ['稳定期 120~135 kcal/kg/d']
    },
    {
      label: '总蛋白',
      value: '18.6',
      unit: 'g',
      detail: '天然 8.30g · 特殊 4.10g'
    },
    {
      label: '总液体量',
      value: '885',
      unit: 'ml',
      detail: '奶 720 · 喝水 0 · 其他 165',
      infoTitle: '总液体量明细',
      infoIcon: '!',
      infoLines: ['母乳 420ml', '特奶 300ml', '喝水 0ml', '食物 45ml', '治疗 120ml']
    }
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
        { label: '液体', value: '45 ml' },
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
  assert.equal(preview.topMetrics[3].label, '总液体量');
  assert.equal(preview.topMetrics[3].detail, '奶 0 · 喝水 0');
  assert.equal(preview.topMetrics[3].infoIcon, '!');
  assert.deepEqual(preview.topMetrics[3].infoLines, ['普奶 0ml', '特奶 0ml', '喝水 0ml', '食物 0ml', '治疗 0ml']);
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

test('buildDataRecordsSummaryPreview includes drinking water and treatment ml in total liquid volume', () => {
  const preview = buildDataRecordsSummaryPreview({
    naturalMilkType: 'formula',
    drinkingWaterVolume: 35,
    intakeOverview: {
      milk: {
        normal: { volume: 120 },
        special: { volume: 80 }
      },
      food: {
        fluidVolume: 20
      },
      treatment: {
        fluidVolume: 50
      }
    }
  });

  assert.deepEqual(preview.topMetrics[3], {
    label: '总液体量',
    value: '305',
    unit: 'ml',
    detail: '奶 200 · 喝水 35 · 其他 70',
    infoTitle: '总液体量明细',
    infoIcon: '!',
    infoLines: ['普奶 120ml', '特奶 80ml', '喝水 35ml', '食物 20ml', '治疗 50ml']
  });
});

test('buildDataRecordsSummaryPreview rounds liquid volume display to whole ml', () => {
  const preview = buildDataRecordsSummaryPreview({
    naturalMilkType: 'breast',
    intakeOverview: {
      milk: {
        normal: { volume: 890.5699999999999 },
        special: { volume: 0 }
      },
      food: {
        fluidVolume: 8
      }
    }
  });

  assert.equal(preview.topMetrics[3].value, '899');
  assert.equal(preview.topMetrics[3].detail, '奶 891 · 喝水 0 · 其他 8');
  assert.deepEqual(preview.topMetrics[3].infoLines, ['母乳 891ml', '特奶 0ml', '喝水 0ml', '食物 8ml', '治疗 0ml']);
});

test('buildDataRecordsSummaryPreview chooses breast milk or formula label in total liquid details', () => {
  const breastPreview = buildDataRecordsSummaryPreview({
    naturalMilkType: 'breast',
    intakeOverview: {
      milk: {
        normal: { volume: 60 },
        special: { volume: 0 }
      }
    }
  });
  const formulaPreview = buildDataRecordsSummaryPreview({
    naturalMilkType: 'formula',
    intakeOverview: {
      milk: {
        normal: { volume: 90 },
        special: { volume: 0 }
      }
    }
  });

  assert.equal(breastPreview.topMetrics[3].infoLines[0], '母乳 60ml');
  assert.equal(formulaPreview.topMetrics[3].infoLines[0], '普奶 90ml');
});

test('buildDataRecordsSummaryPreview shows both breast milk and formula when both are recorded', () => {
  const preview = buildDataRecordsSummaryPreview({
    naturalMilkType: 'breast',
    feedings: [
      {
        isV2FeedingRecord: true,
        formulaComponents: [
          { kind: 'breast_milk', volume: 60 },
          {
            kind: 'formula_powder',
            category: 'regular_formula',
            proteinRole: 'natural',
            waterVolume: 90
          },
          {
            kind: 'formula_powder',
            category: 'special_formula',
            proteinRole: 'special',
            waterVolume: 120
          }
        ]
      }
    ],
    intakeOverview: {
      milk: {
        normal: { volume: 150 },
        special: { volume: 120 }
      }
    }
  });

  assert.deepEqual(preview.topMetrics[3].infoLines.slice(0, 4), [
    '母乳 60ml',
    '普奶 90ml',
    '特奶 120ml',
    '喝水 0ml'
  ]);
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

test('buildDataRecordsSummaryPreview derives v2 milk badges from component categories', () => {
  const preview = buildDataRecordsSummaryPreview({
    isV2RecordsPage: true,
    feedings: [
      {
        isV2FeedingRecord: true,
        formulaComponents: [
          {
            kind: 'formula_powder',
            powderName: '普奶 A',
            category: 'regular_formula',
            proteinRole: 'natural',
            waterVolume: 30,
            powderWeight: 5,
            nutritionSnapshot: { protein: 10, calories: 500, fat: 20, carbs: 55 }
          },
          {
            kind: 'formula_powder',
            powderName: '特奶',
            category: 'special_formula',
            proteinRole: 'special',
            waterVolume: 90,
            powderWeight: 13.5,
            nutritionSnapshot: { protein: 13, calories: 520, fat: 24, carbs: 50 }
          },
          {
            kind: 'formula_powder',
            powderName: '能量粉',
            category: 'energy_supplement',
            proteinRole: 'none',
            waterVolume: 20,
            powderWeight: 3,
            nutritionSnapshot: { protein: 0, calories: 400, fat: 0, carbs: 95 }
          }
        ]
      }
    ]
  });

  assert.deepEqual(
    preview.sourceSections[0].componentRows.map((row) => row.badge),
    ['普', '特', '能']
  );
});

test('buildDataRecordsSummaryPreview labels repeated v2 milk components with record counts', () => {
  const makeFeeding = (id, startTime, component) => ({
    _id: id,
    startTime,
    isV2FeedingRecord: true,
    formulaComponents: [component]
  });
  const regularComponent = {
    kind: 'formula_powder',
    powderId: 'regular-a',
    powderName: '普奶 A',
    category: 'regular_formula',
    proteinRole: 'natural',
    waterVolume: 60,
    powderWeight: 9,
    nutritionSnapshot: { protein: 10, calories: 500, fat: 20, carbs: 55 }
  };
  const specialComponent = {
    kind: 'formula_powder',
    powderId: 'special-a',
    powderName: '特奶 A',
    category: 'special_formula',
    proteinRole: 'special',
    waterVolume: 90,
    powderWeight: 13.5,
    nutritionSnapshot: { protein: 13, calories: 520, fat: 24, carbs: 50 }
  };
  const preview = buildDataRecordsSummaryPreview({
    isV2RecordsPage: true,
    feedings: [
      makeFeeding('milk-1', '08:00', regularComponent),
      makeFeeding('milk-2', '10:00', regularComponent),
      makeFeeding('milk-3', '12:00', specialComponent),
      makeFeeding('milk-4', '14:00', specialComponent)
    ]
  });
  const milkSection = preview.sourceSections[0];

  assert.equal(milkSection.meta, '4条记录 · 2类奶品');
  assert.deepEqual(
    milkSection.componentRows.map((row) => ({
      name: row.name,
      recordCount: row.recordCount,
      sourceCountText: row.sourceCountText,
      amountText: row.amountText
    })),
    [
      { name: '普奶 A', recordCount: 2, sourceCountText: '2次记录', amountText: '120ml / 粉18g' },
      { name: '特奶 A', recordCount: 2, sourceCountText: '2次记录', amountText: '180ml / 粉27g' }
    ]
  );
});

test('data records top metric info icon can be customized per metric', () => {
  const pageWxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/data-records-v2/index.wxml'),
    'utf8'
  );

  assert.match(pageWxml, /\{\{item\.infoIcon \|\| 'i'\}\}/);
});

test('data records intake overview tracks only ml food as food fluid volume', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/data-records-v2/index.js'),
    'utf8'
  );

  assert.match(pageJs, /fluidVolume:\s*0/);
  assert.match(pageJs, /if \(\(intake\.unit \|\| ''\)\.toLowerCase\(\) === 'ml'\) \{[\s\S]*overview\.food\.fluidVolume \+= Number\(intake\.quantity\) \|\| 0;/);
  assert.match(pageJs, /overview\.food\.fluidVolume = roundNumber\(overview\.food\.fluidVolume, 2\);/);
});

test('data records restores food protein quality totals from daily summary cache', () => {
  const pageJs = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/data-records-v2/index.js'),
    'utf8'
  );

  assert.match(pageJs, /premiumProtein:\s*Number\(food\.premiumProtein\)\s*\|\|\s*0/);
  assert.match(pageJs, /regularProtein:\s*Number\(food\.regularProtein\)\s*\|\|\s*0/);
});
