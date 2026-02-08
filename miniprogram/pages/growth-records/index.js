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
    chartData: null,
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
      chartInfoText: `身长 & 体重 · 0-36月 · ${genderText} · 标准 P3/P50/P97`
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

  buildPercentileSeries(rows, maxMonth) {
    const points = rows.map(row => ({
      month: row.month,
      values: {
        P3: row.P3,
        P50: row.P50,
        P97: row.P97
      }
    }));
    const interpolated = growthUtils.interpolateMonthlySeries(points, maxMonth);
    return {
      P3: interpolated.map(item => item.P3 || null),
      P50: interpolated.map(item => item.P50 || null),
      P97: interpolated.map(item => item.P97 || null)
    };
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
    const monthLabels = Array.from({ length: maxMonth + 1 }, (_, i) => `${i}`);
    const actualLength = new Array(maxMonth + 1).fill(null);
    const actualWeight = new Array(maxMonth + 1).fill(null);
    growthRecords.forEach(record => {
      if (record.monthAge === null || record.monthAge === undefined) return;
      if (record.monthAge > maxMonth || record.monthAge < 0) return;
      if (record.length !== null && record.length !== undefined) {
        actualLength[record.monthAge] = Number(record.length);
      }
      if (record.weight !== null && record.weight !== undefined) {
        actualWeight[record.monthAge] = Number(record.weight);
      }
    });

    return {
      xData: monthLabels,
      series: [
        { name: '身长P3', data: lengthSeries.P3, panelIndex: 0, axisSide: 'left' },
        { name: '身长P50', data: lengthSeries.P50, panelIndex: 0, axisSide: 'left' },
        { name: '身长P97', data: lengthSeries.P97, panelIndex: 0, axisSide: 'left' },
        { name: '身长实测', data: actualLength, panelIndex: 0, axisSide: 'left' },
        { name: '体重P3', data: weightSeries.P3, panelIndex: 1, axisSide: 'right' },
        { name: '体重P50', data: weightSeries.P50, panelIndex: 1, axisSide: 'right' },
        { name: '体重P97', data: weightSeries.P97, panelIndex: 1, axisSide: 'right' },
        { name: '体重实测', data: actualWeight, panelIndex: 1, axisSide: 'right' }
      ],
      options: {
        colors: [
          '#9BB7D4',
          '#3F88C5',
          '#1C3F66',
          '#7BBF6A',
          '#F4B860',
          '#E07A5F',
          '#B34D3B',
          '#5A9367'
        ],
        showGrid: true,
        showLegend: true,
        layout: 'dualPanel',
        upperAxisLabel: '身长 (cm)',
        lowerAxisLabel: '体重 (kg)',
        upperAxisRightLabel: '身长 (cm)',
        lowerAxisRightLabel: '体重 (kg)',
        upperAxisLeft: { min: 45, max: 110, step: 1, labelEvery: 5, labelStart: 45 },
        upperAxisRight: { min: 80, max: 105, step: 1, labelEvery: 5, labelStart: 80 },
        lowerAxisLeft: { min: 2, max: 18, step: 1, labelEvery: 2, labelStart: 2 },
        lowerAxisRight: { min: 6, max: 20, step: 1, labelEvery: 2, labelStart: 6 },
        showRightAxis: true,
        showTopAxis: true,
        showBottomAxis: true,
        rightAxisAlignMode: 'panel',
        upperAxisPixelPerStep: 8,
        lowerAxisPixelPerStep: 14,
        panelGap: 0,
        padding: { top: 60, right: 50, bottom: 50, left: 50 }
      }
    };
  },

  async loadGrowthRecords() {
    try {
      const babyUid = getBabyUid();
      if (!babyUid) return;
      const db = wx.cloud.database();
      const res = await db.collection('growth_records')
        .where({ babyUid })
        .orderBy('recordDate', 'asc')
        .get();
      const parseValue = (value) => {
        if (value === '' || value === null || value === undefined) return null;
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
      };
      const records = (res.data || []).map(record => ({
        ...record,
        weight: parseValue(record.weight),
        length: parseValue(record.length),
        head: parseValue(record.head)
      }));
      this.setData({
        growthRecords: records
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
