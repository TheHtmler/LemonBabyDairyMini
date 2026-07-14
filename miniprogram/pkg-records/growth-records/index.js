const {
  waitForAppInitialization,
  getBabyInfo,
  getBabyUid,
  getUserInfo,
  handleError,
  growthUtils
} = require('../../utils/index');
const growthChartUtils = require('../../utils/growthChartUtils');
const growthCurvePointUtils = require('../../utils/growthCurvePointUtils');
const FeedingRecordV2Model = require('../../models/feedingRecordV2');

const standards = require('./_data/wst423-2022-0-36');

Page({
  data: {
    babyInfo: {},
    chartInfoText: '',
    growthRecords: [],
    showMeasurementForm: false,
    newMeasurement: {
      date: '',
      weight: '',
      length: '',
      head: '',
      notes: ''
    },
    ec: {
      lazyLoad: true
    }
  },

  async onLoad() {
    await this.initializePage();
  },

  async onShow() {
    await this.refreshData();
  },

  async initializePage() {
    try {
      await waitForAppInitialization();
      const babyInfo = await getBabyInfo();
      this.setData({
        babyInfo: babyInfo || {}
      });
      await this.refreshData();
    } catch (error) {
      handleError(error, { title: '初始化失败' });
    }
  },

  async refreshData() {
    await this.loadGrowthRecords();
    this.updateChartInfo();
  },

  updateChartInfo() {
    const { babyInfo } = this.data;
    const genderText = babyInfo.gender === 'female' ? '女童' : '男童';
    this.setData({
      chartInfoText: `身长 & 体重 · 0-36月 · ${genderText} · P3/P15/P50/P85/P97`
    });
    this.renderChart();
  },

  initGrowthChart(e) {
    this.chartComponent = e.detail.component;
    this.renderChart();
  },

  renderChart() {
    if (!this.chartComponent) return;
    const chartData = this.buildChartData();
    if (!chartData) return;
    this.chartComponent.drawChart(chartData);
  },

  getSeriesRange(seriesList) {
    const values = [];
    seriesList.forEach(series => {
      (series || []).forEach(value => {
        if (value === null || value === undefined || Number.isNaN(value)) return;
        values.push(value);
      });
    });
    if (values.length === 0) {
      return { min: 0, max: 0 };
    }
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  },

  percentileKeys: ['P3', 'P10', 'P25', 'P50', 'P75', 'P90', 'P97'],

  buildPercentileSeries(rows, maxMonth) {
    const keys = this.percentileKeys;
    const points = rows.map(row => {
      const values = {};
      keys.forEach(k => { values[k] = row[k]; });
      return { month: row.month, values };
    });
    const interpolated = growthUtils.interpolateMonthlySeries(points, maxMonth);
    const result = {};
    keys.forEach(k => {
      result[k] = interpolated.map(item => item[k] ?? null);
    });
    return result;
  },

  // 从已有的 P10/P25 和 P75/P90 线性插值出 P15/P85
  interpolatePercentile(seriesMap, from1, from2, fraction) {
    return seriesMap[from1].map((v, i) => {
      const a = v, b = seriesMap[from2][i];
      return a !== null && b !== null ? a + (b - a) * fraction : null;
    });
  },

  buildChartData() {
    const { babyInfo, growthRecords } = this.data;
    const genderKey = babyInfo.gender === 'female' ? 'female' : 'male';
    const maxMonth = 36;
    const lengthRows = standards.data[`length_by_age_${genderKey}`] || [];
    const weightRows = standards.data[`weight_by_age_${genderKey}`] || [];
    if (lengthRows.length === 0 || weightRows.length === 0) {
      return null;
    }

    const lengthSeries = this.buildPercentileSeries(lengthRows, maxMonth);
    const weightSeries = this.buildPercentileSeries(weightRows, maxMonth);

    // 插值 P15 = P10 + (P25-P10)*1/3，P85 = P75 + (P90-P75)*2/3
    lengthSeries['P15'] = this.interpolatePercentile(lengthSeries, 'P10', 'P25', 1 / 3);
    lengthSeries['P85'] = this.interpolatePercentile(lengthSeries, 'P75', 'P90', 2 / 3);
    weightSeries['P15'] = this.interpolatePercentile(weightSeries, 'P10', 'P25', 1 / 3);
    weightSeries['P85'] = this.interpolatePercentile(weightSeries, 'P75', 'P90', 2 / 3);

    const displayKeys = ['P3', 'P15', 'P50', 'P85', 'P97'];
    const monthLabels = Array.from({ length: maxMonth + 1 }, (_, i) => `${i}`);

    const actualSeries = growthChartUtils.buildActualMeasurementSeries(growthRecords, maxMonth);

    // 复合轴布局：体重(kg)和身长(cm)各自独立映射到全图高度
    // 体重值小(2-18)自然在下方，身长值大(45-105)自然在上方，中部重合
    const series = [];
    const colors = [];
    const lengthLineColor = '#3F51B5';
    const weightLineColor = '#E07A5F';

    // 身长百分位线
    displayKeys.forEach(k => {
      series.push({
        name: `身长${k}`,
        data: lengthSeries[k],
        metric: 'length',
        lineWidth: k === 'P50' ? 2 : (k === 'P3' || k === 'P97' ? 1 : 0.5),
        showDots: false
      });
      colors.push(lengthLineColor);
    });
    series.push({
      name: '身长实测',
      data: actualSeries.lengthData,
      points: actualSeries.lengthPoints,
      metric: 'length',
      lineWidth: 2.5,
      showDots: true,
      dotRadius: 3
    });
    colors.push('#1B5E20');

    // 体重百分位线
    displayKeys.forEach(k => {
      series.push({
        name: `体重${k}`,
        data: weightSeries[k],
        metric: 'weight',
        lineWidth: k === 'P50' ? 2 : (k === 'P3' || k === 'P97' ? 1 : 0.5),
        showDots: false
      });
      colors.push(weightLineColor);
    });
    series.push({
      name: '体重实测',
      data: actualSeries.weightData,
      points: actualSeries.weightPoints,
      metric: 'weight',
      lineWidth: 2.5,
      showDots: true,
      dotRadius: 3
    });
    colors.push('#BF360C');

    // 填充带（身长用蓝色调，体重用暖色调）
    const bands = [];
    bands.push(
      { upper: '身长P97', lower: '身长P85', metric: 'length', color: 'rgba(63,81,181,0.08)' },
      { upper: '身长P85', lower: '身长P15', metric: 'length', color: 'rgba(63,81,181,0.04)' },
      { upper: '身长P15', lower: '身长P3',  metric: 'length', color: 'rgba(63,81,181,0.08)' },
      { upper: '体重P97', lower: '体重P85', metric: 'weight', color: 'rgba(224,122,95,0.08)' },
      { upper: '体重P85', lower: '体重P15', metric: 'weight', color: 'rgba(224,122,95,0.04)' },
      { upper: '体重P15', lower: '体重P3',  metric: 'weight', color: 'rgba(224,122,95,0.08)' }
    );

    return {
      xData: monthLabels,
      series,
      bands,
      options: {
        layout: 'compositeAxis',
        colors,
        showGrid: true,
        showLegend: false,
        showTopAxis: true,
        showBottomAxis: true,
        // 左轴标签范围
        leftWeightMax: 10,     // 左轴体重标到10kg
        rightLengthMin: 85,    // 右轴身长从85cm起标
        padding: { top: 30, right: 40, bottom: 30, left: 36 }
      }
    };
  },

  getChartDateRange() {
    const { babyInfo } = this.data;
    if (!babyInfo.birthday) return null;
    const birthday = new Date(`${babyInfo.birthday}T00:00:00`);
    if (Number.isNaN(birthday.getTime())) return null;
    const endDate = new Date(birthday);
    endDate.setMonth(endDate.getMonth() + 36);
    const today = new Date();
    const effectiveEnd = endDate > today ? today : endDate;
    return {
      start: growthChartUtils.formatDateKey(birthday),
      end: growthChartUtils.formatDateKey(effectiveEnd)
    };
  },

  async loadGrowthRecords() {
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const db = wx.cloud.database();
      const _ = db.command;
      // growth_curve_points 是成长曲线索引表；页面只读曲线点，不再扫描 growth_records_v2 原始记录。
      const where = {
        babyUid,
        status: 'active'
      };
      const dateRange = this.getChartDateRange();
      if (dateRange) {
        where.date = _.gte(dateRange.start).and(_.lte(dateRange.end));
      }

      // 小程序端云数据库单次 get 最多返回 20 条；用 20 分页，避免 limit(100) 被截断后误判已加载完。
      const batchSize = 20;
      let allPointData = [];
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const batch = await db.collection('growth_curve_points')
          .where(where)
          .orderBy('date', 'asc')
          .skip(skip)
          .limit(batchSize)
          .get();
        allPointData = allPointData.concat(batch.data || []);
        hasMore = (batch.data || []).length === batchSize;
        skip += batchSize;
      }

      const { babyInfo } = this.data;
      const growthRecords = growthCurvePointUtils.normalizeGrowthCurvePointsForChart({
        babyInfo,
        points: allPointData
      });

      this.setData({
        growthRecords
      });
    } catch (error) {
      handleError(error, { title: '获取测量记录失败' });
    }
  },

  openMeasurementForm() {
    this.setData({
      showMeasurementForm: true
    });
  },

  closeForms() {
    this.setData({
      showMeasurementForm: false
    });
  },

  onMeasurementInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`newMeasurement.${field}`]: value
    });
  },

  onMeasurementDateChange(e) {
    this.setData({
      'newMeasurement.date': e.detail.value
    });
  },

  async saveMeasurement() {
    const { newMeasurement, babyInfo } = this.data;
    if (!newMeasurement.date) {
      wx.showToast({ title: '请选择测量日期', icon: 'none' });
      return;
    }
    const hasValue = newMeasurement.weight || newMeasurement.length || newMeasurement.head;
    if (!hasValue) {
      wx.showToast({ title: '请至少填写一项数据', icon: 'none' });
      return;
    }
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const monthAge = growthUtils.calculateAgeMonths(babyInfo.birthday, newMeasurement.date);
      const userInfo = await getUserInfo();
      const payload = {
        babyUid,
        recordDate: growthUtils.parseDateString(newMeasurement.date),
        monthAge,
        weight: newMeasurement.weight ? Number(newMeasurement.weight) : null,
        length: newMeasurement.length ? Number(newMeasurement.length) : null,
        head: newMeasurement.head ? Number(newMeasurement.head) : null,
        notes: newMeasurement.notes || '',
        userInfo,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await FeedingRecordV2Model.upsertGrowthRecordForDate(babyUid, newMeasurement.date, {
        weight: payload.weight || '',
        height: payload.length || '',
        headCircumference: payload.head || '',
        notes: payload.notes,
        source: 'growth_records_page',
        openid: userInfo.openid || ''
      });
      await this.updateBabyInfoFromMeasurement(payload);
      this.setData({
        newMeasurement: {
          date: '',
          weight: '',
          length: '',
          head: '',
          notes: ''
        },
        showMeasurementForm: false
      });
      await this.loadGrowthRecords();
      this.renderChart();
      wx.showToast({ title: '记录成功', icon: 'success' });
    } catch (error) {
      handleError(error, { title: '保存测量失败' });
    }
  },

  async updateBabyInfoFromMeasurement(payload) {
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const updates = {};
      if (payload.weight) updates.weight = payload.weight;
      if (payload.length) updates.height = payload.length;
      const db = wx.cloud.database();
      const res = await db.collection('baby_info').where({ babyUid }).limit(1).get();
      if (res.data && res.data[0]) {
        await db.collection('baby_info').doc(res.data[0]._id).update({
          data: {
            ...updates,
            updatedAt: new Date()
          }
        });
      }
    } catch (error) {
      console.warn('同步宝宝信息失败:', error);
    }
  }
});
