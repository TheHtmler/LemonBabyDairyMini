// 导入配奶设置模型
const NutritionModel = require('../../models/nutrition');
// 导入药物记录模型
const MedicationRecordModel = require('../../models/medicationRecord');
// 导入食物模型
const FoodModel = require('../../models/food');
// 系统默认食物
const MILK_CATEGORY_ALIASES = ['milk', '奶类', '奶制品', '乳制品', '乳类及制品'];

const NATURAL_MILK_CALORIES_PER_ML = 0.67;
const SPECIAL_MILK_CALORIES_PER_ML = 0.695;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_RATIO = {
  powder: 7,
  water: 100
};
const MAX_RECENT_FOODS = 10;
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
const InvitationModel = require('../../models/invitation');

const app = getApp();

Page({

  data: {
    // === 核心业务数据 ===
    weight: '',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    quickGoalTarget: 'protein',
    feedings: [],
    feedingsDisplay: [],
    intakes: [],
    foodIntakes: [],
    medicationRecords: [],
    bowelRecords: [], // 排便记录
    medicationsList: [],
    calculation_params: null,
    recordId: '',
    macroSummary: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0,
      naturalCoefficient: '',
      specialCoefficient: '',
      caloriesPerKg: ''
    },
    macroRatios: {
      protein: 0,
      carbs: 0,
      fat: 0
    },
    fatRatioRangeText: '',
    showFatRatioPopup: false,
    fatRatioPopupLines: [
      '0-6月: 45%-50%',
      '>6月: 35%-40%',
      '1-2岁: 30%-35%',
      '>6岁: 25%-30%'
    ],
    intakeOverview: {
      milk: {
        totalCalories: 0,
        normal: {
          volume: 0,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        },
        special: {
          volume: 0,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        }
      },
      food: {
        count: 0,
        totalCalories: 0,
        protein: 0,
        naturalProtein: 0,
        specialProtein: 0,
        carbs: 0,
        fat: 0
      }
    },

    // === 当前操作数据 ===
    currentFeeding: {
      startTime: '',
      endTime: '',
      naturalMilkVolume: '',
      naturalMilkType: 'breast',
      specialMilkVolume: '',
      specialMilkPowder: '',
      totalVolume: '',
      formulaPowderWeight: 0
    },
    quickFeedingData: {
      startTime: '',
      naturalMilkVolume: '',
      naturalMilkType: 'breast',
      totalVolume: '',
      specialMilkVolume: '0',
      specialMilkPowder: '0',
      normalProtein: 0,
      normalCalories: 0,
      specialProtein: 0,
      specialCalories: 0,
      specialPowderWeight: 0,
      formulaPowderWeight: 0
    },
    quickGoalSuggestion: {
      ready: false,
      error: '',
      mode: 'protein',
      naturalProteinGap: 0,
      specialProteinGap: 0,
      calorieGap: 0,
      naturalVolume: 0,
      specialVolume: 0,
      predictedCalorieCoefficient: '',
      predictedNaturalCoefficient: '',
      predictedSpecialCoefficient: '',
      naturalPriorityPlan: {
        naturalVolume: 0,
        specialVolume: 0,
        predictedCalorieCoefficient: '',
        predictedNaturalCoefficient: '',
        predictedSpecialCoefficient: ''
      },
      specialPriorityPlan: {
        naturalVolume: 0,
        specialVolume: 0,
        predictedCalorieCoefficient: '',
        predictedNaturalCoefficient: '',
        predictedSpecialCoefficient: ''
      }
    },
    newFeeding: {
      startTime: '',
      endTime: '',
      startDateTime: '',
      endDateTime: '',
      naturalMilkVolume: '',
      naturalMilkType: 'breast',
      totalVolume: '',
      specialMilkVolume: 0,
      specialPowderWeight: 0,
      formulaPowderWeight: 0
    },
    newFoodIntake: {
      category: '',
      foodId: '',
      food: null,
      quantity: '',
      unit: '',
      nutritionPreview: null,
      proteinSource: 'natural',
      recordTime: ''
    },
    foodExperiment: {
      foodId: '',
      food: null,
      quantity: '',
      unit: '',
      nutritionPreview: null,
      recordTime: ''
    },
    foodExperimentSearchQuery: '',
    foodExperimentCategories: [],
    foodExperimentCategory: 'recent',
    foodExperimentStep: 'select',
    recentFoodOptions: [],
    filteredFoodExperimentOptions: [],
    foodModalMode: 'create',
    editingFoodIntakeId: '',
    editingFoodIntakeIndex: -1,
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
      bowelEdit: false, // 编辑排便记录弹窗
      foodIntake: false, // 食物摄入弹窗
      foodIntakeExperiment: false // 食物摄入实验弹窗
    },
    
    // === 临时状态数据 ===
    selectedMedication: null,
    selectedMedicationInfo: null, // 缓存选中药物的完整信息
    selectedMedicationIndex: 0,
    selectedMedicationRecord: null,
    editingFeeding: null,
    editingFeedingIndex: -1,
    editingFeedingStats: {
      normalProtein: 0,
      normalCalories: 0,
      specialProtein: 0,
      specialCalories: 0
    },
    editingFeedingDisplay: null,
    activeFeedingMenu: -1,
    activeFoodMenu: -1,
    currentFeedingRecordId: '', // 当前正在进行的喂养记录ID
    autoOpenFoodModal: false,
    
    // === 模态框临时数据 ===
    currentModalTime: '',
    currentModalDosage: '',
    
    // === 宝宝信息缓存 ===
    babyName: '宝宝',
    babyDays: 0,
    todayDate: '', // 缓存今日日期
    
    // === 计算数据缓存 ===
    groupedMedicationRecords: [], // 分组的药物记录
    needsNutritionSetup: false,
    promptingNutrition: false,
    hasShownNutritionPrompt: false,
    
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
    },

    // === 食物记录与库 ===
    foodCatalog: [],
    foodCategories: [],
    categorizedFoods: {},
    filteredFoodOptions: [],
    foodSearchQuery: ''
  },

  // === 计算属性和工具方法 ===
  // 获取今日日期
  getTodayDate() {
    return uiUtils.formatters.formatDateDisplay(new Date(), 'YYYY年MM月DD日');
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

  getFoodById(foodId) {
    if (!foodId) return null;
    return this.data.foodCatalog.find(food => food._id === foodId) || null;
  },

  getDefaultMilkCategory() {
    const categories = this.data.foodCategories || [];
    return categories.find(cat => this.isMilkCategory(cat) || /乳|奶/.test(cat)) || '';
  },

  isMilkCategory(category) {
    if (!category) return false;
    const normalized = category.toLowerCase();
    return MILK_CATEGORY_ALIASES.includes(normalized);
  },

  normalizeFoodCategoryValue(category) {
    const text = (category || '').toString().trim();
    if (!text) return '婴幼儿辅食';
    const lower = text.toLowerCase();
    if (lower === 'milk' || text === '奶类') return '乳类及制品';
    if (lower === 'food') return '主食及谷薯';
    if (text === '辅食') return '婴幼儿辅食';
    return text;
  },

  // === 宝宝信息计算属性 ===
  async getBabyName() {
    const babyInfo = await getBabyInfo();
    return babyInfo?.name || '';
  },

  async getBabyDays() {
    const babyInfo = await getBabyInfo();
    if (!babyInfo?.birthday) return 0;

    return this.calculateBabyDays(babyInfo.birthday);
  },

  calculateBabyDays(birthday) {
    const birthDate = new Date(birthday);
    const today = new Date();
    const diffTime = Math.abs(today - birthDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },

  calculateAgeInMonths(birthday, referenceDate = new Date()) {
    if (!birthday) return null;
    const birthDate = new Date(birthday);
    const refDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (isNaN(birthDate.getTime()) || isNaN(refDate.getTime())) return null;
    let months = (refDate.getFullYear() - birthDate.getFullYear()) * 12 + (refDate.getMonth() - birthDate.getMonth());
    if (refDate.getDate() < birthDate.getDate()) {
      months -= 1;
    }
    return months < 0 ? 0 : months;
  },

  getFatRatioRangeText(birthday, referenceDate = new Date()) {
    const ageMonths = this.calculateAgeInMonths(birthday, referenceDate);
    if (ageMonths === null) return '';
    if (ageMonths <= 6) return '45%-50%';
    if (ageMonths >= 72) return '25%-30%';
    if (ageMonths >= 12 && ageMonths < 24) return '30%-35%';
    return '35%-40%';
  },

  showFatRatioPopup() {
    this.setData({ showFatRatioPopup: true });
  },

  hideFatRatioPopup() {
    this.setData({ showFatRatioPopup: false });
  },

  // 初始化宝宝信息缓存
  async initBabyInfoCache() {
    try {
      const babyInfo = await getBabyInfo();
      const name = babyInfo?.name || '宝宝';
      const days = babyInfo?.birthday ? this.calculateBabyDays(babyInfo.birthday) : 0;
      const fatRatioRangeText = babyInfo?.birthday ? this.getFatRatioRangeText(babyInfo.birthday) : '';

      this.setData({
        babyName: name,
        babyDays: days,
        fatRatioRangeText,
        todayDate: this.getTodayDate(), // 缓存今日日期
        groupedMedicationRecords: this.getGroupedMedicationRecords() // 初始化分组药物记录
      });
    } catch (error) {
      console.error('初始化宝宝信息缓存失败:', error);
      // 使用默认值
      this.setData({
        babyName: '宝宝',
        babyDays: 0,
        fatRatioRangeText: '',
        todayDate: this.getTodayDate(), // 即使出错也要设置日期
        groupedMedicationRecords: this.getGroupedMedicationRecords()
      });
    }
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

  onLoad(options = {}) {
    this.setData({
      autoOpenFoodModal: options.openFoodModal === '1'
    });
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
        this.loadMedications(),
        this.loadFoodCatalog()
      ]);
      
      await this.initQuickFeedingData();
      await this.initCurrentFeedingData();
      
      // 检查是否有未完成的临时记录
      await this.checkUnfinishedFeeding();

      // 外部跳转请求自动打开食物弹窗
      if (this.data.autoOpenFoodModal) {
        this.showFoodIntakeModal();
        this.setData({ autoOpenFoodModal: false });
      }
      
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

  // 获取最近的喂养记录数据作为默认值
  async getLatestFeedingData() {
    try {
      // 首先检查今日记录
      if (this.data.feedings?.length > 0) {
        const lastFeeding = this.data.feedings[this.data.feedings.length - 1];
        return {
          naturalMilkVolume: lastFeeding.naturalMilkVolume || '',
          specialMilkVolume: lastFeeding.specialMilkVolume || '0',
          naturalMilkType: lastFeeding.naturalMilkType || 'breast'
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
      
      // 查找最新的喂养记录
      for (const record of result.data) {
        if (record.feedings && record.feedings.length > 0) {
          // 获取该天最后一次喂养记录
          const sortedFeedings = record.feedings.sort((a, b) => {
            const timeA = a.startDateTime ? new Date(a.startDateTime) : new Date(`2000-01-01 ${a.startTime || '00:00'}`);
            const timeB = b.startDateTime ? new Date(b.startDateTime) : new Date(`2000-01-01 ${b.startTime || '00:00'}`);
            return timeB - timeA;
          });
          
          const latestFeeding = sortedFeedings[0];
          return {
            naturalMilkVolume: latestFeeding.naturalMilkVolume || '',
            specialMilkVolume: latestFeeding.specialMilkVolume || '0',
            naturalMilkType: latestFeeding.naturalMilkType || 'breast'
          };
        }
      }
      
      // 如果没有找到历史记录，返回计算的默认值
      return this.getCalculatedDefaultValues();
      
    } catch (error) {
      console.error('获取最近喂养记录失败:', error);
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
        naturalMilkType: 'breast'
      };
    }
    
    // 兜底默认值
    return {
      naturalMilkVolume: '',
      specialMilkVolume: '0',
      naturalMilkType: 'breast'
    };
  },

  // 初始化当前喂养记录的默认值
  async initCurrentFeedingData() {
    if (!this.data.calculation_params || this.data.currentFeeding.startTime) {
      return;
    }
    
    // 获取最近的喂养数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    this.setData({
      'currentFeeding.naturalMilkVolume': defaultValues.naturalMilkVolume,
      'currentFeeding.naturalMilkType': defaultValues.naturalMilkType || 'breast',
      'currentFeeding.specialMilkVolume': defaultValues.specialMilkVolume
    }, () => {
      // 重新计算总奶量
      this.calculateTotalVolume('current');
      
      // 重新计算特奶粉量
      if (this.data.calculation_params) {
        dataManager.updateSpecialMilkForType(this, 'current');
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
          'currentFeeding.naturalMilkType': tempFeeding.naturalMilkType || 'breast',
          'currentFeeding.specialMilkVolume': tempFeeding.specialMilkVolume || '0',
          'currentFeeding.specialMilkPowder': tempFeeding.specialMilkPowder || '0',
          'currentFeeding.totalVolume': tempFeeding.totalVolume || '0',
          currentFeedingRecordId: `${recordId}_${tempFeeding.startTime}`
        });
        
        // 显示提示
        wx.showToast({
          title: '恢复未完成的喂养记录',
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
        this.loadCalculationParams({ silent: true }),
        this.loadTodayData(false),
        this.initBabyInfoCache(), // 更新宝宝信息缓存
        this.loadFoodCatalog()
      ]);
      
      // 初始化当前喂养数据
      await this.initCurrentFeedingData();
      
      // 检查是否有未完成的临时记录
      await this.checkUnfinishedFeeding();
      
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
  async loadCalculationParams(options = {}) {
    const silent = options.silent;
    try {
      if (!silent) {
        wx.showLoading({
          title: '加载参数中...'
        });
      }

      // 获取宝宝UID
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，使用默认配奶设置');
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ calculation_params: defaultSettings }, () => {
          this.updateCalculations();
        });
        wx.hideLoading();
        
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
      
      // 已登录状态，获取配奶设置，必须传入 babyUid 参数
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      
      // 确保所有必需的参数都存在
      const defaultParams = {
        natural_milk_protein: 1.1,
        natural_milk_calories: 67,
        natural_milk_fat: 4.0,
        natural_milk_carbs: 6.8,
        natural_milk_fiber: 0,
        formula_milk_protein: '',
        formula_milk_calories: '',
        formula_milk_fat: '',
        formula_milk_carbs: '',
        formula_milk_fiber: '',
        formula_milk_ratio: {
          powder: '',
          water: ''
        },
        special_milk_protein: '',
        special_milk_calories: '',
        special_milk_ratio: {
          powder: '',
          water: ''
        },
        special_milk_protein_ml: 1.97
      };
      
      const params = {
        ...defaultParams,
        ...(settings || {}),
        special_milk_ratio: {
          ...defaultParams.special_milk_ratio,
          ...(settings?.special_milk_ratio || {})
        },
        formula_milk_ratio: {
          ...defaultParams.formula_milk_ratio,
          ...(settings?.formula_milk_ratio || {})
        }
      };
      
      const isComplete = this.isNutritionSettingsComplete(params);
      this.setData({
        calculation_params: params,
        needsNutritionSetup: !isComplete,
        hasShownNutritionPrompt: isComplete ? false : this.data.hasShownNutritionPrompt
      }, () => {
        this.updateCalculations();
        if (!isComplete) {
          this.promptNutritionSetup();
        }
      });
      
      if (!silent) {
        wx.hideLoading();
      }
    } catch (error) {
      console.error('加载计算参数失败:', error);
      
      this.setData({
        calculation_params: null,
        needsNutritionSetup: true
      }, () => {
        this.updateCalculations();
        this.promptNutritionSetup();
      });
      
      if (!silent) {
        wx.hideLoading();
      }
    }
  },

  // 更新所有计算
  updateCalculations() {
    this.setData({
      groupedMedicationRecords: this.getGroupedMedicationRecords(),
      feedingsDisplay: this.buildFeedingsDisplay(this.data.feedings || [])
    });

    if (this.data.calculation_params) {
      dataManager.updateSpecialMilkForType(this, 'current');
    }

    this.calculateNaturalMilkStats();
  },

  // 处理体重输入
  onWeightInput(e) {
    const weight = e.detail.value;
    this.setData({ weight }, () => {
      this.updateCalculations();
      this.saveWeight(weight);
      this.updateQuickGoalSuggestion();
    });
  },

  onNaturalCoefficientInput(e) {
    const value = e.detail.value;
    this.setData({ naturalProteinCoefficientInput: value }, () => {
      this.updateQuickGoalSuggestion();
    });
    this.saveNaturalProteinCoefficient(value);
  },

  onSpecialCoefficientInput(e) {
    const value = e.detail.value;
    this.setData({ specialProteinCoefficientInput: value }, () => {
      this.updateQuickGoalSuggestion();
    });
    this.saveSpecialProteinCoefficient(value);
  },

  onCalorieCoefficientInput(e) {
    const value = e.detail.value;
    this.setData({ calorieCoefficientInput: value }, () => {
      this.updateQuickGoalSuggestion();
    });
    this.saveCalorieCoefficient(value);
  },

  onQuickGoalTargetChange(e) {
    const mode = e.currentTarget.dataset.mode || 'protein';
    this.setData({ quickGoalTarget: mode }, () => {
      this.updateQuickGoalSuggestion();
    });
  },

  // 计算总奶量（天然奶量 + 特奶量）
  calculateTotalVolume(type = 'current') {
    const feedingData = type === 'current' ? this.data.currentFeeding : 
                       type === 'quick' ? this.data.quickFeedingData :
                       this.data.editingFeeding;
    
    if (!feedingData) {
      return 0;
    }
    
    const naturalMilk = parseFloat(feedingData.naturalMilkVolume) || 0;
    const specialMilk = parseFloat(feedingData.specialMilkVolume) || 0;
    const totalVolume = naturalMilk + specialMilk;
    
    const updateField = type === 'current' ? 'currentFeeding.totalVolume' :
                       type === 'quick' ? 'quickFeedingData.totalVolume' :
                       'editingFeeding.totalVolume';

    this.setData({
      [updateField]: totalVolume.toFixed(1)
    });

    if (type === 'quick') {
      this.calculateQuickNutrition();
    }

    if (['current', 'quick', 'edit', 'new'].includes(type)) {
      this.updateFormulaPowderForType(type);
    }

    return totalVolume;
  },

  // 加载食物库
  async loadFoodCatalog() {
    try {
      const babyUid = getBabyUid();
      const remoteFoods = await FoodModel.getAvailableFoods(babyUid);
      const combinedFoods = (remoteFoods || [])
        .filter(item => !!item && !!item._id)
        .map(food => {
          const normalizedCategory = this.normalizeFoodCategoryValue(
            food.category || food.categoryLevel1
          );
          const aliasText = food.aliasText ||
            (Array.isArray(food.alias) ? food.alias.join(' / ') : (food.alias || ''));
          return {
            ...food,
            category: normalizedCategory,
            categoryLevel1: normalizedCategory,
            categoryLevel2: food.categoryLevel2 || '',
            isSystem: !!food.isSystem,
            aliasText
          };
        });

      const categorizedFoods = {};
      const categorySet = new Set();

      combinedFoods.forEach(food => {
        const category = food.category || '婴幼儿辅食';
        if (!categorizedFoods[category]) {
          categorizedFoods[category] = [];
        }
        categorizedFoods[category].push(food);
        categorySet.add(category);
      });

      Object.keys(categorizedFoods).forEach(category => {
        categorizedFoods[category] = categorizedFoods[category].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      });

      const foodCategories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));

      this.setData({
        foodCatalog: combinedFoods,
        categorizedFoods,
        foodCategories
      }, () => {
        this.filterFoodOptions(this.data.foodSearchQuery || '');
        this.loadRecentFoodOptions();
      });
    } catch (error) {
      console.error('加载食物库失败:', error);
      this.setData({
        foodCatalog: [],
        foodCategories: [],
        categorizedFoods: {}
      }, () => {
        this.filterFoodOptions(this.data.foodSearchQuery || '');
      });
    }
  },

  // 规范化摄入记录
  normalizeIntakes(intakes = []) {
    if (!Array.isArray(intakes)) return [];

    return intakes
      .map(item => {
        if (!item) return null;
        const nutrition = item.nutrition || {};
        const proteinSource = item.proteinSource || (item.milkType === 'special_formula' ? 'special' : 'natural');
        const recordedAt = item.recordedAt || this.safeFormatTime(item.createdAt);

        const rawCategory =
          item.category || (item.type === 'milk' || item.milkType ? 'milk' : '');
        const normalizedCategory = rawCategory || '辅食';
        const isMilk = this.isMilkCategory(normalizedCategory) || item.type === 'milk' || !!item.milkType;

        return {
          ...item,
          type: isMilk ? 'milk' : 'food',
          category: normalizedCategory,
          recordedAt,
          nutrition: {
            calories: Number(nutrition.calories) || 0,
            protein: Number(nutrition.protein) || 0,
            carbs: Number(nutrition.carbs) || 0,
            fat: Number(nutrition.fat) || 0,
            fiber: Number(nutrition.fiber) || 0,
            sodium: Number(nutrition.sodium) || 0
          },
          naturalProtein: typeof item.naturalProtein === 'number' ? item.naturalProtein : null,
          specialProtein: typeof item.specialProtein === 'number' ? item.specialProtein : null,
          proteinSource
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const timeA = (a.recordedAt || '').replace(':', '');
        const timeB = (b.recordedAt || '').replace(':', '');
        return timeB.localeCompare(timeA);
      });
  },

  // 计算宏量营养统计
  calculateMacroSummary(intakes = [], feedings = []) {
    const summary = {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    };

    const accumulateFromIntake = (intake) => {
      const nutrition = intake.nutrition || {};
      const protein = Number(nutrition.protein) || 0;
      const naturalProtein = typeof intake.naturalProtein === 'number'
        ? intake.naturalProtein
        : (intake.proteinSource === 'special' ? 0 : protein);
      const specialProtein = typeof intake.specialProtein === 'number'
        ? intake.specialProtein
        : (intake.proteinSource === 'special' ? protein : 0);

      summary.calories += Number(nutrition.calories) || 0;
      summary.protein += protein;
      summary.naturalProtein += naturalProtein;
      summary.specialProtein += specialProtein;
      summary.carbs += Number(nutrition.carbs) || 0;
      summary.fat += Number(nutrition.fat) || 0;
    };

    (intakes || []).forEach(accumulateFromIntake);

    // 聚合喂奶体积，避免逐条舍入误差
    let totalNaturalVolumeBreast = 0;
    let totalNaturalVolumeFormula = 0;
    let totalSpecialVolume = 0;

    (feedings || []).forEach(feeding => {
      const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
      const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
      const naturalTypeRaw = feeding.naturalMilkType || 'breast';
      const naturalType = naturalTypeRaw === 'breast' ? 'breast' : 'formula';

      if (naturalVolume > 0) {
        if (naturalType === 'formula') {
          totalNaturalVolumeFormula += naturalVolume;
        } else {
          totalNaturalVolumeBreast += naturalVolume;
        }
      }
      if (specialVolume > 0) {
        totalSpecialVolume += specialVolume;
      }
    });

    if (totalNaturalVolumeBreast > 0) {
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeBreast,
        naturalMilkType: 'breast',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      });
      summary.calories += nutrition.naturalCalories || 0;
      summary.protein += nutrition.naturalProtein || 0;
      summary.naturalProtein += nutrition.naturalProtein || 0;
      summary.carbs += nutrition.carbs || 0;
      summary.fat += nutrition.fat || 0;
    }

    if (totalNaturalVolumeFormula > 0) {
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeFormula,
        naturalMilkType: 'formula',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      });
      summary.calories += nutrition.naturalCalories || 0;
      summary.protein += nutrition.naturalProtein || 0;
      summary.naturalProtein += nutrition.naturalProtein || 0;
      summary.carbs += nutrition.carbs || 0;
      summary.fat += nutrition.fat || 0;
    }

    if (totalSpecialVolume > 0) {
      const specialPowder = this.calculateSpecialMilkPowder(totalSpecialVolume);
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: 0,
        naturalMilkType: 'breast',
        specialMilkVolume: totalSpecialVolume,
        specialMilkPowder: specialPowder
      });
      summary.calories += nutrition.specialCalories || 0;
      summary.protein += nutrition.specialProtein || 0;
      summary.specialProtein += nutrition.specialProtein || 0;
      summary.carbs += nutrition.carbs || 0;
      summary.fat += nutrition.fat || 0;
    }

    summary.calories = this._roundCalories(summary.calories);
    summary.protein = this._round(summary.protein, 2);
    summary.naturalProtein = this._round(summary.naturalProtein, 2);
    summary.specialProtein = this._round(summary.specialProtein, 2);
    summary.carbs = this._round(summary.carbs, 2);
    summary.fat = this._round(summary.fat, 2);

    return summary;
  },

  applyCalorieCoefficient(summary, weightOverride) {
    if (!summary) return summary;
    const parsedWeightSource = weightOverride !== undefined && weightOverride !== null && weightOverride !== ''
      ? weightOverride
      : this.data.weight;
    const parsedWeight = parseFloat(parsedWeightSource);
    if (!isNaN(parsedWeight) && parsedWeight > 0) {
      summary.caloriesPerKg = this._round((summary.calories || 0) / parsedWeight, 1);
    } else {
      summary.caloriesPerKg = '';
    }
    return summary;
  },

  computeMacroRatios(summary) {
    const protein = Number(summary?.protein) || 0;
    const carbs = Number(summary?.carbs) || 0;
    const fat = Number(summary?.fat) || 0;
    const proteinEnergy = protein * 4;
    const carbsEnergy = carbs * 4;
    const fatEnergy = fat * 9;
    const total = proteinEnergy + carbsEnergy + fatEnergy;
    if (!total) {
      return { protein: 0, carbs: 0, fat: 0 };
    }
    return {
      protein: this._round((proteinEnergy / total) * 100, 1),
      carbs: this._round((carbsEnergy / total) * 100, 1),
      fat: this._round((fatEnergy / total) * 100, 1)
    };
  },

  // 计算摄入概览（天然 / 特奶 / 食物）
  calculateIntakeOverview(feedings = [], intakes = [], weight = 0) {
    const overview = {
      milk: {
        totalCalories: 0,
        normal: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0, coefficient: '' },
        special: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0, coefficient: '' }
      },
      food: {
        count: 0,
        totalCalories: 0,
        protein: 0,
        naturalProtein: 0,
        specialProtein: 0,
        carbs: 0,
        fat: 0,
        coefficient: ''
      }
    };

    // 先按类型聚合体积，再统一计算营养，减少逐条取整误差
    let totalNaturalVolumeBreast = 0;
    let totalNaturalVolumeFormula = 0;
    let totalSpecialVolume = 0;

    (feedings || []).forEach(feeding => {
      const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
      const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
      const naturalType = feeding.naturalMilkType || 'breast';

      if (naturalVolume > 0) {
        if (naturalType === 'formula') {
          totalNaturalVolumeFormula += naturalVolume;
        } else {
          totalNaturalVolumeBreast += naturalVolume;
        }
      }
      if (specialVolume > 0) {
        totalSpecialVolume += specialVolume;
      }
    });

    const addMilkStats = (group, { volume = 0, calories = 0, protein = 0, carbs = 0, fat = 0 }) => {
      group.volume += volume;
      group.calories += Number(calories) || 0;
      group.protein += protein;
      group.carbs += carbs || 0;
      group.fat += fat || 0;
    };

    if (totalNaturalVolumeBreast > 0) {
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeBreast,
        naturalMilkType: 'breast',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      });
      addMilkStats(overview.milk.normal, {
        volume: totalNaturalVolumeBreast,
        calories: nutrition.naturalCalories || 0,
        protein: nutrition.naturalProtein || 0,
        carbs: nutrition.carbs || 0,
        fat: nutrition.fat || 0
      });
    }

    if (totalNaturalVolumeFormula > 0) {
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeFormula,
        naturalMilkType: 'formula',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      });
      addMilkStats(overview.milk.normal, {
        volume: totalNaturalVolumeFormula,
        calories: nutrition.naturalCalories || 0,
        protein: nutrition.naturalProtein || 0,
        carbs: nutrition.carbs || 0,
        fat: nutrition.fat || 0
      });
    }

    if (totalSpecialVolume > 0) {
      const specialPowder = this.calculateSpecialMilkPowder(totalSpecialVolume);
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: 0,
        naturalMilkType: 'breast',
        specialMilkVolume: totalSpecialVolume,
        specialMilkPowder: specialPowder
      });
      addMilkStats(overview.milk.special, {
        volume: totalSpecialVolume,
        calories: nutrition.specialCalories || 0,
        protein: nutrition.specialProtein || 0,
        carbs: nutrition.carbs || 0,
        fat: nutrition.fat || 0
      });
    }

    (intakes || []).forEach(intake => {
      const nutrition = intake.nutrition || {};
      const calories = Number(nutrition.calories) || 0;
      const protein = Number(nutrition.protein) || 0;
      const naturalProtein = typeof intake.naturalProtein === 'number'
        ? intake.naturalProtein
        : (intake.proteinSource === 'special' ? 0 : protein);
      const specialProtein = typeof intake.specialProtein === 'number'
        ? intake.specialProtein
        : (intake.proteinSource === 'special' ? protein : 0);

      if (intake.type === 'milk') {
        const quantity = parseFloat(intake.quantity) || 0;
        const isSpecial = intake.proteinSource === 'special' || intake.milkType === 'special_formula';
        const target = isSpecial ? overview.milk.special : overview.milk.normal;

        let naturalCalories = 0;
        let specialCalories = 0;
        const totalProtein = naturalProtein + specialProtein;
        if (totalProtein > 0 && calories > 0) {
          naturalCalories = calories * (naturalProtein / totalProtein);
          specialCalories = calories - naturalCalories;
        } else if (calories > 0) {
          if (isSpecial) {
            specialCalories = calories;
          } else {
            naturalCalories = calories;
          }
        }

        addMilkStats(target, {
          volume: quantity,
          calories: isSpecial ? specialCalories : naturalCalories,
          protein: isSpecial ? specialProtein : naturalProtein,
          carbs: Number(nutrition.carbs) || 0,
          fat: Number(nutrition.fat) || 0
        });
        return;
      }

      overview.food.count += 1;
      overview.food.totalCalories += calories;
      overview.food.protein += protein;
      overview.food.naturalProtein += naturalProtein;
      overview.food.specialProtein += specialProtein;
      overview.food.carbs += Number(nutrition.carbs) || 0;
      overview.food.fat += Number(nutrition.fat) || 0;
    });

    overview.milk.normal = {
      volume: this._round(overview.milk.normal.volume, 2),
      calories: this._roundCalories(overview.milk.normal.calories),
      protein: this._round(overview.milk.normal.protein, 2),
      carbs: this._round(overview.milk.normal.carbs, 2),
      fat: this._round(overview.milk.normal.fat, 2),
      coefficient: ''
    };
    overview.milk.special = {
      volume: this._round(overview.milk.special.volume, 2),
      calories: this._roundCalories(overview.milk.special.calories),
      protein: this._round(overview.milk.special.protein, 2),
      carbs: this._round(overview.milk.special.carbs, 2),
      fat: this._round(overview.milk.special.fat, 2),
      coefficient: ''
    };
    overview.milk.totalCalories = this._roundCalories(
      (overview.milk.normal.calories || 0) + (overview.milk.special.calories || 0)
    );

    const parsedWeight = parseFloat(weight) || 0;
    if (parsedWeight > 0) {
      overview.milk.normal.coefficient = this._round(overview.milk.normal.protein / parsedWeight, 2);
      overview.milk.special.coefficient = this._round(overview.milk.special.protein / parsedWeight, 2);
    }

    overview.food.totalCalories = this._roundCalories(overview.food.totalCalories);
    overview.food.protein = this._round(overview.food.protein, 2);
    overview.food.naturalProtein = this._round(overview.food.naturalProtein, 2);
    overview.food.specialProtein = this._round(overview.food.specialProtein, 2);
    overview.food.carbs = this._round(overview.food.carbs, 2);
    overview.food.fat = this._round(overview.food.fat, 2);
    overview.food.coefficient = parsedWeight > 0 ? this._round(overview.food.protein / parsedWeight, 2) : '';

    return overview;
  },

  // 计算单次喂养的营养值
  calculateMilkNutrition(feeding) {
    const settings = this.data.calculation_params || {};
    const naturalMilkVolume = parseFloat(feeding.naturalMilkVolume) || 0;
    const specialMilkVolume = parseFloat(feeding.specialMilkVolume) || 0;
    const specialPowderWeight = parseFloat(feeding.specialMilkPowder) || 0;
    const naturalType = feeding.naturalMilkType || 'breast';

    let naturalProtein = 0;
    let naturalFat = 0;
    let naturalCarbs = 0;
    if (naturalType === 'formula') {
      const ratioPowder = Number(settings.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
      const ratioWater = Number(settings.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
      const formulaProteinPer100g = Number(settings.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
      const formulaFatPer100g = Number(settings.formula_milk_fat) || 0;
      const formulaCarbsPer100g = Number(settings.formula_milk_carbs) || 0;
      const formulaFiberPer100g = Number(settings.formula_milk_fiber) || 0;
      if (ratioWater > 0) {
        const powderWeight = naturalMilkVolume * ratioPowder / ratioWater;
        naturalProtein = (powderWeight * formulaProteinPer100g) / 100;
        naturalFat = (powderWeight * formulaFatPer100g) / 100;
        naturalCarbs = (powderWeight * formulaCarbsPer100g) / 100;
      }
    } else {
      const naturalProteinPer100ml = Number(settings.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
      naturalProtein = (naturalMilkVolume * naturalProteinPer100ml) / 100;
      const naturalFatPer100ml = Number(settings.natural_milk_fat) || 0;
      const naturalCarbsPer100ml = Number(settings.natural_milk_carbs) || 0;
      naturalFat = (naturalMilkVolume * naturalFatPer100ml) / 100;
      naturalCarbs = (naturalMilkVolume * naturalCarbsPer100ml) / 100;
    }
    let naturalCalories = naturalMilkVolume * NATURAL_MILK_CALORIES_PER_ML;
    if (naturalType === 'formula') {
      const ratioPowder = Number(settings.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
      const ratioWater = Number(settings.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
      const formulaCaloriesPer100g = Number(settings.formula_milk_calories) || DEFAULT_FORMULA_MILK_CALORIES;
      if (ratioWater > 0 && formulaCaloriesPer100g) {
        const powderWeight = naturalMilkVolume * ratioPowder / ratioWater;
        naturalCalories = (powderWeight * formulaCaloriesPer100g) / 100;
      }
    } else {
      const naturalCaloriesPer100ml = Number(settings.natural_milk_calories);
      if (naturalCaloriesPer100ml > 0) {
        naturalCalories = (naturalMilkVolume * naturalCaloriesPer100ml) / 100;
      }
    }

    let specialProtein = 0;
    let specialCalories = 0;
    let specialFat = 0;
    let specialCarbs = 0;
    if (specialPowderWeight > 0) {
      const specialProteinPer100g = Number(settings.special_milk_protein) || 13.1;
      const specialCaloriesPer100g = Number(settings.special_milk_calories);
      const specialFatPer100g = Number(settings.special_milk_fat) || 0;
      const specialCarbsPer100g = Number(settings.special_milk_carbs) || 0;
      specialProtein = (specialPowderWeight * specialProteinPer100g) / 100;
      specialFat = (specialPowderWeight * specialFatPer100g) / 100;
      specialCarbs = (specialPowderWeight * specialCarbsPer100g) / 100;
      if (specialCaloriesPer100g > 0) {
        specialCalories = (specialPowderWeight * specialCaloriesPer100g) / 100;
      } else {
        specialCalories = specialMilkVolume * SPECIAL_MILK_CALORIES_PER_ML;
      }
    } else if (specialMilkVolume > 0) {
      const ratioPowder = Number(settings.special_milk_ratio?.powder);
      const ratioWater = Number(settings.special_milk_ratio?.water);
      const specialProteinPer100g = Number(settings.special_milk_protein);
      const specialFatPer100g = Number(settings.special_milk_fat);
      const specialCarbsPer100g = Number(settings.special_milk_carbs);
      const powderWeight = ratioPowder > 0 && ratioWater > 0
        ? specialMilkVolume * ratioPowder / ratioWater
        : 0;
      if (powderWeight > 0 && specialProteinPer100g > 0) {
        specialProtein = (powderWeight * specialProteinPer100g) / 100;
        if (specialFatPer100g > 0) {
          specialFat = (powderWeight * specialFatPer100g) / 100;
        }
        if (specialCarbsPer100g > 0) {
          specialCarbs = (powderWeight * specialCarbsPer100g) / 100;
        }
      } else {
        const specialProteinPer100ml = Number(settings.special_milk_protein_ml) || 1.97;
        specialProtein = (specialMilkVolume * specialProteinPer100ml) / 100;
      }

      const specialCaloriesPer100g = Number(settings.special_milk_calories);
      if (specialCaloriesPer100g > 0 && powderWeight > 0) {
        specialCalories = (powderWeight * specialCaloriesPer100g) / 100;
      } else {
        specialCalories = specialMilkVolume * SPECIAL_MILK_CALORIES_PER_ML;
      }
    }
    const totalCarbs = naturalCarbs + specialCarbs;
    const totalFat = naturalFat + specialFat;

    return {
      calories: this._roundCalories(naturalCalories + specialCalories),
      protein: this._round(naturalProtein + specialProtein, 2),
      naturalProtein: this._round(naturalProtein, 2),
      specialProtein: this._round(specialProtein, 2),
      naturalCalories: this._roundCalories(naturalCalories),
      specialCalories: this._roundCalories(specialCalories),
      specialPowder: this._round(specialPowderWeight, 2),
      carbs: this._round(totalCarbs, 2),
      fat: this._round(totalFat, 2)
    };
  },

  buildFeedingsDisplay(feedings = []) {
    const parsedWeight = parseFloat(this.data.weight);
    const hasWeight = !isNaN(parsedWeight) && parsedWeight > 0;

    return (feedings || []).map(feeding => {
      const nutrition = this.calculateMilkNutrition({
        naturalMilkVolume: feeding.naturalMilkVolume,
        naturalMilkType: feeding.naturalMilkType || 'breast',
        specialMilkVolume: feeding.specialMilkVolume,
        specialMilkPowder: feeding.specialMilkPowder
      });
      const calories = Number(nutrition.calories) || 0;
      const protein = Number(nutrition.protein) || 0;
      return {
        ...feeding,
        nutritionDisplay: {
          calories: nutrition.calories || 0,
          protein: nutrition.protein || 0,
          naturalProtein: nutrition.naturalProtein || 0,
          specialProtein: nutrition.specialProtein || 0,
          carbs: nutrition.carbs || 0,
          fat: nutrition.fat || 0
        }
      };
    });
  },

  // 安全格式化时间
  safeFormatTime(dateInput) {
    if (!dateInput) {
      const now = new Date();
      return utils.formatTime(now);
    }
    if (typeof dateInput === 'string' && dateInput.includes(':')) {
      return dateInput;
    }
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) {
      const now = new Date();
      return utils.formatTime(now);
    }
    return utils.formatTime(date);
  },

  _round(value, precision = 2) {
    if (isNaN(value)) return 0;
    const multiplier = Math.pow(10, precision);
    return Math.round(value * multiplier) / multiplier;
  },

  _roundCalories(value) {
    const num = Number(value);
    if (isNaN(num)) return 0;
    return Math.round(num);
  },

  // 开始喂养记录
  async startFeeding() {
    if (!this.ensureFeedingSettings('current')) {
      return;
    }
    try {
      // 1. 首先验证体重数据
      if (!this.data.weight || parseFloat(this.data.weight) <= 0) {
        wx.showModal({
          title: '请先输入体重',
          content: '开始喂养记录前，请先在上方输入宝宝今日的体重数据',
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      
      // 2. 验证喂养数据
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
        naturalMilkType: this.data.currentFeeding.naturalMilkType || 'breast',
        specialMilkVolume: Math.round(parseFloat(this.data.currentFeeding.specialMilkVolume || 0)).toString(),
        specialMilkPowder: parseFloat(this.data.currentFeeding.specialMilkPowder || 0).toFixed(1),
        totalVolume: Math.round(parseFloat(this.data.currentFeeding.totalVolume || 0)).toString(),
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
      utils.showSuccess('开始记录喂养');
      
      // 8. 刷新数据显示（静默模式，避免影响当前状态）
      await this.loadTodayData(true);
      
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '开始记录失败' });
    }
  },
  
  // 撤销当前喂养记录
  cancelFeeding() {
    wx.showModal({
      title: '确认撤销',
      content: '确定要撤销当前喂养记录吗？',
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
            const { naturalMilkVolume, specialMilkVolume, specialMilkPowder, totalVolume } = this.data.currentFeeding;
            
            this.setData({
              currentFeeding: {
                startTime: '',
                endTime: '',
                naturalMilkVolume,
                naturalMilkType: this.data.currentFeeding.naturalMilkType || 'breast',
                specialMilkVolume,
                specialMilkPowder,
                totalVolume
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
  
  // 结束喂养记录
  async endFeeding() {
    try {
      if (!this.data.currentFeeding.startTime) {
        throw new Error('请先开始喂养');
      }
      
      wx.showLoading({ title: '保存中...' });
      
      const endTime = utils.formatTime();
      const endDateTime = new Date();
      
      // 如果存在临时记录，更新它的结束时间
      if (this.data.currentFeedingRecordId) {
        await this.updateTempFeedingRecord(endTime, endDateTime);
      } else {
        // 如果没有临时记录（意外情况），创建新记录
        const { naturalMilkVolume, specialMilkVolume, specialMilkPowder, totalVolume } = this.data.currentFeeding;
        
        const feeding = {
          startTime: this.data.currentFeeding.startTime,
          endTime: endTime,
          startDateTime: utils.createTimeObject(this.data.currentFeeding.startTime),
          endDateTime: endDateTime,
          naturalMilkVolume: Math.round(parseFloat(naturalMilkVolume || 0)).toString(),
          naturalMilkType: this.data.currentFeeding.naturalMilkType || 'breast',
          specialMilkVolume: Math.round(parseFloat(specialMilkVolume || 0)).toString(),
          specialMilkPowder: parseFloat(specialMilkPowder || 0).toFixed(1),
          totalVolume: Math.round(parseFloat(totalVolume || 0)).toString()
        };
        
        await this.saveFeedingRecord(feeding);
      }
      
      // 保存当前奶量数据
      const { naturalMilkVolume, specialMilkVolume, specialMilkPowder, totalVolume } = this.data.currentFeeding;
      
      // 重置时间状态，保留奶量
      this.setData({
        currentFeeding: {
          startTime: '',
          endTime: '',
          naturalMilkVolume,
          naturalMilkType: this.data.currentFeeding.naturalMilkType || 'breast',
          specialMilkVolume,
          specialMilkPowder,
          totalVolume
        },
        currentFeedingRecordId: '' // 清空记录ID
      });
      
      // 更新统计数据
      await this.loadTodayData(true);
      
      wx.hideLoading();
      utils.showSuccess('记录已保存');
      
    } catch (error) {
      wx.hideLoading();
      handleError(error, { title: '保存喂养记录失败' });
    }
  },
  
  // 处理喂养输入
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
      let naturalCoefficientToSet = '';
      let specialCoefficientToSet = '';
      let calorieCoefficientToSet = '';
      let recordId = '';
      let fallbackBasicInfo = null;
      
      let intakesToSet = [];
      let foodIntakesToSet = [];
      let macroSummary = this.calculateMacroSummary([], []);

      if (feedingResult.data.length > 0) {
        const record = feedingResult.data[0];
        feedingsToSet = this.sortFeedingsByTimeDesc(record.feedings || []).map(item => ({
          ...item,
          naturalMilkType: item.naturalMilkType || 'breast'
        }));
        recordId = record._id;
        intakesToSet = this.normalizeIntakes(record.intakes || []);
        foodIntakesToSet = intakesToSet.filter(item => item.type !== 'milk');
        macroSummary = this.calculateMacroSummary(intakesToSet, feedingsToSet);
        
        // 获取基本信息（兼容旧数据结构）
        if (record.basicInfo) {
          if (record.basicInfo.weight) {
            weightToSet = record.basicInfo.weight;
          } else if (record.weight) {
            weightToSet = record.weight;
          }
          naturalCoefficientToSet = record.basicInfo.naturalProteinCoefficient || '';
          specialCoefficientToSet = record.basicInfo.specialProteinCoefficient || '';
          calorieCoefficientToSet = record.basicInfo.calorieCoefficient || '';
        } else if (record.weight) {
          weightToSet = record.weight;
        }
      } else {
        // 如果没有今日记录，自动加载昨天的基础数据作为默认值
        fallbackBasicInfo = await this.loadYesterdayBasicInfo();
        if (fallbackBasicInfo) {
          if (fallbackBasicInfo.weight) {
            weightToSet = fallbackBasicInfo.weight;
          }
          if (fallbackBasicInfo.naturalProteinCoefficient) {
            naturalCoefficientToSet = fallbackBasicInfo.naturalProteinCoefficient;
          }
          if (fallbackBasicInfo.specialProteinCoefficient) {
            specialCoefficientToSet = fallbackBasicInfo.specialProteinCoefficient;
          }
          if (fallbackBasicInfo.calorieCoefficient) {
            calorieCoefficientToSet = fallbackBasicInfo.calorieCoefficient;
          }
        }
      }

      if (!fallbackBasicInfo && (!naturalCoefficientToSet || !specialCoefficientToSet)) {
        fallbackBasicInfo = await this.loadYesterdayBasicInfo();
      }
      if (fallbackBasicInfo) {
        if (!weightToSet && fallbackBasicInfo.weight) {
          weightToSet = fallbackBasicInfo.weight;
        }
        if (!naturalCoefficientToSet && fallbackBasicInfo.naturalProteinCoefficient) {
          naturalCoefficientToSet = fallbackBasicInfo.naturalProteinCoefficient;
        }
        if (!specialCoefficientToSet && fallbackBasicInfo.specialProteinCoefficient) {
          specialCoefficientToSet = fallbackBasicInfo.specialProteinCoefficient;
        }
        if (!calorieCoefficientToSet && fallbackBasicInfo.calorieCoefficient) {
          calorieCoefficientToSet = fallbackBasicInfo.calorieCoefficient;
        }
      }
      
      // 处理药物记录 - 使用独立集合的数据
      const medicationRecordsToSet = medicationResult.data || [];

      // 加载排便记录
      const bowelRecordsToSet = await this.loadTodayBowelRecords();

      macroSummary = this.applyCalorieCoefficient(macroSummary, weightToSet);

      // 设置数据（不再缓存 groupedMedicationRecords，改用方法动态计算）
      this.setData({
        feedings: feedingsToSet,
        intakes: intakesToSet,
        foodIntakes: foodIntakesToSet,
        medicationRecords: medicationRecordsToSet,
        bowelRecords: bowelRecordsToSet,
        weight: weightToSet,
        naturalProteinCoefficientInput: naturalCoefficientToSet,
        specialProteinCoefficientInput: specialCoefficientToSet,
        calorieCoefficientInput: calorieCoefficientToSet,
        recordId: recordId,
        macroSummary: macroSummary,
        macroRatios: this.computeMacroRatios(macroSummary)
      });
      
      // 更新计算与概览
      this.updateCalculations();
      
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
  
  // 对喂养记录按时间倒序排序
  sortFeedingsByTimeDesc(feedings) {
    return dataUtils.array.sortByTime(feedings, 'startDateTime') || 
           dataUtils.array.sortByTime(feedings, 'startTime');
  },

  // 加载历史基础数据（体重 + 蛋白系数）
  async loadYesterdayBasicInfo() {
    try {
      const db = wx.cloud.database();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');

      if (!babyUid) {
        console.warn('未找到宝宝UID，无法获取历史基础数据');
        return null;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
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

      for (const record of result.data) {
        const basicInfo = record.basicInfo || {};
        if (basicInfo.weight || record.weight || basicInfo.naturalProteinCoefficient || basicInfo.specialProteinCoefficient || basicInfo.calorieCoefficient) {
          return {
            weight: basicInfo.weight || record.weight || '',
            naturalProteinCoefficient: basicInfo.naturalProteinCoefficient || '',
            specialProteinCoefficient: basicInfo.specialProteinCoefficient || '',
            calorieCoefficient: basicInfo.calorieCoefficient || ''
          };
        }
      }

      const babyInfo = await getBabyInfo();
      if (babyInfo && babyInfo.weight) {
        return {
          weight: babyInfo.weight,
          naturalProteinCoefficient: '',
          specialProteinCoefficient: '',
          calorieCoefficient: ''
        };
      }

      return null;

    } catch (error) {
      console.error('加载历史基础数据失败:', error);
      return null;
    }
  },

  async saveWeight(weight) {
    await this.updateTodayBasicInfo({ weight });
    if (weight) {
      this.updateBabyInfoWeight(weight);
    }
  },

  async saveNaturalProteinCoefficient(value) {
    await this.updateTodayBasicInfo({ naturalProteinCoefficient: value });
  },

  async saveSpecialProteinCoefficient(value) {
    await this.updateTodayBasicInfo({ specialProteinCoefficient: value });
  },

  async saveCalorieCoefficient(value) {
    await this.updateTodayBasicInfo({ calorieCoefficient: value });
  },

  async updateTodayBasicInfo(updates = {}) {
    try {
      if (!app.globalData.isLoggedIn) {
        return;
      }
      const db = wx.cloud.database();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能导致数据同步问题');
      }

      const updatePayload = { updatedAt: db.serverDate() };
      Object.keys(updates).forEach(key => {
        updatePayload[`basicInfo.${key}`] = updates[key];
      });

      if (this.data.recordId) {
        await db.collection('feeding_records').doc(this.data.recordId).update({
          data: updatePayload
        });
      } else {
        if (!app.globalData.userInfo) {
          return;
        }
        const basicInfo = {
          weight: this.data.weight || '',
          naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
          specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
          calorieCoefficient: this.data.calorieCoefficientInput || '',
          ...updates
        };
        const result = await db.collection('feeding_records').add({
          data: {
            date: today,
            basicInfo,
            feedings: [],
            medicationRecords: [],
            userInfo: app.globalData.userInfo,
            nickName: app.globalData.userInfo.nickName,
            babyUid: babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        this.setData({ recordId: result._id });
      }
    } catch (error) {
      console.error('更新日常基础信息失败:', error);
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
  },
  
  // 保存快速记录
  async saveQuickFeeding() {
    if (!this.ensureFeedingSettings('quick')) {
      return;
    }
    // 检查必要字段是否填写
    const { naturalMilkVolume, totalVolume, startTime } = this.data.quickFeedingData;
    
    if (!naturalMilkVolume || !totalVolume || !startTime) {
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
    
    // 计算特奶粉克重
    const specialMilkPowder = this.calculateSpecialMilkPowder(specialMilkNum);
    
    // 创建Date对象
    const now = new Date();
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    
    const startDateTime = new Date(now);
    startDateTime.setHours(startHours, startMinutes, 0, 0);
    
    // 创建喂养记录对象
    const feeding = {
      startTime: startTime,
      startDateTime: startDateTime, // 添加标准时间对象
      endTime: '',
      endDateTime: null,
      naturalMilkVolume: naturalMilkNum.toString(),
      naturalMilkType: this.data.quickFeedingData.naturalMilkType || 'breast',
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
      console.error('保存快速喂养记录失败:', error);
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
    const medicationId = e?.currentTarget?.dataset?.medication;
    const now = new Date();
    const formattedTime = utils.formatTime(now);
    
    const meds = this.data.medicationsList || [];
    if (!meds.length) {
      wx.showToast({ title: '请先在“我的-药物管理”添加药物', icon: 'none' });
      return;
    }
    let targetIndex = 0;
    if (medicationId) {
      targetIndex = meds.findIndex(med => med._id === medicationId);
      if (targetIndex < 0) targetIndex = 0;
    }
    const medicationInfo = meds[targetIndex];
    
    this.setData({
      'modals.medication': true,
      selectedMedication: medicationInfo._id,
      selectedMedicationInfo: medicationInfo, // 缓存药物信息
      selectedMedicationIndex: targetIndex,
      currentModalTime: formattedTime,
      currentModalDosage: medicationInfo.dosage // 初始化为默认剂量
    });
  },

  onMedicationPickerChange(e) {
    const index = Number(e.detail.value) || 0;
    const meds = this.data.medicationsList || [];
    const medInfo = meds[index] || null;
    if (!medInfo) return;
    this.setData({
      selectedMedicationIndex: index,
      selectedMedication: medInfo._id,
      selectedMedicationInfo: medInfo,
      currentModalDosage: medInfo.dosage || this.data.currentModalDosage
    });
  },

  // Close medication modal
  closeMedicationModal() {
    this.hideModal('medication');
    this.setData({
      selectedMedication: null,
      selectedMedicationInfo: null, // 清理缓存
      selectedMedicationIndex: 0,
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
    const weight = parseFloat(this.data.weight) || 0;
    const feedings = this.data.feedings || [];
    const intakes = this.data.intakes || [];
    const summary = this.calculateMacroSummary(intakes, feedings);
    const overview = this.calculateIntakeOverview(feedings, intakes, weight);

    if (weight > 0) {
      summary.naturalCoefficient = this._round(summary.naturalProtein / weight, 2);
      summary.specialCoefficient = this._round(summary.specialProtein / weight, 2);
    } else {
      summary.naturalCoefficient = '';
      summary.specialCoefficient = '';
    }
    this.applyCalorieCoefficient(summary, weight);

    this.setData({
      macroSummary: summary,
      intakeOverview: overview,
      macroRatios: this.computeMacroRatios(summary)
    }, () => {
      this.updateQuickGoalSuggestion();
    });
  },

  // 初始化快捷填写数据
  async initQuickFeedingData() {
    if (!this.data.calculation_params) {
      return;
    }
    // 获取当前时间
    const now = new Date();
    
    // 设置时间默认值
    this.setData({
      'quickFeedingData.startTime': utils.formatTime(now)
    });
    
    // 获取最近的喂养数据作为默认值
    const defaultValues = await this.getLatestFeedingData();
    
    this.setData({
      'quickFeedingData.naturalMilkVolume': defaultValues.naturalMilkVolume,
      'quickFeedingData.naturalMilkType': defaultValues.naturalMilkType || 'breast',
      'quickFeedingData.specialMilkVolume': defaultValues.specialMilkVolume,
      'quickFeedingData.specialMilkPowder': '0',
      'quickFeedingData.formulaPowderWeight': 0
    });

    // 重新计算总奶量
    this.calculateTotalVolume('quick');

    // 计算特奶量和特奶粉量
    if (this.data.calculation_params) {
      dataManager.updateSpecialMilkForType(this, 'quick');
    }
    
    this.calculateQuickNutrition();
  },



  // 计算特奶粉克重
  calculateSpecialMilkPowder(specialMilkVolume) {
    if (!this.data.calculation_params) {
      return 0;
    }
    return calculator.calculateSpecialMilkPowder(specialMilkVolume, this.data.calculation_params);
  },

  calculateFormulaPowderWeight(naturalMilkVolume) {
    const volume = parseFloat(naturalMilkVolume) || 0;
    if (volume <= 0) {
      return 0;
    }
    const params = this.data.calculation_params || {};
    const ratioPowder = Number(params.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
    const ratioWater = Number(params.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
    if (!ratioWater || ratioWater <= 0) {
      return 0;
    }
    return this._round((volume * ratioPowder) / ratioWater, 2);
  },

  updateFormulaPowderForType(type = 'quick') {
    const typeMap = {
      current: 'currentFeeding',
      quick: 'quickFeedingData',
      new: 'newFeeding',
      edit: 'editingFeeding'
    };
    const dataKey = typeMap[type];
    if (!dataKey) return;
    const feedingData = this.data[dataKey];
    if (!feedingData) return;
    const naturalType = feedingData.naturalMilkType || 'breast';
    const targetField = `${dataKey}.formulaPowderWeight`;
    if (naturalType !== 'formula') {
      this.setData({ [targetField]: 0 });
      return;
    }
    const powderWeight = this.calculateFormulaPowderWeight(feedingData.naturalMilkVolume);
    this.setData({ [targetField]: powderWeight });
  },

  scheduleEditingNutritionUpdate() {
    if (!this.data.modals.edit) return;
    wx.nextTick(() => {
      this.updateFormulaPowderForType('edit');
      this.updateEditingNutrition();
    });
  },

  updateEditingNutrition() {
    const editingFeeding = this.data.editingFeeding;
    if (!editingFeeding) {
      return;
    }
    const nutrition = this.calculateMilkNutrition({
      naturalMilkVolume: parseFloat(editingFeeding.naturalMilkVolume) || 0,
      specialMilkVolume: parseFloat(editingFeeding.specialMilkVolume) || 0,
      specialMilkPowder: parseFloat(editingFeeding.specialMilkPowder) || 0,
      naturalMilkType: editingFeeding.naturalMilkType || 'breast'
    });
    this.setData({
      editingFeedingStats: {
        normalProtein: nutrition.naturalProtein || 0,
        normalCalories: nutrition.naturalCalories || 0,
        specialProtein: nutrition.specialProtein || 0,
        specialCalories: nutrition.specialCalories || 0
      }
    }, () => {
      this.updateEditingFeedingDisplay();
    });
  },

  updateEditingFeedingDisplay() {
    const editingFeeding = this.data.editingFeeding;
    if (!editingFeeding) {
      this.setData({ editingFeedingDisplay: null });
      return;
    }
    const stats = this.data.editingFeedingStats || {};
    const display = {
      ...editingFeeding,
      startTime: editingFeeding.startTime || '',
      normalProtein: stats.normalProtein || 0,
      normalCalories: stats.normalCalories || 0,
      specialProtein: stats.specialProtein || 0,
      specialCalories: stats.specialCalories || 0
    };
    this.setData({ editingFeedingDisplay: display });
  },

  // 显示食物摄入弹窗
  showFoodIntakeModal(options = {}) {
    if (options && options.currentTarget) {
      options = options.currentTarget.dataset || {};
    }

    const preferMilk = options.matchMilk === true || options.matchMilk === 'true' || options.preferMilk === true;
    const preferredCategory = options.category || options.preferredCategory || '';

    if (!this.data.foodCatalog || this.data.foodCatalog.length === 0) {
      wx.showToast({
        title: '请先前往“我的-食物管理”添加食物',
        icon: 'none'
      });
      return false;
    }

    const categories = this.data.foodCategories.length > 0 ? this.data.foodCategories : ['food'];
    let defaultCategory = preferredCategory;
    if (!defaultCategory && preferMilk) {
      defaultCategory = this.getDefaultMilkCategory();
    }
    if (!defaultCategory) {
      defaultCategory = categories[0];
    }

    let foodsInCategory = this.data.categorizedFoods[defaultCategory] || [];
    let defaultOptions = foodsInCategory.length > 0 ? foodsInCategory : this.data.foodCatalog;
    let defaultFood = defaultOptions[0] || null;

    if (preferMilk) {
      defaultFood = defaultOptions.find(food =>
        this.isMilkCategory(food.category) || food.type === 'milk' || !!food.milkType
      ) || this.data.foodCatalog.find(food =>
        this.isMilkCategory(food.category) || food.type === 'milk' || !!food.milkType
      );

      if (defaultFood) {
        defaultCategory = defaultFood.category || defaultCategory;
        foodsInCategory = this.data.categorizedFoods[defaultCategory] || [];
        defaultOptions = foodsInCategory.length > 0 ? foodsInCategory : this.data.foodCatalog;
      } else {
        wx.showToast({
          title: '请先在“食物管理”中添加奶类食物',
          icon: 'none'
        });
        return false;
      }
    }

    if (!defaultFood) {
      wx.showToast({ title: '暂无可用食物，请先添加', icon: 'none' });
      return false;
    }
    const recordTime = utils.formatTime(new Date());

    const quantity = defaultFood?.defaultQuantity || defaultFood?.baseQuantity || 100;
    const nutritionPreview = defaultFood
      ? FoodModel.calculateNutrition(defaultFood, quantity)
      : null;

    this.setData({
      'newFoodIntake.category': defaultCategory,
      'newFoodIntake.foodId': defaultFood?._id || '',
      'newFoodIntake.food': defaultFood || null,
      'newFoodIntake.quantity': quantity,
      'newFoodIntake.unit': this._getFoodUnit(defaultFood),
      'newFoodIntake.nutritionPreview': nutritionPreview,
      'newFoodIntake.proteinSource': defaultFood?.proteinSource || 'natural',
      'newFoodIntake.recordTime': recordTime,
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1,
      activeFoodMenu: -1,
      foodSearchQuery: '',
      filteredFoodOptions: this.data.foodCatalog
    }, () => {
      this.filterFoodOptions('');
      this.showModal('foodIntake');
    });

    return true;
  },

  showFoodIntakeExperimentModal() {
    if (!this.data.foodCatalog || this.data.foodCatalog.length === 0) {
      wx.showToast({
        title: '请先前往“我的-食物管理”添加食物',
        icon: 'none'
      });
      return;
    }
    const recordTime = utils.formatTime(new Date());
    this.setData({
      foodExperiment: {
        foodId: '',
        food: null,
        quantity: '',
        unit: '',
        nutritionPreview: null,
        recordTime: recordTime
      },
      foodExperimentSearchQuery: '',
      foodExperimentStep: 'select',
      filteredFoodExperimentOptions: this.data.foodCatalog
    }, () => {
      this.loadRecentFoodOptions().then(() => {
        this.initFoodExperimentCategories(true);
        this.filterFoodExperimentOptions('');
        this.showModal('foodIntakeExperiment');
      });
    });
  },

  showMilkFoodIntakeModal() {
    const opened = this.showFoodIntakeModal({ matchMilk: true });
    if (!opened) {
      this.showFoodIntakeModal();
    }
  },

  hideFoodIntakeModal() {
    this.hideModal('foodIntake');
    this.setData({
      newFoodIntake: {
        category: '',
        foodId: '',
        food: null,
        quantity: '',
        unit: '',
        nutritionPreview: null,
        proteinSource: 'natural',
        recordTime: ''
      },
      foodSearchQuery: '',
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1
    }, () => {
      this.filterFoodOptions('');
    });
  },

  hideFoodIntakeExperimentModal() {
    this.hideModal('foodIntakeExperiment');
    this.setData({
      foodExperiment: {
        foodId: '',
        food: null,
        quantity: '',
        unit: '',
        nutritionPreview: null,
        recordTime: ''
      },
      foodExperimentSearchQuery: '',
      foodExperimentCategories: [],
      foodExperimentCategory: 'recent',
      foodExperimentStep: 'select',
      filteredFoodExperimentOptions: [],
      foodModalMode: 'create',
      editingFoodIntakeId: '',
      editingFoodIntakeIndex: -1,
      recentFoodOptions: []
    });
  },

  updateFoodSelection(selectedFood, category) {
    if (!selectedFood) {
      this.setData({
        'newFoodIntake.category': category,
        'newFoodIntake.foodId': '',
        'newFoodIntake.food': null,
        'newFoodIntake.quantity': '',
        'newFoodIntake.unit': '',
        'newFoodIntake.nutritionPreview': null,
        'newFoodIntake.proteinSource': 'natural'
      });
      return;
    }

    const defaultQuantity = 10;
    let nutritionPreview = null;
    if (selectedFood.nutritionSource === 'babySettings') {
      if (selectedFood.milkType === 'mother_milk') {
        nutritionPreview = this.calculateMilkNutrition({
          naturalMilkVolume: defaultQuantity,
          specialMilkVolume: 0,
          specialMilkPowder: 0
        });
      } else if (selectedFood.milkType === 'special_formula') {
        const ratio = this.data.calculation_params?.special_milk_ratio;
        let specialPowderWeight = 0;
        if (ratio && ratio.water) {
          specialPowderWeight = this._round((defaultQuantity * ratio.powder) / ratio.water, 2);
        }
        nutritionPreview = this.calculateMilkNutrition({
          naturalMilkVolume: 0,
          specialMilkVolume: defaultQuantity,
          specialMilkPowder: specialPowderWeight
        });
      }
    }

    if (!nutritionPreview) {
      nutritionPreview = FoodModel.calculateNutrition(selectedFood, defaultQuantity);
    }

    this.setData({
      'newFoodIntake.category': category,
      'newFoodIntake.foodId': selectedFood._id,
      'newFoodIntake.food': selectedFood,
      'newFoodIntake.quantity': defaultQuantity,
      'newFoodIntake.unit': this._getFoodUnit(selectedFood),
      'newFoodIntake.nutritionPreview': nutritionPreview,
      'newFoodIntake.proteinSource': selectedFood.proteinSource || 'natural'
    }, () => {
      this.updateFoodIntakePreview();
    });
  },

  onFoodQuantityInput(e) {
    const quantity = e.detail.value;
    this.setData({
      'newFoodIntake.quantity': quantity
    }, () => {
      this.updateFoodIntakePreview();
    });
  },

  onFoodSearchInput(e) {
    const query = e.detail.value || '';
    this.setData({ foodSearchQuery: query });
    this.filterFoodOptions(query);
  },

  onFoodExperimentSearchInput(e) {
    const query = e.detail.value || '';
    this.setData({ foodExperimentSearchQuery: query });
    if (query.trim()) {
      const matchedCategory = this.findFoodExperimentCategoryByQuery(query);
      if (matchedCategory) {
        this.setData({ foodExperimentCategory: matchedCategory });
      }
    }
    this.filterFoodExperimentOptions(query);
  },

  initFoodExperimentCategories(preserveSelection = false) {
    const categories = [];
    const categorySet = new Set();
    const catalog = this.data.foodCatalog || [];

    catalog.forEach(food => {
      const category = (food.category || '').toString().trim();
      if (!category) return;
      if (categorySet.has(category)) return;
      categorySet.add(category);
      categories.push({ value: category, label: category });
    });

    const list = [{ value: 'recent', label: '最近' }, ...categories];
    const current = preserveSelection ? (this.data.foodExperimentCategory || '') : '';
    const availableValues = new Set(list.map(item => item.value));
    const nextCategory = current && availableValues.has(current) ? current : 'recent';
    this.setData({
      foodExperimentCategories: list,
      foodExperimentCategory: nextCategory
    });
  },

  openFoodManage() {
    wx.navigateTo({
      url: '/pages/food-management/index'
    });
  },

  onFoodOptionTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    const selectedFood = (this.data.foodCatalog || []).find(food => food._id === id);
    if (!selectedFood) return;
    this.updateFoodSelection(selectedFood, selectedFood.category || this.data.newFoodIntake.category || '');
  },

  onFoodExperimentOptionTap(e) {
    const { id } = e.detail;
    if (!id) return;
    const selectedFood = (this.data.foodCatalog || []).find(food => food._id === id);
    if (!selectedFood) return;
    const selectedCategory = (selectedFood.category || '').toString().trim();
    const defaultQuantity = 10;
    let nutritionPreview = null;

    if (selectedFood.nutritionSource === 'babySettings') {
      if (selectedFood.milkType === 'mother_milk') {
        nutritionPreview = this.calculateMilkNutrition({
          naturalMilkVolume: defaultQuantity,
          specialMilkVolume: 0,
          specialMilkPowder: 0
        });
      } else if (selectedFood.milkType === 'special_formula') {
        const ratio = this.data.calculation_params?.special_milk_ratio;
        let specialPowderWeight = 0;
        if (ratio && ratio.water) {
          specialPowderWeight = this._round((defaultQuantity * ratio.powder) / ratio.water, 2);
        }
        nutritionPreview = this.calculateMilkNutrition({
          naturalMilkVolume: 0,
          specialMilkVolume: defaultQuantity,
          specialMilkPowder: specialPowderWeight
        });
      }
    }

    if (!nutritionPreview) {
      nutritionPreview = FoodModel.calculateNutrition(selectedFood, defaultQuantity);
    }

    this.setData({
      'foodExperiment.foodId': selectedFood._id,
      'foodExperiment.food': selectedFood,
      'foodExperiment.quantity': defaultQuantity,
      'foodExperiment.unit': this._getFoodUnit(selectedFood),
      'foodExperiment.nutritionPreview': nutritionPreview,
      'foodExperiment.recordTime': this.data.foodExperiment.recordTime || utils.formatTime(new Date()),
      ...(selectedCategory ? { foodExperimentCategory: selectedCategory } : {})
    });
  },

  onFoodExperimentCategoryTap(e) {
    const { category } = e.detail;
    if (!category) return;
    this.setData({
      foodExperimentCategory: category,
      'foodExperiment.foodId': '',
      'foodExperiment.food': null,
      'foodExperiment.quantity': '',
      'foodExperiment.unit': '',
      'foodExperiment.nutritionPreview': null
    }, () => {
      this.filterFoodExperimentOptions(this.data.foodExperimentSearchQuery || '');
    });
  },

  filterFoodOptions(query = this.data.foodSearchQuery || '') {
    const normalized = (query || '').trim().toLowerCase();
    const catalog = this.data.foodCatalog || [];
    const filtered = normalized
      ? catalog.filter(food => {
          const name = (food.name || '').toLowerCase();
          const category = (food.category || '').toLowerCase();
          const alias = (food.aliasText || '').toLowerCase();
          return name.includes(normalized) || category.includes(normalized) || alias.includes(normalized);
        })
      : catalog;
    this.setData({ filteredFoodOptions: filtered });
  },

  filterFoodExperimentOptions(query = this.data.foodExperimentSearchQuery || '') {
    const normalized = (query || '').trim().toLowerCase();
    const catalog = this.data.foodCatalog || [];
    const currentCategory = this.data.foodExperimentCategory || 'recent';
    let baseList = [];

    if (normalized) {
      baseList = catalog;
    } else if (currentCategory === 'recent') {
      baseList = this.getRecentFoodExperimentOptions();
      if (!baseList.length) {
        this.loadRecentFoodOptions().then(() => {
          this.filterFoodExperimentOptions(query);
        });
        return;
      }
    } else {
      baseList = catalog.filter(food => (food.category || '').toString().trim() === currentCategory);
    }

    const filtered = normalized
      ? baseList.filter(food => {
          const name = (food.name || '').toLowerCase();
          const category = (food.category || '').toLowerCase();
          const alias = (food.aliasText || '').toLowerCase();
          return name.includes(normalized) || category.includes(normalized) || alias.includes(normalized);
        })
      : baseList;
    this.setData({ filteredFoodExperimentOptions: filtered });
  },

  findFoodExperimentCategoryByQuery(query) {
    const normalized = (query || '').trim().toLowerCase();
    if (!normalized) return '';
    const catalog = this.data.foodCatalog || [];
    const match = catalog.find(food => {
      const name = (food.name || '').toLowerCase();
      const category = (food.category || '').toLowerCase();
      const alias = (food.aliasText || '').toLowerCase();
      return name.includes(normalized) || category.includes(normalized) || alias.includes(normalized);
    });
    return match?.category ? String(match.category).trim() : '';
  },

  getRecentFoodExperimentOptions(limit = MAX_RECENT_FOODS) {
    return (this.data.recentFoodOptions || []).slice(0, limit);
  },

  async loadRecentFoodOptions() {
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || getBabyUid();
    if (!babyUid) return;
    try {
      const db = wx.cloud.database();
      const recordRes = await db.collection('feeding_records')
        .where({ babyUid })
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      const catalog = this.data.foodCatalog || [];
      const foodMap = new Map(catalog.map(food => [food._id, food]));
      const result = [];
      const seen = new Set();
      for (const record of recordRes.data || []) {
        const intakes = record?.intakes || [];
        for (const intake of intakes) {
          if (!intake || intake.type === 'milk') continue;
          const foodId = intake.foodId;
          if (!foodId || seen.has(foodId)) continue;
          const food = foodMap.get(foodId);
          if (!food) continue;
          seen.add(foodId);
          result.push(food);
          if (result.length >= MAX_RECENT_FOODS) break;
        }
        if (result.length >= MAX_RECENT_FOODS) break;
      }
      this.setData({ recentFoodOptions: result });
    } catch (error) {
      console.error('加载最近食物失败:', error);
      this.setData({ recentFoodOptions: [] });
    }
  },

  openEditFoodModal(e) {
    const { index, id } = e.currentTarget.dataset;
    const foodIntakes = this.data.foodIntakes || [];
    let targetIndex = typeof index === 'number' ? index : -1;
    if (id) {
      const foundIndex = foodIntakes.findIndex(item => item._id === id);
      if (foundIndex !== -1) {
        targetIndex = foundIndex;
      }
    }
    const target = foodIntakes[targetIndex];
    if (!target) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    const catalogFood = (this.data.foodCatalog || []).find(food => food._id === target.foodId);
    const selectedFood = catalogFood || {
      _id: target.foodId || '',
      name: target.nameSnapshot,
      baseUnit: target.unit || 'g',
      category: target.category || '',
      proteinSource: target.proteinSource || 'natural',
      milkType: target.milkType || '',
      nutritionSource: target.milkType ? 'babySettings' : '',
      aliasText: target.aliasText || ''
    };
    const recordTime = target.recordedAt || utils.formatTime(new Date());
    this.setData({
      foodModalMode: 'edit',
      editingFoodIntakeId: target._id,
      editingFoodIntakeIndex: targetIndex,
      foodExperiment: {
        foodId: selectedFood._id,
        food: selectedFood,
        quantity: target.quantity,
        unit: target.unit || this._getFoodUnit(selectedFood),
        nutritionPreview: target.nutrition || null,
        recordTime: recordTime
      },
      foodExperimentSearchQuery: '',
      foodExperimentStep: 'form',
      foodExperimentCategory: (selectedFood.category || target.category || '').toString().trim() || 'recent'
    }, () => {
      this.initFoodExperimentCategories(true);
      this.filterFoodExperimentOptions('');
      this.showModal('foodIntakeExperiment');
      this.setData({ activeFoodMenu: -1 });
    });
  },

  async deleteFoodIntake(e) {
    const { index, id } = e.currentTarget.dataset;
    const foodIntakes = this.data.foodIntakes || [];
    let targetIndex = typeof index === 'number' ? index : -1;
    if (id) {
      const foundIndex = foodIntakes.findIndex(item => item._id === id);
      if (foundIndex !== -1) {
        targetIndex = foundIndex;
      }
    }
    const target = foodIntakes[targetIndex];
    if (!target) {
      wx.showToast({ title: '记录不存在', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 ${target.nameSnapshot || '该食物'} 记录吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          const db = wx.cloud.database();
          const remainingIntakes = (this.data.intakes || []).filter(item => item._id !== target._id);
          const updatedSummary = this.applyCalorieCoefficient(
            this.calculateMacroSummary(remainingIntakes, this.data.feedings),
            this.data.weight
          );
          if (this.data.recordId) {
            await db.collection('feeding_records').doc(this.data.recordId).update({
              data: {
                intakes: remainingIntakes,
                summary: updatedSummary,
                updatedAt: db.serverDate()
              }
            });
          }
          const updatedOverview = this.calculateIntakeOverview(this.data.feedings || [], remainingIntakes, this.data.weight);
          this.setData({
            intakes: remainingIntakes,
            foodIntakes: remainingIntakes.filter(item => item.type !== 'milk'),
            macroSummary: updatedSummary,
            macroRatios: this.computeMacroRatios(updatedSummary),
            intakeOverview: updatedOverview,
            activeFoodMenu: -1
          });
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadTodayData(true);
        } catch (error) {
          console.error('删除食物记录失败:', error);
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  onFoodRecordTimeChange(e) {
    this.setData({
      'newFoodIntake.recordTime': e.detail.value
    });
  },

  onFoodExperimentRecordTimeChange(e) {
    this.setData({
      'foodExperiment.recordTime': e.detail.value
    });
  },

  confirmFoodExperimentSelection() {
    if (!this.data.foodExperiment.foodId) {
      wx.showToast({ title: '请选择食物', icon: 'none' });
      return;
    }
    this.setData({
      foodExperimentStep: 'form'
    });
  },

  backToFoodExperimentSelection() {
    this.setData({
      foodExperimentStep: 'select'
    });
  },

  handleFoodExperimentFormCancel() {
    const isEdit = this.data.foodModalMode === 'edit' && this.data.editingFoodIntakeId;
    if (isEdit) {
      this.hideFoodIntakeExperimentModal();
      return;
    }
    this.backToFoodExperimentSelection();
  },

  updateFoodIntakePreview() {
    const { food, quantity } = this.data.newFoodIntake;
    if (!food || !quantity) {
      this.setData({ 'newFoodIntake.nutritionPreview': null });
      return;
    }

    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      this.setData({ 'newFoodIntake.nutritionPreview': null });
      return;
    }

    let nutritionPreview = null;

    if (food.nutritionSource === 'babySettings') {
      if (food.milkType === 'mother_milk') {
        const milkNutrition = this.calculateMilkNutrition({
          naturalMilkVolume: numQuantity,
          specialMilkVolume: 0,
          specialMilkPowder: 0
        });
        nutritionPreview = milkNutrition;
      } else if (food.milkType === 'special_formula') {
        const ratio = this.data.calculation_params?.special_milk_ratio;
        let specialPowderWeight = 0;
        if (ratio && ratio.water) {
          specialPowderWeight = this._round((numQuantity * ratio.powder) / ratio.water, 2);
        }
        const milkNutrition = this.calculateMilkNutrition({
          naturalMilkVolume: 0,
          specialMilkVolume: numQuantity,
          specialMilkPowder: specialPowderWeight
        });
        nutritionPreview = milkNutrition;
      }
    }

    if (!nutritionPreview) {
      nutritionPreview = FoodModel.calculateNutrition(food, numQuantity);
    }

    this.setData({ 'newFoodIntake.nutritionPreview': nutritionPreview });
  },

  updateFoodExperimentPreview() {
    const { food, quantity } = this.data.foodExperiment;
    if (!food || !quantity) {
      this.setData({ 'foodExperiment.nutritionPreview': null });
      return;
    }

    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      this.setData({ 'foodExperiment.nutritionPreview': null });
      return;
    }

    let nutritionPreview = null;

    if (food.nutritionSource === 'babySettings') {
      if (food.milkType === 'mother_milk') {
        const milkNutrition = this.calculateMilkNutrition({
          naturalMilkVolume: numQuantity,
          specialMilkVolume: 0,
          specialMilkPowder: 0
        });
        nutritionPreview = milkNutrition;
      } else if (food.milkType === 'special_formula') {
        const ratio = this.data.calculation_params?.special_milk_ratio;
        let specialPowderWeight = 0;
        if (ratio && ratio.water) {
          specialPowderWeight = this._round((numQuantity * ratio.powder) / ratio.water, 2);
        }
        const milkNutrition = this.calculateMilkNutrition({
          naturalMilkVolume: 0,
          specialMilkVolume: numQuantity,
          specialMilkPowder: specialPowderWeight
        });
        nutritionPreview = milkNutrition;
      }
    }

    if (!nutritionPreview) {
      nutritionPreview = FoodModel.calculateNutrition(food, numQuantity);
    }

    this.setData({ 'foodExperiment.nutritionPreview': nutritionPreview });
  },

  onFoodExperimentQuantityInput(e) {
    const quantity = e.detail.value;
    this.setData({
      'foodExperiment.quantity': quantity
    }, () => {
      this.updateFoodExperimentPreview();
    });
  },

  async saveFoodIntake() {
    const { foodId, food, quantity, recordTime, nutritionPreview, proteinSource } = this.data.newFoodIntake;

    if (!foodId || !food) {
      wx.showToast({
        title: '请选择食物',
        icon: 'none'
      });
      return false;
    }

    const numQuantity = parseFloat(quantity);
    if (isNaN(numQuantity) || numQuantity <= 0) {
      wx.showToast({
        title: '请输入有效的重量',
        icon: 'none'
      });
      return false;
    }

    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return false;
    }

    let nutrition = nutritionPreview;
    if (!nutrition) {
      if (food.nutritionSource === 'babySettings') {
        if (food.milkType === 'mother_milk') {
          nutrition = this.calculateMilkNutrition({
            naturalMilkVolume: numQuantity,
            specialMilkVolume: 0,
            specialMilkPowder: 0
          });
        } else if (food.milkType === 'special_formula') {
          const ratio = this.data.calculation_params?.special_milk_ratio;
          let specialPowderWeight = 0;
          if (ratio && ratio.water) {
            specialPowderWeight = this._round((numQuantity * ratio.powder) / ratio.water, 2);
          }
          nutrition = this.calculateMilkNutrition({
            naturalMilkVolume: 0,
            specialMilkVolume: numQuantity,
            specialMilkPowder: specialPowderWeight
          });
        }
      }

      if (!nutrition) {
        nutrition = FoodModel.calculateNutrition(food, numQuantity);
      }
    }
    const protein = Number(nutrition.protein) || 0;
    let naturalProtein = protein;
    let specialProtein = 0;
    let milkExtras = null;
    let specialPowderWeightForSpecial = 0;

    if (food.milkType === 'special_formula') {
      const ratioForSave = this.data.calculation_params?.special_milk_ratio;
      if (ratioForSave && ratioForSave.water) {
        specialPowderWeightForSpecial = this._round((numQuantity * ratioForSave.powder) / ratioForSave.water, 2);
      }
    }

    if (proteinSource === 'special') {
      specialProtein = protein;
      naturalProtein = 0;
    } else if (proteinSource === 'mixed' && food.proteinSplit) {
      const naturalRatio = Number(food.proteinSplit.natural) || 0;
      const specialRatio = Number(food.proteinSplit.special) || 0;
      const totalRatio = naturalRatio + specialRatio || 1;
      naturalProtein = protein * (naturalRatio / totalRatio);
      specialProtein = protein * (specialRatio / totalRatio);
    }

    if (food.milkType === 'special_formula') {
      milkExtras = { specialPowderWeight: specialPowderWeightForSpecial };
    }

    const normalizedNutrition = {
      calories: this._roundCalories(Number(nutrition.calories) || 0),
      protein: this._round(Number(nutrition.protein) || 0, 2),
      carbs: this._round(Number(nutrition.carbs) || 0, 2),
      fat: this._round(Number(nutrition.fat) || 0, 2),
      fiber: this._round(Number(nutrition.fiber) || 0, 2),
      sodium: this._round(Number(nutrition.sodium) || 0, 2)
    };

    const categoryValue = (food.category && String(food.category).trim()) || '';
    const isMilkCategory = this.isMilkCategory(categoryValue) || categoryValue === 'milk' || !!food.milkType;

    const now = new Date();
    const recordTimeValue = recordTime || utils.formatTime(now);
    const intake = {
      _id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: isMilkCategory ? 'milk' : 'food',
      category: categoryValue || (isMilkCategory ? '奶类' : '辅食'),
      foodId: foodId,
      nameSnapshot: food.name,
      unit: food.baseUnit || 'g',
      quantity: numQuantity,
      proteinSource,
      nutrition: normalizedNutrition,
      naturalProtein: this._round(naturalProtein, 2),
      specialProtein: this._round(specialProtein, 2),
      milkType: food.milkType || '',
      recordedAt: recordTimeValue,
      createdAt: now,
      updatedAt: now,
      createdBy: app.globalData.openid || wx.getStorageSync('openid') || ''
    };
    if (milkExtras) {
      intake.milkExtras = milkExtras;
    }
    const isEdit = this.data.foodModalMode === 'edit' && this.data.editingFoodIntakeId;
    try {
      wx.showLoading({ title: '保存中...' });
      const db = wx.cloud.database();
      const today = new Date();
      const recordDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      let recordId = this.data.recordId;
      let existingIntakes = [...this.data.intakes];
      if (isEdit) {
        const targetIndex = existingIntakes.findIndex(item => item._id === this.data.editingFoodIntakeId);
        if (targetIndex === -1) {
          wx.hideLoading();
          wx.showToast({ title: '记录不存在', icon: 'none' });
          return false;
        }
        const original = existingIntakes[targetIndex];
        existingIntakes[targetIndex] = {
          ...original,
          ...intake,
          _id: original._id,
          createdAt: original.createdAt || intake.createdAt,
          createdBy: original.createdBy || intake.createdBy
        };
      } else {
        existingIntakes.unshift(intake);
      }

      const updatedSummary = this.applyCalorieCoefficient(
        this.calculateMacroSummary(existingIntakes, this.data.feedings),
        this.data.weight
      );

      if (recordId) {
        await db.collection('feeding_records').doc(recordId).update({
          data: {
            intakes: existingIntakes,
            summary: updatedSummary,
            updatedAt: db.serverDate()
          }
        });
      } else {
        const result = await db.collection('feeding_records').add({
          data: {
            date: recordDate,
            feedings: [],
            intakes: existingIntakes,
            medicationRecords: [],
            summary: updatedSummary,
            babyUid: babyUid,
            basicInfo: {
              weight: this.data.weight || ''
            },
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        recordId = result._id;
        this.setData({ recordId });
      }

      wx.hideLoading();
      wx.showToast({ title: isEdit ? '修改成功' : '添加成功', icon: 'success' });

      const updatedOverview = this.calculateIntakeOverview(this.data.feedings || [], existingIntakes, this.data.weight);
      this.setData({
        intakes: existingIntakes,
        foodIntakes: existingIntakes.filter(item => item.type !== 'milk'),
        macroSummary: updatedSummary,
        intakeOverview: updatedOverview,
        macroRatios: this.computeMacroRatios(updatedSummary)
      });

      this.loadRecentFoodOptions();
      this.hideFoodIntakeModal();
      await this.loadTodayData(true);
      return true;
    } catch (error) {
      console.error('保存食物摄入失败:', error);
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
      return false;
    }
  },

  async saveFoodIntakeExperiment() {
    const { foodId, food, quantity, recordTime, nutritionPreview } = this.data.foodExperiment;
    if (!foodId || !food) {
      wx.showToast({ title: '请选择食物', icon: 'none' });
      return;
    }
    const unit = this._getFoodUnit(food);
    const isEdit = this.data.foodModalMode === 'edit' && this.data.editingFoodIntakeId;
    this.setData({
      newFoodIntake: {
        category: food.category || '',
        foodId: foodId,
        food: food,
        quantity: quantity,
        unit: unit,
        nutritionPreview: nutritionPreview,
        proteinSource: food.proteinSource || 'natural',
        recordTime: recordTime
      },
      ...(isEdit ? {} : {
        foodModalMode: 'create',
        editingFoodIntakeId: '',
        editingFoodIntakeIndex: -1
      })
    }, async () => {
      const saved = await this.saveFoodIntake();
      if (saved) {
        this.hideFoodIntakeExperimentModal();
      }
    });
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

  onShareAppMessage() {
    const cachedBabyInfo = app.globalData.babyInfo || wx.getStorageSync('baby_info') || {};
    const inviteCode = cachedBabyInfo.inviteCode;
    if (inviteCode) {
      return InvitationModel.getShareInfo(inviteCode, cachedBabyInfo.name);
    }
    return {
      title: '柠檬宝宝喂养记录',
      path: '/pages/role-selection/index',
      imageUrl: '/images/LemonLogo.png'
    };
  },

  // 保存喂养记录并返回ID（用于开始喂养时立即保存）
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
      
      // 添加babyUid到喂养记录中
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
          weight: this.data.weight || '',
          naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
          specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
          calorieCoefficient: this.data.calorieCoefficientInput || ''
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
      console.error('保存喂养记录失败:', error);
      throw error;
    }
  },

  // 更新临时喂养记录的结束时间
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
        throw new Error('找不到喂养记录');
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

  // 删除临时喂养记录
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
        console.log('找不到喂养记录');
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

  // 保存喂养记录
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
      
      // 添加babyUid到喂养记录中
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
          naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
          specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
          calorieCoefficient: this.data.calorieCoefficientInput || ''
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
      console.error('保存喂养记录失败:', error);
      
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
    } else if (field === 'editNaturalMilk') {
      currentValue = parseFloat(this.data.editingFeeding?.naturalMilkVolume) || 0;
      updateField = 'editingFeeding.naturalMilkVolume';
      feedingType = 'edit';
    } else if (field === 'editSpecialMilk') {
      currentValue = parseFloat(this.data.editingFeeding?.specialMilkVolume) || 0;
      updateField = 'editingFeeding.specialMilkVolume';
      feedingType = 'edit';
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
    if (feedingType === 'quick') {
      this.calculateQuickNutrition();
    } else if (feedingType === 'edit') {
      this.scheduleEditingNutritionUpdate();
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
    } else if (field === 'editNaturalMilk') {
      currentValue = parseFloat(this.data.editingFeeding?.naturalMilkVolume) || 0;
      updateField = 'editingFeeding.naturalMilkVolume';
      feedingType = 'edit';
    } else if (field === 'editSpecialMilk') {
      currentValue = parseFloat(this.data.editingFeeding?.specialMilkVolume) || 0;
      updateField = 'editingFeeding.specialMilkVolume';
      feedingType = 'edit';
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
    if (feedingType === 'quick') {
      this.calculateQuickNutrition();
    } else if (feedingType === 'edit') {
      this.scheduleEditingNutritionUpdate();
    }
    
  },

  onNaturalMilkTypeChange(e) {
    const { scope, type } = e.currentTarget.dataset;
    const dataPaths = {
      current: 'currentFeeding.naturalMilkType',
      quick: 'quickFeedingData.naturalMilkType',
      new: 'newFeeding.naturalMilkType',
      edit: 'editingFeeding.naturalMilkType'
    };
    const path = dataPaths[scope];
    if (!path) return;
    if (type === 'formula' && !this.isFormulaSettingsComplete()) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写普奶冲配参数，再记录普奶数据。');
      return;
    }
    if (type === 'breast' && !this.isBreastSettingsComplete()) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写母乳蛋白浓度，再记录母乳数据。');
      return;
    }
    this.setData({
      [path]: type
    }, () => {
      if (scope === 'current') {
        this.calculateTotalVolume('current');
      } else if (scope === 'quick') {
        this.calculateTotalVolume('quick');
        this.calculateQuickNutrition();
        this.updateQuickGoalSuggestion();
      } else if (scope === 'edit') {
        this.calculateTotalVolume('edit');
        this.scheduleEditingNutritionUpdate();
      }
    });
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
      const [startHours = 0, startMinutes = 0] = (feeding.startTime || '').split(':').map(Number);
      startDateTime = new Date(now);
      startDateTime.setHours(startHours, startMinutes, 0, 0);
    }
    
    if (!endDateTime && feeding.endTime) {
      const now = new Date();
      const [endHours = 0, endMinutes = 0] = (feeding.endTime || '').split(':').map(Number);
      endDateTime = new Date(now);
      endDateTime.setHours(endHours, endMinutes, 0, 0);
      
      // 如果结束时间小于开始时间，可能是跨天记录，将结束时间加一天
      if (endDateTime < startDateTime) {
        endDateTime.setDate(endDateTime.getDate() + 1);
      }
    }
    
    const editingFeeding = { 
      ...feeding,
      naturalMilkType: feeding.naturalMilkType || 'breast',
      startDateTime: startDateTime,
      endDateTime: endDateTime || null,
      endTime: feeding.endTime || ''
    };
    if (editingFeeding.naturalMilkType === 'formula') {
      editingFeeding.formulaPowderWeight = this.calculateFormulaPowderWeight(editingFeeding.naturalMilkVolume);
    } else {
      editingFeeding.formulaPowderWeight = 0;
    }
    
    this.setData({
      'modals.edit': true,
      editingFeedingIndex: index,
      editingFeeding: editingFeeding,
      activeFeedingMenu: -1 // 关闭菜单
    }, () => {
      this.scheduleEditingNutritionUpdate();
      this.updateEditingFeedingDisplay();
    });
  },

  // 关闭编辑记录弹窗
  closeEditModal() {
    this.hideModal('edit');
    this.setData({
      editingFeedingIndex: -1,
      editingFeeding: null,
      editingFeedingStats: {
        normalProtein: 0,
        normalCalories: 0,
        specialProtein: 0,
        specialCalories: 0
      },
      editingFeedingDisplay: null
    });
  },

  // 处理编辑记录的输入
  onEditFeedingInput(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    if (field === 'startTime') {
      // 时间字段处理
      const editingFeeding = { ...this.data.editingFeeding };
      editingFeeding[field] = value;
      
      const dateTime = utils.createTimeObject(value);
      editingFeeding.startDateTime = dateTime;
      
      this.setData({ editingFeeding }, () => {
        this.updateEditingFeedingDisplay();
      });
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
        this.scheduleEditingNutritionUpdate();
      }
      this.updateEditingFeedingDisplay();
    }
  },

  handleQuickModalInputChange(e) {
    const { field, value } = e.detail || {};
    const fieldMap = {
      naturalMilkVolume: 'quickNaturalMilk',
      specialMilkVolume: 'quickSpecialMilk'
    };
    const mappedField = fieldMap[field];
    if (!mappedField) return;
    this.onQuickFeedingInput({
      currentTarget: { dataset: { field: mappedField } },
      detail: { value }
    });
  },

  handleQuickModalAdjust(e) {
    const { field, action } = e.detail || {};
    const fieldMap = {
      naturalMilkVolume: 'quickNaturalMilk',
      specialMilkVolume: 'quickSpecialMilk'
    };
    const mappedField = fieldMap[field];
    if (!mappedField) return;
    const event = { currentTarget: { dataset: { field: mappedField } } };
    if (action === 'increase') {
      this.increaseVolume(event);
    } else {
      this.decreaseVolume(event);
    }
  },

  handleQuickModalTimeChange(e) {
    this.onQuickStartTimeChange({ detail: { value: e.detail.value } });
  },

  handleQuickModalTypeChange(e) {
    this.onNaturalMilkTypeChange({
      currentTarget: { dataset: { scope: 'quick', type: e.detail.type } }
    });
  },

  handleQuickModalGoalTargetChange(e) {
    this.onQuickGoalTargetChange({
      currentTarget: { dataset: { mode: e.detail.mode } }
    });
  },

  handleQuickModalCoefficientChange(e) {
    const { field, value } = e.detail || {};
    if (field === 'calorieCoefficientInput') {
      this.onCalorieCoefficientInput({ detail: { value } });
    }
  },

  handleEditModalInputChange(e) {
    const { field, value } = e.detail || {};
    if (!field) return;
    this.onEditFeedingInput({
      currentTarget: { dataset: { field } },
      detail: { value }
    });
  },

  handleEditModalTimeChange(e) {
    this.onEditFeedingInput({
      currentTarget: { dataset: { field: 'startTime' } },
      detail: { value: e.detail.value }
    });
  },

  handleEditModalTypeChange(e) {
    this.onNaturalMilkTypeChange({
      currentTarget: { dataset: { scope: 'edit', type: e.detail.type } }
    });
    this.updateEditingFeedingDisplay();
  },

  handleEditModalAdjust(e) {
    const { field, action } = e.detail || {};
    const fieldMap = {
      naturalMilkVolume: 'editNaturalMilk',
      specialMilkVolume: 'editSpecialMilk'
    };
    const mappedField = fieldMap[field];
    if (!mappedField) return;
    const event = { currentTarget: { dataset: { field: mappedField } } };
    if (action === 'increase') {
      this.increaseVolume(event);
    } else {
      this.decreaseVolume(event);
    }
    wx.nextTick(() => {
      this.updateEditingFeedingDisplay();
    });
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

      if (!this.ensureFeedingSettings('edit')) {
        wx.hideLoading();
        return;
      }
      
      // 获取宝宝UID
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        console.warn('未找到宝宝UID，可能导致数据同步问题');
      }
      
      // 获取编辑后的喂养记录
      const { formulaPowderWeight, ...cleanEditingFeeding } = this.data.editingFeeding || {};
      const editedFeeding = {
        ...cleanEditingFeeding,
        naturalMilkVolume: Math.round(parseFloat(this.data.editingFeeding.naturalMilkVolume) || 0).toString(),
        specialMilkVolume: Math.round(parseFloat(this.data.editingFeeding.specialMilkVolume) || 0).toString(),
        totalVolume: Math.round(parseFloat(this.data.editingFeeding.totalVolume) || 0).toString(),
        specialMilkPowder: parseFloat(this.data.editingFeeding.specialMilkPowder || 0).toFixed(1),
        babyUid: babyUid // 确保记录中包含babyUid
      };
      
      // 补全时间信息
      if (!editedFeeding.startDateTime) {
        const now = new Date();
        const [startHours = 0, startMinutes = 0] = (editedFeeding.startTime || '').split(':').map(Number);
        editedFeeding.startDateTime = new Date(now);
        editedFeeding.startDateTime.setHours(startHours, startMinutes, 0, 0);
      }
      
      editedFeeding.endTime = editedFeeding.endTime || '';
      editedFeeding.endDateTime = editedFeeding.endDateTime || null;
      
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
        
        // 如果没有设置体重，使用宝宝信息中的体重
        if (!this.data.weight && babyInfo.weight) {
          this.setData({
            weight: babyInfo.weight
          });
          this.updateCalculations();
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

  // 删除喂养记录
  async deleteFeeding(e) {
    const { index } = e.currentTarget.dataset;
    const feeding = this.data.feedings[index];
    
          // 获取宝宝UID
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      // 验证要删除的喂养记录是否属于当前宝宝
    if (babyUid && feeding.babyUid && feeding.babyUid !== babyUid) {
      wx.showToast({
        title: '无权删除此喂养记录',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除 ${feeding.startTime} 的喂养记录吗？`,
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
            console.error('删除喂养记录失败:', error);
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

  // 导航到配奶设置页面
  navigateToNutritionSettings() {
    wx.navigateTo({
      url: `/pages/nutrition-settings/index`
    });
  },

  // 显示快捷输入弹窗
  async showQuickInputModal() {
    await this.initQuickFeedingData();
    if (!this.ensureFeedingSettings('quick')) {
      return;
    }
    this.showModal('quickInput');
    this.updateQuickGoalSuggestion();
  },
  
  // 隐藏快捷输入弹窗
  hideQuickInputModal() {
    this.hideModal('quickInput');
  },

  // 打开喂养记录菜单
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

  toggleFoodMenu(e) {
    const index = e.currentTarget.dataset.index;
    const currentIndex = this.data.activeFoodMenu;
    if (currentIndex === index) {
      this.setData({ activeFoodMenu: -1 });
    } else {
      this.setData({
        activeFoodMenu: index,
        activeFeedingMenu: -1
      });
    }
  },

  isNutritionSettingsComplete(params) {
    if (!params) return false;
    return this.isBreastSettingsComplete(params) ||
      this.isFormulaSettingsComplete(params) ||
      this.isSpecialSettingsComplete(params);
  },

  isFormulaSettingsComplete(params = this.data.calculation_params) {
    if (!params) return false;
    return this.isPositiveNumber(params.formula_milk_protein) &&
           this.isPositiveNumber(params.formula_milk_calories) &&
           this.isValidRatio(params.formula_milk_ratio);
  },

  isBreastSettingsComplete(params = this.data.calculation_params) {
    if (!params) return false;
    return this.isPositiveNumber(params.natural_milk_protein);
  },

  isSpecialSettingsComplete(params = this.data.calculation_params) {
    if (!params) return false;
    return this.isPositiveNumber(params.special_milk_protein) &&
      this.isValidRatio(params.special_milk_ratio);
  },

  isPositiveNumber(value) {
    const num = Number(value);
    return !isNaN(num) && num > 0;
  },

  isValidRatio(ratio) {
    if (!ratio) return false;
    return this.isPositiveNumber(ratio.powder) && this.isPositiveNumber(ratio.water);
  },

  getFeedingDataByScope(scope) {
    const dataMap = {
      current: this.data.currentFeeding,
      quick: this.data.quickFeedingData,
      new: this.data.newFeeding,
      edit: this.data.editingFeeding
    };
    return dataMap[scope] || {};
  },

  getSpecialMilkVolumeFromFeeding(feeding) {
    if (!feeding) return 0;
    const specialMilk = parseFloat(feeding.specialMilkVolume);
    if (!isNaN(specialMilk)) {
      return specialMilk;
    }
    const naturalMilk = parseFloat(feeding.naturalMilkVolume);
    const totalVolume = parseFloat(feeding.totalVolume);
    if (isNaN(naturalMilk) || isNaN(totalVolume)) {
      return 0;
    }
    return Math.max(0, totalVolume - naturalMilk);
  },

  ensureFeedingSettings(scope, feedingOverride) {
    const params = this.data.calculation_params;
    const feeding = feedingOverride || this.getFeedingDataByScope(scope);
    const naturalMilkType = feeding?.naturalMilkType || 'breast';

    if (naturalMilkType === 'formula') {
      if (!this.isFormulaSettingsComplete(params)) {
        this.promptNutritionSetup(true, '请先在“配奶管理”中填写普奶冲配参数，再记录普奶数据。');
        return false;
      }
    } else if (!this.isBreastSettingsComplete(params)) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写母乳蛋白浓度，再记录母乳数据。');
      return false;
    }

    const specialMilkVolume = this.getSpecialMilkVolumeFromFeeding(feeding);
    if (specialMilkVolume > 0 && !this.isSpecialSettingsComplete(params)) {
      this.promptNutritionSetup(true, '请先在“配奶管理”中填写特奶冲配参数，再记录特奶数据。');
      return false;
    }

    return true;
  },

  promptNutritionSetup(force = false, customMessage) {
    if (this.data.promptingNutrition) return;
    if (!force && this.data.hasShownNutritionPrompt) {
      return;
    }
    this.setData({ promptingNutrition: true, hasShownNutritionPrompt: true });
    wx.showModal({
      title: '完善配奶设置',
      content: customMessage || '请先在“配奶管理”中填写完整的配奶参数，再记录喂奶数据。',
      confirmText: '去设置',
      cancelText: '稍后再说',
      success: (res) => {
        if (res.confirm) {
          this.navigateToNutritionSettings();
        }
      },
      complete: () => {
        this.setData({ promptingNutrition: false });
      }
    });
  },
  
  // 点击页面其他位置关闭所有菜单
  onTapPage() {
    const updates = {};
    if (this.data.activeFeedingMenu !== -1) {
      updates.activeFeedingMenu = -1;
    }
    if (this.data.activeFoodMenu !== -1) {
      updates.activeFoodMenu = -1;
    }
    if (Object.keys(updates).length > 0) {
      this.setData(updates);
    }
  },

  // 阻止事件冒泡
  preventBubble() {
    // 空方法，用于阻止事件冒泡
  },

  // 显示补充喂养记录弹窗
  async showAddFeedingModal() {
    // 默认设置当前时间
    const now = new Date();
    const currentTime = utils.formatTime(now);
    
    // 默认结束时间比开始时间晚30分钟
    const endTime = new Date(now.getTime() + 30 * 60000);
    const endTimeStr = utils.formatTime(endTime);
    
    // 获取最近的喂养数据作为默认值
    const defaultValues = await this.getLatestFeedingData();

    // 计算总奶量
    const naturalMilk = parseFloat(defaultValues.naturalMilkVolume) || 0;
    const specialMilk = parseFloat(defaultValues.specialMilkVolume) || 0;
    const totalVolume = naturalMilk + specialMilk;

    const newFeeding = {
      startTime: currentTime,
      endTime: endTimeStr,
      startDateTime: now,
      endDateTime: endTime,
      naturalMilkVolume: defaultValues.naturalMilkVolume,
      naturalMilkType: defaultValues.naturalMilkType || 'breast',
      specialMilkVolume: defaultValues.specialMilkVolume,
      totalVolume: totalVolume.toString()
    };

    if (!this.ensureFeedingSettings('new', newFeeding)) {
      return;
    }

    this.setData({
      'modals.addFeeding': true,
      newFeeding: {
        ...newFeeding
      }
    });
  },

  // 新喂养记录时间选择处理
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

  // 保存新的喂养记录
  async saveNewFeeding() {
    if (!this.ensureFeedingSettings('new')) {
      return;
    }
    const { startTime, endTime, startDateTime, endDateTime, naturalMilkVolume, totalVolume } = this.data.newFeeding;
    
    // 验证输入
    if (!startTime || !endTime) {
      wx.showToast({
        title: '请选择喂养时间',
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
          weight: this.data.weight || '',
          naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
          specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
          calorieCoefficient: this.data.calorieCoefficientInput || ''
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
      console.error('保存喂养记录失败:', error);
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

  // 隐藏补充喂养记录弹窗
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

  // 新喂养记录输入处理
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
  },

  calculateQuickNutrition() {
    const { naturalMilkVolume, specialMilkVolume } = this.data.quickFeedingData;
    const naturalVolumeNum = parseFloat(naturalMilkVolume) || 0;
    const specialVolumeNum = parseFloat(specialMilkVolume) || 0;
    const specialPowderWeight = this.calculateSpecialMilkPowder(specialVolumeNum);
    const naturalMilkType = this.data.quickFeedingData.naturalMilkType || 'breast';
    const formulaPowderWeight = naturalMilkType === 'formula'
      ? this.calculateFormulaPowderWeight(naturalVolumeNum)
      : 0;

    const normalMilk = this.calculateMilkNutrition({
      naturalMilkVolume: naturalVolumeNum,
      specialMilkVolume: 0,
      specialMilkPowder: 0,
      naturalMilkType
    });
    const specialMilk = this.calculateMilkNutrition({
      naturalMilkVolume: 0,
      specialMilkVolume: specialVolumeNum,
      specialMilkPowder: specialPowderWeight
    });

    this.setData({
      'quickFeedingData.normalProtein': normalMilk.naturalProtein || 0,
      'quickFeedingData.normalCalories': normalMilk.naturalCalories || 0,
      'quickFeedingData.specialProtein': specialMilk.specialProtein || 0,
      'quickFeedingData.specialCalories': specialMilk.specialCalories || 0,
      'quickFeedingData.specialPowderWeight': this._round(specialPowderWeight, 2),
      'quickFeedingData.specialMilkPowder': this._round(specialPowderWeight, 2),
      'quickFeedingData.formulaPowderWeight': formulaPowderWeight
    });
  },

  _getCalorieDensity() {
    const sampleVolume = 100;
    const naturalMilkType = this.data.quickFeedingData?.naturalMilkType || 'breast';
    const naturalNutrition = this.calculateMilkNutrition({
      naturalMilkVolume: sampleVolume,
      naturalMilkType,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    });
    let naturalCaloriesPerMl = (naturalNutrition.naturalCalories || naturalNutrition.calories || 0) / sampleVolume;
    if (!naturalCaloriesPerMl) {
      naturalCaloriesPerMl = NATURAL_MILK_CALORIES_PER_ML;
    }

    const specialPowderWeight = this.calculateSpecialMilkPowder(sampleVolume);
    const specialNutrition = this.calculateMilkNutrition({
      naturalMilkVolume: 0,
      specialMilkVolume: sampleVolume,
      specialMilkPowder: specialPowderWeight
    });
    let specialCaloriesPerMl = (specialNutrition.specialCalories || specialNutrition.calories || 0) / sampleVolume;
    if (!specialCaloriesPerMl) {
      specialCaloriesPerMl = SPECIAL_MILK_CALORIES_PER_ML;
    }

    return {
      naturalCaloriesPerMl,
      specialCaloriesPerMl
    };
  },

  _getFoodUnit(food) {
    if (!food) return 'g';
    return food.baseUnit || (food.isLiquid ? 'ml' : 'g');
  },

  _calculateSuggestedImpact(naturalVolume, specialVolume) {
    const naturalType = this.data.quickFeedingData?.naturalMilkType || 'breast';
    const specialPowder = this.calculateSpecialMilkPowder(specialVolume);
    const naturalNutrition = this.calculateMilkNutrition({
      naturalMilkVolume: naturalVolume,
      naturalMilkType: naturalType,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    });
    const specialNutrition = this.calculateMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: naturalType,
      specialMilkVolume: specialVolume,
      specialMilkPowder: specialPowder
    });

    return {
      calories: this._roundCalories((naturalNutrition.calories || 0) + (specialNutrition.calories || 0)),
      naturalProtein: this._round(naturalNutrition.naturalProtein || 0, 2),
      specialProtein: this._round(specialNutrition.specialProtein || 0, 2)
    };
  },

  updateQuickGoalSuggestion() {
    const weight = parseFloat(this.data.weight) || 0;
    const naturalCoef = parseFloat(this.data.naturalProteinCoefficientInput) || 0;
    const specialCoef = parseFloat(this.data.specialProteinCoefficientInput) || 0;
    const calorieCoef = parseFloat(this.data.calorieCoefficientInput) || 0;
    const summary = this.data.macroSummary || {};
    const naturalConsumed = Number(summary.naturalProtein) || 0;
    const specialConsumed = Number(summary.specialProtein) || 0;
    const caloriesConsumed = Number(summary.calories) || 0;
    const mode = this.data.quickGoalTarget || 'protein';

    const suggestion = {
      ready: false,
      error: '',
      mode,
      naturalProteinGap: 0,
      specialProteinGap: 0,
      calorieGap: 0,
      naturalVolume: 0,
      specialVolume: 0,
      predictedCalorieCoefficient: '',
      predictedNaturalCoefficient: '',
      predictedSpecialCoefficient: '',
      naturalPriorityPlan: {
        naturalVolume: 0,
        specialVolume: 0,
        predictedCalorieCoefficient: '',
        predictedNaturalCoefficient: '',
        predictedSpecialCoefficient: ''
      },
      specialPriorityPlan: {
        naturalVolume: 0,
        specialVolume: 0,
        predictedCalorieCoefficient: '',
        predictedNaturalCoefficient: '',
        predictedSpecialCoefficient: ''
      }
    };

    if (weight <= 0) {
      suggestion.error = '请先填写体重';
      this.setData({ quickGoalSuggestion: suggestion });
      return;
    }

    const hasProteinTarget = naturalCoef > 0 || specialCoef > 0;

    if (naturalCoef > 0) {
      const goal = weight * naturalCoef;
      suggestion.naturalProteinGap = Math.max(0, this._round(goal - naturalConsumed, 2));
    }

    if (specialCoef > 0) {
      const goal = weight * specialCoef;
      suggestion.specialProteinGap = Math.max(0, this._round(goal - specialConsumed, 2));
    }

    const naturalVolumeForProtein = suggestion.naturalProteinGap > 0
      ? this._calculateNaturalVolumeFromProtein(suggestion.naturalProteinGap)
      : 0;
    const specialVolumeForProtein = suggestion.specialProteinGap > 0
      ? this._calculateSpecialVolumeFromProtein(suggestion.specialProteinGap)
      : 0;

    if (mode === 'protein') {
      if (!hasProteinTarget) {
        suggestion.error = '请先填写蛋白系数';
        this.setData({ quickGoalSuggestion: suggestion });
        return;
      }
      suggestion.ready = true;
      suggestion.naturalVolume = this._round(Math.max(naturalVolumeForProtein, 0), 0);
      suggestion.specialVolume = this._round(Math.max(specialVolumeForProtein, 0), 0);
      const impact = this._calculateSuggestedImpact(suggestion.naturalVolume, suggestion.specialVolume);
      const predictedCalories = caloriesConsumed + (impact.calories || 0);
      suggestion.predictedCalorieCoefficient = weight > 0
        ? this._round(predictedCalories / weight, 1)
        : '';
      suggestion.predictedNaturalCoefficient = weight > 0
        ? this._round((naturalConsumed + (impact.naturalProtein || 0)) / weight, 2)
        : '';
      suggestion.predictedSpecialCoefficient = weight > 0
        ? this._round((specialConsumed + (impact.specialProtein || 0)) / weight, 2)
        : '';
      this.setData({ quickGoalSuggestion: suggestion });
      return;
    }

    if (calorieCoef <= 0) {
      suggestion.error = '请先填写热量系数';
      this.setData({ quickGoalSuggestion: suggestion });
      return;
    }

    const calorieGoal = weight * calorieCoef;
    const calorieGapValue = calorieGoal - caloriesConsumed;
    suggestion.calorieGap = Math.max(0, this._roundCalories(calorieGapValue));

    const { naturalCaloriesPerMl, specialCaloriesPerMl } = this._getCalorieDensity();
    const buildPlan = (naturalVolumeRaw, specialVolumeRaw) => {
      const safeNatural = Math.max(naturalVolumeRaw, 0);
      const safeSpecial = Math.max(specialVolumeRaw, 0);
      const impact = this._calculateSuggestedImpact(safeNatural, safeSpecial);
      const predictedNaturalProtein = naturalConsumed + (impact.naturalProtein || 0);
      const predictedSpecialProtein = specialConsumed + (impact.specialProtein || 0);
      return {
        naturalVolume: this._round(safeNatural, 0),
        specialVolume: this._round(safeSpecial, 0),
        predictedCalorieCoefficient: weight > 0
          ? this._round((caloriesConsumed + (impact.calories || 0)) / weight, 1)
          : '',
        predictedNaturalCoefficient: weight > 0
          ? this._round(predictedNaturalProtein / weight, 2)
          : '',
        predictedSpecialCoefficient: weight > 0
          ? this._round(predictedSpecialProtein / weight, 2)
          : ''
      };
    };

    const naturalType = this.data.quickFeedingData?.naturalMilkType || 'breast';

    // 方案一：天然系数优先，天然体积固定，剩余热量由特奶补足
    let naturalBaseVolume = naturalVolumeForProtein;
    const naturalOnlyImpact = this.calculateMilkNutrition({
      naturalMilkVolume: naturalBaseVolume,
      naturalMilkType: naturalType,
      specialMilkVolume: 0,
      specialMilkPowder: 0
    });
    let remainingCalories = calorieGoal - caloriesConsumed - (naturalOnlyImpact.naturalCalories || 0);
    let specialBaseVolume = remainingCalories > 0 && specialCaloriesPerMl > 0
      ? remainingCalories / specialCaloriesPerMl
      : 0;
    suggestion.naturalPriorityPlan = buildPlan(naturalBaseVolume, specialBaseVolume);

    // 方案二：特殊系数优先，特奶体积固定，剩余热量由普奶补足
    specialBaseVolume = specialVolumeForProtein;
    const specialOnlyImpact = this.calculateMilkNutrition({
      naturalMilkVolume: 0,
      naturalMilkType: naturalType,
      specialMilkVolume: specialBaseVolume,
      specialMilkPowder: this.calculateSpecialMilkPowder(specialBaseVolume)
    });
    remainingCalories = calorieGoal - caloriesConsumed - (specialOnlyImpact.specialCalories || 0);
    naturalBaseVolume = remainingCalories > 0 && naturalCaloriesPerMl > 0
      ? remainingCalories / naturalCaloriesPerMl
      : 0;
    suggestion.specialPriorityPlan = buildPlan(naturalBaseVolume, specialBaseVolume);

    // 默认推荐天然优先方案
    suggestion.naturalVolume = suggestion.naturalPriorityPlan.naturalVolume;
    suggestion.specialVolume = suggestion.naturalPriorityPlan.specialVolume;

    suggestion.ready = true;

    this.setData({ quickGoalSuggestion: suggestion });
  },

  _calculateNaturalVolumeFromProtein(protein) {
    if (!protein || protein <= 0) return 0;
    const params = this.data.calculation_params || {};
    if (this.isFormulaSettingsComplete(params)) {
      const ratioPowder = Number(params.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
      const ratioWater = Number(params.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
      const formulaProteinPer100g = Number(params.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
      if (ratioPowder > 0 && ratioWater > 0 && formulaProteinPer100g > 0) {
        return (protein * 100 * ratioWater) / (ratioPowder * formulaProteinPer100g);
      }
    }
    const naturalProteinPer100ml = Number(params.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
    if (naturalProteinPer100ml <= 0) return 0;
    return (protein * 100) / naturalProteinPer100ml;
  },

  _calculateSpecialVolumeFromProtein(protein) {
    if (!protein || protein <= 0) return 0;
    const params = this.data.calculation_params || {};
    const specialProteinPer100ml = Number(params.special_milk_protein_ml) || 1.97;
    if (specialProteinPer100ml > 0) {
      return (protein * 100) / specialProteinPer100ml;
    }
    const specialProteinPer100g = Number(params.special_milk_protein) || 13.1;
    const ratioPowder = Number(params.special_milk_ratio?.powder) || 13.5;
    const ratioWater = Number(params.special_milk_ratio?.water) || 90;
    if (specialProteinPer100g > 0 && ratioPowder > 0 && ratioWater > 0) {
      const powderWeight = (protein * 100) / specialProteinPer100g;
      return (powderWeight * ratioWater) / ratioPowder;
    }
    return 0;
  }

});
