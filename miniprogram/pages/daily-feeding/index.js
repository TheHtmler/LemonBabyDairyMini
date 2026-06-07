// 首页（今日概览看板）
// 取数统一走 dailyRecordV2Service（与「数据记录」页同源，天然兼容 v1/v2：喂奶 v2、食物过渡期 legacy）。
const MedicationRecordModel = require('../../models/medicationRecord');
const MedicationModel = require('../../models/medication');
const FeedingRecordV2Model = require('../../models/feedingRecordV2');
const DailySummaryV2Model = require('../../models/dailySummaryV2');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const {
  waitForAppInitialization,
  checkUserPermission,
  getBabyInfo,
  getBabyUid,
  handleError,
  utils,
  validation
} = require('../../utils/index');
const dashboard = require('../../utils/homeDashboard');

const app = getApp();

const TREND_DAYS = 7;

// 近7天趋势可切换的指标（数据均来自 daily_summary_v2）
// 蛋白拆成 总/天然/特殊 三个独立单柱 tab，保证每天数值都标得清楚；
// 有系数副指标的（热量/三种蛋白）柱状画“量”，脚注同屏给出对应“系数”。
const TREND_METRICS = [
  { key: 'calorie', label: '热量', unit: 'kcal', secondary: { unit: 'kcal/kg', precision: 0 } },
  { key: 'totalProtein', label: '总蛋白', unit: 'g', secondary: { unit: 'g/kg', precision: 2 } },
  { key: 'naturalProtein', label: '天然蛋白', unit: 'g', secondary: { unit: 'g/kg', precision: 2 } },
  { key: 'specialProtein', label: '特殊蛋白', unit: 'g', secondary: { unit: 'g/kg', precision: 2 } },
  { key: 'weight', label: '体重', unit: 'kg' }
];

function trendMetricMeta(key) {
  return TREND_METRICS.find((m) => m.key === key) || TREND_METRICS[0];
}

// 趋势脚注三块：统一展示「最低 / 平均 / 最高」（针对窗口 T-1~T-7 内有记录的天）。
// 热量/三种蛋白额外在「平均」格下方给出「平均系数」——口径③：近7天 Σ值 / Σ体重
// （= 平均值/平均体重，按天总量加权，即「总摄入 / 总体重」）。
function buildTrendStats(metricKey, weeklyTrend = {}) {
  const meta = trendMetricMeta(metricKey);
  const hasData = !!weeklyTrend.hasData;
  const avg = hasData ? weeklyTrend.avg : null;
  const min = hasData ? weeklyTrend.min : null;
  const max = hasData ? weeklyTrend.max : null;
  const fmt = (v) => (v === null || v === undefined ? '--' : v);

  const secondary = !!meta.secondary;
  const avgCoef = secondary
    ? dashboard.weightedAverageCoefficient(weeklyTrend.points, meta.secondary.precision)
    : null;

  // coefRow 让三格都占住「系数行」高度，避免只有「平均」格变高导致标签错位。
  const mkItem = (value, label, coef) => {
    const it = { n: fmt(value), u: meta.unit, l: label };
    if (secondary) {
      it.coefRow = true;
      it.c = coef === undefined ? '' : fmt(coef);
      it.cu = meta.secondary.unit;
    }
    return it;
  };
  return [
    mkItem(min, '最低'),
    mkItem(avg, '平均', avgCoef),
    mkItem(max, '最高')
  ];
}

// 今日时间轴分类切换
const TIMELINE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'milk', label: '喂奶' },
  { key: 'food', label: '辅食' },
  { key: 'med', label: '用药' },
  { key: 'treatment', label: '治疗' }
];
const TIMELINE_DISPLAY_LIMIT = 12;

// 把 "HH:MM" 拼到「今天」得到一个 Date（用于打卡记录的 actualDateTime）
function timeStrToToday(timeStr) {
  const now = new Date();
  const [h, m] = String(timeStr || '').split(':').map(Number);
  const d = new Date(now);
  if (Number.isFinite(h)) d.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function filterTimeline(events, category) {
  const list = (events || []).filter((e) => (category === 'all' ? true : e.type === category));
  return TIMELINE_DISPLAY_LIMIT > 0 ? list.slice(0, TIMELINE_DISPLAY_LIMIT) : list;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function shiftDateKey(baseKey, deltaDays) {
  const [y, m, d] = baseKey.split('-').map(Number);
  const date = new Date(y, m - 1, d + deltaDays);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function buildGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，注意休息～';
  if (hour < 11) return '早上好，今天也要好好记录哦';
  if (hour < 14) return '中午好，别忘了午间这顿奶';
  if (hour < 18) return '下午好，宝宝今天怎么样？';
  return '晚上好，回顾下今天的喂养吧';
}

function normalizeGenderText(gender) {
  if (gender === 'male' || gender === '男' || gender === '男孩') return '男孩';
  if (gender === 'female' || gender === '女' || gender === '女孩') return '女孩';
  return '';
}

// 性别配色 class：男孩蓝、女孩粉（修复此前标签写死粉色的问题）
function genderClass(gender) {
  if (gender === 'male' || gender === '男' || gender === '男孩') return 'male';
  if (gender === 'female' || gender === '女' || gender === '女孩') return 'female';
  return '';
}

Page({
  data: {
    app: null,
    todayDate: '',
    greetingText: buildGreeting(),
    // 仅创建者可见的入口（如「数据共享」）
    isCreator: false,

    // 宝宝信息
    babyName: '',
    babyAvatarUrl: '/images/LemonLogo.png',
    babyGender: '',
    babyGenderClass: '',
    babyBirthdayText: '',
    babyAgeMonthsText: '',
    babyDays: 0,

    // 体重 / 身高
    weight: '',
    height: '',
    showWeightModal: false,
    weightInput: '',
    showHeightModal: false,
    heightInput: '',

    // 今日营养（实际摄入，暂不做目标/达成率）
    nutrition: { calories: 0, caloriesPerKg: 0, naturalProtein: 0, specialProtein: 0, totalProtein: 0 },

    // 喂养
    feedingProgress: { count: 0, plannedMeals: dashboard.DEFAULT_PLANNED_MEALS, totalVolume: 0, remaining: dashboard.DEFAULT_PLANNED_MEALS, lastMealTime: '', dots: [] },
    feedingPlanHint: { hasPlan: false, parts: [], text: '', total: 0, seq: 0, refDate: '', exceeded: false },
    medUndo: { visible: false, name: '', time: '', recordId: '', localId: '' },
    medPanel: { visible: false, medicationId: '', name: '', meta: '', doseCount: 0, doseTotal: 0, entries: [] },
    foodCount: 0,

    // 用药
    medicationsList: [],
    medicationChecklist: { items: [], todayItems: [], doneCount: 0, totalCount: 0, allDone: false, hasPending: false },

    // 时间轴 & 趋势
    timeline: [],
    hasTimeline: false,
    timelineTabs: TIMELINE_TABS,
    timelineCategory: 'all',
    trendMetrics: TREND_METRICS,
    trendMetric: 'calorie',
    trendStats: [],
    weeklyTrend: { points: [], current: null, delta: 0 },

    // 记录用药弹窗
    modals: { medication: false },
    selectedMedication: null,
    selectedMedicationInfo: null,
    selectedMedicationIndex: 0,
    currentModalTime: '',
    currentModalDateTime: null,
    currentModalDosage: '',
    currentModalNotes: '',

    // 公告
    releaseNoticeVisible: true,
    releaseNoticeText: '看板已升级：聚焦今日营养达成、喂养进度与用药打卡，明细请到「数据记录」查看。',

    // 入场动画开关（每次 onShow 重置以重播）
    animReady: false
  },

  onLoad() {
    this.rangeSummaries = [];
    this._ready = false;
    this.setData({ todayDate: todayKey() });
    this.initializePage();
  },

  async onShow() {
    const userRole = (app.globalData && app.globalData.userRole) || wx.getStorageSync('user_role');
    this.setData({ app, greetingText: buildGreeting(), isCreator: userRole === 'creator' });
    // 新用户引导：宝宝信息保存后选择“去设置”，会先切到首页并打上标记，
    // 由此处压入配奶设置页（栈为 [首页, 配奶设置页]），保证从配奶设置页返回时回到首页。
    if (this.maybeOpenNutritionSetup()) return;
    // 每次进入/返回首页都重播入场动画（CSS 动画需先卸下再挂上才会重新执行）
    this.replayEntrance();
    if (this._ready) {
      await this.loadDashboard({ silent: true });
    }
  },

  // 消费“引导去配奶设置”标记：命中则压入配奶设置页并返回 true（本次 onShow 不再继续首页逻辑）
  maybeOpenNutritionSetup() {
    if (!app.globalData.pendingNutritionSetup) return false;
    app.globalData.pendingNutritionSetup = false;
    wx.navigateTo({
      url: '/pkg-milk/nutrition-profile-settings/index?fromSetup=true',
      fail: (err) => console.error('打开配奶设置页失败:', err)
    });
    return true;
  },

  // 重播卡片入场动画：先移除 anim-on，下一帧再加回去触发重排
  replayEntrance() {
    if (this._replayTimer) clearTimeout(this._replayTimer);
    this.setData({ animReady: false });
    this._replayTimer = setTimeout(() => {
      this.setData({ animReady: true });
    }, 30);
  },

  onHide() { this.hideMedUndo(); this.closeMedPanel(); },
  onUnload() { this.hideMedUndo(); this.closeMedPanel(); },

  async onPullDownRefresh() {
    try {
      await this.loadDashboard({ silent: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onShareAppMessage() {
    return {
      title: '柠檬宝宝 · 每日喂养记录',
      path: '/pages/daily-feeding/index'
    };
  },

  async initializePage() {
    try {
      wx.showLoading({ title: '正在初始化...', mask: true });
      await waitForAppInitialization((progress, text) => {
        wx.showLoading({ title: text || '正在初始化...', mask: true });
      });

      const hasPermission = await checkUserPermission();
      if (!hasPermission) {
        wx.hideLoading();
        wx.showModal({
          title: '权限不足',
          content: '您没有权限访问此页面，请重新登录',
          showCancel: false,
          success: () => wx.reLaunch({ url: '/pages/role-selection/index' })
        });
        return;
      }

      this.setData({ app });
      await this.initBabyInfoCache();
      await this.loadDashboard({ silent: true });
      this._ready = true;
      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '页面初始化失败' });
    }
  },

  // === 宝宝信息 ===
  async initBabyInfoCache() {
    try {
      const babyInfo = await getBabyInfo();
      const birthday = babyInfo && babyInfo.birthday;
      const ageMonths = birthday ? this.calculateAgeInMonths(birthday) : null;
      this.setData({
        babyName: (babyInfo && babyInfo.name) || '柠檬宝宝',
        babyAvatarUrl: (babyInfo && babyInfo.avatarUrl) || '/images/LemonLogo.png',
        babyGender: normalizeGenderText(babyInfo && babyInfo.gender),
        babyGenderClass: genderClass(babyInfo && babyInfo.gender),
        babyBirthdayText: birthday || '',
        babyAgeMonthsText: ageMonths === null ? '' : `${ageMonths} 月龄`,
        babyDays: birthday ? this.calculateBabyDays(birthday) : 0
      });
    } catch (error) {
      console.error('初始化宝宝信息失败:', error);
    }
  },

  calculateBabyDays(birthday) {
    const birthDate = new Date(birthday);
    const now = new Date();
    if (isNaN(birthDate.getTime())) return 0;
    return Math.max(0, Math.ceil(Math.abs(now - birthDate) / (1000 * 60 * 60 * 24)));
  },

  calculateAgeInMonths(birthday, referenceDate = new Date()) {
    const birthDate = new Date(birthday);
    const refDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (isNaN(birthDate.getTime()) || isNaN(refDate.getTime())) return null;
    let months = (refDate.getFullYear() - birthDate.getFullYear()) * 12 + (refDate.getMonth() - birthDate.getMonth());
    if (refDate.getDate() < birthDate.getDate()) months -= 1;
    return months < 0 ? 0 : months;
  },

  // === 核心：加载看板数据 ===
  async loadDashboard(options = {}) {
    const silent = options.silent;
    try {
      if (!silent) wx.showLoading({ title: '加载中...' });

      const babyUid = (app.globalData && app.globalData.babyUid) || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        if (!silent) wx.hideLoading();
        return;
      }

      const today = todayKey();
      // 趋势窗口不含今天（T-1~T-7），故往前多取一天到 T-7。
      const startKey = shiftDateKey(today, -TREND_DAYS);

      const [daily, rangeSummaries, meds, plannedMeals, recentDay] = await Promise.all([
        DailyRecordV2Service.getDailyRecordV2(babyUid, today),
        // 趋势补齐 T-7~T-1 缺失/过期的汇总，与「数据记录」页同源；
        // 今天交给上面的 getDailyRecordV2 处理，这里跳过以免并发重复重建。
        DailyRecordV2Service.getDailySummariesForRange(babyUid, startKey, today, {
          rebuildMissing: true,
          skipDates: [today]
        }),
        MedicationModel.getMedications(),
        FeedingRecordV2Model.getRecentDayMealCount(babyUid, today),
        // 下一顿参考：取上次（最近历史日）那天的全部喂奶记录，按今日已喂顿数对应同序号那一顿
        FeedingRecordV2Model.getRecentDayRecords(babyUid, today).catch(() => ({ date: '', records: [] }))
      ]);

      this.rangeSummaries = Array.isArray(rangeSummaries) ? rangeSummaries : [];
      this.applyDashboard({ daily, meds, plannedMeals, recentDay, today });

      if (!silent) wx.hideLoading();
    } catch (error) {
      if (!silent) wx.hideLoading();
      handleError(error, { title: '加载数据失败' });
    }
  },

  applyDashboard({ daily = {}, meds = [], plannedMeals = 0, recentDay = { date: '', records: [] }, today }) {
    const summary = daily.summary || {};
    const basicInfo = daily.basicInfo || summary.basicInfo || {};
    const macroSummary = summary.macroSummary || {};
    const milkRecords = daily.milkRecords || [];

    // 用刚实时重算的当日汇总覆盖区间里“今天”那条：
    // rangeSummaries 是和 getDailyRecordV2 并行取的旧缓存，
    // 不覆盖的话趋势的“今天”会比营养卡滞后/缺失，导致两处对不上。
    if (today) {
      const previous = (this.rangeSummaries || []).filter((item) => item && item.date !== today);
      previous.push({ ...summary, date: today, basicInfo, macroSummary });
      this.rangeSummaries = previous;
    }

    const weight = basicInfo.weight || '';
    const height = basicInfo.height || '';
    const foodCount = (daily.foodIntakeRecords || []).length;
    const coefficients = {
      natural: basicInfo.naturalProteinCoefficient,
      special: basicInfo.specialProteinCoefficient,
      calorie: basicInfo.calorieCoefficient
    };

    const nutrition = dashboard.buildNutritionSummary({ macroSummary, weight });
    const feedingProgress = dashboard.buildFeedingProgress({ milkRecords, plannedMeals });

    // 下一顿参考：按今日已喂顿数对应到上次那天的同序号那一顿（如今天已喂2顿→参考上次第3顿）
    const feedingPlanHint = dashboard.buildNextMealReference({
      referenceMeals: (recentDay && recentDay.records) || [],
      refDate: (recentDay && recentDay.date) || '',
      fedCount: feedingProgress.count
    });

    // 保存当日用药记录与上下文，供打卡的「乐观本地更新」复用，避免每次打卡都整页刷新
    this._medTodayRecords = (daily.medicationRecords || []).slice();
    this._medToday = today;
    const medicationChecklist = dashboard.buildMedicationChecklist({
      meds,
      todayRecords: this._medTodayRecords,
      history: this.buildMedicationHistory(today),
      todayKey: today
    });

    const timelineAll = dashboard.buildTimeline({
      milkRecords,
      foodIntakeRecords: daily.foodIntakeRecords || [],
      medicationRecords: daily.medicationRecords || [],
      treatmentRecords: daily.treatmentRecords || [],
      limit: 0
    });
    this.timelineAll = timelineAll;
    const timeline = filterTimeline(timelineAll, this.data.timelineCategory);

    const trend = this.computeTrend(this.data.trendMetric, today);

    this.setData({
      weight,
      height,
      foodCount,
      nutrition,
      feedingProgress,
      feedingPlanHint,
      medicationsList: meds || [],
      medicationChecklist,
      timeline,
      hasTimeline: timelineAll.length > 0,
      weeklyTrend: trend.weeklyTrend,
      trendStats: trend.trendStats
    });
  },

  // 按当前指标计算趋势（单柱，每天标值），统一不含今天（T-1~T-7）。
  computeTrend(metric, todayVal) {
    const weeklyTrend = dashboard.buildWeeklyTrend({
      summaries: this.rangeSummaries,
      todayKey: todayVal,
      days: TREND_DAYS,
      metric,
      includeToday: false
    });
    return {
      weeklyTrend,
      trendStats: buildTrendStats(metric, weeklyTrend)
    };
  },

  // 从范围汇总里取每日已服药 id（供隔日药推算）
  buildMedicationHistory(today) {
    return (this.rangeSummaries || [])
      .filter((summary) => summary && summary.date && summary.date < today)
      .map((summary) => ({
        date: summary.date,
        takenMedicationIds: (summary.medication && summary.medication.takenMedicationIds) || []
      }));
  },

  switchTimelineCategory(e) {
    const category = e.currentTarget.dataset.category;
    if (!category || category === this.data.timelineCategory) return;
    this.setData({
      timelineCategory: category,
      timeline: filterTimeline(this.timelineAll || [], category)
    });
  },

  switchTrendMetric(e) {
    const metric = e.currentTarget.dataset.metric;
    if (!metric || metric === this.data.trendMetric) return;
    const trend = this.computeTrend(metric, todayKey());
    this.setData({
      trendMetric: metric,
      weeklyTrend: trend.weeklyTrend,
      trendStats: trend.trendStats
    });
  },

  // === 体重 ===
  openWeightModal() {
    this.setData({ showWeightModal: true, weightInput: this.data.weight || '' });
  },

  onWeightModalInput(e) {
    this.setData({ weightInput: e.detail.value });
  },

  closeWeightModal() {
    this.setData({ showWeightModal: false });
  },

  async saveWeightModal() {
    const value = String(this.data.weightInput || '').trim();
    if (!validation.validateData({ weight: value }, {
      weight: { required: true, type: 'number', min: 0, message: '请输入有效体重' }
    })) {
      return;
    }

    const babyUid = (app.globalData && app.globalData.babyUid) || wx.getStorageSync('baby_uid');
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const today = todayKey();
      // 体重写入 v2 成长记录，与数据记录页一致；
      // 同时带上当前身高，避免 upsert 把同一条成长记录里的身高覆盖为空。
      await FeedingRecordV2Model.upsertGrowthRecordForDate(babyUid, today, {
        weight: value,
        height: this.data.height || ''
      });
      await this.updateBabyInfoFields({ weight: value });
      await DailySummaryV2Model.markDirty(babyUid, today);
      this.setData({ showWeightModal: false, weight: value });
      await this.loadDashboard({ silent: true });
      wx.hideLoading();
      wx.showToast({ title: '体重已记录', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      console.error('保存体重失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // === 身高 ===
  openHeightModal() {
    this.setData({ showHeightModal: true, heightInput: this.data.height || '' });
  },

  onHeightModalInput(e) {
    this.setData({ heightInput: e.detail.value });
  },

  closeHeightModal() {
    this.setData({ showHeightModal: false });
  },

  async saveHeightModal() {
    const value = String(this.data.heightInput || '').trim();
    if (!validation.validateData({ height: value }, {
      height: { required: true, type: 'number', min: 0, message: '请输入有效身高' }
    })) {
      return;
    }

    const babyUid = (app.globalData && app.globalData.babyUid) || wx.getStorageSync('baby_uid');
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const today = todayKey();
      // 身高写入 v2 成长记录；带上当前体重，避免覆盖同条记录的体重。
      await FeedingRecordV2Model.upsertGrowthRecordForDate(babyUid, today, {
        height: value,
        weight: this.data.weight || ''
      });
      await this.updateBabyInfoFields({ height: value });
      await DailySummaryV2Model.markDirty(babyUid, today);
      this.setData({ showHeightModal: false, height: value });
      await this.loadDashboard({ silent: true });
      wx.hideLoading();
      wx.showToast({ title: '身高已记录', icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      console.error('保存身高失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async updateBabyInfoFields(fields = {}) {
    try {
      const db = wx.cloud.database();
      const babyUid = (app.globalData && app.globalData.babyUid) || wx.getStorageSync('baby_uid');
      if (!babyUid) return;
      const result = await db.collection('baby_info').where({ babyUid }).get();
      if (result.data && result.data.length > 0) {
        await db.collection('baby_info').doc(result.data[0]._id).update({
          data: { ...fields, updatedAt: db.serverDate() }
        });
      }
    } catch (error) {
      console.error('更新宝宝信息失败:', error);
    }
  },

  // 用当前本地的当日用药记录重建打卡清单（不发网络请求，用于乐观更新/回滚）
  rebuildMedChecklist() {
    const meds = this.data.medicationsList || [];
    const today = this._medToday || todayKey();
    const medicationChecklist = dashboard.buildMedicationChecklist({
      meds,
      todayRecords: this._medTodayRecords || [],
      history: this.buildMedicationHistory(today),
      todayKey: today
    });
    this.setData({ medicationChecklist });
  },

  // 在时间轴里本地插入/移除一条用药事件（带 localId 便于回滚），避免整页刷新
  addLocalMedTimeline(localId, name, actualTime, dosage, unit) {
    const [h, m] = String(actualTime || '').split(':').map(Number);
    const sortValue = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    const event = {
      type: 'med',
      time: actualTime || '',
      title: `用药 · ${name || ''}`,
      desc: dosage ? `${dosage}${unit || ''}` : '',
      sortValue,
      _localId: localId
    };
    const all = (this.timelineAll || []).slice();
    all.push(event);
    all.sort((a, b) => b.sortValue - a.sortValue);
    this.timelineAll = all;
    this.setData({
      timeline: filterTimeline(all, this.data.timelineCategory),
      hasTimeline: all.length > 0
    });
  },

  removeLocalMedTimeline(localId) {
    const all = (this.timelineAll || []).filter((ev) => ev._localId !== localId);
    this.timelineAll = all;
    this.setData({
      timeline: filterTimeline(all, this.data.timelineCategory),
      hasTimeline: all.length > 0
    });
  },

  // === 用药打卡（清单一键打卡：乐观更新 + 触感 + 可撤销，不整页刷新） ===
  async quickTakeMedication(e) {
    const medicationId = e.currentTarget.dataset.id;
    const item = (this.data.medicationChecklist.todayItems || []).find((it) => it.medicationId === medicationId);
    const medInfo = (this.data.medicationsList || []).find((med) => (med._id || med.id) === medicationId);
    if (!item || !medInfo) return;

    if (item.completed) {
      wx.showToast({ title: '今日已完成', icon: 'none' });
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    // 触感反馈 + 即时打勾（乐观更新，无 loading、无整页刷新）
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    const now = new Date();
    const actualTime = utils.formatTime(now);
    const localId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const optimistic = { medicationId, actualTime, _localId: localId };
    this._medTodayRecords = [...(this._medTodayRecords || []), optimistic];
    this.rebuildMedChecklist();
    this.addLocalMedTimeline(localId, medInfo.name, actualTime, medInfo.dosage, medInfo.unit);

    try {
      const res = await MedicationRecordModel.addRecord({
        medicationId,
        medicationName: medInfo.name,
        dosage: medInfo.dosage,
        unit: medInfo.unit,
        frequency: medInfo.frequency,
        actualTime,
        actualDateTime: now
      });
      const recordId = (res && (res._id || (res.result && res.result._id))) || '';
      optimistic._id = recordId;
      await DailySummaryV2Model.markDirty(babyUid, todayKey());
      this.showMedUndo({ name: medInfo.name, time: actualTime, recordId, localId });
    } catch (error) {
      console.error('用药打卡失败:', error);
      // 回滚乐观更新
      this._medTodayRecords = (this._medTodayRecords || []).filter((r) => r._localId !== localId);
      this.rebuildMedChecklist();
      this.removeLocalMedTimeline(localId);
      wx.showToast({ title: '打卡失败，请重试', icon: 'none' });
    }
  },

  showMedUndo({ name, time, recordId, localId }) {
    if (this._medUndoTimer) {
      clearTimeout(this._medUndoTimer);
      this._medUndoTimer = null;
    }
    this.setData({ medUndo: { visible: true, name, time, recordId, localId } });
    this._medUndoTimer = setTimeout(() => {
      this.hideMedUndo();
    }, 5000);
  },

  hideMedUndo() {
    if (this._medUndoTimer) {
      clearTimeout(this._medUndoTimer);
      this._medUndoTimer = null;
    }
    if (this.data.medUndo && this.data.medUndo.visible) {
      this.setData({ 'medUndo.visible': false });
    }
  },

  async undoMedCheckin() {
    const { recordId, localId, name } = this.data.medUndo || {};
    this.hideMedUndo();
    if (!recordId) return;

    // 先本地撤销，反馈即时
    this._medTodayRecords = (this._medTodayRecords || []).filter((r) => (r._id || r._localId) !== recordId && r._localId !== localId);
    this.rebuildMedChecklist();
    this.removeLocalMedTimeline(localId);
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });

    try {
      await MedicationRecordModel.deleteRecord(recordId);
      const babyUid = getBabyUid();
      if (babyUid) await DailySummaryV2Model.markDirty(babyUid, todayKey());
      wx.showToast({ title: `已撤销 ${name || ''}`, icon: 'none' });
    } catch (error) {
      console.error('撤销打卡失败:', error);
      wx.showToast({ title: '撤销失败，请刷新', icon: 'none' });
      // 撤销失败：拉回真实数据，避免本地与云端不一致
      this.loadDashboard({ silent: true });
    }
  },

  // 收集某药今日已打卡记录（仅含已落库、带 _id 的，可改时间/删除）
  collectMedEntries(medicationId) {
    return (this._medTodayRecords || [])
      .filter((r) => r && r.medicationId === medicationId && r._id)
      .map((r) => ({ recordId: r._id, time: r.actualTime || '' }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  },

  // 点药品行：打开「打卡面板」——看今日每一次、单独改时间/删除、或选时间补记
  openMedPanel(e) {
    const medicationId = e.currentTarget.dataset.id;
    const item = (this.data.medicationChecklist.todayItems || [])
      .concat(this.data.medicationChecklist.items || [])
      .find((it) => it.medicationId === medicationId);
    const medInfo = (this.data.medicationsList || []).find((med) => (med._id || med.id) === medicationId);
    if (!medInfo) return;

    this.hideMedUndo();
    const entries = this.collectMedEntries(medicationId);
    this.setData({
      medPanel: {
        visible: true,
        medicationId,
        name: medInfo.name || '',
        meta: `${medInfo.dosage || ''}${medInfo.unit || ''} · ${medInfo.frequency || ''}`,
        doseCount: item ? item.doseCount : entries.length,
        doseTotal: item ? item.doseTotal : entries.length,
        entries
      }
    });
  },

  closeMedPanel() {
    this.setData({ 'medPanel.visible': false });
  },

  // 面板数据已变时，从最新本地记录重新推导（供增删改后刷新面板）
  refreshMedPanel() {
    const mp = this.data.medPanel;
    if (!mp || !mp.visible) return;
    const item = (this.data.medicationChecklist.todayItems || [])
      .concat(this.data.medicationChecklist.items || [])
      .find((it) => it.medicationId === mp.medicationId);
    const entries = this.collectMedEntries(mp.medicationId);
    this.setData({
      'medPanel.entries': entries,
      'medPanel.doseCount': item ? item.doseCount : entries.length,
      'medPanel.doseTotal': item ? item.doseTotal : entries.length
    });
  },

  // 面板内：修改某一次打卡的时间
  async onMedPanelEntryTimeChange(e) {
    const recordId = e.currentTarget.dataset.recordId;
    const newTime = e.detail.value;
    if (!recordId) return;
    const babyUid = getBabyUid();
    try {
      wx.showLoading({ title: '更新中...', mask: true });
      await MedicationRecordModel.updateRecord(recordId, {
        actualTime: newTime,
        actualDateTime: timeStrToToday(newTime)
      });
      if (babyUid) await DailySummaryV2Model.markDirty(babyUid, todayKey());
      await this.loadDashboard({ silent: true });
      this.refreshMedPanel();
      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      console.error('修改打卡时间失败:', error);
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
  },

  // 面板内：删除某一次打卡
  deleteMedPanelEntry(e) {
    const recordId = e.currentTarget.dataset.recordId;
    if (!recordId) return;
    wx.showModal({
      title: '删除这次打卡？',
      content: '删除后该次记录将移除',
      confirmText: '删除',
      confirmColor: '#F44336',
      success: async (res) => {
        if (!res.confirm) return;
        const babyUid = getBabyUid();
        try {
          wx.showLoading({ title: '删除中...', mask: true });
          await MedicationRecordModel.deleteRecord(recordId);
          if (babyUid) await DailySummaryV2Model.markDirty(babyUid, todayKey());
          await this.loadDashboard({ silent: true });
          this.refreshMedPanel();
          wx.hideLoading();
        } catch (error) {
          wx.hideLoading();
          console.error('删除打卡失败:', error);
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  // === 记录用药弹窗（自定义剂量/时间） ===
  openMedicationModal() {
    const meds = this.data.medicationsList || [];
    if (!meds.length) {
      wx.showToast({ title: '请先在「用药管理」添加药物', icon: 'none' });
      return;
    }
    const medInfo = meds[0];
    this.setData({
      'modals.medication': true,
      selectedMedication: medInfo._id || medInfo.id,
      selectedMedicationInfo: medInfo,
      selectedMedicationIndex: 0,
      currentModalTime: utils.formatTime(new Date()),
      currentModalDateTime: new Date(),
      currentModalDosage: medInfo.dosage || '',
      currentModalNotes: ''
    });
  },

  onMedicationPickerChange(e) {
    const index = Number(e.detail.value) || 0;
    const medInfo = (this.data.medicationsList || [])[index];
    if (!medInfo) return;
    this.setData({
      selectedMedicationIndex: index,
      selectedMedication: medInfo._id || medInfo.id,
      selectedMedicationInfo: medInfo,
      currentModalDosage: medInfo.dosage || this.data.currentModalDosage
    });
  },

  onMedicationDosageChange(e) {
    this.setData({ currentModalDosage: e.detail.value });
  },

  onMedicationTimeChange(e) {
    const timeStr = e.detail.value;
    this.setData({
      currentModalTime: timeStr,
      currentModalDateTime: utils.createTimeObject ? utils.createTimeObject(timeStr) : new Date()
    });
  },

  onMedicationNotesChange(e) {
    this.setData({ currentModalNotes: e.detail.value });
  },

  closeMedicationModal() {
    this.setData({
      'modals.medication': false,
      selectedMedication: null,
      selectedMedicationInfo: null,
      selectedMedicationIndex: 0,
      currentModalTime: '',
      currentModalDateTime: null,
      currentModalDosage: '',
      currentModalNotes: ''
    });
  },

  async recordMedication() {
    const medInfo = this.data.selectedMedicationInfo;
    if (!medInfo) {
      wx.showToast({ title: '药物信息不存在', icon: 'none' });
      return;
    }
    if (!validation.validateData({ dosage: this.data.currentModalDosage }, {
      dosage: { required: true, type: 'number', min: 0, message: '请输入有效的药物剂量' }
    })) {
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    let dateTime = this.data.currentModalDateTime;
    if (!dateTime) {
      const now = new Date();
      const [hours, minutes] = String(this.data.currentModalTime || '').split(':').map(Number);
      dateTime = new Date(now);
      if (Number.isFinite(hours)) dateTime.setHours(hours, minutes || 0, 0, 0);
    }

    try {
      wx.showLoading({ title: '保存中...' });
      const payload = {
        medicationId: this.data.selectedMedication,
        medicationName: medInfo.name,
        dosage: this.data.currentModalDosage,
        unit: medInfo.unit,
        frequency: medInfo.frequency,
        actualTime: this.data.currentModalTime,
        actualDateTime: dateTime
      };
      const notes = String(this.data.currentModalNotes || '').trim();
      if (notes) payload.notes = notes;

      await MedicationRecordModel.addRecord(payload);
      await DailySummaryV2Model.markDirty(babyUid, todayKey());
      this.closeMedicationModal();
      await this.loadDashboard({ silent: true });
      wx.hideLoading();
      wx.showToast({ title: `${medInfo.name} 已记录`, icon: 'success' });
    } catch (error) {
      wx.hideLoading();
      console.error('保存药物记录失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  goToMedicationManage() {
    this.setData({ 'modals.medication': false });
    wx.navigateTo({ url: '/pkg-misc/medications/index' });
  },

  // === 导航 ===
  onNavigate(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  navigateToBabyInfo() {
    wx.navigateTo({ url: '/pkg-misc/baby-info/index?from=daily-feeding' });
  },

  navigateToMilkFeedingEditor() {
    wx.navigateTo({ url: `/pkg-milk/milk-feeding-editor-v2/index?mode=create&source=daily&date=${todayKey()}` });
  },

  navigateToMealEditor() {
    wx.navigateTo({ url: `/pkg-records/meal-editor/index?date=${todayKey()}&from=daily` });
  },

  navigateToTreatmentRecord() {
    wx.navigateTo({ url: `/pkg-records/treatment-record/index?date=${todayKey()}` });
  },

  navigateToMilkGoalPlanner() {
    wx.navigateTo({ url: `/pkg-milk/milk-goal-planner-v2/index?date=${todayKey()}&from=daily` });
  },

  goToDataRecords() {
    wx.switchTab({ url: '/pages/data-records-v2/index' });
  },

  goToReport() {
    wx.switchTab({ url: '/pages/analysis-report/index' });
  },

  stopBubble() {}
});
