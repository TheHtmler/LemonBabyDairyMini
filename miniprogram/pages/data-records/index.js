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

Page({
  data: {
    selectedDate: '',
    formattedSelectedDate: '', // 格式化后的日期显示
    dateList: [],
    feedingRecords: [],
    medicationRecords: [],
    totalNaturalMilk: 0,
    totalSpecialMilk: 0,
    totalMilk: 0,
    totalPowderWeight: 0,
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
      volume: '',
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
      
      const result = await db.collection('feeding_records')
        .where(query)
        .get();
      
      if (result.data && result.data.length > 0) {
        const record = result.data[0];
        
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
        
        this.setData({
          recordId: record._id,
          feedings: record.feedings || [],
          medicationRecords: record.medicationRecords || [],
          weight: recordWeight || (this.data.babyInfo ? this.data.babyInfo.weight : '--'),
          hasRecord: true,
          isDataLoading: false // 设置数据加载完成
        });
        
        // 处理喂奶和用药记录
        this.processFeedingData(record.feedings || []);
        this.processMedicationData(record.medicationRecords || []);
      } else {
        // 没有记录时，尝试使用宝宝信息中的体重
        const defaultWeight = this.data.babyInfo ? this.data.babyInfo.weight : '--';
        
        this.setData({
          recordId: '',
          feedings: [],
          medicationRecords: [],
          weight: defaultWeight,
          hasRecord: false,
          feedingRecords: [],
          medicationRecords: [],
          totalNaturalMilk: 0,
          totalSpecialMilk: 0,
          totalMilk: 0,
          totalPowderWeight: 0,
          naturalProteinCoefficient: 0,
          specialProteinCoefficient: 0,
          isDataLoading: false // 设置数据加载完成
        });
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
        naturalProteinCoefficient: 0,
        specialProteinCoefficient: 0
      });
      return;
    }

    // 按时间排序
    feedingRecords.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // 定义格式化时间的函数
    const formatTime = date => {
      console.log('尝试格式化时间:', date);
      
      if (!date) {
        console.error('传入的日期为空');
        return '--:--';
      }
      
      // 确保date是Date对象
      let dateObj;
      try {
        dateObj = date instanceof Date ? date : new Date(date);
        
        // 检查是否为有效日期
        if (isNaN(dateObj.getTime())) {
          console.error('无效的日期格式:', date);
          return '--:--';
        }
        
        const hour = dateObj.getHours().toString().padStart(2, '0');
        const minute = dateObj.getMinutes().toString().padStart(2, '0');
      return `${hour}:${minute}`;
      } catch (error) {
        console.error('格式化时间出错:', error, date);
        return '--:--';
      }
    };

    console.log('处理喂奶记录数据:', JSON.stringify(feedingRecords));
    
    const processedRecords = feedingRecords.map(record => {
      console.log('处理记录:', record);
      
      let start, end, duration;
      
      try {
        // 确保时间是Date对象
        start = record.startTime instanceof Date ? record.startTime : new Date(record.startTime);
        end = record.endTime instanceof Date ? record.endTime : new Date(record.endTime);
        
        console.log('开始时间对象:', start);
        console.log('结束时间对象:', end);
        
        // 检查日期是否有效
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          console.error('无效的时间格式:', record.startTime, record.endTime);
          
          // 如果是字符串格式的时间，尝试直接使用
          const startTimeStr = typeof record.startTime === 'string' ? record.startTime : '--:--';
          const endTimeStr = typeof record.endTime === 'string' ? record.endTime : '--:--';
          
          return {
            ...record,
            formattedStartTime: startTimeStr.includes(':') ? startTimeStr : '--:--',
            formattedEndTime: endTimeStr.includes(':') ? endTimeStr : '--:--',
            duration: 0
          };
        }
        
        duration = Math.round((end - start) / 60000); // 转为分钟
      } catch (error) {
        console.error('处理时间对象错误:', error);
        return {
          ...record,
          formattedStartTime: '--:--',
          formattedEndTime: '--:--',
          duration: 0
        };
      }
        
        return {
          ...record,
          formattedStartTime: formatTime(start),
          formattedEndTime: formatTime(end),
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
    
    // 确保营养设置已加载
    if (this.data.nutritionSettings) {
      console.log('计算奶粉克重:', this.data.proteinSourceType, this.data.nutritionSettings);
      
      // 根据蛋白质来源类型和营养设置计算奶粉克重
      if (this.data.proteinSourceType === 'formulaMilk' && 
          this.data.nutritionSettings.formula_milk_ratio) {
        // 普通奶粉的配比计算
        const ratio = this.data.nutritionSettings.formula_milk_ratio;
        const powderWeight = (totalNaturalMilk * ratio.powder) / ratio.water;
        totalPowderWeight += Math.round(powderWeight * 10) / 10; // 保留一位小数
        console.log('普通奶粉克重:', totalPowderWeight);
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
        totalPowderWeight += Math.round(formulaPowderWeight * 10) / 10;
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



  // 显示补充喂奶记录弹窗
  showAddFeedingModal() {
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
    
    this.setData({
      showAddFeedingModal: true,
      newFeeding: {
        startTime: currentTime,
        endTime: endTimeStr,
        naturalMilkVolume: '',
        totalVolume: '',
        specialMilkVolume: 0,
        specialPowderWeight: 0
      }
    });
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
      showAddMedicationModal: false
    });
  },

  // 新喂奶记录输入处理
  onNewFeedingInput(e) {
    console.log('喂奶记录输入', e.currentTarget.dataset.field, e.detail.value);
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const newFeeding = { ...this.data.newFeeding };
    
    newFeeding[field] = value;
    
    // 计算特奶量
    if (field === 'totalVolume' || field === 'naturalMilkVolume') {
      const total = parseFloat(newFeeding.totalVolume) || 0;
      const natural = parseFloat(newFeeding.naturalMilkVolume) || 0;
      newFeeding.specialMilkVolume = Math.max(0, total - natural);
      
      // 计算特奶奶粉重量（根据配比 13.5g/90ml）
      const specialMilkVolume = newFeeding.specialMilkVolume;
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        newFeeding.specialPowderWeight = Math.round((specialMilkVolume * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        newFeeding.specialPowderWeight = Math.round((specialMilkVolume * 13.5 / 90) * 10) / 10;
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
        startTime: startDateTime,  // 保存为完整日期时间对象
        endTime: endDateTime,      // 保存为完整日期时间对象
        naturalMilkVolume: parseFloat(naturalMilkVolume) || 0,
        specialMilkVolume: parseFloat(this.data.newFeeding.specialMilkVolume) || 0,
        totalVolume: parseFloat(totalVolume) || 0,
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

      // 重新加载数据
      this.fetchDailyRecords(this.data.selectedDate);
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
    
    const { name, volume, time } = this.data.newMedication;
    
    // 验证输入
    if (!name) {
      wx.showToast({
        title: '请选择药物',
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
      const db = wx.cloud.database();
      const _ = db.command;
      
      // 获取当天的开始和结束时间
      const [year, month, day] = this.data.selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 创建完整的用药时间对象
      const [hours, minutes] = time.split(':').map(Number);
      const medicationTime = new Date(year, month - 1, day, hours, minutes, 0);
      
      // 查询当天的记录
      let query = {
        date: _.gte(startOfDay).and(_.lte(endOfDay))
      };
      
      // 如果有宝宝UID，添加到查询条件
      if (babyUid) {
        query.babyUid = babyUid;
      }
      
      const res = await db.collection('feeding_records').where(query).get();
      
      const medication = {
        name: name,
        volume: volume,
        time: medicationTime,     // 保存为完整日期时间对象
        timeString: time,         // 保存可读的时间字符串
        formattedTime: time,      // 直接添加格式化后的时间，避免处理错误
        babyUid: babyUid,         // 添加宝宝UID关联
        createdAt: new Date()     // 添加创建时间戳
      };
      
      if (res.data.length > 0) {
        // 更新现有记录
        await db.collection('feeding_records').doc(res.data[0]._id).update({
          data: {
            medicationRecords: _.push([medication]),
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
            feedings: [],
            medicationRecords: [medication],
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
      
      // 重新加载数据
      this.fetchDailyRecords(this.data.selectedDate);
      this.hideAddMedicationModal();
      
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
      volume: medication.dosage + medication.unit
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
    const index = e.currentTarget.dataset.index;
    const medication = this.data.medicationRecords[index];
    const message = `确认删除 ${medication.name} (${medication.formattedTime}) 的用药记录吗？`;
    
    this.setData({
      showDeleteConfirm: true,
      deleteConfirmMessage: message,
      deleteType: 'medication',
      deleteIndex: index
    });
  },

  // 隐藏删除确认对话框
  hideDeleteConfirm() {
    this.setData({
      showDeleteConfirm: false,
      deleteConfirmMessage: '',
      deleteType: '',
      deleteIndex: -1
    });
  },

  // 确认删除记录
  async confirmDelete() {
    const { deleteType, deleteIndex, selectedDate } = this.data;
    
    if (deleteIndex < 0) {
      this.hideDeleteConfirm();
      return;
    }

    wx.showLoading({
      title: '删除中...',
      mask: true
    });

    try {
      const db = wx.cloud.database();

      // 将日期字符串转换为 Date 对象
      const [year, month, day] = selectedDate.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);

      // 查询当天的记录
      const res = await db.collection('feeding_records').where({
        date: db.command.gte(startOfDay).and(db.command.lte(endOfDay))
      }).get();

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

      if (deleteType === 'feeding') {
        // 删除喂奶记录
        const feedings = [...dayRecord.feedings];
        feedings.splice(deleteIndex, 1);

        // 更新数据库
        await db.collection('feeding_records').doc(dayRecord._id).update({
          data: { feedings }
        });
      } else if (deleteType === 'medication') {
        // 删除用药记录
        const medicationRecords = [...dayRecord.medicationRecords];
        medicationRecords.splice(deleteIndex, 1);

        // 更新数据库
        await db.collection('feeding_records').doc(dayRecord._id).update({
          data: { medicationRecords }
        });
      }

      // 刷新数据
      this.fetchDailyRecords(selectedDate);
      
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
        medicationRecords: []
      });
      return;
    }

    console.log('处理用药记录数据:', JSON.stringify(medicationRecords));
    
    const processedMedicationRecords = medicationRecords.map(record => {
      console.log('处理用药记录:', record);
      
      let formattedTime = '--:--';
      
      try {
        // 1. 首先尝试使用timeString属性（如果存在）
        if (record.timeString && typeof record.timeString === 'string' && record.timeString.includes(':')) {
          formattedTime = record.timeString;
        }
        // 2. 如果没有timeString，尝试使用time属性
        else if (record.time) {
          // 如果time是字符串且包含冒号，直接使用
          if (typeof record.time === 'string' && record.time.includes(':')) {
            formattedTime = record.time;
          }
          // 如果time是Date对象或可以转换为Date的字符串
          else {
            const dateObj = record.time instanceof Date ? record.time : new Date(record.time);
            
            // 检查转换后的Date对象是否有效
            if (!isNaN(dateObj.getTime())) {
              const hour = dateObj.getHours().toString().padStart(2, '0');
              const minute = dateObj.getMinutes().toString().padStart(2, '0');
              formattedTime = `${hour}:${minute}`;
            }
          }
        }
      } catch (error) {
        console.error('格式化用药时间出错:', error, record.time);
        formattedTime = '--:--';
      }
      
      // 确保返回的记录包含所有原始属性，并添加formattedTime属性
      return {
        ...record,
        formattedTime: formattedTime
      };
    });
    
    // 按时间排序
    processedMedicationRecords.sort((a, b) => {
      // 如果时间格式是无效的，则排在后面
      if (a.formattedTime === '--:--' && b.formattedTime !== '--:--') return 1;
      if (a.formattedTime !== '--:--' && b.formattedTime === '--:--') return -1;
      if (a.formattedTime === '--:--' && b.formattedTime === '--:--') return 0;
      
      // 将时间转换为分钟数进行比较
      const getMinutes = (timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
      };
      
      // 降序排列（最近的时间在前）
      return getMinutes(b.formattedTime) - getMinutes(a.formattedTime);
    });
    
    this.setData({
      medicationRecords: processedMedicationRecords
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
    
    // 计算特奶量
    if (field === 'totalVolume' || field === 'naturalMilkVolume') {
      const total = parseFloat(editingFeeding.totalVolume) || 0;
      const natural = parseFloat(editingFeeding.naturalMilkVolume) || 0;
      editingFeeding.specialMilkVolume = Math.max(0, total - natural);
      
      // 计算特奶奶粉重量（根据配比 13.5g/90ml）
      const specialMilkVolume = editingFeeding.specialMilkVolume;
      if (this.data.nutritionSettings && this.data.nutritionSettings.special_milk_ratio) {
        const ratio = this.data.nutritionSettings.special_milk_ratio;
        editingFeeding.specialPowderWeight = Math.round((specialMilkVolume * ratio.powder / ratio.water) * 10) / 10;
      } else {
        // 使用默认配比 13.5g/90ml
        editingFeeding.specialPowderWeight = Math.round((specialMilkVolume * 13.5 / 90) * 10) / 10;
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
      
      // 查询当天记录
      const res = await db.collection('feeding_records')
        .where({
          date: _.gte(startOfDay).and(_.lte(endOfDay))
        })
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
      
      // 处理被编辑的记录的索引 (这里可能需要与显示列表的索引进行映射)
      if (feedings[editingFeedingIndex]) {
        // 更新记录
        feedings[editingFeedingIndex] = {
          ...feedings[editingFeedingIndex],
          startTime: startDateTime,
          endTime: endDateTime,
          naturalMilkVolume: parseFloat(editingFeeding.naturalMilkVolume) || 0,
          specialMilkVolume: parseFloat(editingFeeding.specialMilkVolume) || 0,
          totalVolume: parseFloat(editingFeeding.totalVolume) || 
                      (parseFloat(editingFeeding.naturalMilkVolume) || 0) + 
                      (parseFloat(editingFeeding.specialMilkVolume) || 0)
        };
        
        // 更新数据库
        await db.collection('feeding_records').doc(record._id).update({
          data: {
            feedings: feedings,
            updatedAt: db.serverDate()
          }
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 重新加载数据
        this.fetchDailyRecords(this.data.selectedDate);
        this.hideEditFeedingModal();
      } else {
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
    const index = e.currentTarget.dataset.index;
    const medication = this.data.medicationRecords[index];
    
    // 确保medication对象有正确的formattedTime
    if (!medication.formattedTime || medication.formattedTime === '--:--') {
      // 尝试从time属性创建
      if (medication.time) {
        try {
          const dateObj = medication.time instanceof Date ? medication.time : new Date(medication.time);
          if (!isNaN(dateObj.getTime())) {
            medication.formattedTime = this.formatTime(dateObj);
          }
        } catch (error) {
          console.error('格式化编辑用药时间出错:', error);
          // 如果无法格式化，使用当前时间
          medication.formattedTime = this.formatTime(new Date());
        }
      } else {
        // 如果没有time属性，使用当前时间
        medication.formattedTime = this.formatTime(new Date());
      }
    }
    
    this.setData({
      showEditMedicationModal: true,
      editingMedicationIndex: index,
      editingMedication: { ...medication }
    });
  },
  
  // 隐藏编辑用药记录弹窗
  hideEditMedicationModal() {
    this.setData({
      showEditMedicationModal: false,
      editingMedicationIndex: -1,
      editingMedication: null
    });
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
      
      const { editingMedication, editingMedicationIndex, selectedDate } = this.data;
      
      // 验证输入
      if (!editingMedication.formattedTime) {
        wx.showToast({
          title: '请选择用药时间',
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
      const [hours, minutes] = editingMedication.formattedTime.split(':').map(Number);
      const medicationTime = new Date(year, month - 1, day, hours, minutes, 0);
      
      // 查询当天记录
      const res = await db.collection('feeding_records')
        .where({
          date: _.gte(startOfDay).and(_.lte(endOfDay))
        })
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
      const medicationRecords = [...record.medicationRecords];
      
      // 处理被编辑的记录的索引
      if (medicationRecords[editingMedicationIndex]) {
        // 更新记录
        medicationRecords[editingMedicationIndex] = {
          ...medicationRecords[editingMedicationIndex],
          time: medicationTime,
          timeString: editingMedication.formattedTime,
          formattedTime: editingMedication.formattedTime // 直接保存格式化的时间
        };
        
        // 更新数据库
        await db.collection('feeding_records').doc(record._id).update({
          data: {
            medicationRecords: medicationRecords,
            updatedAt: db.serverDate()
          }
        });
        
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
        
        // 重新加载数据
        this.fetchDailyRecords(this.data.selectedDate);
        this.hideEditMedicationModal();
      } else {
        wx.hideLoading();
        wx.showToast({
          title: '未找到要编辑的记录',
          icon: 'none'
        });
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