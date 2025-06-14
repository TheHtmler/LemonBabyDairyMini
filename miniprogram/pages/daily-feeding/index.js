// 导入营养设置模型
const NutritionModel = require('../../models/nutrition');
// 导入药物记录模型
const MedicationRecordModel = require('../../models/medicationRecord');

const app = getApp();

Page({
  data: {
    weight: '',
    feedings: [],
    medicationRecords: [],
    groupedMedicationRecords: [], // 按药物名称分组的药物记录
    medicationsList: [], // 存储从数据库加载的药物列表
    currentFeeding: {
      startTime: '',
      endTime: '',
      naturalMilkVolume: '',
      specialMilkVolume: '',
      specialMilkPowder: '',
      totalVolume: ''
    },
    dailyNaturalProtein: 0,      // 每日所需天然蛋白量
    requiredNaturalMilk: 0,       // 每日所需天然奶总量
    totalNaturalMilkFed: 0,       // 已喂天然奶总量
    remainingNaturalMilk: 0,      // 剩余需要喂的天然奶量
    formulaPowderNeeded: 0,       // 每日需要的奶粉量
    babyName: '',                // 宝宝名字
    babyDays: 0,                 // 已出生天数
    todayDate: '',               // 今日日期，精确到日
    recordId: '',
    showMedicationModal: false,
    selectedMedication: null,
    currentModalTime: '',
    currentModalDosage: '',   // 当前用药弹窗中的剂量
    calculation_params: null,      // 初始化为 null，等待从数据库加载
    elapsedTime: '00:00', // 已喂奶时长
    timerInterval: null,  // 计时器
    quickFeedingData: {
      naturalMilkVolume: '',
      totalVolume: '',
      specialMilkVolume: '0',
      specialMilkPowder: '0',
      startTime: '',
      endTime: ''
    },
    // 预设常用奶量值
    commonVolumes: {
      naturalMilk: [30, 40, 50, 60, 70, 80],
      totalMilk: [60, 80, 100, 120, 150, 180]
    },
    showEditModal: false,      // 显示编辑记录的弹窗
    editingFeedingIndex: -1,   // 当前编辑的喂奶记录索引
    showMedicationRecordModal: false,  // 显示药物记录详情的弹窗
    selectedMedicationRecord: null,    // 当前选中的药物记录
    app: null,  // 将app实例保存到data中，便于条件渲染
    activeTab: 'feeding', // 当前激活的选项卡：'feeding' 或 'medication'
    proteinSourceType: 'breastMilk', // 蛋白质来源类型：'breastMilk' 或 'formulaMilk'
    proteinSourceLabel: '', // 用于显示的标签
    nutritionSettingsComplete: true, // 营养设置是否完整
    missingSettings: [], // 缺失的设置项
    showSettingsGuide: false, // 是否显示设置引导
    settingsGuideText: '', // 自定义的设置引导提示
    showQuickInputModal: false, // 是否显示快捷记录弹窗
    activeFeedingMenu: -1, // 当前打开的喂奶记录菜单项索引
    showAddFeedingModal: false, // 是否显示补充喂奶记录弹窗
    newFeeding: {
      startTime: '',
      endTime: '',
      startDateTime: '',
      endDateTime: '',
      naturalMilkVolume: '',
      totalVolume: '',
      specialMilkVolume: 0
    },
    showAddMedicationModal: false, // 是否显示补充用药记录弹窗
    newMedication: {
      name: '',
      volume: '',
              time: '',
        dateTime: ''
      }
  },

  onLoad() {
    // 将app实例保存到data中，便于条件渲染
    const app = getApp();
    
    this.setData({
      app: app
    });
    
    // 格式化今日日期
    this.setTodayDate();
    
    // 加载宝宝信息
    this.loadBabyInfo();
    
    this.checkLogin();
    this.loadMedications();
    this.loadCalculationParams();
    this.initQuickFeedingData();
    
    // 初始化当前喂奶记录的默认值
    this.initCurrentFeedingData();
  },

  // 初始化当前喂奶记录的默认值
  initCurrentFeedingData() {
    // 如果正在喂奶，不覆盖
    if (this.data.currentFeeding.startTime) {
      return;
    }
    
    // 检查当前是否已有输入的数据
    let hasExistingData = false;
    if (this.data.currentFeeding.naturalMilkVolume || this.data.currentFeeding.totalVolume) {
      hasExistingData = true;
    }
    
    // 如果已有数据，计算特奶量并返回
    if (hasExistingData) {
      this.updateSpecialMilkVolume();
      return;
    }
    
    // 尝试从上一条记录获取值
    let initialNaturalMilkVolume = '';
    let initialTotalVolume = '';
    
    if (this.data.feedings && this.data.feedings.length > 0) {
      const lastFeeding = this.data.feedings[this.data.feedings.length - 1];
      initialNaturalMilkVolume = lastFeeding.naturalMilkVolume;
      initialTotalVolume = lastFeeding.totalVolume;
    } else if (this.data.weight && this.data.calculation_params) {
      // 如果没有历史记录，使用基于体重和参数的计算值
      // 计算每餐所需天然奶量
      const weight = parseFloat(this.data.weight);
      const params = this.data.calculation_params;
      const dailyNaturalProtein = weight * params.natural_protein_coefficient;
      const naturalMilkNeeded = (dailyNaturalProtein * 100) / params.natural_milk_protein;
      
      // 假设一天8顿，计算每顿的理想量
      const perFeedingNaturalMilk = naturalMilkNeeded / 8;
      
      if (perFeedingNaturalMilk > 0) {
        // 基于计算值设置
        const roundedValue = Math.round(perFeedingNaturalMilk);
        const estimatedTotalVolume = Math.round(roundedValue * 1.5); // 估计总量约为天然奶量的1.5倍
        
        initialNaturalMilkVolume = roundedValue.toString();
        initialTotalVolume = estimatedTotalVolume.toString();
      }
    }
    
    // 设置默认值
    this.setData({
      'currentFeeding.naturalMilkVolume': initialNaturalMilkVolume,
      'currentFeeding.totalVolume': initialTotalVolume
    });
    
    // 计算特奶量
    this.updateSpecialMilkVolume();
  },

  // 设置今日日期，格式为 "YYYY年MM月DD日"
  setTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    
    this.setData({
      todayDate: `${year}年${month}月${day}日`
    });
  },

  onShow() {
    // 更新app实例，确保全局状态正确
    const app = getApp();
    
    this.setData({
      app: app
    });
    
    // 重新加载今日数据，确保数据最新
    this.loadTodayData(false);
    
    // 重新加载计算参数和药物数据
    this.loadCalculationParams();
    this.loadMedications();
    
    // 如果正在记录喂奶，恢复计时器并立即更新显示
    if (this.data.currentFeeding.startTime && !this.data.currentFeeding.endTime) {
      // 恢复计时之前先更新一次显示
      this.updateTimerDisplay();
      this.startTimer();
    } else {
      // 如果没有正在进行的喂奶记录，初始化默认值
      this.initCurrentFeedingData();
    }
    
    // 更新体重显示
    this.loadDefaultWeight();
    
    // 重新加载宝宝信息（可能有更新）
    this.loadBabyInfo();
    
    // 检查计算参数的完整性
    if (this.data.calculation_params) {
      this.checkNutritionSettings();
    }
  },

  onHide() {
    // 页面隐藏时停止计时器
    this.stopTimer();
  },

  onUnload() {
    // 页面关闭时停止计时器
    this.stopTimer();
  },

  // 从云数据库加载计算参数
  async loadCalculationParams() {
    try {
      wx.showLoading({
        title: '加载参数中...'
      });

      // 获取宝宝UID
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，使用默认营养设置');
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ calculation_params: defaultSettings });
        wx.hideLoading();
        // 验证默认设置的完整性
        this.checkNutritionSettings();
        return;
      }
      
      // 获取宝宝信息以获取蛋白质来源类型
      const db = wx.cloud.database();
      const babyInfo = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      let proteinSourceType = 'breastMilk'; // 默认为母乳
      let proteinSourceLabel = '母乳';
      
      if (babyInfo.data && babyInfo.data.length > 0) {
        if (babyInfo.data[0].proteinSourceType === 'formulaMilk') {
          proteinSourceType = 'formulaMilk';
          proteinSourceLabel = '普通奶粉';
        }
      }
      
      // 设置蛋白质来源标签，用于UI显示
      this.setData({
        proteinSourceLabel: proteinSourceLabel
      });
      
      // 已登录状态，获取营养设置，必须传入 babyUid 参数
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      
      // 确保所有必需的参数都存在
      const defaultParams = {
        natural_protein_coefficient: 1.2,  // 天然蛋白系数 g/kg
        natural_milk_protein: proteinSourceType === 'breastMilk' ? 1.1 : 2.1, // 根据来源设置不同的默认值
        special_milk_protein: 13.1,       // 特奶蛋白质含量 g/100g
        special_milk_ratio: {
          powder: 13.5,                   // 特奶粉量 g
          water: 90                       // 特奶水量 ml
        }
      };
      
      // 如果是普通奶粉，添加奶粉冲配比例默认值
      if (proteinSourceType === 'formulaMilk') {
        defaultParams.formula_milk_ratio = {
          powder: 7,                     // 奶粉量 g
          water: 100                     // 水量 ml
        };
      }

      // 合并默认值和从服务器获取的设置（如果有）
      const params = {
        ...defaultParams,
        ...(settings || {})
      };
      
      // 确保特奶和普通奶粉的冲配比例对象结构完整
      if (proteinSourceType === 'formulaMilk' && !params.formula_milk_ratio) {
        params.formula_milk_ratio = defaultParams.formula_milk_ratio;
      }
      
      if (!params.special_milk_ratio) {
        params.special_milk_ratio = defaultParams.special_milk_ratio;
      }

      // 更新计算参数
      this.setData({
        calculation_params: params
      }, () => {
        // 更新参数后重新计算所有相关数值
        if (this.data.weight) {
          this.updateCalculations();
        }
        
        // 验证设置的完整性
        this.checkNutritionSettings();
      });
      
      wx.hideLoading();
    } catch (error) {
      console.error('加载计算参数失败:', error);
      
      // 使用NutritionModel中的默认值
      const defaultSettings = NutritionModel.createDefaultSettings();
      
      this.setData({
        calculation_params: defaultSettings
      });
      
      wx.hideLoading();
      
      // 验证默认设置的完整性
      this.checkNutritionSettings();
      
      // 只在调试模式下显示错误提示
      if (wx.getSystemInfoSync().platform === 'devtools') {
        wx.showToast({
          title: '加载参数失败，使用默认值',
          icon: 'none'
        });
      }
    }
  },

  // 更新所有计算
  updateCalculations() {
    if (!this.data.weight) return;
    
    // 检查参数完整性，如果不完整则不进行计算
    if (!this.data.nutritionSettingsComplete) return;

    const weight = parseFloat(this.data.weight);
    const params = this.data.calculation_params;
    
    // 检查params是否为null或undefined
    if (!params) {
      console.log('calculation_params为空，无法进行计算');
      return;
    }
    
    // 确定蛋白质来源类型
    const isBreastMilk = this.data.proteinSourceType === 'breastMilk';

    // 计算每日所需天然蛋白量(体重 * 天然系数)
    const dailyNaturalProtein = weight * params.natural_protein_coefficient;
    // 每日天然奶总量(ml or g)
    const naturalMilkNeeded = (dailyNaturalProtein * 100) / params.natural_milk_protein;
    
    const resultObj = {}
    resultObj.dailyNaturalProtein = dailyNaturalProtein.toFixed(2)
    
    if(isBreastMilk) {  // 如果是母乳
      resultObj.requiredNaturalMilk = Math.round(naturalMilkNeeded).toString() // 每日母乳体积
    } else {  // 如果是普通奶粉
      // 计算普奶奶粉克重
      const tpl = (naturalMilkNeeded * params.formula_milk_ratio?.water) / params.formula_milk_ratio.powder
      resultObj.requiredNaturalMilk = Math.round(tpl).toString() // 每日普奶体积
      resultObj.formulaPowderNeeded = naturalMilkNeeded.toFixed(1) // 每日普奶重量
    }

    // 计算已喂天然奶总量
    const totalNaturalMilkFed = this.data.feedings.reduce((sum, feeding) => {
      return sum + (parseFloat(feeding.naturalMilkVolume) || 0);
    }, 0);

    resultObj.totalNaturalMilkFed = Math.round(totalNaturalMilkFed).toString() // 每日已喂总量

    // 计算剩余需要喂的天然奶量
    const remainingNaturalMilk = Math.max(0, Number(resultObj.requiredNaturalMilk) - totalNaturalMilkFed);

    resultObj.remainingNaturalMilk = Math.round(remainingNaturalMilk).toString()

    // 如果有当前喂养记录，计算特奶量
    if (this.data.currentFeeding && this.data.currentFeeding.totalVolume) {
      const totalVolume = parseFloat(this.data.currentFeeding.totalVolume);
      const naturalMilkVolume = parseFloat(this.data.currentFeeding.naturalMilkVolume) || 0;
      const specialMilkVolume = Math.max(0, totalVolume - naturalMilkVolume);

      this.setData({
        'currentFeeding.specialMilkVolume': specialMilkVolume.toFixed(0)
      });
    }

    this.setData(resultObj);
  },

  // 处理体重输入
  onWeightInput(e) {
    const weight = e.detail.value;
    this.setData({ weight }, () => {
      this.updateCalculations();
      this.saveWeight(weight);
    });
  },

  // 处理总奶量输入
  onTotalVolumeInput(e) {
    const totalVolume = parseFloat(e.detail.value);
    if (isNaN(totalVolume)) return;

    // 计算每顿所需天然奶量
    let naturalMilkVolume = 0;
    if (this.data.weight && this.data.calculation_params) {
      const weight = parseFloat(this.data.weight);
      const params = this.data.calculation_params;
      const dailyNaturalProtein = weight * params.natural_protein_coefficient;
      const naturalMilkNeeded = (dailyNaturalProtein * 100) / params.natural_milk_protein;
      // 假设一天8顿，计算每顿的理想量
      naturalMilkVolume = naturalMilkNeeded / 8;
    }

    const specialMilkVolume = Math.max(0, totalVolume - naturalMilkVolume);

    this.setData({
      'currentFeeding.totalVolume': totalVolume.toFixed(1),
      'currentFeeding.specialMilkVolume': specialMilkVolume.toFixed(1)
    });
  },

  // 开始喂奶记录
  startFeeding() {
    // 验证必填字段
    if (!this.data.currentFeeding.naturalMilkVolume || !this.data.currentFeeding.totalVolume) {
      wx.showToast({
        title: '请先填写奶量',
        icon: 'none'
      });
      return;
    }
    
    // 验证数据有效性
    const naturalMilk = parseFloat(this.data.currentFeeding.naturalMilkVolume);
    const totalMilk = parseFloat(this.data.currentFeeding.totalVolume);
    
    if (isNaN(naturalMilk) || isNaN(totalMilk) || naturalMilk < 0 || totalMilk < 0) {
      wx.showToast({
        title: '请输入有效的奶量',
        icon: 'none'
      });
      return;
    }
    
    if (naturalMilk > totalMilk) {
      wx.showToast({
        title: '天然奶量不能大于总奶量',
        icon: 'none'
      });
      return;
    }
    
    // 获取当前时间
    const now = new Date();
    const formattedTime = this.formatTime(now);
    
    // 只更新开始时间，保留用户输入的奶量
    this.setData({
      'currentFeeding.startTime': formattedTime,
      'currentFeeding.endTime': ''
    });
    
    // 启动计时器
    this.startTimer();
    
    // 显示开始喂奶提示
    wx.showToast({
      title: '开始记录喂奶',
      icon: 'success'
    });
  },
  
  // 撤销当前喂奶记录
  cancelFeeding() {
    // 显示确认对话框
    wx.showModal({
      title: '确认撤销',
      content: '确定要撤销当前喂奶记录吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          // 停止计时器
          this.stopTimer();
          
          // 保存当前的天然奶量和总奶量
          const naturalMilkVolume = this.data.currentFeeding.naturalMilkVolume;
          const totalVolume = this.data.currentFeeding.totalVolume;
          const specialMilkVolume = this.data.currentFeeding.specialMilkVolume;
          const specialMilkPowder = this.data.currentFeeding.specialMilkPowder;
          
          // 重置当前喂奶状态
          this.setData({
            currentFeeding: {
              startTime: '',
              endTime: '',
              naturalMilkVolume: naturalMilkVolume,
              specialMilkVolume: specialMilkVolume,
              specialMilkPowder: specialMilkPowder,
              totalVolume: totalVolume
            },
            elapsedTime: '00:00'
          });
          
          // 显示提示
          wx.showToast({
            title: '已撤销',
            icon: 'success',
            duration: 1500
          });
        }
      }
    });
  },
  
  // 结束喂奶记录
  endFeeding() {
    // 验证必填字段
    if (!this.data.currentFeeding.startTime) {
      wx.showToast({
        title: '请先开始喂奶',
        icon: 'none'
      });
      return;
    }
    
    // 获取现在的时间作为结束时间
    const now = new Date();
    const endTime = this.formatTime(now);
    
    // 停止计时器
    this.stopTimer();
    
    // 保存当前的奶量数据，用于下一次记录
    const naturalMilkVolume = this.data.currentFeeding.naturalMilkVolume;
    const specialMilkVolume = this.data.currentFeeding.specialMilkVolume;
    const specialMilkPowder = this.data.currentFeeding.specialMilkPowder;
    const totalVolume = this.data.currentFeeding.totalVolume;
    
    // 准备记录数据
    const feeding = {
      startTime: this.data.currentFeeding.startTime,
      endTime: endTime,
      naturalMilkVolume: Math.round(parseFloat(naturalMilkVolume)).toString(),
      specialMilkVolume: Math.round(parseFloat(specialMilkVolume)).toString(),
      specialMilkPowder: parseFloat(specialMilkPowder).toFixed(1),
      totalVolume: Math.round(parseFloat(totalVolume)).toString()
    };
    
    // 保存记录
    this.saveFeedingRecord(feeding)
      .then(() => {
        // 只重置计时相关数据，保留奶量
        this.setData({
          currentFeeding: {
            startTime: '',
            endTime: '',
            naturalMilkVolume: naturalMilkVolume,
            specialMilkVolume: specialMilkVolume,
            specialMilkPowder: specialMilkPowder,
            totalVolume: totalVolume
          },
          elapsedTime: '00:00'
        });
        
        // 更新统计数据（使用静默模式）
        this.loadTodayData(true);
        
        // 显示成功提示
        wx.showToast({
          title: '记录已保存',
          icon: 'success'
        });
      })
      .catch(error => {
        console.error('保存喂奶记录失败:', error);
        
        wx.showToast({
          title: '保存失败',
          icon: 'none'
        });
      });
  },
  
  // 处理喂奶输入
  onFeedingInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    // 更新当前喂奶数据
    const currentFeeding = { ...this.data.currentFeeding };
    currentFeeding[field] = value;
    
    // 如果是天然奶量输入，计算奶粉克重
    if (field === 'naturalMilkVolume') {
      currentFeeding.formulaPowderWeight = this.calculateFormulaPowderWeight(value);
    }
    
    // 先设置数据
    this.setData({ currentFeeding }, () => {
      // 在回调中计算特奶量，确保数据已更新
      this.updateSpecialMilkVolume();
    });
  },

  // Load today's data from cloud database
  async loadTodayData(silent = false) {
    try {
      if (!silent) {
        wx.showLoading({
          title: '加载中...',
        });
      }
      
      const db = wx.cloud.database();
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // 获取今天的0点
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能加载到错误的记录');
      }
      
      // 并行查询喂养记录和药物记录
      const [feedingResult, medicationResult] = await Promise.all([
        // 查询喂养记录
        db.collection('feeding_records')
          .where({
            date: db.command.gte(startOfDay),
            babyUid: babyUid
          })
          .get(),
        
        // 查询今日药物记录
        babyUid ? MedicationRecordModel.getTodayRecords(babyUid) : Promise.resolve({ data: [] })
      ]);
      
      // 等待加载药物列表
      await this.loadMedications(silent);
      
      // 处理喂养记录
      let feedingsToSet = [];
      let weightToSet = '';
      let recordId = '';
      
      if (feedingResult.data.length > 0) {
        const record = feedingResult.data[0];
        feedingsToSet = this.sortFeedingsByTimeDesc(record.feedings || []);
        recordId = record._id;
        
        // 获取基本信息（兼容旧数据结构）
        if (record.basicInfo && record.basicInfo.weight) {
          weightToSet = record.basicInfo.weight;
        } else if (record.weight) {
          weightToSet = record.weight;
        }
      } else {
        // 如果没有今日记录，尝试获取默认体重
        if (!this.data.weight) {
          await this.loadDefaultWeight();
        }
      }
      
      // 处理药物记录 - 使用独立集合的数据
      const medicationRecordsToSet = medicationResult.data || [];
      const groupedMedicationRecords = MedicationRecordModel.groupRecordsByMedication(medicationRecordsToSet);

      // 设置数据
      this.setData({
        feedings: feedingsToSet,
        medicationRecords: medicationRecordsToSet,
        groupedMedicationRecords: groupedMedicationRecords,
        weight: weightToSet,
        recordId: recordId
      });
      
      if (this.data.weight) {
        this.updateCalculations();
      }
      
      // Calculate natural milk stats after loading data
      this.calculateNaturalMilkStats();
      
      if (!silent) {
        wx.hideLoading();
      }
    } catch (error) {
      if (!silent) {
        wx.hideLoading();
      }
      console.error('加载数据失败:', error);
    }
  },
  
  // 对喂奶记录按时间倒序排序
  sortFeedingsByTimeDesc(feedings) {
    return [...feedings].sort((a, b) => {
      // 首先比较开始时间
      const aStartTime = a.startTime;
      const bStartTime = b.startTime;
      
      // 将时间格式 "HH:MM" 转换为可比较的格式
      const aTimeParts = aStartTime.split(':').map(Number);
      const bTimeParts = bStartTime.split(':').map(Number);
      
      // 比较小时
      if (aTimeParts[0] !== bTimeParts[0]) {
        return bTimeParts[0] - aTimeParts[0]; // 降序排列
      }
      
      // 小时相同时比较分钟
      return bTimeParts[1] - aTimeParts[1]; // 降序排列
    });
  },
  
  // 对药物记录按时间倒序排序
  sortMedicationsByTimeDesc(medicationRecords) {
    return [...medicationRecords].sort((a, b) => {
      // 比较时间
      const aTime = a.time;
      const bTime = b.time;
      
      // 将时间格式 "HH:MM" 转换为可比较的格式
      const aTimeParts = aTime.split(':').map(Number);
      const bTimeParts = bTime.split(':').map(Number);
      
      // 比较小时
      if (aTimeParts[0] !== bTimeParts[0]) {
        return bTimeParts[0] - aTimeParts[0]; // 降序排列
      }
      
      // 小时相同时比较分钟
      return bTimeParts[1] - aTimeParts[1]; // 降序排列
    });
  },



  // 加载默认体重（从宝宝信息或历史记录中）
  async loadDefaultWeight() {
    try {
      // 首先尝试从宝宝信息获取体重
      if (this.data.babyInfo && this.data.babyInfo.weight) {
        this.setData({ weight: this.data.babyInfo.weight });
        this.updateCalculations();
        return;
      }
      
      // 如果宝宝信息没有体重，尝试获取最近一条记录的体重
      const db = wx.cloud.database();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const result = await db.collection('feeding_records')
        .where({
          date: db.command.lt(today)
        })
        .orderBy('date', 'desc')
        .limit(1)
        .get();
      
      if (result.data && result.data.length > 0) {
        const lastRecord = result.data[0];
        if (lastRecord.weight) {
          this.setData({ weight: lastRecord.weight });
          this.updateCalculations();
        }
      }
    } catch (error) {
      console.error('加载默认体重失败:', error);
    }
  },

  // Save weight to cloud database
  async saveWeight(weight) {
    try {
      // 检查登录状态
      const app = getApp();
      if (!app.globalData.isLoggedIn) {
        return; // 未登录，跳过保存体重
      }
      
      const db = wx.cloud.database();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // 获取宝宝UID，用于数据关联
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能导致数据同步问题');
      }

      if (this.data.recordId) {
        // Update existing record with new basicInfo structure
        await db.collection('feeding_records').doc(this.data.recordId).update({
          data: {
            'basicInfo.weight': weight,
            updatedAt: db.serverDate()
          }
        });
      } else {
        // Create new record with basicInfo structure
        const app = getApp();
        if (!app.globalData.userInfo) {
          return; // 如果没有用户信息，直接返回
        }
        
        // 创建基本信息对象
        const basicInfo = {
          weight: weight,
          // 可以在这里添加更多基本信息，如身高等
        };
        
        const result = await db.collection('feeding_records').add({
          data: {
            date: today,
            basicInfo: basicInfo, // 使用新的数据结构
            feedings: [],
            medicationRecords: [],
            userInfo: app.globalData.userInfo,         // 关联用户信息
            nickName: app.globalData.userInfo.nickName, // 用户昵称
            babyUid: babyUid, // 添加宝宝UID，用于数据同步和查询
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        
        this.setData({
          recordId: result._id
        });
      }
      
      // 同时更新宝宝信息中的体重
      if (weight) {
        this.updateBabyInfoWeight(weight);
      }
    } catch (error) {
      console.error('保存体重失败:', error);
      // 仅在调试环境显示错误
      if (wx.getSystemInfoSync().platform === 'devtools') {
        wx.showToast({
          title: '保存体重失败',
          icon: 'none'
        });
      }
    }
  },
  
  // 更新宝宝信息中的体重
  async updateBabyInfoWeight(weight) {
    try {
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) return;
      
      const result = await db.collection('baby_info')
        .where({ babyUid: babyUid })
        .get();
      
      if (result.data && result.data.length > 0) {
        await db.collection('baby_info').doc(result.data[0]._id).update({
          data: {
            weight: weight,
            updatedAt: db.serverDate()
          }
        });
      }
    } catch (error) {
      console.error('更新宝宝信息体重失败:', error);
    }
  },

  // 格式化时间，返回 HH:MM 格式
  formatTime(date) {
    if (!date) date = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  },
  
  // 处理快捷开始时间变更
  onQuickStartTimeChange(e) {
    this.setData({
      'quickFeedingData.startTime': e.detail.value
    });
    
    // 验证时间选择是否合理（结束时间不能早于开始时间）
    const startTime = e.detail.value;
    const endTime = this.data.quickFeedingData.endTime;
    
    if (startTime && endTime && startTime > endTime) {
      // 如果开始时间晚于结束时间，将结束时间设置为开始时间后20分钟
      const startDate = new Date();
      const [startHours, startMinutes] = startTime.split(':').map(Number);
      startDate.setHours(startHours, startMinutes);
      
      const endDate = new Date(startDate.getTime() + 20 * 60 * 1000);
      const formattedEndTime = this.formatTime(endDate);
      
      this.setData({
        'quickFeedingData.endTime': formattedEndTime
      });
    }
  },

  // 处理快捷输入结束时间变化
  onQuickEndTimeChange(e) {
    const timeStr = e.detail.value;
    
    this.setData({
      'quickFeedingData.endTime': timeStr
    });
  },
  
  // 保存快速记录
  saveQuickFeeding() {
    // 检查必要字段是否填写
    const { naturalMilkVolume, totalVolume, startTime, endTime } = this.data.quickFeedingData;
    
    if (!naturalMilkVolume || !totalVolume || !startTime || !endTime) {
      wx.showToast({
        title: '请填写所有必要信息',
        icon: 'none'
      });
      return;
    }
    
    const naturalMilkNum = parseFloat(naturalMilkVolume);
    const totalVolumeNum = parseFloat(totalVolume);
    
    // 验证数据有效性
    if (isNaN(naturalMilkNum) || isNaN(totalVolumeNum) || naturalMilkNum < 0 || totalVolumeNum < 0) {
      wx.showToast({
        title: '请输入有效的奶量',
        icon: 'none'
      });
      return;
    }
    
    if (naturalMilkNum > totalVolumeNum) {
      wx.showToast({
        title: '天然奶量不能大于总奶量',
        icon: 'none'
      });
      return;
    }
    
    // 确保时间格式正确并验证时间顺序
    if (startTime >= endTime) {
      wx.showToast({
        title: '结束时间必须晚于开始时间',
        icon: 'none'
      });
      return;
    }
    
    // 计算特奶量
    const specialMilkVolume = Math.max(0, totalVolumeNum - naturalMilkNum);
    
    // 计算特奶粉克重
    const specialMilkPowder = this.calculateSpecialMilkPowder(specialMilkVolume);
    
    // 创建Date对象
    const now = new Date();
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    
    const startDateTime = new Date(now);
    startDateTime.setHours(startHours, startMinutes, 0, 0);
    
    const endDateTime = new Date(now);
    endDateTime.setHours(endHours, endMinutes, 0, 0);
    
    // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
    if (endDateTime < startDateTime) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }
    
    // 创建喂奶记录对象
    const feeding = {
      startTime: startTime,
      endTime: endTime,
      startDateTime: startDateTime, // 添加标准时间对象
      endDateTime: endDateTime,     // 添加标准时间对象
      naturalMilkVolume: naturalMilkNum.toString(),
      specialMilkVolume: specialMilkVolume.toString(),
      specialMilkPowder: specialMilkPowder.toFixed(1),
      totalVolume: totalVolumeNum.toString()
    };
    
    // 尝试保存记录
    wx.showLoading({
      title: '保存中...'
    });
    
    this.saveFeedingRecord(feeding)
      .then(() => {
        // 隐藏弹窗
        this.hideQuickInputModal();
        
        // 重置表单
        this.initQuickFeedingData();
        
        // 刷新数据以显示最新记录（使用静默模式）
        this.loadTodayData(true);
        
        wx.hideLoading();
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        });
      })
      .catch(error => {
        console.error('保存快速喂奶记录失败:', error);
        wx.hideLoading();
        wx.showToast({
          title: '保存失败',
          icon: 'none'
        });
      });
  },

  // 从云数据库加载药物列表
  async loadMedications(silent = false) {
    try {
      if (!silent) {
        wx.showLoading({
          title: '加载药物列表...'
        });
      }
      
      // 引入药物模型
      const MedicationModel = require('../../models/medication');
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法加载药物列表');
        this.setData({
          medicationsList: []
        });
        if (!silent) wx.hideLoading();
        return;
      }
      
      // 获取药物列表
      const medications = await MedicationModel.getMedications();
      
      // 更新药物列表
      this.setData({
        medicationsList: medications || []
      });
      
      if (!silent) {
        wx.hideLoading();
      }
    } catch (error) {
      console.error('加载药物数据失败:', error);
      
      if (!silent) {
        wx.hideLoading();
        
        // 显示错误提示
        wx.showToast({
          title: '加载药物失败',
          icon: 'none'
        });
      }
    }
  },

  // Open medication modal
  openMedicationModal(e) {
    const { medication } = e.currentTarget.dataset;
    const now = new Date();
    const formattedTime = this.formatTime(now);
    
    // 根据ID找到对应的药物信息
    const medicationInfo = this.data.medicationsList.find(med => med._id === medication);
    
    if (!medicationInfo) {
      wx.showToast({
        title: '未找到药物信息',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      showMedicationModal: true,
      selectedMedication: medication,
      selectedMedicationInfo: medicationInfo, // 存储完整的药物信息对象
      currentModalTime: formattedTime,
      currentModalDosage: medicationInfo.dosage // 初始化为默认剂量
    });
  },

  // Close medication modal
  closeMedicationModal() {
    this.setData({
      showMedicationModal: false,
      selectedMedication: null,
      selectedMedicationInfo: null,
      currentModalTime: '',
      currentModalDosage: '' // 清理剂量
    });
  },

  // 处理用药时间变更
  onMedicationTimeChange(e) {
    const timeStr = e.detail.value;
    
    // 创建Date对象
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateTime = new Date(now);
    dateTime.setHours(hours, minutes, 0, 0);
    
    this.setData({
      currentModalTime: timeStr,
      currentModalDateTime: dateTime
    });
  },

  // 处理记录用药弹窗中的剂量变更
  onMedicationDosageChange(e) {
    const dosage = e.detail.value;
    this.setData({
      currentModalDosage: dosage
    });
  },

  // 处理药物记录详情弹窗中的剂量变更
  onMedicationRecordDosageChange(e) {
    const dosage = e.detail.value;
    this.setData({
      'selectedMedicationRecord.dosage': dosage
    });
  },

  // Record medication
  async recordMedication() {
    const { selectedMedication, currentModalTime, currentModalDateTime, currentModalDosage } = this.data;
    
    // 从medicationsList中查找药物信息
    const medInfo = this.data.medicationsList.find(med => med._id === selectedMedication);
    
    if (!medInfo) {
      wx.showToast({
        title: '药物信息不存在',
        icon: 'none'
      });
      return;
    }

    // 校验剂量是否为空
    const finalDosage = currentModalDosage;
    if (!finalDosage || finalDosage.trim() === '') {
      wx.showToast({
        title: '请输入药物剂量',
        icon: 'none'
      });
      return;
    }

    // 校验剂量是否为有效数字
    const dosageNumber = parseFloat(finalDosage);
    if (isNaN(dosageNumber) || dosageNumber <= 0) {
      wx.showToast({
        title: '请输入有效的剂量数值',
        icon: 'none'
      });
      return;
    }

    // 获取宝宝UID
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    if (!babyUid) {
      wx.showToast({
        title: '未找到宝宝信息',
        icon: 'none'
      });
      return;
    }

    // 如果没有设置时间对象，创建一个
    let dateTime = currentModalDateTime;
    if (!dateTime) {
      const now = new Date();
      const [hours, minutes] = currentModalTime.split(':').map(Number);
      dateTime = new Date(now);
      dateTime.setHours(hours, minutes, 0, 0);
    }
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      // 使用新的数据结构保存到独立集合
      const medicationData = {
        medicationId: selectedMedication,
        medicationName: medInfo.name,
        dosage: finalDosage, // 使用校验后的剂量
        unit: medInfo.unit,
        frequency: medInfo.frequency,
        actualTime: currentModalTime,
        actualDateTime: dateTime
      };
      
      // 保存到独立集合
      const result = await MedicationRecordModel.addRecord(medicationData);
      
      // 关闭弹窗
      this.setData({
        showMedicationModal: false
      });
      
      // 显示成功动画
      this.showMedicationSuccessAnimation(medInfo.name);
      
      // 刷新数据以确保展示最新记录（使用静默模式）
      await this.loadTodayData(true);
      
      wx.hideLoading();
      
    } catch (error) {
      console.error('保存药物记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  // Show medication success animation
  showMedicationSuccessAnimation(medicationName) {
    wx.showToast({
      title: `${medicationName}已记录`,
      icon: 'success',
      duration: 2000
    });
  },

  // Calculate total natural milk fed and remaining amount
  calculateNaturalMilkStats() {
    const totalNaturalMilkFed = this.data.feedings.reduce((sum, feeding) => {
      return sum + (parseFloat(feeding.naturalMilkVolume) || 0);
    }, 0);

    const remainingNaturalMilk = Math.max(0, this.data.requiredNaturalMilk - totalNaturalMilkFed);

    this.setData({
      'totalNaturalMilkFed': Math.round(totalNaturalMilkFed).toString(),
      'remainingNaturalMilk': Math.round(remainingNaturalMilk).toString()
    });
  },

  // 初始化快捷填写数据
  initQuickFeedingData() {
    // 获取当前时间
    const now = new Date();
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
    
    // 设置时间默认值
    this.setData({
      'quickFeedingData.startTime': this.formatTime(twentyMinutesAgo),
      'quickFeedingData.endTime': this.formatTime(now)
    });
    
    // 尝试从上一次记录中获取值
    const lastFeeding = this.data.feedings[this.data.feedings.length - 1];
    
    if (lastFeeding) {
      // 使用上一次记录的值
      this.setData({
        'quickFeedingData.naturalMilkVolume': lastFeeding.naturalMilkVolume,
        'quickFeedingData.totalVolume': lastFeeding.totalVolume
      });
    } else if (this.data.weight && this.data.calculation_params) {
      // 如果没有历史记录，使用基于体重和参数的计算值
      // 计算每餐所需天然奶量
      const weight = parseFloat(this.data.weight);
      const params = this.data.calculation_params;
      const dailyNaturalProtein = weight * params.natural_protein_coefficient;
      const naturalMilkNeeded = (dailyNaturalProtein * 100) / params.natural_milk_protein;
      
      // 假设一天8顿，计算每顿的理想量
      const perFeedingNaturalMilk = naturalMilkNeeded / 8;
      
      if (perFeedingNaturalMilk > 0) {
        // 基于计算值设置
        const roundedValue = Math.round(perFeedingNaturalMilk);
        const estimatedTotalVolume = Math.round(roundedValue * 1.5); // 估计总量约为天然奶量的1.5倍
        
        this.setData({
          'quickFeedingData.naturalMilkVolume': roundedValue.toString(),
          'quickFeedingData.totalVolume': estimatedTotalVolume.toString()
        });
      } else {
        // 无法计算时，使用空值等待用户输入
        this.setData({
          'quickFeedingData.naturalMilkVolume': '',
          'quickFeedingData.totalVolume': ''
        });
      }
    } else {
      // 没有足够信息计算时，使用空值
      this.setData({
        'quickFeedingData.naturalMilkVolume': '',
        'quickFeedingData.totalVolume': '',
        'quickFeedingData.specialMilkVolume': '0',
        'quickFeedingData.specialMilkPowder': '0'
      });
    }

    // 计算特奶量和特奶粉量
    this.calculateQuickSpecialMilk();
  },

  // 计算快捷填写的特奶量
  calculateQuickSpecialMilk() {
    const naturalMilk = parseFloat(this.data.quickFeedingData.naturalMilkVolume) || 0;
    const totalVolume = parseFloat(this.data.quickFeedingData.totalVolume) || 0;
    const specialMilkVolume = Math.max(0, totalVolume - naturalMilk);
    
    // 计算特奶粉克重
    const specialMilkPowder = this.calculateSpecialMilkPowder(specialMilkVolume);
    
    this.setData({
      'quickFeedingData.specialMilkVolume': specialMilkVolume.toFixed(0),
      'quickFeedingData.specialMilkPowder': specialMilkPowder.toFixed(1)
    });
  },

  // 计算特奶粉克重
  calculateSpecialMilkPowder(specialMilkVolume) {
    if (!this.data.calculation_params || !specialMilkVolume || specialMilkVolume <= 0) {
      return 0;
    }
    
    const params = this.data.calculation_params;
    if (!params.special_milk_ratio || !params.special_milk_ratio.powder || !params.special_milk_ratio.water) {
      return 0;
    }
    
    // 特奶粉重量 = 特奶量 * (特奶粉量 / 特奶水量)
    const ratio = params.special_milk_ratio.powder / params.special_milk_ratio.water;
    // 计算结果保留一位小数
    return Math.round(specialMilkVolume * ratio * 10) / 10;
  },

  // 快捷填写输入处理
  onQuickFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    if (field === 'quickNaturalMilk') {
      this.setData({
        'quickFeedingData.naturalMilkVolume': value
      });
    } else if (field === 'quickTotalVolume') {
      this.setData({
        'quickFeedingData.totalVolume': value
      });
    }
    
    // 重新计算特奶量
    this.calculateQuickSpecialMilk();
  },

  // 保存喂奶记录
  async saveFeedingRecord(feeding) {
    try {
      wx.showLoading({ title: '保存中...' });

      // 获取当前日期（只保留年月日）
      const now = new Date();
      const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // 获取宝宝UID，用于数据关联
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能导致数据同步问题');
      }
      
      // 添加babyUid到喂奶记录中
      feeding.babyUid = babyUid;
      feeding.createdAt = new Date(); // 添加创建时间
      
      // 保存到数据库
      const db = wx.cloud.database();
      
      // 检查记录ID是否存在，存在则判断是否是当天的记录
      let shouldCreateNewRecord = true;

      if (this.data.recordId) {
        // 获取已有记录数据
        const existingRecord = await db.collection('feeding_records').doc(this.data.recordId).get();
        if (existingRecord && existingRecord.data) {
          const recordDate = new Date(existingRecord.data.date);
          
          // 如果记录日期与当前日期相同（同一天），则更新该记录
          if (recordDate.getFullYear() === currentDate.getFullYear() &&
              recordDate.getMonth() === currentDate.getMonth() &&
              recordDate.getDate() === currentDate.getDate()) {
            
            // 是当天的记录，更新它
            shouldCreateNewRecord = false;
            
            await db.collection('feeding_records').doc(this.data.recordId).update({
              data: {
                feedings: db.command.push(feeding),
                'basicInfo.weight': this.data.weight || '', // 更新体重信息
                updatedAt: db.serverDate()
              }
            });
          }
        }
      }
      
      // 如果不是当天的记录或没有记录ID，创建新记录
      if (shouldCreateNewRecord) {
        // 创建基本信息对象
        const basicInfo = {
          weight: this.data.weight || '',
          // 可以在这里添加更多基本信息，如身高等
        };
        
        const result = await db.collection('feeding_records').add({
          data: {
            date: currentDate,
            basicInfo: basicInfo, // 使用新的数据结构
            feedings: [feeding],
            medicationRecords: [],
            babyUid: babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        
        // 保存新记录的ID
        this.setData({
          recordId: result._id
        });
      }
      
      // 更新本地数据 - 将新记录添加到数组开头（时间倒序）
      const updatedFeedings = [feeding, ...this.data.feedings];
      
      this.setData({
        feedings: updatedFeedings
      });
      
      // 刷新计算结果
      this.calculateNaturalMilkStats();
      
      wx.hideLoading();
      
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
      
      return Promise.resolve();
    } catch (error) {
      console.error('保存喂奶记录失败:', error);
      
      wx.hideLoading();
      
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
      
      return Promise.reject(error);
    }
  },
  
  // 根据时间字符串判断日期
  getFeedingDate(timeString) {
    // 获取当前日期
    const now = new Date();
    const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // 解析喂奶时间（格式为 HH:MM）
    const [hours, minutes] = timeString.split(':').map(Number);
    
    // 判断是否是凌晨时间（0点到5点之间）
    // 如果是凌晨时间，且当前时间是白天或晚上，则认为这个记录是第二天的
    const currentHour = now.getHours();
    
    if (hours >= 0 && hours < 5 && currentHour >= 9) {
      // 创建明天的日期
      const tomorrow = new Date(currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    
    return currentDate;
  },

  // 启动计时器
  startTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
    }
    
    // 保存开始时间
    this.startTimestamp = new Date().getTime();
    
    // 立即更新一次计时器显示
    this.updateTimerDisplay();
    
    const timerInterval = setInterval(() => {
      this.updateTimerDisplay();
    }, 1000);
    
    this.setData({ timerInterval });
  },
  
  // 更新计时器显示
  updateTimerDisplay() {
    // 如果没有计时开始时间戳，不更新显示
    if (!this.startTimestamp) return;
    
    const now = new Date().getTime();
    const diffMs = now - this.startTimestamp;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffSeconds = Math.floor((diffMs % 60000) / 1000);
    
    this.setData({
      elapsedTime: `${diffMinutes.toString().padStart(2, '0')}:${diffSeconds.toString().padStart(2, '0')}`
    });
  },
  
  // 停止计时器
  stopTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval);
      this.setData({
        timerInterval: null
      });
    }
  },

  // 增加/减少奶量
  increaseVolume(e) {
    const { field } = e.currentTarget.dataset;
    let currentValue = 0;
    let updateField = '';
    
    // 确定要更新的字段和当前值
    if (field === 'naturalMilkVolume') {
      currentValue = parseFloat(this.data.currentFeeding.naturalMilkVolume) || 0;
      updateField = 'currentFeeding.naturalMilkVolume';
    } else if (field === 'totalVolume') {
      currentValue = parseFloat(this.data.currentFeeding.totalVolume) || 0;
      updateField = 'currentFeeding.totalVolume';
    } else if (field === 'quickNaturalMilk') {
      currentValue = parseFloat(this.data.quickFeedingData.naturalMilkVolume) || 0;
      updateField = 'quickFeedingData.naturalMilkVolume';
    } else if (field === 'quickTotalVolume') {
      currentValue = parseFloat(this.data.quickFeedingData.totalVolume) || 0;
      updateField = 'quickFeedingData.totalVolume';
    }
    
    // 增加5ml
    const newValue = currentValue + 5;
    
    // 更新数据
    this.setData({
      [updateField]: newValue.toString()
    });
    
    // 如果需要，重新计算特奶量
    if (field === 'totalVolume' || field === 'naturalMilkVolume') {
      this.updateSpecialMilkVolume();
      
      // 如果是普奶且更新的是天然奶量，计算奶粉克重
      if (this.data.proteinSourceType === 'formulaMilk' && field === 'naturalMilkVolume') {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(newValue);
        this.setData({
          'currentFeeding.formulaPowderWeight': formulaPowderWeight
        });
      }
    } else if (field === 'quickNaturalMilk' || field === 'quickTotalVolume') {
      this.calculateQuickSpecialMilk();
      
      // 如果是普奶且更新的是天然奶量，计算奶粉克重
      if (this.data.proteinSourceType === 'formulaMilk' && field === 'quickNaturalMilk') {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(newValue);
        this.setData({
          'quickFeedingData.formulaPowderWeight': formulaPowderWeight
        });
      }
    }
  },
  
  decreaseVolume(e) {
    const { field } = e.currentTarget.dataset;
    let currentValue = 0;
    let updateField = '';
    
    // 确定要更新的字段和当前值
    if (field === 'naturalMilkVolume') {
      currentValue = parseFloat(this.data.currentFeeding.naturalMilkVolume) || 0;
      updateField = 'currentFeeding.naturalMilkVolume';
    } else if (field === 'totalVolume') {
      currentValue = parseFloat(this.data.currentFeeding.totalVolume) || 0;
      updateField = 'currentFeeding.totalVolume';
    } else if (field === 'quickNaturalMilk') {
      currentValue = parseFloat(this.data.quickFeedingData.naturalMilkVolume) || 0;
      updateField = 'quickFeedingData.naturalMilkVolume';
    } else if (field === 'quickTotalVolume') {
      currentValue = parseFloat(this.data.quickFeedingData.totalVolume) || 0;
      updateField = 'quickFeedingData.totalVolume';
    }
    
    // 减少5ml，但不小于0
    const newValue = Math.max(0, currentValue - 5);
    
    // 更新数据
    this.setData({
      [updateField]: newValue.toString()
    });
    
    // 如果需要，重新计算特奶量
    if (field === 'totalVolume' || field === 'naturalMilkVolume') {
      this.updateSpecialMilkVolume();
      
      // 如果是普奶且更新的是天然奶量，计算奶粉克重
      if (this.data.proteinSourceType === 'formulaMilk' && field === 'naturalMilkVolume') {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(newValue);
        this.setData({
          'currentFeeding.formulaPowderWeight': formulaPowderWeight
        });
      }
    } else if (field === 'quickNaturalMilk' || field === 'quickTotalVolume') {
      this.calculateQuickSpecialMilk();
      
      // 如果是普奶且更新的是天然奶量，计算奶粉克重
      if (this.data.proteinSourceType === 'formulaMilk' && field === 'quickNaturalMilk') {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(newValue);
        this.setData({
          'quickFeedingData.formulaPowderWeight': formulaPowderWeight
        });
      }
    }
  },
  
  // 更新特奶量
  updateSpecialMilkVolume() {
    const currentFeeding = { ...this.data.currentFeeding };
    const totalVolume = parseFloat(currentFeeding.totalVolume) || 0;
    const naturalMilkVolume = parseFloat(currentFeeding.naturalMilkVolume) || 0;
    
    // 计算特奶量
    currentFeeding.specialMilkVolume = Math.max(0, totalVolume - naturalMilkVolume);
    
    // 计算特奶粉克重，保留一位小数
    currentFeeding.specialMilkPowder = this.calculateSpecialMilkPowder(currentFeeding.specialMilkVolume).toFixed(1);
    
    this.setData({ currentFeeding });
  },

  // 打开编辑记录弹窗
  openEditModal(e) {
    const index = e.currentTarget.dataset.index;
    const feeding = this.data.feedings[index];
    
    // 确保有Date对象
    let startDateTime = feeding.startDateTime;
    let endDateTime = feeding.endDateTime;
    
    // 如果没有Date对象，从时间字符串创建
    if (!startDateTime) {
      const now = new Date();
      const [startHours, startMinutes] = feeding.startTime.split(':').map(Number);
      startDateTime = new Date(now);
      startDateTime.setHours(startHours, startMinutes, 0, 0);
    }
    
    if (!endDateTime) {
      const now = new Date();
      const [endHours, endMinutes] = feeding.endTime.split(':').map(Number);
      endDateTime = new Date(now);
      endDateTime.setHours(endHours, endMinutes, 0, 0);
      
      // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
      if (endDateTime < startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
      }
    }
    
    this.setData({
      showEditModal: true,
      editingFeedingIndex: index,
      editingFeeding: { 
        ...feeding,
        startDateTime: startDateTime,
        endDateTime: endDateTime
      },
      activeFeedingMenu: -1 // 关闭菜单
    });
  },

  // 关闭编辑记录弹窗
  closeEditModal() {
    this.setData({
      showEditModal: false,
      editingFeedingIndex: -1,
      editingFeeding: null // 清空编辑字段
    });
  },

  // 处理编辑记录的输入
  onEditFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    // 获取当前编辑的记录
    const editingFeeding = { ...this.data.editingFeeding };
    
    // 根据字段类型处理不同的输入
    if (field === 'startTime' || field === 'endTime') {
      // 时间字段，需要同时更新时间字符串和Date对象
      editingFeeding[field] = value;
      
      // 创建对应的Date对象
      const now = new Date();
      const [hours, minutes] = value.split(':').map(Number);
      const dateTime = new Date(now);
      dateTime.setHours(hours, minutes, 0, 0);
      
      if (field === 'startTime') {
        editingFeeding.startDateTime = dateTime;
      } else if (field === 'endTime') {
        editingFeeding.endDateTime = dateTime;
        
        // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
        if (editingFeeding.endDateTime < editingFeeding.startDateTime) {
          editingFeeding.endDateTime.setDate(editingFeeding.endDateTime.getDate() + 1);
        }
      }
    } else {
      // 其他字段直接更新值
      editingFeeding[field] = value;
    }
    
    // 更新数据
    this.setData({ editingFeeding });
    
    // 如果输入的是总奶量或天然奶量，计算特奶量
    if (field === 'naturalMilkVolume' || field === 'totalVolume') {
      this.updateEditingSpecialMilkVolume();
    }
  },

  // 更新编辑中的特奶量
  updateEditingSpecialMilkVolume() {
    const naturalMilkVolume = parseFloat(this.data.editingFeeding.naturalMilkVolume) || 0;
    const totalVolume = parseFloat(this.data.editingFeeding.totalVolume) || 0;
    const specialMilkVolume = Math.max(0, totalVolume - naturalMilkVolume);
    
    // 计算特奶粉克重
    const specialMilkPowder = this.calculateSpecialMilkPowder(specialMilkVolume);
    
    this.setData({
      'editingFeeding.specialMilkVolume': specialMilkVolume.toFixed(0),
      'editingFeeding.specialMilkPowder': specialMilkPowder.toFixed(1)
    });
  },

  // 保存编辑的记录
  async saveEditedFeeding() {
    try {
      wx.showLoading({ title: '保存中...' });
      
      // 更新特奶量
      this.updateEditingSpecialMilkVolume();
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能导致数据同步问题');
      }
      
      // 获取编辑后的喂奶记录
      const editedFeeding = {
        ...this.data.editingFeeding,
        naturalMilkVolume: Math.round(parseFloat(this.data.editingFeeding.naturalMilkVolume) || 0).toString(),
        specialMilkVolume: Math.round(parseFloat(this.data.editingFeeding.specialMilkVolume) || 0).toString(),
        totalVolume: Math.round(parseFloat(this.data.editingFeeding.totalVolume) || 0).toString(),
        specialMilkPowder: parseFloat(this.data.editingFeeding.specialMilkPowder || 0).toFixed(1),
        babyUid: babyUid // 确保记录中包含babyUid
      };
      
      // 确保编辑后的记录包含Date对象
      if (!editedFeeding.startDateTime || !editedFeeding.endDateTime) {
        const now = new Date();
        
        if (!editedFeeding.startDateTime) {
          const [startHours, startMinutes] = editedFeeding.startTime.split(':').map(Number);
          editedFeeding.startDateTime = new Date(now);
          editedFeeding.startDateTime.setHours(startHours, startMinutes, 0, 0);
        }
        
        if (!editedFeeding.endDateTime) {
          const [endHours, endMinutes] = editedFeeding.endTime.split(':').map(Number);
          editedFeeding.endDateTime = new Date(now);
          editedFeeding.endDateTime.setHours(endHours, endMinutes, 0, 0);
          
          // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
          if (editedFeeding.endDateTime < editedFeeding.startDateTime) {
            editedFeeding.endDateTime.setDate(editedFeeding.endDateTime.getDate() + 1);
          }
        }
      }
      
      // 更新数据库中的记录
      const db = wx.cloud.database();
      const index = this.data.editingFeedingIndex;
      
      // 创建一个副本来更新
      const updatedFeedings = [...this.data.feedings];
      updatedFeedings[index] = editedFeeding;
      
      await db.collection('feeding_records').doc(this.data.recordId).update({
        data: {
          feedings: updatedFeedings,
          updatedAt: db.serverDate()
        }
      });
      
      // 重新排序以保持时间倒序
      const sortedFeedings = this.sortFeedingsByTimeDesc(updatedFeedings);
      
      // 更新本地数据
      this.setData({
        feedings: sortedFeedings,
        showEditModal: false,
        editingFeedingIndex: -1,
        activeFeedingMenu: -1 // 确保菜单关闭
      });
      
      // 重新计算统计数据
      this.updateCalculations();
      
      wx.hideLoading();
      wx.showToast({ title: '保存成功' });
    } catch (error) {
      console.error('保存编辑记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  // 打开药物记录详情弹窗
  openMedicationRecordModal(e) {
    const { medicationId } = e.currentTarget.dataset;
    
    // 根据ID查找药物记录
    const record = this.data.medicationRecords.find(record => record._id === medicationId);
    
    if (!record) {
      wx.showToast({
        title: '未找到药物记录',
        icon: 'none'
      });
      return;
    }
    
    // 确保有Date对象
    let dateTime = record.actualDateTime;
    
    // 如果没有Date对象，从时间字符串创建
    if (!dateTime) {
      const now = new Date();
      const [hours, minutes] = record.actualTime.split(':').map(Number);
      dateTime = new Date(now);
      dateTime.setHours(hours, minutes, 0, 0);
    }
    
    this.setData({
      showMedicationRecordModal: true,
      selectedMedicationRecord: {
        ...record,
        dateTime: dateTime
      },
    });
  },

  // 关闭药物记录详情弹窗
  closeMedicationRecordModal() {
    this.setData({
      showMedicationRecordModal: false,
      selectedMedicationRecord: null,
    });
  },

  // 处理药物记录时间变更
  onMedicationRecordTimeChange(e) {
    const newTime = e.detail.value;
    const selectedRecord = this.data.selectedMedicationRecord;
    
    if (!selectedRecord || !selectedRecord._id) {
      wx.showToast({
        title: '选中的记录无效',
        icon: 'none'
      });
      return;
    }
    
    // 创建Date对象
    const now = new Date();
    const [hours, minutes] = newTime.split(':').map(Number);
    const dateTime = new Date(now);
    dateTime.setHours(hours, minutes, 0, 0);
    
    // 只更新显示，不立即保存到数据库
    const selectedMedicationRecord = { 
      ...this.data.selectedMedicationRecord, 
      actualTime: newTime,
      dateTime: dateTime
    };
    
    this.setData({
      selectedMedicationRecord
    });
  },

  // 保存药物记录的变更（包括时间和剂量）
  async saveMedicationRecordChanges() {
    const selectedRecord = this.data.selectedMedicationRecord;
    
    if (!selectedRecord || !selectedRecord._id) {
      wx.showToast({
        title: '选中的记录无效',
        icon: 'none'
      });
      return;
    }

    // 校验剂量是否为空
    if (!selectedRecord.dosage || selectedRecord.dosage.toString().trim() === '') {
      wx.showToast({
        title: '请输入药物剂量',
        icon: 'none'
      });
      return;
    }

    // 校验剂量是否为有效数字
    const dosageNumber = parseFloat(selectedRecord.dosage);
    if (isNaN(dosageNumber) || dosageNumber <= 0) {
      wx.showToast({
        title: '请输入有效的剂量数值',
        icon: 'none'
      });
      return;
    }
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      // 创建Date对象
      const [hours, minutes] = selectedRecord.actualTime.split(':').map(Number);
      const dateTime = new Date();
      dateTime.setHours(hours, minutes, 0, 0);
      
      // 使用新的数据模型更新记录
      await MedicationRecordModel.updateRecord(selectedRecord._id, {
        actualTime: selectedRecord.actualTime,
        actualDateTime: dateTime,
        dosage: selectedRecord.dosage
      });
      
      // 关闭弹窗
      this.setData({
        showMedicationRecordModal: false,
        selectedMedicationRecord: null
      });
      
      // 刷新数据
      await this.loadTodayData(true);
      
      wx.hideLoading();
      wx.showToast({
        title: '记录已更新',
        icon: 'success'
      });
      
    } catch (error) {
      console.error('更新药物记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },
  


  // 检查登录状态
  checkLogin() {
    const app = getApp();
    // 只需要检查全局实例上是否有openid
  },



  // 加载宝宝信息
  async loadBabyInfo() {
    try {
      const db = wx.cloud.database();
      // 获取当前用户绑定的宝宝UID
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法加载宝宝信息');
        return;
      }
      
      // 使用 babyUid 查询宝宝信息
      const res = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        const babyInfo = res.data[0];
        
        const birthDate = new Date(babyInfo.birthday);
        const today = new Date();
        
        const diffTime = Math.abs(today - birthDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // 处理蛋白质来源类型
        const proteinSourceType = babyInfo.proteinSourceType || 'breastMilk';
        const proteinSourceLabel = proteinSourceType === 'breastMilk' ? '母乳' : '普通奶粉';
        
        this.setData({
          babyName: babyInfo.name,
          babyDays: diffDays,
          babyInfo: babyInfo,
          proteinSourceType: proteinSourceType,
          proteinSourceLabel: proteinSourceLabel
        });
        
        // 如果没有设置体重，使用宝宝信息中的体重
        if (!this.data.weight && babyInfo.weight) {
          this.setData({
            weight: babyInfo.weight
          });
          this.updateCalculations();
        }
        
        // 检查营养设置完整性
        if (this.data.calculation_params) {
          this.checkNutritionSettings();
        }
      } else {
        console.warn('未找到宝宝信息');
      }
    } catch (error) {
      console.error('加载宝宝信息失败:', error);
    }
  },

  // 切换选项卡
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      activeTab: tab
    });
  },

  // 删除喂奶记录
  async deleteFeeding(e) {
    const { index } = e.currentTarget.dataset;
    const feeding = this.data.feedings[index];
    
    // 获取宝宝UID
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    
    // 验证要删除的喂奶记录是否属于当前宝宝
    if (babyUid && feeding.babyUid && feeding.babyUid !== babyUid) {
      wx.showToast({
        title: '无权删除此喂奶记录',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 ${feeding.startTime} 的喂奶记录吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '删除中...' });
            
            // 创建新的记录数组（去掉要删除的项）
            const updatedFeedings = this.data.feedings.filter((_, i) => i !== index);
            
            // 更新数据库
            if (this.data.recordId) {
              const db = wx.cloud.database();
              await db.collection('feeding_records').doc(this.data.recordId).update({
                data: {
                  feedings: updatedFeedings,
                  updatedAt: db.serverDate()
                }
              });
            }
            
            // 更新本地数据
            this.setData({
              feedings: updatedFeedings,
              activeFeedingMenu: -1 // 重置菜单状态
            });
            
            // 重新计算统计数据
            this.updateCalculations();
            
            wx.hideLoading();
            wx.showToast({ title: '删除成功' });
          } catch (error) {
            console.error('删除喂奶记录失败:', error);
            wx.hideLoading();
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 删除药物记录
  async deleteMedication(e) {
    const { medicationId } = e.currentTarget.dataset;
    
    // 根据ID查找要删除的药物记录
    const medication = this.data.medicationRecords.find(record => record._id === medicationId);
    
    if (!medication) {
      wx.showToast({
        title: '未找到要删除的记录',
        icon: 'none'
      });
      return;
    }
    
    // 获取宝宝UID
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    
    // 验证要删除的药物记录是否属于当前宝宝
    if (babyUid && medication.babyUid && medication.babyUid !== babyUid) {
      wx.showToast({
        title: '无权删除此药物记录',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除${medication.actualTime}的${medication.medicationName}记录吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '删除中...' });
            
            // 使用新的数据模型删除记录
            await MedicationRecordModel.deleteRecord(medicationId);
            
            // 刷新数据
            await this.loadTodayData(true);
            
            wx.hideLoading();
            wx.showToast({ title: '删除成功' });
          } catch (error) {
            console.error('删除药物记录失败:', error);
            wx.hideLoading();
            wx.showToast({
              title: '删除失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 检查营养设置参数完整性
  checkNutritionSettings() {
    if (!this.data.calculation_params) {
      this.setData({
        nutritionSettingsComplete: false,
        missingSettings: ['营养参数'],
        showSettingsGuide: true
      });
      return false;
    }

    const params = this.data.calculation_params;
    const missingSettings = [];
    
    // 所有情况下都需要的参数
    if (!params.natural_protein_coefficient) missingSettings.push('天然蛋白系数');
    
    // 根据天然蛋白来源检查不同的必要参数
    if (this.data.proteinSourceType === 'breastMilk') {
      // 母乳必要参数
      if (!params.natural_milk_protein) missingSettings.push('母乳蛋白质浓度');
    } else if (this.data.proteinSourceType === 'formulaMilk') {
      // 普通奶粉必要参数
      if (!params.natural_milk_protein) missingSettings.push('奶粉蛋白质浓度');
      if (!params.formula_milk_ratio || 
          !params.formula_milk_ratio.powder || 
          !params.formula_milk_ratio.water) {
        missingSettings.push('奶粉冲配比例');
      }
    }
    
    // 特奶必要参数
    if (!params.special_milk_protein) missingSettings.push('特奶蛋白质浓度');
    if (!params.special_milk_ratio || 
        !params.special_milk_ratio.powder || 
        !params.special_milk_ratio.water) {
      missingSettings.push('特奶冲配比例');
    }
    
    // 创建自定义的设置引导提示
    let settingsGuideText = '';
    if (missingSettings.length > 0) {
      if (this.data.proteinSourceType === 'breastMilk') {
        settingsGuideText = `请完善营养设置中的${missingSettings.join('、')}，设置完成后可准确计算宝宝每日所需母乳量。`;
      } else if (this.data.proteinSourceType === 'formulaMilk') {
        settingsGuideText = `请完善营养设置中的${missingSettings.join('、')}，设置完成后可准确计算宝宝每日所需奶粉用量。`;
      } else {
        settingsGuideText = `请完善营养设置中的${missingSettings.join('、')}`;
      }
    }
    
    const complete = missingSettings.length === 0;
    
    this.setData({
      nutritionSettingsComplete: complete,
      missingSettings: missingSettings,
      showSettingsGuide: !complete,
      settingsGuideText: settingsGuideText
    });
    
    return complete;
  },
  
  // 导航到营养设置页面
  navigateToNutritionSettings() {
    // 根据蛋白质来源类型传递参数
    wx.navigateTo({
      url: `/pages/nutrition-settings/index?proteinSource=${this.data.proteinSourceLabel}`
    });
  },

  // 显示快捷输入弹窗
  showQuickInputModal() {
    // 初始化快捷填写数据
    this.initQuickFeedingData();
    
    // 显示弹窗
    this.setData({
      showQuickInputModal: true
    });
  },
  
  // 隐藏快捷输入弹窗
  hideQuickInputModal() {
    this.setData({
      showQuickInputModal: false
    });
  },

  // 打开喂奶记录菜单
  toggleFeedingMenu(e) {
    const index = e.currentTarget.dataset.index;
    const currentIndex = this.data.activeFeedingMenu;
    
    if (currentIndex === index) {
      // 如果点击的是当前打开的菜单，则关闭
      this.setData({
        activeFeedingMenu: -1
      });
    } else {
      // 打开点击的菜单，关闭其他菜单
      this.setData({
        activeFeedingMenu: index,
      });
    }
  },
  
  // 点击页面其他位置关闭所有菜单
  onTapPage() {
    if (this.data.activeFeedingMenu !== -1) {
      this.setData({
        activeFeedingMenu: -1,
      });
    }
  },

  // 阻止事件冒泡
  preventBubble() {
    // 空方法，用于阻止事件冒泡
  },

  // 计算奶粉克重
  calculateFormulaPowderWeight(naturalMilkVolume) {
    if (this.data.proteinSourceType !== 'formulaMilk') {
      return 0;
    }
    
    // 获取营养设置中的奶粉冲配比例
    if (!this.data.calculation_params || 
        !this.data.calculation_params.formula_milk_ratio ||
        !this.data.calculation_params.formula_milk_ratio.powder ||
        !this.data.calculation_params.formula_milk_ratio.water) {
      // 提示用户设置营养参数
      wx.showToast({
        title: '请先完善营养设置',
        icon: 'none',
        duration: 2000
      });
      
      // 引导用户前往设置页面
      setTimeout(() => {
        this.navigateToNutritionSettings();
      }, 2000);
      
      return 0; // 返回0克
    }
    
    // 使用营养设置中的配比进行计算
    const ratio = this.data.calculation_params.formula_milk_ratio;
    const powderWeight = (naturalMilkVolume * ratio.powder) / ratio.water;
    return Math.round(powderWeight * 10) / 10; // 保留一位小数
  },



  // 显示补充喂奶记录弹窗
  showAddFeedingModal() {
    // 默认设置当前时间
    const now = new Date();
    const currentTime = this.formatTime(now);
    
    // 默认结束时间比开始时间晚30分钟
    const endTime = new Date(now.getTime() + 30 * 60000);
    const endTimeStr = this.formatTime(endTime);
    
    this.setData({
      showAddFeedingModal: true,
      newFeeding: {
        startTime: currentTime,
        endTime: endTimeStr,
        startDateTime: now,
        endDateTime: endTime,
        naturalMilkVolume: '',
        totalVolume: '',
        specialMilkVolume: 0
      }
    });
  },

  // 新喂奶记录时间选择处理
  onNewFeedingTimeChange(e) {
    const { field } = e.currentTarget.dataset;
    const timeStr = e.detail.value;
    const newFeeding = { ...this.data.newFeeding };
    
    // 创建Date对象
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateTime = new Date(now);
    dateTime.setHours(hours, minutes, 0, 0);
    
    newFeeding[field] = timeStr;
    
    // 同时保存Date对象
    if (field === 'startTime') {
      newFeeding.startDateTime = dateTime;
    } else if (field === 'endTime') {
      newFeeding.endDateTime = dateTime;
      
      // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
      if (newFeeding.endDateTime < newFeeding.startDateTime) {
        newFeeding.endDateTime.setDate(newFeeding.endDateTime.getDate() + 1);
      }
    }
    
    this.setData({ newFeeding });
  },

  // 显示补充用药记录弹窗
  showAddMedicationModal() {
    const now = new Date();
    const currentTime = this.formatTime(now);
    
    this.setData({
      showAddMedicationModal: true
    }, () => {
      this.setData({
        newMedication: {
          name: '',
          volume: '',
          time: currentTime,
          dateTime: now
        }
      });
    });
  },

  // 新用药记录时间选择处理
  onNewMedicationTimeChange(e) {
    const timeStr = e.detail.value;
    const newMedication = { ...this.data.newMedication };
    
    // 创建Date对象
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateTime = new Date(now);
    dateTime.setHours(hours, minutes, 0, 0);
    
    newMedication.time = timeStr;
    newMedication.dateTime = dateTime;
    
    this.setData({ newMedication });
  },

  // 保存新的喂奶记录
  async saveNewFeeding() {
    const { startTime, endTime, startDateTime, endDateTime, naturalMilkVolume, totalVolume } = this.data.newFeeding;
    
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
    if (!startDateTime || !endDateTime || endDateTime <= startDateTime) {
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
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      
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
        startTime: startTime,
        endTime: endTime,
        startDateTime: startDateTime,
        endDateTime: endDateTime,
        naturalMilkVolume: parseFloat(naturalMilkVolume) || 0,
        specialMilkVolume: parseFloat(this.data.newFeeding.specialMilkVolume) || 0,
        totalVolume: parseFloat(totalVolume) || 0,
        babyUid: babyUid,
        createdAt: new Date()
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
          weight: this.data.weight || ''
        };
        
        await db.collection('feeding_records').add({
          data: {
            date: startOfDay,
            basicInfo: basicInfo,
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
      this.loadTodayData(true);
      this.hideAddFeedingModal();

    } catch (error) {
      console.error('保存喂奶记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  // 保存新的用药记录
  async saveNewMedication() {
    const { name, volume, time, dateTime } = this.data.newMedication;
    
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
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      // 获取宝宝UID
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        wx.showToast({
          title: '未找到宝宝信息',
          icon: 'none'
        });
        return;
      }
      
      // 解析剂量和单位
      const volumeMatch = volume.match(/^([\d.]+)(.*)$/);
      const dosage = volumeMatch ? volumeMatch[1] : '';
      const unit = volumeMatch ? volumeMatch[2] : '';
      
      // 使用新的数据结构保存到独立集合
      const medicationData = {
        medicationId: `custom_${name}`, // 自定义药物ID
        medicationName: name,
        dosage: dosage,
        unit: unit,
        frequency: '',
        actualTime: time,
        actualDateTime: dateTime || new Date()
      };
      
      // 保存到独立集合
      await MedicationRecordModel.addRecord(medicationData);
      
      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
      
      // 重新加载数据
      await this.loadTodayData(true);
      this.hideAddMedicationModal();
      
    } catch (error) {
      console.error('保存用药记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  // 检查今日是否已服用某个药物的方法
  hasTakenMedication(medicationId) {
    return this.data.medicationRecords.some(record => record.medicationId === medicationId);
  },

  // 隐藏补充喂奶记录弹窗
  hideAddFeedingModal() {
    this.setData({
      showAddFeedingModal: false,
      newFeeding: {
        startTime: '',
        endTime: '',
        startDateTime: '',
        endDateTime: '',
        naturalMilkVolume: '',
        totalVolume: '',
        specialMilkVolume: 0
      }
    });
  },

  // 隐藏补充用药记录弹窗
  hideAddMedicationModal() {
    this.setData({
      showAddMedicationModal: false,
      newMedication: {
        name: '',
        volume: '',
        time: '',
        dateTime: ''
      }
    });
  },

  // 新喂奶记录输入处理
  onNewFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const newFeeding = { ...this.data.newFeeding };
    
    newFeeding[field] = value;
    
    // 如果改变了天然奶量或总奶量，重新计算特奶量
    if (field === 'naturalMilkVolume' || field === 'totalVolume') {
      const naturalMilk = parseFloat(newFeeding.naturalMilkVolume) || 0;
      const totalVolume = parseFloat(newFeeding.totalVolume) || 0;
      newFeeding.specialMilkVolume = Math.max(0, totalVolume - naturalMilk);
    }
    
    this.setData({ newFeeding });
  },

  // 新用药记录输入处理
  onNewMedicationInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const newMedication = { ...this.data.newMedication };
    
    newMedication[field] = value;
    
    this.setData({ newMedication });
  }

}); 