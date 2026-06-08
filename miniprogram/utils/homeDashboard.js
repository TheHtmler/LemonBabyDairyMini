/**
 * 首页看板纯计算工具
 *
 * 只做数据推导，不依赖小程序运行时（wx / getApp），方便单元测试。
 * 页面（pages/daily-feeding）通过 dailyRecordV2Service 取数后，把规范化数据交给这里
 * 组装成看板视图数据：营养达成 / 喂养进度 / 配奶建议 / 用药打卡 / 时间轴 / 周趋势。
 */

// 每日计划喂奶顿数：新用户（无历史记录）默认 6 顿；
// 有历史时仍以「最近记录日的顿数」为准（见 buildFeedingProgress）。
const DEFAULT_PLANNED_MEALS = 6;
// 默认天然蛋白摄入系数 g/kg/d（项目规则）
const DEFAULT_NATURAL_PROTEIN_COEFFICIENT = 1.2;

function toNumber(value, fallback = 0) {
  if (value === '' || value === undefined || value === null) {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return 0;
  }
  return Math.round(num);
}

function parseDateKey(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') {
    return null;
  }
  const parts = dateKey.split('-').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function diffInDays(fromKey, toKey) {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) {
    return null;
  }
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return 0;
  const parts = time.split(':').map((n) => parseInt(n, 10));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return 0;
  return parts[0] * 60 + parts[1];
}

/**
 * 解析药物服用频率，得到 { days: 周期天数, times: 每周期次数 }
 * 优先用结构化字段 frequencyDays / frequencyTimes，回退解析 frequency 文本。
 */
function parseMedicationFrequency(med = {}) {
  const days = parseInt(med.frequencyDays, 10);
  const times = parseInt(med.frequencyTimes, 10);
  if (Number.isFinite(days) && days > 0 && Number.isFinite(times) && times > 0) {
    return { days, times };
  }

  const text = String(med.frequency || '');
  let match = text.match(/每(\d+)[天日](\d+)次/);
  if (match) {
    return { days: parseInt(match[1], 10) || 1, times: parseInt(match[2], 10) || 1 };
  }
  match = text.match(/每日(\d+)次/);
  if (match) {
    return { days: 1, times: parseInt(match[1], 10) || 1 };
  }
  match = text.match(/每周(\d+)次/);
  if (match) {
    return { days: 7, times: parseInt(match[1], 10) || 1 };
  }
  match = text.match(/每月(\d+)次/);
  if (match) {
    return { days: 30, times: parseInt(match[1], 10) || 1 };
  }
  return { days: 1, times: 1 };
}

/**
 * 判断「隔日 / 隔 N 天」类药物今天是否轮到服用。
 * 每日类(days<=1)恒为 true；隔日类用最近一次服用日期推算（无历史则默认今天可服，
 * 让用户首次打卡自然建立锚点）。AD/D3 交替按各自「隔日1次」近似，自然错开。
 */
function isScheduledToday(med, todayKey, lastTakenDateKey) {
  const { days } = parseMedicationFrequency(med);
  if (days <= 1) {
    return true;
  }
  if (!lastTakenDateKey) {
    return true;
  }
  const diff = diffInDays(lastTakenDateKey, todayKey);
  if (diff === null) {
    return true;
  }
  return diff >= days;
}

/**
 * 构建今日用药打卡清单
 * @param {Object} params
 * @param {Array}  params.meds         药物定义列表（medicationsList）
 * @param {Array}  params.todayRecords 今日 medication_records
 * @param {Array}  params.history      过去若干天 [{ date, takenMedicationIds }]（不含今天）
 * @param {string} params.todayKey     今日日期键 YYYY-MM-DD
 */
function buildMedicationChecklist({ meds = [], todayRecords = [], history = [], todayKey = '' } = {}) {
  const takenCountById = {};
  const takenTimesById = {};
  (todayRecords || []).forEach((record) => {
    const id = record.medicationId || record.medicationName;
    if (!id) return;
    takenCountById[id] = (takenCountById[id] || 0) + 1;
    const time = record.actualTime || '';
    if (time) {
      (takenTimesById[id] = takenTimesById[id] || []).push(time);
    }
  });

  const lastTakenById = {};
  (history || []).forEach((entry) => {
    if (!entry || !entry.date || entry.date === todayKey) return;
    (entry.takenMedicationIds || []).forEach((id) => {
      if (!lastTakenById[id] || entry.date > lastTakenById[id]) {
        lastTakenById[id] = entry.date;
      }
    });
  });

  const items = (meds || []).map((med) => {
    const { days, times } = parseMedicationFrequency(med);
    const id = med._id || med.id || med.name;
    const scheduledToday = isScheduledToday(med, todayKey, lastTakenById[id]);
    const doneCount = takenCountById[id] || 0;
    const doseTotal = times;
    const remaining = scheduledToday ? Math.max(0, doseTotal - doneCount) : 0;
    const completed = scheduledToday ? doneCount >= doseTotal : true;

    let status = 'todo';
    if (!scheduledToday) {
      status = 'skip';
    } else if (doneCount >= doseTotal) {
      status = 'done';
    } else if (doneCount > 0) {
      status = 'partial';
    }

    const times24 = (takenTimesById[id] || []).slice().sort();
    // 多次药的进度点（避免在 WXML 里对数字做 wx:for，统一给数组）
    const dosePips = [];
    for (let s = 0; s < doseTotal; s += 1) {
      dosePips.push({ on: s < doneCount });
    }

    return {
      medicationId: med._id || med.id || '',
      name: med.name || '',
      dosage: med.dosage,
      unit: med.unit || '',
      frequencyText: med.frequency || '',
      periodDays: days,
      doseCount: doneCount,
      doseTotal,
      dosePips,
      remaining,
      scheduledToday,
      completed,
      status,
      times: times24,
      lastTakenTime: times24.length ? times24[times24.length - 1] : ''
    };
  });

  const todayItems = items.filter((item) => item.scheduledToday);
  const doneCount = todayItems.filter((item) => item.completed).length;
  const pending = todayItems.filter((item) => !item.completed).length;

  return {
    items,
    todayItems,
    doneCount,
    totalCount: todayItems.length,
    allDone: todayItems.length > 0 && doneCount === todayItems.length,
    hasPending: pending > 0,
    hasPlan: todayItems.length > 0
  };
}

function buildGoal(actual, target, precision = 2) {
  const actualValue = round(actual, precision);
  const targetValue = round(target, precision);
  const hasTarget = targetValue > 0;
  // 百分比用原值计算，避免取整后精度损失
  const pct = hasTarget ? clampPercent((round(actual, 2) / round(target, 2)) * 100) : 0;
  return {
    actual: actualValue,
    target: targetValue,
    pct,
    barPct: Math.min(100, pct),
    over: hasTarget && round(actual, 2) > round(target, 2),
    reached: hasTarget && round(actual, 2) >= round(target, 2),
    hasTarget
  };
}

/**
 * 构建今日营养达成
 * 天然蛋白目标 = 系数(默认1.2) × 体重；特殊蛋白 / 热量目标在配置了对应系数时才计算。
 */
function buildNutritionGoals({ macroSummary = {}, weight = 0, coefficients = {} } = {}) {
  const w = toNumber(weight, 0);
  const naturalCoef = toNumber(coefficients.natural, DEFAULT_NATURAL_PROTEIN_COEFFICIENT) || DEFAULT_NATURAL_PROTEIN_COEFFICIENT;
  const specialCoef = toNumber(coefficients.special, 0);
  const calorieCoef = toNumber(coefficients.calorie, 0);

  const naturalTarget = w > 0 ? naturalCoef * w : 0;
  const specialTarget = w > 0 && specialCoef > 0 ? specialCoef * w : 0;
  const calorieTarget = w > 0 && calorieCoef > 0 ? calorieCoef * w : 0;

  const calories = toNumber(macroSummary.calories, 0);

  return {
    naturalProtein: buildGoal(toNumber(macroSummary.naturalProtein, 0), naturalTarget),
    specialProtein: buildGoal(toNumber(macroSummary.specialProtein, 0), specialTarget),
    calorie: buildGoal(calories, calorieTarget, 0),
    caloriesPerKg: w > 0 ? round(calories / w, 0) : 0,
    weight: w
  };
}

function normalizeTargetMode(mode) {
  return mode === 'calorie' ? 'calorie' : 'protein';
}

function isProteinTargetConfigured(targetPreferences = {}) {
  return toNumber(targetPreferences.naturalProteinCoefficient, 0) > 0
    && toNumber(targetPreferences.specialProteinCoefficient, 0) > 0;
}

function isCalorieTargetConfigured(targetPreferences = {}) {
  return toNumber(targetPreferences.calorieCoefficient, 0) > 0;
}

function resolveActiveTargetMode(targetPreferences = {}, configuredModes = {}) {
  const preferred = normalizeTargetMode(targetPreferences.preferredTargetMode);
  if (configuredModes[preferred]) {
    return preferred;
  }
  if (configuredModes.calorie && !configuredModes.protein) {
    return 'calorie';
  }
  if (configuredModes.protein) {
    return 'protein';
  }
  return 'actual';
}

function buildGoalProgressMeta(goal) {
  if (!goal || !goal.hasTarget) {
    return {
      status: 'unset',
      statusText: '先设置目标',
      helperText: '设置目标后可查看完成度',
      remainingLabel: '还差',
      overflowText: '',
      ringPct: 0,
      overPct: 0,
      ringClass: 'pending'
    };
  }

  if (goal.over) {
    const overPct = Math.max(0, goal.pct - 100);
    return {
      status: 'over',
      statusText: `超出 ${overPct}%`,
      helperText: '已超过今日目标，后续记录注意控制',
      remainingLabel: '超出',
      overflowText: `超出 ${overPct}%`,
      ringPct: 100,
      overPct: Math.min(100, overPct),
      ringClass: 'over'
    };
  }

  if (goal.reached) {
    return {
      status: 'done',
      statusText: '已达成',
      helperText: '今天目标刚好达成，继续保持',
      remainingLabel: '还差',
      overflowText: '',
      ringPct: 100,
      overPct: 0,
      ringClass: 'done'
    };
  }

  return {
    status: 'pending',
    statusText: `还差 ${100 - goal.pct}%`,
    helperText: '距离今日目标还有一点点',
    remainingLabel: '还差',
    overflowText: '',
    ringPct: goal.barPct,
    overPct: 0,
    ringClass: 'pending'
  };
}

function buildTargetRow(key, label, goal, unit, tone = '') {
  const remaining = Math.max(0, round(goal.target - goal.actual, unit === 'kcal' ? 0 : 1));
  const overAmount = Math.max(0, round(goal.actual - goal.target, unit === 'kcal' ? 0 : 1));
  const meta = buildGoalProgressMeta(goal);
  return {
    key,
    label,
    tone,
    valueText: `${goal.actual}${unit}`,
    targetText: goal.hasTarget ? `${goal.target}${unit}` : '',
    remainingText: goal.hasTarget ? `${goal.over ? overAmount : remaining}${unit}` : '',
    remainingLabel: meta.remainingLabel,
    pctText: goal.hasTarget ? `${goal.pct}%` : '',
    status: meta.status,
    statusText: meta.statusText,
    helperText: meta.helperText,
    overPct: meta.overPct,
    ringClass: meta.ringClass,
    subText: goal.hasTarget ? `${goal.actual}/${goal.target}${unit}` : `${goal.actual}${unit}`,
    pct: goal.pct,
    barPct: goal.barPct,
    hasTarget: goal.hasTarget,
    reached: goal.reached,
    over: goal.over
  };
}

/**
 * 首页今日目标状态。
 * 未设置目标时返回 actual 模式，保证线上老用户仍只看到实际摄入。
 */
function buildNutritionTargetState({ macroSummary = {}, weight = 0, targetPreferences = {} } = {}) {
  const actual = buildNutritionSummary({ macroSummary, weight });
  const w = toNumber(weight, 0);
  const naturalCoef = toNumber(targetPreferences.naturalProteinCoefficient, 0);
  const specialCoef = toNumber(targetPreferences.specialProteinCoefficient, 0);
  const calorieCoef = toNumber(targetPreferences.calorieCoefficient, 0);
  const configuredModes = {
    protein: isProteinTargetConfigured(targetPreferences),
    calorie: isCalorieTargetConfigured(targetPreferences)
  };
  const hasAnyTarget = configuredModes.protein || configuredModes.calorie;
  const mode = resolveActiveTargetMode(targetPreferences, configuredModes);

  const naturalTarget = configuredModes.protein && w > 0 ? naturalCoef * w : 0;
  const specialTarget = configuredModes.protein && w > 0 ? specialCoef * w : 0;
  const calorieTarget = configuredModes.calorie && w > 0 ? calorieCoef * w : 0;
  const proteinActual = toNumber(macroSummary.naturalProtein, 0) + toNumber(macroSummary.specialProtein, 0);

  const protein = {
    total: buildGoal(proteinActual, naturalTarget + specialTarget, 1),
    natural: buildGoal(toNumber(macroSummary.naturalProtein, 0), naturalTarget, 1),
    special: buildGoal(toNumber(macroSummary.specialProtein, 0), specialTarget, 1),
    hasTarget: configuredModes.protein
  };
  const calorie = {
    ...buildGoal(toNumber(macroSummary.calories, 0), calorieTarget, 0),
    perKg: actual.caloriesPerKg,
    hasTarget: configuredModes.calorie
  };
  const activeGoal = mode === 'protein' ? protein.total : (mode === 'calorie' ? calorie : null);
  const activeMeta = buildGoalProgressMeta(activeGoal);
  const rows = mode === 'protein'
    ? [
      buildTargetRow('naturalProtein', '天然蛋白', protein.natural, 'g', 'nat'),
      buildTargetRow('specialProtein', '特殊蛋白', protein.special, 'g', 'spe')
    ]
    : (mode === 'calorie'
      ? [
        buildTargetRow('calorie', '热量', calorie, 'kcal', 'cal')
      ]
      : []);

  return {
    mode,
    hasAnyTarget,
    configuredModes,
    actual,
    activeGoal: activeGoal ? {
      ...activeGoal,
      ...activeMeta,
      label: mode === 'protein' ? '总蛋白' : '热量',
      unit: mode === 'protein' ? 'g' : 'kcal',
      valueText: `${activeGoal.actual}${mode === 'protein' ? 'g' : 'kcal'}`,
      targetText: `${activeGoal.target}${mode === 'protein' ? 'g' : 'kcal'}`,
      actualText: `已摄入 ${activeGoal.actual}${mode === 'protein' ? 'g' : 'kcal'}`,
      goalText: `目标 ${activeGoal.target}${mode === 'protein' ? 'g' : 'kcal'}`
    } : null,
    protein,
    calorie,
    rows,
    setupCtaText: hasAnyTarget ? '设置目标' : '设置目标'
  };
}

/**
 * 构建今日营养「实际摄入」概览（暂不做目标/达成率，仅展示实际值）
 * 热量取整；蛋白保留 1 位小数；各系数 = 对应摄入量 / 体重（无体重则为 0）。
 * 蛋白系数保留 2 位（量级如 1.20 g/kg），热量系数取整（如 151 kcal/kg）。
 */
function buildNutritionSummary({ macroSummary = {}, weight = 0 } = {}) {
  const w = toNumber(weight, 0);
  const naturalProtein = toNumber(macroSummary.naturalProtein, 0);
  const specialProtein = toNumber(macroSummary.specialProtein, 0);
  const totalProtein = naturalProtein + specialProtein;
  const calories = toNumber(macroSummary.calories, 0);
  const perKg = (value, precision) => (w > 0 ? round(value / w, precision) : 0);
  return {
    calories: round(calories, 0),
    caloriesPerKg: perKg(calories, 0),
    naturalProtein: round(naturalProtein, 1),
    naturalProteinPerKg: perKg(naturalProtein, 2),
    specialProtein: round(specialProtein, 1),
    specialProteinPerKg: perKg(specialProtein, 2),
    totalProtein: round(totalProtein, 1),
    totalProteinPerKg: perKg(totalProtein, 2),
    weight: w
  };
}

/**
 * 单条 v2 喂奶记录的奶量与母乳/特奶拆分
 */
function milkRecordVolumes(record = {}) {
  const summary = record.nutritionSummary || {};
  const components = Array.isArray(record.formulaComponents) ? record.formulaComponents : [];

  let breast = 0;
  let special = 0;
  components.forEach((component = {}) => {
    if (component.kind === 'breast_milk') {
      breast += toNumber(component.volume, 0);
    } else if (component.kind === 'formula_powder') {
      const vol = toNumber(component.waterVolume, 0);
      if (component.proteinRole === 'special') {
        special += vol;
      } else {
        breast += vol;
      }
    }
  });

  let total = toNumber(summary.totalVolume, 0);
  if (total <= 0) {
    total = breast + special;
  }
  return { total, breast, special };
}

/**
 * 构建今日喂养进度
 * @param {Object} params
 * @param {Array}  params.milkRecords 今日 v2 喂奶记录（规范化后，含 startTime / nutritionSummary）
 * @param {number} params.plannedMeals 计划顿数（0/缺省回退到默认 6）
 */
function buildFeedingProgress({ milkRecords = [], plannedMeals = 0 } = {}) {
  const records = milkRecords || [];
  // 顿数参考过往记录：用最近记录日的顿数；无历史(0)才回退默认 6（新用户）。
  // 不再取 max（否则每天 6-7 顿也会被顶高，与配奶规划口径不一致）。
  const parsedPlanned = parseInt(plannedMeals, 10) || 0;
  const planned = parsedPlanned > 0 ? parsedPlanned : DEFAULT_PLANNED_MEALS;
  const count = records.length;

  let totalVolume = 0;
  let breastVolume = 0;
  let specialVolume = 0;
  let lastMealTime = '';
  let lastMinutes = -1;

  records.forEach((record) => {
    const { total, breast, special } = milkRecordVolumes(record);
    totalVolume += total;
    breastVolume += breast;
    specialVolume += special;
    const minutes = timeToMinutes(record.startTime);
    if (minutes >= lastMinutes) {
      lastMinutes = minutes;
      lastMealTime = record.startTime || lastMealTime;
    }
  });

  const dots = [];
  const dotTotal = Math.max(planned, count);
  for (let i = 0; i < dotTotal; i += 1) {
    dots.push({ index: i + 1, done: i < count });
  }

  return {
    count,
    plannedMeals: planned,
    remaining: Math.max(0, planned - count),
    totalVolume: round(totalVolume, 0),
    breastVolume: round(breastVolume, 0),
    specialVolume: round(specialVolume, 0),
    lastMealTime,
    reached: count >= planned,
    dots
  };
}

// 从单条喂奶记录拆出真实来源配比（母乳取 volume、奶粉取冲调后 waterVolume），
// 按 母乳→普奶→特奶 排序，用真实来源名展示。
function extractMealParts(record) {
  const components = record && Array.isArray(record.formulaComponents) ? record.formulaComponents : [];
  const parts = [];
  components.forEach((component = {}) => {
    if (component.kind === 'breast_milk') {
      const volume = round(toNumber(component.volume, 0), 0);
      if (volume > 0) parts.push({ name: '母乳', volume, order: 0 });
    } else if (component.kind === 'formula_powder') {
      const volume = round(toNumber(component.waterVolume, 0), 0);
      if (volume > 0) {
        const isSpecial = component.proteinRole === 'special';
        const name = component.powderName || (isSpecial ? '特奶' : '普奶');
        parts.push({ name, volume, order: isSpecial ? 2 : 1 });
      }
    }
  });
  parts.sort((a, b) => a.order - b.order);
  return parts.map((p) => ({ name: p.name, volume: p.volume }));
}

/**
 * 「下一顿参考」：按今天已喂顿数对应到上次（最近历史日）同序号那一顿的真实配比。
 * 例：上次一天 4 顿，今天已喂 2 顿 → 下一顿是第 3 顿 → 取上次那天第 3 顿展示。
 * @param {Array}  referenceMeals 上次那天的全部喂奶记录
 * @param {string} refDate        上次那天的日期（YYYY-MM-DD）
 * @param {number} fedCount       今天已喂顿数
 */
function buildNextMealReference({ referenceMeals = [], refDate = '', fedCount = 0 } = {}) {
  const meals = (referenceMeals || [])
    .filter((record) => record)
    .slice()
    .sort((a, b) => (
      timeToMinutes(resolveTimeLabel(a.startTime, a.startDateTime))
      - timeToMinutes(resolveTimeLabel(b.startTime, b.startDateTime))
    ));

  if (!meals.length) {
    return { hasPlan: false, parts: [], text: '', total: 0, seq: 0, refDate: '', exceeded: false };
  }

  const fed = Math.max(0, parseInt(fedCount, 10) || 0);
  // 下一顿序号 = 已喂 + 1（0-based 索引即 fed）；超出上次顿数则落到末顿。
  const exceeded = fed >= meals.length;
  const idx = Math.min(fed, meals.length - 1);
  const meal = meals[idx];
  const seq = idx + 1;
  const parts = extractMealParts(meal);

  if (!parts.length) {
    return { hasPlan: false, parts: [], text: '', total: 0, seq, refDate, exceeded };
  }

  const total = parts.reduce((sum, p) => sum + p.volume, 0);
  return {
    hasPlan: true,
    parts,
    text: parts.map((p) => `${p.name}${p.volume}ml`).join(' + '),
    total: round(total, 0),
    seq,
    refDate,
    exceeded
  };
}

// 趋势各指标的显示精度（小数位）
const TREND_METRIC_PRECISION = {
  weight: 2,
  naturalProtein: 2,
  specialProtein: 2,
  totalProtein: 2,
  calorie: 0,
  calPerKg: 0
};

function metricDisplayPrecision(metric) {
  return Object.prototype.hasOwnProperty.call(TREND_METRIC_PRECISION, metric)
    ? TREND_METRIC_PRECISION[metric]
    : 2;
}

/**
 * 读取某日某指标的值。
 * 返回 null 表示「当天没有记录」（趋势留空），返回 0 表示「有记录但该项恰好为 0」（画 0 高度小柱）。
 * 支持：weight / naturalProtein / specialProtein / totalProtein / calorie / calPerKg。
 */
function readMetric(summary, metric) {
  if (!summary) return null;
  const basic = summary.basicInfo || {};
  const macro = summary.macroSummary || {};
  const counts = summary.recordCounts || {};
  // 当天若确有喂奶/食物记录，0 是有效数据点（例如纯特奶日天然蛋白=0），
  // 应画一根 0 高度的小柱而不是留空，避免和数据记录页“当天有数据”不一致。
  const hasIntake = toNumber(counts.milk, 0) + toNumber(counts.food, 0) > 0;

  if (metric === 'weight') {
    const w = toNumber(basic.weight, 0);
    return w > 0 ? w : null;
  }

  if (metric === 'calPerKg') {
    // 热量系数 = 总热量 / 体重，缺体重无法换算
    const w = toNumber(basic.weight, 0);
    if (w <= 0) return null;
    const calories = toNumber(macro.calories, 0);
    if (calories > 0) return calories / w;
    return hasIntake ? 0 : null;
  }

  let value;
  if (metric === 'totalProtein') {
    value = toNumber(macro.naturalProtein, 0) + toNumber(macro.specialProtein, 0);
  } else if (metric === 'calorie') {
    value = toNumber(macro.calories, 0);
  } else {
    // naturalProtein / specialProtein
    value = toNumber(macro[metric], 0);
  }
  if (value > 0) return value;
  return hasIntake ? 0 : null;
}

/**
 * 构建近 N 天趋势（迷你柱状）
 * @param {Object} params
 * @param {Array}  params.summaries daily_summary_v2 列表 [{ date, basicInfo, macroSummary }]
 * @param {string} params.todayKey  今日日期键
 * @param {number} params.days      天数，默认 7
 * @param {string} params.metric    weight|naturalProtein|specialProtein|totalProtein|calorie|calPerKg
 * @param {boolean} params.includeToday 是否把今天计入窗口。
 *        true  → 窗口 [今天-(days-1) … 今天]（最后一根是今天）；
 *        false → 窗口 [今天-days … 今天-1]（只看已完成的天，最后一根是昨天）。
 */
function buildWeeklyTrend({ summaries = [], todayKey = '', days = 7, metric = 'weight', includeToday = true } = {}) {
  const precision = metricDisplayPrecision(metric);
  const today = parseDateKey(todayKey) || new Date();
  const byDate = {};
  (summaries || []).forEach((summary) => {
    if (summary && summary.date) {
      byDate[summary.date] = summary;
    }
  });

  const points = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    // 不含今天时整体往前挪一天：i=0 对应昨天(T-1)，i=days-1 对应 T-days。
    const offset = includeToday ? i : i + 1;
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = formatDateKey(d);
    const value = readMetric(byDate[key], metric);
    points.push({
      date: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      isToday: includeToday && i === 0,
      value: value === null ? null : round(value, precision),
      hasValue: value !== null,
      weight: readMetric(byDate[key], 'weight') // 当天体重，用于「系数=量/当天体重」逐日口径
    });
  }

  const values = points.filter((p) => p.hasValue).map((p) => p.value);
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const span = max - min;

  points.forEach((point) => {
    if (!point.hasValue) {
      point.heightPct = 0;
      return;
    }
    point.heightPct = span > 0
      ? Math.round(18 + ((point.value - min) / span) * 82)
      : 60;
  });

  const firstValue = values.length ? values[0] : 0;
  const lastValue = values.length ? values[values.length - 1] : 0;
  const avgValue = values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : 0;

  return {
    metric,
    points,
    max: round(max, precision),
    min: round(min, precision),
    avg: values.length ? round(avgValue, precision) : null,
    current: values.length ? round(lastValue, precision) : null,
    first: round(firstValue, precision),
    delta: round(lastValue - firstValue, precision),
    hasData: values.length > 0,
    filledDays: values.length
  };
}

/**
 * 近 N 天「平均系数」= Σ(各天值) / Σ(各天体重)，只统计「既有该项值、又有体重」的天。
 * 等价于 平均值/平均体重，按天总量加权，符合「总摄入 / 总体重」的直觉。
 * @param {Array}  points    buildWeeklyTrend 的 points（含 hasValue/value/weight）
 * @param {number} precision 小数位
 */
function weightedAverageCoefficient(points = [], precision = 2) {
  const valid = (points || []).filter((p) => p && p.hasValue && Number(p.weight) > 0);
  if (!valid.length) return null;
  const sumValue = valid.reduce((s, p) => s + p.value, 0);
  const sumWeight = valid.reduce((s, p) => s + p.weight, 0);
  return sumWeight > 0 ? round(sumValue / sumWeight, precision) : null;
}

function pushEvent(list, event) {
  if (!event || !event.time) return;
  list.push({
    type: event.type || 'event',
    time: event.time,
    title: event.title || '',
    desc: event.desc || '',
    sortValue: timeToMinutes(event.time)
  });
}

function formatHourMinute(date) {
  const h = `${date.getHours()}`.padStart(2, '0');
  const m = `${date.getMinutes()}`.padStart(2, '0');
  return `${h}:${m}`;
}

// 兼容各类记录的时间字段：可能是 "HH:MM" 字符串、ISO/日期时间字符串、Date 或时间戳，
// 统一归一化为 "HH:MM"。找不到有效时间则返回空串（pushEvent 会丢弃无时间事件）。
function resolveTimeLabel(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
      if (match) {
        return `${match[1].padStart(2, '0')}:${match[2]}`;
      }
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) return formatHourMinute(parsed);
      continue;
    }
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    if (!Number.isNaN(date.getTime())) return formatHourMinute(date);
  }
  return '';
}

/**
 * 合并今日各类记录为时间轴（倒序，最近在前）
 * @param {Object} params
 * @param {Array}  params.milkRecords        v2 喂奶记录
 * @param {Array}  params.foodIntakeRecords  食物记录
 * @param {Array}  params.medicationRecords  用药记录
 * @param {Array}  params.treatmentRecords   治疗记录
 * @param {number} params.limit              最多条数（0=不限制）
 */
function buildTimeline({ milkRecords = [], foodIntakeRecords = [], medicationRecords = [], treatmentRecords = [], limit = 0 } = {}) {
  const events = [];

  (milkRecords || []).forEach((record = {}) => {
    const { total } = milkRecordVolumes(record);
    const calories = toNumber((record.nutritionSummary || {}).calories, 0);
    pushEvent(events, {
      type: 'milk',
      time: resolveTimeLabel(record.startTime, record.startDateTime),
      title: `喂奶 · ${round(total, 0)}ml`,
      desc: calories > 0 ? `热量 ${round(calories, 0)}kcal` : ''
    });
  });

  (foodIntakeRecords || []).forEach((record = {}) => {
    // 食物存于旧版 intakes：时间字段是 recordedAt，名称是 nameSnapshot
    const name = record.nameSnapshot || record.foodName || record.name || '辅食';
    const quantity = record.quantity || record.amount;
    const unit = record.unit || 'g';
    pushEvent(events, {
      type: 'food',
      time: resolveTimeLabel(record.recordedAt, record.recordTime, record.time, record.mealTime),
      title: `辅食 · ${name}`,
      desc: quantity ? `${quantity}${unit}` : ''
    });
  });

  (medicationRecords || []).forEach((record = {}) => {
    pushEvent(events, {
      type: 'med',
      time: resolveTimeLabel(record.actualTime, record.actualDateTime),
      title: `用药 · ${record.medicationName || ''}`,
      desc: record.dosage ? `${record.dosage}${record.unit || ''}` : ''
    });
  });

  (treatmentRecords || []).forEach((record = {}) => {
    // 治疗记录无 treatmentName，取首个分组名/类型作为标题；时间字段是 startTime
    const firstGroupName = Array.isArray(record.groups) && record.groups[0] ? record.groups[0].name : '';
    const name = record.treatmentName || firstGroupName || record.name || record.title || '治疗';
    pushEvent(events, {
      type: 'treatment',
      time: resolveTimeLabel(record.startTime, record.actualTime, record.startDateTime, record.time),
      title: `治疗 · ${name}`,
      desc: record.notes || ''
    });
  });

  events.sort((a, b) => b.sortValue - a.sortValue);
  if (limit && limit > 0) {
    return events.slice(0, limit);
  }
  return events;
}

module.exports = {
  DEFAULT_PLANNED_MEALS,
  toNumber,
  round,
  parseDateKey,
  formatDateKey,
  diffInDays,
  timeToMinutes,
  parseMedicationFrequency,
  isScheduledToday,
  buildMedicationChecklist,
  buildNutritionGoals,
  buildNutritionTargetState,
  buildNutritionSummary,
  buildFeedingProgress,
  buildNextMealReference,
  buildWeeklyTrend,
  weightedAverageCoefficient,
  metricDisplayPrecision,
  buildTimeline,
  milkRecordVolumes
};
