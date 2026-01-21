// 配奶设置页面
const app = getApp();
const NutritionModel = require('../../models/nutrition');

Page({
  data: {
    settings: null,
    isConfirmed: false,
    inputValues: {}, // 用于显示初始值
    isFromSetup: false,
    activeTab: 'formula'
  },

  onLoad: async function(options) {
    try {
      wx.showLoading({
        title: '加载中...'
      });

      // 检查是否是从设置流程进入
      const isFromSetup = options.fromSetup === 'true';
      this.setData({
        isFromSetup: isFromSetup
      });

      // 首先设置默认值，防止页面渲染问题
      const defaultSettings = {
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
        special_milk_fat: '',
        special_milk_carbs: '',
        special_milk_fiber: '',
        special_milk_ratio: {
          powder: '',
          water: ''
        }
      };
      
      // 使用深拷贝确保默认值不会被引用修改
      this.setData({
        settings: JSON.parse(JSON.stringify(defaultSettings)),
        inputValues: JSON.parse(JSON.stringify(defaultSettings)) // 初始化输入值与默认设置相同
      });
      
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到宝宝信息',
          icon: 'none'
        });
        return;
      }

      // 获取配奶设置
      try {
        const settings = await NutritionModel.getNutritionSettings(babyUid);
        
        if (settings) {
          const motherDefaults = {
            natural_milk_protein: defaultSettings.natural_milk_protein,
            natural_milk_calories: defaultSettings.natural_milk_calories,
            natural_milk_fat: defaultSettings.natural_milk_fat,
            natural_milk_carbs: defaultSettings.natural_milk_carbs,
            natural_milk_fiber: defaultSettings.natural_milk_fiber
          };

          // 使用深合并逻辑处理设置
          const mergedSettings = {
            ...defaultSettings,
            ...settings,
            // 确保嵌套对象正确合并
            special_milk_ratio: {
              ...defaultSettings.special_milk_ratio,
              ...(settings.special_milk_ratio || {})
            },
            formula_milk_ratio: {
              ...defaultSettings.formula_milk_ratio,
              ...(settings.formula_milk_ratio || {})
            }
          };
          
          // 检查所有字段是否有undefined值
          Object.keys(mergedSettings).forEach(key => {
            if (mergedSettings[key] === undefined) {
              mergedSettings[key] = defaultSettings[key];
            }
            
            // 检查嵌套对象
            if ((key === 'special_milk_ratio' || key === 'formula_milk_ratio') && 
                typeof mergedSettings[key] === 'object') {
              Object.keys(mergedSettings[key]).forEach(subKey => {
                if (mergedSettings[key][subKey] === undefined) {
                  mergedSettings[key][subKey] = defaultSettings[key][subKey];
                }
              });
            }
          });

          Object.keys(motherDefaults).forEach(key => {
            const value = mergedSettings[key];
            if (value === '' || value === undefined || value === null) {
              mergedSettings[key] = motherDefaults[key];
            }
          });
          
          this.setData({ 
            settings: mergedSettings,
            inputValues: JSON.parse(JSON.stringify(mergedSettings)) // 初始化输入值与设置相同
          });
        }
      } catch (settingsError) {
        console.error('获取配奶设置失败，使用默认值:', settingsError);
      }

      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('加载配奶设置失败：', err);
      wx.showToast({
        title: '加载设置失败',
        icon: 'none'
      });
    }
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab) return;
    this.setData({ activeTab: tab });
  },

  // 处理表单提交
  formSubmit(e) {
    try {
      // 从表单获取所有输入值
      const formData = e.detail.value;
      const invalidFields = [];
      const allValues = Object.values(formData || {});
      const hasAnyValue = allValues.some(value => (value || '').toString().trim() !== '');

      if (!hasAnyValue) {
        wx.showModal({
          title: '无法保存',
          content: '请至少填写一项配奶参数再保存。',
          showCancel: false
        });
        return;
      }
      
      // 使用正则表达式验证是否为有效数字（允许小数）
      const numberRegex = /^[0-9]+(\.[0-9]+)?$/;
      
      // 验证并转换字段为数字类型
      for (const key in formData) {
        const value = formData[key].trim();
        
        // 空值检查
        if (value === '') {
          formData[key] = '';
          continue;
        }
        
        // 正则验证是否为有效数字
        if (!numberRegex.test(value)) {
          invalidFields.push(this.getFieldDisplayName(key));
        } else {
          formData[key] = parseFloat(value);
        }
      }
      
      // 如果有无效字段，显示错误提示
      if (invalidFields.length > 0) {
        wx.showModal({
          title: '输入错误',
          content: `以下字段必须输入有效数字：${invalidFields.join('、')}`,
          showCancel: false
        });
        return;
      }
      
      // 构建完整的设置对象
      const newSettings = {
        natural_milk_protein: formData.natural_milk_protein,
        natural_milk_calories: formData.natural_milk_calories,
        natural_milk_fat: formData.natural_milk_fat,
        natural_milk_carbs: formData.natural_milk_carbs,
        natural_milk_fiber: formData.natural_milk_fiber,
        formula_milk_protein: formData.formula_milk_protein,
        formula_milk_calories: formData.formula_milk_calories,
        formula_milk_fat: formData.formula_milk_fat,
        formula_milk_carbs: formData.formula_milk_carbs,
        formula_milk_fiber: formData.formula_milk_fiber,
        formula_milk_ratio: {
          powder: formData.formula_milk_ratio_powder,
          water: formData.formula_milk_ratio_water
        },
        special_milk_protein: formData.special_milk_protein,
        special_milk_calories: formData.special_milk_calories,
        special_milk_fat: formData.special_milk_fat,
        special_milk_carbs: formData.special_milk_carbs,
        special_milk_fiber: formData.special_milk_fiber,
        special_milk_ratio: {
          powder: formData.special_milk_ratio_powder,
          water: formData.special_milk_ratio_water
        },
      };
      
      // 保存设置
      this.saveSettings(newSettings);
    } catch (error) {
      console.error('处理表单提交出错:', error);
      wx.showToast({
        title: '表单处理失败',
        icon: 'none'
      });
    }
  },
  
  // 获取字段显示名称
  getFieldDisplayName(fieldName) {
    const fieldMap = {
      'natural_milk_protein': '母乳蛋白质浓度',
      'natural_milk_calories': '母乳热量',
      'natural_milk_fat': '母乳脂肪',
      'natural_milk_carbs': '母乳碳水',
      'natural_milk_fiber': '母乳膳食纤维',
      'formula_milk_protein': '普奶蛋白质浓度',
      'formula_milk_calories': '普奶热量',
      'formula_milk_fat': '普奶脂肪',
      'formula_milk_carbs': '普奶碳水',
      'formula_milk_fiber': '普奶膳食纤维',
      'formula_milk_ratio_powder': '普奶粉量',
      'formula_milk_ratio_water': '普奶水量',
      'special_milk_protein': '特奶蛋白质浓度',
      'special_milk_calories': '特奶热量',
      'special_milk_fat': '特奶脂肪',
      'special_milk_carbs': '特奶碳水',
      'special_milk_fiber': '特奶膳食纤维',
      'special_milk_ratio_powder': '特奶粉量',
      'special_milk_ratio_water': '特奶水量'
    };
    
    return fieldMap[fieldName] || fieldName;
  },
  
  // 保存设置到服务器
  async saveSettings(newSettings) {
    console.log(newSettings, '---new settings')
    try {
      // 显示加载中
      wx.showLoading({
        title: '保存中...',
        mask: true
      });
      
      // 使用宝宝UID关联设置
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        wx.hideLoading();
        wx.showToast({
          title: '未找到宝宝信息，无法保存',
          icon: 'none'
        });
        return;
      }
      
      // 更新本地设置，然后保存到服务器
      this.setData({ 
        settings: newSettings,
        inputValues: JSON.parse(JSON.stringify(newSettings))
      }, async () => {
        try {
          // 保存设置到服务器
          console.log(babyUid, '----babyUid')
          const success = await NutritionModel.updateNutritionSettings(babyUid, this.data.settings);
          
          wx.hideLoading();
          
          if (success) {
            wx.showToast({
              title: '设置已保存',
              icon: 'success'
            });
            
            // 标记为已确认
            this.setData({ isConfirmed: true });
            
            // 延迟后根据来源进行跳转
            setTimeout(() => {
              if (this.data.isFromSetup) {
                // 如果是从设置流程进入，跳转到首页
                wx.switchTab({
                  url: '/pages/daily-feeding/index',
                  fail: (err) => {
                    console.error('跳转到首页失败:', err);
                    wx.navigateBack();
                  }
                });
              } else {
                // 否则返回上一页
                wx.navigateBack();
              }
            }, 1500);
          } else {
            wx.showToast({
              title: '保存失败',
              icon: 'none'
            });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({
            title: '保存失败，请重试',
            icon: 'none'
          });
        }
      });
    } catch (error) {
      console.error('保存配奶设置失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败，请重试',
        icon: 'none'
      });
    }
  },
}); 
