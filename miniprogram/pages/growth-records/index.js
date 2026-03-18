const {
  waitForAppInitialization,
  getBabyInfo,
  getBabyUid,
  getUserInfo,
  handleError,
  growthUtils
} = require('../../utils/index');

const standards = require('../../data/growth-standards/wst423-2022-0-36');

Page({
  data: {
    babyInfo: {},
    chartInfoText: '',
    growthRecords: [],
    milestones: [],
    expandedMilestoneId: '',
    showMeasurementForm: false,
    showMilestoneForm: false,
    newMeasurement: {
      date: '',
      weight: '',
      length: '',
      head: '',
      notes: ''
    },
    newMilestone: {
      date: '',
      title: '',
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
    await Promise.all([
      this.loadGrowthRecords(),
      this.loadMilestones()
    ]);
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

    const actualLength = new Array(maxMonth + 1).fill(null);
    const actualWeight = new Array(maxMonth + 1).fill(null);
    growthRecords.forEach(record => {
      if (record.monthAge == null || record.monthAge > maxMonth || record.monthAge < 0) return;
      if (record.length != null) actualLength[record.monthAge] = Number(record.length);
      if (record.weight != null) actualWeight[record.monthAge] = Number(record.weight);
    });

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
      data: actualLength,
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
      data: actualWeight,
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
        padding: { top: 30, right: 45, bottom: 30, left: 40 }
      }
    };
  },

  async loadGrowthRecords() {
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const db = wx.cloud.database();
      const parseValue = (value) => {
        if (value === '' || value === null || value === undefined) return null;
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
      };

      // 1. 从 growth_records 加载手动测量记录
      const growthRes = await db.collection('growth_records')
        .where({ babyUid })
        .orderBy('recordDate', 'asc')
        .get();
      const manualRecords = (growthRes.data || []).map(record => ({
        ...record,
        weight: parseValue(record.weight),
        length: parseValue(record.length),
        head: parseValue(record.head)
      }));

      // 2. 从 feeding_records 分页加载全部每日体重
      const batchSize = 100;
      let allFeedingData = [];
      let skip = 0;
      let hasMore = true;
      while (hasMore) {
        const batch = await db.collection('feeding_records')
          .where({ babyUid })
          .orderBy('date', 'asc')
          .skip(skip)
          .limit(batchSize)
          .get();
        allFeedingData = allFeedingData.concat(batch.data || []);
        hasMore = (batch.data || []).length === batchSize;
        skip += batchSize;
      }
      const feedingRes = { data: allFeedingData };
      const { babyInfo } = this.data;
      const dailyWeightRecords = (feedingRes.data || [])
        .filter(r => r.basicInfo && r.basicInfo.weight)
        .map(r => {
          const dateStr = this.formatDate(r.date);
          const monthAge = babyInfo.birthday
            ? growthUtils.calculateAgeMonths(babyInfo.birthday, dateStr)
            : null;
          return {
            recordDate: r.date,
            monthAge,
            weight: parseValue(r.basicInfo.weight),
            length: null,
            head: null,
            _fromFeeding: true
          };
        });

      // 3. 合并：同月龄优先手动记录（有身长），每日体重补充
      const byMonth = {};
      manualRecords.forEach(r => {
        if (r.monthAge == null) return;
        if (!byMonth[r.monthAge] || r.length != null) {
          byMonth[r.monthAge] = r;
        }
      });
      dailyWeightRecords.forEach(r => {
        if (r.monthAge == null) return;
        if (!byMonth[r.monthAge]) {
          byMonth[r.monthAge] = r;
        } else if (byMonth[r.monthAge].weight == null && r.weight != null) {
          byMonth[r.monthAge].weight = r.weight;
        }
      });

      this.setData({
        growthRecords: Object.values(byMonth)
      });
    } catch (error) {
      handleError(error, { title: '获取测量记录失败' });
    }
  },

  async loadMilestones() {
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const db = wx.cloud.database();
      const res = await db.collection('growth_milestones')
        .where({ babyUid })
        .orderBy('eventDate', 'desc')
        .get();
      const milestones = (res.data || []).map(item => ({
        ...item,
        eventDateText: item.eventDate ? this.formatDate(item.eventDate) : ''
      }));
      this.setData({
        milestones
      });
    } catch (error) {
      handleError(error, { title: '获取里程碑失败' });
    }
  },

  formatDate(dateValue) {
    if (!dateValue) return '';
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  toggleMilestone(e) {
    const { id } = e.currentTarget.dataset;
    this.setData({
      expandedMilestoneId: this.data.expandedMilestoneId === id ? '' : id
    });
  },

  openMeasurementForm() {
    this.setData({
      showMeasurementForm: true,
      showMilestoneForm: false
    });
  },

  openMilestoneForm() {
    this.setData({
      showMilestoneForm: true,
      showMeasurementForm: false
    });
  },

  closeForms() {
    this.setData({
      showMeasurementForm: false,
      showMilestoneForm: false
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
      const recordDate = growthUtils.parseDateString(newMeasurement.date);
      const payload = {
        babyUid,
        recordDate,
        monthAge,
        weight: newMeasurement.weight ? Number(newMeasurement.weight) : null,
        length: newMeasurement.length ? Number(newMeasurement.length) : null,
        head: newMeasurement.head ? Number(newMeasurement.head) : null,
        notes: newMeasurement.notes || '',
        userInfo,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const db = wx.cloud.database();
      await db.collection('growth_records').add({ data: payload });
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
  },

  onMilestoneInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`newMilestone.${field}`]: value
    });
  },

  onMilestoneDateChange(e) {
    this.setData({
      'newMilestone.date': e.detail.value
    });
  },

  async saveMilestone() {
    const { newMilestone } = this.data;
    if (!newMilestone.date) {
      wx.showToast({ title: '请选择发生日期', icon: 'none' });
      return;
    }
    if (!newMilestone.title) {
      wx.showToast({ title: '请输入里程碑', icon: 'none' });
      return;
    }
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const userInfo = await getUserInfo();
      const eventDate = growthUtils.parseDateString(newMilestone.date);
      const payload = {
        babyUid,
        eventDate,
        title: newMilestone.title,
        notes: newMilestone.notes || '',
        userInfo,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const db = wx.cloud.database();
      await db.collection('growth_milestones').add({ data: payload });
      this.setData({
        newMilestone: {
          date: '',
          title: '',
          notes: ''
        },
        showMilestoneForm: false
      });
      await this.loadMilestones();
      wx.showToast({ title: '记录成功', icon: 'success' });
    } catch (error) {
      handleError(error, { title: '保存里程碑失败' });
    }
  }
});
