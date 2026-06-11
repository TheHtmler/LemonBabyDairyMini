const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PLANNED_MEALS,
  parseMedicationFrequency,
  isScheduledToday,
  diffInDays,
  buildMedicationChecklist,
  buildNutritionGoals,
  buildNutritionTargetState,
  buildNutritionSummary,
  buildFoodMealCount,
  buildFeedingProgress,
  buildNextMealReference,
  buildWeeklyTrend,
  weightedAverageCoefficient,
  metricDisplayPrecision,
  buildTimeline,
  milkRecordVolumes
} = require('../miniprogram/utils/homeDashboard.js');

function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

test('parseMedicationFrequency 优先用结构化字段', () => {
  assert.deepEqual(parseMedicationFrequency({ frequencyDays: '2', frequencyTimes: '1' }), { days: 2, times: 1 });
  assert.deepEqual(parseMedicationFrequency({ frequencyDays: '1', frequencyTimes: '2' }), { days: 1, times: 2 });
});

test('parseMedicationFrequency 回退解析 frequency 文本', () => {
  assert.deepEqual(parseMedicationFrequency({ frequency: '每日2次' }), { days: 1, times: 2 });
  assert.deepEqual(parseMedicationFrequency({ frequency: '每2天1次' }), { days: 2, times: 1 });
  assert.deepEqual(parseMedicationFrequency({ frequency: '每周3次' }), { days: 7, times: 3 });
  assert.deepEqual(parseMedicationFrequency({}), { days: 1, times: 1 });
});

test('diffInDays 计算日期差', () => {
  assert.equal(diffInDays('2026-06-01', '2026-06-02'), 1);
  assert.equal(diffInDays('2026-05-31', '2026-06-02'), 2);
  assert.equal(diffInDays('2026-06-02', '2026-06-02'), 0);
});

test('isScheduledToday：每日类恒为 true', () => {
  assert.equal(isScheduledToday({ frequencyDays: '1', frequencyTimes: '2' }, '2026-06-02', ''), true);
});

test('isScheduledToday：隔日类按最近服用日推算', () => {
  const med = { frequencyDays: '2', frequencyTimes: '1' };
  assert.equal(isScheduledToday(med, '2026-06-02', '2026-06-01'), false); // 昨天吃过 -> 今天不该吃
  assert.equal(isScheduledToday(med, '2026-06-02', '2026-05-31'), true);  // 前天吃过 -> 今天该吃
  assert.equal(isScheduledToday(med, '2026-06-02', ''), true);            // 无历史 -> 默认可吃
});

test('buildMedicationChecklist：每日2次药统计完成进度', () => {
  const meds = [
    { _id: 'arg', name: '精氨酸', dosage: '1.2', unit: 'ml', frequencyDays: '1', frequencyTimes: '1' },
    { _id: 'lev', name: '左卡尼丁', dosage: '1.5', unit: 'ml', frequencyDays: '1', frequencyTimes: '2' }
  ];
  const todayRecords = [
    { medicationId: 'arg', actualTime: '08:10' },
    { medicationId: 'lev', actualTime: '08:12' }
  ];
  const plan = buildMedicationChecklist({ meds, todayRecords, history: [], todayKey: '2026-06-02' });

  const arg = plan.items.find((i) => i.medicationId === 'arg');
  const lev = plan.items.find((i) => i.medicationId === 'lev');

  assert.equal(arg.status, 'done');
  assert.equal(arg.doseCount, 1);
  assert.equal(arg.doseTotal, 1);
  assert.deepEqual(arg.times, ['08:10']);

  assert.equal(lev.status, 'partial');
  assert.equal(lev.doseCount, 1);
  assert.equal(lev.doseTotal, 2);
  assert.equal(lev.remaining, 1);
  assert.deepEqual(lev.dosePips, [{ on: true }, { on: false }]); // 第1次已服、第2次待服
  assert.deepEqual(arg.dosePips, [{ on: true }]);

  assert.equal(plan.totalCount, 2);
  assert.equal(plan.doneCount, 1);
  assert.equal(plan.allDone, false);
  assert.equal(plan.hasPending, true);
});

test('buildMedicationChecklist：隔日药未轮到则不计入今日待办', () => {
  const meds = [
    { _id: 'b12', name: 'B12', dosage: '1', unit: '支', frequencyDays: '2', frequencyTimes: '1' }
  ];
  const history = [{ date: '2026-06-01', takenMedicationIds: ['b12'] }];
  const plan = buildMedicationChecklist({ meds, todayRecords: [], history, todayKey: '2026-06-02' });

  const b12 = plan.items.find((i) => i.medicationId === 'b12');
  assert.equal(b12.scheduledToday, false);
  assert.equal(b12.status, 'skip');
  assert.equal(plan.totalCount, 0);
  assert.equal(plan.hasPlan, false);
});

test('buildMedicationChecklist：AD/D3 各自隔日，靠历史自然错开', () => {
  const meds = [
    { _id: 'ad', name: 'AD', frequencyDays: '2', frequencyTimes: '1' },
    { _id: 'd3', name: 'D3', frequencyDays: '2', frequencyTimes: '1' }
  ];
  const history = [{ date: '2026-06-01', takenMedicationIds: ['d3'] }];
  const plan = buildMedicationChecklist({ meds, todayRecords: [], history, todayKey: '2026-06-02' });

  const ad = plan.items.find((i) => i.medicationId === 'ad');
  const d3 = plan.items.find((i) => i.medicationId === 'd3');
  assert.equal(ad.scheduledToday, true);
  assert.equal(d3.scheduledToday, false);
});

test('buildNutritionGoals：天然蛋白目标=1.2×体重，热量取整', () => {
  const goals = buildNutritionGoals({
    macroSummary: { naturalProtein: 5.22, specialProtein: 9.6, calories: 657.4 },
    weight: 4.35,
    coefficients: { natural: 1.2, special: 2.2, calorie: 180 }
  });

  assert.equal(goals.naturalProtein.target, round2(1.2 * 4.35));
  assert.equal(goals.naturalProtein.reached, true);
  assert.equal(goals.caloriesPerKg, 151); // 657.4/4.35≈151
  assert.equal(goals.calorie.actual, 657); // 热量取整为整数
  assert.equal(goals.calorie.hasTarget, true);
  assert.equal(goals.specialProtein.hasTarget, true);
});

test('buildNutritionGoals：无系数时不显示目标', () => {
  const goals = buildNutritionGoals({
    macroSummary: { naturalProtein: 3, specialProtein: 2, calories: 400 },
    weight: 4,
    coefficients: {}
  });
  assert.equal(goals.naturalProtein.hasTarget, true); // 天然蛋白默认 1.2
  assert.equal(goals.specialProtein.hasTarget, false);
  assert.equal(goals.calorie.hasTarget, false);
});

test('buildNutritionTargetState：没有任何目标时保持实际摄入模式', () => {
  const state = buildNutritionTargetState({
    macroSummary: { naturalProtein: 3, specialProtein: 2, calories: 400 },
    weight: 4,
    targetPreferences: {}
  });

  assert.equal(state.mode, 'actual');
  assert.equal(state.hasAnyTarget, false);
  assert.equal(state.activeGoal, null);
  assert.equal(state.actual.calories, 400);
  assert.equal(state.actual.totalProtein, 5);
  assert.equal(state.setupCtaText, '设置目标');
});

test('buildNutritionTargetState：蛋白目标需要天然和特殊系数都设置', () => {
  const missingSpecial = buildNutritionTargetState({
    macroSummary: { naturalProtein: 3, specialProtein: 2, calories: 400 },
    weight: 4,
    targetPreferences: {
      preferredTargetMode: 'protein',
      naturalProteinCoefficient: '1.2'
    }
  });
  assert.equal(missingSpecial.configuredModes.protein, false);
  assert.equal(missingSpecial.mode, 'actual');

  const state = buildNutritionTargetState({
    macroSummary: { naturalProtein: 3, specialProtein: 2, calories: 400 },
    weight: 4,
    targetPreferences: {
      preferredTargetMode: 'protein',
      naturalProteinCoefficient: '1.2',
      specialProteinCoefficient: '0.8'
    }
  });

  assert.equal(state.mode, 'protein');
  assert.equal(state.configuredModes.protein, true);
  assert.equal(state.activeGoal.actual, 5);
  assert.equal(state.activeGoal.target, 8);
  assert.equal(state.activeGoal.pct, 63);
  assert.equal(state.activeGoal.status, 'pending');
  assert.equal(state.activeGoal.statusText, '还差 37%');
  assert.equal(state.activeGoal.ringPct, 63);
  assert.equal(state.activeGoal.overPct, 0);
  assert.equal(state.activeGoal.actualText, '已摄入 5g');
  assert.equal(state.activeGoal.goalText, '目标 8g');
  assert.equal(state.protein.natural.target, 4.8);
  assert.equal(state.protein.special.target, 3.2);
  assert.deepEqual(state.rows.map((row) => row.key), ['naturalProtein', 'specialProtein']);
  assert.equal(state.rows[0].targetText, '4.8g');
  assert.equal(state.rows[0].remainingText, '1.8g');
  assert.equal(state.rows[0].remainingLabel, '还差');
  assert.equal(state.rows[0].pctText, '63%');
  assert.equal(state.rows[1].targetText, '3.2g');
  assert.equal(state.rows[1].remainingText, '1.2g');
});

test('buildNutritionTargetState：热量目标只需要热量系数并按首选维度展示', () => {
  const calorieOnly = buildNutritionTargetState({
    macroSummary: { naturalProtein: 3, specialProtein: 2, calories: 400 },
    weight: 4,
    targetPreferences: {
      preferredTargetMode: 'calorie',
      calorieCoefficient: '120'
    }
  });

  assert.equal(calorieOnly.mode, 'calorie');
  assert.equal(calorieOnly.configuredModes.calorie, true);
  assert.equal(calorieOnly.configuredModes.protein, false);
  assert.equal(calorieOnly.activeGoal.actual, 400);
  assert.equal(calorieOnly.activeGoal.target, 480);
  assert.equal(calorieOnly.activeGoal.pct, 83);
  assert.equal(calorieOnly.activeGoal.actualText, '已摄入 400kcal');
  assert.equal(calorieOnly.activeGoal.goalText, '目标 480kcal');
  assert.deepEqual(calorieOnly.rows.map((row) => row.key), ['calorie']);
  assert.equal(calorieOnly.rows[0].targetText, '480kcal');
  assert.equal(calorieOnly.rows[0].remainingText, '80kcal');
  assert.equal(calorieOnly.rows[0].pctText, '83%');

  const proteinPreferred = buildNutritionTargetState({
    macroSummary: { naturalProtein: 3, specialProtein: 2, calories: 400 },
    weight: 4,
    targetPreferences: {
      preferredTargetMode: 'protein',
      naturalProteinCoefficient: '1.2',
      specialProteinCoefficient: '0.8',
      calorieCoefficient: '120'
    }
  });
  assert.equal(proteinPreferred.mode, 'protein');
});

test('buildNutritionTargetState：超出目标时给出超出状态和超出量', () => {
  const state = buildNutritionTargetState({
    macroSummary: { naturalProtein: 6, specialProtein: 6, calories: 720 },
    weight: 4,
    targetPreferences: {
      preferredTargetMode: 'calorie',
      calorieCoefficient: '120'
    }
  });

  assert.equal(state.activeGoal.pct, 150);
  assert.equal(state.activeGoal.status, 'over');
  assert.equal(state.activeGoal.statusText, '超出 50%');
  assert.equal(state.activeGoal.ringPct, 100);
  assert.equal(state.activeGoal.overPct, 50);
  assert.equal(state.rows[0].remainingLabel, '超出');
  assert.equal(state.rows[0].remainingText, '240kcal');
  assert.equal(state.rows[0].statusText, '超出 50%');
});

test('buildNutritionSummary：只算实际摄入，热量取整、蛋白1位、含总蛋白与系数', () => {
  const s = buildNutritionSummary({
    macroSummary: { naturalProtein: 5.22, specialProtein: 9.6, calories: 657.4 },
    weight: 4.35
  });
  assert.equal(s.calories, 657);            // 取整
  assert.equal(s.caloriesPerKg, 151);       // 657.4/4.35≈151
  assert.equal(s.naturalProtein, 5.2);      // 1 位小数
  assert.equal(s.specialProtein, 9.6);
  assert.equal(s.totalProtein, 14.8);       // 5.22+9.6=14.82 → 14.8
  assert.equal(s.naturalProteinPerKg, 1.2); // 5.22/4.35=1.2，2 位
  assert.equal(s.specialProteinPerKg, 2.21);// 9.6/4.35≈2.21
  assert.equal(s.totalProteinPerKg, 3.41);  // 14.82/4.35≈3.41
});

test('buildNutritionSummary：无体重时各系数为0、不报错', () => {
  const s = buildNutritionSummary({ macroSummary: { calories: 400, naturalProtein: 5, specialProtein: 9 }, weight: 0 });
  assert.equal(s.caloriesPerKg, 0);
  assert.equal(s.naturalProteinPerKg, 0);
  assert.equal(s.specialProteinPerKg, 0);
  assert.equal(s.totalProteinPerKg, 0);
  assert.equal(s.calories, 400);
});

test('milkRecordVolumes：从组件拆分母乳/特奶', () => {
  const record = {
    nutritionSummary: { totalVolume: 120 },
    formulaComponents: [
      { kind: 'breast_milk', volume: 59 },
      { kind: 'formula_powder', proteinRole: 'special', waterVolume: 61 }
    ]
  };
  const v = milkRecordVolumes(record);
  assert.equal(v.total, 120);
  assert.equal(v.breast, 59);
  assert.equal(v.special, 61);
});

test('buildFoodMealCount：同一顿多个食物按一顿辅食统计', () => {
  const records = [
    { _id: 'food-1', mealBatchId: 'meal-a', nameSnapshot: '米粉' },
    { _id: 'food-2', mealBatchId: 'meal-a', nameSnapshot: '苹果泥' },
    { _id: 'food-3', nameSnapshot: '香蕉泥' }
  ];

  assert.equal(buildFoodMealCount(records), 2);
});

test('buildFeedingProgress：顿数/总量/进度点/最近时间', () => {
  const milkRecords = [
    { startTime: '08:00', nutritionSummary: { totalVolume: 110 } },
    { startTime: '11:05', nutritionSummary: { totalVolume: 120 } }
  ];
  const progress = buildFeedingProgress({ milkRecords, plannedMeals: 8 });
  assert.equal(progress.count, 2);
  assert.equal(progress.plannedMeals, 8);
  assert.equal(progress.remaining, 6);
  assert.equal(progress.totalVolume, 230);
  assert.equal(progress.lastMealTime, '11:05');
  assert.equal(progress.dots.length, 8);
  assert.equal(progress.dots[0].done, true);
  assert.equal(progress.dots[2].done, false);
  assert.equal(progress.reached, false);
});

test('buildFeedingProgress：plannedMeals 为 0 时回退默认顿数（新用户）', () => {
  const progress = buildFeedingProgress({ milkRecords: [], plannedMeals: 0 });
  assert.equal(progress.plannedMeals, DEFAULT_PLANNED_MEALS);
  assert.equal(DEFAULT_PLANNED_MEALS, 6);
});

test('buildFeedingProgress：参考过往记录，按最近记录日顿数不再被顶高', () => {
  const milkRecords = [
    { startTime: '08:00', nutritionSummary: { totalVolume: 110 } },
    { startTime: '11:00', nutritionSummary: { totalVolume: 120 } }
  ];
  const progress = buildFeedingProgress({ milkRecords, plannedMeals: 7 });
  assert.equal(progress.plannedMeals, 7); // 不再取 max
  assert.equal(progress.remaining, 5);
  assert.equal(progress.dots.length, 7);
});

test('buildNextMealReference：今日已喂2顿→对应上次第3顿配比', () => {
  const referenceMeals = [
    { startTime: '07:00', formulaComponents: [{ kind: 'breast_milk', volume: 50 }] },
    { startTime: '10:00', formulaComponents: [{ kind: 'breast_milk', volume: 55 }] },
    { startTime: '13:00', formulaComponents: [
      { kind: 'breast_milk', volume: 59 },
      { kind: 'formula_powder', powderName: '纽迪希亚特护', waterVolume: 61, proteinRole: 'special' }
    ] },
    { startTime: '16:00', formulaComponents: [{ kind: 'breast_milk', volume: 60 }] }
  ];
  const hint = buildNextMealReference({ referenceMeals, refDate: '2026-05-30', fedCount: 2 });
  assert.equal(hint.hasPlan, true);
  assert.equal(hint.seq, 3);
  assert.equal(hint.text, '母乳59ml + 纽迪希亚特护61ml');
  assert.equal(hint.total, 120);
  assert.equal(hint.exceeded, false);
  assert.equal(hint.refDate, '2026-05-30');
});

test('buildNextMealReference：乱序记录先按时间排序再取第N顿', () => {
  const referenceMeals = [
    { startTime: '13:00', formulaComponents: [{ kind: 'breast_milk', volume: 59 }] },
    { startTime: '07:00', formulaComponents: [{ kind: 'breast_milk', volume: 50 }] }
  ];
  // 今天还没喂（0顿）→ 下一顿是第1顿 → 取最早的 07:00 那顿
  const hint = buildNextMealReference({ referenceMeals, fedCount: 0 });
  assert.equal(hint.seq, 1);
  assert.equal(hint.text, '母乳50ml');
});

test('buildNextMealReference：今日已喂数超出上次顿数→落到末顿并标记 exceeded', () => {
  const referenceMeals = [
    { startTime: '07:00', formulaComponents: [{ kind: 'breast_milk', volume: 50 }] },
    { startTime: '10:00', formulaComponents: [{ kind: 'breast_milk', volume: 60 }] }
  ];
  const hint = buildNextMealReference({ referenceMeals, fedCount: 5 });
  assert.equal(hint.exceeded, true);
  assert.equal(hint.seq, 2);
  assert.equal(hint.text, '母乳60ml');
});

test('buildNextMealReference：无历史记录则无参考', () => {
  assert.equal(buildNextMealReference({ referenceMeals: [], fedCount: 0 }).hasPlan, false);
});

test('buildWeeklyTrend：补齐缺失天并归一化高度', () => {
  const summaries = [
    { date: '2026-05-31', basicInfo: { weight: 4.2 } },
    { date: '2026-06-01', basicInfo: { weight: 4.3 } },
    { date: '2026-06-02', basicInfo: { weight: 4.35 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'weight' });
  assert.equal(trend.points.length, 7);
  assert.equal(trend.points[6].isToday, true);
  assert.equal(trend.points[6].value, 4.35);
  assert.equal(trend.hasData, true);
  assert.equal(trend.filledDays, 3);
  assert.equal(trend.current, 4.35);
  assert.equal(trend.first, 4.2);
  assert.equal(trend.delta, round2(4.35 - 4.2));
  assert.equal(trend.avg, round2((4.2 + 4.3 + 4.35) / 3)); // 7天均值(仅有值的天)
  assert.equal(trend.points[0].heightPct, 0); // 缺失天
  assert.equal(trend.points[6].heightPct, 100); // 最大值
});

test('buildWeeklyTrend：includeToday=false 时窗口为 T-1~T-7，且当前取昨天（排除今天）', () => {
  const summaries = [
    { date: '2026-05-31', basicInfo: { weight: 4.2 } },
    { date: '2026-06-01', basicInfo: { weight: 4.3 } }, // T-1（昨天）
    { date: '2026-06-02', basicInfo: { weight: 9.9 } }  // 今天，应被排除
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'weight', includeToday: false });
  assert.equal(trend.points.length, 7);
  assert.equal(trend.points[0].date, '2026-05-26'); // 第一根 T-7
  assert.equal(trend.points[6].date, '2026-06-01'); // 最后一根 T-1（昨天）
  assert.equal(trend.points[6].isToday, false); // 没有“今天”这根
  assert.equal(trend.points.some((p) => p.date === '2026-06-02'), false); // 今天不在窗口
  assert.equal(trend.current, 4.3); // 当前=昨天，今天的 9.9 不取
  assert.equal(trend.filledDays, 2);
});

test('buildWeeklyTrend：totalProtein = 天然 + 特殊，单柱逐日，最近值取最近有数据天', () => {
  const summaries = [
    { date: '2026-06-01', macroSummary: { naturalProtein: 5.0, specialProtein: 10.0 }, recordCounts: { milk: 7, food: 0 } }, // T-1（昨天）
    { date: '2026-05-31', macroSummary: { naturalProtein: 4.6, specialProtein: 9.2 }, recordCounts: { milk: 7, food: 0 } }
  ];
  const trend = buildWeeklyTrend({
    summaries,
    todayKey: '2026-06-02',
    days: 7,
    metric: 'totalProtein',
    includeToday: false
  });
  assert.equal(trend.points.length, 7);
  assert.equal(trend.points[6].date, '2026-06-01'); // 最后一根=昨天
  assert.equal(trend.points[6].value, 15.0); // 5.0 + 10.0
  assert.equal(trend.current, 15.0); // 最近总蛋白
});

test('buildWeeklyTrend：每个 point 带当天体重（供「平均系数」逐日口径计算）', () => {
  const summaries = [
    { date: '2026-06-01', basicInfo: { weight: 4.3 }, macroSummary: { naturalProtein: 5.0, specialProtein: 10.0 }, recordCounts: { milk: 7, food: 0 } },
    { date: '2026-05-31', basicInfo: { weight: 4.2 }, macroSummary: { naturalProtein: 4.6, specialProtein: 9.2 }, recordCounts: { milk: 7, food: 0 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'totalProtein', includeToday: false });
  const p601 = trend.points.find((p) => p.date === '2026-06-01');
  const p531 = trend.points.find((p) => p.date === '2026-05-31');
  assert.equal(p601.weight, 4.3); // 当天体重，用于 平均系数=Σ值/Σ体重
  assert.equal(p531.weight, 4.2);
  // 无记录的天体重为 null
  assert.equal(trend.points.find((p) => p.date === '2026-05-30').weight, null);
});

test('weightedAverageCoefficient：平均系数 = Σ值/Σ体重，仅统计有值且有体重的天', () => {
  const points = [
    { hasValue: true, value: 5.0, weight: 4.3 },
    { hasValue: true, value: 4.6, weight: 4.2 },
    { hasValue: false, value: null, weight: 4.1 }, // 无值，不计
    { hasValue: true, value: 5.2, weight: 0 }      // 无体重，不计
  ];
  // (5.0 + 4.6) / (4.3 + 4.2) = 9.6 / 8.5
  assert.equal(weightedAverageCoefficient(points, 2), round2(9.6 / 8.5));
  // 等价于 平均值/平均体重
  assert.equal(weightedAverageCoefficient(points, 2), round2((9.6 / 2) / (8.5 / 2)));
  // 无有效天 -> null
  assert.equal(weightedAverageCoefficient([], 2), null);
  assert.equal(weightedAverageCoefficient([{ hasValue: true, value: 5, weight: 0 }], 2), null);
});

test('buildWeeklyTrend：天然蛋白为0但当天有喂奶记录时算有效数据点', () => {
  const summaries = [
    // 有喂奶记录但天然蛋白=0（纯特奶日）-> 应作为有效 0 点显示，而不是缺口
    { date: '2026-05-31', macroSummary: { naturalProtein: 0 }, recordCounts: { milk: 6, food: 0 } },
    { date: '2026-06-01', macroSummary: { naturalProtein: 4.8 }, recordCounts: { milk: 7, food: 0 } },
    // 完全没有摄入记录的天 -> 仍然是缺口
    { date: '2026-06-02', macroSummary: { naturalProtein: 0 }, recordCounts: { milk: 0, food: 0 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'naturalProtein' });
  const p531 = trend.points.find((p) => p.date === '2026-05-31');
  const p601 = trend.points.find((p) => p.date === '2026-06-01');
  const p602 = trend.points.find((p) => p.date === '2026-06-02');
  assert.equal(p531.hasValue, true); // 有记录的 0 -> 有效点
  assert.equal(p531.value, 0);
  assert.equal(p601.value, 4.8);
  assert.equal(p602.hasValue, false); // 无记录 -> 缺口
  assert.equal(trend.filledDays, 2);
});

test('buildWeeklyTrend：特殊蛋白指标读取 macroSummary.specialProtein', () => {
  const summaries = [
    { date: '2026-06-01', macroSummary: { specialProtein: 9.6 }, recordCounts: { milk: 7, food: 0 } },
    { date: '2026-06-02', macroSummary: { specialProtein: 10.2 }, recordCounts: { milk: 7, food: 0 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'specialProtein' });
  assert.equal(trend.current, 10.2);
  assert.equal(trend.delta, round2(10.2 - 9.6));
});

test('buildWeeklyTrend：总蛋白=天然+特殊', () => {
  const summaries = [
    { date: '2026-06-02', macroSummary: { naturalProtein: 5.22, specialProtein: 9.6 }, recordCounts: { milk: 7, food: 0 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'totalProtein' });
  const today = trend.points.find((p) => p.date === '2026-06-02');
  assert.equal(today.value, round2(5.22 + 9.6));
});

test('buildWeeklyTrend：热量取整显示', () => {
  const summaries = [
    { date: '2026-06-02', macroSummary: { calories: 657.4 }, recordCounts: { milk: 7, food: 0 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'calorie' });
  const today = trend.points.find((p) => p.date === '2026-06-02');
  assert.equal(today.value, 657); // 精度 0 -> 整数
});

test('buildWeeklyTrend：热量系数=总热量/体重，无体重则缺口', () => {
  const summaries = [
    { date: '2026-06-01', basicInfo: { weight: 4.35 }, macroSummary: { calories: 657 }, recordCounts: { milk: 7, food: 0 } },
    // 缺体重无法换算系数 -> 缺口
    { date: '2026-06-02', macroSummary: { calories: 700 }, recordCounts: { milk: 7, food: 0 } }
  ];
  const trend = buildWeeklyTrend({ summaries, todayKey: '2026-06-02', days: 7, metric: 'calPerKg' });
  const p601 = trend.points.find((p) => p.date === '2026-06-01');
  const p602 = trend.points.find((p) => p.date === '2026-06-02');
  assert.equal(p601.value, 151); // 657/4.35≈151，整数
  assert.equal(p602.hasValue, false); // 无体重 -> 缺口
});

test('metricDisplayPrecision：各指标精度', () => {
  assert.equal(metricDisplayPrecision('weight'), 2);
  assert.equal(metricDisplayPrecision('naturalProtein'), 2);
  assert.equal(metricDisplayPrecision('calorie'), 0);
  assert.equal(metricDisplayPrecision('calPerKg'), 0);
  assert.equal(metricDisplayPrecision('unknown'), 2); // 兜底
});

test('buildTimeline：合并各类记录并按时间倒序', () => {
  const timeline = buildTimeline({
    milkRecords: [
      { startTime: '08:00', nutritionSummary: { totalVolume: 110, calories: 73, naturalProtein: 0.8 } },
      { startTime: '11:05', nutritionSummary: { totalVolume: 120, calories: 80, naturalProtein: 0.6, specialProtein: 1.2 } }
    ],
    medicationRecords: [
      { actualTime: '08:12', medicationName: '左卡尼丁', dosage: '1.5', unit: 'ml' }
    ],
    foodIntakeRecords: [
      { recordTime: '09:30', name: '米粉', quantity: 30, unit: 'g' }
    ],
    treatmentRecords: [],
    limit: 3
  });

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].time, '11:05');
  assert.equal(timeline[0].type, 'milk');
  assert.equal(timeline[0].desc, '热量 80kcal · 天然蛋白 0.6g · 特殊蛋白 1.2g');
  assert.equal(timeline[1].time, '09:30');
  assert.equal(timeline[1].type, 'food');
  assert.equal(timeline[2].time, '08:12');
  assert.equal(timeline[2].type, 'med');
});

test('buildTimeline：真实字段（食物 recordedAt/nameSnapshot、治疗 startTime/groups）都进全部', () => {
  const timeline = buildTimeline({
    milkRecords: [{ startTime: '08:00', nutritionSummary: { totalVolume: 110, calories: 73 } }],
    foodIntakeRecords: [
      { recordedAt: '09:30', nameSnapshot: '米粉', quantity: 30, unit: 'g' }
    ],
    medicationRecords: [{ actualTime: '08:12', medicationName: '左卡尼丁', dosage: '1.5', unit: 'ml' }],
    treatmentRecords: [
      { startTime: '14:20', groups: [{ name: '静脉营养' }], notes: '门诊' }
    ],
    limit: 0
  });

  const byType = (t) => timeline.find((e) => e.type === t);
  assert.equal(timeline.length, 4);
  assert.equal(byType('milk').time, '08:00');
  assert.equal(byType('food').time, '09:30');
  assert.equal(byType('food').title, '辅食 · 食物记录');
  assert.equal(byType('food').desc, '含 1种食物');
  assert.equal(byType('med').time, '08:12');
  assert.equal(byType('treatment').time, '14:20');
  assert.equal(byType('treatment').title, '治疗 · 静脉营养');
});

test('buildTimeline：辅食按顿聚合并显示食物种类数', () => {
  const timeline = buildTimeline({
    foodIntakeRecords: [
      { _id: 'food-1', mealBatchId: 'meal-a', mealLabel: '早餐', mealTime: '09:30', nameSnapshot: '米粉', quantity: 30, unit: 'g' },
      { _id: 'food-2', mealBatchId: 'meal-a', mealLabel: '早餐', mealTime: '09:30', nameSnapshot: '苹果泥', quantity: 20, unit: 'g' },
      { _id: 'food-3', mealBatchId: 'meal-b', mealLabel: '午餐', mealTime: '12:10', nameSnapshot: '南瓜泥', quantity: 25, unit: 'g' }
    ],
    limit: 0
  });

  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].time, '12:10');
  assert.equal(timeline[0].title, '辅食 · 午餐');
  assert.equal(timeline[0].desc, '含 1种食物');
  assert.equal(timeline[1].time, '09:30');
  assert.equal(timeline[1].title, '辅食 · 早餐');
  assert.equal(timeline[1].desc, '含 2种食物');
});

test('buildTimeline：辅食摘要显示热量与天然/特殊蛋白，不显示具体食物名', () => {
  const timeline = buildTimeline({
    foodIntakeRecords: [
      {
        _id: 'food-1',
        mealBatchId: 'meal-a',
        mealLabel: '早餐',
        mealTime: '09:30',
        nameSnapshot: '米粉',
        nutrition: { calories: 40, protein: 1 },
        naturalProtein: 1,
        specialProtein: 0
      },
      {
        _id: 'food-2',
        mealBatchId: 'meal-a',
        mealLabel: '早餐',
        mealTime: '09:30',
        nameSnapshot: '特殊配方',
        nutrition: { calories: 30, protein: 0.5 },
        proteinSource: 'special'
      }
    ],
    limit: 0
  });

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].title, '辅食 · 早餐');
  assert.equal(timeline[0].desc, '含 2种食物 · 热量 70kcal · 天然蛋白 1g · 特殊蛋白 0.5g');
  assert.equal(timeline[0].desc.includes('米粉'), false);
  assert.equal(timeline[0].desc.includes('特殊配方'), false);
});

test('buildTimeline：大小便记录以事件类型进入时间轴', () => {
  const timeline = buildTimeline({
    milkRecords: [{ startTime: '08:00', nutritionSummary: { totalVolume: 100, calories: 67 } }],
    bowelRecords: [
      {
        type: 'stool',
        timeString: '10:20',
        color: 'yellow',
        consistency: 'soft',
        amount: 'medium'
      },
      {
        type: 'urine',
        timeString: '09:05',
        urineAmount: 'medium',
        urineColor: 'light_yellow'
      }
    ],
    limit: 0
  });

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].type, 'bowel');
  assert.equal(timeline[0].title, '大便');
  assert.equal(timeline[0].desc, '黄色 · 糊状 · 适量');
  assert.equal(timeline[1].type, 'bowel');
  assert.equal(timeline[1].title, '小便');
  assert.equal(timeline[1].desc, '尿量正常 · 淡黄');
  assert.equal(timeline[2].type, 'milk');
});

test('buildTimeline：时间字段为 Date / datetime 字符串时归一化为 HH:MM', () => {
  const timeline = buildTimeline({
    milkRecords: [{ startTime: '', startDateTime: new Date(2026, 5, 2, 7, 5) }],
    foodIntakeRecords: [{ recordedAt: '2026-06-02 16:45', nameSnapshot: '蛋黄' }],
    limit: 0
  });
  assert.equal(timeline.find((e) => e.type === 'milk').time, '07:05');
  assert.equal(timeline.find((e) => e.type === 'food').time, '16:45');
});
