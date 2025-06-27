// 获取某月的天数
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 获取某天是星期几
function getWeekday(date) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return weekdays[date.getDay()];
}

// 引入营养设置模型
const NutritionModel = require('../../models/nutrition');
// 引入药物记录模型
const MedicationRecordModel = require('../../models/medicationRecord');

Page({
  data: {
    selectedDate: '',
    formattedSelectedDate: '', // 格式化后的日期显示
    dateList: [],
    feedingRecords: [],
    medicationRecords: [],
    groupedMedicationRecords: [], // 按药物名称分组的药物记录
    totalNaturalMilk: 0,
    totalSpecialMilk: 0,
    totalMilk: 0,
    totalPowderWeight: 0,
    totalFormulaPowderWeight: 0, // 新增普通奶粉重量统计
    // 生长数据
    weight: '--',
    height: '--',
    // 蛋白质系数
    naturalProteinCoefficient: 0, // 天然蛋白系数 g/kg
    specialProteinCoefficient: 0, // 特殊蛋白系数 g/kg
    // 日历相关数据
    showCalendarPicker: false,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth() + 1,
    calendarDays: [],
    // 滚动相关
    currentDateId: '',
    selectedDateIndex: 0,
    isReturning: false,
    showAddFeedingModal: false,
    showAddMedicationModal: false,
    // 新增记录相关
    newFeeding: {
      startTime: '',
      endTime: '',
      naturalMilkVolume: '',
      totalVolume: '',
      specialMilkVolume: 0
    },
    newMedication: {
      name: '',
      dosage: '',
      unit: '',
      time: ''
    },
    // 编辑相关
    showEditFeedingModal: false,
    showEditMedicationModal: false,
    editingFeedingIndex: -1,
    editingMedicationIndex: -1,
    editingFeeding: null,
    editingMedication: null,
    // 其他
    medications: [], // 药物配置列表
    showDeleteConfirm: false,
    deleteConfirmMessage: '',
    deleteType: '', // 'feeding' 或 'medication'
    deleteIndex: -1,
    deleteRecordId: '', // 药物记录的ID
    todayFullDate: '', // 今日完整日期（年月日）
    babyInfo: null, // 存储宝宝基本信息
    isDataLoading: false, // 新增数据加载状态
    scrollTimer: null, // 滚动定时器
    dateRangeLength: 30, // 显示最近30天记录
    // 营养参数设置
    nutritionSettings: null,
    proteinSourceType: 'breastMilk', // 默认蛋白质来源类型为母乳
  },

  onLoad: function() {
    // 确保云环境已初始化
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        traceUser: true,
      });
    }
    
    this.initDateList();
    
    // 获取并格式化今天的日期
    const today = new Date();
    const formattedDate = this.formatDate(today);
    
    // 格式化今日完整日期显示（年月日）
    const todayFullDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    
    this.setData({
      selectedDate: formattedDate,
      formattedSelectedDate: this.formatDisplayDate(formattedDate),
      currentDateId: 'date-0', // 默认选中今天
      selectedDateIndex: 0,
      todayFullDate: todayFullDate
    });
    
    // 获取宝宝基本信息（用于获取默认体重）
    this.getBabyInfo();
    
    // 先加载营养参数设置，再加载记录数据
    this.loadNutritionSettings().then(() => {
      // 只在onLoad时获取一次数据，避免重复查询
      this.fetchDailyRecords(formattedDate);
    });
    
    this.initCalendar(today.getFullYear(), today.getMonth() + 1);
    this.loadMedications();
  },

  onShow: function() {
    // 仅当页面从其他页面返回时再次获取数据，避免与onLoad重复
    if (this.data.selectedDate && this.data.isReturning) {
      this.fetchDailyRecords(this.data.selectedDate);
      this.setData({ isReturning: false });
    } else if (!this.data.isReturning) {
      // 标记为即将返回，以便下次onShow时刷新数据
      this.setData({ isReturning: true });
    }
  },

  // 初始化快速选择日期列表
  initDateList: function() {
    const today = new Date();
    const dateList = [];
    
    // 获取最近30天的日期列表(增加显示范围)
    for (let i = 0; i < this.data.dateRangeLength; i++) {
      const date = new Date();
      date.setDate(today.getDate() - i);
      dateList.push({
        id: `date-${i}`,
        date: this.formatDate(date),
        day: date.getDate(),
        month: date.getMonth() + 1,
        weekday: getWeekday(date),
        isToday: i === 0
      });
    }
    
    this.setData({ dateList });
  },

  // 初始化日历数据
  initCalendar: function(year, month) {
    const firstDay = new Date(year, month - 1, 1).getDay(); // 这个月第一天是星期几
    const daysInMonth = getDaysInMonth(year, month);
    const daysInPrevMonth = getDaysInMonth(year, month - 1);
    
    const calendarDays = [];
    
    // 上个月的日期
    for (let i = 0; i < firstDay; i++) {
      const day = daysInPrevMonth - firstDay + i + 1;
      const date = new Date(year, month - 2, day);
      calendarDays.push({
        day,
        date: this.formatDate(date),
        isCurrentMonth: false,
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    // 当前月的日期
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month - 1, i);
      calendarDays.push({
        day: i,
        date: this.formatDate(date),
        isCurrentMonth: true,
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    // 补充下个月的日期，让日历呈现6行7列的形式
    const totalDays = 42; // 6行7列
    const remainingDays = totalDays - calendarDays.length;
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month, i);
      calendarDays.push({
        day: i,
        date: this.formatDate(date),
        isCurrentMonth: false,
        isToday: this.formatDate(date) === this.formatDate(new Date())
      });
    }
    
    this.setData({
      calendarYear: year,
      calendarMonth: month,
      calendarDays
    });
  },

  // 格式化日期为YYYY-MM-DD形式
  formatDate: function(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
  
  // 格式化日期为更易读的显示形式，如"2023年5月21日 星期日"
  formatDisplayDate: function(dateStr) {
    if (!dateStr) return '';
    
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    
    return `${year}年${month}月${day}日 星期${weekday}`;
  },

  // 格式化时间为HH:mm
  formatTime: function(dateObj) {
    if (!dateObj) return '';
    
    // 确保传入的是Date对象
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
    
    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      console.error('无效的日期:', dateObj);
      return '';
    }
    
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  },

  // 日期选择相关方法
  onDateSelected: function(e) {
    const selectedDate = e.currentTarget.dataset.date;
    const index = e.currentTarget.dataset.index || 0;
    
    this.setData({ 
      selectedDate,
      formattedSelectedDate: this.formatDisplayDate(selectedDate),
      selectedDateIndex: index,
      currentDateId: `date-${index}`
    });
    
    this.fetchDailyRecords(selectedDate);
  },

  // 添加日期项点击处理函数
  onDateItemClick: function(e) {
    this.onDateSelected(e);
  },

  showCalendar: function() {
    this.setData({ showCalendarPicker: true });
  },

  hideCalendar: function() {
    this.setData({ showCalendarPicker: false });
  },

  prevMonth: function() {
    let year = this.data.calendarYear;
    let month = this.data.calendarMonth - 1;
    
    if (month < 1) {
      year--;
      month = 12;
    }
    
    this.initCalendar(year, month);
  },

  nextMonth: function() {
    let year = this.data.calendarYear;
    let month = this.data.calendarMonth + 1;
    
    if (month > 12) {
      year++;
      month = 1;
    }
    
    this.initCalendar(year, month);
  },

  selectCalendarDay: function(e) {
    const selectedDate = e.currentTarget.dataset.date;
    
    // 查找日期在列表中的索引，如果找到则更新滚动位置
    const index = this.data.dateList.findIndex(item => item.date === selectedDate);
    const scrollId = index !== -1 ? `date-${index}` : '';
    
    this.setData({ 
      selectedDate,
      formattedSelectedDate: this.formatDisplayDate(selectedDate),
      showCalendarPicker: false,
      selectedDateIndex: index !== -1 ? index : this.data.selectedDateIndex,
      currentDateId: scrollId
    });
    
    this.fetchDailyRecords(selectedDate);
  },

  goToToday: function() {
    const today = new Date();
    const formattedDate = this.formatDate(today);
    
    this.setData({
      selectedDate: formattedDate,
      formattedSelectedDate: this.formatDisplayDate(formattedDate),
      showCalendarPicker: false,
      selectedDateIndex: 0,
      currentDateId: 'date-0'
    });
    
    this.fetchDailyRecords(formattedDate);
    this.initCalendar(today.getFullYear(), today.getMonth() + 1);
  },

  // 获取当天的详细记录
  async fetchDailyRecords(dateStr) {
    // 先设置数据区域透明，创建平滑过渡效果
    this.setData({
      isDataLoading: true
    });
    
    wx.showLoading({ title: '加载中...' });
    
    try {
      // 确保营养设置已加载
      if (!this.data.nutritionSettings) {
        await this.loadNutritionSettings();
      }
      
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 将日期字符串转换为Date对象
      const [year, month, day] = dateStr.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      let query = {
        date: _.gte(startOfDay).and(_.lte(endOfDay))
      };
      
      // 如果有宝宝UID，添加到查询条件
      if (babyUid) {
        query.babyUid = babyUid;
      } else {
        console.warn('未找到宝宝UID，将查询所有记录（可能不准确）');
      }
      
      // 并行查询喂养记录和药物记录
      const [feedingResult, medicationResult] = await Promise.all([
        db.collection('feeding_records').where(query).get(),
        MedicationRecordModel.findByDate(dateStr, babyUid)
      ]);
      
      if (feedingResult.data && feedingResult.data.length > 0) {
        const record = feedingResult.data[0];
        
        // 设置体重数据，兼容新旧数据结构
        let recordWeight = '';
        
        // 新数据结构
        if (record.basicInfo && record.basicInfo.weight !== undefined) {
          recordWeight = record.basicInfo.weight;
        } 
        // 旧数据结构
        else if (record.weight !== undefined) {
          recordWeight = record.weight;
        }
        
        // 获取药物记录数据
        const medicationRecordsToSet = (medicationResult.success ? medicationResult.data : []) || [];
        
        this.setData({
          recordId: record._id,
          feedings: record.feedings || [],
          medicationRecords: medicationRecordsToSet,
          weight: recordWeight || (this.data.babyInfo ? this.data.babyInfo.weight : '--'),
          hasRecord: true,
          isDataLoading: false // 设置数据加载完成
        });
        
        // 处理喂奶和用药记录
        this.processFeedingData(record.feedings || []);
        this.processMedicationData(medicationRecordsToSet);
      } else {
        // 没有喂养记录，但可能有药物记录
        const medicationRecordsToSet = (medicationResult.success ? medicationResult.data : []) || [];
        const defaultWeight = this.data.babyInfo ? this.data.babyInfo.weight : '--';
        
        this.setData({
          recordId: '',
          feedings: [],
          medicationRecords: medicationRecordsToSet,
          weight: defaultWeight,
          hasRecord: medicationRecordsToSet.length > 0, // 如果有药物记录，也算有记录
          feedingRecords: [],
          totalNaturalMilk: 0,
          totalSpecialMilk: 0,
          totalMilk: 0,
                  totalPowderWeight: 0,
        totalFormulaPowderWeight: 0,
        naturalProteinCoefficient: 0,
        specialProteinCoefficient: 0,
          isDataLoading: false // 设置数据加载完成
        });
        
        // 处理药物记录
        this.processMedicationData(medicationRecordsToSet);
      }
      
      wx.hideLoading();
    } catch (error) {
      console.error('获取当日记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '获取记录失败',
        icon: 'error'
      });
      
      // 即使加载失败也要重置加载状态
      this.setData({
        isDataLoading: false
      });
    }
  },

  // 强制刷新数据（不使用缓存）
  async forceRefreshData() {
    try {
      // 清除本地数据
      this.setData({
        feedingRecords: [],
        medicationRecords: [],
        groupedMedicationRecords: [],
        hasRecord: false
      });
      
      // 重新获取数据
      await this.fetchDailyRecords(this.data.selectedDate);
      
      console.log('数据强制刷新完成');
    } catch (error) {
      console.error('强制刷新数据失败:', error);
      wx.showToast({
        title: '刷新数据失败',
        icon: 'error'
      });
    }
  },

  // 处理喂奶数据
  processFeedingData: function(feedingRecords) {
    if (!feedingRecords || feedingRecords.length === 0) {
      this.setData({
        noFeeding: true,
        feedingRecords: [],
        totalNaturalMilk: 0,
        totalSpecialMilk: 0,
        totalMilk: 0,
        totalPowderWeight: 0,
        totalFormulaPowderWeight: 0,
        naturalProteinCoefficient: 0,
        specialProteinCoefficient: 0
      });
      return;
    }

    console.log('处理喂奶记录数据:', JSON.stringify(feedingRecords));
    
    // 按时间排序（优先使用startDateTime，其次使用startTime）
    feedingRecords.sort((a, b) => {
      let timeA, timeB;
      
      // 优先使用startDateTime进行排序
      if (a.startDateTime && b.startDateTime) {
        timeA = a.startDateTime instanceof Date ? a.startDateTime : new Date(a.startDateTime);
        timeB = b.startDateTime instanceof Date ? b.startDateTime : new Date(b.startDateTime);
        return timeA - timeB;
      }
      
      // 其次使用startTime进行排序
      if (a.startTime && b.startTime) {
        timeA = a.startTime instanceof Date ? a.startTime : new Date(a.startTime);
        timeB = b.startTime instanceof Date ? b.startTime : new Date(b.startTime);
        return timeA - timeB;
      }
      
      return 0;
    });
    
    // 处理每条记录的时间显示和持续时间计算
    const processedRecords = feedingRecords.map(record => {
      console.log('处理记录:', record);
      
      // 格式化开始时间
      let formattedStartTime = '--:--';
      if (record.startTime && typeof record.startTime === 'string' && record.startTime.includes(':')) {
        formattedStartTime = record.startTime;
      } else if (record.startDateTime) {
        const date = record.startDateTime instanceof Date ? record.startDateTime : new Date(record.startDateTime);
        if (!isNaN(date.getTime())) {
          formattedStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      } else if (record.startTime) {
        const date = record.startTime instanceof Date ? record.startTime : new Date(record.startTime);
        if (!isNaN(date.getTime())) {
          formattedStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      }
      
      // 格式化结束时间
      let formattedEndTime = '--:--';
      if (record.endTime && typeof record.endTime === 'string' && record.endTime.includes(':')) {
        formattedEndTime = record.endTime;
      } else if (record.endDateTime) {
        const date = record.endDateTime instanceof Date ? record.endDateTime : new Date(record.endDateTime);
        if (!isNaN(date.getTime())) {
          formattedEndTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      } else if (record.endTime) {
        const date = record.endTime instanceof Date ? record.endTime : new Date(record.endTime);
        if (!isNaN(date.getTime())) {
          formattedEndTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        }
      }
      
      // 计算持续时间
      let duration = 0;
      try {
        let startDateTime, endDateTime;
        
        // 获取开始时间Date对象
        if (record.startDateTime) {
          startDateTime = record.startDateTime instanceof Date ? record.startDateTime : new Date(record.startDateTime);
        } else if (record.startTime) {
          if (record.startTime instanceof Date) {
            startDateTime = record.startTime;
          } else if (typeof record.startTime === 'string' && record.startTime.includes(':')) {
            const today = new Date();
            const [hours, minutes] = record.startTime.split(':').map(Number);
            startDateTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
          }
        }
        
        // 获取结束时间Date对象
        if (record.endDateTime) {
          endDateTime = record.endDateTime instanceof Date ? record.endDateTime : new Date(record.endDateTime);
        } else if (record.endTime) {
          if (record.endTime instanceof Date) {
            endDateTime = record.endTime;
          } else if (typeof record.endTime === 'string' && record.endTime.includes(':')) {
            const today = new Date();
            const [hours, minutes] = record.endTime.split(':').map(Number);
            endDateTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
          }
        }
        
        // 计算持续时间
        if (startDateTime && endDateTime && !isNaN(startDateTime.getTime()) && !isNaN(endDateTime.getTime())) {
          // 如果结束时间小于开始时间，可能是跨天记录
          if (endDateTime < startDateTime) {
            endDateTime.setDate(endDateTime.getDate() + 1);
          }
          duration = Math.round((endDateTime - startDateTime) / 60000); // 转为分钟
        }
      } catch (error) {
        console.error('计算持续时间出错:', error);
        duration = 0;
      }
      
      return {
        ...record,
        formattedStartTime: formattedStartTime,
        formattedEndTime: formattedEndTime,
        duration: duration
      };
    });

    this.setData({
      noFeeding: false,
      feedingRecords: processedRecords
    });

    // 计算总量
    this.calculateTotalMilk(feedingRecords);
  },

  // 计算总奶量
  calculateTotalMilk: function(records) {
    let totalNaturalMilk = 0;
    let totalSpecialMilk = 0;
    
    records.forEach(record => {
      totalNaturalMilk += parseFloat(record.naturalMilkVolume || 0);
      totalSpecialMilk += parseFloat(record.specialMilkVolume || 0);
    });
    
    // 计算总奶量
    const totalMilk = totalNaturalMilk + totalSpecialMilk;
    
    // 计算奶粉克重
    let totalPowderWeight = 0;
    let totalFormulaPowderWeight = 0; // 单独统计普通奶粉重量
    
    // 确保营养设置已加载
    if (this.data.nutritionSettings) {
      console.log('计算奶粉克重:', this.data.proteinSourceType, this.data.nutritionSettings);
      
      // 根据蛋白质来源类型和营养设置计算奶粉克重
      if (this.data.proteinSourceType === 'formulaMilk' && 
          this.data.nutritionSettings.formula_milk_ratio) {
        // 普通奶粉的配比计算
        const ratio = this.data.nutritionSettings.formula_milk_ratio;
        const powderWeight = (totalNaturalMilk * ratio.powder) / ratio.water;
        totalFormulaPowderWeight = Math.round(powderWeight * 10) / 10; // 保留一位小数
        totalPowderWeight += totalFormulaPowderWeight;
        console.log('普通奶粉克重:', totalFormulaPowderWeight);
      }
      
      // 特奶的配比计算
      if (this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        const specialPowderWeight = (totalSpecialMilk * ratio.powder) / ratio.water;
        totalPowderWeight += Math.round(specialPowderWeight * 10) / 10; // 保留一位小数
        console.log('特奶粉克重:', Math.round(specialPowderWeight * 10) / 10);
      } else {
        console.warn('未找到特奶配比设置，无法计算特奶粉重');
      }
    } else {
      console.warn('营养设置未加载，无法准确计算奶粉克重');
      
      // 使用默认比例进行计算，避免显示为0
      // 默认特奶配比 13.5g/90ml
      const defaultSpecialRatio = 13.5 / 90;
      const specialPowderWeight = totalSpecialMilk * defaultSpecialRatio;
      totalPowderWeight += Math.round(specialPowderWeight * 10) / 10;
      
      // 如果是普通奶粉模式，使用默认比例 7g/100ml
      if (this.data.proteinSourceType === 'formulaMilk') {
        const defaultFormulaRatio = 7 / 100;
        const formulaPowderWeight = totalNaturalMilk * defaultFormulaRatio;
        totalFormulaPowderWeight = Math.round(formulaPowderWeight * 10) / 10;
        totalPowderWeight += totalFormulaPowderWeight;
      }
    }
    
    // 计算蛋白质系数
    let naturalProteinCoefficient = 0;
    let specialProteinCoefficient = 0;
    
    // 获取当前体重，确保是数字
    const currentWeight = parseFloat(this.data.weight);
    
    if (currentWeight && currentWeight > 0) {
      // 计算天然蛋白摄入量（根据蛋白质来源类型）
      let naturalProteinIntake = 0;
      
      if (this.data.proteinSourceType === 'breastMilk') {
        // 母乳蛋白质浓度：1.1g/100ml
        naturalProteinIntake = (totalNaturalMilk * 1.1) / 100;
      } else if (this.data.proteinSourceType === 'formulaMilk' && this.data.nutritionSettings) {
        // 普通奶粉蛋白质含量需要从营养设置中获取
        if (this.data.nutritionSettings.formula_milk_protein_concentration) {
          // 如果有设置蛋白质浓度（g/100ml）
          naturalProteinIntake = (totalNaturalMilk * this.data.nutritionSettings.formula_milk_protein_concentration) / 100;
        } else if (this.data.nutritionSettings.formula_milk_ratio) {
          // 否则根据奶粉配比和默认蛋白质含量计算
          // 假设奶粉蛋白质含量为20g/100g奶粉
          const ratio = this.data.nutritionSettings.formula_milk_ratio;
          const powderWeight = (totalNaturalMilk * ratio.powder) / ratio.water;
          naturalProteinIntake = (powderWeight * 20) / 100; // 20%蛋白质含量
        }
      }
      
      // 计算特殊蛋白摄入量
      // 特奶蛋白质浓度：13.1g/100g奶粉，配比13.5g/90ml
      let specialProteinIntake = 0;
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        const specialPowderWeight = (totalSpecialMilk * ratio.powder) / ratio.water;
        specialProteinIntake = (specialPowderWeight * 13.1) / 100;
      } else {
        // 使用默认配比 13.5g/90ml
        const defaultSpecialPowderWeight = (totalSpecialMilk * 13.5) / 90;
        specialProteinIntake = (defaultSpecialPowderWeight * 13.1) / 100;
      }
      
      // 计算系数（g/kg）
      naturalProteinCoefficient = Math.round((naturalProteinIntake / currentWeight) * 100) / 100; // 保留两位小数
      specialProteinCoefficient = Math.round((specialProteinIntake / currentWeight) * 100) / 100; // 保留两位小数
      
      console.log('蛋白质系数计算:', {
        totalNaturalMilk,
        totalSpecialMilk,
        currentWeight,
        naturalProteinIntake,
        specialProteinIntake,
        naturalProteinCoefficient,
        specialProteinCoefficient
      });
    }
    
    this.setData({
      totalNaturalMilk: Math.round(totalNaturalMilk),
      totalSpecialMilk: Math.round(totalSpecialMilk),
      totalMilk: Math.round(totalMilk),
      totalPowderWeight: totalPowderWeight,
      totalFormulaPowderWeight: totalFormulaPowderWeight, // 新增普通奶粉重量统计
      naturalProteinCoefficient: naturalProteinCoefficient,
      specialProteinCoefficient: specialProteinCoefficient
    });
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    if (this.data.selectedDate) {
      this.fetchDailyRecords(this.data.selectedDate);
    }
    wx.stopPullDownRefresh();
  },

  // 获取最近的喂奶记录数据作为默认值
  async getLatestFeedingData() {
    try {
      // 首先检查当前选择日期的记录
      if (this.data.feedingRecords?.length > 0) {
        const lastFeeding = this.data.feedingRecords[this.data.feedingRecords.length - 1];
        return {
          naturalMilkVolume: lastFeeding.naturalMilkVolume || '',
          specialMilkVolume: lastFeeding.specialMilkVolume || '0',
          formulaPowderWeight: lastFeeding.formulaPowderWeight || '0'
        };
      }
      
      // 如果当前日期没有记录，查询最近的历史记录
      const db = wx.cloud.database();
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取历史记录');
        return this.getCalculatedDefaultValues();
      }
      
      // 查询最近7天的记录
      const selectedDate = new Date(this.data.selectedDate);
      const sevenDaysAgo = new Date(selectedDate);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const result = await db.collection('feeding_records')
        .where({
          babyUid: babyUid,
          date: db.command.gte(sevenDaysAgo).and(db.command.lt(selectedDate))
        })
        .orderBy('date', 'desc')
        .limit(5)
        .get();
      
      // 查找最新的喂奶记录
      for (const record of result.data) {
        if (record.feedings && record.feedings.length > 0) {
          // 获取该天最后一次喂奶记录
          const sortedFeedings = record.feedings.sort((a, b) => {
            const timeA = a.startDateTime ? new Date(a.startDateTime) : new Date(`2000-01-01 ${a.startTime || '00:00'}`);
            const timeB = b.startDateTime ? new Date(b.startDateTime) : new Date(`2000-01-01 ${b.startTime || '00:00'}`);
            return timeB - timeA;
          });
          
          const latestFeeding = sortedFeedings[0];
          return {
            naturalMilkVolume: latestFeeding.naturalMilkVolume || '',
            specialMilkVolume: latestFeeding.specialMilkVolume || '0',
            formulaPowderWeight: latestFeeding.formulaPowderWeight || '0'
          };
        }
      }
      
      // 如果没有找到历史记录，返回计算的默认值
      return this.getCalculatedDefaultValues();
      
    } catch (error) {
      console.error('获取最近喂奶记录失败:', error);
      return this.getCalculatedDefaultValues();
    }
  },

  // 基于体重计算的默认值
  getCalculatedDefaultValues() {
    if (this.data.babyInfo?.weight && this.data.nutritionSettings) {
      const weight = parseFloat(this.data.babyInfo.weight);
      const settings = this.data.nutritionSettings;
      
      // 计算每日所需天然蛋白量
      const dailyNaturalProtein = weight * (settings.natural_protein_coefficient || 1.2);
      
      // 计算每日所需天然奶量
      const naturalMilkNeeded = (dailyNaturalProtein * 100) / (settings.natural_milk_protein || 1.1);
      
      // 假设一天8顿，计算每顿的理想量
      const perFeedingNaturalMilk = naturalMilkNeeded / 8;
      
      if (perFeedingNaturalMilk > 0) {
        return {
          naturalMilkVolume: Math.round(perFeedingNaturalMilk).toString(),
          specialMilkVolume: '0',
          formulaPowderWeight: '0'
        };
      }
    }
    
    // 兜底默认值
    return {
      naturalMilkVolume: '',
      specialMilkVolume: '0',
      formulaPowderWeight: '0'
    };
  },

  // 显示补充喂奶记录弹窗
  async showAddFeedingModal() {
    // 默认设置当前时间
    const now = new Date();
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hour}:${minute}`;
    
    // 默认结束时间比开始时间晚30分钟
    const endTime = new Date(now.getTime() + 30 * 60000);
    const endHour = endTime.getHours().toString().padStart(2, '0');
    const endMinute = endTime.getMinutes().toString().padStart(2, '0');
    const endTimeStr = `${endHour}:${endMinute}`;
    
    // 获取最近的喂奶数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    // 计算总奶量
    const naturalMilk = parseFloat(defaultValues.naturalMilkVolume) || 0;
    const specialMilk = parseFloat(defaultValues.specialMilkVolume) || 0;
    const totalVolume = naturalMilk + specialMilk;
    
    this.setData({
      showAddFeedingModal: true,
      newFeeding: {
        startTime: currentTime,
        endTime: endTimeStr,
        naturalMilkVolume: defaultValues.naturalMilkVolume,
        specialMilkVolume: defaultValues.specialMilkVolume,
        totalVolume: totalVolume.toString(),
        specialPowderWeight: 0,
        formulaPowderWeight: defaultValues.formulaPowderWeight
      }
    });
    
    // 重新计算特奶粉重量
    if (specialMilk > 0) {
      let specialPowderWeight = 0;
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        specialPowderWeight = Math.round((specialMilk * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        specialPowderWeight = Math.round((specialMilk * 13.5 / 90) * 10) / 10;
      }
      
      this.setData({
        'newFeeding.specialPowderWeight': specialPowderWeight
      });
    }
  },

  // 隐藏补充喂奶记录弹窗
  hideAddFeedingModal() {
    console.log('隐藏喂奶记录弹窗');
    this.setData({
      showAddFeedingModal: false
    });
  },

  // 显示补充用药记录弹窗
  showAddMedicationModal() {
    console.log('显示用药记录弹窗', this.data.showAddMedicationModal);
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    this.setData({
      showAddMedicationModal: true
    }, () => {
      console.log('设置完成，弹窗状态:', this.data.showAddMedicationModal);
      this.setData({
        newMedication: {
          name: '',
          volume: '',
          time: currentTime
        }
      });
    });
  },

  // 隐藏补充用药记录弹窗
  hideAddMedicationModal() {
    console.log('隐藏用药记录弹窗');
    this.setData({
      showAddMedicationModal: false,
      newMedication: {
        name: '',
        dosage: '',
        unit: '',
        time: ''
      }
    });
  },

  // 新喂奶记录输入处理
  onNewFeedingInput(e) {
    console.log('喂奶记录输入', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const newFeeding = { ...this.data.newFeeding };
    
    newFeeding[field] = value;
    
    // 重新计算总奶量（天然奶量 + 特奶量）
    if (field === 'specialMilkVolume' || field === 'naturalMilkVolume') {
      const natural = parseFloat(newFeeding.naturalMilkVolume) || 0;
      const special = parseFloat(newFeeding.specialMilkVolume) || 0;
      newFeeding.totalVolume = (natural + special).toFixed(1);
      
      // 计算特奶奶粉重量（根据配比 13.5g/90ml）
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        newFeeding.specialPowderWeight = Math.round((special * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        newFeeding.specialPowderWeight = Math.round((special * 13.5 / 90) * 10) / 10;
      }
      
      // 如果是普通奶粉，计算奶粉重量
      if (this.data.proteinSourceType === 'formulaMilk' && field === 'naturalMilkVolume') {
        if (this.data.nutritionSettings && this.data.nutritionSettings.formula_milk_ratio) {
          const ratio = this.data.nutritionSettings.formula_milk_ratio;
          newFeeding.formulaPowderWeight = Math.round((natural * ratio.powder / ratio.water) * 10) / 10;
        } else {
          // 使用默认配比 7g/100ml
          newFeeding.formulaPowderWeight = Math.round((natural * 7 / 100) * 10) / 10;
        }
      }
    }
    
    this.setData({ newFeeding });
  },

  // 新喂奶记录时间选择处理
  onNewFeedingTimeChange(e) {
    console.log('喂奶记录时间变更', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const newFeeding = { ...this.data.newFeeding };
    newFeeding[field] = e.detail.value;
    this.setData({ newFeeding });
  },

  // 新用药记录输入处理
  onNewMedicationInput(e) {
    console.log('用药记录输入', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const newMedication = { ...this.data.newMedication };
    newMedication[field] = e.detail.value;
    this.setData({ newMedication });
  },

  // 新用药记录时间选择处理
  onNewMedicationTimeChange(e) {
    console.log('用药记录时间变更', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const newMedication = { ...this.data.newMedication };
    newMedication[field] = e.detail.value;
    this.setData({ newMedication });
  },

  // 保存新的喂奶记录
  async saveNewFeeding() {
    console.log('保存喂奶记录', this.data.newFeeding);
    
    const { startTime, endTime, naturalMilkVolume, totalVolume } = this.data.newFeeding;
    
    // 验证输入
    if (!startTime || !endTime) {
      wx.showToast({
        title: '请选择喂奶时间',
        icon: 'none'
      });
      return;
    }
    
    if (!naturalMilkVolume || !totalVolume) {
      wx.showToast({
        title: '请输入奶量',
        icon: 'none'
      });
      return;
    }
    
    // 验证结束时间大于开始时间
    const selectedDate = this.data.selectedDate; // 格式: YYYY-MM-DD
    const [year, month, day] = selectedDate.split('-').map(Number);
    
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    
    const startDateTime = new Date(year, month - 1, day, startHour, startMinute, 0);
    const endDateTime = new Date(year, month - 1, day, endHour, endMinute, 0);
    
    // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
    if (endDateTime < startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }
    
    if (endDateTime <= startDateTime) {
      wx.showToast({
        title: '结束时间必须大于开始时间',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 获取当天的开始和结束时间
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 查询当天的记录
      let query = {
        date: _.gte(startOfDay).and(_.lte(endOfDay))
      };
      
      // 如果有宝宝UID，添加到查询条件
      if (babyUid) {
        query.babyUid = babyUid;
      }
      
      const res = await db.collection('feeding_records').where(query).get();

      const feeding = {
        startTime: startTime,           // 字符串格式，用于显示
        endTime: endTime,               // 字符串格式，用于显示
        startDateTime: startDateTime,   // Date对象，用于排序和比较
        endDateTime: endDateTime,       // Date对象，用于排序和比较
        naturalMilkVolume: parseFloat(naturalMilkVolume) || 0,
        specialMilkVolume: parseFloat(this.data.newFeeding.specialMilkVolume) || 0,
        totalVolume: parseFloat(this.data.newFeeding.totalVolume) || 0,
        formulaPowderWeight: parseFloat(this.data.newFeeding.formulaPowderWeight) || 0, // 添加奶粉重量
        babyUid: babyUid,          // 添加宝宝UID关联
        createdAt: new Date()      // 添加创建时间戳
      };

      if (res.data.length > 0) {
        // 更新现有记录
        await db.collection('feeding_records').doc(res.data[0]._id).update({
          data: {
            feedings: _.push([feeding]),
            updatedAt: db.serverDate()
          }
        });
      } else {
        // 创建新记录，使用新的数据结构
        const basicInfo = {
          weight: this.data.weight || '' // 添加体重记录到basicInfo
        };
        
        await db.collection('feeding_records').add({
          data: {
            date: startOfDay,
            basicInfo: basicInfo,   // 使用新的结构
            feedings: [feeding],
            medicationRecords: [],
            babyUid: babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      // 强制重新加载数据
      await this.forceRefreshData();
      this.hideAddFeedingModal();

    } catch (error) {
      console.error('保存喂奶记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 保存新的用药记录
  async saveNewMedication() {
    console.log('保存用药记录', this.data.newMedication);
    
    const { name, dosage, unit, time } = this.data.newMedication;
    
    // 验证输入
    if (!name) {
      wx.showToast({
        title: '请选择药物',
        icon: 'none'
      });
      return;
    }
    
    if (!dosage || dosage.trim() === '') {
      wx.showToast({
        title: '请输入用药剂量',
        icon: 'none'
      });
      return;
    }

    // 验证剂量是否为有效正数
    const dosageNum = parseFloat(dosage);
    if (isNaN(dosageNum) || dosageNum <= 0) {
      wx.showToast({
        title: '请输入有效的剂量数值',
        icon: 'none'
      });
      return;
    }
    
    if (!time) {
      wx.showToast({
        title: '请选择用药时间',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    try {
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 获取当天的开始时间
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      
      // 创建完整的用药时间对象
      const [hours, minutes] = time.split(':').map(Number);
      const medicationTime = new Date(year, month - 1, day, hours, minutes, 0);
      
      // 查找药物ID（如果需要的话）
      const selectedMed = this.data.medications.find(med => med.name === name);
      const medicationId = selectedMed ? selectedMed._id : '';
      
             // 使用新的药物记录模型创建记录
       const result = await MedicationRecordModel.create({
         babyUid: babyUid,
         date: this.data.selectedDate,
         medicationId: medicationId,
         medicationName: name,
         dosage: parseFloat(dosage),
         unit: unit,
         actualTime: time,
         actualDateTime: medicationTime
       });
      
      if (result.success) {
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 强制重新加载数据
        await this.forceRefreshData();
        this.hideAddMedicationModal();
      } else {
        throw new Error(result.message || '保存失败');
      }
      
    } catch (error) {
      console.error('保存用药记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 加载药物配置
  async loadMedications() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('medications').get();
      this.setData({ medications: res.data });
    } catch (error) {
      console.error('加载药物配置失败:', error);
    }
  },

  // 选择药物处理
  onMedicationSelect(e) {
    const index = e.detail.value;
    const medication = this.data.medications[index];
    const newMedication = {
      ...this.data.newMedication,
      name: medication.name,
      dosage: medication.dosage,
      unit: medication.unit
    };
    this.setData({ newMedication });
  },

  // 显示删除喂奶记录确认对话框
  deleteFeeding(e) {
    const index = e.currentTarget.dataset.index;
    const feeding = this.data.feedingRecords[index];
    const message = `确认删除 ${feeding.formattedStartTime} 的喂奶记录吗？`;
    
    this.setData({
      showDeleteConfirm: true,
      deleteConfirmMessage: message,
      deleteType: 'feeding',
      deleteIndex: index
    });
  },

  // 显示删除用药记录确认对话框
  deleteMedication(e) {
    const recordId = e.currentTarget.dataset.recordId;
    console.log('点击删除药物记录，recordId:', recordId);
    
    const medication = this.data.medicationRecords.find(record => record._id === recordId);
    console.log('找到的药物记录:', medication);
    
    if (!medication) {
      wx.showToast({
        title: '未找到药物记录',
        icon: 'none'
      });
      return;
    }
    
    const message = `确认删除 ${medication.medicationName} (${medication.actualTime}) 的用药记录吗？`;
    
    console.log('设置删除确认对话框数据:', {
      deleteType: 'medication',
      deleteRecordId: recordId
    });
    
    this.setData({
      showDeleteConfirm: true,
      deleteConfirmMessage: message,
      deleteType: 'medication',
      deleteRecordId: recordId // 使用recordId而不是index
    });
  },

  // 隐藏删除确认对话框
  hideDeleteConfirm() {
    this.setData({
      showDeleteConfirm: false,
      deleteConfirmMessage: '',
      deleteType: '',
      deleteIndex: -1,
      deleteRecordId: ''
    });
  },

  // 确认删除记录
  async confirmDelete() {
    const { deleteType, deleteIndex, deleteRecordId, selectedDate } = this.data;
    
    // 检查是否有有效的删除目标
    if (deleteType === 'feeding' && deleteIndex < 0) {
      this.hideDeleteConfirm();
      return;
    }
    
    if (deleteType === 'medication' && !deleteRecordId) {
      this.hideDeleteConfirm();
      return;
    }

    wx.showLoading({
      title: '删除中...',
      mask: true
    });

    try {
      if (deleteType === 'feeding') {
        // 处理喂奶记录删除
        const db = wx.cloud.database();

        // 将日期字符串转换为 Date 对象
        const [year, month, day] = selectedDate.split('-').map(Number);
        const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
        const endOfDay = new Date(year, month - 1, day, 23, 59, 59);

        // 查询当天的记录（添加babyUid条件）
        const app = getApp();
        const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
        
        let deleteQuery = {
          date: db.command.gte(startOfDay).and(db.command.lte(endOfDay))
        };
        
        if (babyUid) {
          deleteQuery.babyUid = babyUid;
        }
        
        const res = await db.collection('feeding_records').where(deleteQuery).get();

        if (res.data.length === 0) {
          wx.hideLoading();
          wx.showToast({
            title: '未找到记录',
            icon: 'error'
          });
          this.hideDeleteConfirm();
          return;
        }

        const dayRecord = res.data[0];
        const feedings = [...dayRecord.feedings];
        
        // 找到要删除的记录（通过对比时间和奶量来确定）
        const targetFeeding = this.data.feedingRecords[deleteIndex];
        let targetIndex = -1;
        
        // 尝试通过时间和奶量匹配找到对应的记录
        for (let i = 0; i < feedings.length; i++) {
          const feeding = feedings[i];
          let feedingStartTime = '';
          
          // 处理时间格式
          if (feeding.startTime && typeof feeding.startTime === 'string' && feeding.startTime.includes(':')) {
            feedingStartTime = feeding.startTime;
          } else if (feeding.startDateTime) {
            const date = new Date(feeding.startDateTime);
            if (!isNaN(date.getTime())) {
              feedingStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            }
          }
          
          // 匹配条件：时间相同且天然奶量相同
          if (feedingStartTime === targetFeeding.formattedStartTime && 
              Math.abs(parseFloat(feeding.naturalMilkVolume || 0) - parseFloat(targetFeeding.naturalMilkVolume || 0)) < 0.1) {
            targetIndex = i;
            break;
          }
        }
        
        if (targetIndex >= 0) {
          feedings.splice(targetIndex, 1);
          
          // 更新数据库
          const deleteResult = await db.collection('feeding_records').doc(dayRecord._id).update({
            data: { 
              feedings,
              updatedAt: db.serverDate()
            }
          });
          
          console.log('删除喂奶记录数据库更新结果:', deleteResult);
        } else {
          console.error('删除喂奶记录失败: 未找到匹配的记录', {
            targetIndex,
            targetFeeding,
            feedingsInDb: feedings.map(f => ({
              startTime: f.startTime,
              naturalMilkVolume: f.naturalMilkVolume
            }))
          });
          throw new Error('未找到要删除的记录');
        }
        
      } else if (deleteType === 'medication') {
        // 删除用药记录 - 使用新的药物记录模型
        const recordId = this.data.deleteRecordId;
        console.log('准备删除药物记录，recordId:', recordId);
        
        if (recordId) {
          const result = await MedicationRecordModel.delete(recordId);
          console.log('删除药物记录结果:', result);
          
          if (!result.success) {
            throw new Error(result.message || '删除失败');
          }
        } else {
          throw new Error('无法找到要删除的药物记录');
        }
      }

      // 强制刷新数据
      await this.forceRefreshData();
      
      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
    } catch (error) {
      console.error('删除记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '删除失败',
        icon: 'error'
      });
    }

    this.hideDeleteConfirm();
  },

  // 获取宝宝基本信息（包括默认体重）
  async getBabyInfo() {
    try {
      const db = wx.cloud.database();
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      let query = {};
      if (babyUid) {
        query.babyUid = babyUid;
      }
      
      const res = await db.collection('baby_info').where(query).limit(1).get();
      if (res.data && res.data.length > 0) {
        this.setData({
          babyInfo: res.data[0]
        });
        
        // 如果当前没有体重记录，则使用宝宝信息中的体重作为默认值
        if (this.data.weight === '--' || this.data.weight === '') {
          this.setData({
            weight: res.data[0].weight || '--'
          });
        }
      }
    } catch (error) {
      console.error('获取宝宝信息失败:', error);
    }
  },
  
  // 处理用药记录
  processMedicationData: function(medicationRecords) {
    if (!medicationRecords || medicationRecords.length === 0) {
      this.setData({
        medicationRecords: [],
        groupedMedicationRecords: []
      });
      return;
    }

    console.log('处理用药记录数据:', JSON.stringify(medicationRecords));
    
    const processedMedicationRecords = medicationRecords.map(record => {
      console.log('处理用药记录:', record);
      
      // 直接使用新数据结构的原始数据，WXML 已适配新字段
      return {
        ...record
      };
    });
    
    // 按时间排序
    processedMedicationRecords.sort((a, b) => {
      // 如果时间格式是无效的，则排在后面
      if (!a.actualTime && b.actualTime) return 1;
      if (a.actualTime && !b.actualTime) return -1;
      if (!a.actualTime && !b.actualTime) return 0;
      
      // 将时间转换为分钟数进行比较
      const getMinutes = (timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
      };
      
      // 降序排列（最近的时间在前）
      return getMinutes(b.actualTime) - getMinutes(a.actualTime);
    });

    // 使用MedicationRecordModel的分组功能
    const groupedMedicationRecords = MedicationRecordModel.groupRecordsByMedication(processedMedicationRecords);
    
    this.setData({
      medicationRecords: processedMedicationRecords,
      groupedMedicationRecords: groupedMedicationRecords
    });
  },

  // 打开编辑喂奶记录弹窗
  openEditFeedingModal(e) {
    const index = e.currentTarget.dataset.index;
    const feeding = this.data.feedingRecords[index];
    
    // 计算总奶量（如果没有的话）
    let totalVolume = feeding.totalVolume;
    if (!totalVolume && (feeding.naturalMilkVolume || feeding.specialMilkVolume)) {
      totalVolume = (parseFloat(feeding.naturalMilkVolume) || 0) + (parseFloat(feeding.specialMilkVolume) || 0);
    }
    
    // 计算特奶奶粉重量
    const specialMilkVolume = parseFloat(feeding.specialMilkVolume) || 0;
    let specialPowderWeight = 0;
    if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
      const ratio = this.data.nutritionSettings.special_milk_ratio;
      specialPowderWeight = Math.round((specialMilkVolume * ratio.powder / ratio.water) * 10) / 10;
    } else {
      // 使用默认配比 13.5g/90ml
      specialPowderWeight = Math.round((specialMilkVolume * 13.5 / 90) * 10) / 10;
    }
    
    this.setData({
      showEditFeedingModal: true,
      editingFeedingIndex: index,
      editingFeeding: { 
        ...feeding,
        totalVolume: totalVolume,
        specialPowderWeight: specialPowderWeight
      }
    });
  },
  
  // 隐藏编辑喂奶记录弹窗
  hideEditFeedingModal() {
    this.setData({
      showEditFeedingModal: false,
      editingFeedingIndex: -1,
      editingFeeding: null
    });
  },
  
  // 编辑喂奶记录输入处理
  onEditFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const editingFeeding = { ...this.data.editingFeeding };
    
    editingFeeding[field] = value;
    
    // 重新计算总奶量（天然奶量 + 特奶量）
    if (field === 'specialMilkVolume' || field === 'naturalMilkVolume') {
      const natural = parseFloat(editingFeeding.naturalMilkVolume) || 0;
      const special = parseFloat(editingFeeding.specialMilkVolume) || 0;
      editingFeeding.totalVolume = (natural + special).toFixed(1);
      
      // 计算特奶奶粉重量（根据配比 13.5g/90ml）
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        editingFeeding.specialPowderWeight = Math.round((special * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        editingFeeding.specialPowderWeight = Math.round((special * 13.5 / 90) * 10) / 10;
      }
      
      // 如果是普通奶粉，计算奶粉重量
      if (this.data.proteinSourceType === 'formulaMilk' && field === 'naturalMilkVolume') {
        if (this.data.nutritionSettings && this.data.nutritionSettings.formula_milk_ratio) {
          const ratio = this.data.nutritionSettings.formula_milk_ratio;
          editingFeeding.formulaPowderWeight = Math.round((natural * ratio.powder / ratio.water) * 10) / 10;
        } else {
          // 使用默认配比 7g/100ml
          editingFeeding.formulaPowderWeight = Math.round((natural * 7 / 100) * 10) / 10;
        }
      }
    }
    
    this.setData({ editingFeeding });
  },
  
  // 编辑喂奶记录时间选择处理
  onEditFeedingTimeChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const editingFeeding = { ...this.data.editingFeeding };
    
    editingFeeding[field] = value;
    this.setData({ editingFeeding });
  },
  
  // 保存编辑后的喂奶记录
  async saveEditedFeeding() {
    try {
      wx.showLoading({ title: '保存中...' });
      
      const { editingFeeding, editingFeedingIndex, selectedDate } = this.data;
      
      // 验证输入
      if (!editingFeeding.formattedStartTime || !editingFeeding.formattedEndTime) {
        wx.showToast({
          title: '请选择喂奶时间',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }
      
      if (!editingFeeding.naturalMilkVolume && !editingFeeding.specialMilkVolume) {
        wx.showToast({
          title: '请输入奶量',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }
      
      // 准备更新的数据
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 获取当天的开始和结束时间
      const [year, month, day] = selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 解析时间
      const [startHour, startMinute] = editingFeeding.formattedStartTime.split(':').map(Number);
      const [endHour, endMinute] = editingFeeding.formattedEndTime.split(':').map(Number);
      
      const startDateTime = new Date(year, month - 1, day, startHour, startMinute, 0);
      const endDateTime = new Date(year, month - 1, day, endHour, endMinute, 0);
      
      // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
      if (endDateTime < startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
      }
      
      // 查询当天记录（添加babyUid条件）
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      let whereQuery = {
        date: _.gte(startOfDay).and(_.lte(endOfDay))
      };
      
      if (babyUid) {
        whereQuery.babyUid = babyUid;
      }
      
      const res = await db.collection('feeding_records')
        .where(whereQuery)
        .get();
      
      if (res.data.length === 0) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到记录',
          icon: 'error'
        });
        return;
      }
      
      // 获取记录并更新
      const record = res.data[0];
      const feedings = [...record.feedings];
      
      // 找到要编辑的记录（通过对比时间和奶量来确定）
      const originalFeeding = this.data.feedingRecords[editingFeedingIndex];
      let targetIndex = -1;
      
              // 尝试通过时间和奶量匹配找到对应的记录
        for (let i = 0; i < feedings.length; i++) {
          const feeding = feedings[i];
          let feedingStartTime = '';
          
          // 处理时间格式
          if (feeding.startTime && typeof feeding.startTime === 'string' && feeding.startTime.includes(':')) {
            feedingStartTime = feeding.startTime;
          } else if (feeding.startDateTime) {
            const date = new Date(feeding.startDateTime);
            if (!isNaN(date.getTime())) {
              feedingStartTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            }
          }
          
          // 匹配条件：时间相同且天然奶量相同
          if (feedingStartTime === originalFeeding.formattedStartTime && 
              Math.abs(parseFloat(feeding.naturalMilkVolume || 0) - parseFloat(originalFeeding.naturalMilkVolume || 0)) < 0.1) {
            targetIndex = i;
            break;
          }
        }
      
      if (targetIndex >= 0) {
        // 更新记录，确保包含完整的時間字段
        feedings[targetIndex] = {
          ...feedings[targetIndex],
          startTime: editingFeeding.formattedStartTime,      // 字符串格式，用于显示
          endTime: editingFeeding.formattedEndTime,          // 字符串格式，用于显示
          startDateTime: startDateTime,                      // Date对象，用于排序和比较
          endDateTime: endDateTime,                          // Date对象，用于排序和比较
          naturalMilkVolume: parseFloat(editingFeeding.naturalMilkVolume) || 0,
          specialMilkVolume: parseFloat(editingFeeding.specialMilkVolume) || 0,
          totalVolume: parseFloat(editingFeeding.totalVolume) || 
                      (parseFloat(editingFeeding.naturalMilkVolume) || 0) + 
                      (parseFloat(editingFeeding.specialMilkVolume) || 0),
          formulaPowderWeight: parseFloat(editingFeeding.formulaPowderWeight) || 0, // 添加奶粉重量
          babyUid: babyUid // 确保记录包含babyUid
        };
        
        // 更新数据库
        const updateResult = await db.collection('feeding_records').doc(record._id).update({
          data: {
            feedings: feedings,
            updatedAt: db.serverDate()
          }
        });
        
        console.log('编辑喂奶记录数据库更新结果:', updateResult);
        
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 强制重新加载数据
        await this.forceRefreshData();
        this.hideEditFeedingModal();
      } else {
        console.error('编辑喂奶记录失败: 未找到匹配的记录', {
          targetIndex,
          originalFeeding,
          feedingsInDb: feedings.map(f => ({
            startTime: f.startTime,
            naturalMilkVolume: f.naturalMilkVolume
          }))
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '未找到要编辑的记录',
          icon: 'none'
        });
      }
      
    } catch (error) {
      console.error('保存编辑记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 打开编辑用药记录弹窗
  openEditMedicationModal(e) {
    const recordId = e.currentTarget.dataset.recordId;
    const medication = this.data.medicationRecords.find(record => record._id === recordId);
    
    if (!medication) {
      wx.showToast({
        title: '未找到药物记录',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showEditMedicationModal: true,
      editingMedicationRecordId: recordId, // 使用recordId而不是index
      editingMedication: { ...medication }
    });
  },
  
  // 隐藏编辑用药记录弹窗
  hideEditMedicationModal() {
    this.setData({
      showEditMedicationModal: false,
      editingMedicationIndex: -1,
      editingMedicationRecordId: '',
      editingMedication: null
    });
  },
  
  // 编辑用药记录输入处理
  onEditMedicationInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const editingMedication = { ...this.data.editingMedication };
    
    editingMedication[field] = value;
    this.setData({ editingMedication });
  },

  // 编辑用药记录时间选择处理
  onEditMedicationTimeChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const editingMedication = { ...this.data.editingMedication };
    
    editingMedication[field] = value;
    this.setData({ editingMedication });
  },
  
  // 保存编辑后的用药记录
  async saveEditedMedication() {
    try {
      wx.showLoading({ title: '保存中...' });
      
      const { editingMedication, selectedDate } = this.data;
      
      // 验证输入
      if (!editingMedication.actualTime) {
        wx.showToast({
          title: '请选择用药时间',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }

      if (!editingMedication.dosage || editingMedication.dosage.trim() === '') {
        wx.showToast({
          title: '请输入用药剂量',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }

      // 验证剂量是否为有效正数
      const dosage = parseFloat(editingMedication.dosage);
      if (isNaN(dosage) || dosage <= 0) {
        wx.showToast({
          title: '请输入有效的剂量数值',
          icon: 'none'
        });
        wx.hideLoading();
        return;
      }
      
      if (!editingMedication._id) {
        wx.showToast({
          title: '记录ID不存在',
          icon: 'error'
        });
        wx.hideLoading();
        return;
      }
      
      // 获取日期和时间
      const [year, month, day] = selectedDate.split('-').map(Number);
      const [hours, minutes] = editingMedication.actualTime.split(':').map(Number);
      const medicationTime = new Date(year, month - 1, day, hours, minutes, 0);
      
      // 使用新的药物记录模型更新
      const result = await MedicationRecordModel.update(editingMedication._id, {
        actualTime: editingMedication.actualTime, // 保存为字符串格式
        actualDateTime: medicationTime, // 保存为Date对象
        dosage: parseFloat(editingMedication.dosage), // 确保是数字类型
        medicationName: editingMedication.medicationName
      });
      
      if (result.success) {
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 强制重新加载数据
        await this.forceRefreshData();
        this.hideEditMedicationModal();
      } else {
        throw new Error(result.message || '更新失败');
      }
      
    } catch (error) {
      console.error('保存编辑用药记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 加载营养参数设置
  async loadNutritionSettings() {
    try {
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，使用默认营养设置');
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ nutritionSettings: defaultSettings });
        return Promise.resolve();
      }
      
      // 获取宝宝信息以确定蛋白质来源类型
      const db = wx.cloud.database();
      const babyInfo = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      let proteinSourceType = 'breastMilk'; // 默认为母乳
      
      if (babyInfo.data && babyInfo.data.length > 0 && babyInfo.data[0].proteinSourceType) {
        proteinSourceType = babyInfo.data[0].proteinSourceType;
      }
      
      // 设置蛋白质来源类型
      this.setData({
        proteinSourceType: proteinSourceType
      });
      
      // 获取营养设置
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      
      if (settings) {
        this.setData({ nutritionSettings: settings });
      } else {
        // 如果没有获取到设置，使用默认设置
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ nutritionSettings: defaultSettings });
      }
      
      return Promise.resolve();
    } catch (error) {
      console.error('加载营养参数设置失败:', error);
      // 使用默认设置
      const defaultSettings = NutritionModel.createDefaultSettings();
      this.setData({ nutritionSettings: defaultSettings });
      return Promise.resolve();
    }
  },

  // 阻止事件冒泡
  preventBubble() {
    // 阻止事件冒泡
  }
}); 