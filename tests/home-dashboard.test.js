const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PLANNED_MEALS,
  parseMedicationFrequency,
  isScheduledToday,
  diffInDays,
  buildMedicationChecklist,
  buildNutritionGoals,
  buildNutritionSummary,
  buildFeedingProgress,
  buildRecentMealHint,
  buildWeeklyTrend,
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

test('buildFeedingProgress：plannedMeals 为 0 时回退默认 8', () => {
  const progress = buildFeedingProgress({ milkRecords: [], plannedMeals: 0 });
  assert.equal(progress.plannedMeals, DEFAULT_PLANNED_MEALS);
});

test('buildFeedingProgress：参考过往记录，6 顿不再被顶到 8', () => {
  const milkRecords = [
    { startTime: '08:00', nutritionSummary: { totalVolume: 110 } },
    { startTime: '11:00', nutritionSummary: { totalVolume: 120 } }
  ];
  const progress = buildFeedingProgress({ milkRecords, plannedMeals: 6 });
  assert.equal(progress.plannedMeals, 6); // 不再 max(6,8)
  assert.equal(progress.remaining, 4);
  assert.equal(progress.dots.length, 6);
});

test('buildRecentMealHint：用最近一顿真实配比展示（母乳+特奶，按来源名）', () => {
  const hint = buildRecentMealHint({
    startTime: '11:05',
    formulaComponents: [
      { kind: 'breast_milk', volume: 59 },
      { kind: 'formula_powder', powderName: '纽迪希亚特护', waterVolume: 61, proteinRole: 'special' }
    ]
  });
  assert.equal(hint.hasPlan, true);
  assert.equal(hint.text, '母乳59ml + 纽迪希亚特护61ml');
  assert.equal(hint.total, 120);
  assert.equal(hint.time, '11:05');
  assert.equal(hint.parts.length, 2);
});

test('buildRecentMealHint：奶粉无名称时按蛋白角色回退普奶/特奶，并按母乳→普奶→特奶排序', () => {
  const hint = buildRecentMealHint({
    startTime: '08:00',
    formulaComponents: [
      { kind: 'formula_powder', waterVolume: 40, proteinRole: 'special' },
      { kind: 'breast_milk', volume: 50 },
      { kind: 'formula_powder', waterVolume: 30, proteinRole: 'natural' }
    ]
  });
  assert.equal(hint.text, '母乳50ml + 普奶30ml + 特奶40ml');
  assert.equal(hint.total, 120);
});

test('buildRecentMealHint：无记录或无有效体积则无参考', () => {
  assert.equal(buildRecentMealHint(null).hasPlan, false);
  assert.equal(buildRecentMealHint({ formulaComponents: [{ kind: 'breast_milk', volume: 0 }] }).hasPlan, false);
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
      { startTime: '08:00', nutritionSummary: { totalVolume: 110, calories: 73 } },
      { startTime: '11:05', nutritionSummary: { totalVolume: 120, calories: 80 } }
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
  assert.equal(byType('food').title, '辅食 · 米粉');
  assert.equal(byType('med').time, '08:12');
  assert.equal(byType('treatment').time, '14:20');
  assert.equal(byType('treatment').title, '治疗 · 静脉营养');
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
