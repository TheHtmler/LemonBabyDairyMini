const {
  buildDataRecordsSummaryPreview
} = require('../../utils/dataRecordsSummaryPreview');

const TODAY_KEY = '2026-03-28';
const DEFAULT_TAB = 'feeding';

const BASE_SUMMARY_STATE = {
  weight: '5.2',
  height: '58',
  totalMilk: 720,
  dailyCaloriesTotal: 685,
  caloriePerKg: 132,
  proteinSummaryDisplay: {
    total: '18.6',
    natural: '8.3',
    special: '4.1'
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
        protein: 5.1,
        coefficient: '1.0',
        carbs: 28,
        fat: 12
      },
      special: {
        volume: 300,
        calories: 180,
        protein: 4.8,
        coefficient: '0.8',
        carbs: 18,
        fat: 8
      }
    },
    food: {
      count: 2,
      totalCalories: 160,
      protein: 6.2,
      carbs: 18,
      fat: 4
    },
    treatment: {
      count: 1,
      totalCalories: 85,
      protein: 0,
      carbs: 25,
      fat: 0
    }
  }
};

const SUMMARY_STATE_BY_DATE = {
  '2026-03-28': BASE_SUMMARY_STATE,
  '2026-03-27': {
    ...BASE_SUMMARY_STATE,
    totalMilk: 690,
    dailyCaloriesTotal: 648,
    caloriePerKg: 125,
    proteinSummaryDisplay: {
      total: '17.9',
      natural: '7.9',
      special: '4.0'
    },
    intakeOverview: {
      milk: {
        normal: { volume: 390, calories: 240, protein: 4.8, coefficient: '0.9', carbs: 26, fat: 11 },
        special: { volume: 300, calories: 180, protein: 4.0, coefficient: '0.8', carbs: 18, fat: 8 }
      },
      food: { count: 2, totalCalories: 143, protein: 5.8, carbs: 16, fat: 3 },
      treatment: { count: 1, totalCalories: 85, protein: 0, carbs: 25, fat: 0 }
    }
  }
};

const summaryStateStore = JSON.parse(JSON.stringify(SUMMARY_STATE_BY_DATE));

const RECORD_PREVIEWS = {
  feeding: [
    { time: '06:40', title: '母乳亲喂', meta: '90 ml · 58 kcal', detail: '蛋白 1.1 g · 碳水 6 g · 脂肪 2.7 g' },
    { time: '10:20', title: '特奶', meta: '120 ml · 72 kcal', detail: '蛋白 1.9 g · 碳水 7.2 g · 脂肪 3.1 g' },
    { time: '14:30', title: '母乳瓶喂', meta: '110 ml · 68 kcal', detail: '蛋白 1.4 g · 碳水 7.1 g · 脂肪 3.2 g' }
  ],
  food: [
    { title: '上午加餐', meta: '10:10 · 2种食物', detail: '热量 68 kcal · 蛋白 2.1 g · 碳水 8.4 g · 脂肪 1.3 g', note: '南瓜泥 30g + 米粉 12g' },
    { title: '晚餐', meta: '18:20 · 2种食物', detail: '热量 92 kcal · 蛋白 4.1 g · 碳水 9.6 g · 脂肪 2.7 g', note: '鸡肉泥 20g + 土豆泥 35g' }
  ],
  medication: [
    { time: '08:00', title: '左卡尼丁', meta: '1 剂', detail: '餐后服用' },
    { time: '20:30', title: '碳酸氢钠', meta: '5 ml', detail: '晚间补充' }
  ],
  treatment: [
    { time: '09:30', title: '输液记录', meta: '2组 · 热量 85 kcal · 碳水 25 g', detail: '第1组 · 10%葡萄糖 250ml + 精氨酸 1剂\n第2组 · 5%葡萄糖 100ml + 碳酸氢钠 5ml' }
  ]
};

function pad(num) {
  return String(num).padStart(2, '0');
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatChineseDate(dateKey) {
  const date = parseDateKey(dateKey);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getWeekdayLabel(dateKey) {
  return ['日', '一', '二', '三', '四', '五', '六'][parseDateKey(dateKey).getDay()];
}

function addDays(dateKey, offset) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + offset);
  return formatDateKey(date);
}

function buildDateList(anchorDateKey, count = 7) {
  return Array.from({ length: count }, (_, index) => {
    const dateKey = addDays(anchorDateKey, -index);
    const date = parseDateKey(dateKey);
    return {
      date: dateKey,
      weekday: getWeekdayLabel(dateKey),
      day: String(date.getDate()),
      month: String(date.getMonth() + 1)
    };
  });
}

function buildCalendarDays(year, month, selectedDate) {
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();
  const todayKey = TODAY_KEY;
  const result = [];

  for (let i = firstWeekday - 1; i >= 0; i--) {
    const prevDate = new Date(year, month - 2, daysInPrevMonth - i);
    const key = formatDateKey(prevDate);
    result.push({
      date: key,
      day: prevDate.getDate(),
      isCurrentMonth: false,
      isToday: key === todayKey,
      isSelected: key === selectedDate
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month - 1, day);
    const key = formatDateKey(currentDate);
    result.push({
      date: key,
      day,
      isCurrentMonth: true,
      isToday: key === todayKey,
      isSelected: key === selectedDate
    });
  }

  while (result.length % 7 !== 0) {
    const nextIndex = result.length - (firstWeekday + daysInMonth) + 1;
    const nextDate = new Date(year, month, nextIndex);
    const key = formatDateKey(nextDate);
    result.push({
      date: key,
      day: nextDate.getDate(),
      isCurrentMonth: false,
      isToday: key === todayKey,
      isSelected: key === selectedDate
    });
  }

  return result;
}

function buildSummaryStateForDate(dateKey) {
  return {
    ...(summaryStateStore[dateKey] || BASE_SUMMARY_STATE),
    formattedSelectedDate: formatChineseDate(dateKey)
  };
}

function roundToOneDecimal(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function formatEditableNumber(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function recalculateEditableMetrics(summaryState) {
  const nextState = {
    ...summaryState,
    proteinSummaryDisplay: {
      ...(summaryState.proteinSummaryDisplay || {})
    }
  };
  const weight = parseFloat(nextState.weight);
  const totalCalories = Number(nextState.dailyCaloriesTotal || 0);
  const naturalProtein = Number(nextState.proteinSummaryDisplay.natural || 0);
  const specialProtein = Number(nextState.proteinSummaryDisplay.special || 0);

  if (!Number.isNaN(weight) && weight > 0) {
    nextState.caloriePerKg = String(roundToOneDecimal(totalCalories / weight));
    nextState.naturalProteinCoefficient = String(roundToOneDecimal(naturalProtein / weight));
    nextState.specialProteinCoefficient = String(roundToOneDecimal(specialProtein / weight));
  }

  return nextState;
}

function createInitialState(selectedDate = TODAY_KEY) {
  const dateList = buildDateList(TODAY_KEY);
  const selectedIndex = Math.max(dateList.findIndex(item => item.date === selectedDate), 0);
  const selectedDateKey = dateList[selectedIndex]?.date || TODAY_KEY;
  const selectedDateObj = parseDateKey(selectedDateKey);

  return {
    preview: buildDataRecordsSummaryPreview(buildSummaryStateForDate(selectedDateKey)),
    activeMetricInfoLabel: '',
    activeMetricInfoTitle: '',
    activeMetricInfoLines: [],
    activeTab: DEFAULT_TAB,
    selectedDate: selectedDateKey,
    selectedDateIndex: selectedIndex,
    currentDateId: `date-${selectedIndex}`,
    dateList,
    todayFullDate: formatChineseDate(selectedDateKey),
    showCalendarPicker: false,
    calendarYear: selectedDateObj.getFullYear(),
    calendarMonth: selectedDateObj.getMonth() + 1,
    calendarDays: buildCalendarDays(selectedDateObj.getFullYear(), selectedDateObj.getMonth() + 1, selectedDateKey),
    isSelectedToday: selectedDateKey === TODAY_KEY,
    feedingPreviewRecords: RECORD_PREVIEWS.feeding,
    foodPreviewRecords: RECORD_PREVIEWS.food,
    medicationPreviewRecords: RECORD_PREVIEWS.medication,
    treatmentPreviewRecords: RECORD_PREVIEWS.treatment,
    showBasicInfoModal: false,
    editingField: '',
    editingLabel: '',
    editingUnit: '',
    editBasicInfoValue: ''
  };
}

Page({
  data: createInitialState(),

  applySelectedDate(selectedDate, options = {}) {
    const dateList = options.dateList || this.data.dateList || [];
    let selectedIndex = dateList.findIndex(item => item.date === selectedDate);
    const nextDateList = selectedIndex >= 0 ? dateList : buildDateList(selectedDate);
    if (selectedIndex < 0) {
      selectedIndex = nextDateList.findIndex(item => item.date === selectedDate);
    }
    const selectedDateObj = parseDateKey(selectedDate);

    this.setData({
      preview: buildDataRecordsSummaryPreview(buildSummaryStateForDate(selectedDate)),
      selectedDate,
      selectedDateIndex: selectedIndex,
      currentDateId: `date-${selectedIndex}`,
      dateList: nextDateList,
      todayFullDate: formatChineseDate(selectedDate),
      showCalendarPicker: false,
      calendarYear: selectedDateObj.getFullYear(),
      calendarMonth: selectedDateObj.getMonth() + 1,
      calendarDays: buildCalendarDays(selectedDateObj.getFullYear(), selectedDateObj.getMonth() + 1, selectedDate),
      isSelectedToday: selectedDate === TODAY_KEY
    });
  },

  onDateItemClick(e) {
    const selectedDate = e.currentTarget.dataset.date;
    if (!selectedDate) return;
    this.applySelectedDate(selectedDate);
  },

  showCalendar() {
    this.setData({
      showCalendarPicker: true
    });
  },

  hideCalendar() {
    this.setData({
      showCalendarPicker: false
    });
  },

  preventBubble() {},

  prevMonth() {
    let { calendarYear, calendarMonth, selectedDate } = this.data;
    calendarMonth -= 1;
    if (calendarMonth < 1) {
      calendarYear -= 1;
      calendarMonth = 12;
    }
    this.setData({
      calendarYear,
      calendarMonth,
      calendarDays: buildCalendarDays(calendarYear, calendarMonth, selectedDate)
    });
  },

  nextMonth() {
    let { calendarYear, calendarMonth, selectedDate } = this.data;
    calendarMonth += 1;
    if (calendarMonth > 12) {
      calendarYear += 1;
      calendarMonth = 1;
    }
    this.setData({
      calendarYear,
      calendarMonth,
      calendarDays: buildCalendarDays(calendarYear, calendarMonth, selectedDate)
    });
  },

  selectCalendarDay(e) {
    const selectedDate = e.currentTarget.dataset.date;
    const isCurrentMonth = e.currentTarget.dataset.current;
    if (!selectedDate || !isCurrentMonth) return;
    this.applySelectedDate(selectedDate, {
      dateList: buildDateList(selectedDate)
    });
  },

  goToToday() {
    this.applySelectedDate(TODAY_KEY, {
      dateList: buildDateList(TODAY_KEY)
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab) return;
    this.setData({ activeTab: tab });
  },

  openBasicInfoEditor(e) {
    const { field = '', label = '', unit = '' } = e.currentTarget.dataset || {};
    if (!field) return;
    const currentSummaryState = buildSummaryStateForDate(this.data.selectedDate);
    this.setData({
      showBasicInfoModal: true,
      editingField: field,
      editingLabel: label,
      editingUnit: unit,
      editBasicInfoValue: formatEditableNumber(currentSummaryState[field])
    });
  },

  closeBasicInfoModal() {
    this.setData({
      showBasicInfoModal: false,
      editingField: '',
      editingLabel: '',
      editingUnit: '',
      editBasicInfoValue: ''
    });
  },

  onBasicInfoInput(e) {
    this.setData({
      editBasicInfoValue: e.detail.value || ''
    });
  },

  confirmBasicInfoEdit() {
    const { editingField, editBasicInfoValue, selectedDate, editingLabel } = this.data;
    const value = String(editBasicInfoValue || '').trim();
    if (!editingField) return;
    if (!value) {
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({ title: '请输入有效数值', icon: 'none' });
      }
      return;
    }
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed) || parsed <= 0) {
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({ title: '请输入有效数值', icon: 'none' });
      }
      return;
    }

    const currentSummaryState = {
      ...(summaryStateStore[selectedDate] || BASE_SUMMARY_STATE)
    };
    currentSummaryState[editingField] = String(parsed);
    const nextSummaryState = recalculateEditableMetrics(currentSummaryState);
    summaryStateStore[selectedDate] = nextSummaryState;

    this.setData({
      preview: buildDataRecordsSummaryPreview(buildSummaryStateForDate(selectedDate)),
      showBasicInfoModal: false,
      editingField: '',
      editingLabel: '',
      editingUnit: '',
      editBasicInfoValue: ''
    });

    if (typeof wx !== 'undefined' && wx.showToast) {
      wx.showToast({
        title: `${editingLabel || '基础信息'}已更新`,
        icon: 'success'
      });
    }
  },

  showPreviewToast() {
    if (typeof wx !== 'undefined' && wx.showToast) {
      wx.showToast({
        title: '预览页仅展示样式',
        icon: 'none'
      });
    }
  },

  toggleMetricInfo(e) {
    const { label = '', title = '', lines = [] } = e.currentTarget.dataset || {};
    if (!label || !lines.length) return;
    if (this.data.activeMetricInfoLabel === label) {
      this.setData({
        activeMetricInfoLabel: '',
        activeMetricInfoTitle: '',
        activeMetricInfoLines: []
      });
      return;
    }
    this.setData({
      activeMetricInfoLabel: label,
      activeMetricInfoTitle: title,
      activeMetricInfoLines: lines
    });
  },

  hideMetricInfo() {
    this.setData({
      activeMetricInfoLabel: '',
      activeMetricInfoTitle: '',
      activeMetricInfoLines: []
    });
  },

  stopBubble() {}
});
