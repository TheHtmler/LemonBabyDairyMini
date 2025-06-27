// 导入营养设置模型
const NutritionModel = require('../../models/nutrition');
// 导入药物记录模型
const MedicationRecordModel = require('../../models/medicationRecord');
// 导入工具函数
const { 
  waitForAppInitialization, 
  checkUserPermission, 
  getBabyInfo,
  calculator,
  dataManager,
  uiUtils,
  dataUtils,
  utils,
  handleError,
  getBabyUid,
  validation
} = require('../../utils/index');

const app = getApp();

Page({

  data: {
    // === 核心业务数据 ===
    weight: '',
    feedings: [],
    medicationRecords: [],
    bowelRecords: [], // 排便记录
    medicationsList: [],
    calculation_params: null,
    recordId: '',

    // === 当前操作数据 ===
    currentFeeding: {
      startTime: '',
      endTime: '',
      naturalMilkVolume: '',
      specialMilkVolume: '',
      specialMilkPowder: '',
      totalVolume: '',
      formulaPowderWeight: ''
    },
    quickFeedingData: {
      naturalMilkVolume: '',
      totalVolume: '',
      specialMilkVolume: '0',
      specialMilkPowder: '0',
      startTime: '',
      endTime: ''
    },
    newFeeding: {
      startTime: '',
      endTime: '',
      startDateTime: '',
      endDateTime: '',
      naturalMilkVolume: '',
      totalVolume: '',
      specialMilkVolume: 0
    },
    newMedication: {
      name: '',
      volume: '',
      time: '',
      dateTime: ''
    },
    newBowelRecord: {
      time: '',
      type: 'stool', // stool(大便), urine(小便), mixed(混合)
      consistency: '', // 性状：liquid(水样), loose(稀便), soft(糊状), normal(正常), hard(干硬)
      color: '', // 颜色：yellow(黄色), green(绿色), brown(褐色), white(白色), red(红色), black(黑色)
      smell: '', // 气味：normal(正常), sour(酸臭), fishy(腥臭), odorless(无味)
      amount: '', // 分量：small(少量), medium(适量), large(大量)
      notes: '' // 备注
    },

    // === UI状态管理（合并模态框状态）===
    modals: {
      medication: false,
      edit: false,
      medicationRecord: false,
      quickInput: false,
      addFeeding: false,
      addMedication: false,
      bowelRecord: false, // 排便记录弹窗
      bowelDetail: false, // 排便详情弹窗
      bowelEdit: false // 编辑排便记录弹窗
    },
    
    // === 临时状态数据 ===
    selectedMedication: null,
    selectedMedicationInfo: null, // 缓存选中药物的完整信息
    selectedMedicationRecord: null,
    editingFeeding: null,
    editingFeedingIndex: -1,
    activeFeedingMenu: -1,
    currentFeedingRecordId: '', // 当前正在进行的喂奶记录ID
    
    // === 模态框临时数据 ===
    currentModalTime: '',
    currentModalDosage: '',
    
    // === 宝宝信息缓存 ===
    babyName: '宝宝',
    babyDays: 0,
    todayDate: '', // 缓存今日日期
    
    // === 计算数据缓存 ===
    proteinSourceLabel: '母乳', // 蛋白质来源标签
    dailyNaturalProtein: '0', // 每日所需天然蛋白量
    requiredNaturalMilk: '0', // 每日所需天然奶量
    totalNaturalMilkFed: 0, // 已喂天然奶总量
    remainingNaturalMilk: '0', // 剩余天然奶量
    formulaPowderNeeded: '0', // 所需奶粉量
    groupedMedicationRecords: [], // 分组的药物记录
    
    // === 设置相关 ===
    proteinSourceType: 'breastMilk',
    nutritionSettingsComplete: true,
    missingSettings: [],
    showSettingsGuide: false,
    settingsGuideText: '',
    
    // === UI 标签页 ===
    activeTab: 'feeding',
    
    // === 排便记录相关 ===
    selectedBowelRecord: null, // 选中的排便记录
    editingBowelRecord: null, // 正在编辑的排便记录
    bowelStats: {
      totalCount: 0,
      stoolCount: 0,
      urineCount: 0,
      mixedCount: 0
    }
  },

  // === 计算属性和工具方法 ===
  // 获取今日日期
  getTodayDate() {
    return uiUtils.formatters.formatDateDisplay(new Date(), 'YYYY年MM月DD日');
  },

  // 获取蛋白质来源标签
  getProteinSourceLabel() {
    return this.data.proteinSourceType === 'breastMilk' ? '母乳' : '普通奶粉';
  },

  // 获取分组的药物记录
  getGroupedMedicationRecords() {
    return MedicationRecordModel.groupRecordsByMedication(this.data.medicationRecords);
  },

  // 获取选中药物的完整信息
  getSelectedMedicationInfo() {
    if (!this.data.selectedMedication) return null;
    return this.data.medicationsList.find(med => med._id === this.data.selectedMedication);
  },

  // === 宝宝信息计算属性 ===
  async getBabyName() {
    const babyInfo = await getBabyInfo();
    return babyInfo?.name || '';
  },

  async getBabyDays() {
    const babyInfo = await getBabyInfo();
    if (!babyInfo?.birthday) return 0;
    
    const birthDate = new Date(babyInfo.birthday);
    const today = new Date();
    const diffTime = Math.abs(today - birthDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },

  // 初始化宝宝信息缓存
  async initBabyInfoCache() {
    try {
      const [name, days] = await Promise.all([
        this.getBabyName(),
        this.getBabyDays()
      ]);
      
      this.setData({
        babyName: name || '宝宝',
        babyDays: days || 0,
        todayDate: this.getTodayDate(), // 缓存今日日期
        proteinSourceLabel: this.getProteinSourceLabel(), // 初始化蛋白质来源标签
        groupedMedicationRecords: this.getGroupedMedicationRecords() // 初始化分组药物记录
      });
    } catch (error) {
      console.error('初始化宝宝信息缓存失败:', error);
      // 使用默认值
      this.setData({
        babyName: '宝宝',
        babyDays: 0,
        todayDate: this.getTodayDate(), // 即使出错也要设置日期
        proteinSourceLabel: this.getProteinSourceLabel(),
        groupedMedicationRecords: this.getGroupedMedicationRecords()
      });
    }
  },

  // === 营养计算属性 ===
  // 每日所需天然蛋白量
  getDailyNaturalProtein() {
    if (!this.data.weight || !this.data.calculation_params) return '0';
    const weight = parseFloat(this.data.weight);
    return (weight * this.data.calculation_params.natural_protein_coefficient).toFixed(2);
  },

  // 每日所需天然奶量
  getRequiredNaturalMilk() {
    if (!this.data.weight || !this.data.calculation_params) return '0';
    const dailyProtein = parseFloat(this.getDailyNaturalProtein());
    const naturalMilkNeeded = (dailyProtein * 100) / this.data.calculation_params.natural_milk_protein;
    return Math.round(naturalMilkNeeded).toString();
  },

  // 已喂天然奶总量
  getTotalNaturalMilkFed() {
    return this.data.feedings.reduce((sum, feeding) => {
      return sum + (parseFloat(feeding.naturalMilkVolume) || 0);
    }, 0);
  },

  // 剩余天然奶量
  getRemainingNaturalMilk() {
    const required = parseFloat(this.getRequiredNaturalMilk());
    const fed = this.getTotalNaturalMilkFed();
    return Math.max(0, required - fed).toString();
  },

  // 所需奶粉量（普通奶粉情况）
  getFormulaPowderNeeded() {
    if (this.data.proteinSourceType !== 'formulaMilk') return '0';
    if (!this.data.weight || !this.data.calculation_params) return '0';
    
    const dailyProtein = parseFloat(this.getDailyNaturalProtein());
    const formulaPowderNeeded = (dailyProtein * 100) / this.data.calculation_params.natural_milk_protein;
    return formulaPowderNeeded.toFixed(1);
  },

  // === 模态框状态管理工具 ===
  showModal(modalName) {
    this.setData({
      [`modals.${modalName}`]: true
    });
  },

  hideModal(modalName) {
    this.setData({
      [`modals.${modalName}`]: false
    });
  },

  isModalOpen(modalName) {
    return this.data.modals[modalName];
  },

  onLoad() {
    this.initializePage();
  },

  // 初始化页面
  async initializePage() {
    try {
      // 显示加载提示
      wx.showLoading({
        title: '正在初始化...',
        mask: true
      });
      
      // 等待应用初始化完成
      await waitForAppInitialization((progress, text) => {
        wx.showLoading({
          title: text || '正在初始化...',
          mask: true
        });
      });
      
      // 检查用户权限
      const hasPermission = await checkUserPermission();
      if (!hasPermission) {
        wx.hideLoading();
        wx.showModal({
          title: '权限不足',
          content: '您没有权限访问此页面，请重新登录',
          showCancel: false,
          success: () => {
            wx.reLaunch({
              url: '/pages/role-selection/index'
            });
          }
        });
        return;
      }
      
      this.setData({ app });
      
      this.setTodayDate();
      
      // 初始化宝宝信息缓存
      await this.initBabyInfoCache();
      
      // 并行加载其他初始数据
      await Promise.all([
        this.loadCalculationParams(),
        this.loadMedications()
      ]);
      
      await this.initQuickFeedingData();
      await this.initCurrentFeedingData();
      
      // 检查是否有未完成的临时记录
      await this.checkUnfinishedFeeding();
      
      wx.hideLoading();
    } catch (error) {
      handleError(error, { title: '页面初始化失败' });
      
      // 如果是初始化错误，跳转到角色选择页面
      if (error.message && error.message.includes('初始化')) {
        wx.showModal({
          title: '初始化失败',
          content: '应用初始化失败，请重新进入',
          showCancel: false,
          success: () => {
            wx.reLaunch({
              url: '/pages/role-selection/index'
            });
          }
        });
      }
    }
  },

  // 获取最近的喂奶记录数据作为默认值
  async getLatestFeedingData() {
    try {
      // 首先检查今日记录
      if (this.data.feedings?.length > 0) {
        const lastFeeding = this.data.feedings[this.data.feedings.length - 1];
        return {
          naturalMilkVolume: lastFeeding.naturalMilkVolume || '',
          specialMilkVolume: lastFeeding.specialMilkVolume || '0',
          formulaPowderWeight: lastFeeding.formulaPowderWeight || '0'
        };
      }
      
      // 如果今日没有记录，查询最近的历史记录
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取历史记录');
        return this.getCalculatedDefaultValues();
      }
      
      // 查询最近7天的记录
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const result = await db.collection('feeding_records')
        .where({
          babyUid: babyUid,
          date: db.command.gte(sevenDaysAgo)
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
    if (this.data.weight && this.data.calculation_params) {
      const weight = parseFloat(this.data.weight);
      const recommended = calculator.calculateRecommendedVolume(weight, this.data.calculation_params);
      return {
        naturalMilkVolume: recommended.naturalMilk || '',
        specialMilkVolume: '0',
        formulaPowderWeight: '0'
      };
    }
    
    // 兜底默认值
    return {
      naturalMilkVolume: '',
      specialMilkVolume: '0',
      formulaPowderWeight: '0'
    };
  },

  // 初始化当前喂奶记录的默认值
  async initCurrentFeedingData() {
    if (this.data.currentFeeding.startTime) {
      return;
    }
    
    // 获取最近的喂奶数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    this.setData({
      'currentFeeding.naturalMilkVolume': defaultValues.naturalMilkVolume,
      'currentFeeding.specialMilkVolume': defaultValues.specialMilkVolume,
      'currentFeeding.formulaPowderWeight': defaultValues.formulaPowderWeight
    }, () => {
      // 重新计算总奶量
      this.calculateTotalVolume('current');
      
      // 重新计算特奶粉量
      if (this.data.calculation_params) {
        dataManager.updateSpecialMilkForType(this, 'current');
      }
      
      // 如果是普通奶粉且有天然奶量，重新计算奶粉重量
      if (this.data.proteinSourceType === 'formulaMilk' && defaultValues.naturalMilkVolume) {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(parseFloat(defaultValues.naturalMilkVolume));
        this.setData({
          'currentFeeding.formulaPowderWeight': formulaPowderWeight.toFixed(1)
        });
      }
    });
  },

  // 设置今日日期，格式为 "YYYY年MM月DD日"
  setTodayDate() {
    this.setData({
      todayDate: this.getTodayDate()
    });
  },

  // 检查是否有未完成的临时记录
  async checkUnfinishedFeeding() {
    try {
      const db = wx.cloud.database();
      const recordId = this.data.recordId;
      
      if (!recordId) {
        return;
      }
      
      // 获取当前记录
      const record = await db.collection('feeding_records').doc(recordId).get();
      if (!record.data || !record.data.feedings) {
        return;
      }
      
      // 查找临时记录
      const feedings = record.data.feedings;
      const tempFeeding = feedings.find(feeding => feeding.isTemporary);
      
      if (tempFeeding) {
        console.log('发现未完成的临时记录，恢复状态');
        
        // 恢复界面状态 - 注意：结束时间设为空，让UI显示为"记录中"状态
        this.setData({
          'currentFeeding.startTime': tempFeeding.startTime,
          'currentFeeding.endTime': '', // 清空结束时间，显示为记录中状态
          'currentFeeding.naturalMilkVolume': tempFeeding.naturalMilkVolume || '',
          'currentFeeding.specialMilkVolume': tempFeeding.specialMilkVolume || '0',
          'currentFeeding.specialMilkPowder': tempFeeding.specialMilkPowder || '0',
          'currentFeeding.totalVolume': tempFeeding.totalVolume || '0',
          'currentFeeding.formulaPowderWeight': tempFeeding.formulaPowderWeight || '0',
          currentFeedingRecordId: `${recordId}_${tempFeeding.startTime}`
        });
        
        // 显示提示
        wx.showToast({
          title: '恢复未完成的喂奶记录',
          icon: 'none',
          duration: 2000
        });
      }
    } catch (error) {
      console.error('检查未完成记录失败:', error);
    }
  },

  async onShow() {
    try {
      this.setData({ app });
      
      // 并行执行初始化任务
      await Promise.all([
        this.loadTodayData(false),
        this.initBabyInfoCache() // 更新宝宝信息缓存
      ]);
      
      // 初始化当前喂奶数据
      await this.initCurrentFeedingData();
      
      // 检查是否有未完成的临时记录
      await this.checkUnfinishedFeeding();
      
      // 检查营养设置完整性
      if (this.data.calculation_params) {
        this.checkNutritionSettings();
      }
    } catch (error) {
      handleError(error, { title: '加载页面数据失败' });
    }
  },

  onHide() {
    // 页面隐藏时的处理
  },

  onUnload() {
    // 页面卸载时的处理
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
        
        // 只在调试模式下显示错误提示
        this.checkIsDevTools().then(isDebug => {
          if (isDebug) {
            wx.showToast({
              title: '加载参数失败，使用默认值',
              icon: 'none'
            });
          }
        });
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
      
      // 蛋白质来源标签现在通过 getProteinSourceLabel() 方法动态获取
      
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
        calculation_params: params,
        proteinSourceType: proteinSourceType // 确保设置蛋白质来源类型
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
      
    }
  },

  // 更新所有计算
  updateCalculations() {
    // 更新所有缓存的计算值
    if (this.data.weight && this.data.calculation_params) {
      this.setData({
        proteinSourceLabel: this.getProteinSourceLabel(),
        dailyNaturalProtein: this.getDailyNaturalProtein(),
        requiredNaturalMilk: this.getRequiredNaturalMilk(),
        totalNaturalMilkFed: this.getTotalNaturalMilkFed(),
        remainingNaturalMilk: this.getRemainingNaturalMilk(),
        formulaPowderNeeded: this.getFormulaPowderNeeded(),
        groupedMedicationRecords: this.getGroupedMedicationRecords()
      });
      
      // 更新当前喂奶的特奶量
      dataManager.updateSpecialMilkForType(this, 'current');
    }
  },

  // 处理体重输入
  onWeightInput(e) {
    const weight = e.detail.value;
    this.setData({ weight }, () => {
      this.updateCalculations();
      this.saveWeight(weight);
    });
  },

  // 计算总奶量（天然奶量 + 特奶量）
  calculateTotalVolume(type = 'current') {
    const feedingData = type === 'current' ? this.data.currentFeeding : 
                       type === 'quick' ? this.data.quickFeedingData :
                       this.data.editingFeeding;
    
    const naturalMilk = parseFloat(feedingData.naturalMilkVolume) || 0;
    const specialMilk = parseFloat(feedingData.specialMilkVolume) || 0;
    const totalVolume = naturalMilk + specialMilk;
    
    const updateField = type === 'current' ? 'currentFeeding.totalVolume' :
                       type === 'quick' ? 'quickFeedingData.totalVolume' :
                       'editingFeeding.totalVolume';
    
    this.setData({
      [updateField]: totalVolume.toFixed(1)
    });
    
    return totalVolume;
  },

  // 开始喂奶记录
  async startFeeding() {
    try {
      // 1. 首先验证体重数据
      if (!this.data.weight || parseFloat(this.data.weight) <= 0) {
        wx.showModal({
          title: '请先输入体重',
          content: '开始喂奶记录前，请先在上方输入宝宝今日的体重数据',
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      
      // 2. 验证喂奶数据
      utils.validateFeedingData(this.data.currentFeeding);
      
      // 3. 获取当前时间
      const now = new Date();
      const startTime = utils.formatTime(now);
      
      // 4. 结束时间默认为开始时间+20分钟
      const endDateTime = new Date(now.getTime() + 20 * 60 * 1000);
      const endTime = utils.formatTime(endDateTime);
      
      // 5. 立即保存到数据库
      wx.showLoading({ title: '开始记录...' });
      
      const feeding = {
        startTime: startTime,
        endTime: endTime,
        startDateTime: now,
        endDateTime: endDateTime,
        naturalMilkVolume: Math.round(parseFloat(this.data.currentFeeding.naturalMilkVolume || 0)).toString(),
        specialMilkVolume: Math.round(parseFloat(this.data.currentFeeding.specialMilkVolume || 0)).toString(),
        specialMilkPowder: parseFloat(this.data.currentFeeding.specialMilkPowder || 0).toFixed(1),
        totalVolume: Math.round(parseFloat(this.data.currentFeeding.totalVolume || 0)).toString(),
        formulaPowderWeight: this.data.currentFeeding.formulaPowderWeight || '0',
        isTemporary: true // 标记为临时记录
      };
      
      // 6. 保存记录并获取记录ID
      const savedFeeding = await this.saveFeedingRecordAndGetId(feeding);
      
      // 7. 更新UI状态 - 注意：这里只更新时间状态，不清空结束时间，保持UI显示
      this.setData({
        'currentFeeding.startTime': startTime,
        'currentFeeding.endTime': '', // 清空结束时间，让UI显示为"记录中"状态
        currentFeedingRecordId: savedFeeding.tempId // 保存临时记录的ID
      });
      
      wx.hideLoading();
      utils.showSuccess('开始记录喂奶');
      
      // 8. 刷新数据显示（静默模式，避免影响当前状态）
      await this.loadTodayData(true);
      
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '开始记录失败' });
    }
  },
  
  // 撤销当前喂奶记录
  cancelFeeding() {
    wx.showModal({
      title: '确认撤销',
      content: '确定要撤销当前喂奶记录吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '撤销中...' });
            
            // 如果存在已保存的记录，删除它
            if (this.data.currentFeedingRecordId) {
              await this.deleteTempFeedingRecord();
            }
            
            // 保留奶量数据，重置时间状态
            const { naturalMilkVolume, specialMilkVolume, specialMilkPowder, totalVolume, formulaPowderWeight } = this.data.currentFeeding;
            
            this.setData({
              currentFeeding: {
                startTime: '',
                endTime: '',
                naturalMilkVolume,
                specialMilkVolume,
                specialMilkPowder,
                totalVolume,
                formulaPowderWeight
              },
              currentFeedingRecordId: '' // 清空记录ID
            });
            
            // 刷新数据显示
            await this.loadTodayData(true);
            
            wx.hideLoading();
            utils.showSuccess('已撤销');
          } catch (error) {
            wx.hideLoading();
            handleError(error, { title: '撤销失败' });
          }
        }
      }
    });
  },
  
  // 结束喂奶记录
  async endFeeding() {
    try {
      if (!this.data.currentFeeding.startTime) {
        throw new Error('请先开始喂奶');
      }
      
      wx.showLoading({ title: '保存中...' });
      
      const endTime = utils.formatTime();
      const endDateTime = new Date();
      
      // 如果存在临时记录，更新它的结束时间
      if (this.data.currentFeedingRecordId) {
        await this.updateTempFeedingRecord(endTime, endDateTime);
      } else {
        // 如果没有临时记录（意外情况），创建新记录
        const { naturalMilkVolume, specialMilkVolume, specialMilkPowder, totalVolume, formulaPowderWeight } = this.data.currentFeeding;
        
        const feeding = {
          startTime: this.data.currentFeeding.startTime,
          endTime: endTime,
          startDateTime: utils.createTimeObject(this.data.currentFeeding.startTime),
          endDateTime: endDateTime,
          naturalMilkVolume: Math.round(parseFloat(naturalMilkVolume || 0)).toString(),
          specialMilkVolume: Math.round(parseFloat(specialMilkVolume || 0)).toString(),
          specialMilkPowder: parseFloat(specialMilkPowder || 0).toFixed(1),
          totalVolume: Math.round(parseFloat(totalVolume || 0)).toString(),
          formulaPowderWeight: formulaPowderWeight || '0'
        };
        
        await this.saveFeedingRecord(feeding);
      }
      
      // 保存当前奶量数据
      const { naturalMilkVolume, specialMilkVolume, specialMilkPowder, totalVolume, formulaPowderWeight } = this.data.currentFeeding;
      
      // 重置时间状态，保留奶量
      this.setData({
        currentFeeding: {
          startTime: '',
          endTime: '',
          naturalMilkVolume,
          specialMilkVolume,
          specialMilkPowder,
          totalVolume,
          formulaPowderWeight
        },
        currentFeedingRecordId: '' // 清空记录ID
      });
      
      // 更新统计数据
      await this.loadTodayData(true);
      
      wx.hideLoading();
      utils.showSuccess('记录已保存');
      
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '保存喂奶记录失败' });
    }
  },
  
  // 处理喂奶输入
  onFeedingInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    dataManager.updateFeedingData(this, 'current', field, value);
    
    // 当输入天然奶量或特奶量时，重新计算总奶量
    if (field === 'naturalMilkVolume' || field === 'specialMilkVolume') {
      this.calculateTotalVolume('current');
      // 重新计算特奶粉量
      if (this.data.calculation_params) {
        dataManager.updateSpecialMilkForType(this, 'current');
      }
    }
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
        // 如果没有今日记录，自动加载昨天的体重数据作为默认值
        const yesterdayWeight = await this.loadYesterdayWeight();
        if (yesterdayWeight) {
          weightToSet = yesterdayWeight;
          
          // 显示体重自动回填提示（仅在非静默模式下）
          if (!silent) {
            setTimeout(() => {
              wx.showToast({
                title: `已自动填入体重: ${yesterdayWeight}kg`,
                icon: 'none',
                duration: 2000
              });
            }, 500); // 延迟显示，避免与加载提示冲突
          }
        }
      }
      
      // 处理药物记录 - 使用独立集合的数据
      const medicationRecordsToSet = medicationResult.data || [];

      // 加载排便记录
      const bowelRecordsToSet = await this.loadTodayBowelRecords();

      // 设置数据（不再缓存 groupedMedicationRecords，改用方法动态计算）
      this.setData({
        feedings: feedingsToSet,
        medicationRecords: medicationRecordsToSet,
        bowelRecords: bowelRecordsToSet,
        weight: weightToSet,
        recordId: recordId
      });
      
      // 如果有体重数据，触发计算更新
      if (weightToSet) {
        this.updateCalculations();
      }
      
      // 更新分组药物记录缓存
      this.setData({
        groupedMedicationRecords: this.getGroupedMedicationRecords()
      });
      
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
    return dataUtils.array.sortByTime(feedings, 'startDateTime') || 
           dataUtils.array.sortByTime(feedings, 'startTime');
  },

  // 加载昨天的体重数据
  async loadYesterdayWeight() {
    try {
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取昨天体重');
        return null;
      }
      
             // 获取昨天的日期范围
       const today = new Date();
       const yesterday = new Date(today);
       yesterday.setDate(today.getDate() - 1);
       
       // 确保日期有效
       if (isNaN(yesterday.getTime())) {
         console.error('昨天日期计算错误');
         return null;
       }
       
       const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
       const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      
      console.log('查询昨天体重数据:', {
        startOfYesterday: startOfYesterday.toISOString(),
        endOfYesterday: endOfYesterday.toISOString(),
        babyUid
      });
      
      // 查询昨天的记录
      const result = await db.collection('feeding_records')
        .where({
          babyUid: babyUid,
          date: db.command.gte(startOfYesterday).and(db.command.lte(endOfYesterday))
        })
        .orderBy('date', 'desc')
        .limit(1)
        .get();
      
      if (result.data && result.data.length > 0) {
        const yesterdayRecord = result.data[0];
        let weight = null;
        
        // 获取体重数据（兼容新旧数据结构）
        if (yesterdayRecord.basicInfo && yesterdayRecord.basicInfo.weight) {
          weight = yesterdayRecord.basicInfo.weight;
        } else if (yesterdayRecord.weight) {
          weight = yesterdayRecord.weight;
        }
        
        if (weight) {
          console.log('找到昨天的体重数据:', weight);
          return weight;
        }
      }
      
      // 如果没有找到昨天的记录，尝试获取最近的历史记录
      console.log('未找到昨天的记录，查询最近的历史记录');
      return await this.loadLatestHistoryWeight();
      
    } catch (error) {
      console.error('加载昨天体重失败:', error);
      return null;
    }
  },

  // 加载最近的历史体重数据（兜底方案）
  async loadLatestHistoryWeight() {
    try {
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        return null;
      }
      
      // 获取最近7天的记录
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      
      const result = await db.collection('feeding_records')
        .where({
          babyUid: babyUid,
          date: db.command.gte(sevenDaysAgo).and(db.command.lt(today))
        })
        .orderBy('date', 'desc')
        .limit(5)
        .get();
      
      // 遍历查找有体重数据的记录
      for (const record of result.data) {
        let weight = null;
        
        if (record.basicInfo && record.basicInfo.weight) {
          weight = record.basicInfo.weight;
        } else if (record.weight) {
          weight = record.weight;
        }
        
        if (weight) {
          console.log('找到历史体重数据:', weight, '日期:', record.date);
          return weight;
        }
      }
      
      // 最后尝试从宝宝信息获取默认体重
      const babyInfo = await getBabyInfo();
      if (babyInfo && babyInfo.weight) {
        console.log('使用宝宝信息中的体重:', babyInfo.weight);
        return babyInfo.weight;
      }
      
      return null;
      
    } catch (error) {
      console.error('加载历史体重失败:', error);
      return null;
    }
  },

  // Save weight to cloud database
  async saveWeight(weight) {
    try {
      // 检查登录状态
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
      const formattedEndTime = utils.formatTime(endDate);
      
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
  async saveQuickFeeding() {
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
    const specialMilkNum = parseFloat(this.data.quickFeedingData.specialMilkVolume) || 0;
    const totalVolumeNum = parseFloat(this.data.quickFeedingData.totalVolume) || 0;
    
    // 验证数据有效性
    if (isNaN(naturalMilkNum) || isNaN(specialMilkNum) || naturalMilkNum < 0 || specialMilkNum < 0) {
      wx.showToast({
        title: '请输入有效的奶量',
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
    
    // 计算特奶粉克重
    const specialMilkPowder = this.calculateSpecialMilkPowder(specialMilkNum);
    
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
      specialMilkVolume: specialMilkNum.toString(),
      specialMilkPowder: specialMilkPowder.toFixed(1),
      totalVolume: totalVolumeNum.toString()
    };
    
    // 尝试保存记录
    wx.showLoading({
      title: '保存中...'
    });
    
    try {
      await this.saveFeedingRecord(feeding);
      
      // 隐藏弹窗
      this.hideQuickInputModal();
      
      // 重置表单
      await this.initQuickFeedingData();
      
      // 刷新数据以显示最新记录（使用静默模式）
      this.loadTodayData(true);
      
      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
    } catch (error) {
      console.error('保存快速喂奶记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
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
    const formattedTime = utils.formatTime(now);
    
    // 检查药物是否存在
    const medicationInfo = this.data.medicationsList.find(med => med._id === medication);
    
    if (!medicationInfo) {
      wx.showToast({
        title: '未找到药物信息',
        icon: 'none'
      });
      return;
    }
    
    this.setData({
      'modals.medication': true,
      selectedMedication: medication,
      selectedMedicationInfo: medicationInfo, // 缓存药物信息
      currentModalTime: formattedTime,
      currentModalDosage: medicationInfo.dosage // 初始化为默认剂量
    });
  },

  // Close medication modal
  closeMedicationModal() {
    this.hideModal('medication');
    this.setData({
      selectedMedication: null,
      selectedMedicationInfo: null, // 清理缓存
      currentModalTime: '',
      currentModalDosage: ''
    });
  },

  // 处理用药时间变更
  onMedicationTimeChange(e) {
    const timeStr = e.detail.value;
    const dateTime = utils.createTimeObject(timeStr);
    
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
    
    // 从缓存中获取药物信息
    const medInfo = this.data.selectedMedicationInfo;
    
    if (!medInfo) {
      wx.showToast({
        title: '药物信息不存在',
        icon: 'none'
      });
      return;
    }

    // 使用统一验证方法验证剂量
    if (!validation.validateData(
      { dosage: currentModalDosage }, 
      { 
        dosage: { 
          required: true, 
          type: 'number', 
          min: 0, 
          message: '请输入有效的药物剂量' 
        } 
      }
    )) {
      return;
    }
    
    const finalDosage = currentModalDosage;

    // 获取宝宝UID
    const babyUid = getBabyUid();
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
      this.hideModal('medication');
      
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
    // 统计数据现在通过 getTotalNaturalMilkFed() 和 getRemainingNaturalMilk() 方法动态计算
    // 不需要缓存到data中
  },

  // 初始化快捷填写数据
  async initQuickFeedingData() {
    // 获取当前时间
    const now = new Date();
    const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
    
    // 设置时间默认值
    this.setData({
      'quickFeedingData.startTime': utils.formatTime(twentyMinutesAgo),
      'quickFeedingData.endTime': utils.formatTime(now)
    });
    
    // 获取最近的喂奶数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    this.setData({
      'quickFeedingData.naturalMilkVolume': defaultValues.naturalMilkVolume,
      'quickFeedingData.specialMilkVolume': defaultValues.specialMilkVolume,
      'quickFeedingData.formulaPowderWeight': defaultValues.formulaPowderWeight
    });

    // 重新计算总奶量
    this.calculateTotalVolume('quick');

    // 计算特奶量和特奶粉量
    if (this.data.calculation_params) {
      dataManager.updateSpecialMilkForType(this, 'quick');
      
      // 如果是普通奶粉且有天然奶量，重新计算奶粉重量
      if (this.data.proteinSourceType === 'formulaMilk' && defaultValues.naturalMilkVolume) {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(parseFloat(defaultValues.naturalMilkVolume));
        this.setData({
          'quickFeedingData.formulaPowderWeight': formulaPowderWeight.toFixed(1)
        });
      }
    }
  },



  // 计算特奶粉克重
  calculateSpecialMilkPowder(specialMilkVolume) {
    return calculator.calculateSpecialMilkPowder(specialMilkVolume, this.data.calculation_params);
  },

  // 快捷填写输入处理
  onQuickFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    const fieldMap = {
      'quickNaturalMilk': 'naturalMilkVolume',
      'quickSpecialMilk': 'specialMilkVolume'
    };
    
    const mappedField = fieldMap[field];
    if (mappedField) {
      dataManager.updateFeedingData(this, 'quick', mappedField, value);
      
      // 重新计算总奶量
      this.calculateTotalVolume('quick');
      
      // 重新计算特奶粉量
      if (this.data.calculation_params) {
        dataManager.updateSpecialMilkForType(this, 'quick');
      }
    }
  },

  // 保存喂奶记录并返回ID（用于开始喂奶时立即保存）
  async saveFeedingRecordAndGetId(feeding) {
    try {
      // 获取当前日期（只保留年月日）
      const now = new Date();
      const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // 获取宝宝UID，用于数据关联
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能导致数据同步问题');
      }
      
      // 添加babyUid到喂奶记录中
      feeding.babyUid = babyUid;
      feeding.createdAt = new Date();
      
      // 保存到数据库
      const db = wx.cloud.database();
      
      // 检查记录ID是否存在，存在则判断是否是当天的记录
      let shouldCreateNewRecord = true;
      let recordId = this.data.recordId;

      if (recordId) {
        // 获取已有记录数据
        const existingRecord = await db.collection('feeding_records').doc(recordId).get();
        if (existingRecord && existingRecord.data) {
          const recordDate = new Date(existingRecord.data.date);
          
          // 如果记录日期与当前日期相同（同一天），则更新该记录
          if (recordDate.getFullYear() === currentDate.getFullYear() &&
              recordDate.getMonth() === currentDate.getMonth() &&
              recordDate.getDate() === currentDate.getDate()) {
            
            // 是当天的记录，更新它
            shouldCreateNewRecord = false;
            
            await db.collection('feeding_records').doc(recordId).update({
              data: {
                feedings: db.command.push(feeding),
                'basicInfo.weight': this.data.weight || '',
                updatedAt: db.serverDate()
              }
            });
          }
        }
      }
      
      // 如果不是当天的记录或没有记录ID，创建新记录
      if (shouldCreateNewRecord) {
        const basicInfo = {
          weight: this.data.weight || ''
        };
        
        const result = await db.collection('feeding_records').add({
          data: {
            date: currentDate,
            basicInfo: basicInfo,
            feedings: [feeding],
            medicationRecords: [],
            babyUid: babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        
        // 保存新记录的ID
        recordId = result._id;
        this.setData({
          recordId: recordId
        });
      }
      
      // 返回记录信息，包含一个临时ID用于后续更新
      return {
        recordId: recordId,
        tempId: `${recordId}_${feeding.startTime}` // 临时ID用于标识这条记录
      };
      
    } catch (error) {
      console.error('保存喂奶记录失败:', error);
      throw error;
    }
  },

  // 更新临时喂奶记录的结束时间
  async updateTempFeedingRecord(endTime, endDateTime) {
    try {
      const db = wx.cloud.database();
      const recordId = this.data.recordId;
      
      if (!recordId) {
        throw new Error('找不到记录ID');
      }
      
      // 获取当前记录
      const record = await db.collection('feeding_records').doc(recordId).get();
      if (!record.data || !record.data.feedings) {
        throw new Error('找不到喂奶记录');
      }
      
      // 找到要更新的记录（最后一条临时记录）
      const feedings = record.data.feedings;
      let targetIndex = -1;
      
      // 从后往前找到第一条临时记录
      for (let i = feedings.length - 1; i >= 0; i--) {
        if (feedings[i].isTemporary) {
          targetIndex = i;
          break;
        }
      }
      
      if (targetIndex === -1) {
        throw new Error('找不到临时记录');
      }
      
      // 更新记录
      const updatedFeeding = {
        ...feedings[targetIndex],
        endTime: endTime,
        endDateTime: endDateTime,
        isTemporary: false // 移除临时标记
      };
      
      // 更新数组
      feedings[targetIndex] = updatedFeeding;
      
      // 保存到数据库
      await db.collection('feeding_records').doc(recordId).update({
        data: {
          feedings: feedings,
          updatedAt: db.serverDate()
        }
      });
      
      console.log('临时记录更新成功');
      
    } catch (error) {
      console.error('更新临时记录失败:', error);
      throw error;
    }
  },

  // 删除临时喂奶记录
  async deleteTempFeedingRecord() {
    try {
      const db = wx.cloud.database();
      const recordId = this.data.recordId;
      
      if (!recordId) {
        console.log('没有记录ID，无需删除');
        return;
      }
      
      // 获取当前记录
      const record = await db.collection('feeding_records').doc(recordId).get();
      if (!record.data || !record.data.feedings) {
        console.log('找不到喂奶记录');
        return;
      }
      
      // 找到并删除临时记录
      const feedings = record.data.feedings;
      const filteredFeedings = feedings.filter(feeding => !feeding.isTemporary);
      
      // 保存到数据库
      await db.collection('feeding_records').doc(recordId).update({
        data: {
          feedings: filteredFeedings,
          updatedAt: db.serverDate()
        }
      });
      
      console.log('临时记录删除成功');
      
    } catch (error) {
      console.error('删除临时记录失败:', error);
      throw error;
    }
  },

  // 保存喂奶记录
  async saveFeedingRecord(feeding) {
    try {
      wx.showLoading({ title: '保存中...' });

      // 获取当前日期（只保留年月日）
      const now = new Date();
      const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // 获取宝宝UID，用于数据关联
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
            
            const res = await db.collection('feeding_records').doc(this.data.recordId).update({
              data: {
                feedings: db.command.push(feeding),
                'basicInfo.weight': this.data.weight || '', // 更新体重信息
                updatedAt: db.serverDate()
              }
            });
            console.log('res', res);
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



  // 增加/减少奶量
  increaseVolume(e) {
    const { field } = e.currentTarget.dataset;
    let currentValue = 0;
    let updateField = '';
    let feedingType = 'current';
    
    // 确定要更新的字段和当前值
    if (field === 'naturalMilkVolume') {
      currentValue = parseFloat(this.data.currentFeeding.naturalMilkVolume) || 0;
      updateField = 'currentFeeding.naturalMilkVolume';
      feedingType = 'current';
    } else if (field === 'specialMilkVolume') {
      currentValue = parseFloat(this.data.currentFeeding.specialMilkVolume) || 0;
      updateField = 'currentFeeding.specialMilkVolume';
      feedingType = 'current';
    } else if (field === 'quickNaturalMilk') {
      currentValue = parseFloat(this.data.quickFeedingData.naturalMilkVolume) || 0;
      updateField = 'quickFeedingData.naturalMilkVolume';
      feedingType = 'quick';
    } else if (field === 'quickSpecialMilk') {
      currentValue = parseFloat(this.data.quickFeedingData.specialMilkVolume) || 0;
      updateField = 'quickFeedingData.specialMilkVolume';
      feedingType = 'quick';
    }
    
    // 增加5ml
    const newValue = currentValue + 5;
    
    // 更新数据
    this.setData({
      [updateField]: newValue.toString()
    });
    
    // 重新计算总奶量和特奶粉量
    this.calculateTotalVolume(feedingType);
    if (this.data.calculation_params) {
      dataManager.updateSpecialMilkForType(this, feedingType);
    }
    
    // 如果是普奶且更新的是天然奶量，计算奶粉克重
    if (this.data.proteinSourceType === 'formulaMilk' && 
        (field === 'naturalMilkVolume' || field === 'quickNaturalMilk')) {
      const formulaPowderWeight = this.calculateFormulaPowderWeight(newValue);
      const weightField = feedingType === 'current' ? 
        'currentFeeding.formulaPowderWeight' : 
        'quickFeedingData.formulaPowderWeight';
      this.setData({
        [weightField]: formulaPowderWeight
      });
    }
  },
  
  decreaseVolume(e) {
    const { field } = e.currentTarget.dataset;
    let currentValue = 0;
    let updateField = '';
    let feedingType = 'current';
    
    // 确定要更新的字段和当前值
    if (field === 'naturalMilkVolume') {
      currentValue = parseFloat(this.data.currentFeeding.naturalMilkVolume) || 0;
      updateField = 'currentFeeding.naturalMilkVolume';
      feedingType = 'current';
    } else if (field === 'specialMilkVolume') {
      currentValue = parseFloat(this.data.currentFeeding.specialMilkVolume) || 0;
      updateField = 'currentFeeding.specialMilkVolume';
      feedingType = 'current';
    } else if (field === 'quickNaturalMilk') {
      currentValue = parseFloat(this.data.quickFeedingData.naturalMilkVolume) || 0;
      updateField = 'quickFeedingData.naturalMilkVolume';
      feedingType = 'quick';
    } else if (field === 'quickSpecialMilk') {
      currentValue = parseFloat(this.data.quickFeedingData.specialMilkVolume) || 0;
      updateField = 'quickFeedingData.specialMilkVolume';
      feedingType = 'quick';
    }
    
    // 减少5ml，但不小于0
    const newValue = Math.max(0, currentValue - 5);
    
    // 更新数据
    this.setData({
      [updateField]: newValue.toString()
    });
    
    // 重新计算总奶量和特奶粉量
    this.calculateTotalVolume(feedingType);
    if (this.data.calculation_params) {
      dataManager.updateSpecialMilkForType(this, feedingType);
    }
    
    // 如果是普奶且更新的是天然奶量，计算奶粉克重
    if (this.data.proteinSourceType === 'formulaMilk' && 
        (field === 'naturalMilkVolume' || field === 'quickNaturalMilk')) {
      const formulaPowderWeight = this.calculateFormulaPowderWeight(newValue);
      const weightField = feedingType === 'current' ? 
        'currentFeeding.formulaPowderWeight' : 
        'quickFeedingData.formulaPowderWeight';
      this.setData({
        [weightField]: formulaPowderWeight
      });
    }
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
    
    const editingFeeding = { 
      ...feeding,
      startDateTime: startDateTime,
      endDateTime: endDateTime
    };
    
    // 如果是普通奶粉，确保有奶粉重量
    if (this.data.proteinSourceType === 'formulaMilk') {
      if (!editingFeeding.formulaPowderWeight && editingFeeding.naturalMilkVolume) {
        const formulaPowderWeight = this.calculateFormulaPowderWeight(parseFloat(editingFeeding.naturalMilkVolume));
        editingFeeding.formulaPowderWeight = formulaPowderWeight.toFixed(1);
      }
    }
    
    this.setData({
      'modals.edit': true,
      editingFeedingIndex: index,
      editingFeeding: editingFeeding,
      activeFeedingMenu: -1 // 关闭菜单
    });
  },

  // 关闭编辑记录弹窗
  closeEditModal() {
    this.hideModal('edit');
    this.setData({
      editingFeedingIndex: -1,
      editingFeeding: null
    });
  },

  // 处理编辑记录的输入
  onEditFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    if (field === 'startTime' || field === 'endTime') {
      // 时间字段处理
      const editingFeeding = { ...this.data.editingFeeding };
      editingFeeding[field] = value;
      
      const dateTime = utils.createTimeObject(value);
      
      if (field === 'startTime') {
        editingFeeding.startDateTime = dateTime;
      } else if (field === 'endTime') {
        editingFeeding.endDateTime = dateTime;
        
        // 跨天处理
        if (editingFeeding.endDateTime < editingFeeding.startDateTime) {
          editingFeeding.endDateTime.setDate(editingFeeding.endDateTime.getDate() + 1);
        }
      }
      
      this.setData({ editingFeeding });
    } else {
      // 其他字段使用统一的数据管理
      dataManager.updateFeedingData(this, 'edit', field, value);
      
      // 当输入天然奶量或特奶量时，重新计算总奶量
      if (field === 'naturalMilkVolume' || field === 'specialMilkVolume') {
        this.calculateTotalVolume('edit');
        // 重新计算特奶粉量
        if (this.data.calculation_params) {
          dataManager.updateSpecialMilkForType(this, 'edit');
        }
        
        // 如果是普通奶粉且输入的是天然奶量，计算奶粉重量
        if (this.data.proteinSourceType === 'formulaMilk' && field === 'naturalMilkVolume') {
          const formulaPowderWeight = this.calculateFormulaPowderWeight(parseFloat(value) || 0);
          this.setData({
            'editingFeeding.formulaPowderWeight': formulaPowderWeight.toFixed(1)
          });
        }
      }
    }
  },



  // 保存编辑的记录
  async saveEditedFeeding() {
    try {
      wx.showLoading({ title: '保存中...' });
      
      // 确保计算数据是最新的
      this.calculateTotalVolume('edit');
      if (this.data.calculation_params) {
        dataManager.updateSpecialMilkForType(this, 'edit');
      }
      
      // 获取宝宝UID
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
        'modals.edit': false,
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
      'modals.medicationRecord': true,
      selectedMedicationRecord: {
        ...record,
        dateTime: dateTime
      },
    });
  },

  // 关闭药物记录详情弹窗
  closeMedicationRecordModal() {
    this.setData({
      'modals.medicationRecord': false,
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
        'modals.medicationRecord': false,
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
  






  // 加载宝宝信息
  async loadBabyInfo() {
    try {
      // 使用新的工具函数获取宝宝信息
      const babyInfo = await getBabyInfo();
      
      if (babyInfo) {
        const birthDate = new Date(babyInfo.birthday);
        const today = new Date();
        
        const diffTime = Math.abs(today - birthDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // 处理蛋白质来源类型
        const proteinSourceType = babyInfo.proteinSourceType || 'breastMilk';
        
        this.setData({
          proteinSourceType: proteinSourceType
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
      url: `/pages/nutrition-settings/index?proteinSource=${this.getProteinSourceLabel()}`
    });
  },

  // 显示快捷输入弹窗
  async showQuickInputModal() {
    await this.initQuickFeedingData();
    this.showModal('quickInput');
  },
  
  // 隐藏快捷输入弹窗
  hideQuickInputModal() {
    this.hideModal('quickInput');
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
    const result = calculator.calculateFormulaPowderWeight(
      naturalMilkVolume, 
      this.data.calculation_params, 
      this.data.proteinSourceType
    );
    
    // 如果计算失败且需要设置参数，显示提示
    if (result === 0 && this.data.proteinSourceType === 'formulaMilk' && 
        (!this.data.calculation_params?.formula_milk_ratio?.powder || 
         !this.data.calculation_params?.formula_milk_ratio?.water)) {
      wx.showToast({
        title: '请先完善营养设置',
        icon: 'none',
        duration: 2000
      });
      
      setTimeout(() => {
        this.navigateToNutritionSettings();
      }, 2000);
    }
    
    return result;
  },



  // 显示补充喂奶记录弹窗
  async showAddFeedingModal() {
    // 默认设置当前时间
    const now = new Date();
    const currentTime = utils.formatTime(now);
    
    // 默认结束时间比开始时间晚30分钟
    const endTime = new Date(now.getTime() + 30 * 60000);
    const endTimeStr = utils.formatTime(endTime);
    
    // 获取最近的喂奶数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    this.setData({
      'modals.addFeeding': true,
      newFeeding: {
        startTime: currentTime,
        endTime: endTimeStr,
        startDateTime: now,
        endDateTime: endTime,
        naturalMilkVolume: defaultValues.naturalMilkVolume,
        specialMilkVolume: defaultValues.specialMilkVolume,
        formulaPowderWeight: defaultValues.formulaPowderWeight
      }
    });
    
    // 计算总奶量
    const naturalMilk = parseFloat(defaultValues.naturalMilkVolume) || 0;
    const specialMilk = parseFloat(defaultValues.specialMilkVolume) || 0;
    const totalVolume = naturalMilk + specialMilk;
    
    this.setData({
      'newFeeding.totalVolume': totalVolume.toString()
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
    const currentTime = utils.formatTime(now);
    
    this.setData({
      'modals.addMedication': true,
      newMedication: {
        name: '',
        volume: '',
        time: currentTime,
        dateTime: now
      }
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
      'modals.addFeeding': false,
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
      'modals.addMedication': false,
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
  },

  // === 排便记录相关方法 ===

  // 加载今日排便记录
  async loadTodayBowelRecords() {
    try {
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID，无法加载排便记录');
        return [];
      }
      
      // 获取今天的开始和结束时间
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
      
      const result = await db.collection('bowel_records')
        .where({
          babyUid: babyUid,
          recordTime: db.command.gte(startOfDay).and(db.command.lte(endOfDay))
        })
        .orderBy('recordTime', 'desc')
        .get();
      
      const records = result.data || [];
      
      // 处理记录，添加显示用的文本
      const processedRecords = records.map(record => ({
        ...record,
        typeText: this.getBowelTypeText(record.type),
        consistencyText: record.consistency ? this.getConsistencyText(record.consistency) : '',
        colorText: record.color ? this.getColorText(record.color) : '',
        smellText: record.smell ? this.getSmellText(record.smell) : '',
        amountText: record.amount ? this.getAmountText(record.amount) : ''
      }));
      
      // 按类型分组并在每组内按时间倒序排列
      const groupedRecords = this.groupBowelRecordsByType(processedRecords);
      
      // 计算统计数据
      this.calculateBowelStats(processedRecords);
      
      return groupedRecords;
      
    } catch (error) {
      console.error('加载排便记录失败:', error);
      return [];
    }
  },

  // 按类型分组排便记录
  groupBowelRecordsByType(records) {
    const groups = [];
    const typeOrder = ['stool', 'urine', 'mixed']; // 定义类型显示顺序
    const typeLabels = {
      'stool': '大便',
      'urine': '小便', 
      'mixed': '混合'
    };
    
    typeOrder.forEach(type => {
      const typeRecords = records.filter(record => record.type === type);
      if (typeRecords.length > 0) {
        // 每个类型内部按时间倒序排列（数据库查询已经是倒序了）
        groups.push({
          type: type,
          typeText: typeLabels[type],
          records: typeRecords,
          count: typeRecords.length
        });
      }
    });
    
    return groups;
  },

  // 计算排便统计数据
  calculateBowelStats(records) {
    // 注意：这里传入的是原始记录数组，不是分组后的数据
    const stats = {
      totalCount: records.length,
      stoolCount: records.filter(r => r.type === 'stool').length,
      urineCount: records.filter(r => r.type === 'urine').length,
      mixedCount: records.filter(r => r.type === 'mixed').length
    };
    
    this.setData({ bowelStats: stats });
  },

  // 显示快速排便记录弹窗
  showBowelRecordModal(e) {
    const { type } = e.currentTarget.dataset;
    const now = new Date();
    const currentTime = utils.formatTime(now);
    
    this.setData({
      'modals.bowelRecord': true,
      newBowelRecord: {
        time: currentTime,
        type: type || 'stool',
        consistency: '',
        color: '',
        smell: '',
        amount: '',
        notes: ''
      }
    });
  },

  // 隐藏排便记录弹窗
  hideBowelRecordModal() {
    this.setData({
      'modals.bowelRecord': false,
      newBowelRecord: {
        time: '',
        type: 'stool',
        consistency: '',
        color: '',
        smell: '',
        amount: '',
        notes: ''
      }
    });
  },

  // 排便记录时间选择
  onBowelTimeChange(e) {
    const timeStr = e.detail.value;
    this.setData({
      'newBowelRecord.time': timeStr
    });
  },

  // 排便记录输入处理
  onBowelRecordInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    this.setData({
      [`newBowelRecord.${field}`]: value
    });
  },

  // 排便记录选择处理
  onBowelRecordSelect(e) {
    const { field, value } = e.currentTarget.dataset;
    
    this.setData({
      [`newBowelRecord.${field}`]: value
    });
  },

  // 保存排便记录
  async saveBowelRecord() {
    const { time, type, consistency, color, smell, amount, notes } = this.data.newBowelRecord;
    
    // 验证必填字段
    if (!time) {
      wx.showToast({
        title: '请选择时间',
        icon: 'none'
      });
      return;
    }
    
    if (!type) {
      wx.showToast({
        title: '请选择类型',
        icon: 'none'
      });
      return;
    }
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        wx.showToast({
          title: '未找到宝宝信息',
          icon: 'none'
        });
        return;
      }
      
      // 创建时间对象
      const now = new Date();
      const [hours, minutes] = time.split(':').map(Number);
      const recordTime = new Date(now);
      recordTime.setHours(hours, minutes, 0, 0);
      
      // 准备保存的数据
      const recordData = {
        babyUid: babyUid,
        type: type,
        recordTime: recordTime,
        timeString: time,
        createdAt: new Date()
      };
      
      // 如果是大便，添加详细信息
      if (type === 'stool' || type === 'mixed') {
        recordData.consistency = consistency;
        recordData.color = color;
        recordData.smell = smell;
        recordData.amount = amount;
      }
      
      // 添加备注
      if (notes) {
        recordData.notes = notes;
      }
      
      // 保存到数据库
      await db.collection('bowel_records').add({
        data: recordData
      });
      
      // 隐藏弹窗
      this.hideBowelRecordModal();
      
      // 重新加载数据
      await this.loadTodayData(true);
      
      wx.hideLoading();
      wx.showToast({
        title: '记录成功',
        icon: 'success'
      });
      
    } catch (error) {
      console.error('保存排便记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  // 显示排便记录详情
  showBowelDetailModal(e) {
    const { groupIndex, recordIndex } = e.currentTarget.dataset;
    
    // 从分组数据中获取记录
    if (groupIndex !== undefined && recordIndex !== undefined) {
      const group = this.data.bowelRecords[groupIndex];
      if (!group || !group.records) return;
      
      const record = group.records[recordIndex];
      if (!record) return;
      
      // 处理文本转换，添加显示用的文本字段
      const processedRecord = {
        ...record,
        typeText: this.getBowelTypeText(record.type),
        consistencyText: record.consistency ? this.getConsistencyText(record.consistency) : '',
        colorText: record.color ? this.getColorText(record.color) : '',
        smellText: record.smell ? this.getSmellText(record.smell) : '',
        amountText: record.amount ? this.getAmountText(record.amount) : ''
      };
      
      this.setData({
        'modals.bowelDetail': true,
        selectedBowelRecord: processedRecord
      });
    }
  },

  // 隐藏排便记录详情
  hideBowelDetailModal() {
    this.setData({
      'modals.bowelDetail': false,
      selectedBowelRecord: null
    });
  },

  // 删除排便记录
  async deleteBowelRecord(e) {
    const { recordId } = e.currentTarget.dataset;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条排便记录吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '删除中...' });
            
            const db = wx.cloud.database();
            await db.collection('bowel_records').doc(recordId).remove();
            
            // 重新加载数据
            await this.loadTodayData(true);
            
            wx.hideLoading();
            wx.showToast({
              title: '删除成功',
              icon: 'success'
            });
            
          } catch (error) {
            console.error('删除排便记录失败:', error);
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

  // 获取类型显示文本
  getBowelTypeText(type) {
    const typeMap = {
      'stool': '大便',
      'urine': '小便',
      'mixed': '混合'
    };
    return typeMap[type] || type;
  },

  // 获取性状显示文本
  getConsistencyText(consistency) {
    const consistencyMap = {
      'liquid': '水样',
      'loose': '稀便',
      'soft': '糊状',
      'normal': '正常',
      'hard': '干硬'
    };
    return consistencyMap[consistency] || consistency;
  },

  // 获取颜色显示文本
  getColorText(color) {
    const colorMap = {
      'yellow': '黄色',
      'green': '绿色',
      'brown': '褐色',
      'white': '白色',
      'red': '红色',
      'black': '黑色'
    };
    return colorMap[color] || color;
  },

  // 获取气味显示文本
  getSmellText(smell) {
    const smellMap = {
      'normal': '正常',
      'sour': '酸臭',
      'fishy': '腥臭',
      'odorless': '无味'
    };
    return smellMap[smell] || smell;
  },

  // 获取分量显示文本
  getAmountText(amount) {
    const amountMap = {
      'small': '少量',
      'medium': '适量',
      'large': '大量'
    };
    return amountMap[amount] || amount;
  },

  // === 编辑排便记录相关方法 ===

  // 编辑排便记录
  editBowelRecord(e) {
    const { groupIndex, recordIndex } = e.currentTarget.dataset;
    
    // 从分组数据中获取记录
    if (groupIndex !== undefined && recordIndex !== undefined) {
      const group = this.data.bowelRecords[groupIndex];
      if (!group || !group.records) return;
      
      const record = group.records[recordIndex];
      if (!record) return;
      
      // 创建编辑用的记录副本
      const editingRecord = {
        ...record,
        // 确保有所有必要的字段
        timeString: record.timeString || record.time,
        type: record.type || 'stool',
        consistency: record.consistency || '',
        color: record.color || '',
        smell: record.smell || '',
        amount: record.amount || '',
        notes: record.notes || ''
      };
      
      this.setData({
        'modals.bowelEdit': true,
        editingBowelRecord: editingRecord
      });
    }
  },

  // 隐藏编辑排便记录弹窗
  hideBowelEditModal() {
    this.setData({
      'modals.bowelEdit': false,
      editingBowelRecord: null
    });
  },

  // 编辑排便记录时间选择
  onEditBowelTimeChange(e) {
    const timeStr = e.detail.value;
    this.setData({
      'editingBowelRecord.timeString': timeStr
    });
  },

  // 编辑排便记录选择处理
  onEditBowelRecordSelect(e) {
    const { field, value } = e.currentTarget.dataset;
    
    this.setData({
      [`editingBowelRecord.${field}`]: value
    });
  },

  // 编辑排便记录输入处理
  onEditBowelRecordInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    this.setData({
      [`editingBowelRecord.${field}`]: value
    });
  },

  // 保存编辑的排便记录
  async saveEditedBowelRecord() {
    const { _id, timeString, type, consistency, color, smell, amount, notes } = this.data.editingBowelRecord;
    
    // 验证必填字段
    if (!timeString) {
      wx.showToast({
        title: '请选择时间',
        icon: 'none'
      });
      return;
    }
    
    if (!type) {
      wx.showToast({
        title: '请选择类型',
        icon: 'none'
      });
      return;
    }
    
    try {
      wx.showLoading({ title: '保存中...' });
      
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        wx.showToast({
          title: '未找到宝宝信息',
          icon: 'none'
        });
        return;
      }
      
      // 创建时间对象
      const now = new Date();
      const [hours, minutes] = timeString.split(':').map(Number);
      const recordTime = new Date(now);
      recordTime.setHours(hours, minutes, 0, 0);
      
      // 准备更新的数据
      const updateData = {
        type: type,
        recordTime: recordTime,
        timeString: timeString,
        updatedAt: new Date()
      };
      
      // 如果是大便，添加详细信息
      if (type === 'stool' || type === 'mixed') {
        updateData.consistency = consistency;
        updateData.color = color;
        updateData.smell = smell;
        updateData.amount = amount;
      } else {
        // 如果改为小便，清除大便相关信息
        updateData.consistency = db.command.remove();
        updateData.color = db.command.remove();
        updateData.smell = db.command.remove();
        updateData.amount = db.command.remove();
      }
      
      // 添加备注
      if (notes) {
        updateData.notes = notes;
      } else {
        updateData.notes = db.command.remove();
      }
      
      // 更新数据库
      await db.collection('bowel_records').doc(_id).update({
        data: updateData
      });
      
      // 隐藏弹窗
      this.hideBowelEditModal();
      
      // 重新加载数据
      await this.loadTodayData(true);
      
      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
      
    } catch (error) {
      console.error('保存编辑的排便记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  }

}); 